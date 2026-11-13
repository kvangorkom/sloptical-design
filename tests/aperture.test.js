// Rectangular apertures (a row's apX with its ap): vignetting, the outline drawn, and Zemax's Rectangular Aperture.
// Run: node --test
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const O = require('../src/engine');

const surf = o => ({ name: '', type: 'refract', R: 0, k: 0, d: 0, tilt: 0, t: 0, n: 1, ap: 0, ...o });
const near = (a, b, tol, msg = '') =>
  assert.ok(Math.abs(a - b) <= tol, `${msg} got ${a}, expected ${b} ± ${tol}`);
const zmx = (head, surfs) =>
  [...head, ...surfs.flatMap((s, i) => [`SURF ${i}`, ...s.map(l => '  ' + l)])].join('\r\n');
const full = rows => rows.map((r, i) => (i ? surf(r) : { R: 0, ...r }));
/** Whether the ray from pupil point (x, y) gets through. */
const passes = (rows, x, y) => {
  const S = O.build(rows);
  return O.trace(S, x, y, 0).length === S.length;
};

describe('rectangular aperture', () => {
  const rows = o => [{ t: 10, ap: 10 }, surf({ ap: 2, apX: 5, t: 10, ...o }), surf()];

  test('vignettes by half-widths apX along x and ap along y; without apX the aperture is round', () => {
    for (const [x, y, ok] of [
      [4.9, 1.9, true],
      [5.1, 0, false],
      [0, 2.1, false],
      [-4.9, -1.9, true],
    ])
      assert.equal(passes(rows(), x, y), ok, `(${x}, ${y})`);
    assert.equal(passes(rows({ apX: 0 }), 1.9, 0), true);
    assert.equal(passes(rows({ apX: 0 }), 1.5, 1.5), false, 'round: by radius');
    assert.equal(passes(rows({ ap: 0 }), 9, 9), true, 'no ap: no aperture, whatever apX');
    assert.equal(passes(rows({ clock: 90 }), 0, 4.9), true, 'it turns with the surface');
    assert.equal(passes(rows({ clock: 90 }), 4.9, 0), false);
  });

  test('its rim is the rectangle, and a section across it runs to the edge that way', () => {
    const s = O.build(rows())[0];
    const loc = p => [p[0], p[1]]; // (a flat facing the beam on the axis: world x, y are its own)
    const R = O.rim(s, -2, 2).map(loc);
    assert.equal(R.length, 48);
    for (const [x, y] of R)
      assert.ok(
        Math.abs(Math.abs(x) - 5) < 1e-12 || Math.abs(Math.abs(y) - 2) < 1e-12,
        `(${x}, ${y}) on an edge`,
      );
    for (const c of [
      [5, 2],
      [-5, 2],
      [-5, -2],
      [5, -2],
    ])
      assert.ok(
        R.some(p => Math.hypot(p[0] - c[0], p[1] - c[1]) < 1e-12),
        `corner ${c}`,
      );
    const ends = w => [O.slice(s, -2, 2, w)[0], O.slice(s, -2, 2, w).at(-1)].map(loc);
    assert.deepEqual(
      ends([1, 0]).map(p => p[0]),
      [-5, 5],
    );
    assert.deepEqual(
      ends([0, 1]).map(p => p[1]),
      [-2, 2],
    );
    near(ends([Math.SQRT1_2, Math.SQRT1_2])[1][1], 2, 1e-12, 'diagonally: to the nearer edge');
    // a round one is the circle it always was
    const round = O.build(rows({ apX: 0 }))[0];
    for (const p of O.rim(round, -2, 2)) near(Math.hypot(p[0], p[1]), 2, 1e-12);
    near(O.slice(round, -2, 2, [1, 0]).at(-1)[0], 2, 1e-12);
  });

  // a plate with a rectangular aperture 5 × 2 (half-widths in x, y), after an optional break
  const file = (brk = []) =>
    zmx(
      ['ENPD 20', 'FTYP 0 0 1 1', 'YFLN 0'],
      [
        ['DISZ INFINITY'],
        ['STOP', 'DISZ 10'],
        ...(brk.length ? [['TYPE COORDBRK', ...brk, 'DISZ 0']] : []),
        ['COMM Plate', 'GLAS BK7 0 0 0 0', 'SQAP 5 2 0', 'DISZ 3'],
        ['COMM Back', 'DISZ 20'],
        ['COMM Image'],
      ],
    );

  test('Zemax: a Rectangular Aperture is read, along the axes each plane draws', () => {
    for (const plane of ['yz', '3d']) {
      const im = O.fromZemax(file(), { plane });
      const p = im.rows.find(r => r.name === 'Plate');
      assert.deepEqual([p.ap, p.apX], [2, 5], plane);
      assert.equal(passes(full(im.rows), 4.9, 0), true);
      assert.equal(passes(full(im.rows), 0, 2.1), false);
    }
    const xz = O.fromZemax(file(), { plane: 'xz' }).rows.find(r => r.name === 'Plate');
    assert.deepEqual([xz.ap, xz.apX], [5, 2], 'the file’s x is drawn as y');
  });

  test('Zemax, in 3D: a flat turned about its axis keeps the rectangle square to its own axes (a clock)', () => {
    for (const [turn, x, y] of [
      [90, 0, 4.9],
      [30, 4.9 * Math.cos(Math.PI / 6), 4.9 * Math.sin(Math.PI / 6)],
    ]) {
      const im = O.fromZemax(file([`PARM 5 ${turn}`]), { plane: '3d' });
      assert.ok(!im.warnings.some(w => /aperture/.test(w)), im.warnings.join('; '));
      const rows = full(im.rows);
      assert.equal(passes(rows, x, y), true, `turned ${turn}°: along its long side`);
      assert.equal(passes(rows, -y, x), false, 'across it');
    }
  });

  test('Zemax: an aperture the beam is not centred on is left out, with a note', () => {
    const im = O.fromZemax(file(['PARM 2 3']));
    const p = im.rows.find(r => r.name === 'Plate');
    assert.deepEqual([p.ap, p.apX], [0, undefined]);
    assert.ok(im.warnings.includes('Plate: its rectangular aperture is not centred on the beam; left out'));
  });
});
