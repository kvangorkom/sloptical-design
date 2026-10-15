// canvas.js — canvas interaction: drag pans, wheel zooms, hover shows the popup, click pins it
// Dragging an optic moves only that optic (Optics.moveOptic): its parent follows the pointer rigidly, so the distance in and the
// off-axis distance change (the beam lands elsewhere on the parent) and its own focus locks re-solve; nothing upstream
// changes. Shift, or a flat: along the incoming axis only. Alt/Option: tilt it in place about its pivot (Optics.tiltOptic),
// turning like a knob: the tilt follows the pointer's angle around the pivot. One drag = one undo step.
let drag = null;
/** Drag toast suffix: whether surface i's pinned foci are held, and by what. */
const held = i => {
  const L = sys.rows[i + 1].lock;
  return !(L?.f1 || L?.f2) ? '' : fails.has(i + 1 + 'lock') ? ' · foci not held' : '';
};
/** A lock point as stored: [y, z] in the y–z plane (as always), [x, y, z] off it; and back to a world point. */
/** In 3D (the design, or a point off the y–z plane) a lock also turns the optic out of plane: tiltY and clock vary too; a
 *  paraboloid facing a collimated beam (axis along it) only clocks, which turns its off-axis segment about the beam. */
const pose = (rows, w, facing) =>
  Optics.is3D(rows) || (w && pt2(w).length > 2) ? (facing ? ['clock'] : ['tiltY', 'clock']) : [];
const pt2 = w => (Math.abs(w[0]) > 1e-12 * (1 + Math.hypot(...w)) ? [...w] : [w[1], w[2]]);
const P3 = p => (p.length > 2 ? p : [0, ...p]);
/** A focus handle under screen point (mx, my): a focus pinned to a point (its square), or, with Stigmatic on or the optic
 *  selected, a curved mirror's free focus (dragging it pins it there). The most downstream one wins. Returns {ri, n, p} or null. */
function pickFocus(mx, my) {
  let best = null;
  let bd = 8;
  S.forEach((s, i) => {
    const ri = i + 1;
    const L = sys.rows[ri].lock;
    const F = s.mirror && s.c ? Optics.foci(s) : [];
    const selected = hov.pinned && hov.tgt?.i === i;
    [1, 2].forEach(n => {
      const tg = L?.[`f${n}`];
      const on = $('stig').checked || selected;
      const real = !tg && on && F[n - 1] ? Optics.realImage(S, i, F[n - 1]) : null; // a free focus: where its light really converges
      const at = pinAt(tg, ri);
      const p = at ? at.p : tg?.at === 'inf' && on ? (F[n - 1] ?? infHandle(i)) : (real?.p ?? null);
      const space = at ? at.space : real?.space;
      if (!p || (n === 2 && s.k === 0 && tg?.at !== 'pt')) return;
      const [x, y] = X(p);
      const d = Math.hypot(x - mx, y - my);
      if (d <= bd) {
        bd = d;
        best = { ri, n, p, ...(space > i && { space }) };
      }
    });
  });
  return best;
}
/** A plain plane right after row ri sitting on point F (within tol mm) is that conic's focal plane: its distance out gets a
 *  focus solve, so the plane follows the image wherever it is dragged. */
function stickPlane(ri, F, tol, rows = sys.rows, St = S) {
  const r = rows[ri];
  const nx = rows[ri + 1];
  const q = St[ri];
  if (
    !nx ||
    !q ||
    nx.type === 'mirror' ||
    nx.R ||
    q.nOut !== q.nIn ||
    r.solve?.t ||
    Optics.varies(rows, ri, 't')
  )
    return false;
  if (Math.hypot(...q.P.map((v, k) => v - F[k])) > tol) return false;
  (r.solve ??= {}).t = { type: 'focus' };
  return true;
}
/** The pinned image point a drag on surface i moves instead of the surface: a focal plane (a plain plane whose distance in is
 *  a focus solve) after a conic whose image is pinned to a point. Returns a pickFocus-style handle or null. */
