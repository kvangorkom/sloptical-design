// Placing surfaces absolutely (placeRows): a design re-described from any starting point, direction and frame, the
// optics staying exactly where they are; and a design built in a tilted plane brought back into the y–z plane.
// Run: node --test
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const O = require('../src/engine');

const surf = o => ({ name: '', type: 'refract', R: 0, k: 0, d: 0, tilt: 0, t: 0, n: 1, ap: 0, ...o });
const mirror = o => surf({ type: 'mirror', ...o });
const full = rows => rows.map((r, i) => (i ? surf(r) : { R: 0, ...r }));
const near = (a, b, tol, msg = '') =>
  assert.ok(Math.abs(a - b) <= tol, `${msg} got ${a}, expected ${b} ± ${tol}`);
const nearV = (a, b, tol, msg = '') => near(Math.hypot(...O.add(a, b, -1)), 0, tol, msg);

/** Rotation matrix (rows) from Euler angles about x, then y, then z (degrees). */
function rotXYZ(ax, ay, az) {
  const [a, b, c] = [ax, ay, az].map(v => (v * Math.PI) / 180);
  const X = [
    [1, 0, 0],
    [0, Math.cos(a), -Math.sin(a)],
    [0, Math.sin(a), Math.cos(a)],
  ];
  const Y = [
    [Math.cos(b), 0, Math.sin(b)],
    [0, 1, 0],
    [-Math.sin(b), 0, Math.cos(b)],
  ];
  const Z = [
    [Math.cos(c), -Math.sin(c), 0],
    [Math.sin(c), Math.cos(c), 0],
    [0, 0, 1],
  ];
  const mul = (P, Q) => P.map(r => [0, 1, 2].map(j => r.reduce((s, v, k) => s + v * Q[k][j], 0)));
  return mul(Z, mul(Y, X));
}
const apply = (M, v) => M.map(r => r.reduce((s, x, k) => s + x * v[k], 0));

// an OAP relay with a fold between, leaving the plane at the second OAP
const relay3D = () =>
  full([
    { t: 150, ap: 8 },
    mirror({ name: 'OAP1', R: -600, k: -1, d: 90, t: 300 }),
    mirror({ name: 'Fold', tilt: 20, t: 200 }),
    mirror({ name: 'OAP2', R: -800, k: -1, d: 110, tilt: 3, tiltY: 12, clock: 40, t: 420 }),
    { name: 'Focus' },
  ]);
// the same, in the y–z plane
const relay2D = () =>
  full([
    { t: 150, ap: 8 },
    mirror({ name: 'OAP1', R: -600, k: -1, d: 90, t: 300 }),
    mirror({ name: 'Fold', tilt: 20, t: 200 }),
    mirror({ name: 'OAP2', R: -800, k: -1, d: -110, tilt: 3, t: 420 }),
    { name: 'Focus' },
  ]);

