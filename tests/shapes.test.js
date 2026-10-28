// 3D envelope shapes (src/engine/shapes.js): boxes and cylinders in the world or riding on a surface's beam frame, per
// configuration, and the silhouette hull they are drawn with. Run: node --test
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const O = require('../src/engine');

const surf = o => ({ name: '', type: 'refract', R: 0, k: 0, d: 0, tilt: 0, t: 0, n: 1, ap: 0, ...o });
const mirror = o => surf({ type: 'mirror', ...o });
const full = rows => rows.map((r, i) => (i ? surf(r) : { R: 0, ...r }));
const near = (a, b, tol, msg = '') =>
  assert.ok(Math.abs(a - b) <= tol, `${msg} got ${a}, expected ${b} ± ${tol}`);
const nearV = (a, b, tol, msg = '') => near(Math.hypot(...O.add(a, b, -1)), 0, tol, msg);
const span = (pts, k) => Math.max(...pts.map(p => p[k])) - Math.min(...pts.map(p => p[k]));

// a paraboloid focusing a collimated beam, 3D (rolled), then a plane at its focus
const rows = full([
  { t: 100, ap: 10 },
  mirror({ name: 'OAP', R: -400, k: -1, d: 50, tilt: 4, tiltY: 9, clock: 30, t: 203.125 }),
  { name: 'Focus' },
]);
const S = O.build(rows);

describe('envelope shapes', () => {
  test('a box in the world: its corners, edges and centre', () => {
    const w = O.shapeWire({ type: 'box', size: [10, 20, 30], p: [1, 2, 3] }, rows, S);
    assert.equal(w.pts.length, 8);
    assert.equal(w.edges.length, 12);
    nearV(w.c, [1, 2, 3], 1e-12, 'centre');
    near(span(w.pts, 0), 10, 1e-12, 'x');
    near(span(w.pts, 1), 20, 1e-12, 'y');
    near(span(w.pts, 2), 30, 1e-12, 'z');
    for (const [a, b] of w.edges)
      assert.ok([10, 20, 30].some(L => Math.abs(Math.hypot(...O.add(a, b, -1)) - L) < 1e-9));
  });

  test('rot turns the box about its own centre: 90° about z swaps its x and y', () => {
    const w = O.shapeWire({ type: 'box', size: [10, 20, 30], p: [5, 0, 0], rot: [0, 0, 90] }, rows, S);
    nearV(w.c, [5, 0, 0], 1e-12, 'centre stays');
    near(span(w.pts, 0), 20, 1e-9, 'x');
    near(span(w.pts, 1), 10, 1e-9, 'y');
  });

  test('a cylinder riding on the beam leaving the OAP: its axis along the beam, from the hit point', () => {
    const sh = { type: 'cylinder', d: 40, L: 260, p: [0, 0, 130], at: { row: 'OAP' } };
    const w = O.shapeWire(sh, rows, S);
    const s = S[0];
    nearV(w.c, O.add(s.P, s.uOut, 130), 1e-9, 'centre: 130 mm down the beam');
    // every point is 20 mm from the beam's line
    for (const q of w.pts) {
      const v = O.add(q, s.P, -1);
      const along = O.dot(v, s.uOut);
      near(Math.hypot(...O.add(v, s.uOut, -along)), 20, 1e-9, 'radius');
      assert.ok(along > -1e-9 && along < 260 + 1e-9, 'within its length');
    }
    // the incoming frame instead: along the beam arriving
    const wi = O.shapeWire({ ...sh, at: { row: 'OAP', frame: 'in' } }, rows, S);
    nearV(wi.c, O.add(s.P, s.uIn, 130), 1e-9, 'frame in');
    // by index too
    nearV(O.shapeWire({ ...sh, at: { row: 1 } }, rows, S).c, w.c, 1e-12, 'row by index');
  });

  test('the pupil (row 0) is the design frame; a missing row or another configuration hides it', () => {
    const b = { type: 'box', size: [1, 1, 1], p: [0, 0, -50], at: { row: 0 } };
    nearV(O.shapeWire(b, rows, S).c, [0, 0, -50], 1e-12, 'pupil frame');
    assert.equal(O.shapeWire({ ...b, at: { row: 'Nowhere' } }, rows, S), null);
    assert.equal(O.shapeWire({ ...b, only: ['c2'] }, rows, S, 'c1'), null);
    assert.ok(O.shapeWire({ ...b, only: ['c2'] }, rows, S, 'c2'));
    assert.ok(O.shapeWire({ ...b, only: ['c2'] }, rows, S, null), 'a design without configurations shows it');
    assert.equal(
      O.shapeWire({ type: 'rect', w: 1, h: 1, z: 0, y: 0 }, rows, S),
      null,
      'flat shapes are the app’s',
    );
  });

  test('hull2: the silhouette of a box seen along x is its y–z rectangle', () => {
    const w = O.shapeWire({ type: 'box', size: [10, 20, 30] }, rows, S);
    const H = O.hull2(w.pts.map(p => [p[2], p[1]]));
    assert.equal(H.length, 4);
    const area = H.reduce((a, p, i) => a + (p[0] * H[(i + 1) % 4][1] - H[(i + 1) % 4][0] * p[1]) / 2, 0);
    near(area, 600, 1e-9, 'counter-clockwise, 20 × 30');
  });
});
