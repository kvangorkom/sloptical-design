// Ray-trace checks against closed-form results from geometrical optics and optical design texts, plus edge cases.
// Run: node --test            (Node ≥ 18, no dependencies)
//
// References: J. Greivenkamp, Field Guide to Geometrical Optics (SPIE, 2004) — FG; D. Schroeder, Astronomical Optics,
// 2nd ed. (2000) — AO; W. Smith, Modern Optical Engineering, 4th ed. (2008) — MOE; E. Hecht, Optics, 5th ed. — H.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const O = require('../src/engine');

const surf = o => ({ type: 'refract', R: 0, k: 0, d: 0, tilt: 0, t: 0, n: 1, ap: 0, ...o });
const mirror = o => surf({ type: 'mirror', ...o });
const near = (a, b, tol, msg = '') =>
  assert.ok(Math.abs(a - b) <= tol, `${msg} got ${a}, expected ${b} ± ${tol}`);
const rel = (a, b, tol, msg) => near(a, b, tol * Math.abs(b), msg);
const rad = d => (d * Math.PI) / 180;
const deg = r => (r * 180) / Math.PI;
const wrap = d => ((d + 540) % 360) - 180;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const onSurf = (S, i, a, f = 0, N = 21) =>
  O.grid(a, N)
    .map(([x, y]) => O.trace(S, x, y, f)[i])
    .filter(Boolean);
const rms = (S, i, a, f) => O.spot(onSurf(S, i, a, f).map(q => q.loc)).rms;
const rmsWFE = w => Math.sqrt(w.opd.reduce((s, v) => s + v * v, 0) / w.opd.length);
const bfd = S => 1 / O.curv(S, S.length - 2, 1e-6); // paraxial: last optic → focus

// Reference systems
const parabola = (f = 1000, a = 100) => [{ t: 500, ap: a }, mirror({ R: -2 * f, k: -1, t: f }), surf()];
const cassegrain = (k1 = -1, k2 = -((5 / 3) ** 2)) => [
  { t: 500, ap: 100 },
  mirror({ R: -2000, k: k1, t: 750 }),
  mirror({ R: 2000 / 3, k: k2, t: 1000 }),
  surf(),
];
const singlet = (R1 = 100, R2 = -100, tc = 5, n = 1.5168) => [
  { t: 20, ap: 10 },
  surf({ R: R1, t: tc, n }),
  surf({ R: R2, t: 100 }),
  surf(),
];
const oap = (f = 500, d = 150) => [
  { t: 300, ap: 25 },
  mirror({ R: -2 * f, k: -1, d, t: f + (d * d) / (4 * f) }),
  surf(),
];

/** Independent paraxial reference: the ABCD (y, n·u) matrix method (FG "Gaussian reduction"; H §6.2), unfolded, so a
 *  mirror is a thin element of power −2n·c (c relative to the incoming light) with the index unchanged. */
function abcd(rows) {
  const mul = (A, B) => [
    [A[0][0] * B[0][0] + A[0][1] * B[1][0], A[0][0] * B[0][1] + A[0][1] * B[1][1]],
    [A[1][0] * B[0][0] + A[1][1] * B[1][0], A[1][0] * B[0][1] + A[1][1] * B[1][1]],
  ];
  let M = [
    [1, 0],
    [0, 1],
  ];
  let n = 1;
  rows.slice(1, -1).forEach((r, i, a) => {
    const c = r.R ? 1 / r.R : 0;
    const n2 = r.type === 'mirror' ? n : r.n;
    const φ = r.type === 'mirror' ? -2 * n * c : (n2 - n) * c;
    M = mul(
      [
        [1, 0],
        [-φ, 1],
      ],
      M,
    );
    if (i < a.length - 1)
      M = mul(
        [
          [1, r.t / n2],
          [0, 1],
        ],
        M,
      );
    n = n2;
  });
  return { efl: -1 / M[1][0], bfd: (-n * M[0][0]) / M[1][0] };
}

describe('laws of refraction and reflection', () => {
  test('sag: sphere matches the circle, parabola matches r²/2R, flat is zero', () => {
    for (const r of [0, 10, 50, 99]) {
      near(O.sag(1 / 100, 0, r * r), 100 - Math.sqrt(100 * 100 - r * r), 1e-12, `sphere r=${r}`);
      near(O.sag(1 / 100, -1, r * r), (r * r) / 200, 1e-12, `parabola r=${r}`);
    }
    assert.equal(O.sag(0, 0, 1e4), 0);
  });

  test('Snell’s law at a flat interface, at all angles', () => {
    for (const th of [0, 5, 20, 45, 70]) {
      const S = O.build([{ t: 10, ap: 1 }, surf({ n: 1.5, t: 10 }), surf()]);
      const r = O.trace(S, 0, 0, th)[0];
      near(Math.sin(rad(th)), 1.5 * Math.hypot(r.u[0], r.u[1]), 1e-12, `θ=${th}`);
    }
  });

  test('total internal reflection beyond the critical angle (41.8° at n = 1.5, 50.3° at n = 1.3)', () => {
    const prism = n => O.build([{ t: 10, ap: 1 }, surf({ n, t: 10 }), surf({ tilt: 45, t: 10 }), surf()]);
    assert.equal(O.trace(prism(1.5), 0, 0, 0).length, 1, 'TIR at n = 1.5');
    const r = O.trace(prism(1.3), 0, 0, 0)[1];
    near(Math.sqrt(1 - O.rot(r.u, -45)[2] ** 2), 1.3 * Math.sin(rad(45)), 1e-12, 'Snell at the tilted face');
  });

  test('law of reflection: tilting a flat mirror by θ turns the beam by 2θ; AOI = θ', () => {
    for (const th of [0, 10, 22.5, 45, -30]) {
      const S = O.build([{ t: 10, ap: 1 }, mirror({ tilt: th, t: 10 }), surf()]);
      near(wrap(O.angle(S[0].uOut) - (180 + 2 * th)), 0, 1e-9, `θ=${th}`);
      near(S[0].aoi, Math.abs(th), 1e-6, 'angle of incidence');
    }
  });

  test('Fermat: every ray has the same optical path to a perfect focus', () => {
    const Ls = onSurf(O.build(parabola()), 1, 100).map(q => q.L);
    near(Math.max(...Ls) - Math.min(...Ls), 0, 1e-9);
  });
});

describe('first-order optics (Field Guide to Geometrical Optics; Hecht)', () => {
  test('EFL and BFD match the paraxial matrix method for multi-element lens and mirror systems', () => {
    const triplet = [
      { t: 10, ap: 5 },
      surf({ R: 40, t: 6, n: 1.62 }),
      surf({ R: -120, t: 8 }),
      surf({ R: -35, t: 2, n: 1.72 }),
      surf({ R: 38, t: 7 }),
      surf({ R: 120, t: 5, n: 1.62 }),
      surf({ R: -45, t: 40 }),
      surf(),
    ];
    const mixed = [
      { t: 500, ap: 50 },
      mirror({ R: -2000, t: 600 }),
      surf({ R: 300, t: 10, n: 1.5 }),
      surf({ R: -500, t: 50 }),
      mirror({ R: 800, t: 300 }),
      surf(),
    ];
    for (const [name, rows] of [
      ['triplet', triplet],
      ['mirror + lens + mirror', mixed],
      ['Cassegrain', cassegrain()],
      ['singlet', singlet()],
    ]) {
      const S = O.build(rows);
      const ref = abcd(rows);
      rel(O.efl(S, 1e-6), Math.abs(ref.efl), 1e-9, `${name} EFL`);
      rel(bfd(S), ref.bfd, 1e-9, `${name} BFD`);
    }
  });

  test('thick lens: lensmaker EFL and BFD (FG), for bi-convex, plano, meniscus and negative lenses', () => {
    for (const [R1, R2, tc, n] of [
      [100, -100, 5, 1.5168],
      [50, 0, 8, 1.8],
      [-80, -40, 3, 1.4],
      [200, 300, 10, 1.6],
    ]) {
      const S = O.build(singlet(R1, R2, tc, n));
      const c1 = 1 / R1;
      const c2 = R2 ? 1 / R2 : 0;
      const f = 1 / ((n - 1) * (c1 - c2 + ((n - 1) * tc * c1 * c2) / n));
      rel(O.efl(S, 1e-5), Math.abs(f), 1e-7, `EFL ${R1}/${R2}`);
      rel(1 / O.curv(S, 1, 1e-5), f * (1 - ((n - 1) * tc * c1) / n), 1e-7, `BFD ${R1}/${R2}`);
    }
    rel(
      O.efl(O.build(singlet(50, 0, 8, 1.6)), 1e-5),
      O.efl(O.build(singlet(0, -50, 8, 1.6)), 1e-5),
      1e-9,
      'plano-convex either way round',
    );
  });

  test('single refracting surface: rear focal length f′ = n′R/(n′ − n) (FG)', () => {
    const S = O.build([{ t: 10, ap: 1 }, surf({ R: 50, n: 1.5, t: 200 }), surf({ n: 1.5 })]);
    rel(1 / O.curv(S, 0, 1e-6), (1.5 * 50) / 0.5, 1e-12);
  });

  test('ball lens: EFL = nD / 4(n − 1), BFD = EFL − D/2 (FG)', () => {
    const S = O.build([{ t: 10, ap: 1 }, surf({ R: 5, t: 10, n: 1.5 }), surf({ R: -5, t: 10 }), surf()]);
    rel(O.efl(S, 1e-6), (1.5 * 10) / (4 * 0.5), 1e-10);
    rel(1 / O.curv(S, 1, 1e-6), 7.5 - 5, 1e-10);
  });

  test('spherical mirror focal length f = R/2; a flat fold leaves EFL unchanged', () => {
    near(1 / O.curv(O.build(parabola(750)), 0, 1e-3), 750, 1e-6);
    const S = O.build([
      { t: 500, ap: 50 },
      mirror({ R: -2000, k: -1, t: 400 }),
      mirror({ tilt: 45, t: 600 }),
      surf(),
    ]);
    rel(O.efl(S, 1e-4), 1000, 1e-7);
    rel(1 / O.curv(S, 1, 1e-4), 600, 1e-7); // from a real ray at h = 1e-4: ~1e-9 floor
  });

  test('plane-parallel plate in a converging beam shifts focus by t(n − 1)/n (FG)', () => {
    const S = O.build([
      { t: 500, ap: 10 },
      mirror({ R: -2000, k: -1, t: 500 }),
      surf({ n: 1.5, t: 10 }),
      surf({ t: 100 }),
      surf(),
    ]);
    near(500 + 10 + 1 / O.curv(S, 2, 1e-6) - 1000, (10 * 0.5) / 1.5, 1e-9);
  });

  test('tilted plate displaces the beam by t·sinθ·[1 − cosθ / √(n² − sin²θ)] and leaves it parallel (FG)', () => {
    for (const th of [10, 30, 50]) {
      const n = 1.5;
      const t = 10;
      const rows = [
        { t: 50, ap: 1 },
        surf({ tilt: th, n, t: t / Math.cos(Math.asin(Math.sin(rad(th)) / n)) }),
        surf({ t: 50 }),
        surf(),
      ];
      rows[2].tilt = wrap(th - O.angle(O.build(rows)[0].uOut)); // second face parallel to the first
      const S = O.build(rows);
      near(
        Math.abs(S[1].P[1]),
        t * Math.sin(rad(th)) * (1 - Math.cos(rad(th)) / Math.sqrt(n * n - Math.sin(rad(th)) ** 2)),
        1e-12,
        `θ=${th}`,
      );
      near(O.angle(S[1].uOut), 0, 1e-12, 'parallel to input');
    }
  });

  test('prism at minimum deviation: δ = 2·asin(n·sin(A/2)) − A, symmetric passage; thin prism δ ≈ (n − 1)A (FG; H)', () => {
    for (const [A, n] of [
      [60, 1.5],
      [30, 1.7],
      [1, 1.5],
    ]) {
      const i = deg(Math.asin(n * Math.sin(rad(A / 2))));
      const rows = [{ t: 20, ap: 1 }, surf({ tilt: i, n, t: 10 }), surf({ t: 30 }), surf()];
      rows[2].tilt = wrap(O.angle(O.build(rows)[0].uOut) - i); // second face: mirror image of the first about the inside ray
      const S = O.build(rows);
      near(Math.abs(wrap(O.angle(S[1].uOut))), 2 * i - A, 1e-10, `A=${A} n=${n}`);
      near(S[1].aoi, A / 2, 1e-9, 'internal angle A/2 at the exit face');
      if (A < 2) rel(Math.abs(wrap(O.angle(S[1].uOut))), (n - 1) * A, 1e-4, 'thin prism');
    }
  });

  test('Mersenne afocal (confocal paraboloids): collimated out, beam compressed f2/f1, angular magnification f1/f2 (AO)', () => {
    const S = O.build([
      { t: 500, ap: 100 },
      mirror({ R: -2000, k: -1, t: 750 }),
      mirror({ R: 500, k: -1, t: 300 }),
      surf(),
    ]);
    near(O.curv(S, 1, 1e-3), 0, 1e-15, 'collimated');
    rel(
      Math.abs(O.toPlane([O.trace(S, 0, 50, 0)[1]], S[1].P, S[1].uOut)[0].xy[1]) / 50,
      0.25,
      1e-12,
      'beam compression',
    );
    rel(
      Math.abs(wrap(O.angle(O.trace(S, 0, 0, 0.01)[1].u) - O.angle(S[1].uOut))) / 0.01,
      4,
      1e-6,
      'angular magnification',
    );
    near(rmsWFE(O.wavefrontIn(S, O.bundle(S, 100, 21, 0))), 0, 1e-9, 'aberration-free on axis');
  });

  test('Lagrange invariant n(ū·y − u·ȳ) is conserved through lenses and a tilted mirror (FG)', () => {
    const rows = [
      { t: 30, ap: 5 },
      surf({ R: 40, t: 6, n: 1.62 }),
      surf({ R: -120, t: 30 }),
      mirror({ R: -300, tilt: 10, t: 80 }),
      surf({ R: 60, t: 4, n: 1.5 }),
      surf({ t: 60 }),
      surf(),
    ];
    const S = O.build(rows);
    const h = 1e-4;
    const e = 1e-4;
    const H = [];
    const yu = (r, j) => {
      const A = j ? S[j - 1].P : [0, 0, 0];
      const u = j ? S[j - 1].uOut : [0, 0, 1];
      const ey = [0, u[2], -u[1]];
      return [O.toPlane([r], A, u)[0].xy[1], dot(r.u, ey) / dot(r.u, u), r.n];
    };
    for (const j of [0, 2, 3, 4, 6]) {
      const [y, u, n] = yu([O.start(0, h, 0), ...O.trace(S, 0, h, 0)][j], j);
      const [yb, ub] = yu([O.start(0, 0, e), ...O.trace(S, 0, 0, e)][j], j);
      H.push(n * (ub * y - u * yb));
    }
    H.forEach((v, i) => rel(v, H[0], 1e-6, `segment ${i}`));
  });
});

