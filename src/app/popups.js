// popups.js — popups: footprint / spot / WFE for a surface or for a probe plane anywhere along the beam
// `hov` follows the cursor; clicking pins it. Dragging a pinned popup docks it: it stays open, updates live with every
// edit, and a fresh hover popup takes its place. Any number can be docked; × closes one.
// Footprint: all fields overlaid (surface: segment-centred, with clear aperture). Spot: one panel per field, centroid-relative,
// with RMS radius and optional Airy disk. WFE: OPD over the entrance pupil after removing piston, tilt and the best-fit sphere.
// A surface's WFE and ROC describe the beam leaving it (arriving, for the last surface). The ROC is signed: + converging.
const heat = t => `hsl(${t < 0 ? 215 : 12} 75% ${100 - 52 * Math.min(1, Math.abs(t))}%)`; // diverging: blue −, white 0, red +
const docks = [];
let zTop = 1;
function makePop() {
  const el = $('popTpl').content.firstElementChild.cloneNode(true);
  const p = { el, c: el.querySelector('canvas'), tgt: null, pinned: false, docked: false, at: [0, 0] };
  $('main').append(el);
  el.querySelector('.popM').onclick = e => {
    const m = e.target.dataset.m;
    if (!m) return;
    p.mode = m;
    if (p.tgt.i !== undefined) {
      sys.rows[p.tgt.i + 1].plot = m;
      update();
    } else {
      pref('optic_beamtab', m);
      renderPop(p);
    }
  }; // beam popups open on the last tab chosen
  el.querySelector('.popX').onclick = () => closePop(p);
  el.querySelector('.popH').onpointerdown = e => {
    // drag a pinned popup's header to dock it
    if (!p.pinned || e.target.closest('button')) return;
    const h = e.currentTarget;
    const x0 = e.clientX - el.offsetLeft;
    const y0 = e.clientY - el.offsetTop;
    h.setPointerCapture(e.pointerId);
    h.classList.add('dragging');
    if (p.docked) el.style.zIndex = ++zTop; // raise to front
    h.onpointermove = m => {
      if (!p.docked) {
        p.docked = true;
        docks.push(p);
        el.classList.add('docked');
        el.style.zIndex = ++zTop;
        hov = makePop();
      }
      p.pos = [m.clientX - x0, m.clientY - y0];
      place(p);
    };
    h.onpointerup = () => {
      h.onpointermove = null;
      h.classList.remove('dragging');
    };
  };
  return p;
}
let hov = makePop();
const pops = () => [hov, ...docks];
function closePop(p) {
  if (p.docked) {
    docks.splice(docks.indexOf(p), 1);
    p.el.remove();
    markRow();
    draw();
  } else {
    p.pinned = false;
    setHov(null);
  }
}
function setHov(t) {
  hov.tgt = t;
  hov.mode = null;
  hov.el.hidden = !t;
  markRow();
  if (t) renderPop(hov);
  redraw();
}
function place(p) {
  const el = p.el;
  const m = $('main');
  const [x, y] = p.pos ?? [p.at[0] + 16, p.at[1] + 16];
  el.style.left = Math.max(4, Math.min(x, m.clientWidth - el.offsetWidth - 4)) + 'px';
  el.style.top = Math.max(4, Math.min(y, m.clientHeight - el.offsetHeight - 4)) + 'px';
}

/** A pinned or docked surface popup edits its row in place: the table's fields (name, type, R, k, off-axis, tilt, distance
 *  out, n, semi-aperture, foci), with the table's own handlers, value popover (jog, solves, pivot, ∠°) and focus-lock
 *  popover. Rebuilt only when the row or its type changes, so a field keeps focus while the system updates around it. */
