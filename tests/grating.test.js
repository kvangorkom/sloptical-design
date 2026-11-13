// Gratings (in the tracer, across wavelengths and through Zemax), and what a real OpticStudio spectropolarimeter file
// needs besides: birefringent surfaces, non-sequential components, and fields and wavelengths that differ between
// configurations. Run: node --test
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const O = require('../src/engine');

const surf = o => ({ name: '', type: 'refract', R: 0, k: 0, d: 0, tilt: 0, t: 0, n: 1, ap: 0, ...o });
const mirror = o => surf({ type: 'mirror', ...o });
const near = (a, b, tol, msg = '') =>
  assert.ok(Math.abs(a - b) <= tol, `${msg} got ${a}, expected ${b} ± ${tol}`);
const rd = Math.PI / 180;
const sin = d => Math.sin(d * rd);
const asin = v => Math.asin(v) / rd;
const zmx = (head, surfs) =>
  [...head, ...surfs.flatMap((s, i) => [`SURF ${i}`, ...s.map(l => '  ' + l)])].join('\r\n');
const full = rows => rows.map((r, i) => (i ? surf(r) : { R: 0, ...r }));
const rmsWFE = w => Math.sqrt(w.opd.reduce((s, v) => s + v * v, 0) / w.opd.length);
/** Where the axis ray (or pupil point p, field f) lands on the last surface, from its centre. */
const lands = (rows, p = [0, 0], f = 0) => O.trace(O.build(rows), ...p, f).at(-1)?.loc;
const mgf2 = { o: 1.37774, e: 1.38956 }; // (at the d line)