describe('incoming beam from a focus (finite conjugates)', () => {
  /** ABCD from a point object: the beam's focus is −R before the pupil (R < 0). Returns the image distance after the last
   *  optic (where B = 0) and the lateral magnification A there (FG "Gaussian imaging"). */
  function conjugates(rows) {
    const mul = (A, B) => [
      [A[0][0] * B[0][0] + A[0][1] * B[1][0], A[0][0] * B[0][1] + A[0][1] * B[1][1]],
      [A[1][0] * B[0][0] + A[1][1] * B[1][0], A[1][0] * B[0][1] + A[1][1] * B[1][1]],
    ];
    let M = [
      [1, -rows[0].R + rows[0].t],
      [0, 1],
    ];
    let n = 1;
    rows.slice(1, -1).forEach((r, i, a) => {
      const c = r.R ? 1 / r.R : 0;
      const n2 = r.type === 'mirror' ? n : r.n;
      M = mul(
        [
          [1, 0],
          [-(r.type === 'mirror' ? -2 * n * c : (n2 - n) * c), 1],
        ],
        M,
      );
      if (i < a.length - 1)
        M = mul(
          [
            [1, r.t / n2],
            [0, 1],
          ],
          M,
        );
      n = n2;
    });
    const d = (-n * M[0][1]) / M[1][1];
    return { d, m: M[0][0] + (d / n) * M[1][0] };
  }

  test('chief rays pass through the pupil centre; converging input (R > 0) focuses perfectly R after the pupil', () => {
    for (const [R, h] of [
      [-100, 3],
      [250, -4],
    ]) {
      const r = O.start(0, 0, h, R);
      near(Math.atan2(r.u[1], r.u[2]), Math.atan2(R > 0 ? h : -h, Math.abs(R)), 1e-15);
    }
    const S = O.build([{ t: 50, ap: 5, R: 80 }, surf({ t: 30 }), surf()]);
    near(rms(S, 1, 5), 0, 1e-12, 'spot at the focus');
    near(1 / O.curv(S, 0, 1e-4), 30, 1e-9, 'beam ROC at S1');
  });

  test('a source at a parabola’s focus leaves collimated and aberration-free; off-axis by h it tilts by ≈ atan(h/f)', () => {
    const S = O.build([{ t: 500, ap: 50, R: -500 }, mirror({ R: -2000, k: -1, t: 300 }), surf()]);
    near(O.curv(S, 0, 1e-3), 0, 1e-15);
    near(rmsWFE(O.wavefrontIn(S, O.bundle(S, 50, 21, 0))), 0, 1e-12);
    rel(
      Math.abs(wrap(O.angle(O.trace(S, 0, 0, 0.5)[0].u) - O.angle(S[0].uOut))),
      deg(Math.atan(0.5 / 1000)),
      1e-5,
    ); // first order
  });

  test('a source at a sphere’s centre of curvature images back onto itself: stigmatic, |m| = 1', () => {
    const S = O.build([{ t: 500, ap: 20, R: -500 }, mirror({ R: -1000, t: 1000 }), surf()]);
    near(1 / O.curv(S, 0, 1e-3), 1000, 1e-9);
    near(rms(S, 1, 20), 0, 1e-12);
    rel(Math.abs(O.trace(S, 0, 0, 1e-3)[1].loc[1]), 1e-3, 1e-6, 'unit magnification');
  });

  test('finite conjugates: image distance and magnification match the matrix method; EFL is unchanged by the input', () => {
    for (const rows of [
      [{ t: 30, ap: 5, R: -120 }, surf({ R: 60, t: 8, n: 1.6 }), surf({ R: -80, t: 100 }), surf()],
      [
        { t: 20, ap: 4, R: -60 },
        surf({ R: 40, t: 6, n: 1.62 }),
        surf({ R: -120, t: 8 }),
        surf({ R: -35, t: 2, n: 1.72 }),
        surf({ R: 38, t: 7 }),
        surf({ R: 120, t: 5, n: 1.62 }),
        surf({ R: -45, t: 80 }),
        surf(),
      ],
      [{ t: 400, ap: 20, R: -1000 }, mirror({ R: -1000, t: 600 }), surf()],
    ]) {
      const S = O.build(rows);
      const ref = conjugates(rows);
      const last = S.length - 1;
      rel(bfd(S), ref.d, 1e-7, 'image distance');
      const plane = S[last - 1].P.map((v, k) => v + ref.d * S[last - 1].uOut[k]);
      const ch = O.toPlane([O.trace(S, 0, 0, 1e-4)[last - 1]], plane, S[last - 1].uOut)[0];
      rel(Math.abs(ch.xy[1] / 1e-4), Math.abs(ref.m), 1e-5, 'magnification');
      rel(
        O.efl(S, 1e-5),
        O.efl(O.build([{ ...rows[0], R: 0 }, ...rows.slice(1)]), 1e-5),
        1e-12,
        'EFL ignores the input beam',
      );
    }
  });

  test('Zemax: a beam from a focus exports a finite object (thickness −R) with object-height fields', () => {
    const z = O.zemax([{ t: 500, ap: 20, R: -500 }, mirror({ R: -1000, t: 1000 }), surf()], {
      fields: [0, 2],
    }).split('\r\n');
    assert.ok(z.includes('FTYP 1 0 2 1 0 0 0') && z.includes('YFLN 0 2'));
    assert.equal(z[z.indexOf('SURF 0') + 3], '  DISZ 5.000000000000000e+2');
    assert.ok(O.zemax(cassegrain()).includes('DISZ INFINITY'), 'collimated: object at infinity');
  });
});

describe('reflecting telescopes (Schroeder, Astronomical Optics)', () => {
  test('parabola: perfect on-axis focus at f = R/2 even at f/5', () => {
    const S = O.build(parabola(1000, 100));
    near(1 / O.curv(S, 0, 1e-3), 1000, 1e-6);
    near(rms(S, 1, 100), 0, 1e-9);
  });

  test('classical Cassegrain: layout on the correct hyperbola branch, perfect on axis, EFL = m·f1, plate scale EFL·tanθ', () => {
    // Regression: the ray start lies on the far branch of the secondary's hyperbola, a degenerate root.
    const S = O.build(cassegrain());
    assert.deepEqual(
      S.map(s => s.P.map(v => +v.toFixed(9))),
      [
        [0, 0, 500],
        [0, 0, -250],
        [0, 0, 750],
      ],
    );
    near(rms(S, 2, 100), 0, 1e-9, 'on-axis RMS');
    rel(O.efl(S, 1e-3), 4000, 1e-9, 'EFL');
    for (const th of [0.05, 0.1, -0.2])
      rel(O.trace(S, 0, 0, th)[2].loc[1], 4000 * Math.tan(rad(th)), 2e-4, `chief ray at ${th}°`);
  });

  test('Ritchey–Chrétien: AO conics satisfy the Abbe sine condition (coma-free); classical Cassegrain does not', () => {
    // m = secondary magnification, β = back focus / f1. K1 = −1 − 2(1+β)/(m²(m−β)), K2 = −((m+1)/(m−1))² − 2m(m+1)/((m−β)(m−1)³).
    const m = 4;
    const β = 0.25;
    const K1 = -1 - (2 * (1 + β)) / (m * m * (m - β));
    const K2 = -(((m + 1) / (m - 1)) ** 2) - (2 * m * (m + 1)) / ((m - β) * (m - 1) ** 3);
    const osc = rows => {
      const S = O.build(rows);
      const r = O.trace(S, 0, 100, 0).at(-1);
      const u = S.at(-1).uOut;
      const g = dot(r.u, u);
      return 100 / Math.hypot(...[0, 1, 2].map(k => r.u[k] - g * u[k])) / O.efl(S, 1e-4) - 1;
    }; // offence against the sine condition
    const rc = osc(cassegrain(K1, K2));
    const cl = osc(cassegrain());
    near(rc, 0, 1e-6, 'RC');
    assert.ok(Math.abs(cl) > 100 * Math.abs(rc), `classical ${cl} vs RC ${rc}`);
    const S = O.build(cassegrain(K1, K2));
    assert.ok(rmsWFE(O.wavefrontIn(S, O.bundle(S, 100, 21, 0))) < 1e-3 * 0.55e-3, 'RC on axis within 1e-3 λ');
  });

  test('OAP: focus at f + d²/4f from the hit point, perfect spot, beam turned by 2·atan(d/2f), AOI half that', () => {
    const S = O.build(oap(500, 150));
    const dev = 2 * deg(Math.atan(150 / 1000));
    near(1 / O.curv(S, 0, 1e-3), 511.25, 1e-6);
    near(rms(S, 1, 25), 0, 1e-9);
    near(Math.abs(wrap(O.angle(S[0].uOut) - 180)), dev, 1e-9);
    near(S[0].aoi, dev / 2, 1e-9);
  });

  test('OAP Z-relay: second OAP tilted by −2·atan(d/2f) recollimates, parallel to the input', () => {
    const S = O.build([
      { t: 300, ap: 25 },
      mirror({ R: -1000, k: -1, d: 150, t: 1022.5 }),
      mirror({ R: -1000, k: -1, d: 150, tilt: -2 * deg(Math.atan(0.15)), t: 400 }),
      surf(),
    ]);
    near(O.curv(S, 1, 1e-3), 0, 1e-12);
    near(O.angle(S[1].uOut), 0, 1e-9);
    assert.ok(Math.abs(O.efl(S, 1e-3)) > 1e9, 'afocal');
  });

  test('spherical mirror, stop at its centre of curvature: every field images on the concentric sphere of radius R/2', () => {
    const R = 1000;
    const S = O.build([{ t: R, ap: 5 }, mirror({ R: -R, t: R / 2 }), surf()]);
    const focus = f => {
      // least-squares point closest to all rays of field f
      const M = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ];
      const b = [0, 0, 0];
      for (const { p, u } of onSurf(S, 0, 5, f, 11))
        for (let i = 0; i < 3; i++)
          for (let j = 0; j < 3; j++) {
            const v = (i === j) - u[i] * u[j];
            M[i][j] += v;
            b[i] += v * p[j];
          }
      const det = m =>
        m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
        m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
        m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
      return [0, 1, 2].map(k => det(M.map((row, i) => row.map((v, j) => (j === k ? b[i] : v)))) / det(M));
    };
    const r0 = Math.hypot(...focus(0));
    near(r0, R / 2, 0.01, 'R/2 (less the small spherical-aberration shift)');
    for (const f of [5, 15, 30]) near(Math.hypot(...focus(f)), r0, 1e-3, `field ${f}°`);
  });
});

