// Cross-checks against batoid and optiland: ray traces, EFL, f/#, spot sizes and wavefront errors from this tool are
// compared with the libraries' own, for this tool's designs (exported with File ▸ Export batoid / optiland, so the
// exporters are checked too) and for the designs that ship with the libraries (optiland's sample lenses and batoid's
// telescopes, read into this tool). The libraries are run by tests/xcheck/ref.py; without python3 and them, every check
// here is skipped (pip install batoid optiland). Run: node --test
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const O = require('../src/engine');

const REF = path.join(__dirname, 'xcheck', 'ref.py');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'xcheck-'));
function python(reqs) {
  const r = spawnSync(process.env.PYTHON || 'python3', [REF], {
    input: JSON.stringify(reqs),
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    timeout: 900000,
  });
  if (r.error || r.status) throw Error(`ref.py: ${r.error?.message ?? r.stderr.slice(-2000)}`);
  const out = JSON.parse(r.stdout);
  out.forEach(o => {
    if (o?.error) throw Error(`ref.py: ${o.error}\n${o.trace ?? ''}`);
  });
  return out;
}
let have = { batoid: false, optiland: false };
try {
  have = python([{ op: 'has' }])[0];
} catch {}
const skip = lib => !have[lib] && `${lib} not available (pip install ${lib})`;