describe('grating', () => {
  const lam = 0.5;
  const lines = 600; // per mm: order · λ · lines = 0.3 per order
  const rows = (o = {}, tilt = 10) => [
    { t: 50, ap: 5, lam },
    mirror({ name: 'G', tilt, lines, order: 1, t: 100, ...o }),
    surf(),
  ];
  /** The axis ray's direction after the grating, in the grating's own frame. */
  const out = S => [S[0].ex ?? [1, 0, 0], S[0].ey, S[0].ez].map(e => O.dot(S[0].uOut, e));

  test('reflects into n sin θ′ = n sin θ + order · λ · lines along its y; order 0 is a mirror', () => {
    for (const order of [-2, -1, 0, 1]) {
      const S = O.build(rows({ order }));
      const u = out(S);
      near(u[1], -sin(10) + order * lam * lines * 1e-3, 1e-12, `order ${order}`);
      near(u[0], 0, 1e-12);
      assert.ok(u[2] < 0, 'back the way it came');
    }
    assert.deepEqual(
      O.build(rows({ order: 0 }))[0].uOut,
      O.build([rows()[0], mirror({ tilt: 10, t: 100 }), surf()])[0].uOut,
    );
  });

  test('an order with nowhere to go (evanescent) is lost', () => {
    assert.equal(O.trace(O.build(rows({ order: 3 }, -30)), 0, 0, 0).length, 0);
  });

  test('in transmission, into glass: the same law with the index after it', () => {
    const S = O.build(rows({ type: 'refract', n: 1.5 }));
    const u = out(S);
    near(1.5 * u[1], -sin(10) + 0.3, 1e-12);
    assert.ok(u[2] > 0, 'onward');
  });

  test('groove turns the rulings about the axis: at 90°, it diffracts along −x', () => {
    const u = out(O.build(rows({ groove: 90 }, 0)));
    near(u[0], -0.3, 1e-12);
    near(u[1], 0, 1e-12);
  });

  test('a collimated beam leaves collimated, its wavefront flat (the grooves’ path is counted)', () => {
    const S = O.build(rows());
    near(rmsWFE(O.wavefrontIn(S, O.bundle(S, 5, 11, 0))), 0, 1e-9);
    const dirs = O.grid(5, 5).map(([x, y]) => O.trace(S, x, y, 0)[0].u);
    for (const u of dirs) near(Math.hypot(...O.add(u, dirs[0], -1)), 0, 1e-12);
  });

  test('other wavelengths leave at their own angles (atWavelength); the layout is the primary’s (pupil row lam)', () => {
    const r = rows();
    assert.ok(O.dispersive(r));
    const S = O.build(r);
    for (const l of [0.4, 0.5, 0.65]) {
      const Sl = O.atWavelength(S, r, l, lam);
      const u = O.trace(Sl, 0, 0, 0)[0].u;
      near(O.dot(u, S[0].ey), -sin(10) + l * lines * 1e-3, 1e-12, `λ ${l}`);
    }
    near(
      out(O.build([{ ...r[0], lam: 0.4 }, ...r.slice(1)]))[1],
      -sin(10) + 0.4 * 0.6,
      1e-12,
      'built at another primary',
    );
    near(out(O.build([{ t: 50, ap: 5 }, ...r.slice(1)]))[1], -sin(10) + 0.55 * 0.6, 1e-12, 'no lam: 0.55 µm');
  });

  test('Littrow (2 sin θ = λ · lines): the beam goes back on itself, also as a double pass', () => {
    const th = asin((lam * lines * 1e-3) / 2);
    const r = [{ t: 50, ap: 5, lam }, surf({ t: 50 }), mirror({ tilt: th, lines, order: 1, dp: true })];
    const S = O.build(r);
    near(Math.hypot(...O.add(S[1].uOut, [0, 0, -1], -1)), 0, 1e-12);
    for (const p of [
      [0, 3],
      [2, -1],
    ]) {
      const back = O.traceDP(S, ...p, 0).at(-1);
      near(Math.hypot(back.p[0] - p[0], back.p[1] - p[1]), 0, 1e-9, 'back to where it left the pupil');
    }
  });

  test('Zemax: written as a Diffraction Grating and read back the same, in a plane and in 3D', () => {
    for (const o of [{}, { tiltY: 7 }, { order: -1, tilt: -25 }]) {
      const r = [...rows(o).slice(0, 2), mirror({ tilt: 5, R: -300, t: 80 }), surf()];
      const txt = O.zemax(r, { lambda: lam });
      assert.match(txt, /TYPE DGRATING[^]*PARM 1 0\.6\r\n/);
      const im = O.fromZemax(txt, { plane: 'auto' });
      const g = im.rows.find(x => x.lines);
      assert.deepEqual([g.type, g.lines, Math.abs(g.order), im.rows[0].lam], ['mirror', 600, 1, lam]);
      const [A, B] = [O.build(r), O.build(full(im.rows))];
      A.forEach((s, i) => near(Math.hypot(...O.add(s.P, B[i].P, -1)), 0, 1e-8, `surface ${i + 1}`));
      for (const l of [0.4, 0.6]) {
        const at = (S, rr) => O.trace(O.atWavelength(S, rr, l, lam), 1, 2, 0).at(-1).p;
        near(Math.hypot(...O.add(at(A, r), at(B, full(im.rows)), -1)), 0, 1e-8, `λ ${l}`);
      }
    }
    assert.match(O.zemaxConfigs([{ rows: rows() }], { lambda: lam }).text, /TYPE DGRATING/);
  });

  test('scripts: optiland’s has the grating (period in µm, order, groove angle); batoid, which has none, refuses', () => {
    assert.throws(() => O.toPython(rows(), 'batoid'), /grating/);
    const py = O.toPython(rows({ order: -1 }), 'optiland');
    assert.match(py, /GRATINGS = \{0: \(1\.6666666666666\d*, -1, 0\)\}/);
    assert.match(py, /surface_type="grating", grating_period=period, grating_order=order/);
    assert.doesNotMatch(O.toPython([rows()[0], mirror({ t: 10 }), surf()], 'optiland'), /GRATINGS/);
    // grooves turned about the axis send the light out of the plane: a 3D design, which the optiland script can't lay out
    assert.ok(O.is3D(rows({ groove: 20 })) && !O.is3D(rows()));
    assert.throws(() => O.toPython(rows({ groove: 20 }), 'optiland'), /leaves the y–z plane/);
  });

  test('reversing a system says its gratings are not carried over', () => {
    const r = O.reverseSystem({ rows: [...rows().slice(0, 2), mirror({ tilt: 5, R: -300, t: 80 }), surf()] });
    assert.ok(r.warnings.some(w => /gratings/.test(w)));
  });
});

