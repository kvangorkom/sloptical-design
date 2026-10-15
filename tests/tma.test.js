// The TMA example: three plain conics whose aberrations cancel between them, diffraction
// limited across its field. Run: node --test
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const O = require('../src/engine');

const ctx = {};
vm.createContext(ctx);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '../src/app/presets.js'), 'utf8') +
    ';this.PRESETS = PRESETS; this.DEFAULT_DESIGN = DEFAULT_DESIGN; this.NEW_DESIGN = NEW_DESIGN',
  ctx,
);
const DEF = { name: '', type: 'refract', R: 0, k: 0, d: 0, tilt: 0, t: 0, n: 1, ap: 0 };

test('TMA: diffraction limited (RMS WFE < λ/14) across ±0.05°; flat field; no mirror stigmatic alone', () => {
  const rows = ctx.PRESETS.TMA.rows.map(r => ({ ...DEF, ...r }));
  assert.equal(O.applySolves(rows).size, 0);
  const S = O.build(rows);
  const lam = 0.55e-3; // mm
  for (const f of [0, 0.05, -0.05, [0.05, 0], [-0.05, 0], [0.05, 0.05], [0.05, -0.05], [-0.05, 0.05]]) {
    const b = O.bundle(S, rows[0].ap, 21, f);
    const w = O.wavefrontIn(S, b);
    assert.equal(w.kept, 1, `no rays lost at ${f}`);
    const rms = Math.sqrt(w.opd.reduce((a, v) => a + v * v, 0) / w.opd.length) / lam;
    assert.ok(rms < 1 / 14, `field ${JSON.stringify(f)}: ${rms.toFixed(3)} waves`);
  }
  const [p, s, t] = [1, 2, 3].map(i => Math.abs(rows[i].R));
  assert.ok(Math.abs(1 / p - 1 / s + 1 / t) < 0.02 / s, 'Petzval sum ≈ 0');
  assert.deepEqual(
    [0, 1, 2].map(i => O.stigmatic(S, i)),
    [false, false, false],
  );
  assert.equal(rows[4].R, 0, 'a fold flat before the image');
});

test('a new design: one off-axis paraboloid, imaging perfectly onto its focal plane', () => {
  const rows = ctx.NEW_DESIGN.rows.map(r => ({ ...DEF, ...r }));
  const t = rows[1].t;
  assert.equal(O.applySolves(rows).size, 0);
  assert.ok(Math.abs(rows[1].t - t) < 1e-6, 'its focus where it says');
  const S = O.build(rows);
  assert.equal(S.filter(s => s.mirror).length, 1);
  assert.equal(O.stigmatic(S, 0), true);
});

test('a first visit opens the OAP + off-axis ellipsoid example', () => {
  assert.equal(ctx.DEFAULT_DESIGN, 'OAP + off-axis ellipsoid');
  const rows = ctx.PRESETS[ctx.DEFAULT_DESIGN].rows.map(r => ({ ...DEF, ...r }));
  assert.equal(O.applySolves(rows).size, 0);
});
