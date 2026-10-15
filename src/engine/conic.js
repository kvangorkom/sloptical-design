// conic.js — Conic surfaces: sag, ray–conic intersection, off-axis segments, foci, and outlines for drawing.
//
// A surface is described in its own local frame (see trace.js for how frames are placed). Sag:
//   z = c r² / (1 + √(1 − (1 + k) c² r²)),  c = 1/R (R = 0: flat).

(function engineConic(Optics) {
  if (typeof module !== 'object') (Optics.SOURCES ??= []).push(String(engineConic)); // (extensions' worker rebuilds the engine from these)
  ('use strict');
  const { add, dot, toL, toW } = Optics;

  const sag = (c, k, r2) => (c * r2) / (1 + Math.sqrt(1 - (1 + k) * c * c * r2));

  /** Where the line P + τD (local coordinates) meets the conic F = c(x²+y²+Kz²) − 2z = 0, K = 1 + k: the finite roots τ of
   *  Aτ² + 2Bτ + C = 0, each in the numerically stable form (a flat, or a line parallel to a paraboloid's axis, has one).
   *  With `side`, only the root where the line crosses the conic that way (the sign of dF/dτ = 2(Aτ + B)): of a line's two
   *  meetings with a conic, it enters the region F < 0 at one and leaves it at the other. */
  function roots(c, K, P, D, side) {
    const A = c * (D[0] * D[0] + D[1] * D[1] + K * D[2] * D[2]);
    const B = c * (P[0] * D[0] + P[1] * D[1] + K * P[2] * D[2]) - D[2];
    const C = c * (P[0] * P[0] + P[1] * P[1] + K * P[2] * P[2]) - 2 * P[2];
    const disc = B * B - A * C;
    if (disc < 0) return [];
    const q = -(B + (B < 0 ? -1 : 1) * Math.sqrt(disc));
    const ts = q ? [q / A, C / q].filter(isFinite) : A ? [0] : [];
    if (!side || ts.length < 2) return ts;
    const one = ts.filter(τ => Math.sign(A * τ + B) === side);
    return one.length === 1 ? one : ts;
  }

  /** Point on a conic's meridian, local [y, z], where the parent's normal makes angle th (deg) with its axis: 0 at the vertex,
   *  90 where the normal is ⊥ the axis (an ellipsoid's equator, its minor-axis end), on to 180 at an ellipsoid's far vertex.
   *  The sign is the side, like an off-axis distance's. A paraboloid only reaches 90° at infinity and a hyperboloid stops
   *  short of its asymptote's angle: NaN beyond. From the normal (cy, cKz − 1): with w = 1 − |c|Kz', w² (1 + K tan²th) = 1. */
  function atAngle(c, k, th) {
    const a = (th * Math.PI) / 180;
    const C = Math.abs(c);
    const K = 1 + k;
    const co = Math.cos(a);
    const si = Math.sin(a);
    const q = co * co + K * si * si;
    if (!C || !(q > 0) || (co < 0 && !(K > 0))) return [NaN, NaN];
    const w = co / Math.sqrt(q);
    const z = w >= 0 ? (si * si) / (C * q * (1 + w)) : (1 - w) / (C * K);
    return [si / (C * Math.sqrt(q)), Math.sign(c) * z];
  }

  /** The normal angle (deg) of the parent at its local point [y, z] (see atAngle); 0 for a flat. */
  const angleAt = (c, k, y, z) =>
    c ? (Math.atan2(Math.abs(c) * y, 1 - c * (1 + k) * z) * 180) / Math.PI : 0;

  /** Local point of a surface's parent at segment coordinate v (as hit's loc[1]): height v from the segment centre across
   *  the parent's axis; with oa 'angle', v along the segment's tangent, then onto the parent along its normal. */
  function segPoint(s, v) {
    if (!s.seg) {
      const y = s.d + v;
      return [0, y, sag(s.c, s.k, y * y)];
    }
    const P = [0, s.d + v * s.tg[1], s.zM + v * s.tg[2]];
    const ts = roots(s.c, 1 + s.k, P, s.nb);
    return ts.length
      ? add(
          P,
          s.nb,
          ts.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a)),
        )
      : [0, NaN, NaN];
  }

  /** World points along a surface's meridional profile, segment coordinates y0…y1 (see segPoint). Points past the parent's
   *  edge (an ellipsoid's rim seen from the segment) are left out. */
  const profile = (s, y0, y1, m = 48) =>
    Array.from({ length: m }, (_, i) => y0 + ((y1 - y0) * i) / (m - 1))
      .map(y => segPoint(s, y))
      .filter(q => isFinite(q[1]) && isFinite(q[2]))
      .map(q => add(s.V, toW(s, q)));

  /** Geometric foci of a surface's parent conic (world points), nearer the vertex first: F1 = V + ez·R/(1+e) and
   *  F2 = V + ez·R/(1−e), e = √−k. A paraboloid's F1 is its focus R/2 and its F2 is at infinity (null); a sphere's two
   *  coincide at its centre; a hyperboloid's F2 lies behind the vertex (virtual). Flats and oblate ellipsoids (k > 0) have none on the axis. */
  function foci(s) {
    if (!s.c || s.k > 0) return [];
    const e = Math.sqrt(-s.k);
    const at = z => add(s.V, s.ez, z);
    return [at(1 / s.c / (1 + e)), s.k === -1 ? null : at(1 / s.c / (1 - e))];
  }

  /** Local y range (relative to the segment centre) of the whole parent that contains segment y0…y1: symmetric about the
   *  parent axis, so it passes through the vertex; an ellipsoid stops just short of its rim. */
  function parentSpan(s, y0, y1) {
    let Y = Math.max(Math.abs(s.d + y0), Math.abs(s.d + y1));
    if (s.c && s.k > -1) Y = Math.min(Y, 0.9999 / Math.abs(s.c) / Math.sqrt(1 + s.k));
    return [-Y - s.d, Y - s.d];
  }

  /** World points of the parent's whole meridian out to the segment y0…y1, both sides of its vertex (for drawing it): the
   *  points whose normal angle is within the segment's. With oa 'angle' this can be all of an ellipsoid. */
  function parent(s, y0, y1, m = 160) {
    if (!s.seg || !s.c) return profile(s, ...parentSpan(s, y0, y1), m);
    const T = Math.max(
      ...[y0, y1]
        .map(v => {
          const q = segPoint(s, v);
          return Math.abs(angleAt(s.c, s.k, q[1], q[2]));
        })
        .filter(isFinite),
      Math.abs(s.th),
    );
    return Array.from({ length: m }, (_, i) => atAngle(s.c, s.k, -T + (2 * T * i) / (m - 1)))
      .filter(q => isFinite(q[0]) && isFinite(q[1]))
      .map(([y, z]) => add(s.V, toW(s, [0, y, z])));
  }

  /** Mirror blank outline: the front profile closed by a flat back ⊥ the parent axis, `th` behind the segment's highest sag.
   *  An off-axis segment of a powered parent therefore comes out wedged, as if cut from the parent blank. With oa 'angle'
   *  the back is parallel to the segment's tangent plane instead. */
  function blank(s, y0, y1, th) {
    const front = profile(s, y0, y1);
    const L = front.map(p => toL(s, add(p, s.V, -1)));
    const ends = [L.at(-1), L[0]]; // (the ends the parent has)
    if (!front.length) return [];
    if (s.seg) {
      const M = [0, s.d, s.zM];
      const hb = Math.max(...L.map(q => dot(add(q, M, -1), s.nb))) + th;
      return [
        ...front,
        ...ends.map(q => add(s.V, toW(s, add(add(M, s.tg, dot(add(q, M, -1), s.tg)), s.nb, hb)))),
      ];
    }
    const zb = Math.max(...L.map(q => q[2])) + th;
    return [...front, ...ends.map(q => add(s.V, toW(s, [0, q[1], zb])))];
  }

  /** Local point of a surface's parent at segment coordinate v (as segPoint) and x across the meridian (x = 0: segPoint). */
  function surfPoint(s, v, x = 0) {
    if (!x) return segPoint(s, v);
    if (!s.seg) {
      const y = s.d + v;
      return [x, y, sag(s.c, s.k, x * x + y * y)];
    }
    const P = [x, s.d + v * s.tg[1], s.zM + v * s.tg[2]];
    const ts = roots(s.c, 1 + s.k, P, s.nb);
    return ts.length
      ? add(
          P,
          s.nb,
          ts.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a)),
        )
      : [NaN, NaN, NaN];
  }

  const onSurf = (s, pts) =>
    pts
      .map(([x, v]) => surfPoint(s, v, x))
      .filter(q => q.every(isFinite))
      .map(q => add(s.V, toW(s, q)));

  /** World points round a surface's rim: the circle of radius (y1 − y0)/2 about the middle of the segment span y0…y1. */
  const rim = (s, y0, y1, m = 48) => {
    const c = (y0 + y1) / 2;
    const a = (y1 - y0) / 2;
    return onSurf(
      s,
      Array.from({ length: m }, (_, i) => [
        a * Math.cos((2 * Math.PI * i) / m),
        c + a * Math.sin((2 * Math.PI * i) / m),
      ]),
    );
  };

  /** World points along the surface across that circle in local direction w = [wx, wy] (unit; [0, 1] is the meridian). */
  const slice = (s, y0, y1, w, m = 48) => {
    const c = (y0 + y1) / 2;
    const a = (y1 - y0) / 2;
    return onSurf(
      s,
      Array.from({ length: m }, (_, i) => {
        const t = -a + (2 * a * i) / (m - 1);
        return [t * w[0], c + t * w[1]];
      }),
    );
  };

  /** A mirror blank as a solid, for drawing it from any direction: the rim of its face, the rim of its flat back (the face's rim
   *  pushed onto the back: th behind the face's highest sag, ⊥ the parent axis, or parallel to the segment's tangent plane with
   *  oa 'angle', as blank()), and its section through the middle in local direction w (the face's slice closed by the back),
   *  which is blank() itself for w = [0, 1]. World points. */
  function blankSolid(s, y0, y1, th, w = [0, 1], m = 48) {
    const L = p => toL(s, add(p, s.V, -1));
    const W = q => add(s.V, toW(s, q));
    const front = rim(s, y0, y1, m);
    const cut = slice(s, y0, y1, w, m);
    if (!cut.length) return { front, back: [], section: [] };
    const Lf = [...front, ...slice(s, y0, y1, [0, 1], m)].map(L);
    const Lc = cut.map(L);
    let back;
    if (s.seg) {
      const M = [0, s.d, s.zM];
      const hb = Math.max(...Lf.map(q => dot(add(q, M, -1), s.nb))) + th;
      back = q => add(q, s.nb, hb - dot(add(q, M, -1), s.nb));
    } else {
      const zb = Math.max(...Lf.map(q => q[2])) + th;
      back = q => [q[0], q[1], zb];
    }
    return {
      front,
      back: front.map(p => W(back(L(p)))),
      section: [...cut, ...[Lc.at(-1), Lc[0]].map(q => W(back(q)))],
    };
  }

  Object.assign(Optics, {
    sag,
    roots,
    atAngle,
    angleAt,
    segPoint,
    profile,
    foci,
    parentSpan,
    parent,
    blank,
    surfPoint,
    onSurf,
    rim,
    slice,
    blankSolid,
  });
  if (typeof module === 'object') module.exports = Optics;
})(typeof module === 'object' ? require('./vector.js') : globalThis.Optics);