function planeFocus(i) {
  const q = S[i];
  if (!q || !i || q.c || q.mirror || sys.rows[i].solve?.t?.type !== 'focus') return null;
  for (let ri = i; ri >= 1; ri--) {
    const L = sys.rows[ri].lock;
    for (const n of [2, 1]) {
      const at = pinAt(L?.[`f${n}`], ri);
      if (at && (Number.isInteger(at.space) ? at.space : ri - 1) + 1 === i)
        return { ri, n, p: at.p, ...(at.space > ri - 1 && { space: at.space }) };
    } // the image (held, or riding) this plane focuses on (after flats too)
    if (S[ri - 1].c || !S[ri - 1].mirror) break; // (only flats between)
  }
  return null;
}
/** With Stigmatic on, a mirror whose two foci are both pinned to points (not infinity) varies R, k, off-axis and tilt: the
 *  stigmatic pair, solved outright (Optics.conjugateMirror); the off-axis becomes a normal angle. Returns whether it applies. */
function stigPair(ri) {
  const r = sys.rows[ri];
  const L = r.lock;
  if (!$('stig').checked || r.type !== 'mirror' || !L?.f1 || !L?.f2 || L.f1.at === 'inf' || L.f2.at === 'inf')
    return false;
  const add = ['R', 'k', 'd', 'tilt', ...pose(sys.rows)].filter(k => !L.vary?.includes(k));
  if (add.length) {
    L.vary = [...(L.vary ?? []), ...add];
    add.forEach(k => delete r.solve?.[k]);
    Optics.offAxisAs(sys.rows, ri, 'angle');
  }
  return true;
}
/** Where a focus pinned at infinity (a paraboloid's F2) gets its handle: out along the output beam, partway to the next surface. */
function infHandle(i) {
  const s = S[i];
  const t = sys.rows[i + 1].t;
  const d = t > 0 ? 0.6 * t : Math.abs(1 / (s.c || 1e-3));
  return s.P.map((v, k) => v + d * s.uOut[k]);
}
/** Put row ri's focus n on world point w (a point target), starting the lock's stigmatic defaults when nothing varies yet. */
function setFocus(h, w) {
  const { ri } = h;
  const r = sys.rows[ri];
  const L = (r.lock ??= { vary: [] });
  if (L[`f${h.n}`] && L[`f${h.n}`].at !== 'pt' && L[`f${3 - h.n}`]?.at === 'pt') h.n = 3 - h.n; // the pins swapped (a hyperboloid's far branch): follow the point
  let n = h.n;
  const fresh = !L[`f${n}`] || L[`f${n}`].at === 'inf';
  if (fresh && $('stig').checked && r.type === 'mirror' && !L[`f${3 - n}`]) {
    // Stigmatic: the other focus goes on the incoming focus, or,
    if (Optics.inFocus(S, ri - 1))
      L[`f${3 - n}`] = { at: 'in' }; // in a collimated beam, the mirror becomes a paraboloid facing it
    else {
      h.n = n = 1;
      Object.assign(r, { k: -1, tilt: 0 });
      delete r.tiltY;
      delete r.pivot;
      L.f2 = { at: 'inf' };
      L.vary = ['R', 'd', ...pose(sys.rows, w, true)];
      L.vary.forEach(k => delete r.solve?.[k]);
    }
  }
  // a riding image is held while its square is dragged (flats on the way too), so it stays under the pointer; it rides
  // again from where it is dropped (settleRide)
  const rides =
    !!L[`f${n}`]?.ride || L[`f${n}`]?.rideAfter || (fresh && $('stig').checked && stigMode() === 'follow');
  L[`f${n}`] = {
    at: 'pt',
    p: pt2(w),
    ...(h.space > ri - 1 && { space: h.space }),
    ...(rides && { rideAfter: true }),
  };
  if ($('stig').checked && stigLocked(ri)) {
    if (L.f1?.at !== 'inf' && L.f2?.at !== 'inf') Optics.offAxisAs(sys.rows, ri, 'angle');
    L.vary = Optics.stigVary(sys.rows, ri); // the image held: all its shape varies
    L.vary.forEach(k => delete r.solve?.[k]);
    return;
  }
  if (stigPair(ri)) return;
  if (fresh && !L.vary?.length) {
    const other = L[`f${3 - n}`];
    const keys =
      other?.at === 'inf' && !Optics.inFocus(S, ri - 1)
        ? ['R', 'd', ...pose(sys.rows, null, true)]
        : [...(other?.at === 'inf' ? ['R', 'd', 'tilt'] : ['R', 'k', 'd', 'tilt']), ...pose(sys.rows)];
    if (keys.includes('k')) Optics.offAxisAs(sys.rows, ri, 'angle');
    const keep = Optics.varyPick(sys.rows, ri, keys).keep;
    L.vary = keys.filter(k => keep.includes(k));
    L.vary.forEach(k => delete r.solve?.[k]);
  }
}
let space = false; // Space held: a left-drag orbits
onDoc('keydown', e => {
  if (e.code === 'Space' && !e.target.closest?.('input, textarea, select, button, dialog')) {
    space = true;
    if (ptr) e.preventDefault();
  }
});
onDoc('keyup', e => {
  if (e.code === 'Space') space = false;
});
cv.oncontextmenu = e => e.preventDefault(); // (the right button orbits)
cv.onpointerdown = e => {
  if (e.button === 1 || e.button === 2 || (space && e.button === 0)) {
    // orbit the view about what is in the middle of it
    e.preventDefault();
    cancelAnimationFrame(camAnim);
    centrePivot();
    drag = { x: e.offsetX, y: e.offsetY, moved: false, orbit: true };
    return cv.setPointerCapture(e.pointerId);
  }
  const fh = !tool && pickFocus(e.offsetX, e.offsetY);
  const pf =
    !fh &&
    !e.altKey &&
    !e.shiftKey &&
    (() => {
      const t = pick(e.offsetX, e.offsetY);
      return t?.i !== undefined && planeFocus(t.i);
    })(); // a focal plane: moves its image
  const h = fh || pf;
  const w = world(e, h?.p);
  const [, wy, wz] = w; // (3D views: a focus moves in the plane through it facing the viewer)
  if (h) {
    commit();
    drag = {
      x: e.offsetX,
      y: e.offsetY,
      moved: false,
      focus: h,
      plane: !fh,
      grab: w.map((v, k) => v - h.p[k]),
    };
    return cv.setPointerCapture(e.pointerId);
  }
  if (tool && !side) return toast('Shapes are drawn in the x view (press 1)');
  if (tool) {
    commit(); // start a new shape at the pointer
    sys.shapes.push(
      tool === 'rect'
        ? { type: 'rect', z: wz, y: wy, w: 0, h: 0 }
        : tool === 'circle'
          ? { type: 'circle', z: wz, y: wy, d: 0 }
          : { type: 'line', z: wz, y: wy, z2: wz, y2: wy },
    );
    selectShape(sys.shapes.length - 1);
    drag = { x: e.offsetX, y: e.offsetY, moved: false, shape: shSel, part: 'new', o: [wz, wy] };
    return cv.setPointerCapture(e.pointerId);
  }
  const t = pick(e.offsetX, e.offsetY);
  const sp = t?.i === undefined && side && pickShape(e.offsetX, e.offsetY); // (shapes are edited in the x view)
  if (sp) {
    commit();
    selectShape(sp.k);
    draw(); // select, move or resize a shape
    drag = {
      x: e.offsetX,
      y: e.offsetY,
      moved: false,
      shape: sp.k,
      part: sp.part,
      sh0: structuredClone(sys.shapes[sp.k]),
      w0: w,
    };
    return cv.setPointerCapture(e.pointerId);
  }
  if (t?.i !== undefined) commit(); // a pending edit stays its own undo step
  drag = {
    x: e.offsetX,
    y: e.offsetY,
    moved: false,
    ...(t?.i !== undefined && {
      i: t.i,
      rows0: structuredClone(sys.rows),
      ref: S[t.i].P,
      grab: world(e, S[t.i].P).map((v, k) => v - S[t.i].P[k]),
    }),
  }; // (3D views: it moves in the plane facing the viewer)
  cv.setPointerCapture(e.pointerId);
};
cv.onpointermove = e => {
  ptr = [e.offsetX, e.offsetY];
  if (drag) {
    const dx = e.offsetX - drag.x;
    const dy = e.offsetY - drag.y;
    if (!(drag.moved ||= Math.hypot(dx, dy) > 3)) return;
    if (drag.orbit) {
      drag.x = e.offsetX;
      drag.y = e.offsetY;
      cv.style.cursor = 'grabbing';
      return orbitBy(-dx * 0.4, dy * 0.4);
    }
    if (drag.shape !== undefined) {
      const [, y, z] = world(e);
      reshape(sys.shapes[drag.shape], drag, z, y, e.shiftKey);
      setHov(null);
      return update();
    }
    if (drag.focus) {
      const { ri, n } = drag.focus;
      drag.stuck ||= (stickPlane((drag.focus.space ?? ri - 1) + 1, drag.focus.p, 12 / view.s), true); // a plane dropped on the image follows it
      setFocus(
        drag.focus,
        world(e, drag.focus.p).map((v, k) => v - drag.grab[k]),
      );
      setHov(null);
      cv.style.cursor = 'grabbing';
      update();
      const r = sys.rows[ri];
      const bad = fails.has(ri + 'lock');
      return toast(`${label(ri - 1)}: F${n} moved${bad ? ' · can’t hold it there' : ''}`);
    }
    if (drag.i === undefined) {
      view.ox += dx;
      view.oy += dy;
      drag.x = e.offsetX;
      drag.y = e.offsetY;
      return viewMoved();
    }
    const i = drag.i;
    const along = e.shiftKey || !S[i].c || Optics.heldD(sys.rows, i + 1);
    const me = () => sys.rows[i + 1];
    const mode = e.altKey ? 'tilt' : 'move'; // (off-axis held by a lock: along)
    if (drag.mode && drag.mode !== mode)
      Object.assign(drag, {
        rows0: structuredClone(sys.rows),
        grab: world(e, S[i].P).map((v, k) => v - S[i].P[k]),
        ref: S[i].P,
        turn: undefined,
        pivot: undefined,
        switched: true,
      });
    drag.mode = mode; // switching mid-drag carries on from where the optic is
    if (mode === 'tilt') {
      // tilt about the pivot by the pointer's turn around it
      const O = (drag.pivot ??= side ? S[i].pivotAt : S[i].P);
      const [ox, oy] = X(O);
      const ang = (x, y) => (Math.atan2(oy - y, x - ox) * 180) / Math.PI;
      const far = (x, y) => Math.hypot(x - ox, oy - y) >= 12;
      if (!far(e.offsetX, e.offsetY)) return; // too close to the pivot to read an angle
      drag.turn ??= !drag.switched && far(drag.x, drag.y) ? ang(drag.x, drag.y) : ang(e.offsetX, e.offsetY); // from where it was grabbed
      const by = fz * fy * (((ang(e.offsetX, e.offsetY) - drag.turn + 540) % 360) - 180); // a mirrored view turns the other way
      sys.rows = side ? Optics.tiltOptic(drag.rows0, i, by) : Optics.turnOptic(drag.rows0, i, viewDir(), by);
      setHov(null);
      cv.style.cursor = 'grabbing';
      update(); // 3D: about the line of sight
      const pv = me().pivot?.at;
      const about =
        pv === undefined
          ? 'its hit point'
          : pv === 'coc'
            ? 'its centre of curvature'
            : pv
              ? label(pv - 1)
              : 'the pupil centre';
      if (!side) return toast(`${label(i)}: turned ${by >= 0 ? '+' : ''}${nf(by)}°${held(i)}`);
      return toast(
        `${label(i)}: tilt ${nf(me().tilt)}° (${by >= 0 ? '+' : ''}${nf(by)}°) about ${about}${held(i)}`,
      );
    }
    sys.rows = Optics.moveOptic(
      drag.rows0,
      i,
      world(e, drag.ref).map((v, k) => v - drag.grab[k]),
      { along },
    );
    setHov(null);
    cv.style.cursor = 'grabbing';
    update();
    return toast(`${label(i)}: ${nf(sys.rows[i].t)} mm from ${i ? label(i - 1) : 'the pupil'}` + held(i));
  }
  const t = pick(e.offsetX, e.offsetY);
  cv.style.cursor = tool
    ? 'crosshair'
    : pickFocus(e.offsetX, e.offsetY)
      ? 'move'
      : t?.i !== undefined
        ? 'grab'
        : pickShape(e.offsetX, e.offsetY)
          ? 'move'
          : '';
  if (!hov.pinned) {
    hov.at = [e.offsetX, e.offsetY];
    setHov(t);
  }
};
cv.onpointerup = e => {
  if (drag?.orbit) {
    drag = null;
    cv.style.cursor = '';
    return;
  }
  if (drag?.focus && drag.moved) {
    settleRide(drag.focus.ri);
    commit();
    drag = null;
    cv.style.cursor = 'move';
    return;
  } // (a click on a focus or a focal plane, without a drag, pins its popup like any click)
  if (drag?.shape !== undefined) {
    // finish a shape: one undo step; a click without a drag draws nothing
    const sh = sys.shapes[drag.shape];
    const empty = drag.part === 'new' && !((sh.w && sh.h) || sh.d || (sh.type === 'line' && shGet(sh, 'L')));
    if (empty) {
      sys.shapes.splice(drag.shape, 1);
      selectShape(null);
    } else {
      if (drag.part === 'new') setTool(null);
      update();
      commit();
    }
    drag = null;
    return update();
  }
  if (drag && !drag.moved && shSel !== null) selectShape(null);
  if (drag && !drag.moved) {
    const t = pick(e.offsetX, e.offsetY);
    hov.pinned = !!t && !(hov.pinned && t.i !== undefined && t.i === hov.tgt?.i);
    hov.at = [e.offsetX, e.offsetY];
    setHov(t);
  }
  if (drag?.i !== undefined && drag.moved) {
    commit();
    cv.style.cursor = 'grab';
  }
  drag = null;
};
cv.onpointerleave = () => {
  ptr = null;
  if (!hov.pinned && !drag) setHov(null);
};
cv.onwheel = e => {
  e.preventDefault();
  zoomAt([e.offsetX, e.offsetY], Math.exp(-e.deltaY * 0.0015));
};
cv.ondblclick = () => {
  view = null;
  draw();
};