describe('aberrations and wavefronts', () => {
  test('spherical mirror: exact marginal crossing R − R/(2 cos θ); third-order longitudinal SA h²/4R (MOE)', () => {
    const R = 1000;
    const S = O.build([{ t: 100, ap: 50 }, mirror({ R: -R, t: 50 }), surf()]);
    for (const h of [1, 20, 50, 90]) {
      const { p, u } = O.trace(S, 0, h, 0)[0];
      near(100 - (p[2] - (p[1] / u[1]) * u[2]), R - R / (2 * Math.cos(Math.asin(h / R))), 1e-9, `h=${h}`);
    }
    for (const h of [5, 10]) {
      const { p, u } = O.trace(S, 0, h, 0)[0];
      rel(Math.abs(100 - R / 2 - (p[2] - (p[1] / u[1]) * u[2])), (h * h) / (4 * R), 1e-3, `LA h=${h}`);
    }
  });

  test('wavefront radius equals the distance to focus and shrinks by the distance travelled', () => {
    const S = O.build(parabola());
    const rs = onSurf(S, 0, 100);
    const u = S[0].uOut;
    const Q = s => S[0].P.map((v, k) => v + s * u[k]);
    const w0 = O.wavefront(rs, Q(0), u);
    const w2 = O.wavefront(rs, Q(200), u);
    near(w0.R, 1000, 1e-6);
    near(w2.R, 800, 1e-6);
    near(Math.max(...w0.opd.map(Math.abs)), 0, 1e-9);
  });

  test('spherical mirror WFE: balanced third-order spherical, PV ≈ W040/4 with W040 = h⁴/(4R³)', () => {
    const S = O.build([{ t: 500, ap: 100 }, mirror({ R: -2000, t: 1000 }), surf()]);
    const w = O.wavefront(onSurf(S, 0, 100, 0, 41), S[0].P, S[0].uOut);
    rel(Math.max(...w.opd) - Math.min(...w.opd), 100 ** 4 / (4 * 2000 ** 3) / 4, 0.03);
  });

  test('singlet bending: minimum spherical aberration near the third-order shape factor q = 2(n²−1)/(n+2) (MOE)', () => {
    // Sweep the shape factor at fixed thin-lens power; the RMS wavefront error of the on-axis beam is least near q_opt.
    const n = 1.5168;
    const f = 100;
    const P = 1 / ((n - 1) * f);
    const sweep = [];
    for (let q = 0; q <= 1.2; q += 0.01) {
      const c1 = (P * (q + 1)) / 2;
      const c2 = (P * (q - 1)) / 2;
      const S = O.build([{ t: 5, ap: 5 }, surf({ R: 1 / c1, n, t: 1 }), surf({ R: 1 / c2, t: 100 }), surf()]);
      sweep.push([q, rmsWFE(O.wavefrontIn(S, O.bundle(S, 5, 15, 0)))]);
    }
    near(sweep.reduce((b, s) => (s[1] < b[1] ? s : b))[0], (2 * (n * n - 1)) / (n + 2), 0.03);
  });

  test('the wavefront error is the same wherever it is measured, near focus or far, and for a field off the axis (checked against batoid)', () => {
    // A fast singlet (f/2, a wave or so of spherical): measured on planes from the lens to near its focus, the RMS error about
    // the best-fit sphere stays put. Off axis, a mis-figured Cassegrain at 0.1°: batoid 0.9 gives 0.01227 waves (0.0100 on axis).
    const S = O.build([
      { t: 5, ap: 12.5 },
      surf({ R: 60, n: 1.5168, t: 6 }),
      surf({ R: -200, t: 45 }),
      surf(),
    ]);
    const u = S[1].uOut;
    const A = S[1].P;
    const rs = O.bundle(S, 12.5, 41, 0)
      .filter(r => r.length > 3)
      .map(r => r[2]);
    const at = s =>
      O.wavefront(
        rs,
        A.map((v, k) => v + s * u[k]),
        u,
      );
    const ref = rmsWFE(at(0));
    assert.ok(ref > 1e-4);
    for (const s of [10, 30, 40, -500]) near(rmsWFE(at(s)), ref, 0.01 * ref, `plane ${s} mm on`);
    const C = O.build([
      { t: 500, ap: 100 },
      mirror({ R: -2000, k: -1.1, t: 750 }),
      mirror({ R: 666.667, k: -3.5, t: 1000 }),
      surf(),
    ]);
    const wfe = f => rmsWFE(O.wavefrontIn(C, O.bundle(C, 100, 41, f))) / 0.55e-3;
    rel(wfe(0), 0.01, 0.02, 'on axis');
    rel(wfe(0.1), 0.01227, 0.02, '0.1°');
  });

  test('NA and Airy radius of an f/10 beam: sin θ = h/(f + h²/4f) exactly for a parabola; 0.61λ/NA ≈ 1.22λN', () => {
    const S = O.build(parabola(1000, 50));
    const NA = O.na(
      onSurf(S, 0, 50).map(q => q.u),
      1,
    );
    rel(NA, 50 / (1000 + (50 * 50) / 4000), 1e-9);
    rel((0.61 * 0.55e-3) / NA, 1.22 * 0.55e-3 * 10, 0.005);
  });
});

describe('solves (focus and collimate)', () => {
  test('focus on a distance puts the next surface at the paraxial BFD; collimate on R gives the Mersenne secondary', () => {
    let R = singlet();
    R[2].solve = { t: { type: 'focus' } };
    O.applySolves(R);
    rel(R[2].t, abcd(singlet()).bfd, 1e-9, 'singlet BFD');
    R = cassegrain();
    R[2].solve = { R: { type: 'collim' } };
    O.applySolves(R);
    near(O.curv(O.build(R), 1, 1e-3), 0, 1e-12, 'collimated');
    rel(R[2].R, 500, 1e-6, 'secondary focus on prime focus: R = 2(f1 − t)');
    R = [{ t: 10, ap: 10 }, mirror({ t: 500, solve: { R: { type: 'focus' } } }), surf()];
    O.applySolves(R);
    rel(R[1].R, -1000, 1e-9, 'flat → R = −2t (solved as curvature, through flat)');
    R = oap();
    R.splice(
      2,
      0,
      mirror({ R: -1000, k: -1, d: 150, tilt: -15, t: 400, solve: { tilt: { type: 'collim' } } }),
    );
    R[1].t = 1022.5;
    O.applySolves(R); // from near the pose
    near(R[2].tilt, -2 * deg(Math.atan(0.15)), 1e-6, 'collimating tilt of an OAP');
  });

  test('only focus and collimate are offered; a solve with no solution fails and leaves the value; re-solving is bit-stable', () => {
    assert.deepEqual(O.solvesFor(singlet(), 1, 't'), ['focus', 'collim']);
    assert.deepEqual(O.solvesFor(singlet(), 3, 'R'), ['collim']);
    const R = [{ t: 10, ap: 10 }, surf({ t: 100, solve: { t: { type: 'focus' } } }), surf()];
    assert.ok(O.applySolves(R).has('1t'));
    assert.equal(R[1].t, 100);
    const C = cassegrain();
    C[2].solve = { t: { type: 'focus' } };
    O.applySolves(C);
    const t1 = C[2].t;
    O.applySolves(C);
    assert.equal(C[2].t, t1);
    const old = cassegrain();
    old[2].solve = { k: { type: 'wfe' } };
    O.applySolves(old);
    assert.equal(old[2].solve.k, undefined, 'unknown solve types are dropped');
  });
});

describe('tilt pivots', () => {
  test('a sphere turned about its centre of curvature is unchanged', () => {
    const flat = O.build([{ t: 100, ap: 10 }, mirror({ R: -300, t: 100 }), surf()]);
    const coc = O.build([
      { t: 100, ap: 10 },
      mirror({ R: -300, tilt: 13, pivot: { at: 'coc', ref: 0 }, t: 100 }),
      surf(),
    ]);
    for (let k = 0; k < 3; k++) {
      near(coc[0].P[k], flat[0].P[k], 1e-9);
      near(coc[0].uOut[k], flat[0].uOut[k], 1e-12);
    }
  });

  test('a flat mirror swung by θ about an upstream optic is hit at D / cos θ and reflects by 2θ', () => {
    for (const th of [5, 20, -35]) {
      const S = O.build([
        { t: 50, ap: 1 },
        surf({ t: 100 }),
        mirror({ tilt: th, pivot: { at: 1, ref: 0 }, t: 10 }),
        surf(),
      ]);
      near(Math.hypot(...S[1].P.map((v, k) => v - S[0].P[k])), 100 / Math.cos(rad(th)), 1e-9, `θ=${th}`);
      near(wrap(O.angle(S[1].uOut) - (180 + 2 * th)), 0, 1e-9);
    }
  });

  test('choosing a pivot never moves the optic; an OAP swung about its own focus stays collimated', () => {
    const relay = (tilt, pivot) =>
      O.build([
        { t: 300, ap: 25 },
        mirror({ R: -1000, k: -1, d: 150, t: 511.25 }),
        surf({ t: 511.25 }),
        mirror({ R: -1000, k: -1, d: 150, tilt, pivot, t: 400 }),
        surf(),
      ]);
    const t0 = -2 * deg(Math.atan(0.15));
    const a = relay(t0);
    const b = relay(t0, { at: 2, ref: t0 });
    assert.deepEqual(b[2].P, a[2].P);
    assert.deepEqual(b[2].uOut, a[2].uOut);
    for (const sw of [-10, -28, 15]) {
      const S = relay(t0 + sw, { at: 2, ref: t0 });
      near(O.curv(S, 2, 1e-3), 0, 1e-12, `collimated after ${sw}°`);
      near(wrap(O.angle(S[2].uOut) - sw), 0, 1e-9, `output turned ${sw}°`);
    }
  });
});

