// Several wavelengths: the dispersion model (n at the primary wavelength plus an Abbe number), surfaces at another
// wavelength, a thin lens's axial colour f/V, and wavelengths and model glasses through Zemax files. Run: node --test
const { test } = require('node:test');
const assert = require('node:assert/strict');
const O = require('../src/engine');

const DEF = { name: '', type: 'refract', R: 0, k: 0, d: 0, tilt: 0, t: 0, n: 1, ap: 0 };
const near = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} got ${a}, expected ${b} ± ${tol}`);
const { F, d, C } = O.LINES;

test('the Abbe number sets n_F − n_C = (n_d − 1)/V; no Abbe number, or air, or the primary wavelength: n unchanged', () => {
  for (const [n, V] of [
    [1.5168, 64.17],
    [1.80518, 25.36],
  ]) {
    near(O.nAt(n, V, F, d) - O.nAt(n, V, C, d), (n - 1) / V, 1e-12);
    near(O.nAt(n, V, d, d), n, 0);
    assert.ok(O.nAt(n, V, F, d) > n && O.nAt(n, V, C, d) < n, 'normal dispersion: higher index in the blue');
  }
  assert.equal(O.nAt(1.5, 0, F, d), 1.5);
  assert.equal(O.nAt(1, 60, F, d), 1);
});

test('surfaces at another wavelength: same places, glass indices changed, mirrors untouched', () => {
  const rows = [
    { R: 0, t: 20, ap: 10 },
    { ...DEF, R: 100, t: 5, n: 1.5168, abbe: 64.17 },
    { ...DEF, type: 'mirror', R: -300, t: 100 },
    { ...DEF },
  ];
  const S = O.build(rows);
  const Sf = O.atWavelength(S, rows, F, d);
  assert.deepEqual(
    Sf.map(s => s.P),
    S.map(s => s.P),
  );
  near(Sf[0].n, O.nAt(1.5168, 64.17, F, d), 0);
  assert.equal(Sf[1], S[1], 'the mirror is the same surface');
  assert.equal(Sf.beam, S.beam);
  const plain = rows.map(({ abbe, ...r }) => r);
  assert.equal(O.atWavelength(O.build(plain), plain, F, d).length, 3);
  assert.equal(O.dispersive(plain), false);
  assert.equal(O.dispersive(rows), true);
});

test('a thin singlet’s axial colour is f/V (focus at C minus focus at F)', () => {
  const f = 200;
  const n = 1.5168;
  const V = 64.17;
  const R = 2 * (n - 1) * f; // equiconvex, thin
  const rows = [
    { R: 0, t: 10, ap: 5 },
    { ...DEF, R, t: 0.001, n, abbe: V },
    { ...DEF, R: -R, t: f },
    { ...DEF },
  ];
  const S = O.build(rows);
  const bfd = l => 1 / O.curv(O.atWavelength(S, rows, l, d), 1, 1e-4);
  near(bfd(C) - bfd(F), f / V, 0.01 * (f / V));
});

test('Zemax: every wavelength (the primary first) and model glasses with their Abbe numbers, out and back', () => {
  const rows = [
    { R: 0, t: 10, ap: 5 },
    { ...DEF, name: 'L', R: 50, t: 5, n: 1.5168, abbe: 64.17 },
    { ...DEF, R: -50, t: 45 },
    { ...DEF, name: 'Image' },
  ];
  const z = O.zemax(rows, { lambda: 0.5876, lambdas: [0.5876, 0.4861, 0.6563] });
  assert.match(z, /WAVM 1 0.5876 1\r\nWAVM 2 0.4861 1\r\nWAVM 3 0.6563 1\r\nPWAV 1/);
  assert.match(z, /GLAS ___BLANK 1 0 1.5168\d*e\+0 6.417\d*e\+1/);
  const back = O.fromZemax(z);
  assert.equal(back.lambda, 0.5876);
  assert.deepEqual(back.lambdas, [0.5876, 0.4861, 0.6563]);
  const L = back.rows.find(r => r.name === 'L');
  near(L.n, 1.5168, 1e-9);
  near(L.abbe, 64.17, 1e-9);
  assert.equal(
    O.fromZemax(O.zemax(rows, { lambda: 0.55 })).lambdas,
    undefined,
    'one wavelength: none listed',
  );
});