describe('Zemax import: a spectropolarimeter’s surfaces', () => {
  // as OpticStudio folds a grating: a break tilts onto it, another tilts on by the same, and a third follows the
  // diffracted beam (not the mirror's reflection) to the next surface
  const T = 0.558; // lines/µm
  const lam = 0.25;
  const th = 8.4543333;
  const dev = asin(sin(th) + T * lam) - th; // from the reflection, at order −1 as the file's frames count it
  const gratingFile = (extra = []) =>
    zmx(
      ['ENPD 6', 'FTYP 0 0 1 3', 'YFLN 0', 'WAVM 1 0.25 1', 'WAVM 2 0.18 1', 'WAVM 3 0.32 1', 'PWAV 1'],
      [
        ['DISZ INFINITY'],
        ['STOP', 'DISZ 20'],
        ['TYPE COORDBRK', `PARM 3 ${-th}`, 'DISZ 0'],
        ['COMM Grating', 'TYPE DGRATING', `PARM 1 ${T}`, 'PARM 2 -1', 'GLAS MIRROR', 'DISZ 0', ...extra],
        ['TYPE COORDBRK', `PARM 3 ${-th}`, 'DISZ -100'],
        ['TYPE COORDBRK', `PARM 2 ${100 * Math.tan(dev * rd)}`, `PARM 3 ${-dev}`, 'DISZ 0'],
        ['COMM Camera', 'TYPE PARAXIAL', 'PARM 1 50', 'DISZ -50'],
        ['COMM Image'],
      ],
    );

  test('a Diffraction Grating: the axis ray follows the diffracted order, as the file’s own frames do', () => {
    for (const plane of ['yz', '3d']) {
      const im = O.fromZemax(gratingFile(), { plane });
      assert.ok(!im.warnings.some(w => /DGRATING/.test(w)), 'no longer read as a standard surface');
      const g = im.rows.find(r => r.name === 'Grating');
      assert.deepEqual([g.type, g.lines, Math.abs(g.order), g.groove], ['mirror', 558, 1, undefined]);
      assert.equal(im.rows[0].lam, lam);
      const cam = im.rows.find(r => r.name === 'Camera');
      near(cam.d, 0, 1e-6, `${plane}: lands on the camera's centre`);
      near(cam.tilt, 0, 1e-6, `${plane}: along its axis`);
      const rows = full(im.rows);
      const S = O.build(rows);
      const y = l => O.trace(O.atWavelength(S, rows, l, lam), 0, 0, 0).at(-1).loc[1];
      assert.ok(Math.abs(y(0.18)) > 1 && y(0.18) * y(0.32) < 0, 'the other wavelengths to either side');
    }
  });

  test('rulings out of the drawn plane: said so (import in 3D keeps them, as a groove angle or a clock)', () => {
    const turned = gratingFile().replace('COMM Grating', 'COMM Grating\r\n  XX').split('\r\n');
    const i = turned.findIndex(l => /SURF 3/.test(l));
    turned.splice(i, 0, 'SURF 2b', '  TYPE COORDBRK', '  PARM 5 90', '  DISZ 0');
    const txt = turned.join('\r\n');
    assert.ok(O.fromZemax(txt, { plane: 'yz' }).warnings.some(w => /out of the y–z plane/.test(w)));
    const im = O.fromZemax(txt, { plane: '3d' });
    const S = O.build(full(im.rows));
    near(Math.abs(S[0].uOut[0]), Math.abs(T * lam), 1e-9, 'it diffracts across x now');
  });

  // a Wollaston prism: two MgF2 wedges, crystal axes crossed and across the beam; the ray that is ordinary in the first
  // is extraordinary in the second (configuration 1), or the other way round (configuration 2)
  const wollaston = (glass = 'MGF2_LI', axis1 = 'PARM 3 1') =>
    zmx(
      [
        'ENPD 4',
        'FTYP 0 0 1 1',
        'YFLN 0',
        'WAVM 1 0.5875618 1',
        'PWAV 1',
        'MNUM 2 1',
        'MOFF 0 1 "o then e" 0 0 0 1 1 0 0.0 "" 0',
        'MOFF 0 2 "e then o" 0 0 0 1 1 0 0.0 "" 0',
        'PRAM 3 1 0.0E+00 0 1 0 1 1 1 0 0 "" 0',
        'PRAM 3 2 1.0E+00 0 1 0 1 1 1 0 0 "" 0',
        'PRAM 6 1 1.0E+00 0 1 0 1 1 1 0 0 "" 0',
        'PRAM 6 2 0.0E+00 0 1 0 1 1 1 0 0 "" 0',
      ],
      [
        ['DISZ INFINITY'],
        ['STOP', 'DISZ 10'],
        ['COMM Plate', `GLAS ${glass} 0 0 1.5 40`, 'DISZ 2'],
        ['COMM W1', 'TYPE BIRE__IN', axis1, `GLAS ${glass} 0 0 1.5 40`, 'DISZ 5'],
        ['TYPE COORDBRK', 'PARM 3 35', 'DISZ 0'],
        ['COMM W1 out', 'TYPE BIRE_OUT', `GLAS ${glass} 0 0 1.5 40`, 'DISZ 0'],
        ['COMM W2', 'TYPE BIRE__IN', 'PARM 1 1', 'PARM 2 1', `GLAS ${glass} 0 0 1.5 40`, 'DISZ 0'],
        ['TYPE COORDBRK', 'PARM 3 -35', 'DISZ 5'],
        ['COMM W2 out', 'TYPE BIRE_OUT', 'DISZ 100'],
        ['COMM Image'],
      ],
    );

  test('birefringent surfaces: the ordinary or extraordinary index by mode, each polarisation a configuration', () => {
    const im = O.fromZemax(wollaston());
    assert.ok(!im.warnings.some(w => /BIRE|MGF2|crystal/.test(w)), im.warnings.join('; '));
    const rows = k => O.configRows({ configs: im.configs }, k);
    const n = (k, name) => rows(k).find(r => r.name === name).n;
    near(n(0, 'Plate'), mgf2.o, 2e-5, 'a plain surface into the crystal: ordinary');
    near(n(0, 'W1'), mgf2.o, 2e-5);
    near(n(0, 'W2'), mgf2.e, 2e-5);
    near(n(1, 'W1'), mgf2.e, 2e-5, 'PRAM on the mode: the other polarisation');
    near(n(1, 'W2'), mgf2.o, 2e-5);
    // the two leave the prism to either side, by about 2 Δn tan 35° between them
    const tilt = k => {
      const u = O.build(full(rows(k))).at(-2).uOut;
      return Math.atan2(u[1], u[2]);
    };
    assert.ok(tilt(0) * tilt(1) < 0);
    near(Math.abs(tilt(0) - tilt(1)), 2 * (mgf2.e - mgf2.o) * Math.tan(35 * rd), 2e-4, 'the split');
  });

  test('a crystal’s dispersion: its fitted Abbe number gives the index at the file’s other wavelength too', () => {
    const at = (l0, l1) =>
      O.fromZemax(
        wollaston()
          .replace('WAVM 1 0.5875618 1', `WAVM 1 ${l0} 1\r\nWAVM 2 ${l1} 1`)
          .replace('FTYP 0 0 1 1', 'FTYP 0 0 1 2'),
        { configs: false },
      ).rows.find(r => r.name === 'W2');
    const [r, r2] = [at(0.25, 0.2), at(0.2, 0.25)]; // (n at each primary: the crystal's own formula)
    assert.ok(r.n > mgf2.e + 0.02 && r2.n > r.n + 0.01, 'the index rises into the ultraviolet');
    const rows = [{ t: 0, ap: 1 }, surf({ n: r.n, abbe: r.abbe, t: 1 }), surf()];
    near(O.atWavelength(O.build(rows), rows, 0.2, 0.25)[0].n, r2.n, 1e-12);
  });

  test('a crystal with no data, or with its axis along the beam: said so', () => {
    assert.ok(O.fromZemax(wollaston('CALCITE')).warnings.some(w => /CALCITE: no crystal data/.test(w)));
    assert.ok(
      O.fromZemax(wollaston('MGF2_LI', 'PARM 4 1')).warnings.some(w =>
        /W1: the crystal axis is not across the beam/.test(w),
      ),
    );
  });

  // a telescope with a non-sequential group (drawn hardware) at the primary's vertex, behind where its rays reflect
  const tel = (extra = [], head = []) =>
    zmx(
      ['ENPD 100', 'FTYP 0 0 1 1', 'YFLN 0', 'WAVM 1 0.55 1', 'PWAV 1', ...head],
      [
        ['DISZ INFINITY'],
        ['COMM Front', 'DISZ 200'],
        ['COMM M1', 'STOP', 'CURV -2.5E-03', 'CONI -1', 'GLAS MIRROR', 'DISZ 0'],
        ['COMM Payload Volumes', 'TYPE NONSEQCO', 'PARM 0 3', ...extra, 'DISZ 0'],
        ['COMM Focus', 'DISZ -200'],
        ['COMM Image'],
      ],
    );

  test('a non-sequential component is left out, named or not, dummies kept or not', () => {
    for (const keepDummies of [false, true]) {
      const im = O.fromZemax(tel(), { keepDummies });
      assert.deepEqual(im.rows.map(r => r.name).filter(Boolean), ['Front', 'M1', 'Focus', 'Image']);
      assert.ok(im.warnings.includes('non-sequential component (Payload Volumes) left out'));
      assert.ok(!im.warnings.some(w => /dummy/.test(w)));
    }
    assert.ok(O.fromZemax(tel(['PARM 3 10'])).warnings.some(w => /exit port is not read/.test(w)));
  });

  test('glasses BAFN10 and SF5 by name', () => {
    const lens = g =>
      zmx(
        ['ENPD 4', 'YFLN 0'],
        [['DISZ INFINITY'], ['STOP', 'CURV 0.01', `GLAS ${g} 0 0 0 0`, 'DISZ 3'], ['DISZ 50'], []],
      );
    for (const [g, n, v] of [
      ['BAFN10', 1.67003, 47.11],
      ['SF5', 1.6727, 32.21],
    ]) {
      const im = O.fromZemax(lens(g));
      assert.deepEqual([im.rows[1].n, im.rows[1].abbe, im.warnings.filter(w => /glass/.test(w))], [n, v, []]);
    }
  });

  test('fields and wavelengths that differ between configurations: each its own, on its pupil row', () => {
    const op = (code, i, vals) => vals.map((v, k) => `${code} ${i} ${k + 1} ${v} 0 0 0 1 1 1 0 0 "" 0`);
    const txt = tel(
      [],
      [
        'MNUM 2 1',
        'MOFF 0 1 "Science" 0 0 0 1 1 0 0.0 "" 0',
        'MOFF 0 2 "Guider" 0 0 0 1 1 0 0.0 "" 0',
        ...op('WAVE', 1, [0.25, 0.6]),
        ...op('WAVE', 2, [0.18, 0.5]),
        ...op('XFIE', 1, [0, 0]),
        ...op('YFIE', 1, [0, 0.1]),
      ],
    )
      .replace('FTYP 0 0 1 1', 'FTYP 0 0 1 2')
      .replace('WAVM 1 0.55 1', 'WAVM 1 0.25 1\r\nWAVM 2 0.18 1');
    const im = O.fromZemax(txt);
    assert.ok(
      !im.warnings.some(w => /not imported per configuration|no on-axis field/.test(w)),
      im.warnings.join('; '),
    );
    assert.deepEqual(
      [im.fields, im.lambda, im.lambdas],
      [[0], 0.25, [0.25, 0.18]],
      'the saved configuration’s',
    );
    const rows = k => O.configRows({ configs: im.configs }, k);
    const beam = ({ fields, lam, lams }) => ({ fields, lam, lams });
    assert.deepEqual(beam(rows(0)[0]), { fields: [0], lam: 0.25, lams: [0.25, 0.18] });
    assert.deepEqual(beam(rows(1)[0]), { fields: [0.1], lam: 0.6, lams: [0.6, 0.5] });
    assert.deepEqual(
      rows(0).slice(1),
      rows(1).slice(1),
      'the optics are shared: the off-axis field does not move the axis',
    );
    // the guider's field lands off the axis by f tan 0.1°
    near(Math.abs(lands(full(rows(1)), [0, 0], 0.1)[1]), 200 * Math.tan(0.1 * rd), 1e-6);
    // alone, a configuration whose only field is off-axis is still rebuilt about that field
    assert.ok(O.fromZemax(txt, { config: 2 }).warnings.some(w => /no on-axis field/.test(w)));
    // and exporting them together says the file can hold only one beam
    const designs = [0, 1].map(k => ({ name: im.configs.list[k].name, rows: full(rows(k)) }));
    assert.ok(
      O.zemaxConfigs(designs).warnings.some(w => /Guider: its entrance pupil or beam differs/.test(w)),
    );
  });

  test('fields and wavelengths the same in every configuration stay off the pupil row', () => {
    const txt = tel(
      [],
      ['MNUM 2 1', 'THIC 4 1 -200 0 0 0 1 1 1 0 0 "" 0', 'THIC 4 2 -190 0 0 0 1 1 1 0 0 "" 0'],
    );
    const p = O.fromZemax(txt).configs.rows[0];
    assert.deepEqual([p.fields, p.lam, p.lams], [undefined, undefined, undefined]);
  });
});