describe('dragging an optic (moveOptic)', () => {
  const folded = () => [
    { t: 300, ap: 25 },
    mirror({ R: -2000, k: -1, t: 400 }),
    mirror({ tilt: 40, t: 300 }),
    surf({ R: 100, n: 1.5, t: 5 }),
    surf({ R: -100, t: 80 }),
    surf(),
  ];
  const relay = () => [
    { t: 300, ap: 25 },
    mirror({ R: -1000, k: -1, d: 150, t: 511.25 }),
    surf({ t: 511.25 }),
    mirror({ R: -1000, k: -1, d: 150, tilt: -17.0604, t: 400 }),
    surf(),
  ];
  const vec = (a, b) => Math.hypot(...a.map((v, k) => v - b[k]));

  test('only the grabbed optic moves: its parent translates rigidly by the pointer’s displacement, keeping its orientation; upstream is untouched', () => {
    for (const [rows, s] of [
      [relay(), 2],
      [folded(), 0],
      [relay().map((r, i) => (i === 3 ? { ...r, pivot: { at: 'coc', ref: -17.0604 } } : r)), 2],
    ]) {
      const snap = JSON.stringify(rows);
      const S = O.build(rows);
      for (const D of [
        [0, 30, -20],
        [0, -45, 60],
      ]) {
        const R = O.moveOptic(
          rows,
          s,
          S[s].P.map((v, k) => v + D[k]),
        );
        const T = O.build(R);
        near(
          vec(
            T[s].V,
            S[s].V.map((v, k) => v + D[k]),
          ),
          0,
          1e-9,
          'vertex moved by D',
        );
        near(vec(T[s].ez, S[s].ez), 0, 1e-12, 'parent axis direction kept');
        assert.equal(R[s + 1].tilt, rows[s + 1].tilt);
        for (let j = 0; j < s; j++) {
          assert.deepEqual(T[j].P, S[j].P);
          assert.deepEqual(T[j].uOut, S[j].uOut);
        }
        R.forEach((r, i) => {
          if (i !== s && i !== s + 1) assert.deepEqual(r, rows[i], `row ${i} unchanged`);
        });
      }
      assert.equal(JSON.stringify(rows), snap, 'input rows untouched');
    }
  });

  test('a paraboloid moved across a collimated beam: the beam lands off-axis on it and still converges on its (moved) focus', () => {
    const rows = parabola(1000);
    const S = O.build(rows);
    const F0 = O.foci(S[0])[0];
    for (const dy of [40, -70]) {
      const R = O.moveOptic(
        rows,
        0,
        S[0].P.map((v, k) => v + (k === 1 ? dy : 0)),
      );
      const T = O.build(R);
      const F = O.foci(T[0])[0];
      near(R[1].d, -dy, 1e-9, 'lands dy lower on the parent');
      near(
        vec(
          F,
          F0.map((v, k) => v + (k === 1 ? dy : 0)),
        ),
        0,
        1e-9,
        'focus moved with it',
      );
      const q = F.map((v, k) => v - T[0].P[k]);
      const c = q.map(
        (v, k) => v - T[0].uOut[k] * (q[0] * T[0].uOut[0] + q[1] * T[0].uOut[1] + q[2] * T[0].uOut[2]),
      );
      near(Math.hypot(...c), 0, 1e-9, 'reflected axis ray passes through the focus');
      near(
        rms(O.build(R.map((r, i) => (i === 1 ? { ...r, t: Math.hypot(...q) } : r))), 1, 20, 0),
        0,
        1e-9,
        'perfect focus, as an OAP',
      );
    }
  });

  test('along the axis only with Shift, or for a flat; a drag removes solves and lock variations on the values it sets', () => {
    const rows = folded();
    const S = O.build(rows);
    const Q = [0, S[1].P[1] + 60, S[1].P[2] - 80];
    const flat = O.moveOptic(rows, 1, Q);
    near(flat[1].t, 400 + 80, 1e-9, 'projection on the incoming axis');
    assert.equal(flat[2].d, 0);
    const Sr = O.build(relay());
    const D = [0, 30, -20];
    const shift = O.moveOptic(
      relay(),
      2,
      Sr[2].P.map((v, k) => v + D[k]),
      { along: true },
    );
    assert.equal(shift[3].d, 150);
    near(shift[2].t, 511.25 + dot(D, Sr[1].uOut), 1e-9, 'Shift: projection on the incoming axis');
    const sd = relay();
    sd[2].solve = { t: { type: 'focus' } };
    sd[3].solve = { d: { type: 'collim' } };
    sd[3].lock = { f1: { at: 2 }, vary: ['tin', 'tilt'] };
    const m = O.moveOptic(
      sd,
      2,
      O.build(sd)[2].P.map((v, k) => v + [0, 10, 5][k]),
    );
    assert.equal(m[2].solve.t, undefined);
    assert.equal(m[3].solve.d, undefined);
    assert.deepEqual(m[3].lock.vary, ['tilt']);
    // a lock that varies the off-axis distance owns it: the drag goes along the incoming axis and leaves it varying
    const ld = relay();
    ld[3].lock = { f1: { at: 2 }, vary: ['tin', 'd', 'tilt'] };
    const Sl = O.build(ld);
    const m2 = O.moveOptic(
      ld,
      2,
      Sl[2].P.map((v, k) => v + [0, 10, 5][k]),
    );
    assert.equal(m2[3].d, 150);
    near(m2[2].t, 511.25 + dot([0, 10, 5], Sl[1].uOut), 1e-9);
    assert.deepEqual(m2[3].lock.vary, ['d', 'tilt']);
  });

  test('tilt in place (Alt-drag): turns about the pivot only; upstream untouched; a tilt solve or lock variation is removed', () => {
    const rows = relay();
    const S = O.build(rows);
    const R = O.tiltOptic(rows, 0, 5);
    const T = O.build(R);
    near(R[1].tilt, 5, 0);
    assert.deepEqual(T[0].P, S[0].P, 'about its own hit point, the hit stays put');
    near(
      wrap(O.angle(T[0].uOut) - O.angle(S[0].uOut)),
      10,
      1e-9,
      'a mirror turned by 5° turns the beam by 10°',
    );
    const coc = relay();
    coc[3] = {
      ...coc[3],
      pivot: { at: 'coc', ref: coc[3].tilt },
      solve: { tilt: { type: 'collim' } },
      lock: { f1: { at: 2 }, vary: ['tilt', 'R'] },
    };
    const S2 = O.build(coc);
    const C = S2[2].pivotAt;
    const R2 = O.tiltOptic(coc, 2, -7);
    const T2 = O.build(R2);
    near(vec(T2[2].V, C), vec(S2[2].V, C), 1e-9, 'vertex swings on a circle about the centre of curvature');
    near(wrap(O.angle(T2[2].ez) - O.angle(S2[2].ez)), -7, 1e-9);
    assert.equal(R2[3].solve.tilt, undefined);
    assert.deepEqual(R2[3].lock.vary, ['R']);
    for (let j = 0; j < 2; j++) assert.deepEqual(T2[j].P, S2[j].P);
  });

  test('with focus locks the dragged optic re-solves itself: an ellipsoid dragged anywhere still images the source perfectly', () => {
    const rows = [
      { t: 100, ap: 10, R: -200 },
      mirror({
        R: -400,
        k: -0.25,
        d: 50,
        t: 600,
        lock: { f1: { at: 'src' }, f2: { at: 2 }, vary: ['R', 'tilt', 't'] },
      }),
      surf(),
    ];
    O.applySolves(rows);
    const S = O.build(rows);
    for (const D of [
      [0, 25, 40],
      [0, -20, -30],
    ]) {
      const R = O.moveOptic(
        rows,
        0,
        S[0].P.map((v, k) => v + D[k]),
      );
      assert.equal(O.applySolves(R).size, 0);
      const T = O.build(R);
      near(rms(T, 1, 10, 0), 0, 1e-9, 'stigmatic');
      near(vec(O.foci(T[0])[0], [0, 0, -200]), 0, 1e-7, 'F1 on the source');
    }
  });
});

describe('Zemax export', () => {
  /** Rebuild each surface's vertex, axis, curvature and conic from a .zmx using OpticStudio's rules: thickness moves along
   *  local z after a surface; a coordinate break decenters then tilts (order 0) or tilts then decenters (order 1);
   *  tilt about x is right-handed (clockwise in this tool's y-up, z-right view). */
  function readZmx(txt) {
    let o = [0, 0, 0];
    let θ = 0;
    const ez = t => [0, Math.sin(rad(t)), Math.cos(rad(t))];
    const ey = t => [0, Math.cos(rad(t)), -Math.sin(rad(t))];
    const mv = (v, s) => (o = o.map((x, i) => x + s * v[i]));
    const out = [];
    for (const b of txt.split(/\r\n(?=SURF )/).slice(2)) {
      const num = k => +(b.match(new RegExp(`\\n  ${k} (\\S+)`)) ?? [0, 0])[1];
      if (/COORDBRK/.test(b)) {
        const P = i => +b.match(new RegExp(`PARM ${i} (\\S+)`))[1];
        if (P(6)) {
          θ -= P(3);
          mv(ey(θ), P(2));
        } else {
          mv(ey(θ), P(2));
          θ -= P(3);
        }
      } else
        out.push({
          V: o.slice(),
          ez: ez(θ),
          c: num('CURV'),
          k: num('CONI'),
          mirror: /GLAS MIRROR/.test(b),
          glass: b.match(/GLAS ___BLANK 1 0 (\S+)/)?.[1],
        });
      mv(ez(θ), num('DISZ'));
    }
    return out;
  }
  const systems = {
    'OAP relay': [
      { t: 300, ap: 25 },
      mirror({ R: -1000, k: -1, d: 150, t: 511.25 }),
      surf({ t: 511.25 }),
      mirror({ R: -1000, k: -1, d: 150, tilt: -17.0604, t: 400 }),
      surf(),
    ],
    'fold + tilted lens': [
      { t: 100, ap: 10 },
      mirror({ tilt: 45, t: 50 }),
      surf({ R: 80, n: 1.6, t: 5, tilt: 3 }),
      surf({ R: -80, t: 90 }),
      surf(),
    ],
    'OAP swung about a pivot': [
      { t: 300, ap: 25 },
      mirror({ R: -1000, k: -1, d: 150, t: 511.25 }),
      surf({ t: 511.25 }),
      mirror({ R: -1000, k: -1, d: 150, tilt: -40, pivot: { at: 2, ref: -17.0604 }, t: 400 }),
      surf(),
    ],
    Cassegrain: cassegrain(),
  };

  test('round trip: every vertex, axis, curvature, conic and glass is reproduced', () => {
    for (const [name, rows] of Object.entries(systems)) {
      const S = O.build(rows);
      const Z = readZmx(O.zemax(rows));
      assert.equal(Z.length, S.length + 2, `${name}: stop + surfaces + image`);
      S.forEach((s, i) => {
        const z = Z[i + 1];
        const σ = Math.sign(dot(z.ez, s.ez)); // σ = −1 in the frames Zemax flips after a mirror
        near(Math.hypot(...z.V.map((v, k) => v - s.V[k])), 0, 1e-9, `${name} S${i + 1} vertex`);
        near(Math.hypot(...z.ez.map((v, k) => v - σ * s.ez[k])), 0, 1e-12, `${name} S${i + 1} axis`);
        near(z.c, σ * s.c, 1e-15, `${name} S${i + 1} curvature`);
        near(z.k, s.k, 1e-14, `${name} S${i + 1} conic`);
        assert.equal(z.mirror, s.mirror);
        if (!s.mirror && s.nOut !== 1) near(+z.glass, s.nOut, 1e-12);
      });
    }
  });

  test('Zemax conventions: light travels −z after a mirror; a 45° fold is CB −45, mirror, CB −45, negative thickness', () => {
    const Z = O.zemax([{ t: 100, ap: 10 }, mirror({ tilt: 45, t: 50 }), surf()]).split('\r\n');
    const surfs = Z.join('\n')
      .split(/\n(?=SURF )/)
      .slice(2)
      .map(b => [
        b.match(/TYPE (\S+)/)[1],
        +(b.match(/PARM 3 (\S+)/) ?? [0, NaN])[1],
        +b.match(/DISZ (\S+)/)[1],
      ]);
    assert.deepEqual(
      surfs.map(s => s[0]),
      ['STANDARD', 'COORDBRK', 'STANDARD', 'COORDBRK', 'STANDARD', 'STANDARD'],
    );
    assert.deepEqual([surfs[0][2], surfs[1][1], surfs[3][1], surfs[3][2]], [100, -45, -45, -50]);
    assert.ok(
      Z.includes('ENPD 2.000000000000000e+1') &&
        Z.includes('WAVM 1 0.55 1') &&
        Z.some(l => l.includes('GLAS MIRROR')),
    );
  });
});

describe('edge cases', () => {
  test('vignetting, virtual (negative) distances, coincident surfaces, missed surfaces, sampling', () => {
    const V = O.build([{ t: 10, ap: 10 }, surf({ ap: 5, t: 10 }), surf()]);
    assert.equal(O.trace(V, 0, 4.999, 0).length, 2);
    assert.equal(O.trace(V, 0, 5.001, 0).length, 0);
    near(O.build([{ t: 10, ap: 1 }, surf({ t: -30 }), surf()])[1].P[2], -20, 1e-12, 'virtual surface behind');
    const z = O.trace(O.build([{ t: 10, ap: 1 }, surf({ n: 1.5 }), surf({ n: 1 }), surf()]), 0, 0.5, 3).at(
      -1,
    );
    near(z.u[1], Math.sin(rad(3)), 1e-12, 'zero-thickness plate: no deviation');
    const M = O.build([{ t: 10, ap: 50 }, surf({ R: 20, n: 1.5, t: 5 }), surf()]);
    assert.equal(O.trace(M, 0, 30, 0).length, 0, 'ray above a steep sphere misses');
    assert.equal(O.trace(M, 0, 0, 0)[0].u[2], 1, 'vertex ray undeviated');
    assert.deepEqual(O.fan(3, 1), [[0, 0]]);
    const g = O.grid(1, 21);
    near(
      g.reduce((a, p) => a + p[0] + p[1], 0),
      0,
      1e-12,
      'symmetric grid',
    );
    assert.ok(g.every(([x, y]) => x * x + y * y <= 1 + 1e-9));
    near(
      O.secant(x => x * x - 2, 1, 0.01),
      Math.SQRT2,
      1e-12,
    );
    assert.ok(Number.isNaN(O.secant(x => x * x + 1, 1, 0.01)), 'no real root');
  });

  test('mirror blank: an off-axis concave segment is thinnest (= th) at its inner edge', () => {
    const s = O.build(oap())[0];
    const pts = O.blank(s, -20, 20, 10);
    const m = pts.length - 2;
    const dz = p => (p[1] - s.V[1]) * s.ez[1] + (p[2] - s.V[2]) * s.ez[2];
    near(dz(pts[m + 1]) - dz(pts[0]), 10, 1e-9, 'inner edge');
    assert.ok(dz(pts[m]) - dz(pts[m - 1]) > 10, 'outer edge thicker');
  });
});

