// solves.js — Solves and focus locks: values solved so a beam focuses or collimates, and conic foci pinned to points.

(function engineSolves(Optics) {
  if (typeof module !== 'object') (Optics.SOURCES ??= []).push(String(engineSolves)); // (extensions' worker rebuilds the engine from these)
  ('use strict');
  const { add, cross, dot, euler, unit, angleAt, foci, build, is3D, angle, curv, inFocus, lstsq, secant } =
    Optics;

  /** Solves offered for rows[ri][k]: 'focus' (the beam converges on the next surface) and 'collim' (collimated output).
   *  On a distance they act on the next optic's output; on R, k, d, tilt or n, on this optic's own output. */
  function solvesFor(rows, ri, k) {
    if (!ri) return []; // the pupil
    const more = ri < rows.length - 1; // a surface follows
    if (k === 't') return more ? ['focus', 'collim'] : [];
    const optic =
      ['R', 'k', 'd', 'tilt', 'tiltY', 'clock', 'n'].includes(k) &&
      !(k === 'n' && rows[ri].type === 'mirror');
    if (!optic) return [];
    return more ? ['focus', 'collim'] : ['collim'];
  }

  /** Apply every row's solves ({key: {type}}) and focus locks in row order, mutating rows. Each is a secant root find on the meridional
   *  paraxial curvature of the on-axis beam; R is solved as curvature so it can pass through flat. Returns the set of
   *  `${ri}${key}` with no solution (value left unchanged). Solves run one after another, so several can fight. */
  function applySolves(rows) {
    unloop(rows);
    rooms(rows);
    const a = rows[0].ap;
    const h = a * 1e-4;
    // Passes repeat until nothing changes, so each solve and lock sees the others' final values (e.g. a lock that moves R or
    // tilt re-runs the focus solve on the distance out). Solves that genuinely fight stop after 8 passes.
    let fails;
    let before;
    for (let pass = 0; pass < 8 && before !== (before = JSON.stringify(rows)); pass++) {
      fails = new Set();
      rows.forEach((r, ri) => {
        if (r.room && !placeFlat(rows, ri)) fails.add(ri + 'room'); // a flat held in the room: placed on the beam as it now runs
        for (const [k, sv] of Object.entries(r.solve ?? {})) {
          if (!solvesFor(rows, ri, k).includes(sv.type)) {
            delete r.solve[k];
            continue;
          }
          const i = ri - 1;
          const v0 = r[k] ?? 0;
          const inv = k === 'R';
          const x0 = inv ? v0 && 1 / v0 : v0;
          const set = x => (r[k] = inv ? x && 1 / x : x);
          const g = S =>
            sv.type === 'focus' ? 1 - r.t * curv(S, i, h) : a * curv(S, k === 't' ? i + 1 : i, h);
          let x = secant(x => (set(x), g(build(rows))), x0, Math.abs(x0) * 1e-3 || (inv ? 1e-6 : 1e-3));
          if (!inv && Math.abs(x - x0) > 1e6 * Math.max(1, a)) x = NaN; // "focus at infinity" and the like: no usable solution
          if (isFinite(x) && x !== x0) set(x);
          else r[k] = v0; // unchanged when already solved: stable undo snapshots
          if (!isFinite(x)) fails.add(ri + k);
        }
        if (r.lock && (r.lock.f1 || r.lock.f2)) {
          r.lock.vary = (r.lock.vary ?? []).filter(
            k => VARY.includes(k) && !(k === 'tin' ? rows[ri - 1].solve?.t : r.solve?.[k]),
          );
          if (!holdFoci(rows, ri)) fails.add(ri + 'lock');
        }
      });
    }
    if (before !== JSON.stringify(rows)) fails.add('fight'); // still changing after 8 passes: solves or locks fighting
    return fails;
  }

  // ── Images held in the room. A curved mirror that images perfectly has two real choices: where it sits on the beam,
  // and where it images (a point, or a direction when the output is collimated). Its shape (R, k, off-axis, tilt) follows
  // from those. An image is either held (a lock pins that focus to a point: the mirror reshapes to keep it) or free (only
  // the focus on the incoming beam is pinned and the shape is kept: the mirror re-aims, and the image goes where it goes).
  // A held point is kept where the light really converges, after any flats on the way ({at: 'pt', p, space: j}: in the
  // space after surface j); those flats are then held in the room too (row.room), so the beam's hit point slides across
  // them as the mirror re-aims, and the mirror's target is simply the point seen in them.

  /** Pins to a row downstream go round in a loop (where that row is depends on this one), leaving the shape free to drift
   *  (unless the lock varies the distance out, which brings that row to the focus instead):
   *  each becomes a point held where it is now, and a plain plane there gets a focus solve on its distance in, so it stays
   *  on the image. Mutates rows. */
  function unloop(rows) {
    let S = null;
    rows.forEach((r, ri) => {
      for (const k of ['f1', 'f2']) {
        const t = r.lock?.[k];
        if (!t || !Number.isInteger(t.at) || t.at <= ri || !rows[t.at] || r.lock.vary?.includes('t'))
          continue; // (varying its distance out brings the row to the focus: no loop)
        S ??= build(rows);
        const Q = lockPoint(S, t);
        if (!Q) {
          delete r.lock[k];
          continue;
        }
        const flat2 = Math.abs(Q[0]) <= 1e-12 * (1 + Math.hypot(...Q));
        r.lock[k] = { at: 'pt', p: flat2 ? [Q[1], Q[2]] : Q, space: t.at - 2 };
        const pr = rows[t.at - 1];
        const tr = rows[t.at];
        if (!t.f && tr.type !== 'mirror' && !tr.R && !pr.solve?.t && !varies(rows, t.at - 1, 't'))
          (pr.solve ??= {}).t = { type: 'focus' };
      }
    });
  }

  /** The flats each held point is seen through are held in the room (row.room: a plane {p, n} and the distance in and tilt
   *  it last gave); others aren't. A held flat whose distance in or tilt was edited is held where the edit put it. */
  function rooms(rows) {
    const want = new Set();
    rows.forEach((r, ri) => {
      for (const k of ['f1', 'f2']) {
        const t = r.lock?.[k];
        if (t?.at === 'pt' && Number.isInteger(t.space))
          for (let rj = ri + 1; rj <= t.space + 1 && rj < rows.length; rj++)
            if (rows[rj].type === 'mirror' && !rows[rj].R) want.add(rj);
      }
    });
    let S = null;
    rows.forEach((r, ri) => {
      if (!want.has(ri)) return void delete r.room;
      const A = r.room;
      if (A && rows[ri - 1].t === A.t && (r.tilt ?? 0) === A.tilt && (r.tiltY ?? 0) === A.tiltY) return;
      S ??= build(rows);
      const q = S[ri - 1];
      delete r.pivot;
      if (rows[ri - 1].solve) delete rows[ri - 1].solve.t;
      unvary(rows, ri - 1, 't');
      unvary(rows, ri, 'tilt');
      r.room = { p: [...q.P], n: [...q.ez], t: rows[ri - 1].t, tilt: r.tilt ?? 0, tiltY: r.tiltY ?? 0 };
    });
  }

  /** Place held flat rows[ri] on the beam as it now arrives: its distance in where the beam meets its room plane, and its
   *  tilt so its normal is the room plane's. False if the beam can't reach the plane. */
  function placeFlat(rows, ri) {
    const r = rows[ri];
    const A = r.room;
    let S = build(rows);
    const u = ri > 1 ? S[ri - 2].uOut : [0, 0, 1];
    const O = ri > 1 ? S[ri - 2].P : [0, 0, 0];
    const un = dot(u, A.n);
    const t = Math.abs(un) > 1e-9 ? dot(add(A.p, O, -1), A.n) / un : NaN;
    if (!(t > 0)) return false;
    rows[ri - 1].t = t;
    S = build(rows);
    const q = S[ri - 1];
    const n = dot(A.n, q.ez) < 0 ? A.n.map(v => -v) : A.n;
    if (is3D(rows)) {
      const e = add(q.ey, n, -dot(q.ey, n));
      const m = Math.hypot(...e);
      const ey = m > 1e-12 ? e.map(v => v / m) : unit(cross(n, q.exIn));
      const F = [cross(ey, n), ey, n];
      const [tl, ty, cl] = euler(
        [q.exIn, q.eyIn, q.uIn].map(f => F.map(g => dot(f, g))),
        [r.tilt ?? 0, r.tiltY || 0, r.clock || 0],
      );
      r.tilt = tl;
      if (ty || r.tiltY) r.tiltY = ty;
      if (cl || r.clock) r.clock = cl;
    } else {
      const cur = r.tilt ?? 0;
      r.tilt = cur + ((((angle(n) - angle(u) - cur) % 360) + 540) % 360) - 180;
    }
    Object.assign(A, { t: rows[ri - 1].t, tilt: r.tilt ?? 0, tiltY: r.tiltY ?? 0 });
    return true;
  }

  /** The values a perfectly imaging mirror's lock varies so its pins fix them exactly (no direction left free to drift).
   *  Image held (a point, or a direction for a collimated output): R, k, off-axis and tilt (3D: tilt y, clock), all its
   *  shape; in a collimated beam a paraboloid facing it (k −1, tilt 0 kept), R and off-axis. Image free: its pose only, so
   *  it re-aims to keep the incoming focus and keeps its shape; in a collimated beam just its tilt (it may slide across). */
  function stigVary(rows, ri) {
    const L = rows[ri].lock ?? {};
    const three = is3D(rows);
    const collIn = !inFocus(build(rows), ri - 1);
    const held = [L.f1, L.f2].some(t => t && (t.at === 'pt' || (t.at === 'inf' && (t.u || t.ride))));
    if (held)
      return collIn
        ? ['R', 'd', ...(three ? ['clock'] : [])]
        : ['R', 'k', 'd', 'tilt', ...(three ? ['tiltY', 'clock'] : [])];
    return collIn ? ['tilt', ...(three ? ['tiltY'] : [])] : ['d', 'tilt', ...(three ? ['tiltY'] : [])];
  }

  /** A riding image ({at: 'pt' | 'inf', ride: [a, b, c]}): it keeps its place relative to the mirror, a·(the beam's
   *  incoming direction) + b·(its y) + c·(its x) from where the beam hits it (for 'inf', that direction). So it moves with
   *  the mirror wherever the beam takes it, and a drag or turn of the mirror carries it along (moveOptic, turnOptic). */
  const rideFrame = s => [s.uIn, s.eyIn, s.exIn];
  function fromRide(S, i, r) {
    const s = S[i];
    const [u, y, x] = rideFrame(s);
    return add(add(add(s.P, u, r[0]), y, r[1]), x, r[2] ?? 0);
  }
  /** World point Q (in mirror i's own space) as riding offsets. */
  function toRide(S, i, Q) {
    const s = S[i];
    const q = add(Q, s.P, -1);
    const [u, y, x] = rideFrame(s);
    const r = [dot(q, u), dot(q, y), dot(q, x)];
    return Math.abs(r[2]) > 1e-12 * (1 + Math.hypot(...r)) ? r : [r[0], r[1]];
  }

  /** Where the image F of curved mirror i (a point in its own space) really is: seen in the flats the light meets before it
   *  converges there. Returns {p, space} (space: the surface after which it lies; i when no flat comes first, or the image
   *  is virtual). */
  function realImage(S, i, F) {
    const s = S[i];
    let Q = F;
    let space = i;
    const L = Math.hypot(...add(F, s.P, -1));
    if (dot(add(F, s.P, -1), s.uOut) > 0)
      for (let j = i + 1, run = 0; j < S.length; j++) {
        const m = S[j];
        run += Math.hypot(...add(m.P, S[j - 1].P, -1));
        if (!(m.mirror && !m.c) || run >= L) break;
        Q = unfold(S, Q, [m]);
        space = j;
      }
    return { p: Q, space };
  }

  // Focus locks: row.lock = { f1, f2, vary }. f1/f2 pin that focus of the row's parent conic (see foci) to a target point:
  // {at: 'src'} the beam's source focus, {at: 0} the pupil centre, {at: ri} row ri's axis hit point, {at: ri, f: 1|2} a focus
  // of row ri, {at: 'in'} the focus of the beam arriving at this surface (wherever upstream puts it: the stigmatic conjugate),
  // {at: 'pt', p: [y, z]} a free point in the layout (in this surface's own space: dragged in the view), or {at: 'inf'}
  // infinity (F2 only: a paraboloid, k = −1, one equation). vary lists the row's values that may change to hold them: R (solved as curvature), k, d, tilt, t (the
  // distance out) and tin (the distance in, i.e. the previous row's t). Each pinned focus is two equations (y and z).
  const VARY = ['R', 'k', 'd', 'tilt', 't', 'tin', 'tiltY', 'clock'];

  const vget = (rows, ri, k) =>
    k === 'tin' ? rows[ri - 1].t : k === 'R' ? rows[ri].R && 1 / rows[ri].R : (rows[ri][k] ?? 0);

  const vset = (rows, ri, k, x) => {
    if (k === 'tin') rows[ri - 1].t = x;
    else rows[ri][k] = k === 'R' ? x && 1 / x : x;
  };

  /** Whether rows[ri][k] is held by a focus lock (a distance counts when the next row varies it as its distance in). */
  const varies = (rows, ri, k) =>
    !!rows[ri]?.lock?.vary?.includes(k) || (k === 't' && !!rows[ri + 1]?.lock?.vary?.includes('tin'));

  /** Stop rows[ri][k] from varying for any lock. */
  const unvary = (rows, ri, k) => {
    const L = rows[ri]?.lock;
    const N = rows[ri + 1]?.lock;
    if (L?.vary) L.vary = L.vary.filter(v => v !== k);
    if (k === 't' && N?.vary) N.vary = N.vary.filter(v => v !== 'tin');
  };

  /** A lock target as a world point (null if it doesn't exist, e.g. a paraboloid's F2 or a source when collimated).
   *  Seen from surface i (0-based; the surface whose focus is pinned), the target is where it appears in that surface's
   *  space: folded by every flat mirror between them. A fold flat between a focus and an OAP makes the OAP see the focus's
   *  mirror image, so that is where its F1 must go to collimate the beam. Without i, the target's own position. */
  function lockPoint(S, tg, i) {
    if (!tg || tg.at === 'inf') return null;
    let Q;
    let j; // the point, and the surface whose space it is in (−1: object space)
    if (tg.at === 'pt' && tg.ride) return i === undefined ? null : fromRide(S, i, tg.ride); // riding with the mirror
    if (tg.at === 'pt') {
      Q = tg.p.length === 3 ? [...tg.p] : [0, tg.p[0], tg.p[1]];
      if (!Number.isInteger(tg.space) || i === undefined || tg.space <= i) return Q; // in the surface's own space
      return unfold(S, Q, S.slice(i + 1, tg.space + 1).reverse());
    } // a point held where the light really converges: after the flats between, so it's seen through them
    if (tg.at === 'in') {
      if (i === undefined) return null;
      return inFocus(S, i);
    }
    if (tg.at === 'src') {
      if (!S.beam) return null;
      Q = [0, 0, S.beam];
      j = -1;
    } else if (tg.at === 0) {
      Q = [0, 0, 0];
      j = -1;
    } else {
      const s = S[tg.at - 1];
      if (!s) return null;
      Q = tg.f ? (foci(s)[tg.f - 1] ?? null) : s.P;
      j = tg.at - 1;
      if (!Q) return null;
    }
    if (i === undefined || j === i) return Q;
    const between = j < i ? S.slice(j + 1, i) : S.slice(i + 1, j).reverse(); // in the order light (or its reverse) meets them
    return unfold(S, Q, between);
  }
  /** Point Q reflected in each flat mirror of `flats` in turn (a flat held in the room by its room plane). */
  function unfold(S, Q, flats) {
    for (const m of flats)
      if (m.mirror && !m.c) {
        const [V, n] = m.room ? [m.room.p, m.room.n] : [m.V, m.ez];
        Q = add(Q, n, -2 * dot(add(Q, V, -1), n));
      }
    return Q;
  }

  /** Residuals (mm) of row ri's locks: focus − target (as seen from the surface), y and z, for each pinned focus. NaN where either is missing.
   *  F2 at infinity is one residual, (k + 1) scaled by the radius. */
  function lockRes(rows, ri) {
    const S = build(rows);
    const F = foci(S[ri - 1]);
    const L = rows[ri].lock;
    const r = [];
    const three = is3D(rows); // (3D: the x residual too)
    for (const n of [1, 2]) {
      if (!L[`f${n}`]) continue;
      if (L[`f${n}`].at === 'inf') {
        // a paraboloid (k = −1) whose axis lies along the collimated beam: the one arriving (then it is the object at
        // infinity), or a direction held for the beam leaving (u, in the surface's own space). A paraboloid at an angle to
        // a collimated beam doesn't image it to a point, so the axis is part of the condition, not just k.
        const s = S[ri - 1];
        const sc = s.c ? 1 / Math.abs(s.c) : NaN;
        r.push(s.c ? (s.k + 1) * sc : NaN);
        const tg = L[`f${n}`];
        const u = tg.ride
          ? add(fromRide(S, ri - 1, tg.ride), s.P, -1)
          : (tg.u ?? (inFocus(S, ri - 1) ? null : ri > 1 ? S[ri - 2].uOut : [0, 0, 1]));
        if (u) {
          const x = cross(s.ez, u.length === 3 ? u : [0, ...u]);
          r.push(...(three ? x : [x[0]]).map(v => v * sc));
        }
        continue;
      }
      const Q = lockPoint(S, L[`f${n}`], ri - 1);
      const f = F[n - 1];
      r.push(
        ...(Q && f
          ? three
            ? [f[0] - Q[0], f[1] - Q[1], f[2] - Q[2]]
            : [f[1] - Q[1], f[2] - Q[2]]
          : three
            ? [NaN, NaN, NaN]
            : [NaN, NaN]),
      );
    }
    return r;
  }

  /** Jacobian columns of lockRes by central differences, one per key, each per unit of the value (R: of curvature). */
  function lockJac(rows, ri, keys) {
    return keys.map(k => {
      const x = vget(rows, ri, k);
      const h =
        k === 'R'
          ? 1e-7 * Math.max(Math.abs(x), 1e-6)
          : k === 'k'
            ? 1e-7 * Math.max(1, Math.abs(x))
            : 1e-6 * Math.max(1, Math.abs(x));
      vset(rows, ri, k, x + h);
      const a = lockRes(rows, ri);
      vset(rows, ri, k, x - h);
      const b = lockRes(rows, ri);
      vset(rows, ri, k, x);
      return a.map((v, i) => (v - b[i]) / (2 * h));
    });
  }

  /** Hold row ri's pinned foci by varying lock.vary: Levenberg–Marquardt on lockRes. With more values than the pins need,
   *  the damping keeps each step small in every direction, so the values change as little as possible (from where they are). Leaves the values alone when the locks
   *  already hold (stable undo snapshots). On failure (no exact solution with these values) restores them and returns false. */
  function holdFoci(rows, ri) {
    const keys = rows[ri].lock.vary;
    const norm = r => Math.hypot(...r);
    let r = lockRes(rows, ri);
    let f = norm(r);
    const size = Math.max(1, ...build(rows).flatMap(s => s.P.map(Math.abs)));
    const tol = 1e-11 * size;
    const ok = () => f < 1e-8 * size;
    if (!keys.length || f < tol) return ok();
    const before = structuredClone(rows[ri]);
    const undo = () => {
      for (const k of Object.keys(rows[ri])) if (!(k in before)) delete rows[ri][k];
      Object.assign(rows[ri], before);
    };
    if (conjugateMirror(rows, ri)) {
      r = lockRes(rows, ri);
      f = norm(r);
      if (f < tol) return true;
    } // both foci on points: solved outright
    const x0 = keys.map(k => vget(rows, ri, k));
    const set = x => keys.forEach((k, i) => vset(rows, ri, k, x[i]));
    let x = x0;
    let λ = 1e-3;
    for (let it = 0; it < 80 && f > tol; it++) {
      const J = lockJac(rows, ri, keys);
      const A = J.map(a => J.map(b => dot2(a, b)));
      let better = false;
      for (let tr = 0; tr < 14 && !better; tr++, λ *= 8) {
        // damped normal equations as least squares over augmented rows
        const eq = [
          ...r.map((v, i) => [J.map(c => c[i]), -v]),
          ...keys.map((_, j) => [keys.map((_, m) => (m === j ? Math.sqrt(λ * (A[j][j] || 1e-12)) : 0)), 0]),
        ];
        const xn = lstsq(eq).map((d, j) => x[j] + d);
        set(xn);
        const rn = lockRes(rows, ri);
        const fn = norm(rn);
        if (fn < f) {
          [x, r, f, better] = [xn, rn, fn, true];
          λ = Math.max(λ / 64, 1e-9);
        } // (a floor: with more values than needed, the smallest step)
      }
      if (!better) break;
    }
    if (ok()) {
      set(x);
      return true;
    }
    undo();
    return false;
  }

  /** A mirror with both foci pinned to points, varying R, k, off-axis and tilt (the stigmatic pair), solved outright: the conic
   *  with those foci through the axis hit point P (which none of these move) is an ellipse when the beam really diverges from
   *  F1 and converges to F2, or neither, and a hyperbola when one of them is virtual (2a = r1 + r2, or |r1 − r2|). Whether the
   *  image is real is kept from the current layout (the outgoing beam heading for F2), so a drag stays on one branch; when P
   *  lies on the hyperbola's branch about F2, the two pins swap (F1 is the focus nearer the vertex). The off-axis becomes a
   *  normal angle (oa 'angle'), so the segment can sit anywhere on an ellipse. From degenerate starts (a sphere, F1 = F2) this
   *  is what least squares can't do: the parent axis has to turn to wherever F2 goes. Returns false (nothing changed) when it
   *  doesn't apply (a pivot, a refracting surface, a point at infinity or on P). */
  function conjugateMirror(rows, ri) {
    const r = rows[ri];
    const L = r.lock;
    const vary = L?.vary ?? [];
    const three = is3D(rows); // 3D: the pose takes tiltY and clock too
    if (
      r.type !== 'mirror' ||
      r.pivot ||
      !L.f1 ||
      !L.f2 ||
      !['R', 'k', 'd', 'tilt', ...(three ? ['tiltY', 'clock'] : [])].every(k => vary.includes(k))
    )
      return false;
    const S = build(rows);
    const s = S[ri - 1];
    const P = s.P;
    const u = ri > 1 ? S[ri - 2].uOut : [0, 0, 1];
    const A = lockPoint(S, L.f1, ri - 1);
    const B = lockPoint(S, L.f2, ri - 1);
    if (!A || !B || ![...A, ...B, ...P].every(isFinite)) return false;
    const r1 = Math.hypot(...add(P, A, -1));
    const r2 = Math.hypot(...add(P, B, -1));
    const size = Math.max(1, r1, r2);
    if (r1 < 1e-9 * size || r2 < 1e-9 * size) return false;
    const real1 = dot(add(P, A, -1), u) > 0;
    const real2 = dot(s.uOut, add(B, P, -1)) > 0 || Math.hypot(...add(A, B, -1)) < 1e-9 * size;
    const ell = real1 === real2;
    const a = ell ? (r1 + r2) / 2 : Math.abs(r1 - r2) / 2;
    let [F1, F2] = [A, B];
    if (!ell && r1 > r2) {
      [F1, F2] = [B, A];
      [L.f1, L.f2] = [L.f2, L.f1];
    } // P is on the branch about F2: it becomes the nearer focus
    const D = add(F2, F1, -1);
    const c = Math.hypot(...D) / 2;
    const C = add(F1, D, 0.5);
    const e = c / a;
    if (!(a > 0) || Math.abs(e - 1) < 1e-9) return false;
    const eh = c ? D.map(v => v / (2 * c)) : u.map(v => -v); // F1 → F2 (a sphere: its axis along the incoming beam, reversed)
    const V = add(C, eh, -a);
    const R = ell ? a * (1 - e * e) : a * (e * e - 1);
    const ez0 = ell ? eh : eh.map(v => -v);
    if (three) {
      // the frame: z the parent axis, y toward P; of the 4 ways to write it, the nearest
      const Fin = [s.exIn, s.eyIn, s.uIn];
      const prev = [r.tilt, r.tiltY || 0, r.clock || 0];
      const q = add(P, V, -1);
      const k = -e * e;
      const best = [
        [R, ez0],
        [-R, ez0.map(v => -v)],
      ]
        .flatMap(([Rr, ez]) => {
          const w = add(q, ez, -dot(q, ez));
          const m = Math.hypot(...w);
          const ey0 = m > 1e-12 * size ? w.map(v => v / m) : unit(add(s.ey, ez, -dot(s.ey, ez)));
          return [1, -1].map(sg => {
            const ey = ey0.map(v => sg * v);
            const F = [cross(ey, ez), ey, ez];
            const ang = euler(
              Fin.map(f => F.map(g => dot(f, g))),
              prev,
            );
            return {
              Rr,
              ang,
              th: angleAt(1 / Rr, k, dot(q, ey), dot(q, ez)),
              cost: ang.reduce((t, x, i) => t + Math.abs(x - prev[i]), 0),
            };
          });
        })
        .filter(o => isFinite(o.th))
        .sort((a, b) => a.cost - b.cost)[0];
      if (!best) return false;
      const [tilt, tiltY, clock] = best.ang;
      const z = v => (Math.abs(v) < 1e-12 ? 0 : v);
      Object.assign(r, { R: best.Rr, k, tilt, tiltY: z(tiltY), clock: z(clock), d: best.th, oa: 'angle' });
      return true;
    }
    const cur = r.tilt;
    const opts = [
      [R, ez0],
      [-R, ez0.map(v => -v)],
    ].map(([Rr, ez]) => {
      // two ways to write it: keep the tilt nearer the current
      const tilt = cur + ((((angle(ez) - angle(u) - cur) % 360) + 540) % 360) - 180;
      return { Rr, ez, tilt, V };
    });
    const o = Math.abs(opts[0].tilt - cur) <= Math.abs(opts[1].tilt - cur) ? opts[0] : opts[1];
    const ey = [0, o.ez[2], -o.ez[1]];
    const q = add(P, o.V, -1);
    const k = -e * e;
    const th = angleAt(1 / o.Rr, k, dot(q, ey), dot(q, o.ez));
    if (!isFinite(th)) return false;
    Object.assign(r, { R: o.Rr, k, tilt: o.tilt, d: th, oa: 'angle' });
    return true;
  }

  const dot2 = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);

  /** Which of row ri's values may vary together to hold its locks: every one that can move a pinned focus at all (keep);
   *  zero lists those that can't. Values that move the foci the same way as others already listed (Gram–Schmidt on the
   *  normalised Jacobian columns, in the priority order `keys`, newest first) are still kept but also listed in spare: with
   *  more values than the pins need (R, k and off-axis with one focus pinned, say), holdFoci makes the smallest change that
   *  holds them, so they all follow a drag together. With no focus pinned, everything is kept. Returns {keep, zero, spare}. */
  function varyPick(rows, ri, keys) {
    const R = structuredClone(rows);
    const L = R[ri].lock;
    if (!L?.f1 && !L?.f2) return { keep: keys, zero: [], spare: [] };
    const basis = [];
    const keep = [];
    const zero = [];
    const spare = [];
    lockJac(R, ri, keys).forEach((c, j) => {
      const scale =
        keys[j] === 'R' ? 1e-2 * Math.max(Math.abs(vget(R, ri, 'R')), 1e-4) : keys[j] === 'k' ? 0.1 : 1; // a typical change
      let v = c.map(x => (isFinite(x) ? x * scale : 0));
      let m = Math.hypot(...v);
      if (m < 1e-7) return zero.push(keys[j]);
      v = v.map(x => x / m);
      for (const b of basis) {
        const d = dot2(v, b);
        v = v.map((x, i) => x - d * b[i]);
      }
      if ((m = Math.hypot(...v)) > 1e-4) basis.push(v.map(x => x / m));
      else spare.push(keys[j]);
      keep.push(keys[j]);
    });
    return { keep, zero, spare };
  }

  Object.assign(Optics, {
    solvesFor,
    applySolves,
    VARY,
    vget,
    vset,
    varies,
    unvary,
    lockPoint,
    lockRes,
    lockJac,
    holdFoci,
    conjugateMirror,
    dot2,
    varyPick,
    unloop,
    rooms,
    placeFlat,
    stigVary,
    realImage,
    unfold,
    fromRide,
    toRide,
  });
  if (typeof module === 'object') module.exports = Optics;
})(typeof module === 'object' ? require('./analysis.js') : globalThis.Optics);
