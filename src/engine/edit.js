// edit.js — Editing operations on rows: moving, turning and tilting optics while keeping the rest of the design in place.

(function (Optics) {
  'use strict';
  const { add, dot, euler, turn, unit, angleAt, atAngle, sag, build, lstsq, unvary } = Optics;

  /** Drag surface s: its parent conic moves rigidly by D = Q − P (P its current axis hit point), keeping its orientation.
   *  Nothing upstream changes, so the beam stays where it is. The move along the incoming axis goes into the distance in
   *  (rows[s].t) and the move across it into the off-axis distance d: the beam now lands elsewhere on the parent, and the
   *  optic's output (and everything downstream) follows from that. The two are solved together (Newton) so the vertex
   *  moves by exactly D, tilt and pivots included. A flat, or `along`, moves along the axis only. The optic's own focus
   *  locks then re-solve with their other varied values (in applySolves); the drag sets the distance in and off-axis, so a
   *  solve or lock variation on those is removed. Leaves `rows` unchanged; returns the new rows. */
  function moveOptic(rows, s, Q, { along = false } = {}) {
    const R = structuredClone(rows);
    const S0 = build(rows);
    const gap = R[s];
    const me = R[s + 1];
    const u = s ? S0[s - 1].uOut : [0, 0, 1];
    const e = [0, u[2], -u[1]];
    const D = add(Q, S0[s].P, -1);
    const side = !along && !!S0[s].c && !heldD(rows, s + 1); // a lock varying the off-axis distance owns it
    if (side && (D[0] !== 0 || S0[s].ex)) {
      if (gap.solve) delete gap.solve.t;
      unvary(R, s, 't');
      return placeVertex(R, s, add(S0[s].V, D));
    } // 3D
    gap.t += dot(D, u);
    if (gap.solve) delete gap.solve.t;
    unvary(R, s, 't');
    if (!side) return R;
    const target = add(S0[s].V, D);
    const V = () => build(R)[s].V;
    const res = () => {
      const q = add(V(), target, -1);
      return [dot(q, u), dot(q, e)];
    };
    if (me.oa !== 'angle') me.d -= dot(D, e);
    if (me.solve) delete me.solve.d;
    unvary(R, s + 1, 'd'); // first guess: the beam lands D·e lower on the parent
    for (let it = 0, r = res(); it < 30 && Math.hypot(...r) > 1e-12 * (1 + Math.hypot(...target)); it++) {
      const h = 1e-6 * Math.max(1, Math.abs(gap.t));
      const k = 1e-6 * Math.max(1, Math.abs(me.d));
      gap.t += h;
      const a = res().map((v, i) => (v - r[i]) / h);
      gap.t -= h;
      me.d += k;
      const b = res().map((v, i) => (v - r[i]) / k);
      me.d -= k;
      const det = a[0] * b[1] - a[1] * b[0];
      if (!det || !isFinite(det)) break;
      gap.t -= (r[0] * b[1] - r[1] * b[0]) / det;
      me.d -= (a[0] * r[1] - a[1] * r[0]) / det;
      r = res();
    }
    return R;
  }

  /** 3D: put surface s's vertex on `target` (its orientation kept) by its distance in and where the beam lands on the parent,
   *  the off-axis value d and its azimuth (clock). Newton on the distance in and the off-axis vector (a, b) = d·(−sin, cos)(clock),
   *  which is smooth through d = 0, where the azimuth is undefined. Solves and lock variations on those values are removed.
   *  Mutates and returns R. */
  function placeVertex(R, s, target) {
    const gap = R[s];
    const me = R[s + 1];
    const S0 = build(R);
    const q = S0[s];
    const ex = q.ex ?? [1, 0, 0];
    const sign = Math.sign(me.d) || 1;
    const rad = Math.PI / 180;
    for (const k of ['d', 'clock']) {
      if (me.solve) delete me.solve[k];
      unvary(R, s + 1, k);
    }
    const c0 = (me.clock || 0) * rad;
    const X0 = add(
      ex.map(v => v * Math.cos(c0)),
      q.ey,
      -Math.sin(c0),
    );
    const Y0 = add(
      ex.map(v => v * Math.sin(c0)),
      q.ey,
      Math.cos(c0),
    ); // the unclocked x, y
    let ab = [-me.d * Math.sin(c0), me.d * Math.cos(c0)];
    const set = ([a, b]) => {
      const ρ = Math.hypot(a, b);
      if (ρ < 1e-15) {
        me.d = 0;
        return;
      }
      me.d = sign * ρ;
      const c = Math.atan2(-a / me.d, b / me.d) / rad;
      me.clock = c + 360 * Math.round(((me.clock || 0) - c) / 360);
    };
    if (me.oa !== 'angle') {
      const D = add(target, q.V, -1);
      ab = [ab[0] - dot(D, X0), ab[1] - dot(D, Y0)];
    } // first guess: the beam lands that much lower on the parent
    const res = () => add(build(R)[s].V, target, -1);
    const x = () => [gap.t, ...ab];
    const put = v => {
      gap.t = v[0];
      ab = [v[1], v[2]];
      set(ab);
    };
    set(ab);
    let r = res();
    for (let it = 0; it < 30 && Math.hypot(...r) > 1e-12 * (1 + Math.hypot(...target)); it++) {
      const x0 = x();
      const J = [0, 1, 2].map(m => {
        const h = 1e-6 * Math.max(1, Math.abs(x0[m]));
        const v = [...x0];
        v[m] += h;
        put(v);
        const d = res();
        put(x0);
        return d.map((w, i) => (w - r[i]) / h);
      });
      const step = lstsq([0, 1, 2].map(i => [J.map(col => col[i]), -r[i]]));
      if (!step.every(isFinite)) break;
      put(x0.map((v, m) => v + step[m]));
      r = res();
    }
    if (me.clock !== undefined && Math.abs(me.clock) < 1e-12 && !rows3(R)) delete me.clock;
    return R;
  }

  const rows3 = R => R.some(r => r.tiltY || r.clock);

  /** Turn surface s by `deg` degrees, right-handed, about the world axis `axis` through its axis hit point: its frame turns,
   *  expressed back as tilt, tiltY and clock (OS.euler, nearest the current values); the vertex turns with it. A pivot is
   *  dropped (the optic turns about where the beam meets it; tiltOptic keeps pivots). Solves and lock variations on the
   *  angles are removed. Leaves `rows` unchanged; returns the new rows. */
  function turnOptic(rows, s, axis, deg) {
    const R = structuredClone(rows);
    const r = R[s + 1];
    const q = build(rows)[s];
    const k = unit(axis);
    const a = (deg * Math.PI) / 180;
    const F = [q.ex ?? [1, 0, 0], q.ey, q.ez].map(v => turn(v, k, a));
    const Fin = [q.exIn, q.eyIn, q.uIn];
    const [t, y, c] = euler(
      Fin.map(f => F.map(g => dot(f, g))),
      [r.tilt, r.tiltY || 0, r.clock || 0],
    );
    for (const key of ['tilt', 'tiltY', 'clock']) {
      if (r.solve) delete r.solve[key];
      unvary(R, s + 1, key);
    }
    const swung = !!r.pivot;
    const V = add(q.P, turn(add(q.V, q.P, -1), k, a));
    delete r.pivot;
    const snap = v => (Math.abs(v) < 1e-12 ? 0 : v);
    Object.assign(r, { tilt: t });
    if (snap(y) || r.tiltY) r.tiltY = snap(y);
    if (snap(c) || r.clock) r.clock = snap(c);
    return swung ? placeVertex(R, s, V) : R;
  }

  /** Give row ri's off-axis position as a height ('height', mm: the default) or as the parent's normal angle there ('angle',
   *  deg; see atAngle), keeping the geometry. Past an ellipsoid's equator (|angle| ≥ 90°) there is no height for it, and a flat
   *  has no angle: then nothing changes and it returns false. */
  function offAxisAs(rows, ri, mode) {
    const r = rows[ri];
    const c = r.R ? 1 / r.R : 0;
    const now = r.oa === 'angle' ? 'angle' : 'height';
    if (now === mode) return true;
    if (mode === 'angle') {
      const th = angleAt(c, r.k, r.d, sag(c, r.k, r.d * r.d));
      if (!c || !isFinite(th)) return false;
      r.d = th;
      r.oa = 'angle';
      return true;
    }
    const [y] = c ? atAngle(c, r.k, r.d) : [0];
    if (Math.abs(r.d) >= 90 || !isFinite(y)) return false;
    r.d = y;
    delete r.oa;
    return true;
  }

  /** Whether row ri's focus locks vary its off-axis distance (then a drag moves the optic along its incoming axis only:
   *  where the beam lands on the parent is the lock's to choose, together with R, k and whatever else it varies). */
  const heldD = (rows, ri) => {
    const L = rows[ri]?.lock;
    return !!(L && (L.f1 || L.f2) && L.vary?.includes('d'));
  };

  /** Tilt surface s by `by` degrees (CCW) about its pivot (its hit point by default, else its pivot's centre of curvature
   *  or upstream hit point). Nothing else moves; downstream follows the new output axis, and the optic's focus locks then
   *  re-solve with their other varied values. A tilt solve or lock variation is removed. Leaves `rows` unchanged. */
  function tiltOptic(rows, s, by) {
    const R = structuredClone(rows);
    const r = R[s + 1];
    r.tilt += by;
    if (r.solve) delete r.solve.tilt;
    unvary(R, s + 1, 'tilt');
    return R;
  }

  Object.assign(Optics, { moveOptic, placeVertex, rows3, turnOptic, offAxisAs, heldD, tiltOptic });
  if (typeof module === 'object') module.exports = Optics;
})(typeof module === 'object' ? require('./solves.js') : globalThis.Optics);