describe('conic foci and focus locks', () => {
  const add3 = (a, b) => a.map((v, k) => v + b[k]);
  test('through fold flats: a pinned focus goes to its target as seen through the flats between (focal plane → fold → OAP recollimates; a fold before the image plane)', () => {
    const rows = [
      { t: 300, ap: 25 },
      mirror({ R: -1000, k: -1, d: 150, t: 511.25 }),
      surf({ t: 150 }),
      mirror({ tilt: 30, t: 361.25 }),
      mirror({ R: -900, k: -1, d: 150, tilt: 5, t: 400, lock: { f1: { at: 2 }, vary: ['R', 'tilt'] } }),
      surf(),
    ];
    assert.ok(O.holdFoci(rows, 4));
    near(rows[4].R, -1000, 1e-6, 'the OAP pair of a 4f relay');
    const S = O.build(rows);
    const u = [-10, 0, 10].map(y => O.trace(S, 0, y, 0)[4].u); // after OAP 2: every ray parallel (collimated)
    u.forEach(v => near(Math.hypot(...v.map((x, k) => x - u[1][k])), 0, 1e-9, 'collimated after the fold'));
    const Q = O.lockPoint(S, { at: 2 }, 3);
    const P = S[1].P;
    const m = S[2]; // the target is the focus's mirror image in the fold
    near(Math.hypot(...O.foci(S[3])[0].map((v, k) => v - Q[k])), 0, 1e-6);
    assert.ok(Math.hypot(...Q.map((v, k) => v - P[k])) > 100, 'not the focus itself');
    near(
      Math.abs(O.lockPoint(S, { at: 2 }, 1)[2] - P[2]) + Math.abs(O.lockPoint(S, { at: 2 }, 1)[1] - P[1]),
      0,
      0,
      'no flats between: the point itself',
    );
    // F2 of an off-axis ellipsoid pinned to an image plane that lies beyond a fold: the rays meet on that plane
    const e = [
      { t: 200, ap: 5, R: -200 },
      mirror({
        R: -300,
        k: -0.3,
        d: 40,
        t: 150,
        lock: { f1: { at: 'src' }, f2: { at: 3 }, vary: ['R', 'k', 'tilt'] },
      }),
      mirror({ tilt: 25, t: 350 }),
      surf(),
    ];
    assert.ok(O.holdFoci(e, 1));
    const E = O.build(e);
    const ys = [-5, 0, 5].map(y => O.trace(E, 0, y, 0)[2].loc[1]);
    ys.forEach(y => near(y, ys[1], 1e-6, 'a perfect image on the plane beyond the fold'));
  });
  const locked = (lock, rows) => ((rows[1] = { ...rows[1], lock }), rows);
  test('foci: paraboloid F = R/2 (F2 at ∞); sphere F1 = F2 = centre; ellipsoid |PF1| + |PF2| = 2a and hyperboloid ||PF1| − |PF2|| = 2a', () => {
    const [p] = O.build(parabola(1000));
    const [s] = O.build([{ t: 10, ap: 1 }, mirror({ R: -300 })]);
    near(O.foci(p)[0][2], 500 - 1000, 1e-9);
    assert.equal(O.foci(p)[1], null);
    near(O.foci(s)[0][2], 10 - 300, 1e-9);
    near(O.foci(s)[1][2], 10 - 300, 1e-9);
    assert.deepEqual(O.foci(O.build([{ t: 0, ap: 1 }, mirror({ R: -100, k: 0.5 })])[0]), []); // oblate: none on the axis
    for (const [k, sgn] of [
      [-0.36, 1],
      [-2.25, -1],
    ]) {
      const S = O.build([{ t: 50, ap: 1 }, mirror({ R: -400, k, d: 30, tilt: 7 })]);
      const [F1, F2] = O.foci(S[0]);
      const a = 400 / Math.abs(1 + k);
      for (const P of O.profile(S[0], -60, 60, 9)) {
        const d1 = Math.hypot(...P.map((v, i) => v - F1[i]));
        const d2 = Math.hypot(...P.map((v, i) => v - F2[i]));
        near(sgn > 0 ? d1 + d2 : Math.abs(d1 - d2), 2 * a, 1e-9, `k = ${k}`);
      }
    }
  });
  test('parent span runs through the vertex and stops short of an ellipsoid’s rim', () => {
    const [s] = O.build(oap());
    const [a, b] = O.parentSpan(s, -20, 20);
    assert.ok(a + s.d < 0 && b + s.d > 0);
    near(b + s.d, -(a + s.d), 1e-12);
    near(b + s.d, 170, 1e-9);
    const [e] = O.build([{ t: 0, ap: 1 }, mirror({ R: -100, k: -0.5, d: 60 })]);
    const [, y1] = O.parentSpan(e, -500, 500);
    assert.ok(y1 + e.d < 100 / Math.sqrt(0.5) && isFinite(O.sag(e.c, e.k, (y1 + e.d) ** 2)));
  });
  test('an ellipsoid with F1 on a point source images it perfectly at F2 (the stigmatic pair)', () => {
    const p = 300;
    const q = 900;
    const e = (q - p) / (q + p);
    const S = O.build([
      { t: 100, ap: 20, R: -200 },
      mirror({ R: (-2 * p * q) / (p + q), k: -e * e, t: q }),
      surf(),
    ]);
    const [F1, F2] = O.foci(S[0]);
    near(F1[2], -200, 1e-9);
    near(F2[2], S[1].P[2], 1e-9);
    near(rms(S, 1, 20, 0), 0, 1e-10);
  });
  test('Cassegrain secondary locked confocal (F1 → primary focus, F2 → focal plane) by varying R and k matches AO: R₂ = 2ps/(p − s), k₂ = −((m + 1)/(m − 1))²', () => {
    for (const sp of [600, 750, 900]) {
      const rows = cassegrain();
      rows[1].t = sp;
      rows[2] = { ...rows[2], t: sp + 150, lock: { f1: { at: 1, f: 1 }, f2: { at: 3 }, vary: ['R', 'k'] } };
      assert.equal(O.applySolves(rows).size, 0);
      const s = 1000 - sp;
      const p = sp + 150;
      const m = p / s;
      rel(rows[2].R, (2 * s * p) / (p - s), 1e-9, 'R₂');
      rel(rows[2].k, -(((m + 1) / (m - 1)) ** 2), 1e-9, 'k₂');
      near(rms(O.build(rows), 2, 100, 0), 0, 1e-9, 'perfect on axis');
    }
  });
  test('an off-axis ellipsoid posed by the lock (vary R, tilt, distance out) images the source stigmatically', () => {
    const rows = [
      { t: 100, ap: 10, R: -200 },
      mirror({
        R: -400,
        k: -0.25,
        d: 50,
        t: 600,
        lock: { f1: { at: 'src' }, f2: { at: 2 }, vary: ['R', 'tilt', 't'] },
      }),
      surf(),
    ];
    assert.equal(O.applySolves(rows).size, 0);
    near(rms(O.build(rows), 1, 10, 0), 0, 1e-9);
  });
  test('OAP relay: pinning OAP 2’s focus on the intermediate focus recollimates (Z-relay tilt −2·atan(d/2f)); the tilt alone suffices only while the spacing matches f + d²/4f', () => {
    const relay = d2 => [
      { t: 300, ap: 25 },
      mirror({ R: -1000, k: -1, d: 150, t: 511.25 }),
      surf({ t: 511.25 }),
      mirror({ R: -1000, k: -1, d: d2, t: 400, lock: { f1: { at: 2 }, vary: ['tilt'] } }),
      surf(),
    ];
    let rows = relay(150);
    assert.equal(O.applySolves(rows).size, 0);
    near(rows[3].tilt, -2 * deg(Math.atan(150 / 1000)), 1e-7);
    near(O.curv(O.build(rows), 2, 1e-3), 0, 1e-12);
    rows = relay(100);
    const t0 = rows[3].tilt;
    assert.ok(O.applySolves(rows).has('3lock'));
    assert.equal(rows[3].tilt, t0, 'unchanged on failure');
    rows[3].lock.vary = ['tilt', 'tin'];
    assert.equal(O.applySolves(rows).size, 0);
    near(rows[2].t, 500 + (100 * 100) / 2000, 1e-7, 'f + d²/4f');
    near(rows[3].tilt, -2 * deg(Math.atan(100 / 1000)), 1e-7);
    const S = O.build(rows);
    near(O.curv(S, 2, 1e-3), 0, 1e-12);
    near(
      Math.abs(O.angle(S[2].uOut)),
      2 * deg(Math.atan(150 / 1000) - Math.atan(100 / 1000)),
      1e-7,
      'turned by the difference of the two OAP deviations',
    );
  });
  test('a solve on the same row re-runs after its lock: focus on the distance out follows the R and tilt the lock sets, landing on F2', () => {
    const rows = [
      { t: 100, ap: 10, R: -200 },
      mirror({
        R: -400,
        k: -0.25,
        d: 50,
        t: 600,
        solve: { t: { type: 'focus' } },
        lock: { f1: { at: 'src' }, vary: ['R', 'tilt'] },
      }),
      surf(),
    ];
    assert.equal(O.applySolves(rows).size, 0);
    const S = O.build(rows);
    near(1 - rows[1].t * O.curv(S, 0, 1e-3), 0, 1e-9, 'focus solve holds');
    near(
      rows[1].t,
      Math.hypot(...O.foci(S[0])[1].map((v, k) => v - S[0].P[k])),
      1e-6,
      'the next surface sits on F2',
    );
    near(rms(S, 1, 10, 0), 0, 1e-9, 'stigmatic');
    const j = JSON.stringify(rows);
    O.applySolves(rows);
    assert.equal(JSON.stringify(rows), j, 'bit-stable');
  });
  test('re-solving a held lock is bit-stable (clean undo snapshots)', () => {
    const rows = cassegrain();
    rows[2].lock = { f1: { at: 1, f: 1 }, f2: { at: 3 }, vary: ['R', 'k'] };
    rows[1].t = 700;
    O.applySolves(rows);
    const j = JSON.stringify(rows);
    O.applySolves(rows);
    assert.equal(JSON.stringify(rows), j);
  });
  test('vary rule: every value that can move a pinned focus may vary; ones that add no new direction are reported as spare; ineffective ones are flagged', () => {
    const rows = cassegrain();
    rows[2].lock = { f2: { at: 3 }, vary: [] };
    assert.deepEqual(
      O.varyPick(rows, 2, ['t', 'R']),
      { keep: ['t', 'R'], zero: [], spare: ['R'] },
      'on axis both only move F2 along the axis',
    );
    assert.deepEqual(
      O.varyPick(rows, 2, ['tilt', 'R']),
      { keep: ['tilt', 'R'], zero: [], spare: [] },
      'tilt moves it sideways',
    );
    rows[2].lock = { f1: { at: 1, f: 1 }, vary: [] };
    assert.deepEqual(
      O.varyPick(rows, 2, ['t']).zero,
      ['t'],
      'the distance out cannot move a focus pinned upstream',
    );
    const ell = [
      { t: 100, ap: 10, R: -200 },
      mirror({
        R: -400,
        k: -0.25,
        d: 50,
        t: 600,
        lock: { f1: { at: 'src' }, f2: { at: 2 }, vary: ['R', 'tilt', 't'] },
      }),
      surf(),
    ];
    O.applySolves(ell); // on the solution F2 sideways follows from F1 (reflection): 3 equations
    assert.deepEqual(O.varyPick(ell, 1, ['t', 'tilt', 'R', 'k', 'd']), {
      keep: ['t', 'tilt', 'R', 'k', 'd'],
      zero: [],
      spare: ['k', 'd'],
    });
  });
  test('dragging with more values than needed: R, k and off-axis follow a drag (position and tilt) and hold the pinned foci with the smallest change', () => {
    // an OAP whose F1 is pinned to the intermediate focus, varying R, k and off-axis (one focus: two equations, three values)
    let rows = [
      { t: 300, ap: 25 },
      mirror({ R: -1000, k: -1, d: 150, t: 511.25 }),
      surf({ t: 511.25 }),
      mirror({
        R: -1000,
        k: -1,
        d: 150,
        tilt: -17.0604,
        t: 400,
        lock: { f1: { at: 2 }, vary: ['R', 'k', 'd'] },
      }),
      surf(),
    ];
    assert.ok(O.heldD(rows, 3));
    O.applySolves(rows);
    for (const [kind, v] of [
      ['move', [0, 40, 60]],
      ['move', [0, -30, -80]],
      ['tilt', 6],
      ['tilt', -9],
    ]) {
      const S = O.build(rows);
      const before = { ...rows[3] };
      const gap = rows[2].t;
      rows =
        kind === 'move'
          ? O.moveOptic(
              rows,
              2,
              S[2].P.map((x, k) => x + v[k]),
            )
          : O.tiltOptic(rows, 2, v);
      if (kind === 'move') {
        near(
          rows[2].t,
          gap + dot(v, S[1].uOut),
          1e-9,
          "the off-axis distance is the lock's: the drag moves the optic along its incoming axis",
        );
        assert.equal(rows[3].d, before.d);
      }
      const fails = O.applySolves(rows);
      assert.equal(fails.size, 0, `${kind} ${v}: held`);
      assert.deepEqual(rows[3].lock.vary, ['R', 'k', 'd'], 'all three still vary');
      O.lockRes(rows, 3).forEach(x => near(x, 0, 1e-6, 'F1 on the focus'));
      assert.ok(['R', 'k', 'd'].every(k => rows[3][k] !== before[k]) || kind === 'move', 'they all moved');
    }
    // an off-axis ellipse imaging the source onto a plane (both foci pinned), varying R, k, off-axis, tilt and dist out
    let e = [
      { t: 200, ap: 5, R: -200 },
      mirror({
        R: -440,
        k: -0.1,
        d: 40,
        t: 350,
        lock: { f1: { at: 'src' }, f2: { at: 2 }, vary: ['R', 'k', 'd', 'tilt', 't'] },
      }),
      surf(),
    ];
    assert.ok(O.holdFoci(e, 1));
    const spot = () => {
      const E = O.build(e);
      const ys = [-4, 0, 4].map(y => O.trace(E, 0, y, 0)[1].loc[1]);
      return Math.max(...ys) - Math.min(...ys);
    };
    for (const dz of [40, -70]) {
      const S = O.build(e);
      e = O.moveOptic(e, 0, add3(S[0].P, [0, 0, dz]));
      assert.equal(O.applySolves(e).size, 0);
      near(spot(), 0, 1e-8, 'a perfect image wherever it is dragged');
    }
    e = O.tiltOptic(e, 0, 4);
    assert.equal(O.applySolves(e).size, 0);
    near(spot(), 0, 1e-8, 'and however it is tilted');
    assert.deepEqual(e[1].lock.vary, ['R', 'k', 'd', 't'], "the tilt is the drag's");
  });
});

