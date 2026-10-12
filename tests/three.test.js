// 3D: the same checks as the planar suite, on the extra axis. The core one is symmetry: a planar design rolled about the
// first axis ray (the whole layout turned about z) must trace exactly as the original, turned. Rolled, a tilt about x
// becomes a tilt about another axis, so it exercises the 3D frames (tilt, tiltY, clock), carrying the frame along the axis,
// x and y fields, locks and solves with x residuals, moving an optic out of plane and the exports.
// The matrix maths here is written independently of optics.js. Run: node --test
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const O = require('../src/engine');

const surf = o => ({ type: 'refract', R: 0, k: 0, d: 0, tilt: 0, t: 0, n: 1, ap: 0, ...o });
const mirror = o => surf({ type: 'mirror', ...o });
const near = (a, b, tol, msg = '') =>
  assert.ok(Math.abs(a - b) <= tol, `${msg} got ${a}, expected ${b} ± ${tol}`);
const close = (u, v, tol, msg = '') => near(Math.hypot(...u.map((x, k) => x - v[k])), 0, tol, msg);

// ── Rotations, as the tool defines them (each acting on column vectors in the surface's incoming frame):
// tilt turns +z toward +y (about x), tiltY turns +z toward +x (about y), clock turns +x toward +y (about z), in that order.
const r = d => (d * Math.PI) / 180;
const deg = a => (a * 180) / Math.PI;
const Rx = t => {
  const c = Math.cos(r(t));
  const s = Math.sin(r(t));
  return [
    [1, 0, 0],
    [0, c, s],
    [0, -s, c],
  ];
};
const Ry = t => {
  const c = Math.cos(r(t));
  const s = Math.sin(r(t));
  return [
    [c, 0, s],
    [0, 1, 0],
    [-s, 0, c],
  ];
};
const Rz = t => {
  const c = Math.cos(r(t));
  const s = Math.sin(r(t));
  return [
    [c, -s, 0],
    [s, c, 0],
    [0, 0, 1],
  ];
};
const mul = (A, B) =>
  A.map(row => [0, 1, 2].map(j => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));