// The drawing's choice of ray points (src/app/draw.js), run here with stand-ins for the app's layout globals.
describe('drawing', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../src/app/draw.js'), 'utf8');
  const part = re => re.exec(src)[0];
  const make = new Function(
    'sys',
    'S',
    'BW',
    'src',
    'lamCol',
    'C',
    `${part(/const otherWaves = [^]*?\n\/\*\* A beam's cone fan/)}*/ ${part(/function drawRange[^]*?\n}\n/)}return { drawRange, otherRays, coneBeams };`,
  );
  const app = f => require('fs').readFileSync(require('path').join(__dirname, '../src/app', f), 'utf8');
  const pts = n => Array.from({ length: n }, (_, i) => ({ p: [0, 0, i] }));

  test('a pupil beyond the first surface is not where rays are drawn from: they start on the first surface', () => {
    const at = t => make({ rows: [{ t }] }, [{}, {}], [], () => [[0, 0, -9]], null).drawRange();
    const zs = P => P.map(p => p[2]);
    assert.deepEqual(zs(at(10).ray(0, pts(3))), [-9, 0, 1, 2], 'the source, the pupil, both surfaces');
    assert.deepEqual(zs(at(-10).ray(0, pts(3))), [1, 2], 'the surfaces only');
    assert.deepEqual(at(10).cone(0, ['src', 'pupil', 's0', 's1']), ['src', 'pupil', 's0', 's1']);
    assert.deepEqual(at(-10).cone(0, ['src', 'pupil', 's0', 's1']), ['s0', 's1']);
  });

  test('the other wavelengths are drawn too, as rays and as cones, from where each parts from the primary', () => {
    const BW = [
      { l: 0.4, from: 1, T: [[pts(4)], [pts(4)]], C: ['c0', 'c1'] },
      { l: 0.7, from: -1, T: [[pts(4)], [pts(4)]], C: [] }, // (nothing disperses it: not drawn again)
    ];
    const S = [{}, {}, {}];
    const { drawRange, otherRays, coneBeams } = make(
      { rows: [{ t: 0 }] },
      S,
      BW,
      () => [],
      l => `λ${l}`,
      ['p0', 'p1'],
    );
    const D = drawRange();
    const rays = otherRays([1, 0], D);
    assert.deepEqual(
      rays.map(r => [r.j, r.col]),
      [
        [1, 'λ0.4'],
        [0, 'λ0.4'],
      ],
    );
    assert.deepEqual(
      rays[0].D.ray(0, rays[0].rs).map(p => p[2]),
      [2, 3],
      'from surface 1 on',
    );
    const [prim, other] = coneBeams({ fc: j => `f${j}` }, D, [0, 1]);
    assert.deepEqual(
      prim.map(b => [b.col, b.C, b.D === D]),
      [
        ['f0', 'p0', true],
        ['f1', 'p1', true],
      ],
    );
    assert.deepEqual(
      other.map(b => [b.col, b.C, b.D.a]),
      [
        ['λ0.4', 'c0', 1],
        ['λ0.4', 'c1', 1],
      ],
    );
    assert.equal(
      coneBeams({ fc: () => '' }, drawRange([0, 0]), [0]).length,
      1,
      'out of the drawn range: the primary only',
    );
  });
});

