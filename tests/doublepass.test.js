// Double pass (the light back off the last mirror through the same optics), the caliball, reversing a system, and
// paraxial lenses at finite conjugates. Run: node --test
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const O = require('../src/engine');

const surf = o => ({ name: '', type: 'refract', R: 0, k: 0, d: 0, tilt: 0, t: 0, n: 1, ap: 0, ...o });
const mirror = o => surf({ type: 'mirror', ...o });
const full = rows => rows.map((r, i) => (i ? surf(r) : { R: 0, ...r }));
const near = (a, b, tol, msg = '') =>
  assert.ok(Math.abs(a - b) <= tol, `${msg} got ${a}, expected ${b} ± ${tol}`);
const rms = w => Math.sqrt(w.opd.reduce((s, v) => s + v * v, 0) / w.opd.length);
const dist = (a, b) => Math.hypot(...O.add(a, b, -1));
/** The returned wavefront at the pupil plane (the end of the way back). */
const backWFE = (S, ap, f = 0, N = 21) => {
  const n = S.length;
  const rays = O.grid(ap, N)
    .map(([x, y]) => O.traceDP(S, x, y, f))
    .filter(r => r.length === 2 * n);
  const ax = O.traceDP(S, 0, 0, 0);
  const k = n - 1; // the state leaving S[0] on the way back, then the pupil
  return O.wavefrontAt(
    rays.map(r => r[n - 1 + k]),
    ax[n - 1 + k].p,
    ax[n - 1 + k].u,
    dist(ax.at(-1).p, ax[n - 1 + k].p),
  );
};

describe('double pass', () => {
  // a paraboloid (f = 200, 50 off its axis) focusing a collimated beam
  const oap = last => full([{ t: 100, ap: 10 }, mirror({ R: -400, k: -1, d: 50, t: 203.125 }), last]);

  test('a caliball on the focus sends every ray straight back to where it started, all paths equal', () => {
    const rows = oap(mirror({ R: 10, dp: true, ball: true }));
    rows[1].solve = { t: { type: 'centre' } };
    assert.equal(O.applySolves(rows).size, 0);
    near(rows[1].t, 203.125 - 10, 1e-6, 'centred: its surface one radius before the focus');
    const S = O.build(rows);
    assert.equal(S.dp, true);
    const L = [];
    for (const [x, y] of O.grid(10, 9)) {
      const r = O.traceDP(S, x, y, 0);
      assert.equal(r.length, 4, 'out to the ball, back off the paraboloid, onto the pupil');
      near(dist(r.at(-1).p, [x, y, 0]), 0, 1e-7, 'back where it started');
      near(r.at(-1).u[2], -1, 1e-12, 'straight back');
      L.push(r.at(-1).L);
    }
    near(Math.max(...L) - Math.min(...L), 0, 1e-9, 'a perfect return');
  });

  test('the way back goes back into the glass it came out of: a lens and a flat at its focus double the spherical aberration', () => {
    const lens = [{ t: 20, ap: 5 }, surf({ R: 100, t: 5, n: 1.5168 }), surf({ R: -100, t: 95 })];
    const single = full([...lens, surf()]);
    const S1 = O.build(single);
    single[2].t += O.inFocus(S1, 2)[2] - S1[2].P[2]; // the plane on the paraxial focus
    const one = rms(O.wavefrontIn(O.build(single), O.bundle(O.build(single), 5, 21, 0)));
    const dp = full([...single.slice(0, 3), mirror({ dp: true })]);
    const two = rms(backWFE(O.build(dp), 5));
    near(two / one, 2, 0.05, 'double the single pass (a cat’s eye: the pupil turned about, the error twice)');
  });

  test('without dp (or when the last surface is not a mirror) nothing comes back', () => {
    const S = O.build(oap(mirror({})));
    assert.equal(S.dp, false);
    assert.equal(O.traceDP(S, 1, 1, 0).length, 2);
    assert.equal(O.build(oap(surf({ dp: true }))).dp, false);
  });

  test('a paraxial lens in the path stays perfect both ways (its conjugates out and back)', () => {
    const rows = full([{ t: 0, ap: 10 }, surf({ type: 'paraxial', f: 150, t: 150 }), mirror({ dp: true })]);
    const S = O.build(rows);
    near(rms(backWFE(S, 10)), 0, 1e-9);
  });
});