// ── Quick insert: A adds a plane, M a mirror, where the cursor is on the optical axis (or past the last surface, along
// its output). The gap there is split, so everything downstream stays put along the axis, and the new row's R cell takes
// the focus, ready to type and Tab through. With Stigmatic on, a new mirror is a flat; give it an R and Stigmatic locks it
// to image perfectly (the incoming focus onto its image then, held or riding as Stigmatic's mode says), the ellipsoid,
// hyperboloid or paraboloid that does so (Optics.conjugateMirror); dragging its square then places the image.
let ptr = null; // last pointer position over the view
/** The axis segment under screen point (mx, my): {j, s} = s along segment j (j = S.length: past the last surface), or null. */
function axisAt(mx, my) {
  let best = null;
  let bd = Infinity;
  for (let j = 0; j <= S.length; j++) {
    const A = AX[j];
    const L = j < S.length ? seg(j) : Infinity;
    const [ax, ay] = X(A.p);
    const q = side ? null : X(A.p.map((v, k) => v + A.u[k]));
    const sc = side ? view.s : Math.hypot(q[0] - ax, q[1] - ay) || 1e-9; // px per mm along it as drawn
    const dx = side ? A.u[2] : (q[0] - ax) / sc;
    const dy = side ? -A.u[1] : (q[1] - ay) / sc; // the axis on screen, unit direction
    const t = Math.max(0, Math.min(L * sc, (mx - ax) * dx + (my - ay) * dy));
    const d = Math.hypot(mx - ax - t * dx, my - ay - t * dy);
    if (d < bd) {
      bd = d;
      best = { j, s: t / sc };
    }
  }
  const hw = best && best.j < S.length ? probeHW(best.j, best.s) * view.s : 0;
  return best && bd <= Math.max(10, hw + 6) ? best : null;
}
/** A new mirror's radius and conic for segment j at s: see the section note. With Stigmatic on it starts flat (a fold),
 *  and imaging perfectly is taken up once it has a radius (guard: Stigmatic locks it then); otherwise a mirror focusing
 *  the beam a little way on. */
