// vector.js — Vectors, rotations and surface frames.
//
// Plain arrays [x, y, z]. Angles are in degrees unless a name says otherwise.

(function engineVector(Optics) {
  if (typeof module !== 'object') (Optics.SOURCES ??= []).push(String(engineVector)); // (extensions' worker rebuilds the engine from these)
  ('use strict');

  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  const add = (a, b, s = 1) => [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2]];

  const unit = v => {
    const m = Math.hypot(...v);
    return v.map(x => x / m);
  };

  const rot = (v, deg) => {
    const a = (deg * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a); // about x, +z → +y
    return [v[0], c * v[1] + s * v[2], c * v[2] - s * v[1]];
  };

  const toL = (s, v) => [s.ex ? dot(v, s.ex) : v[0], dot(v, s.ey), dot(v, s.ez)]; // world → local (planar: x is shared)

  const toW = (s, L) => add(add(s.ex ? s.ex.map(v => v * L[0]) : [L[0], 0, 0], s.ey, L[1]), s.ez, L[2]); // local → world

  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

  /** v turned by `rad` radians, right-handed, about the unit axis k (Rodrigues). */
  const turn = (v, k, rad) => {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const d = dot(k, v);
    const x = cross(k, v);
    return v.map((w, i) => w * c + x[i] * s + k[i] * d * (1 - c));
  };

  /** The rotation (3×3, acting on column vectors in the incoming frame) of a surface with tilt, tiltY and clock (deg):
   *  Rx(tilt)·Ry(tiltY)·Rz(clock), each as the tool turns: tilt +z → +y, tiltY +z → +x, clock +x → +y. */
  function frameRot(t, y = 0, k = 0) {
    const m = (a, b) => a.map(r => [0, 1, 2].map(j => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j]));
    const cs = d => [Math.cos((d * Math.PI) / 180), Math.sin((d * Math.PI) / 180)];
    const [c1, s1] = cs(t);
    const [c2, s2] = cs(y);
    const [c3, s3] = cs(k);
    return m(
      m(
        [
          [1, 0, 0],
          [0, c1, s1],
          [0, -s1, c1],
        ],
        [
          [c2, 0, s2],
          [0, 1, 0],
          [-s2, 0, c2],
        ],
      ),
      [
        [c3, -s3, 0],
        [s3, c3, 0],
        [0, 0, 1],
      ],
    );
  }

  /** tilt, tiltY, clock (deg) of a rotation R = frameRot(…): of the two sets that give it, the one nearer `prev`, each angle
   *  unwrapped to within 180° of it (a drag or a solve never jumps by 360°). At tiltY = ±90° (gimbal lock) the clock takes
   *  the rest. */
  function euler(R, prev = [0, 0, 0]) {
    const deg = a => (a * 180) / Math.PI;
    const wrap = (a, p) => a + 360 * Math.round((p - a) / 360);
    const t = Math.atan2(R[1][2], R[2][2]);
    const y = Math.atan2(R[0][2], Math.hypot(R[1][2], R[2][2]));
    const one = (tt, yy) => {
      const A = frameRot(deg(tt), deg(yy));
      const k = Math.atan2(
        A[0][1] * R[0][0] + A[1][1] * R[1][0] + A[2][1] * R[2][0],
        A[0][0] * R[0][0] + A[1][0] * R[1][0] + A[2][0] * R[2][0],
      );
      return [deg(tt), deg(yy), deg(k)].map((a, i) => wrap(a, prev[i]));
    };
    const sets = [one(t, y), one(t + Math.PI, Math.PI - y)];
    const cost = e => e.reduce((s, a, i) => s + Math.abs(a - prev[i]), 0);
    return cost(sets[1]) < cost(sets[0]) - 1e-9 ? sets[1] : sets[0];
  }

  /** World vector of local L in the frame with axes fx, fy, fz. */
  const inFrame = (fx, fy, fz, L) => [0, 1, 2].map(i => fx[i] * L[0] + fy[i] * L[1] + fz[i] * L[2]);

  /** Carry the frame (fx, fy) from axis direction u to v: the smallest rotation taking u into v, about the surface's own
   *  x (sx) when v = −u. Within a microradian of a retro-reflection (a caliball, a flat at normal incidence), the turn about
   *  the surface's x first, then the small rest from −u to v: the smallest rotation's axis is round-off there, so two traces
   *  of the same light (the tracer's and an import's) would carry the frame differently. A planar frame (fx = +x, u and v in
   *  y–z) stays exactly planar. Returns [fx, fy]. */
  function carry(fx, fy, u, v, sx = fx) {
    if (fx[0] === 1 && fx[1] === 0 && fx[2] === 0 && u[0] === 0 && v[0] === 0)
      return [
        [1, 0, 0],
        [0, v[2], -v[1]],
      ];
    const k = cross(u, v);
    const s = Math.hypot(...k);
    const c = dot(u, v);
    if (s < 1e-14 && c > 0) return [fx, fy];
    if (s < 1e-6 && c < 0) {
      const a = unit(add(sx, u, -dot(sx, u)));
      const back = [turn(fx, a, Math.PI), turn(fy, a, Math.PI)];
      return s < 1e-14
        ? back
        : carry(
            ...back,
            u.map(x => -x),
            v,
            sx,
          );
    }
    const a = k.map(x => x / s);
    const ang = Math.atan2(s, c);
    const w = unit(v);
    const y = unit(add(turn(fy, a, ang), w, -dot(turn(fy, a, ang), w))); // (kept orthonormal about v: round-off would
    return [cross(y, w), y]; // otherwise grow from surface to surface over a long 3D train)
  }

  Object.assign(Optics, { dot, add, unit, rot, toL, toW, cross, turn, frameRot, euler, inFrame, carry });
})(typeof module === 'object' ? module.exports : (globalThis.Optics = {}));
