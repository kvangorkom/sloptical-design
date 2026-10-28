// Zemax export of several configurations in one .zmx (OpticStudio's multi-configuration editor) and of double passes
// (the way back written out as surfaces), checked by importing the file again. Run: node --test
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const O = require('../src/engine');

const surf = o => ({ name: '', type: 'refract', R: 0, k: 0, d: 0, tilt: 0, t: 0, n: 1, ap: 0, ...o });
const mirror = o => surf({ type: 'mirror', ...o });
const near = (a, b, tol, msg = '') =>
  assert.ok(Math.abs(a - b) <= tol, `${msg} got ${a}, expected ${b} ± ${tol}`);
const dist = (a, b) => Math.hypot(...O.add(a, b, -1));

/** A design with configurations: rows in the pool, each configuration's values (set) and members (only). */
function withConfigs(pool, list, only = {}) {
  const rows = pool.map(r => ({ ...r }));
  for (const [id, ids] of Object.entries(only)) rows.find(r => r.id === id).only = ids;
  return { rows: [], configs: { active: 0, show: [], list, rows } };
}
const designsOf = sys => sys.configs.list.map((c, ci) => ({ name: c.name, rows: O.solvedConfig(sys, ci) }));
const importedRows = (im, ci) => O.configRows({ rows: [], configs: im.configs }, ci);

// an OAP relay with a fold, out of the plane at the second OAP; a plate in one configuration only
const relay = () =>
  withConfigs(
    [
      { id: 'p', R: 0, t: 150, ap: 8 },
      mirror({ id: 'a', name: 'OAP1', R: -600, k: -1, d: 90, t: 300 }),
      mirror({ id: 'b', name: 'Fold', tilt: 20, t: 200 }),
      surf({ id: 'w', name: 'Plate', n: 1.5168, t: 5, tilt: 3 }),
      surf({ id: 'w2', name: 'Plate back', t: 195, tilt: 3 }),
      mirror({ id: 'c', name: 'OAP2', R: -800, k: -1, d: 110, tilt: 3, tiltY: 12, clock: 40, t: 420 }),
      surf({ id: 'f', name: 'Focus' }),
    ],
    [
      { id: 'c1', name: 'Without plate', set: { b: { t: 400 } } },
      { id: 'c2', name: 'With plate', set: { b: { tilt: 22 } } },
    ],
    { w: ['c2'], w2: ['c2'] },
  );

describe('Zemax: several configurations in one file', () => {
  test('re-imported, every configuration has its surfaces where they were', () => {
    const sys = relay();
    const D = designsOf(sys);
    const { text, warnings } = O.zemaxConfigs(D, { fields: [0, [0.1, 0.1]], name: 'relay' });
    assert.deepEqual(warnings, []);
    assert.match(text, /^MNUM 2 1$/m);
    assert.match(text, /^MOFF 0 2 "With plate"/m);
    const im = O.fromZemax(text, { plane: '3d' });
    assert.equal(im.configs.list.length, 2);
    D.forEach((d, ci) => {
      const A = O.build(d.rows);
      const rows = importedRows(im, ci);
      const B = O.build(rows);
      assert.deepEqual(
        rows.slice(1).map(r => r.name),
        d.rows.slice(1).map(r => r.name.replace(/\s+/g, '_')),
        `${d.name}: the same surfaces (names as the export writes them)`,
      );
      A.forEach((s, i) => {
        near(dist(s.V, B[i].V), 0, 1e-8, `${d.name} ${d.rows[i + 1].name}: vertex`);
        near(dist(s.ez, B[i].ez), 0, 1e-10, `${d.name} ${d.rows[i + 1].name}: axis`);
      });
    });
  });

  test('only what differs goes in the editor: the plate ignored in one, the fold’s break and spacing', () => {
    const { text } = O.zemaxConfigs(designsOf(relay()));
    const ops = text.split('\r\n').filter(l => /^(IGNM|THIC|PRAM|CRVT|CONN|MCOM)/.test(l));
    const ign = ops.filter(l => l.startsWith('IGNM'));
    assert.equal(ign.length, 4, 'two plate surfaces (each with its break), in two configurations');
    assert.ok(ign.some(l => /^IGNM \d+ 1 1 /.test(l)) && ign.some(l => /^IGNM \d+ 2 0 /.test(l)));
    assert.ok(!ops.some(l => /^(CRVT|CONN|MCOM)/.test(l)), 'curvatures, conics and names are shared');
    // the shared surfaces after the fork agree to round-off: nothing written for them
    const surfs = text.split(/SURF \d+/).length - 1;
    assert.ok(
      ops.every(l => +l.split(' ')[1] < surfs - 4),
      'OAP2 and the focus are written once',
    );
  });

  test('a single design writes no editor', () => {
    const { text } = O.zemaxConfigs([designsOf(relay())[0]]);
    assert.doesNotMatch(text, /^MNUM/m);
  });
});