function newMirror(j, s) {
  const a = sys.rows[0].ap;
  const c = j ? Optics.curv(S, j - 1, a * 1e-4) : S.beam ? 1 / S.beam : 0;
  const far = !(Math.abs(1 / c) < 1e6 * a);
  const f = far ? Math.max(Math.abs(s), 10 * a) : s - 1 / c; // distance back to the focus
  if ($('stig').checked)
    return { R: 0, k: 0, why: 'a flat: give it an R to curve it (it then images perfectly)' };
  return { R: -2 * f, k: 0, why: '' };
}
/** Stigmatic on: every curved mirror without focus locks gets them, keeping its image where it is now and making it perfect.
 *  F1 goes on the incoming focus and F2 on a point at the current image (or at infinity when the output is collimated),
 *  varying R, k, off-axis (as a normal angle) and tilt; in a collimated beam it becomes a paraboloid facing the beam, its
 *  focus on a point at the current image, varying R and off-axis. Returns how many it locked. */
function stigmatize() {
  let n = 0;
  S.forEach((_, i) => {
    if (stigLock(i + 1, S)) n++;
  });
  return n;
}
/** Stigmatic's mode: 'hold' (images stay where they are in the room; mirrors reshape) or 'follow' (mirrors keep their
 *  shape and re-aim; images move with them). */