describe('wavelength colours and spot sizes', () => {
  const app = f => require('fs').readFileSync(require('path').join(__dirname, '../src/app', f), 'utf8');
  const state = app('state.js');
  const lamCol = sys =>
    new Function(
      'sys',
      `${/function lamColor[^]*?\n}\n/.exec(state)[0]}${/function lamCol\([^]*?\n}\n/.exec(state)[0]}return lamCol;`,
    )(sys);
  const spotSize = new Function(
    'nf',
    `${/const spotSize = [^]*?\n};\n/.exec(app('popups.js'))[0]}return spotSize;`,
  )(v => String(+v.toPrecision(4)));

  test('wavelengths outside the visible, which would all look alike, each get a colour of their own', () => {
    const uv = [0.25, 0.18, 0.32];
    assert.equal(new Set(uv.map(lamCol({ lambda: 0.25, lambdas: uv }))).size, 3);
    const ir = [1.55, 1.3];
    assert.equal(new Set(ir.map(lamCol({ lambda: 1.55, lambdas: ir }))).size, 2);
    // all visible: each its own hue, whatever the others are; one alone: its hue too
    const vis = { lambda: 0.55, lambdas: [0.55, 0.45, 0.65] };
    assert.equal(lamCol(vis)(0.45), lamCol({ lambda: 0.45 })(0.45));
    assert.equal(
      lamCol({ lambda: 0.25 })(0.25),
      lamCol({ lambda: 0.3 })(0.3),
      'a single ultraviolet one: violet',
    );
  });

  test('a spot’s size has its unit, and can be the FWHM of a Gaussian spot with that RMS radius', () => {
    assert.equal(spotSize(0.0123), '12.3 µm');
    assert.equal(spotSize(0.25), '0.25 mm');
    assert.equal(spotSize(0.01, true), '16.65 µm', '2 √(ln 2) × the RMS radius');
  });
});