describe('paraxial lens at finite conjugates', () => {
  test('a point source at 2f images perfectly at 2f (wavefront included), and one at f leaves collimated', () => {
    for (const [R, t] of [
      [-200, 200],
      [-100, 300],
    ]) {
      const rows = full([{ t: 0, ap: 10, R }, surf({ type: 'paraxial', f: 100, t }), surf()]);
      const S = O.build(rows);
      for (const f of [0, 2])
        near(rms(O.wavefrontIn(S, O.bundle(S, 10, 15, f))), 0, 1e-9, `source ${R}, field ${f}`);
    }
  });
});

describe('reverse a system', () => {
  const rel = (sys, f) => {
    const S = O.build(full(sys.rows));
    return rms(O.wavefrontIn(S, O.bundle(S, sys.rows[0].ap, 21, f)));
  };
  test('an OAP relay run backwards: same optics, same wavefront errors; reversed twice, the original', () => {
    const sys = {
      fields: [0, 0.5, -0.5],
      rows: full([
        { t: 300, ap: 25 },
        mirror({ name: 'OAP', R: -1000, k: -1, d: 150, t: 511.25 }),
        surf({ name: 'Focus' }),
      ]),
    };
    const r = O.reverseSystem(sys);
    assert.ok(r.rows[0].R < 0, 'the light starts from the image (diverging)');
    assert.deepEqual(
      r.rows.slice(1).map(x => x.name),
      ['OAP', 'Pupil (where the light came in)'],
    );
    const S0 = O.build(sys.rows);
    const S1 = O.build(full(r.rows));
    // the same mirror: one surface, met from the same side
    const C = s => O.add(s.V, s.ez, 1 / s.c);
    near(dist(C(S0[0]), C(S0[0])), 0, 0);
    for (const k of [1, 2])
      near(rel(r, r.fields[k]), rel(sys, sys.fields[k]), 0.02 * rel(sys, sys.fields[k]), `field ${k}`);
    near(rel(r, 0), 0, 1e-9);
    const rr = O.reverseSystem({ ...r, rows: full(r.rows) });
    const S2 = O.build(full(rr.rows));
    near(rr.rows[0].t, 300, 0.02, 'the pupil back where it was (to its own aberration)');
    near(rr.rows[0].ap, 25, 0.01);
    for (const k of ['R', 'k', 'd', 'tilt', 't'])
      near(
        rr.rows[1][k],
        sys.rows[1][k],
        1e-6 * (1 + Math.abs(sys.rows[1][k])),
        `the paraboloid's ${k} as it was`,
      );
    near(dist(S2[0].V, S2[0].P), dist(S0[0].V, S0[0].P), 1e-6);
    rr.fields.forEach((f, k) => near(f, sys.fields[k], 1e-5, `field ${k} back`));
    assert.ok(S1.length);
  });

  test('a singlet: the reversed wavefront error equals the original’s (reciprocity), and so does a 3D fold with a paraxial lens', () => {
    const single = {
      fields: [0, 3],
      rows: full([{ t: 20, ap: 5 }, surf({ R: 100, t: 5, n: 1.5168 }), surf({ R: -100, t: 95 }), surf()]),
    };
    const S = O.build(single.rows);
    single.rows[2].t += O.inFocus(S, 2)[2] - S[2].P[2];
    const r = O.reverseSystem(single);
    near(rel(r, 0), rel(single, 0), 0.03 * rel(single, 0));
    const fold = {
      fields: [0, [0.5, 0.3]],
      rows: full([
        { t: 0, ap: 10 },
        surf({ type: 'paraxial', f: 200, t: 100 }),
        mirror({ tilt: 20, tiltY: 15, t: 100 }),
        surf(),
      ]),
    };
    const rf = O.reverseSystem(fold);
    assert.equal(rf.rows[2].type, 'paraxial');
    for (const f of rf.fields) near(rel(rf, f), 0, 1e-9, `reversed field ${JSON.stringify(f)}`);
  });
});