const stigMode = () => $('stigMode').value;
/** Whether row ri's lock is Stigmatic's own: a focus on the beam arriving (its focus, the source for the first optic, or,
 *  collimated, the beam itself). */
function stigLocked(ri, St = S) {
  const L = sys.rows[ri]?.lock;
  return (
    !!L &&
    [L.f1, L.f2].some(
      t =>
        t?.at === 'in' || (t?.at === 'src' && ri === 1) || (t?.at === 'inf' && !Optics.inFocus(St, ri - 1)),
    )
  );
}
/** Where pin tg of row ri's lock is in the room, with the space it is in, for its handle: a held point as it is, a riding
 *  image where its light really converges (seen through flats on the way). Null for a pin that isn't a point. */
function pinAt(tg, ri, St = S) {
  if (tg?.at !== 'pt') return null;
  if (!tg.ride) return { p: P3(tg.p), space: tg.space };
  const Q = Optics.lockPoint(St, tg, ri - 1);
  return Q && Optics.realImage(St, ri - 1, Q);
}
/** Lock row ri (a curved mirror without locks) to image perfectly, from the built system St: one focus on the incoming
 *  focus (in a collimated beam, a paraboloid facing it), the other on its image (for a collimated output, its direction),
 *  and its shape (R, k, off-axis, tilt) solved from those. Holding foci, the image is held in the room, where the light
 *  really converges (seen through flats on the way, which are then held in the room too). Following, the image rides with
 *  the mirror: it keeps its place relative to where the beam hits it, so moving or turning the mirror carries it along. A
 *  plain plane at the image becomes its focal plane (a focus solve on its distance in). Returns whether it was locked. */