describe('Zemax import (fromZemax)', () => {
  const zmx = (head, surfs) =>
    [...head, ...surfs.flatMap((s, i) => [`SURF ${i}`, ...s.map(l => '  ' + l)])].join('\r\n');
  const sameGeometry = (A, B, tol, msg) =>
    A.forEach((s, i) => {
      near(Math.hypot(...s.V.map((v, k) => v - B[i].V[k])), 0, tol, `${msg} S${i + 1} vertex`);
      near(Math.hypot(...s.ez.map((v, k) => v - B[i].ez[k])), 0, 1e-12, `${msg} S${i + 1} axis`);
      near(s.c, B[i].c, 1e-15);
      near(s.k, B[i].k, 1e-14);
      assert.equal(s.mirror, B[i].mirror);
      near(s.nOut, B[i].nOut, 1e-12);
    });

  test('round trip through our own export rebuilds every vertex, axis, curvature, conic and index (folds, OAPs, pivots, finite object)', () => {
    const systems = [
      [
        { t: 300, ap: 25 },
        mirror({ R: -1000, k: -1, d: 150, t: 511.25 }),
        surf({ t: 511.25 }),
        mirror({ R: -1000, k: -1, d: 150, tilt: -17.0604, t: 400 }),
        surf(),
      ],
      [
        { t: 100, ap: 10 },
        mirror({ tilt: 45, t: 50 }),
        surf({ R: 80, n: 1.6, t: 5, tilt: 3 }),
        surf({ R: -80, t: 90 }),
        surf(),
      ],
      [
        { t: 300, ap: 25 },
        mirror({ R: -1000, k: -1, d: 150, t: 511.25 }),
        surf({ t: 511.25 }),
        mirror({ R: -1000, k: -1, d: 150, tilt: -40, pivot: { at: 2, ref: -17.0604 }, t: 400 }),
        surf(),
      ],
      cassegrain(),
      [{ t: 10, ap: 10, R: -90 }, surf({ t: 6, n: 1.5168 }), surf({ R: -51.68, t: 60 }), surf()],
    ];
    for (const rows of systems) {
      const im = O.fromZemax(O.zemax(rows, { fields: [0, 1], lambda: 0.6328 }));
      assert.equal(im.rows.length, rows.length);
      assert.deepEqual(im.warnings, []);
      assert.deepEqual(im.fields, [0, 1]);
      assert.equal(im.lambda, 0.6328);
      near(im.rows[0].ap, rows[0].ap, 1e-12);
      near(im.rows[0].R, rows[0].R ?? 0, 1e-9);
      sameGeometry(O.build(im.rows), O.build(rows), 1e-9, 'round trip');
    }
  });

  test('coordinate breaks by OpticStudio’s rules: order 1 (tilt z, y, x then decenter), a 180° twist about z, a fold, units in inches, catalogue glass', () => {
    const t = zmx(
      ['UNIT IN X W X CM MR CPMM', 'ENPD 1', 'FTYP 0 0 2 1 0 0 0', 'YFLN 0 1', 'WAVM 1 0.6328 1', 'PWAV 1'],
      [
        ['DISZ INFINITY'],
        ['STOP', 'DISZ 4'],
        ['TYPE COORDBRK', 'PARM 3 -45', 'PARM 5 180', 'PARM 6 1', 'DISZ 0'],
        ['GLAS MIRROR 0 0', 'DISZ 0'],
        ['TYPE COORDBRK', 'PARM 3 -45', 'DISZ -2'],
        ['TYPE EVENASPH', 'CURV 0.1', 'PARM 2 1e-5', 'GLAS N-BK7 0 0', 'DISZ -0.2'],
        ['DISZ -3'],
        ['TYPE STANDARD'],
      ],
    );
    const im = O.fromZemax(t);
    const S = O.build(im.rows);
    near(im.rows[0].ap, 12.7, 1e-12, 'ENPD in inches');
    assert.equal(im.lambda, 0.6328);
    assert.deepEqual(im.warnings, ['higher-order terms of EVENASPH surfaces ignored']);
    near(O.angle(S[0].uOut), 90, 1e-9, 'the twisted fold turns the beam toward +y');
    [
      [0, 101.6],
      [50.8, 101.6],
      [55.88, 101.6],
      [132.08, 101.6],
    ].forEach(([y, z], i) => near(Math.hypot(S[i].V[1] - y, S[i].V[2] - z), 0, 1e-9, `S${i + 1}`));
    near(
      im.rows[2].R,
      -254,
      1e-9,
      'CURV 0.1/in with light travelling −z: centre of curvature toward the incoming light',
    );
    near(im.rows[2].n, 1.5168, 0);
    assert.equal(
      O.decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(t, 'utf16le')])),
      t,
      'UTF-16 files (OpticStudio default)',
    );
  });

  test('a stop behind a lens: the pupil goes to the entrance pupil (the stop’s image), where chief rays aim through the stop centre', () => {
    const im = O.fromZemax(
      zmx(
        ['ENPD 10', 'FTYP 0 0 1', 'YFLN 0'],
        [
          ['DISZ INFINITY'],
          ['CURV 0.02', 'GLAS N-BK7 0 0 1.5168 64.17', 'DISZ 3'],
          ['DISZ 20'],
          ['STOP', 'DISZ 60'],
          [],
        ],
      ),
    );
    const n = 1.5168;
    const f = 50 / (n - 1);
    const s = 20 + 3 / n;
    const ep = 1 / (1 / s - 1 / f); // thin-lens paraxial estimate: virtual, behind the lens
    near(-im.rows[0].t, ep, 0.2, 'entrance pupil behind the lens');
    const S = O.build(im.rows);
    for (const θ of [0.05, 0.5])
      near(O.trace(S, 0, 0, θ)[2].loc[1], 0, 1e-5 * θ * 100, `chief ray ${θ}° through the stop centre`);
  });

  test('finite object: a source at the object point, object-height fields and the NA aperture; the stop in object space is the pupil', () => {
    const im = O.fromZemax(
      zmx(
        ['OBNA 0.1', 'FTYP 1 0 2', 'YFLN 0 0.5'],
        [
          ['DISZ 50'],
          ['STOP', 'DISZ 10'],
          ['CURV 0.03', 'GLAS ___BLANK 1 0 1.6 40', 'DISZ 5'],
          ['CURV -0.03', 'DISZ 40'],
          [],
        ],
      ),
    );
    near(im.rows[0].R, -50, 1e-9);
    near(im.rows[0].t, 10, 1e-9);
    near(im.rows[0].ap, 50 * Math.tan(Math.asin(0.1)), 1e-9);
    assert.deepEqual(im.fields, [0, 0.5]);
    assert.equal(im.rows.length, 4, 'pupil, two lens surfaces, image');
    near(im.rows[1].n, 1.6, 0);
  });

  test('plane: a system folded in x–z (tilts about y, decenters in x, x fields) imports like its y–z twin with plane xz, and warns in yz', () => {
    const toXZ = txt =>
      txt
        .split('SURF ')
        .map(block =>
          !/TYPE COORDBRK/.test(block)
            ? block
            : block.replace(
                /PARM ([1-4]) (\S+)/g,
                (m, k, v) => `PARM ${{ 1: 2, 2: 1, 3: 4, 4: 3 }[k]} ${k === '3' ? -v : k === '4' ? 0 : v}`,
              ),
        )
        .join('SURF ')
        .replace(/^XFLN (.*)$/m, 'XFLN_')
        .replace(/^YFLN (.*)$/m, 'XFLN $1')
        .replace('XFLN_', 'YFLN 0 0'); // y fields become x fields
    const systems = [
      [
        { t: 100, ap: 10 },
        mirror({ tilt: 45, t: 50 }),
        surf({ R: 80, n: 1.6, t: 5, tilt: 3 }),
        surf({ R: -80, t: 90 }),
        surf(),
      ],
      [
        { t: 300, ap: 25 },
        mirror({ R: -1000, k: -1, d: 150, t: 511.25 }),
        surf({ t: 511.25 }),
        mirror({ R: -1000, k: -1, d: 150, tilt: -17.0604, t: 400 }),
        surf(),
      ],
    ];
    for (const rows of systems) {
      const yz = O.zemax(rows, { fields: [0, 1] });
      const xz = toXZ(yz);
      assert.notEqual(xz, yz);
      assert.match(xz, /PARM 4 -?[1-9]/, 'tilts about y');
      const im = O.fromZemax(xz, { plane: 'xz' });
      assert.equal(im.plane, 'xz');
      assert.deepEqual(im.warnings, []);
      assert.deepEqual(im.fields, [0, 1]);
      sameGeometry(O.build(im.rows), O.build(rows), 1e-9, 'x–z');
      const flat = O.fromZemax(xz); // the default, OpticStudio's y–z Cross-Section plane
      assert.equal(flat.plane, 'yz');
      assert.ok(
        flat.warnings.some(w => /out of the y–z plane/.test(w)) &&
          flat.warnings.some(w => /x fields ignored/.test(w)),
      );
      assert.ok(O.fromZemax(yz, { plane: 'xz' }).warnings.some(w => /out of the x–z plane/.test(w)));
    }
    assert.throws(() => O.fromZemax(O.zemax(systems[0]), { plane: 'xy' }), /choose yz or xz/);
  });

  test('best effort: several configurations, unknown glass, unsupported surfaces and out-of-plane geometry are imported with warnings', () => {
    const im = O.fromZemax(
      zmx(
        ['MNUM 3 1', 'ENPD 10', 'FTYP 0 0 1', 'YFLN 0'],
        [
          ['DISZ INFINITY'],
          ['STOP', 'DISZ 10'],
          ['TYPE COORDBRK', 'PARM 1 2', 'DISZ 0'],
          ['TYPE PARAXIAL', 'GLAS MYGLASS 0 0', 'DISZ 5'],
          ['DISZ 10'],
          [],
        ],
      ),
    );
    assert.equal(im.warnings.length, 4);
    assert.ok(
      im.warnings.some(w => /3 configurations/.test(w)) &&
        im.warnings.some(w => /MYGLASS/.test(w)) &&
        im.warnings.some(w => /PARAXIAL/.test(w)) &&
        im.warnings.some(w => /out of the y–z plane/.test(w)),
    );
    assert.throws(() => O.fromZemax('VERS 1\r\nMODE SEQ'), /no surfaces/);
  });
});