const DEF = { name: '', type: 'refract', R: 0, k: 0, d: 0, tilt: 0, t: 0, n: 1, ap: 0 };
const rows = (pupil, ...R) => [pupil, ...R.map(r => ({ ...DEF, ...r }))];
const mirror = o => ({ type: 'mirror', ...o });
const near = (a, b, tol, msg = '') =>
  assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} ± ${tol}`);

// ── This tool's results ─────────────────────────────────────────────────────────────────────────────────────────────
/** Per field: each pupil point's hit on the last surface (world point, null if lost). */
const hits = (S, pts, f) =>
  pts.map(([x, y]) => {
    const r = O.trace(S, x, y, f);
    return r.length === S.length ? r.at(-1).p : null;
  });
/** RMS spot radius on the last surface's plane, from this tool's own footprint code. */
const spotOf = (S, pts, f) => {
  const s = S.at(-1);
  const rs = pts
    .map(([x, y]) => O.trace(S, x, y, f))
    .filter(r => r.length === S.length)
    .map(r => r.at(-1));
  return O.spot(O.toPlane(rs, s.P, s.ez).map(q => q.xy)).rms;
};
/** RMS spot radius of 3D points on a plane, about their centroid (for the libraries' hits). */
const spot3 = P => {
  const Q = P.filter(Boolean);
  const m = [0, 1, 2].map(k => Q.reduce((a, p) => a + p[k], 0) / Q.length);
  return Math.sqrt(
    Q.reduce((a, p) => a + (p[0] - m[0]) ** 2 + (p[1] - m[1]) ** 2 + (p[2] - m[2]) ** 2, 0) / Q.length,
  );
};
/** RMS wavefront error (waves) at the last surface after piston, tilt and focus. */
const wfeOf = (S, a, f, lambda) => {
  const w = O.wavefrontIn(S, O.bundle(S, a, 41, f));
  return w && Math.sqrt(w.opd.reduce((s, v) => s + v * v, 0) / w.opd.length) / (lambda * 1e-3);
};

// Tolerances: the traces are exact in both (double precision), so hits agree to round-off; the wavefront errors are each
// tool's own fit of a sampled wavefront (here a 41×41 grid, there a 129 × 129 or 48 × 48 one), so they agree to sampling.
const HIT = 1e-7;
const EFL = 2e-5;
const WFE = w => 0.03 * w + 2e-3;

function compareHits(ours, theirs, scale, msg, only = [0, 1, 2]) {
  let n = 0;
  ours.forEach((p, i) => {
    const q = theirs[i];
    if (!p || !q) return;
    n++;
    const d = Math.hypot(...only.map(k => p[k] - q[k]));
    assert.ok(d <= HIT * (1 + scale), `${msg} ray ${i}: ${p} vs ${q} (Δ ${d})`);
  });
  assert.ok(n >= ours.length * 0.6, `${msg}: only ${n} of ${ours.length} rays compared`);
}

// ── Designs ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const DESIGNS = {
  'Cassegrain, conics off their stigmatic values': {
    lambda: 0.55,
    fields: [0, 0.1],
    wfe: true,
    rows: rows(
      { t: 500, ap: 100 },
      mirror({ R: -2000, k: -1.1, t: 750 }),
      mirror({ R: 666.667, k: -3.5, t: 1000, solve: { t: { type: 'focus' } } }),
      {},
    ),
  },
  'Ritchey–Chrétien f/8': {
    lambda: 0.6,
    fields: [0, 0.15, 0.3],
    wfe: true,
    rows: rows(
      { t: 300, ap: 50 },
      mirror({ R: -1200, k: -1.0779, t: 450 }),
      mirror({ R: -406.42, k: -5.3965, t: 600, solve: { t: { type: 'focus' } } }),
      {},
    ),
  },
  'Singlet f/5, two fields': {
    lambda: 0.55,
    fields: [0, 5],
    wfe: true,
    rows: rows(
      { t: 20, ap: 10 },
      { R: 100, t: 5, n: 1.5168 },
      { R: -100, t: 94.859, solve: { t: { type: 'focus' } } },
      {},
    ),
  },
  'Cooke triplet (this tool)': {
    lambda: 0.55,
    fields: [0, 10, 20],
    wfe: true,
    rows: rows(
      { t: -11.512, ap: 5 },
      { R: 22.01359, t: 3.25896, n: 1.6226 },
      { R: -435.76044, t: 6.00755 },
      { R: -22.21328, t: 0.99997, n: 1.62366 },
      { R: 20.29192, t: 4.75041 },
      { R: 79.6836, t: 2.95208, n: 1.6226 },
      { R: -18.39533, t: 42.20778, solve: { t: { type: 'focus' } } },
      {},
    ),
  },
  'Fold mirror and a tilted lens': {
    lambda: 0.55,
    fields: [0, 1],
    wfe: true,
    rows: rows(
      { t: 100, ap: 10 },
      mirror({ tilt: 45, t: 50 }),
      { R: 80, n: 1.6, t: 5, tilt: 3 },
      { R: -80, t: 90, solve: { t: { type: 'focus' } } },
      {},
    ),
  },
  'OAP relay (afocal)': {
    lambda: 0.55,
    fields: [0, 0.5],
    rows: rows(
      { t: 300, ap: 25 },
      mirror({ R: -1000, k: -1, d: 150, t: 511.25 }),
      { t: 511.25 },
      mirror({ R: -1000, k: -1, d: 150, tilt: -17.0604, t: 400 }),
      {},
    ),
  },
  'Fiber collimator (a beam from a focus)': {
    lambda: 0.55,
    fields: [0, 1],
    rows: rows({ t: 10, ap: 10, R: -90 }, { t: 6, n: 1.5168 }, { R: -51.68, t: 60 }, {}),
  },
  'Singlet turned out of the plane (3D: tilt y, clock, an (x, y) field)': {
    lambda: 0.55,
    fields: [0, [2, 1]],
    wfe: true,
    only: 'batoid',
    rows: rows(
      { t: 20, ap: 8 },
      { R: 100, t: 5, n: 1.5168, tiltY: 3, clock: 25 },
      { R: -100, t: 94.859, tilt: 1, solve: { t: { type: 'focus' } } },
      {},
    ),
  },
  'OAP and an off-axis ellipsoid, out of the plane (3D)': {
    lambda: 0.55,
    fields: [0, [0.2, 0.1]],
    only: 'batoid',
    rows: rows(
      { t: 300, ap: 25 },
      mirror({ R: -1000, k: -1, d: 150, t: 511.25, clock: 30 }),
      { t: 300 },
      mirror({
        R: -500,
        k: -0.2,
        oa: 'angle',
        d: 20,
        tilt: -30,
        tiltY: 12,
        clock: -20,
        t: 400,
        solve: { t: { type: 'focus' } },
      }),
      {},
    ),
  },
};

describe(
  'this tool against batoid (its designs, exported as batoid scripts)',
  { skip: skip('batoid') },
  () => {
    Object.values(DESIGNS).forEach(d => O.applySolves(d.rows)); // (focus solves: the image where the beam focuses)
    const list = Object.entries(DESIGNS);
    const reqs = list.map(([name, d], i) => {
      const file = path.join(TMP, `b${i}.py`);
      fs.writeFileSync(file, O.toPython(d.rows, 'batoid', { fields: d.fields, lambda: d.lambda }));
      return { op: 'batoid', script: file, pupil: O.grid(d.rows[0].ap, 9), fields: d.fields, wfe: !!d.wfe };
    });
    const res = have.batoid ? python(reqs) : [];
    list.forEach(([name, d], i) =>
      test(name, () => {
        applySolves(d.rows);
        const S = O.build(d.rows);
        const a = d.rows[0].ap;
        const pts = O.grid(a, 9);
        const r = res[i];
        const scale = Math.max(...S.map(s => Math.hypot(...s.V)));
        d.fields.forEach((f, k) => {
          compareHits(hits(S, pts, f), r.hits[k], scale, `field ${JSON.stringify(f)}`);
          near(spotOf(S, pts, f), spot3(r.hits[k]), 1e-6 * (1 + spot3(r.hits[k])), `field ${f} RMS spot`);
          if (d.wfe) near(wfeOf(S, a, f, d.lambda), r.wfe[k], WFE(r.wfe[k]), `field ${f} RMS WFE (waves)`);
        });
        const efl = O.efl(S, a * 1e-4);
        if (r.efl && Math.abs(efl) < 1e5 * a)
          near(Math.abs(efl), Math.abs(r.efl), EFL * Math.abs(r.efl), 'EFL'); // (not afocal)
      }),
    );
  },
);

// optiland's wavefront analysis finds its exit pupil paraxially, which needs a coaxial design with the stop (here, the
// pupil, which the export makes its first surface) ahead of the optics: only those are compared.
const owfe = d => !!d.wfe && d.rows[0].t >= 0 && d.rows.slice(1).every(r => !r.tilt && !r.tiltY && !r.d);
describe(
  'this tool against optiland (its designs, exported as optiland scripts)',
  { skip: skip('optiland') },
  () => {
    Object.values(DESIGNS).forEach(d => O.applySolves(d.rows));
    const list = Object.entries(DESIGNS).filter(([, d]) => d.only !== 'batoid' && !d.rows[0].R);
    const reqs = list.map(([name, d], i) => {
      const file = path.join(TMP, `o${i}.py`);
      fs.writeFileSync(file, O.toPython(d.rows, 'optiland', { fields: d.fields, lambda: d.lambda }));
      return { op: 'optiland', script: file, pupil: O.grid(1, 9), fields: d.fields, wfe: owfe(d) };
    });
    const res = have.optiland ? python(reqs) : [];
    list.forEach(([name, d], i) =>
      test(name, () => {
        applySolves(d.rows);
        const S = O.build(d.rows);
        const a = d.rows[0].ap;
        const pts = O.grid(a, 9);
        const r = res[i];
        const scale = Math.max(...S.map(s => Math.hypot(...s.V)));
        d.fields.forEach((f, k) => {
          compareHits(hits(S, pts, f), r.hits[k], scale, `field ${f}`);
          if (owfe(d)) near(wfeOf(S, a, f, d.lambda), r.wfe[k], WFE(r.wfe[k]), `field ${f} RMS WFE (waves)`);
        });
        const efl = O.efl(S, a * 1e-4);
        if (Math.abs(efl) < 1e5 * a) {
          near(Math.abs(efl), Math.abs(r.efl), EFL * Math.abs(r.efl), 'EFL');
          near(Math.abs(efl) / (2 * a), Math.abs(r.fno), EFL * Math.abs(r.fno), 'f/#');
        }
      }),
    );
  },
);

// The libraries' designs: traced exactly as there (hits, EFL, f/#). Wavefront errors (image-space NA ≤ 0.3 and fields
// within 30°) are compared with batoid: its own for its telescopes, and for optiland's lenses traced through this tool's
// export of them; and with optiland's own analysis where under 5 waves. Beyond those, the tools' reference spheres and
// pupil mappings part ways (the Edmund 49-847 at NA 0.5: optiland 41 waves, batoid and here 49): each is right by its own
// definition, so there is nothing to check.
describe(
  'the libraries’ own designs, read into this tool',
  { skip: !have.batoid && !have.optiland && 'neither batoid nor optiland available' },
  () => {
    const P = O.grid(1, 9);
    const samples = have.batoid || have.optiland ? python([{ op: 'samples', pupil: P }])[0] : [];
    const rowsOf = s =>
      rows(
        { t: s.pupil_t, ap: s.ap },
        ...s.rows.map(r =>
          r.mirror ? mirror({ R: r.R, k: r.k, t: r.t }) : { R: r.R, k: r.k, t: r.t, n: r.n / (s.n_air ?? 1) },
        ),
      );
    const viaBatoid = have.batoid
      ? python(
          samples.map((s, i) => {
            if (s.skip || s.lib !== 'optiland') return { op: 'has' };
            const file = path.join(TMP, `s${i}.py`);
            fs.writeFileSync(file, O.toPython(rowsOf(s), 'batoid', { fields: s.fields, lambda: s.lambda }));
            return { op: 'batoid', script: file, pupil: [[0, 0]], fields: s.fields, wfe: true };
          }),
        )
      : [];
    samples.forEach((s, i) =>
      test(`${s.lib}: ${s.name}`, { skip: s.skip && `not describable here: ${s.skip}` }, () => {
        const nAir = s.n_air ?? 1;
        const S = O.build(rowsOf(s));
        const a = s.ap;
        const pts = P.map(([x, y]) => [x * a, y * a]);
        const scale = Math.max(...S.map(q => Math.hypot(...q.V)));
        const zEP = s.lib === 'optiland' ? -s.pupil_t : 0; // optiland's z starts at its first surface; ours at the pupil
        s.fields.forEach((f, k) => {
          const ours = hits(S, pts, f);
          const theirs = s.hits[k].map(q => q && [q[0], q[1], q[2] - zEP]);
          if (theirs.filter(Boolean).length < 0.6 * theirs.length) return; // (rays aimed at the paraxial pupil are lost at their extreme fields: here too)
          compareHits(ours, theirs, scale, `field ${f}°`, s.lib === 'optiland' ? [0, 1] : [0, 1, 2]);
          if (Math.abs(f) > 30) return; // (wavefront errors: beyond 30°, pupil distortion makes each tool's tilt and focus its own)
          const w = wfeOf(S, a, f, s.lambda) / nAir;
          if (!(s.na <= 0.3)) return; // (see above: high NA)
          if (s.lib === 'batoid' || s.wfe[k] < 5)
            near(w, s.wfe[k], WFE(s.wfe[k]), `field ${f}° RMS WFE (waves), against ${s.lib}`);
          if (viaBatoid[i]?.wfe)
            near(
              w,
              viaBatoid[i].wfe[k],
              WFE(viaBatoid[i].wfe[k]),
              `field ${f}° RMS WFE (waves), against batoid`,
            );
        });
        const efl = O.efl(S, a * 1e-4);
        near(Math.abs(efl), Math.abs(s.efl), EFL * Math.abs(s.efl), 'EFL');
        if (s.fno) near(Math.abs(efl) / (2 * a), Math.abs(s.fno), EFL * Math.abs(s.fno), 'f/#');
      }),
    );
  },
);

function applySolves(R) {
  O.applySolves(R);
}