function stigLock(ri, St, rows = sys.rows, mode = stigMode()) {
  const i = ri - 1;
  const r = rows[ri];
  if (r.type !== 'mirror' || !r.R || r.lock?.f1 || r.lock?.f2 || !St[i]) return false;
  const fin = Optics.inFocus(St, i);
  const img = Optics.inFocus(St, i + 1);
  if (!fin && !img) return false; // collimated in and out: nothing to image
  const hold = mode !== 'follow';
  const real = img && Optics.realImage(St, i, img);
  const image = () =>
    hold
      ? { at: 'pt', p: pt2(real.p), ...(real.space > i && { space: real.space }) }
      : { at: 'pt', ride: Optics.toRide(St, i, img) };
  if (fin && img) Optics.offAxisAs(rows, ri, 'angle'); // (a paraboloid keeps its off-axis distance)
  if (!fin) {
    Object.assign(r, { k: -1, tilt: 0 });
    delete r.tiltY;
    delete r.pivot;
    r.lock = { f1: image(), f2: { at: 'inf' } };
  } else {
    if (!img) r.k = -1;
    const out = hold
      ? { u: [...St[i].uOut] }
      : {
          ride: Optics.toRide(
            St,
            i,
            St[i].P.map((v, k) => v + St[i].uOut[k]),
          ),
        };
    r.lock = { f1: { at: 'in' }, f2: img ? image() : { at: 'inf', ...out } };
  }
  r.lock.vary = Optics.stigVary(rows, ri);
  r.lock.vary.forEach(k => delete r.solve?.[k]); // one owner per value
  if (img) stickPlane(real.space + 1, real.p, 1e-6 * Math.max(1, Math.hypot(...real.p)), rows, St); // a plane already at the image is its focal plane
  return true;
}
/** A riding image whose square was dragged (held meanwhile) rides again, from where it was dropped. */
function settleRide(ri) {
  const L = sys.rows[ri]?.lock;
  let n = 0;
  for (const k of ['f1', 'f2'])
    if (L?.[k]?.rideAfter) {
      const Q = Optics.lockPoint(S, L[k], ri - 1); // (in the mirror's own space, seen through the held flats)
      if (Q) L[k] = { at: 'pt', ride: Optics.toRide(S, ri - 1, Q) };
      n++;
    }
  if (n) update();
}
/** Stigmatic's mode changed: its locks are made again in the new mode, each mirror keeping the image it has now. Mirrors
 *  it hadn't locked (the TMA's, say, whose aberrations cancel between them rather than each imaging perfectly) are left be. */