describe('Python exports (batoid, optiland)', () => {
  const read = txt =>
    [...txt.matchAll(/^    \("([^"]*)", "(\w+)", (\S+), (\S+), (\S+), (\S+), (\S+), (\S+), (\S+)\),$/gm)].map(
      m => ({ name: m[1], kind: m[2], v: m.slice(3).map(Number) }),
    );
  test('every surface is written at its absolute vertex and axis, with R = 1/c in its own frame, the conic and both indices', () => {
    const rows = [
      { t: 300, ap: 25 },
      mirror({ name: 'OAP 1', R: -1000, k: -1, d: 150, t: 511.25 }),
      surf({ t: 511.25 }),
      mirror({ R: -1000, k: -1, d: 150, tilt: -17.0604, t: 50 }),
      surf({ R: 80, n: 1.6, t: 5, tilt: 3 }),
      surf({ t: 90 }),
      surf(),
    ];
    const S = O.build(rows);
    for (const lib of ['batoid', 'optiland']) {
      const txt = O.toPython(rows, lib, { fields: [0, 0.5], lambda: 0.6328, name: 'relay' });
      const T = read(txt);
      assert.equal(T.length, S.length);
      assert.ok(
        txt.includes('A = 25') &&
          txt.includes('WAVELENGTH = 0.6328') &&
          txt.includes('FIELDS = [0, 0.5]') &&
          txt.includes('BEAM = 0'),
      );
      T.forEach((t, i) => {
        const s = S[i];
        const [y, z, rx, R, k, n1, n2] = t.v;
        const ez = [0, -Math.sin(rx), Math.cos(rx)]; // RotX(rx) turns +z into (0, −sin, cos)
        near(y, s.V[1], 1e-9);
        near(z, s.V[2], 1e-9);
        near(Math.hypot(...ez.map((v, j) => v - s.ez[j])), 0, 1e-12, `${lib} axis ${i}`);
        near(R, s.c ? 1 / s.c : 0, 1e-9);
        assert.equal(k, s.k);
        assert.equal(n1, s.nIn);
        assert.equal(n2, s.nOut);
        assert.equal(t.kind, s.mirror ? 'mirror' : i === S.length - 1 ? 'image' : 'refract');
      });
      assert.equal(T[0].name, 'OAP 1');
      assert.equal(T[1].name, 'S2');
    }
    assert.match(O.toPython(rows, 'batoid'), /batoid\.CompoundOptic/);
    assert.match(O.toPython(rows, 'optiland'), /op\.surfaces\.add\(index=0, z=BEAM if BEAM else -np\.inf\)/);
    assert.match(
      O.toPython([{ t: 10, ap: 5, R: -90 }, surf({ t: 6, n: 1.5 }), surf()], 'optiland'),
      /BEAM = -90/,
    );
  });
});

describe('images of planes (conjugates)', () => {
  test('mirror equation: a pupil 3f before a concave paraboloid images 1.5f in front of it, inverted at m = −1/2', () => {
    const [c] = O.conjugates(
      O.build([{ t: 3000, ap: 50 }, mirror({ R: -2000, k: -1, t: 2000 }), surf()]),
      -1,
      50,
    );
    assert.equal(c.j, 1);
    assert.equal(c.virtual, false);
    near(c.s, 1500, 1e-5);
    near(c.m, -0.5, 1e-7);
  });
  test('a pupil at a sphere’s centre of curvature is imaged back onto itself, inverted (m = −1)', () => {
    const cs = O.conjugates(O.build([{ t: 200, ap: 5 }, mirror({ R: -200, t: 300 }), surf()]), -1, 5);
    assert.equal(cs.length, 1);
    near(cs[0].s, 200, 1e-6);
    near(cs[0].m, -1, 1e-9);
  });
  test('thick singlet: image distance and magnification match a paraxial ABCD calculation', () => {
    const n = 1.5168;
    const R1 = 50;
    const R2 = -50;
    const tc = 4;
    const d = 100;
    const rows = [{ t: d, ap: 5 }, surf({ R: R1, n, t: tc }), surf({ R: R2, t: 300 }), surf()];
    const mul = (A, B) => [
      [A[0][0] * B[0][0] + A[0][1] * B[1][0], A[0][0] * B[0][1] + A[0][1] * B[1][1]],
      [A[1][0] * B[0][0] + A[1][1] * B[1][0], A[1][0] * B[0][1] + A[1][1] * B[1][1]],
    ];
    let M = [
      [1, d],
      [0, 1],
    ];
    M = mul(
      [
        [1, 0],
        [-(n - 1) / R1, 1],
      ],
      M,
    );
    M = mul(
      [
        [1, tc / n],
        [0, 1],
      ],
      M,
    );
    M = mul(
      [
        [1, 0],
        [-(1 - n) / R2, 1],
      ],
      M,
    ); // (y, n·u)
    const x = -M[0][1] / M[1][1];
    const m = M[0][0] + x * M[1][0]; // B(x) = 0 after the lens
    const [c] = O.conjugates(O.build(rows), -1, 5);
    assert.equal(c.j, 2);
    near(c.s, x, 1e-5);
    near(c.m, m, 1e-7);
  });
  test('OAP 4f relay: the pupil, d before OAP 1, lands 2f − d after OAP 2 at m = −1; the intermediate focus plane images to infinity', () => {
    const rows = [
      { t: 300, ap: 25 },
      mirror({ R: -1000, k: -1, d: 150, t: 511.25 }),
      surf({ t: 511.25 }),
      mirror({ R: -1000, k: -1, d: 150, tilt: -17.0604, t: 400 }),
      surf(),
    ];
    const S = O.build(rows);
    const [c] = O.conjugates(S, -1, 25);
    assert.equal(c.j, 4);
    near(400 + c.s, 2 * 511.25 - 300, 1e-2);
    near(c.m, -1, 1e-4);
    assert.deepEqual(O.conjugates(S, 1, 25), []);
  });
  test('object-space image of a buried stop = the entrance pupil the Zemax importer finds by chief-ray aiming (a different method)', () => {
    const zmx = [
      'ENPD 10',
      'FTYP 0 0 1',
      'YFLN 0',
      'SURF 0',
      '  DISZ INFINITY',
      'SURF 1',
      '  CURV 0.02',
      '  GLAS N-BK7 0 0 1.5168 64.17',
      '  DISZ 3',
      'SURF 2',
      '  DISZ 20',
      'SURF 3',
      '  STOP',
      '  DISZ 60',
      'SURF 4',
    ].join('\r\n');
    const im = O.fromZemax(zmx);
    const rows = [
      { t: 0, ap: 5 },
      surf({ R: 50, n: 1.5168, t: 3 }),
      surf({ t: 20 }),
      surf({ t: 60 }),
      surf(),
    ];
    const [c] = O.conjugates(O.build(rows), 2, 5);
    assert.equal(c.j, 0);
    assert.equal(c.virtual, true);
    near(c.s, -im.rows[0].t, 1e-3);
  });
  test('a classical Cassegrain’s exit pupil is virtual, in image space before the focal plane; no duplicates through plain planes', () => {
    const cs = O.conjugates(O.build(cassegrain()), -1, 100);
    assert.equal(cs.length, 1);
    assert.equal(cs[0].j, 3);
    assert.equal(cs[0].virtual, true);
    assert.ok(cs[0].s < -1000);
    assert.equal(
      O.conjugates(O.build([{ t: 3000, ap: 50 }, mirror({ R: -2000, k: -1, t: 2000 }), surf()]), -1, 50)
        .length,
      1,
    );
  });
});

describe('conics used at and past 90° (normal ⊥ the parent axis)', () => {
  // An ellipse a = 300, c = 200 (b = 223.6, R = b²/a, k = −c²/a²), used at the point of eccentric angle φ: light from one
  // focus (a source 10 mm before the pupil) must reach the other exactly, wherever on the parent the segment sits.
  const a = 300;
  const c = 200;
  const b = Math.sqrt(a * a - c * c);
  const R = (b * b) / a;
  const k = -(c * c) / (a * a);
  function ellipseAt(phi, back, mode) {
    // back: light from the far focus
    const Q = [a * Math.cos(phi), b * Math.sin(phi)];
    const F1 = back ? [c, 0] : [-c, 0];
    const F2 = back ? [-c, 0] : [c, 0];
    const L1 = Math.hypot(Q[0] - F1[0], Q[1] - F1[1]);
    const L2 = Math.hypot(Q[0] - F2[0], Q[1] - F2[1]);
    const g = -Math.atan2(Q[1] - F1[1], Q[0] - F1[0]);
    const w = p => {
      const x = p[0] - F1[0];
      const y = p[1] - F1[1];
      return [0, Math.sin(g) * x + Math.cos(g) * y, Math.cos(g) * x - Math.sin(g) * y - 10];
    };
    const V = w([-a, 0]);
    const C = w([0, 0]);
    const m = Math.hypot(C[1] - V[1], C[2] - V[2]);
    const ez = [0, (C[1] - V[1]) / m, (C[2] - V[2]) / m];
    const ey = [0, ez[2], -ez[1]];
    const P = w(Q);
    const y = (P[1] - V[1]) * ey[1] + (P[2] - V[2]) * ey[2];
    const z = (P[1] - V[1]) * ez[1] + (P[2] - V[2]) * ez[2];
    return {
      P,
      F2: w(F2),
      rows: [
        { t: L1 - 10, ap: 3, R: -10 },
        mirror({
          R,
          k,
          tilt: (Math.atan2(ez[1], ez[2]) * 180) / Math.PI,
          t: L2,
          ...(mode === 'angle' ? { oa: 'angle', d: O.angleAt(1 / R, k, y, z) } : { d: y }),
        }),
        surf(),
      ],
    };
  }
  const worst = ({ rows, P, F2 }) => {
    const S = O.build(rows);
    near(Math.hypot(...S[0].P.map((v, i) => v - P[i])), 0, 1e-9, 'axis hit');
    return Math.max(
      ...O.grid(3, 7).map(([x, y]) => {
        const r = O.trace(S, x, y, 0)[1];
        return r ? Math.hypot(...r.p.map((v, i) => v - F2[i])) : Infinity;
      }),
    );
  };

  test('normal angle ↔ point: atAngle and angleAt invert each other; 90° is the equator (z = the centre, y = b); a paraboloid has no point past 90°', () => {
    for (const th of [-170, -120, -90, -45, 0, 30, 89, 90, 91, 135, 179]) {
      const [y, z] = O.atAngle(1 / R, k, th);
      near(O.angleAt(1 / R, k, y, z), th, 1e-9, `θ ${th}`);
      near(
        O.sag(1 / R, k, y * y) === O.sag(1 / R, k, y * y) && Math.abs(th) < 90 ? O.sag(1 / R, k, y * y) : z,
        z,
        1e-9,
      );
    }
    const [y, z] = O.atAngle(1 / R, k, 90);
    near(y, b, 1e-9);
    near(z, a, 1e-9);
    near(O.atAngle(-1 / R, k, 90)[1], -a, 1e-9, 'R < 0 mirrors z');
    assert.ok(O.atAngle(1 / R, -1, 95).every(Number.isNaN));
    assert.ok(O.atAngle(1 / R, -1.5, 80).every(Number.isNaN), 'past a hyperboloid’s asymptote');
  });

  test('by normal angle, a segment anywhere on an ellipsoid (vertex → equator → far vertex), lit from either focus, images one focus on the other: tilts run through ±90° and beyond', () => {
    for (const back of [false, true])
      for (let deg = 5; deg <= 175; deg += 10)
        near(
          worst(ellipseAt((deg * Math.PI) / 180, back, 'angle')),
          0,
          1e-8,
          `φ ${deg}${back ? ' from F2' : ''}`,
        );
  });

  test('by height, every segment on the near half works at any tilt (the line meets the parent twice: the meeting nearer the segment counts)', () => {
    for (const back of [false, true])
      for (let deg = 95; deg <= 175; deg += 10)
        near(
          worst(ellipseAt((deg * Math.PI) / 180, back, 'height')),
          0,
          1e-8,
          `φ ${deg}${back ? ' from F2' : ''}`,
        );
  });

  test('switching between height and normal angle keeps the geometry; past the equator there is no height, and a flat has no angle', () => {
    const { rows } = ellipseAt(2.2, false, 'height');
    const before = O.build(rows)[0];
    assert.ok(O.offAxisAs(rows, 1, 'angle'));
    assert.equal(rows[1].oa, 'angle');
    const mid = O.build(rows)[0];
    near(Math.hypot(...mid.V.map((v, i) => v - before.V[i])), 0, 1e-9);
    near(mid.d, before.d, 1e-9, 'built d is the height either way');
    assert.ok(O.offAxisAs(rows, 1, 'height'));
    assert.equal(rows[1].oa, undefined);
    near(Math.hypot(...O.build(rows)[0].V.map((v, i) => v - before.V[i])), 0, 1e-9);
    const far = ellipseAt(0.7, false, 'angle').rows;
    assert.ok(Math.abs(far[1].d) > 90);
    assert.equal(O.offAxisAs(far, 1, 'height'), false);
    assert.equal(far[1].oa, 'angle');
    assert.equal(O.offAxisAs([{}, mirror({ R: 0 })], 1, 'angle'), false);
  });

  test('focus locks solve straight through the equator: F1 on the source and F2 on the focal plane, varying R, k, the angle and tilt, as the focal plane moves out', () => {
    const rows = [
      { t: 250, ap: 5, R: -50 },
      mirror({
        R: 150,
        k: -0.5,
        oa: 'angle',
        d: -90,
        tilt: 45,
        t: 300,
        lock: { f1: { at: 'src' }, f2: { at: 2 }, vary: ['R', 'k', 'd', 'tilt'] },
      }),
      surf(),
    ];
    assert.equal(O.applySolves(rows).size, 0);
    near(rows[1].d, -90, 1e-9, 'symmetric: the equator');
    // the pin on the focal plane (downstream: a loop) is held as a point, and the focal plane focuses on it; moving the
    // focal plane out is moving that point out along the axis (as dragging the plane does)
    const L = rows[1].lock.f2;
    assert.equal(L.at, 'pt');
    assert.deepEqual(rows[1].solve, { t: { type: 'focus' } });
    const S0 = O.build(rows);
    const seen = [];
    for (const t of [150, 200, 250, 350, 450, 300]) {
      const q = S0[0].P.map((v, i) => v + t * S0[0].uOut[i]);
      L.p = [q[1], q[2]];
      assert.equal(O.applySolves(rows).size, 0, `t ${t}`);
      near(rows[1].t, t, 1e-6, `t ${t}: the focal plane on the image`);
      seen.push(rows[1].d);
      const S = O.build(rows);
      for (const [x, y] of O.grid(5, 5))
        near(Math.hypot(...O.trace(S, x, y, 0)[1].p.map((v, i) => v - S[1].P[i])), 0, 1e-7, `t ${t} spot`);
    }
    assert.ok(seen[0] < -90 && seen[4] > -90, `the angle crosses 90°: ${seen}`);
    near(seen[5], -90, 1e-6, 'and comes back to it');
  });

  test('dragging a segment given by angle moves its parent rigidly by the pointer’s displacement', () => {
    const rows = [
      { t: 250, ap: 5, R: -50 },
      mirror({ R: 150, k: -0.5, oa: 'angle', d: -90, tilt: 45, t: 300 }),
      surf(),
    ];
    const V0 = O.build(rows)[0].V;
    const S = O.build(O.moveOptic(rows, 0, [0, 12, 262]));
    near(Math.hypot(S[0].V[0] - V0[0], S[0].V[1] - V0[1] - 12, S[0].V[2] - V0[2] - 12), 0, 1e-9);
  });

  test('drawing: the profile runs across the equator, the blank backs onto the tangent plane, the parent can be the whole ellipse; exports flag the equator', () => {
    const rows = [
      { t: 250, ap: 5, R: -50 },
      mirror({ R: 150, k: -0.5, oa: 'angle', d: -90, tilt: 45, t: 300 }),
      surf(),
    ];
    const s = O.build(rows)[0];
    const pr = O.profile(s, -40, 40, 21);
    assert.ok(pr.every(p => p.every(isFinite)));
    for (const p of pr) {
      const q = p.map((v, i) => v - s.V[i]);
      const y = q[1] * s.ey[1] + q[2] * s.ey[2];
      const z = q[1] * s.ez[1] + q[2] * s.ez[2];
      near(s.c * (y * y + (1 + s.k) * z * z) - 2 * z, 0, 1e-9, 'on the conic');
    }
    assert.ok(
      pr.some(
        p =>
          O.angleAt(
            s.c,
            s.k,
            ...[1, 2].map(i => {
              const q = p.map((v, j) => v - s.V[j]);
              return i === 1 ? q[1] * s.ey[1] + q[2] * s.ey[2] : q[1] * s.ez[1] + q[2] * s.ez[2];
            }),
          ) < -90,
      ),
      'both sides of it',
    );
    const bl = O.blank(s, -40, 40, 8);
    assert.ok(bl.every(p => p.every(isFinite)));
    const par = O.parent(s, -200, 200, 90);
    assert.ok(par.length > 80);
    const S = O.build(rows);
    assert.deepEqual(
      O.pastEquator(
        S,
        O.grid(5, 5).map(([x, y]) => O.trace(S, x, y, 0)),
      ),
      [0],
    );
    const oap = [{ t: 300, ap: 25 }, mirror({ R: -1000, k: -1, d: 150, t: 511.25 }), surf()];
    const So = O.build(oap);
    assert.deepEqual(
      O.pastEquator(
        So,
        O.grid(25, 5).map(([x, y]) => O.trace(So, x, y, 0)),
      ),
      [],
    );
  });
});

