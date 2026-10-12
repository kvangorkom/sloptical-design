// solves.js — Solves and focus locks: values solved so a beam focuses or collimates, and conic foci pinned to points.

(function (Optics) {
  'use strict';
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
    const a = rows[0].ap;
    const h = a * 1e-4;
    // Passes repeat until nothing changes, so each solve and lock sees the others' final values (e.g. a lock that moves R or
    // tilt re-runs the focus solve on the distance out). Solves that genuinely fight stop after 8 passes.
    let fails;
    let before;
    for (let pass = 0; pass < 8 && before !== (before = JSON.stringify(rows)); pass++) {
      fails = new Set();
      rows.forEach((r, ri) => {
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
    if (tg.at === 'pt') return tg.p.length === 3 ? [...tg.p] : [0, tg.p[0], tg.p[1]];
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
    for (const m of between)
      if (m.mirror && !m.c) {
        const n = m.ez;
        const w = dot(add(Q, m.V, -1), n);
        Q = add(Q, n, -2 * w);
      } // reflect in the flat
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
        const s = S[ri - 1];
        r.push(s.c ? (s.k + 1) / Math.abs(s.c) : NaN);
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
  });
  if (typeof module === 'object') module.exports = Optics;
})(typeof module === 'object' ? require('./analysis.js') : globalThis.Optics);