describe('Zemax: a double pass written out', () => {
  // a paraboloid focusing a collimated beam onto a caliball centred on its focus
  const ball = () => {
    const rows = [
      { R: 0, t: 100, ap: 10 },
      mirror({ name: 'OAP', R: -400, k: -1, d: 50, t: 203.125 }),
      mirror({ name: 'Ball', R: 10, dp: true, ball: true }),
    ];
    rows[1].solve = { t: { type: 'centre' } };
    O.applySolves(rows);
    return rows;
  };

  test('the way back becomes surfaces of its own: the same optics, then the pupil plane; every ray as traced', () => {
    const rows = ball();
    const S = O.build(rows);
    const txt = O.zemax(rows);
    assert.match(txt, /COMM OAP_\(back\)/);
    assert.match(txt, /COMM Pupil_\(back\)/);
    const im = O.fromZemax(txt, { plane: '3d' });
    assert.deepEqual(
      im.rows.slice(1).map(r => r.name),
      ['OAP', 'Ball', 'OAP_(back)', 'Pupil_(back)'],
    );
    const B = O.build(im.rows);
    near(dist(B[2].V, S[0].V), 0, 1e-8, 'the OAP met again where it is');
    near(dist(B[3].V, [0, 0, 0]), 0, 1e-8, 'back on the pupil');
    for (const [x, y] of [
      [0, 0],
      [6, 0],
      [0, -7],
      [5, 5],
    ]) {
      const a = O.traceDP(S, x, y, 0).at(-1);
      const b = O.trace(B, x, y, 0).at(-1);
      near(dist(a.p, b.p), 0, 1e-8, `ray (${x}, ${y}) on the pupil`);
      near(a.L, b.L, 1e-8, `ray (${x}, ${y}) path`);
    }
  });

  test('configurations with different ways back: each re-imported traces as its double pass', () => {
    const sys = withConfigs(
      [
        { id: 'p', R: 0, t: 100, ap: 10 },
        mirror({ id: 'o1', name: 'OAP1', R: -400, k: -1, d: 50, t: 400 }),
        mirror({ id: 'cb', name: 'Ball', R: 10, dp: true, ball: true, solve: { t: undefined } }),
        mirror({ id: 'o2', name: 'OAP2', R: -800, k: -1, d: 100, t: 300 }),
        mirror({ id: 'ff', name: 'Flat', dp: true }),
      ],
      [
        { id: 'c1', name: 'Caliball', set: { o1: { t: 193.125 } } },
        { id: 'c2', name: 'Flat', set: {} },
      ],
      { cb: ['c1'], o2: ['c2'], ff: ['c2'] },
    );
    delete sys.configs.rows.find(r => r.id === 'cb').solve;
    const D = designsOf(sys);
    const { text } = O.zemaxConfigs(D);
    const im = O.fromZemax(text, { plane: '3d' });
    D.forEach((d, ci) => {
      const S = O.build(d.rows);
      assert.ok(S.dp, `${d.name}: a double pass`);
      const B = O.build(importedRows(im, ci));
      assert.equal(B.length, 2 * S.length, `${d.name}: out, back, and the pupil`);
      for (const [x, y] of [
        [0, 0],
        [4, -3],
      ]) {
        const a = O.traceDP(S, x, y, 0).at(-1);
        const b = O.trace(B, x, y, 0).at(-1);
        near(dist(a.p, b.p), 0, 1e-7, `${d.name}: ray (${x}, ${y})`);
        near(a.L, b.L, 1e-7, `${d.name}: path`);
      }
    });
  });
});