describe('stigmatic conjugates: focus pins to the incoming focus, a free point, infinity', () => {
  // Distance from point Q to the line of each ray leaving surface j (−1 when lost): 0 when the bundle passes through Q (or
  // seems to, extended backwards: a virtual image).
  const setPt = (r, p) => {
    const L = r.lock;
    (L.f2?.at === 'pt' ? L.f2 : L.f1).p = p;
  }; // the point pin (the pins swap on a hyperboloid's far branch)
  const through = (rows, j, Q, a = rows[0].ap) => {
    const S = O.build(rows);
    return Math.max(
      ...O.grid(a, 7).map(([x, y]) => {
        const r = O.trace(S, x, y, 0)[j];
        if (!r) return Infinity;
        const q = Q.map((v, k) => v - r.p[k]);
        const t = q[0] * r.u[0] + q[1] * r.u[1] + q[2] * r.u[2];
        return Math.hypot(...q.map((v, k) => v - t * r.u[k]));
      }),
    );
  };

  test('inFocus: a paraboloid’s focus after it, the source before the first surface, the plane itself on a focal plane, null when collimated', () => {
    const rows = [{ t: 500, ap: 25 }, mirror({ R: -1000, k: -1, t: 500 }), surf({ t: 300 }), surf()];
    const S = O.build(rows);
    assert.equal(O.inFocus(S, 0), null);
    near(Math.hypot(...O.inFocus(S, 1).map((v, k) => v - [0, 0, 0][k])), 0, 1e-7, 'focus at the pupil');
    near(Math.hypot(...O.inFocus(S, 2).map((v, k) => v - S[1].P[k])), 0, 1e-7, 'on the focal plane');
    const div = [{ t: 50, ap: 5, R: -100 }, surf()];
    near(O.inFocus(O.build(div), 0)[2], -100, 1e-12);
  });

  test('a paraboloid facing a collimated beam, its focus on a dragged point (vary R and off-axis): it focuses there exactly, wherever the point goes', () => {
    const rows = [
      { t: 400, ap: 20 },
      mirror({
        R: -600,
        k: -1,
        t: 100,
        lock: { f1: { at: 'pt', p: [0, 100] }, f2: { at: 'inf' }, vary: ['R', 'd'] },
      }),
      surf(),
    ];
    for (const p of [
      [0, 100],
      [-80, 60],
      [-250, 150],
      [-400, 330],
      [90, 40],
    ]) {
      rows[1].lock.f1.p = p;
      assert.equal(O.applySolves(rows).size, 0, `point ${p}`);
      near(rows[1].k, -1, 0);
      near(rows[1].tilt, 0, 0);
      near(through(rows, 0, [0, ...p]), 0, 1e-8, `focus on ${p}`);
    }
  });

  test('two points (F1 on the incoming focus, F2 dragged; vary R, k, off-axis, tilt): from a sphere about the focus to ellipsoids on either half and hyperboloids, imaging one point on the other', () => {
    const rows = [
      { t: 200, ap: 8, R: -100 },
      mirror({
        R: -300,
        k: 0,
        t: 100,
        lock: { f1: { at: 'in' }, f2: { at: 'pt', p: [0, -100] }, vary: ['R', 'k', 'd', 'tilt'] },
      }),
      surf(),
    ];
    assert.equal(O.applySolves(rows).size, 0, 'the sphere about the source: F2 = F1');
    const P = O.build(rows)[0].P;
    let path = [
      [30, -80],
      [120, 0],
      [200, 150],
      [150, 240],
      [60, 280],
      [-80, 250],
      [-200, 230],
    ]; // round the mirror, nearer it than the source
    const seen = [];
    for (const p of path) {
      setPt(rows[1], p);
      assert.equal(O.applySolves(rows).size, 0, `F2 at ${p}`);
      near(through(rows, 0, [0, ...p]), 0, 1e-7, `image at ${p}`);
      seen.push([rows[1].d, rows[1].k]);
    }
    assert.equal(rows[1].oa, 'angle');
    assert.ok(
      seen.some(([d, k]) => Math.abs(d) > 90 && k > -1),
      `an ellipsoid past its equator on the way: ${seen}`,
    );
    assert.ok(rows[1].k < -1, 'and a hyperboloid once the image can only be virtual (behind the mirror)');
    near(P[2], O.build(rows)[0].P[2], 1e-9, 'the mirror stays put');
  });

  test('a virtual image (a convex mirror): a hyperboloid, the pins swapping when the image is the nearer focus', () => {
    const rows = [
      { t: 200, ap: 8, R: -100 },
      mirror({
        R: 200,
        k: 0,
        t: 100,
        lock: { f1: { at: 'in' }, f2: { at: 'pt', p: [0, 400] }, vary: ['R', 'k', 'd', 'tilt'] },
      }),
      surf(),
    ];
    rows[1].lock.f2.p = [0, 400];
    O.applySolves(rows); // start: a convex sphere, its virtual image behind it
    for (const p of [
      [10, 360],
      [40, 330],
      [0, 340],
    ]) {
      setPt(rows[1], p);
      assert.equal(O.applySolves(rows).size, 0, `virtual image at ${p}`);
      near(through(rows, 0, [0, ...p]), 0, 1e-7, `seems to diverge from ${p}`);
      assert.ok(rows[1].k < -1, 'a hyperboloid');
    }
    assert.equal(rows[1].lock.f1.at, 'pt', 'swapped: F1 (nearer the vertex) is now the image');
    assert.equal(rows[1].lock.f2.at, 'in');
  });

  test('chained: the second mirror’s F1 follows the first one’s dragged image, and both stay stigmatic; settled solves aren’t reported as fighting', () => {
    const rows = [
      { t: 400, ap: 20 },
      mirror({
        R: -600,
        k: -1,
        t: 450,
        lock: { f1: { at: 'pt', p: [0, 100] }, f2: { at: 'inf' }, vary: ['R', 'd'] },
      }),
      mirror({
        R: -150,
        k: 0,
        t: 200,
        lock: { f1: { at: 'in' }, f2: { at: 'pt', p: [0, 100] }, vary: ['R', 'k', 'd', 'tilt'] },
      }),
      surf(),
    ];
    O.applySolves(rows);
    rows[2].lock.f2.p = [-60, 160];
    assert.equal(O.applySolves(rows).size, 0);
    for (const p of [
      [-20, 110],
      [-60, 90],
      [-90, 130],
    ]) {
      rows[1].lock.f1.p = p;
      const f = O.applySolves(rows);
      assert.equal(f.size, 0, `first image at ${p}: ${[...f]}`);
      near(through(rows, 0, [0, ...p]), 0, 1e-7);
      near(through(rows, 1, [0, -60, 160]), 0, 1e-6, 'second image stays put');
    }
  });
});

describe('stigmatic check (the Stigmatic guard)', () => {
  test('perfect imaging is recognised from geometry alone; spoiling it is caught', () => {
    const cass = [
      { t: 500, ap: 100 },
      mirror({ R: -2000, k: -1, t: 750 }),
      mirror({ R: 666.667, k: -2.77778, t: 1000, solve: { t: { type: 'focus' } } }),
      surf(),
    ];
    O.applySolves(cass);
    let S = O.build(cass);
    assert.deepEqual(
      S.map((_, i) => O.stigmatic(S, i)),
      [true, true, null],
    );
    cass[1].k = -0.95;
    S = O.build(cass);
    assert.equal(O.stigmatic(S, 0), false, 'not a paraboloid in a collimated beam');
    cass[1].k = -1;
    cass[1].tilt = 1;
    S = O.build(cass);
    assert.equal(O.stigmatic(S, 0), false, 'a paraboloid tilted to the beam');
    const relay = [
      { t: 300, ap: 25 },
      mirror({ R: -1000, k: -1, d: 150, t: 511.25 }),
      surf({ t: 511.25 }),
      mirror({ R: -1000, k: -1, d: 150, tilt: -17.06, t: 400, solve: { tilt: { type: 'collim' } } }),
      surf(),
    ];
    O.applySolves(relay);
    S = O.build(relay);
    assert.deepEqual(
      S.map((_, i) => O.stigmatic(S, i)),
      [true, null, true, null],
      'the recollimating OAP: F1 on the intermediate focus',
    );
    relay[3].R = -1100;
    S = O.build(relay);
    assert.equal(O.stigmatic(S, 2), false);
  });
});
