// shapes.js — 3D envelope shapes: rough boxes and cylinders standing for mechanical volumes (an instrument head, a test
// fixture) beside the optics, for a sense of size and placement. Scripts write them into sys.shapes, next to the flat
// rectangles, circles and lines sketched by hand on the layout (src/app/shapes.js); they aren't edited on the canvas.
//
//   { type: 'box', size: [x, y, z] }            a box, centred on its origin
//   { type: 'cylinder', d, L }                  a cylinder of diameter d and length L along its z, centred on its origin
//   common, all optional:
//     p: [x, y, z]        its origin in its frame (mm; default 0)
//     rot: [ax, ay, az]   its own axes turned about the frame's x, then y, then z (degrees, right-handed)
//     at: { row, frame }  the frame: where the axis ray meets row (its name in the configuration shown, or its index; 0 is
//                         the pupil), z along the beam leaving it (frame 'out', the default) or arriving ('in'), x and y the
//                         beam's own (carried along the axis as everywhere in this tool). Without `at`: the world.
//     only: [ids]         the configurations it belongs to (all when absent, or when the design has none)
//     name                its label
// A shape whose row is missing from the configuration shown isn't drawn.

(function engineShapes(Optics) {
  if (typeof module !== 'object') (Optics.SOURCES ??= []).push(String(engineShapes)); // (extensions' worker rebuilds the engine from these)
  ('use strict');
  const { add } = Optics;

  const SOLID = new Set(['box', 'cylinder']);
  const isSolid = sh => SOLID.has(sh?.type);

  /** Rotation (columns: the turned x, y, z axes) about x by ax, then y by ay, then z by az (degrees, right-handed). */
  function turned([ax = 0, ay = 0, az = 0] = []) {
    const [a, b, c] = [ax, ay, az].map(v => (v * Math.PI) / 180);
    const [ca, sa, cb, sb, cc, sc] = [
      Math.cos(a),
      Math.sin(a),
      Math.cos(b),
      Math.sin(b),
      Math.cos(c),
      Math.sin(c),
    ];
    // Rz · Ry · Rx
    return [
      [cc * cb, cc * sb * sa - sc * ca, cc * sb * ca + sc * sa],
      [sc * cb, sc * sb * sa + cc * ca, sc * sb * ca - cc * sa],
      [-sb, cb * sa, cb * ca],
    ];
  }

  /** The frame a shape is placed in, { o, x, y, z } (world), for the rows and built surfaces S of the configuration shown
   *  (id cfg); null when its row isn't there. */
  function shapeFrame(sh, rows, S) {
    const world = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
    if (!sh.at) return world;
    const { row, frame = 'out' } = sh.at;
    const i = Number.isInteger(row) ? row : rows.findIndex((r, k) => k && r.name === row);
    if (i === 0) return world; // the pupil: the design's own frame
    const s = i > 0 ? S[i - 1] : null;
    if (!s?.P) return null;
    const into = frame === 'in';
    const z = into ? s.uIn : s.uOut;
    const x = (into ? s.exIn : s.exOut) ?? [1, 0, 0];
    const y = (into ? s.eyIn : s.eyOut) ?? [0, z[2], -z[1]];
    return { o: s.P, x, y, z };
  }

  /** Whether a shape belongs to configuration cfg (an id; null when the design has no configurations). */
  const inConfig = (sh, cfg) => !sh.only || cfg == null || sh.only.includes(cfg);

  /** A solid shape as world geometry: { c (its centre), pts (corners, or points around its ends), edges ([[a, b], …]) },
   *  or null when it isn't shown in configuration cfg (or its row is missing). */
  function shapeWire(sh, rows, S, cfg = null) {
    if (!isSolid(sh) || !inConfig(sh, cfg)) return null;
    const F = shapeFrame(sh, rows, S);
    if (!F) return null;
    const M = turned(sh.rot);
    const p = sh.p ?? [0, 0, 0];
    const inF = v => add(add(add(F.o, F.x, v[0]), F.y, v[1]), F.z, v[2]); // frame coordinates → world
    const c = inF(p);
    const W = q => inF([0, 1, 2].map(m => p[m] + M[m][0] * q[0] + M[m][1] * q[1] + M[m][2] * q[2]));
    if (sh.type === 'box') {
      const [a, b, h] = (sh.size ?? [0, 0, 0]).map(v => v / 2);
      const pts = [];
      for (const z of [-h, h]) for (const y of [-b, b]) for (const x of [-a, a]) pts.push(W([x, y, z]));
      const edges = [
        [0, 1],
        [2, 3],
        [4, 5],
        [6, 7], // along x
        [0, 2],
        [1, 3],
        [4, 6],
        [5, 7], // along y
        [0, 4],
        [1, 5],
        [2, 6],
        [3, 7], // along z
      ].map(([i, j]) => [pts[i], pts[j]]);
      return { c, pts, edges };
    }
    const r = (sh.d ?? 0) / 2;
    const h = (sh.L ?? 0) / 2;
    const N = 48;
    const ring = z =>
      Array.from({ length: N }, (_, k) =>
        W([r * Math.cos((2 * Math.PI * k) / N), r * Math.sin((2 * Math.PI * k) / N), z]),
      );
    const A = ring(-h);
    const B = ring(h);
    const edges = [
      ...A.map((q, k) => [q, A[(k + 1) % N]]),
      ...B.map((q, k) => [q, B[(k + 1) % N]]),
      ...[0, N / 4, N / 2, (3 * N) / 4].map(k => [A[k], B[k]]),
    ];
    return { c, pts: [...A, ...B], edges };
  }

  /** Convex hull of 2D points (screen), counter-clockwise (Andrew's monotone chain): a solid's silhouette from any side. */
  function hull2(P) {
    const pts = [...P].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (pts.length < 3) return pts;
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [];
    for (const p of pts) {
      while (lo.length >= 2 && cr(lo.at(-2), lo.at(-1), p) <= 0) lo.pop();
      lo.push(p);
    }
    const hi = [];
    for (const p of pts.reverse()) {
      while (hi.length >= 2 && cr(hi.at(-2), hi.at(-1), p) <= 0) hi.pop();
      hi.push(p);
    }
    return [...lo.slice(0, -1), ...hi.slice(0, -1)];
  }

  Object.assign(Optics, { isSolid, shapeFrame, shapeWire, hull2 });
  if (typeof module === 'object') module.exports = Optics;
})(typeof module === 'object' ? require('./configs.js') : globalThis.Optics);