describe('placeRows', () => {
  test('from the same start and frame, the rows rebuild the same optics', () => {
    const rows = relay3D();
    const S = O.build(rows);
    const { rows: out, warnings } = O.placeRows(
      S.map((s, i) => [s, rows[i + 1]]),
      { ap: 8, x: [1, 0, 0] },
    );
    assert.deepEqual(warnings, []);
    assert.equal(out.length, rows.length);
    const S2 = O.build(out);
    S.forEach((s, i) => {
      nearV(S2[i].V, s.V, 1e-8, `${rows[i + 1].name || i}: vertex`);
      nearV(S2[i].ez, s.ez, 1e-10, `${rows[i + 1].name || i}: axis`);
      near(S2[i].c, s.c, 1e-14, 'curvature');
    });
    out.slice(1).forEach((r, i) => near(r.t, rows[i + 1].t, 1e-8, `${r.name}: distance`));
  });

  test('from another start, direction and roll, the optics stay put in the new frame', () => {
    const rows = relay3D();
    const S = O.build(rows);
    const origin = [0, 0, 60]; // part way to OAP1, along the axis
    const roll = [Math.cos(0.6), Math.sin(0.6), 0]; // x turned 34° about z
    const { rows: out, frame } = O.placeRows(
      S.map((s, i) => [s, rows[i + 1]]),
      { origin, dir: [0, 0, 1], x: roll, ap: 8 },
    );
    near(out[0].t, 90, 1e-9, 'the pupil moved 60 mm along the axis');
    const S2 = O.build(out);
    S.forEach((s, i) => {
      nearV(S2[i].V, frame.T(s.V), 1e-8, `${rows[i + 1].name || i}: vertex`);
      nearV(S2[i].ez, frame.Td(s.ez), 1e-10, `${rows[i + 1].name || i}: axis`);
    });
    // the rays agree: a pupil-edge ray lands at the same place on the focal plane (in the new frame)
    const a = O.trace(S, 0, 8, 0).at(-1).p;
    const b = O.trace(S2, 8 * roll[1], 8 * roll[0], 0).at(-1).p;
    nearV(b, frame.T(a), 1e-7, 'ray at the focus');
  });

  test('a planar design built in a tilted plane comes back planar when x is that plane’s normal', () => {
    const rows = relay2D();
    const S = O.build(rows);
    const M = rotXYZ(17, -32, 51);
    const turned = S.map(s => {
      const ex = s.ex ?? O.cross(s.ey, s.ez);
      return { ...s, V: apply(M, s.V), ez: apply(M, s.ez), ey: apply(M, s.ey), ex: apply(M, ex) };
    });
    const { rows: out } = O.placeRows(
      turned.map((s, i) => [s, rows[i + 1]]),
      { origin: apply(M, [0, 0, 0]), dir: apply(M, [0, 0, 1]), x: apply(M, [1, 0, 0]), ap: 8 },
    );
    out.slice(1).forEach((r, i) => {
      const want = rows[i + 1];
      assert.equal(r.tiltY, undefined, `${r.name}: no tilt y`);
      assert.equal(r.clock, undefined, `${r.name}: no clock`);
      near(r.t, want.t, 1e-8, `${r.name}: distance`);
      near(r.tilt, want.tilt, 1e-9, `${r.name}: tilt`);
      near(r.d, want.d, 1e-8, `${r.name}: off-axis`);
      near(r.R, want.R, 1e-8, `${r.name}: R`);
    });
  });

  test('facingBack and planeAt rebuild reverseSystem’s collimated reversal', () => {
    const rows = relay2D();
    const S = O.build(rows);
    const n = S.length;
    const rev = O.reverseSystem({ rows, fields: [0] });
    const E = O.build(rev.rows.map((r, i) => (i ? surf(r) : r)));
    // start where reverseSystem starts and run the same optics back
    const w = S[n - 2].uOut.map(v => -v);
    const origin = O.add(S[n - 2].P, S[n - 2].uOut, 0); // any point on the last segment; the pupil then moves
    const G = [
      ...S.slice(0, n - 1)
        .map((s, i) => [O.facingBack(s, rows, i), rows[i + 1]])
        .reverse(),
      [O.planeAt([0, 0, 0], [0, 0, 1], 'Pupil'), {}],
    ];
    const { rows: out } = O.placeRows(G, { origin, dir: w, ap: 8 });
    const B = O.build(out);
    // same optics in the same order, same powers and spacings between them
    for (let i = 1; i < out.length - 1; i++) {
      near(out[i].R, rev.rows[i].R, 1e-9, `R ${i}`);
      near(out[i].d, rev.rows[i].d, 1e-8, `d ${i}`);
      if (i > 1) near(out[i - 1].t, rev.rows[i - 1].t, 1e-8, `t ${i - 1}`);
    }
    nearV(
      O.add(B.at(-1).P, B[0].P, -1).map(Math.abs),
      O.add(E.at(-1).P, E[0].P, -1).map(Math.abs),
      1e-7,
      'span',
    );
  });
});