function restigmatize() {
  const own = sys.rows.flatMap((r, ri) => (ri && stigLocked(ri) ? [ri] : []));
  own.forEach(ri => delete sys.rows[ri].lock);
  return own.filter(ri => stigLock(ri, S)).length;
}
function insertAt(mx, my, kind) {
  const hit = axisAt(mx, my);
  if (!hit) return toast('Point at the optical axis (the beam) to add an optic there');
  commit();
  hideLock();
  const { j, s } = hit;
  const R = sys.rows;
  const rest = j < S.length ? R[j].t - s : 0;
  const row = { ...DEF, t: rest, n: j ? S[j - 1].nOut : 1 };
  let why = '';
  if (kind === 'mirror') {
    const m = newMirror(j, s);
    why = m.why;
    delete m.why;
    Object.assign(row, { type: 'mirror' }, m);
  }
  R[j].t = s;
  if (R[j].solve) delete R[j].solve.t;
  Optics.unvary(R, j, 't'); // the gap it lands in is split; a solve on it would move it
  reindex(j, 1);
  R.splice(j + 1, 0, row);
  renderTable();
  update();
  editCell($('tbl').querySelector(`tr[data-i="${j + 1}"] input[data-k="R"]`));
  toast(
    `Added ${kind === 'mirror' ? 'a mirror' : 'a plane'} after ${j ? label(j - 1) : 'the pupil'}${why ? ` · ${why}` : ''}`,
  );
}
onDoc('keydown', e => {
  const k = e.key.toLowerCase();
  if (
    e.ctrlKey ||
    e.metaKey ||
    e.altKey ||
    e.repeat ||
    !ptr ||
    !(k === 'a' || k === 'm') ||
    e.target.closest?.('input, textarea, select, dialog')
  )
    return;
  e.preventDefault();
  insertAt(...ptr, k === 'm' ? 'mirror' : 'plane');
});
