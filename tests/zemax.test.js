// Paraxial (ideal) lenses, and Zemax import of real OpticStudio files: configurations, coordinate breaks with their dummy
// surfaces, systems used off-axis, and catalogue glasses. Run: node --test
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const O = require('../src/engine');

const surf = o => ({ name: '', type: 'refract', R: 0, k: 0, d: 0, tilt: 0, t: 0, n: 1, ap: 0, ...o });
const near = (a, b, tol, msg = '') =>
  assert.ok(Math.abs(a - b) <= tol, `${msg} got ${a}, expected ${b} ± ${tol}`);
const rmsWFE = w => Math.sqrt(w.opd.reduce((s, v) => s + v * v, 0) / w.opd.length);
const zmx = (head, surfs) =>
  [...head, ...surfs.flatMap((s, i) => [`SURF ${i}`, ...s.map(l => '  ' + l)])].join('\r\n');
const full = rows => rows.map((r, i) => (i ? surf(r) : { R: 0, ...r }));

describe('paraxial (ideal) lens', () => {
  test('a collimated beam at any angle focuses perfectly at f·tan θ on the focal plane, wavefront and all', () => {
    const f = 200;
    const rows = [{ t: 0, ap: 10 }, surf({ type: 'paraxial', f, t: f }), surf()];
    const S = O.build(rows);
    for (const fld of [0, 3, [2, -4]]) {
      const [fx, fy] = Array.isArray(fld) ? fld : [0, fld];
      const pts = O.grid(10, 15).map(([x, y]) => O.trace(S, x, y, fld)[1].p);
      for (const p of pts) {
        near(p[0], f * Math.tan((fx * Math.PI) / 180), 1e-9, `x at ${fld}`);
        near(p[1], f * Math.tan((fy * Math.PI) / 180), 1e-9, `y at ${fld}`);
      }
      near(rmsWFE(O.wavefrontIn(S, O.bundle(S, 10, 15, fld))), 0, 1e-9, `wavefront at ${fld}`);
    }
    near(O.efl(S, 1e-3), f, 1e-6, 'EFL');
  });

  test('tilted, or diverging (a virtual focus f before it), it is still perfect; its type round-trips through Zemax', () => {
    for (const lens of [
      { f: 150, tilt: 12 },
      { f: -150, tilt: 0 },
    ]) {
      const rows = [{ t: 20, ap: 8 }, surf({ type: 'paraxial', ...lens, t: 100 }), surf()];
      const S = O.build(rows);
      for (const fld of [0, [1, 2]])
        near(rmsWFE(O.wavefrontIn(S, O.bundle(S, 8, 15, fld))), 0, 1e-9, `f ${lens.f} at ${fld}`);
      const txt = O.zemax(rows);
      assert.match(txt, /TYPE PARAXIAL[\s\S]*PARM 1 /);
      const back = O.fromZemax(txt).rows.find(r => r.type === 'paraxial');
      near(back.f, lens.f, 1e-9, 'focal length back');
    }
  });

  test('a focus solve on its focal length puts the focus on the next surface', () => {
    const rows = [
      { t: 0, ap: 5 },
      surf({ type: 'paraxial', f: 80, t: 120, solve: { f: { type: 'focus' } } }),
      surf(),
    ];
    assert.equal(O.applySolves(rows).size, 0);
    near(rows[1].f, 120, 1e-6);
    assert.deepEqual(O.solvesFor(rows, 1, 'R'), []);
  });

  test('a long 3D train (many tilted plates) keeps every ray direction a unit vector', () => {
    const rows = [{ t: 10, ap: 5 }];
    for (let i = 0; i < 40; i++)
      rows.push(
        surf({ tilt: 3 + (i % 5), tiltY: -4 + (i % 7), clock: 1, n: i % 2 ? 1 : 1.5, t: i % 2 ? 20 : 3 }),
      );
    rows.push(surf());
    const S = O.build(rows);
    const tr = O.trace(S, 1, 2, [0.1, 0.2]);
    assert.equal(tr.length, S.length);
    for (const r of tr) near(Math.hypot(...r.u), 1, 1e-14);
  });
});