const app = (A, v) => A.map(row => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
const tr = A => [0, 1, 2].map(i => A.map(row => row[i]));
/** tilt, tiltY, clock (deg) with Rx(tilt)·Ry(tiltY)·Rz(clock) = R. */
function euler(R) {
  const t = deg(Math.atan2(R[1][2], R[2][2]));
  const y = deg(Math.atan2(R[0][2], Math.hypot(R[1][2], R[2][2])));
  const Z = mul(tr(mul(Rx(t), Ry(y))), R);
  return [t, y, deg(Math.atan2(Z[1][0], Z[0][0]))];
}

// ── Rolling a planar design by a about the first axis (z): world vectors turn by G = Rz(a). Each surface's own rotation
// becomes G·Rx(tilt) (its incoming frame turns with everything upstream); fields and pupil points turn too.
function roll(rows, a) {
  return rows.map((row, i) => {
    if (!i) return { ...row };
    const [tilt, tiltY, clock] = euler(mul(Rz(a), Rx(row.tilt ?? 0)));
    return { ...row, tilt, tiltY, clock };
  });
}
function rollField(f, a, finite) {
  if (finite) {
    const v = app(Rz(a), [0, f, 0]);
    return [v[0], v[1]];
  }
  const u = app(Rz(a), [0, Math.sin(r(f)), Math.cos(r(f))]);
  return [deg(Math.atan(u[0] / u[2])), deg(Math.atan(u[1] / u[2]))];
}

const cassegrain = () => [
  { t: 500, ap: 100 },
  mirror({ R: -2000, k: -1, t: 750 }),
  mirror({ R: 2000 / 3, k: -((5 / 3) ** 2), t: 1000 }),
  surf(),
];
const relay = () => [
  { t: 300, ap: 25 },
  mirror({ R: -1000, k: -1, d: 150, t: 511.25 }),
  surf({ t: 511.25 }),
  mirror({ R: -1000, k: -1, d: 150, tilt: -17.0604, t: 400 }),
  surf(),
];
const fold = () => [
  { t: 100, ap: 10 },
  mirror({ tilt: 45, t: 50 }),
  surf({ R: 80, n: 1.6, t: 5, tilt: 3 }),
  surf({ R: -80, t: 90 }),
  surf(),
];
const singlet = () => [
  { t: 20, ap: 10 },
  surf({ R: 100, t: 5, n: 1.5168 }),
  surf({ R: -100, t: 100 }),
  surf(),
];
const fiber = () => [
  { t: 10, ap: 10, R: -90 },
  surf({ t: 6, n: 1.5168 }),
  surf({ R: -51.68, t: 60 }),
  surf(),
];
const ellipse = () => [
  { t: 250, ap: 10, R: -50 },
  mirror({ R: 150, k: -0.5, oa: 'angle', d: -90, tilt: 45, t: 300 }),
  surf(),
];
const SYSTEMS = { cassegrain, relay, fold, singlet, fiber, ellipse };

describe('the extra axis: a planar design rolled about the first axis traces as the original, turned', () => {
  for (const [name, sys] of Object.entries(SYSTEMS))
    for (const a of [90, 37, -120]) {
      test(`${name}, rolled ${a}°: every vertex, axis, hit point and ray turns with it`, () => {
        const rows = sys();
        const rolled = roll(rows, a);
        const G = Rz(a);
        const fin = !!rows[0].R;
        const S = O.build(rows);
        const S3 = O.build(rolled);
        S.forEach((s, i) => {
          close(S3[i].V, app(G, s.V), 1e-9, `S${i + 1} vertex`);
          close(S3[i].ez, app(G, s.ez), 1e-12, `S${i + 1} axis`);
          close(S3[i].P, app(G, s.P), 1e-9, `S${i + 1} hit`);
          close(S3[i].uOut, app(G, s.uOut), 1e-12, `S${i + 1} out`);
        });
        for (const f of [0, fin ? 1 : 0.2])
          for (const [x, y] of O.grid(rows[0].ap, 5)) {
            const p = app(G, [x, y, 0]);
            const A = O.trace(S, x, y, f);
            const B = O.trace(S3, p[0], p[1], f ? rollField(f, a, fin) : 0);
            assert.equal(B.length, A.length, `${name} ray (${x}, ${y}) field ${f}: as many surfaces`);
            A.forEach((q, i) => {
              close(B[i].p, app(G, q.p), 1e-8, `ray at S${i + 1}`);
              close(B[i].u, app(G, q.u), 1e-11);
              near(B[i].L, q.L, 1e-8, 'path length');
            });
          }
      });
    }

  test('rolled designs keep the same first-order values: EFL, the incoming focus, the stigmatic check', () => {
    for (const sys of [cassegrain, relay, singlet, ellipse])
      for (const a of [90, 37]) {
        const rows = sys();
        const S = O.build(rows);
        const S3 = O.build(roll(rows, a));
        const h = rows[0].ap * 1e-4;
        if (!rows[0].R && Math.abs(O.efl(S, h)) < 1e5 * rows[0].ap)
          near(O.efl(S3, h), O.efl(S, h), 1e-6 * Math.abs(O.efl(S, h)), 'EFL'); // (not afocal)
        S.forEach((s, i) => {
          const f = O.inFocus(S, i);
          const g = O.inFocus(S3, i);
          if (f) close(g, app(Rz(a), f), 1e-6 * (1 + Math.hypot(...f)), `incoming focus at S${i + 1}`);
          else assert.equal(g, null);
          assert.equal(O.stigmatic(S3, i), O.stigmatic(S, i), `stigmatic S${i + 1}`);
        });
      }
  });
});

describe('3D frames: rotations, Euler angles, carrying the frame along the axis', () => {
  test('frame rotation and Euler angles invert each other, keeping the branch nearest the previous angles', () => {
    for (const [t, y, c] of [
      [10, 20, 30],
      [-75, 40, -120],
      [170, -10, 5],
      [0, 89.9, 45],
      [0, 0, 0],
      [33, 0, 0],
    ]) {
      const R = O.frameRot(t, y, c);
      assert.deepEqual(
        R.map(row => row.map(v => +v.toFixed(12))),
        mul(mul(Rx(t), Ry(y)), Rz(c)).map(row => row.map(v => +v.toFixed(12))),
      );
      const e = O.euler(R, [t, y, c]);
      near(e[0], t, 1e-9);
      near(e[1], y, 1e-9);
      near(e[2], c, 1e-9);
    }
    const e = O.euler(O.frameRot(179, 0, 0), [-179, 0, 0]);
    near(e[0], -181, 1e-9, 'continuous through ±180°');
    const g = O.euler(O.frameRot(0, 90, 30), [0, 0, 0]);
    close(O.frameRot(...g)[0], O.frameRot(0, 90, 30)[0], 1e-9, 'gimbal lock: the same rotation');
  });

  test('the frame is carried by the smallest rotation taking each axis into the next; a retro-reflection turns it about the surface’s own x', () => {
    const S = O.build([
      { t: 100, ap: 5 },
      mirror({ tilt: 45, t: 50 }),
      mirror({ tiltY: 30, t: 50 }),
      mirror({ t: 50 }),
      surf(),
    ]);
    S.forEach(s => {
      near(Math.abs(O.dot(s.exOut, s.uOut)), 0, 1e-12);
      near(Math.abs(O.dot(s.eyOut, s.uOut)), 0, 1e-12);
      close(O.cross(s.exOut, s.eyOut), s.uOut, 1e-12, 'right-handed');
    });
    close(S[2].exOut, S[2].ex, 1e-12, 'retro: x kept');
    close(
      S[2].uOut,
      S[2].uIn.map(v => -v),
      1e-12,
    );
    const P = O.build(relay());
    P.forEach(s =>
      assert.deepEqual([s.exOut[0], s.exOut[1], s.exOut[2]], [1, 0, 0], 'planar: x stays exactly +x'),
    );
  });

  test('axes across a beam: none in the y–z plane (the planar x and y stand), else a right-handed pair, along ±x too', () => {
    assert.equal(O.axesAcross([0, 0.6, 0.8]), null);
    for (const u of [
      [0.3, 0.4, Math.sqrt(0.75)],
      [1, 0, 0],
      [-1, 0, 0],
      [0.6, 0, -0.8],
      [1e-9, 0, 1],
    ]) {
      const [x, y] = O.axesAcross(u);
      near(O.dot(x, u), 0, 1e-15);
      near(O.dot(y, u), 0, 1e-15);
      near(O.dot(x, y), 0, 1e-15);
      close(O.cross(x, y), u, 1e-12, 'x × y = u');
    }
    close(O.axesAcross([1, 0, 0])[1], [0, 1, 0], 0, 'along +x: y is +y');
  });

  test('spots and wavefronts are the same seen down a rolled beam (RMS radius and RMS OPD)', () => {
    for (const [name, sys] of Object.entries(SYSTEMS))
      for (const a of [90, 37]) {
        const rows = sys();
        const fin = !!rows[0].R;
        const f = fin ? 1 : 0.2;
        const S = O.build(rows);
        const S3 = O.build(roll(rows, a));
        const G = Rz(a);
        const n = S.length - 1;
        const pts = O.grid(rows[0].ap, 9);
        const A = O.bundle(S, rows[0].ap, 9, f);
        const B = pts.map(([x, y]) => {
          const p = app(G, [x, y, 0]);
          return [
            O.start(p[0], p[1], rollField(f, a, fin), S3.beam),
            ...O.trace(S3, p[0], p[1], rollField(f, a, fin)),
          ];
        });
        const rms = (St, bun) => {
          const rs = bun.filter(r => r.length > n + 1).map(r => r[n + 1]);
          return O.spot(O.toPlane(rs, St[n].P, St[n - 1].uOut).map(q => q.xy)).rms;
        };
        near(rms(S3, B), rms(S, A), 1e-9 * (1 + rms(S, A)), `${name} ${a}° spot`);
        const w = O.wavefrontIn(S, A);
        const w3 = O.wavefrontIn(S3, B);
        const q = v => Math.sqrt(v.opd.reduce((s, x) => s + x * x, 0) / v.opd.length);
        if (w) near(q(w3), q(w), 1e-9 + 1e-6 * q(w), `${name} ${a}° RMS OPD`);
      }
  });
});

describe('3D fields', () => {
  test('a field (x, y) is a direction with tan = u_x/u_z, tan = u_y/u_z (collimated), or a source point (x, y, R)', () => {
    const s = O.start(0, 0, [10, -20]);
    near(s.u[0] / s.u[2], Math.tan(r(10)), 1e-15);
    near(s.u[1] / s.u[2], Math.tan(r(-20)), 1e-15);
    const q = O.start(1, 2, [3, 4], -100);
    close(
      q.u,
      (v => v.map(x => x / Math.hypot(...v)))([1 - 3, 2 - 4, 100]),
      1e-15,
      'away from the source (3, 4, −100)',
    );
    assert.deepEqual(O.start(1, 2, 5), O.start(1, 2, [0, 5]), 'a number is a y field');
  });
});

describe('solves and locks on the extra axis', () => {
  test('a tilt solve becomes a tiltY solve: the recollimating OAP rolled 90° solves its tiltY to the planar tilt', () => {
    const rows = relay();
    rows[3].solve = { tilt: { type: 'collim' } };
    O.applySolves(rows);
    const rolled = roll(relay(), 90);
    rolled[3].solve = { tiltY: { type: 'collim' } }; // from the rolled preset value, as the planar solve starts from its own
    assert.equal(O.applySolves(rolled).size, 0);
    near(rolled[3].tiltY, -rows[3].tilt, 1e-6, 'tiltY = −tilt');
  });

  test('focus locks hold with x residuals: a confocal Cassegrain secondary and a recollimating OAP, rolled', () => {
    const cas = cassegrain();
    cas[2] = { ...cas[2], R: 700, k: -3, lock: { f1: { at: 1, f: 1 }, f2: { at: 3 }, vary: ['R', 'k'] } };
    const c3 = roll(cas, 37);
    assert.equal(O.applySolves(cas).size, 0);
    assert.equal(O.applySolves(c3).size, 0);
    near(c3[2].R, cas[2].R, 1e-6);
    near(c3[2].k, cas[2].k, 1e-9);
    const oap = roll(relay(), 90);
    oap[3] = { ...oap[3], tiltY: 0, lock: { f1: { at: 2 }, vary: ['tiltY'] } };
    assert.equal(O.applySolves(oap).size, 0);
    const S = O.build(oap);
    close(O.foci(S[2])[0], S[1].P, 1e-6, 'F1 on the focus plane');
  });

  test('a free point in 3D: a mirror images the incoming focus on a point off the plane (F1 on the incoming focus, F2 on [x, y, z])', () => {
    const rows = [
      { t: 200, ap: 8, R: -100 },
      mirror({
        R: -300,
        k: 0,
        t: 100,
        lock: {
          f1: { at: 'in' },
          f2: { at: 'pt', p: [0, 0, -100] },
          vary: ['R', 'k', 'd', 'tilt', 'tiltY', 'clock'],
        },
      }),
      surf(),
    ];
    for (const p of [
      [0, 0, -100],
      [20, 30, -60],
      [60, 10, 40],
      [-40, -70, 0],
    ]) {
      rows[1].lock.f2.p = p;
      assert.equal(O.applySolves(rows).size, 0, `F2 at ${p}`);
      const S = O.build(rows);
      close(O.foci(S[0])[1], p, 1e-7, 'F2 there');
      for (const [x, y] of O.grid(8, 5)) {
        const q = O.trace(S, x, y, 0)[0];
        const v = p.map((w, k) => w - q.p[k]);
        const t = O.dot(v, q.u);
        near(Math.hypot(...v.map((w, k) => w - t * q.u[k])), 0, 1e-7, `ray (${x}, ${y}) through F2`);
      }
      assert.equal(O.stigmatic(S, 0), true);
    }
  });

  test('the stigmatic pair in 3D is solved outright: tilt, tiltY and clock pose the parent, the nearest of the ways to write it', () => {
    const lock = p => ({
      f1: { at: 'in' },
      f2: { at: 'pt', p },
      vary: ['R', 'k', 'd', 'tilt', 'tiltY', 'clock'],
    });
    const rows = [
      { t: 200, ap: 8, R: -100 },
      mirror({ R: -300, k: 0, t: 100, tiltY: 3, lock: lock([20, 30, -60]) }),
      surf(),
    ];
    for (const p of [
      [20, 30, -60],
      [60, 10, 40],
      [-40, -70, 0],
      [5, -2, -250],
    ]) {
      rows[1].lock.f2.p = p;
      assert.equal(O.conjugateMirror(rows, 1), true, `F2 at ${p}`);
      near(Math.hypot(...O.lockRes(rows, 1)), 0, 1e-8, 'both foci on their targets at once');
      const again = structuredClone(rows);
      O.conjugateMirror(again, 1);
      for (const k of ['R', 'k', 'd', 'tilt', 'tiltY', 'clock'])
        near(again[1][k] ?? 0, rows[1][k] ?? 0, 1e-9, `${k} stays put when solved again`);
    }
    const fixed = structuredClone(rows);
    fixed[1].lock.vary = ['R', 'k', 'd', 'tilt'];
    fixed[1].lock.f2.p = [9, 9, -80];
    assert.equal(O.conjugateMirror(fixed, 1), false, 'in 3D it needs tiltY and clock free');
  });
});

describe('moving and turning an optic in 3D', () => {
  test('moving a rolled optic by the rolled displacement gives the rolled result; out of the plane too', () => {
    const rows = relay();
    const S = O.build(rows);
    const D = [0, 12, -7];
    const A = O.build(
      O.moveOptic(
        rows,
        0,
        S[0].P.map((v, k) => v + D[k]),
      ),
    );
    const rolled = roll(rows, 90);
    const B = O.build(
      O.moveOptic(
        rolled,
        0,
        O.build(rolled)[0].P.map((v, k) => v + app(Rz(90), D)[k]),
      ),
    );
    close(B[0].V, app(Rz(90), A[0].V), 1e-8, 'vertex');
    close(B[0].ez, app(Rz(90), A[0].ez), 1e-12, 'axis');
    const out = O.build(
      O.moveOptic(
        rows,
        0,
        S[0].P.map((v, k) => v + [5, 3, 0][k]),
      ),
    ); // a planar OAP moved out of its plane
    close(
      out[0].V,
      S[0].V.map((v, k) => v + [5, 3, 0][k]),
      1e-8,
      'the parent moves rigidly',
    );
    close(out[0].ez, S[0].ez, 1e-12, 'keeping its orientation');
  });

  test('turning an optic about any axis through its hit point: the parent turns rigidly about that axis', () => {
    const rows = relay();
    const S = O.build(rows);
    for (const axis of [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0.6, 0.8],
      [0.48, 0.6, 0.64],
    ]) {
      const T = O.build(O.turnOptic(rows, 0, axis, 7));
      const a = r(7);
      const c = Math.cos(a);
      const s = Math.sin(a);
      const rotv = v => {
        const k = axis;
        const d = O.dot(k, v);
        const x = O.cross(k, v);
        return v.map((w, i) => w * c + x[i] * s + k[i] * d * (1 - c));
      };
      close(T[0].P, S[0].P, 1e-9, 'pivot on the hit point');
      close(T[0].ez, rotv(S[0].ez), 1e-9, `axis turned about ${axis}`);
      close(
        T[0].V,
        S[0].P.map((p, i) => p + rotv(S[0].V.map((v, k) => v - S[0].P[k]))[i]),
        1e-7,
        'vertex turned',
      );
    }
  });
});

