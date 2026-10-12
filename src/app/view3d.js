// view3d.js — camera and projection math for the 3D views, and the convex hulls the beam is drawn with.
//
// Pure geometry (no DOM), so it is tested with the engine. Uses the vector helpers of the engine (src/engine/vector.js).

(function (View3D, Optics) {
  'use strict';
  const { add, cross, dot, turn, unit } = Optics;

  /** A camera: screen right r and up u (unit, ⊥), looking along −(r × u); persp: perspective about the pivot. Views by name:
   *  side (z right, y up: the planar layout), top (z right, x up: looking down y), front (looking along +z, down the beam). */
  const VIEWS = {
    side: { r: [0, 0, 1], u: [0, 1, 0] },
    other: { r: [0, 0, -1], u: [0, 1, 0] },
    top: { r: [0, 0, 1], u: [1, 0, 0] },
    bottom: { r: [0, 0, 1], u: [-1, 0, 0] },
    front: { r: [-1, 0, 0], u: [0, 1, 0] },
    back: { r: [1, 0, 0], u: [0, 1, 0] },
  }; // (and each from the opposite side)

  const camBack = c => cross(c.r, c.u); // toward the viewer

  /** World point p → screen [x, y] (y down) for camera c and view v = {s (px/mm), ox, oy, c (pivot), D (eye distance, mm)}.
   *  Orthographic: [ox + s·r·p, oy − s·u·p]. Perspective scales offsets from the pivot by D/(D − depth), so the pivot's
   *  depth draws as orthographic; points at or behind the eye are clamped to 20× (they are off screen anyway). */
  function project(c, v, p) {
    if (!c.persp) return [v.ox + v.s * dot(c.r, p), v.oy - v.s * dot(c.u, p)];
    const q = add(p, v.c, -1);
    const z = dot(camBack(c), q);
    const k = z < v.D * 0.95 ? v.D / (v.D - z) : 20;
    return [v.ox + v.s * (dot(c.r, v.c) + k * dot(c.r, q)), v.oy - v.s * (dot(c.u, v.c) + k * dot(c.u, q))];
  }

  /** The world point at screen [x, y] on the plane through ref facing the camera (inverse of project there). */
  function unproject(c, v, [x, y], ref) {
    const [rx, ry] = project(c, v, ref);
    const k = c.persp
      ? (() => {
          const z = dot(camBack(c), add(ref, v.c, -1));
          return z < v.D * 0.95 ? v.D / (v.D - z) : 20;
        })()
      : 1;
    return add(add(ref, c.r, (x - rx) / (v.s * k)), c.u, -(y - ry) / (v.s * k));
  }

  /** Turntable orbit: yaw (deg) about the world's up (default +y), then pitch (deg) about the camera's right, stopping
   *  when looking straight down or up (the up vector never tips past the world's up). */
  function orbit(c, yaw, pitch, up = [0, 1, 0]) {
    const a = (yaw * Math.PI) / 180;
    let r = turn(c.r, up, a);
    let u = turn(c.u, up, a);
    const el = Math.asin(Math.max(-1, Math.min(1, dot(cross(r, u), up))));
    const want = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, el + (pitch * Math.PI) / 180));
    u = turn(u, r, el - want);
    return { ...c, r, u: unit(u), name: null };
  }

  /** Camera a → b by fraction t: the frame turned about the one axis that takes a to b (for animating view changes). */
  function lerpCam(a, b, t) {
    const A = [a.r, a.u, camBack(a)];
    const B = [b.r, b.u, camBack(b)];
    const Q = [0, 1, 2].map(i => [0, 1, 2].map(j => A.reduce((s, f, k) => s + B[k][i] * f[j], 0))); // Q = Bᵀ·A (Q·a = b for each axis)
    const tr = Q[0][0] + Q[1][1] + Q[2][2];
    const ang = Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2)));
    if (ang < 1e-9) return { ...b, r: [...a.r], u: [...a.u] };
    let k = [Q[2][1] - Q[1][2], Q[0][2] - Q[2][0], Q[1][0] - Q[0][1]];
    if (Math.hypot(...k) < 1e-6) {
      const C = [0, 1, 2].map(j => [0, 1, 2].map(i => Q[i][j] + (i === j)));
      k = C.reduce((m, v) => (Math.hypot(...v) > Math.hypot(...m) ? v : m));
    } // a half turn
    k = unit(k);
    return { ...b, r: turn(a.r, k, t * ang), u: turn(a.u, k, t * ang) };
  }

  /** Convex hull of 2D points, wound with a positive Σ(x·y' − x'·y) (Andrew's monotone chain). */
  function hull(P) {
    const p = [...P].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const x = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    if (p.length < 3) return p;
    const lo = [];
    const hi = [];
    for (const q of p) {
      while (lo.length > 1 && x(lo.at(-2), lo.at(-1), q) <= 0) lo.pop();
      lo.push(q);
    }
    for (const q of p.toReversed()) {
      while (hi.length > 1 && x(hi.at(-2), hi.at(-1), q) <= 0) hi.pop();
      hi.push(q);
    }
    return [...lo.slice(0, -1), ...hi.slice(0, -1)];
  }

  /** A beam between consecutive points of its rays as convex pieces (screen points from M), stretch by stretch: their union is
   *  the beam's outline from any direction. Each stretch is cut at `steps` even stations and also where the beam is narrowest,
   *  in space and as drawn (each a least-squares minimum, the rays being straight), so a focus inside a stretch pinches to a
   *  point instead of being bridged by a piece across it. rays: world point lists or null. With `stretch`, only that one (1…).
   *  With `flat` (the rays' points already mapped by M, when M is affine: an orthographic view), stations are interpolated
   *  on the screen instead of being mapped one by one, which is exact and much faster. */
  function beamHulls(rays, M, steps = 24, stretch, flat) {
    const keep = rays.map(Boolean);
    const R = rays.filter(Boolean);
    const F = flat && flat.filter((_, k) => keep[k]);
    const n = Math.min(...R.map(r => r.length));
    const out = [];
    if (!R.length) return out;
    const narrowest = (A, B) => {
      const d = A[0].length;
      const a = Array(d).fill(0);
      const b = Array(d).fill(0); // min over t of Σ|P(t) − mean|²
      A.forEach((p, i) => {
        for (let k = 0; k < d; k++) {
          a[k] += p[k] / A.length;
          b[k] += B[i][k] / A.length;
        }
      });
      let num = 0;
      let den = 0;
      A.forEach((p, i) => {
        for (let k = 0; k < d; k++) {
          const e = p[k] - a[k];
          const g = B[i][k] - p[k] - (b[k] - a[k]);
          num += e * g;
          den += g * g;
        }
      });
      return den > 0 ? -num / den : NaN;
    };
    for (let i = stretch ?? 1; i < (stretch ? stretch + 1 : n); i++) {
      const A = R.map(r => r[i - 1]);
      const B = R.map(r => r[i]);
      const A2 = F ? F.map(r => r[i - 1]) : A.map(M);
      const B2 = F ? F.map(r => r[i]) : B.map(M);
      const at = F
        ? t => A2.map((p, k) => [p[0] + (B2[k][0] - p[0]) * t, p[1] + (B2[k][1] - p[1]) * t])
        : t => (t === 0 ? A2 : t === 1 ? B2 : R.map(r => M(add(r[i - 1], add(r[i], r[i - 1], -1), t))));
      const ts = [
        ...new Set(
          [...Array(steps + 1).keys()]
            .map(k => k / steps)
            .concat([narrowest(A, B), narrowest(A2, B2)].filter(t => t > 0 && t < 1)),
        ),
      ].sort((x, y) => x - y);
      let prev = hull(at(ts[0])); // (each station's outline once: a piece is the hull of two)
      for (const t of ts.slice(1)) {
        const cur = hull(at(t));
        const h = hull([...prev, ...cur]);
        if (h.length > 2) out.push(h);
        prev = cur;
      }
    }
    return out;
  }

  Object.assign(View3D, { VIEWS, camBack, project, unproject, orbit, lerpCam, hull, beamHulls });
})(
  typeof module === 'object' ? module.exports : (globalThis.View3D = {}),
  typeof module === 'object' ? require('../engine/vector.js') : globalThis.Optics,
);