describe('the reference wavelength', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../src/app/controls.js'), 'utf8');
  const make = sys =>
    new Function(
      'sys',
      `${/const parseLams = [^]*?\n};\n/.exec(src)[0]}${/const refMoves = [^\n]*\n/.exec(src)[0]}return { parseLams, refMoves };`,
    )(sys);

  test('wavelengths as typed: one or several, the first the reference', () => {
    const { parseLams } = make({});
    assert.deepEqual(parseLams('0.25, 0.18 0.32'), [0.25, 0.18, 0.32]);
    assert.deepEqual(parseLams(' 0.55 '), [0.55]);
    for (const bad of ['', '0', '0.5, x', '-1']) assert.equal(parseLams(bad), null, bad);
  });

  test('changing it moves optics only with a grating: that is when the app asks first', () => {
    const plain = { lambda: 0.5, rows: [{}, { type: 'mirror' }] };
    const grating = { lambda: 0.5, rows: [{}, { type: 'mirror', lines: 600 }] };
    assert.equal(make(plain).refMoves([0.6]), false, 'no grating: nothing moves');
    assert.equal(make(grating).refMoves([0.6, 0.5]), true);
    assert.equal(
      make(grating).refMoves([0.5, 0.6, 0.4]),
      false,
      'the same reference, other wavelengths added',
    );
    // and it does move them: the surface after the grating is somewhere else
    const rows = l => [{ t: 50, ap: 5, lam: l }, mirror({ tilt: 10, lines: 600, order: 1, t: 100 }), surf()];
    const P = l => O.build(rows(l))[1].P;
    assert.ok(Math.hypot(...O.add(P(0.5), P(0.6), -1)) > 5);
  });
});