describe('exports and import in 3D', () => {
  test('Zemax round trip of rolled designs rebuilds every vertex and axis', () => {
    for (const sys of [cassegrain, relay, fold])
      for (const a of [90, 37]) {
        const fields = [0, rollField(0.2, a, false), 0.1];
        const rows = roll(sys(), a);
        const im = O.fromZemax(O.zemax(rows, { fields }), { plane: '3d' });
        const A = O.build(im.rows);
        const B = O.build(rows);
        assert.deepEqual(im.warnings, []);
        assert.equal(A.length, B.length);
        im.fields.forEach((f, k) =>
          close([f].flat(), [fields[k]].flat(), 1e-9, `field ${k}: x and y each in their place`),
        );
        B.forEach((s, i) => {
          close(A[i].V, s.V, 1e-8, `S${i + 1} vertex`);
          close(
            A[i].ez.map(v => v * Math.sign(O.dot(A[i].ez, s.ez))),
            s.ez,
            1e-10,
            `S${i + 1} axis`,
          );
        });
      }
  });

  test('batoid script carries each surface’s full rotation', () => {
    const rows = roll(relay(), 37);
    const S = O.build(rows);
    const txt = O.toPython(rows, 'batoid');
    const line = txt
      .split('\n')
      .find(l => l.trim().startsWith('("S2"'))
      .replace(/^\s*\("[^"]*", "\w+", /, '');
    const nums = line.match(/-?\d+(\.\d+)?(e-?\d+)?/g).map(Number);
    const ex = O.cross(S[1].ey, S[1].ez);
    assert.match(txt, /ROT3D = True/);
    close(nums.slice(0, 3), S[1].V, 1e-9, 'vertex');
    [0, 1, 2].forEach(r =>
      close(nums.slice(3 + 3 * r, 6 + 3 * r), [ex[r], S[1].ey[r], S[1].ez[r]], 1e-12, `rotation row ${r}`),
    );
    near(nums[12], S[1].c ? 1 / S[1].c : 0, 1e-9, 'R');
    near(nums[13], S[1].k, 0, 'k');
    assert.match(O.toPython(relay(), 'batoid'), /rotX/);
    assert.doesNotMatch(O.toPython(relay(), 'batoid'), /ROT3D/); // planar stays planar
    assert.match(O.toPython(relay(), 'batoid', { fields: [[0.1, 0.2]] }), /FIELDS = \[\(0\.1, 0\.2\)\]/);
    assert.throws(() => O.toPython(rows, 'optiland'), /batoid or Zemax/);
  });
});