describe('Zemax import: real OpticStudio files', () => {
  test('one configuration (configs: false): the surfaces the saved one ignores (IGNM) are left out, thickness and all', () => {
    const file = conf =>
      zmx(
        [
          `MNUM 2 ${conf}`,
          'FLOA',
          'FTYP 0 0 1 1',
          'YFLN 0',
          'MOFF 0 1 "Plate out" 0 0 0 1 1 0 0.0 "" 0',
          'MOFF 0 2 "Plate in" 0 0 0 1 1 0 0.0 "" 0',
          'IGNM 2 1 1.0E+00 0 3 0 1 1 1 0 0 "" 0',
          'IGNM 2 2 0.0E+00 0 3 0 1 1 1 0 0 "" 0',
        ],
        [
          ['DISZ INFINITY'],
          ['COMM Lens', 'STOP', 'TYPE PARAXIAL', 'PARM 1 100', 'PARM 2 1', 'DISZ 40', 'DIAM 5'],
          ['COMM Plate', 'GLAS N-BK7 0 0 1 0', 'DISZ 5'],
          ['COMM Plate back', 'DISZ 50'],
          ['COMM Image'],
        ],
      );
    const out = O.fromZemax(file(1), { configs: false });
    assert.deepEqual(
      out.rows.slice(1).map(r => r.name),
      ['Lens', 'Image'],
    );
    near(out.rows[1].t, 40, 1e-12, 'the plate’s thicknesses go too');
    assert.ok(out.warnings.some(w => /configuration 1 \(Plate out\).*ignores \(2–3\)/.test(w)));
    const inn = O.fromZemax(file(2), { configs: false });
    assert.deepEqual(
      inn.rows.slice(1).map(r => r.name),
      ['Lens', 'Plate', 'Plate back', 'Image'],
    );
    near(inn.rows[2].n, 1.5168, 1e-12, 'N-BK7 by name (the 1 written beside it is a placeholder)');
  });

  test('every configuration: the rows each has (IGNM), the values that differ (THIC, CRVT, PRAM, GLSS, MCOM) its own', () => {
    const txt = zmx(
      [
        'MNUM 2 1',
        'FLOA',
        'FTYP 0 0 1 1',
        'YFLN 0',
        'MOFF 0 1 "Plate out" 0 0 0 1 1 0 0.0 "" 0',
        'MOFF 0 2 "Plate in" 0 0 0 1 1 0 0.0 "" 0',
        'MOFF 0 1 "plate OUT" 0 0 0 1 1 0 0.0 "" 0',
        'IGNM 3 1 1.0E+00 0 4 0 1 1 1 0 0 "" 0',
        'IGNM 3 2 0.0E+00 0 4 0 1 1 1 0 0 "" 0',
        'THIC 5 1 3.0E+01 0 0 0 1 1 1 0 0 "" 0',
        'THIC 5 2 4.5E+01 0 0 0 1 1 1 0 0 "" 0',
        'CRVT 6 1 -2.5E-03 0 0 0 1 1 1 0 0 "" 0',
        'CRVT 6 2 -5.0E-03 0 0 0 1 1 1 0 0 "" 0',
        'PRAM 2 1 0.0E+00 0 4 0 1 1 1 0 0 "" 0',
        'PRAM 2 2 2.0E+00 0 4 0 1 1 1 0 0 "" 0',
        'GLSS 3 1 "N-BK7" 0 0 0 1 1 0 0.0 "" 0',
        'GLSS 3 2 "F2" 0 0 0 1 1 0 0.0 "" 0',
        'MCOM 6 1 "Mirror A" 0 0 0 1 1 0 0.0 "" 0',
        'MCOM 6 2 "Mirror B (spare)" 0 0 0 1 1 0 0.0 "" 0',
        'WAVE 1 1 5.5E-01 0 0 0 1 1 1 0 0 "" 0',
        'WAVE 1 2 6.3E-01 0 0 0 1 1 1 0 0 "" 0',
      ],
      [
        ['DISZ INFINITY'],
        ['COMM Lens', 'STOP', 'TYPE PARAXIAL', 'PARM 1 100', 'PARM 2 1', 'DISZ 40', 'DIAM 5'],
        ['TYPE COORDBRK', 'PARM 4 0', 'DISZ 0'],
        ['COMM Plate', 'GLAS N-BK7 0 0 1 0', 'DISZ 5'],
        ['COMM Plate back', 'DISZ 20'],
        ['COMM Fold plane', 'DISZ 30'],
        ['COMM Mirror A', 'CURV -2.5E-03', 'GLAS MIRROR', 'DISZ -100'],
        ['COMM Image'],
      ],
    );
    const im = O.fromZemax(txt, { plane: 'auto' });
    assert.equal(
      im.plane,
      'xz',
      'the plane every configuration lies in (the break in configuration 2 tilts about y)',
    );
    const C = im.configs;
    assert.deepEqual(
      C.list.map(c => c.name),
      ['Plate out', 'Plate in'],
    );
    assert.equal(C.active, 0, 'the saved one');
    const rows = k => O.configRows({ configs: C }, k);
    assert.deepEqual(
      rows(0).map(r => r.name),
      [undefined, 'Lens', 'Fold plane', 'Mirror A', 'Image'],
    );
    assert.deepEqual(
      rows(1).map(r => r.name),
      [undefined, 'Lens', 'Plate', 'Plate back', 'Fold plane', 'Mirror B (spare)', 'Image'],
    );
    assert.deepEqual(im.rows, rows(0), 'the rows shown are the saved configuration’s');
    assert.deepEqual(C.rows.find(r => r.name === 'Plate').only, ['c2']);
    const [a, b] = [rows(0), rows(1)];
    near(a[2].t, 30, 1e-9);
    near(b[4].t, 45, 0.05, 'THIC (along the axis ray, which the tilted plate shifts)');
    near(a[3].R, -400, 1e-9);
    near(b[5].R, -200, 1e-9, 'CRVT');
    near(b[2].n, 1.62004, 1e-5, 'GLSS: F2');
    near(b[2].tilt, 2, 1e-9, 'PRAM: the break tilts the plate in configuration 2');
    assert.ok(!a[2].tilt);
    assert.ok(im.warnings.some(w => /not imported per configuration.*WAVE/.test(w)));
    assert.ok(
      im.warnings.some(w => /^2 configurations: Plate out \(4 surfaces\); Plate in \(6 surfaces\)/.test(w)),
    );
    // and a design made of them works as one: switching shows each
    const sys = { rows: im.rows, configs: C };
    O.setActive(sys, 1);
    assert.deepEqual(sys.rows, rows(1));
  });

  // A paraboloid reached through coordinate breaks and dummy surfaces, as optimisation leaves a file: a pivot break, a
  // hidden "optimize" dummy, the OAP, a break back, an unnamed dummy and a named focal plane.
  const oap = [
    ['DISZ INFINITY'],
    ['COMM Pupil', 'STOP', 'DISZ 200', 'DIAM 10'],
    ['TYPE COORDBRK', 'PARM 1 0', 'PARM 2 50', 'PARM 3 0', 'PARM 4 0', 'PARM 5 0', 'PARM 6 0', 'DISZ 0'],
    ['COMM Optimize DZ', 'HIDE 1 0 1 0 0 0 0 0 0 0 0 0 0', 'DISZ 7'],
    ['COMM OAP', 'CURV -2.5E-03', 'CONI -1', 'GLAS MIRROR 0 0 1.5 40 0 0 0 0 0 0', 'DISZ -100'],
    ['TYPE COORDBRK', 'PARM 1 0', 'PARM 2 -50', 'PARM 3 0', 'PARM 4 0', 'PARM 5 0', 'PARM 6 0', 'DISZ 0'],
    ['DISZ -100'],
    ['COMM Focus'],
  ];
  const head = ['FLOA', 'FTYP 0 0 2 1', 'YFLN 0 0.2'];

  test('coordinate breaks vanish into absolute placement; their unnamed or hidden dummy surfaces are dropped, optics kept in place', () => {
    const lean = O.fromZemax(zmx(head, oap));
    const all = O.fromZemax(zmx(head, oap), { keepDummies: true });
    assert.deepEqual(
      lean.rows.slice(1).map(r => r.name),
      ['OAP', 'Focus'],
    );
    assert.ok(all.rows.length > lean.rows.length);
    assert.ok(lean.warnings.some(w => /2 dummy surfaces/.test(w)));
    const [A, B] = [O.build(full(lean.rows)), O.build(full(all.rows))];
    const pick = (S, n) => S.find(s => s.name === n);
    for (const n of ['OAP', 'Focus']) {
      near(Math.hypot(...O.add(pick(A, n).V, pick(B, n).V, -1)), 0, 1e-9, `${n} where it was`);
      near(Math.hypot(...O.add(pick(A, n).ez, pick(B, n).ez, -1)), 0, 1e-12, `${n} facing as it was`);
    }
    // and the OAP (f = 200, beam 50 off its axis) focuses the on-axis field perfectly on the focal plane
    near(Math.hypot(...O.add(O.inFocus(A, 1), A[1].P, -1)), 0, 1e-6, 'focus on the focal plane');
    near(rmsWFE(O.wavefrontIn(A, O.bundle(A, 10, 15, 0))), 0, 1e-9);
  });

  test('a system used off-axis (no on-axis field) takes field 1’s chief ray as its axis; the fields become angles from it', () => {
    const im = O.fromZemax(
      zmx(
        ['FLOA', 'FTYP 0 0 3 1', 'XFLN -3 -3 -2.9', 'YFLN 6 6.1 6'],
        [
          ['DISZ INFINITY'],
          ['COMM Telescope', 'STOP', 'TYPE PARAXIAL', 'PARM 1 1000', 'PARM 2 1', 'DISZ 1000', 'DIAM 20'],
          ['COMM Focal plane'],
        ],
      ),
      { plane: '3d' },
    );
    assert.ok(im.warnings.some(w => /field 1’s chief ray|field 1's chief ray/.test(w)));
    assert.equal(im.fields[0], 0);
    near(im.fields[1][1], 0.1, 2e-3, 'field 2: 0.1° up from field 1');
    near(im.fields[2][0], 0.1, 2e-3, 'field 3: 0.1° across');
    const S = O.build(full(im.rows));
    const lens = S.find(s => s.para);
    near(
      Math.acos(lens.ez[2]) * (180 / Math.PI),
      Math.atan(Math.hypot(Math.tan((3 * Math.PI) / 180), Math.tan((6 * Math.PI) / 180))) * (180 / Math.PI),
      1e-6,
      'the lens tilted to the beam by field 1’s angle',
    );
    near(rmsWFE(O.wavefrontIn(S, O.bundle(S, im.rows[0].ap, 15, 0))), 0, 1e-9, 'field 1 focuses perfectly');
  });

  test('glasses: a catalogue name wins over the placeholder n_d written beside it; model glasses and unknown names use the file’s values', () => {
    const im = O.fromZemax(
      zmx(
        ['ENPD 10', 'FTYP 0 0 1 1', 'YFLN 0'],
        [
          ['DISZ INFINITY'],
          ['STOP', 'DISZ 10'],
          ['GLAS BK7 0 0 1.5 40 0 0 0 0 0 0', 'DISZ 2'],
          ['DISZ 10'],
          ['GLAS ___BLANK 1 0 1.6 40 0 0 0 0 0 0', 'DISZ 2'],
          ['DISZ 10'],
          ['GLAS MYGLASS 0 0 1.7 30 0 0 0 0 0 0', 'DISZ 2'],
          ['DISZ 10'],
          [],
        ],
      ),
      { keepDummies: true },
    );
    assert.deepEqual(
      im.rows.filter(r => r.n > 1).map(r => r.n),
      [1.5168, 1.6, 1.7],
    );
    assert.ok(im.warnings.some(w => /MYGLASS: n_d 1.7/.test(w)));
  });
});