describe('where another wavelength parts from the reference (what the layout draws of it)', () => {
  const lam = 0.55;
  const from = rows => {
    const S = O.build(rows);
    return O.partsFrom(S, O.atWavelength(S, rows, 0.45, lam), [0, 0.5]);
  };
  const lens = [surf({ R: 60, n: 1.5168, abbe: 64.17, t: 5 }), surf({ R: -60, t: 50 })];

  test('a lens’s colour alone is not drawn apart; a grating or a prism is, from that surface on', () => {
    assert.equal(
      from([{ t: 10, ap: 5, lam }, ...lens, surf()]),
      -1,
      'a lens: the focus shifts, the beam hardly turns',
    );
    const grating = mirror({ tilt: 10, lines: 600, order: 1, t: 50 });
    assert.equal(
      from([{ t: 10, ap: 5, lam }, ...lens, grating, surf()]),
      2,
      'from the grating, not the lens before it',
    );
    const prism = [surf({ tilt: 30, n: 1.72825, abbe: 28.41, t: 10 }), surf({ tilt: -30, t: 50 })];
    assert.equal(
      from([{ t: 10, ap: 5, lam }, surf({ t: 20 }), ...prism, surf()]),
      1,
      'from a prism’s first face',
    );
    const S = O.build([{ t: 10, ap: 5 }, mirror({ t: 10 }), surf()]);
    assert.equal(O.partsFrom(S, S), -1, 'nothing disperses');
    const rows = [{ t: 10, ap: 5, lam }, surf({ t: 100 }), { ...grating, ap: 2 }, surf()];
    const Sg = O.build(rows); // (a 2° field walks off the small grating: its chief ray misses it, part of its beam doesn't)
    assert.equal(O.trace(Sg, 0, 0, 2).length, 1);
    assert.equal(
      O.partsFrom(Sg, O.atWavelength(Sg, rows, 0.45, lam), [2]),
      1,
      'a grating the chief ray misses still parts the light',
    );
  });
});