function renderEdit(p, ri) {
  let ed = p.el.querySelector('.popP');
  if (ri === null || !sys.rows[ri]) {
    if (ed) {
      if (ed.contains(jt)) hideJog();
      if (ed.contains(lk?.anchor)) hideLock();
      ed.hidden = true;
    }
    return;
  }
  const r = sys.rows[ri];
  const key = `${ri}|${r.type}|${sys.rows.length}|${three()}`;
  if (!ed) {
    ed = document.createElement('table');
    ed.className = 'popP';
    p.el.querySelector('.popS').before(ed);
    ed.oninput = e => $('tbl').oninput(e);
    ed.onchange = e => $('tbl').onchange(e);
    ed.onkeydown = e => {
      $('tbl').onkeydown(e); // Escape in a field reverts and leaves it; the next one closes the popup
      if (e.key === 'Escape' && e.target.matches('input, select')) {
        e.stopPropagation();
        e.target.blur();
      }
    };
    ed.onclick = e => {
      const b = e.target.closest('[data-act="foci"]');
      if (!b) return;
      const i = +b.closest('tr').dataset.i;
      lk?.anchor === b ? hideLock() : showLock(i, b);
    };
  }
  ed.hidden = false;
  if (ed.dataset.key !== key) {
    if (ed.contains(jt)) hideJog();
    if (ed.contains(lk?.anchor)) hideLock();
    ed.dataset.key = key;
    const esc = v => String(v).replace(/[&"<]/g, c => `&#${c.charCodeAt(0)};`);
    const who = label(ri - 1);
    const num = k => {
      const [, h, tip] = cols().find(c => c[0] === k);
      if (noIndex(k, r)) return `<td class="na" title="${esc(tip)}"><label>${h}</label><span>—</span></td>`;
      return (
        `<td title="${esc(tip)}"><label>${h}</label><span class="pin"><input class="num" data-k="${k}" inputmode="decimal" autocomplete="off" value="${show(k, r[k])}" aria-label="${esc(h)} of ${esc(who)}"` +
        `${k === 'ap' ? ' placeholder="auto"' : ''}>${k === 'tilt' ? '<span class="piv"></span>' : k === 'd' ? '<span class="piv oa"></span>' : ''}</span></td>`
      );
    };
    ed.innerHTML =
      `<tbody><tr data-i="${ri}">` +
      `<td class="w2 l"><label>Name</label><input class="name" data-k="name" value="${esc(r.name ?? '')}" placeholder="S${ri}" aria-label="Name of ${esc(who)}"></td>` +
      `<td class="l"><label>Type</label><select data-k="type" aria-label="Type of ${esc(who)}">${['refract', 'mirror'].map(t => `<option${t === r.type ? ' selected' : ''}>${t}</option>`).join('')}</select></td>` +
      `<td class="foc l"><label>Foci</label><button data-act="foci" aria-haspopup="dialog" aria-label="Foci of ${esc(who)}"></button></td>` +
      cols()
        .map(([k]) => k)
        .map(num)
        .join('') +
      '</tr></tbody>';
  }
  syncCells(ed);
}

function renderPop(p) {
  const t = p.tgt;
  const surf = t.i !== undefined;
  const i = t.i;
  const last = i === S.length - 1;
  const F = sys.fields;
  const a = sys.rows[0].ap;
  const q = s => p.el.querySelector(s);
  const j = surf ? (last ? i : i + 1) : t.j;
  const sAt = surf ? (last ? seg(i) : 0) : t.s; // beam segment and position in it
  const on = p.pinned || p.docked; // (pinned, an optic opens on its values to edit)
  let mode =
    p.mode ??
    (surf
      ? (sys.rows[i + 1].plot ?? (on ? 'edit' : last ? 'spot' : 'footprint'))
      : pref('optic_beamtab') || 'footprint');
  if ((p.pinned || p.docked) && !p.mode) p.mode = mode; // pinned or docked: keeps its tab from then on
  if (mode.startsWith('ext:') && !extFor(surf).some(e => 'ext:' + e.id === mode)) mode = 'footprint'; // extension removed
  const samp = fi =>
    surf
      ? footprint(i, fi).map(q => ({ xy: q.loc, u: q.u, n: q.n }))
      : Optics.toPlane(
          B[fi].filter(r => r.length > j + 1).map(r => r[j]),
          at(j, sAt),
          AX[j].u,
        );
  const sampW = (w, fi) =>
    surf
      ? w.B[fi]
          .filter(r => r.length > i + 1)
          .map(r => r[i + 1])
          .map(q => ({ xy: q.loc, u: q.u, n: q.n }))
      : Optics.toPlane(
          w.B[fi].filter(r => r.length > j + 1).map(r => r[j]),
          at(j, sAt),
          AX[j].u,
        );
  const wfe = fi => {
    const w = Optics.wavefrontIn(S, B[fi], j); // fitted where the beam is widest; radius carried to sAt
    return w && { R: w.R - (sAt - w.s0), opd: w.opd.map(v => v / (sys.lambda * 1e-3)), pp: w.pp };
  };
  const w0 = wfe(0);
  const R0 = w0?.R;
  const roc = !w0
    ? '—'
    : Math.abs(R0) > 1e6 * a
      ? '∞ (collimated)'
      : `${R0 > 0 ? '+' : ''}${nf(R0)} mm, ${R0 > 0 ? 'converging' : 'diverging'}`;
  q('.popT').innerHTML =
    (surf
      ? `${label(i)} <small>· ${S[i].type}`
      : `Beam <small>· ${nf(t.s)} mm after ${j ? label(j - 1) : 'the pupil'}`) +
    (on ? '' : ' · click to pin') +
    '</small>';
  q('.popT').title = on && !p.docked ? 'Drag the title to keep this open' : '';
  const fS = surf && (S[i].mirror ? -0.5 / S[i].c : S[i].nOut / (S[i].c * (S[i].nOut - S[i].nIn))); // surface focal length (mirror −R/2, refract n′R/(n′−n))
  // The first field's beam on the plane across the axis here (leaving a surface, or arriving at the last): its radius about
  // its centre, and its working f/# = 1/(2 NA), NA = n·sin of the widest ray angle to the beam's mean direction.
  const pl = Optics.toPlane(
    B[0].filter(r => r.length > j).map(r => r[j]),
    at(j, sAt),
    AX[j].u,
  );
  const mx = k => pl.reduce((v, q) => v + q.xy[k], 0) / pl.length;
  const rad = pl.length ? Math.max(...pl.map(q => Math.hypot(q.xy[0] - mx(0), q.xy[1] - mx(1)))) : NaN;
  const NAh =
    pl.length > 1
      ? Optics.na(
          pl.map(q => q.u),
          pl[0].n,
        )
      : NaN;
  const fno = !(NAh >= 0) ? '—' : NAh < 1e-6 ? '∞' : nf(1 / (2 * NAh));
  const items = l => l.map(t => t.replace(/ /g, '\u00a0')).join(' · '); // wraps only between items
  q('.popS').innerText =
    (surf ? items([`AOI ${nf(S[i].aoi)}°`, `f ${isFinite(fS) ? nf(fS) : '∞'}`]) + '\n' : '') +
    items([
      `${surf ? (last ? 'arriving: ' : 'leaving: ') : ''}ROC ${roc}`,
      `radius ${nf(rad)} mm`,
      `f/${fno}`,
      `field ${fl(F[0])}`,
    ]);
  q('.popM').hidden = q('.popX').hidden = !on;
  const values = mode === 'edit'; // the Values tab: the editor (pinned) and the beam here; no plot
  q('.popS').hidden = !values;
  p.c.hidden = values;
  renderEdit(p, surf && on && values ? i + 1 : null);
  syncExtTabs(p, surf);
  q('.popM')
    .querySelectorAll('button')
    .forEach(b => b.setAttribute('aria-pressed', b.dataset.m === mode));
  q('.popE').hidden = !mode.startsWith('ext:');
  if (values) {
    p.el.hidden = false;
    p.el.classList.toggle('pinned', on);
    return place(p);
  }
  if (mode.startsWith('ext:')) {
    renderExt(p, mode.slice(4), { surf, i, j: surf ? i : t.j, s: surf ? seg(i) : t.s });
    p.el.hidden = false;
    p.el.classList.toggle('pinned', on);
    return place(p);
  }
  const P = 128;
  const H =
    P + (mode === 'wfe' || (mode === 'spot' && (sys.airy || BW.length)) || (surf && !S[i].ap) ? 12 : 0);
  const r = devicePixelRatio;
  const pc = p.c;
  const pctx = pc.getContext('2d');
  const panels = mode === 'footprint' ? [F.map((_, fi) => fi)] : F.map((_, fi) => [fi]);
  pc.width = P * panels.length * r;
  pc.height = H * r;
  pc.style.width = P * panels.length + 'px';
  pc.style.height = H + 'px';
  pctx.setTransform(r, 0, 0, r, 0, 0);
  pctx.clearRect(0, 0, P * panels.length, H);
  pctx.font = '10px ' + tok('--mono');
  panels.forEach((fis, k) => {
    const ox = k * P + P / 2;
    const oy = P / 2 - 6;
    const txt = (t, line) => {
      pctx.fillStyle = tok('--mute');
      pctx.fillText(t, k * P + 4, P - 4 + 12 * line);
    };
    const circle = (rad, sc, dash) => {
      pctx.beginPath();
      pctx.setLineDash(dash);
      pctx.arc(ox, oy, rad * sc, 0, 7);
      pctx.stroke();
      pctx.setLineDash([]);
    };
    if (mode === 'wfe') {
      const w = k ? wfe(k) : w0;
      const sc = (P / 2 - 16) / a;
      if (!w) return txt(`${fl(F[k])}  no rays`, 0);
      const m = Math.max(1e-3, ...w.opd.map(Math.abs));
      const cell = ((2 * a) / (sys.grid - 1)) * sc + 0.6;
      const mean = w.opd.reduce((s, v) => s + v, 0) / w.opd.length;
      w.pp.forEach((pp, n) => {
        pctx.fillStyle = heat(w.opd[n] / m);
        pctx.fillRect(ox + pp[0] * sc - cell / 2, oy - pp[1] * sc - cell / 2, cell, cell);
      });
      txt(`${fl(F[k])}  PV ${nf(Math.max(...w.opd) - Math.min(...w.opd))} λ`, 0);
      return txt(`RMS ${nf(Math.sqrt(w.opd.reduce((s, v) => s + (v - mean) ** 2, 0) / w.opd.length))} λ`, 1);
    }
    const multi = mode === 'spot' && BW.length; // other wavelengths too: each in its colour
    const ds = [
      ...fis.map(fi => ({ fi, st: samp(fi), col: multi ? lamColor(sys.lambda) : fc(fi) })),
      ...(multi ? BW.flatMap(w => fis.map(fi => ({ fi, st: sampW(w, fi), col: lamColor(w.l) }))) : []),
    ];
    const all = ds.flatMap(d => d.st.map(q => q.xy));
    const spot = mode === 'spot';
    const apR = surf && !spot ? S[i].ap : 0;
    const c = (spot || !apR) && all.length ? Optics.spot(all) : { cx: 0, cy: 0, rms: 0 }; // centre: aperture, else beam
    const A =
      spot && sys.airy && ds[0].st.length > 1
        ? (0.61e-3 * sys.lambda) /
          Optics.na(
            ds[0].st.map(q => q.u),
            ds[0].st[0].n,
          )
        : 0;
    const R = 1.1 * Math.max(A, apR, ...all.map(p => Math.hypot(p[0] - c.cx, p[1] - c.cy))) || 1;
    const sc = (P / 2 - 16) / R;
    pctx.strokeStyle = tok('--line');
    pctx.lineWidth = 1;
    pctx.beginPath();
    pctx.moveTo(ox - P / 2 + 6, oy);
    pctx.lineTo(ox + P / 2 - 6, oy);
    pctx.moveTo(ox, oy - P / 2 + 8);
    pctx.lineTo(ox, oy + P / 2 - 8);
    pctx.stroke();
    if (apR) {
      pctx.strokeStyle = tok('--mute');
      circle(apR, sc, []);
    }
    if (A) {
      pctx.strokeStyle = tok('--ink');
      circle(A, sc, [3, 3]);
    }
    ds.forEach(d => {
      pctx.fillStyle = d.col;
      d.st.forEach(({ xy: p }) =>
        pctx.fillRect(ox + (p[0] - c.cx) * sc - 1, oy - (p[1] - c.cy) * sc - 1, 2, 2),
      );
    });
    txt(spot ? `${fl(F[fis[0]])}  rms ${nf(c.rms)}` : `half-width ${nf(R / 1.1)}`, 0);
    if (multi) {
      let x = k * P + 4; // instead of the Airy radius: the wavelengths (nm), each in its colour; the rms is over all of them
      (sys.lambdas ?? []).forEach(l => {
        const t = String(Math.round(l * 1000));
        pctx.fillStyle = lamColor(l);
        pctx.fillText(t, x, P - 4 + 12);
        x += pctx.measureText(t).width + 6;
      });
      pctx.fillStyle = tok('--mute');
      pctx.fillText('nm', x, P - 4 + 12);
    } else if (A) txt(`Airy r ${nf(A)}`, 1);
    else if (surf && !spot && !apR && Math.hypot(c.cx, c.cy) > 1e-3 * a) txt(`off-centre ${nf(c.cy)}`, 1);
  });
  p.el.hidden = false;
  p.el.classList.toggle('pinned', on);
  place(p);
}

const markRow = () => {
  const h = new Set(pops().map(p => p.tgt?.i));
  [...($('tbl').tBodies[0]?.rows ?? [])].forEach((tr, k) => tr.classList.toggle('hot', h.has(k - 1)));
};

/** Half-width of the drawn beam (all fields) across the probe plane s along segment j. */
const probeHW = (j, s) =>
  Math.max(
    0,
    ...Optics.toPlane(
      T.flat()
        .filter(r => r.length > j + 1)
        .map(r => r[j]),
      at(j, s),
      AX[j].u,
    ).map(q => Math.abs(q.xy[1])),
  );

/** What is under the cursor: an optic ({i}), else a probe plane on the beam ({j, s}), else null. Optics are preferred so
 *  they are easy to grab: one wins within GRAB px of its profile, anywhere inside its mirror blank, inside a lens body within
 *  2·GRAB px of a face (the nearer one), and at any point on the beam within 2·GRAB px of where the beam meets it. Farther
 *  along (a thick lens's middle included), the beam probes. */
const GRAB = 3;
function pick(mx, my) {
  const near = ([ax, ay], [bx, by]) => {
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((mx - ax) * dx + (my - ay) * dy) / (dx * dx + dy * dy || 1)));
    return [Math.hypot(mx - ax - t * dx, my - ay - t * dy), t];
  };
  const dist = P => P.reduce((m, p, j) => (j ? Math.min(m, near(P[j - 1], p)[0]) : m), Infinity);
  const inside = P =>
    P.reduce((c, [x, y], j) => {
      const [u, v] = P[(j || P.length) - 1];
      return y > my !== v > my && mx < ((u - x) * (my - y)) / (v - y) + x ? !c : c;
    }, false);
  const d3 = look3();
  const prof = S.map(s => (d3 ? (s.sl ?? slice3(s)) : s.prof).map(X));
  const ds = prof.map(dist); // (3D: the section drawn)
  let best = null;
  let bd = GRAB;
  ds.forEach((d, i) => {
    if (d < bd) {
      bd = d;
      best = { i };
    }
  });
  if (best) return best;
  for (const [i, s] of S.entries()) {
    // inside a mirror blank (3D: its rim) or a lens body
    if (
      s.mirror &&
      inside(d3 ? View3D.hull(rim3(s).map(X)) : Optics.blank(s, s.y0, s.y1, (s.y1 - s.y0) / 6).map(X))
    )
      return { i };
    if (
      !s.mirror &&
      s.nOut > 1 &&
      S[i + 1] &&
      Math.min(ds[i], ds[i + 1]) < 2 * GRAB &&
      inside([...prof[i], ...prof[i + 1].toReversed()])
    )
      return { i: ds[i] <= ds[i + 1] ? i : i + 1 };
  }
  bd = Infinity;
  S.forEach((_, j) => {
    const l = seg(j);
    const [d, t] = near(X(at(j, 0)), X(at(j, l)));
    if (d < bd) {
      bd = d;
      best = { j, s: t * l };
    }
  });
  if (!best || bd > probeHW(best.j, best.s) * view.s + 6) return null; // within the beam's half-width (+6 px) of the axis
  const k = side ? view.s : Math.hypot(...X(at(best.j, 1)).map((v, n) => v - X(at(best.j, 0))[n])); // px per mm along the axis as drawn
  const px = best.s * k;
  const rest = (seg(best.j) - best.s) * k; // on the beam, close to the optic at either end: that optic
  if (rest < 2 * GRAB && rest <= px) return { i: best.j };
  if (best.j && px < 2 * GRAB) return { i: best.j - 1 };
  return best;
}
