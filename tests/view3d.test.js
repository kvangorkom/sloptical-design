// 3D views: surfaces off the meridian (rims, slices), the camera (project, unproject, orbit, animating between views) and
// beam outlines seen from any direction. The checks are written from first principles, not from optics.js. Run: node --test
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const O = require('../src/engine');
const View = require('../src/app/view3d.js');

const surf = o => ({ type: 'refract', R: 0, k: 0, d: 0, tilt: 0, t: 0, n: 1, ap: 0, ...o });
const mirror = o => surf({ type: 'mirror', ...o });
const near = (a, b, tol, msg = '') =>
  assert.ok(Math.abs(a - b) <= tol, `${msg} got ${a}, expected ${b} ± ${tol}`);
const close = (u, v, tol, msg = '') => near(Math.hypot(...u.map((x, k) => x - v[k])), 0, tol, msg);
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const sub = (a, b) => a.map((x, i) => x - b[i]);
const local = (s, p) => {
  const q = sub(p, s.V);
  const ex = s.ex ?? O.cross(s.ey, s.ez);
  return [dot(q, ex), dot(q, s.ey), dot(q, s.ez)];
};
const onConic = (s, [x, y, z]) => s.c * (x * x + y * y + (1 + s.k) * z * z) - 2 * z; // 0 on the parent conic
const ortho = c => {
  close([dot(c.r, c.r), dot(c.u, c.u), dot(c.r, c.u)], [1, 1, 0], 1e-12, 'orthonormal');
};
const r = d => (d * Math.PI) / 180;

const SYS = {
  oap: [{ t: 300, ap: 25 }, mirror({ R: -1000, k: -1, d: 150, t: 500 }), surf()],
  rolled: [
    { t: 300, ap: 25 },
    mirror({ R: -1000, k: -1, d: 150, tilt: 10, tiltY: 20, clock: 35, t: 500 }),
    surf(),
  ],
  equator: [
    { t: 250, ap: 20, R: -50 },
    mirror({ R: 150, k: -0.5, oa: 'angle', d: 80, tilt: 45, t: 300 }),
    surf(),
  ],
  lens: [{ t: 20, ap: 10 }, surf({ R: 100, t: 5, n: 1.5 }), surf({ R: -100, t: 95 }), surf()],
};

describe('surfaces off the meridian', () => {
  test('surfPoint: on the meridian it is segPoint; across it, still on the parent conic', () => {
    for (const [name, rows] of Object.entries(SYS))
      for (const s of O.build(rows).filter(s => s.c)) {
        for (const v of [-7, 0, 3.5]) {
          assert.deepEqual(O.surfPoint(s, v, 0), O.segPoint(s, v), `${name} v=${v}`);
          for (const x of [-6, 2.5]) {
            const q = O.surfPoint(s, v, x);
            near(q[0], x, 1e-12, 'x');
            near(onConic(s, q), 0, 1e-12, `${name} on the conic`);
          }
        }
      }
  });
  test('rim: a circle of the given radius about the middle of the span, on the surface, in its own frame', () => {
    for (const [name, rows] of Object.entries(SYS)) {
      const s = O.build(rows)[0];
      const P = O.rim(s, -4, 8, 36);
      assert.equal(P.length, 36);
      const mid = O.surfPoint(s, 2, 0); // the circle's centre on the surface (local)
      for (const p of P) {
        const q = local(s, p);
        near(onConic(s, q), 0, 1e-9, `${name} on the conic`);
        if (!s.seg) near(Math.hypot(q[0], q[1] - mid[1]), 6, 1e-9, `${name} radius`);
      }
      near(Math.max(...P.map(p => Math.abs(local(s, p)[0]))), 6, 1e-9, `${name} reaches ±6 across`);
    }
  });
  test('slice: along the meridian it is the profile; across it, x varies and the segment centre stays put', () => {
    for (const [name, rows] of Object.entries(SYS)) {
      const s = O.build(rows)[0];
      const A = O.slice(s, -5, 5, [0, 1], 11);
      const B = O.profile(s, -5, 5, 11);
      A.forEach((p, i) => close(p, B[i], 1e-9, `${name} meridian ${i}`));
      const X = O.slice(s, -5, 5, [1, 0], 11).map(p => local(s, p));
      X.forEach((q, i) => {
        near(q[0], -5 + i, 1e-9, `${name} x`);
        near(onConic(s, q), 0, 1e-9);
      });
      close(X[5], O.surfPoint(s, 0, 0), 1e-9, 'centre');
    }
  });

  test('blankSolid: its section along the meridian is the planar blank (its face, and its back unless the face rises off the meridian); the back is flat, th behind the face, under the whole rim', () => {
    for (const [name, rows] of Object.entries(SYS)) {
      const s = O.build(rows)[0];
      const th = 2;
      const B = O.blankSolid(s, -4, 8, th, [0, 1], 48);
      const P = O.blank(s, -4, 8, th);
      if (!s.mirror && !s.c) continue;
      assert.equal(B.section.length, P.length);
      B.section.forEach((p, i) => (i < 48 || !s.seg) && close(p, P[i], 1e-9, `${name} section ${i}`)); // (a segment's back sits behind its whole face: at or past the planar one)
      assert.equal(B.back.length, B.front.length);
      const n = s.seg ? s.nb : [0, 0, 1];
      const h = p => dot(local(s, p), n);
      const hb = h(B.back[0]);
      B.back.forEach(p => near(h(p), hb, 1e-9, `${name}: one flat back`));
      B.front.forEach(p => assert.ok(h(p) <= hb - th + 1e-9, `${name}: the face is in front of the back`));
      near(Math.max(...B.front.map(h)), hb - th, 1e-9, `${name}: th behind the highest point of the face`);
      const X = O.blankSolid(s, -4, 8, th, [1, 0], 48).section;
      X.slice(-2).forEach(p => near(h(p), hb, 1e-9, `${name}: any section shares the back`));
    }
  });
});

describe('the camera', () => {
  const V = { s: 2.5, ox: 300, oy: 200, c: [5, -3, 120], D: 900 };
  test('side view, orthographic: exactly the planar layout’s mapping (z right, y up)', () => {
    const c = View.VIEWS.side;
    for (const p of [
      [0, 10, 50],
      [7, -3, 200],
      [-2, 0, -40],
    ])
      assert.deepEqual(View.project(c, V, p), [V.ox + p[2] * V.s, V.oy - p[1] * V.s]);
  });
  test('named views are right-handed screen frames looking along the right axes', () => {
    for (const c of Object.values(View.VIEWS)) ortho(c);
    close(View.camBack(View.VIEWS.side), [-1, 0, 0], 0);
    close(View.camBack(View.VIEWS.top), [0, 1, 0], 0);
    close(View.camBack(View.VIEWS.front), [0, 0, -1], 0);
    for (const [a, b] of [
      ['side', 'other'],
      ['top', 'bottom'],
      ['front', 'back'],
    ]) {
      // each from the opposite side: the same plane, mirrored
      close(
        View.camBack(View.VIEWS[b]),
        View.camBack(View.VIEWS[a]).map(v => -v),
        0,
        `${b} looks the other way`,
      );
      near(Math.abs(dot(View.VIEWS[a].u, View.VIEWS[b].u)), 1, 0);
    }
  });
  test('unproject inverts project on the plane through the reference point (orthographic and perspective)', () => {
    for (const cam of [
      View.VIEWS.top,
      View.orbit(View.VIEWS.side, 30, 20),
      { ...View.orbit(View.VIEWS.side, -50, 35), persp: true },
    ]) {
      const ref = [3, 4, 80];
      for (const sxy of [
        [10, 20],
        [400, 333],
      ]) {
        const p = View.unproject(cam, V, sxy, ref);
        close(View.project(cam, V, p), sxy, 1e-9, 'round trip');
        near(dot(sub(p, ref), View.camBack(cam)), 0, 1e-9, 'on the plane');
      }
      const p = [9, -2, 60];
      close(View.unproject(cam, V, View.project(cam, V, p), p), p, 1e-9, 'a point back onto itself');
    }
  });
  test('perspective: the pivot’s depth draws as orthographic; nearer is larger', () => {
    const o = View.orbit(View.VIEWS.side, 25, 15);
    const p = { ...o, persp: true };
    const b = View.camBack(o);
    const e = [o.r, o.u].map(v => v.map(x => 10 * x));
    const at = d => V.c.map((v, k) => v + d * b[k]);
    const w = d =>
      Math.hypot(
        ...sub(
          View.project(
            p,
            V,
            e[0].map((x, k) => x + at(d)[k]),
          ),
          View.project(p, V, at(d)),
        ),
      );
    close(View.project(p, V, V.c), View.project(o, V, V.c), 1e-9);
    near(w(0), 10 * V.s, 1e-9, 'at the pivot');
    assert.ok(w(200) > w(0) && w(0) > w(-200), 'toward the eye grows');
    near(w(200), (10 * V.s * V.D) / (V.D - 200), 1e-9);
    assert.ok(View.project(p, V, at(5000)).every(isFinite), 'behind the eye stays finite');
  });
  test('orbit: a turntable about the world’s up; it stops looking straight down or up', () => {
    const s = View.VIEWS.side;
    for (const [y, p] of [
      [30, 0],
      [0, 40],
      [-75, -20],
      [200, 10],
    ])
      ortho(View.orbit(s, y, p));
    const top = View.orbit(s, 0, 90);
    close(top.r, View.VIEWS.top.r, 1e-12);
    close(top.u, View.VIEWS.top.u, 1e-12);
    const over = View.orbit(s, 0, 130);
    close(View.camBack(over), [0, 1, 0], 1e-12, 'clamped at straight down');
    const back = View.orbit(over, 0, -90);
    close(View.camBack(back), View.camBack(s), 1e-12, 'and back');
    const front = View.orbit(s, -90, 0);
    close(front.r, View.VIEWS.front.r, 1e-12);
    close(front.u, View.VIEWS.front.u, 1e-12);
    const round = [0, 1, 2, 3].reduce(c => View.orbit(c, 90, 0), s);
    close(round.r, s.r, 1e-12);
    close(round.u, s.u, 1e-12);
    near(dot(View.orbit(s, 33, 0).u, [0, 1, 0]), 1, 1e-12, 'yaw keeps the up');
    assert.equal(View.orbit({ ...s, persp: true, name: 'side' }, 5, 0).persp, true);
    assert.equal(View.orbit({ ...s, name: 'side' }, 5, 0).name, null);
  });
  test('lerpCam: from one view to the next about a single axis, a half turn included', () => {
    const s = View.VIEWS.side;
    const pairs = [
      [s, View.VIEWS.top],
      [s, View.VIEWS.front],
      [View.VIEWS.top, View.orbit(s, 40, -30)],
      [s, { r: [0, 0, -1], u: [0, 1, 0] }],
    ];
    for (const [a, b] of pairs) {
      const A = View.lerpCam(a, b, 0);
      const B = View.lerpCam(a, b, 1);
      close(A.r, a.r, 1e-12);
      close(A.u, a.u, 1e-12);
      close(B.r, b.r, 1e-9);
      close(B.u, b.u, 1e-9);
      for (const t of [0.25, 0.5, 0.75]) ortho(View.lerpCam(a, b, t));
    }
    const h = View.lerpCam(s, View.VIEWS.top, 0.5);
    const want = View.orbit(s, 0, 45);
    close(h.r, want.r, 1e-12);
    close(h.u, want.u, 1e-12);
  });
});

describe('outlines', () => {
  test('hull: the convex hull, wound positively, interior and collinear points dropped', () => {
    const P = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
      [2, 2],
      [1, 3],
      [2, 0],
      [4, 1],
    ];
    const H = View.hull(P);
    assert.equal(H.length, 4);
    for (const q of [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ])
      assert.ok(H.some(h => h[0] === q[0] && h[1] === q[1]));
    assert.ok(
      H.reduce((s, p, i) => {
        const q = H[(i + 1) % H.length];
        return s + p[0] * q[1] - q[0] * p[1];
      }, 0) > 0,
    );
    assert.deepEqual(
      View.hull([
        [1, 1],
        [2, 2],
      ]),
      [
        [1, 1],
        [2, 2],
      ],
    );
  });
  test('beamHulls: every ray point lies in the outline, and a focus inside a stretch pinches it', () => {
    const rows = SYS.lens;
    const S = O.build(rows);
    const M = p => [p[2], p[1]];
    const rays = O.grid(10, 7)
      .filter(([x, y]) => Math.abs(Math.hypot(x, y) - 10) < 3.5 || (!x && !y))
      .map(([x, y]) => [O.start(x, y, 0).p, ...O.trace(S, x, y, 0).map(q => q.p)]);
    const H = View.beamHulls(rays, M, 8);
    const inside = (h, [x, y]) =>
      h.every((p, i) => {
        const q = h[(i + 1) % h.length];
        return (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]) >= -1e-9;
      });
    for (const r of rays)
      for (let i = 1; i < r.length; i++)
        for (const t of [0, 0.3, 0.77, 1]) {
          const p = M(r[i - 1].map((v, k) => v + t * (r[i][k] - v)));
          assert.ok(
            H.some(h => inside(h, p)),
            `ray point ${p}`,
          );
        }
    const last = H.slice(-8);
    const w = h => Math.max(...h.map(p => p[1])) - Math.min(...h.map(p => p[1]));
    assert.ok(Math.min(...last.map(w)) < 0.25 * Math.max(...last.map(w)), 'narrow near the focus');
    assert.deepEqual(View.beamHulls([null, null], M), []);
  });
  test('beamHulls: a focus between stations pinches to its point, not bridged by a piece across it', () => {
    const M = p => [p[2], p[1]];
    const f = 53.7;
    const rays = [...Array(16).keys()].map(k => {
      const a = (k * Math.PI) / 8;
      const x = 10 * Math.cos(a);
      const y = 10 * Math.sin(a);
      return [
        [x, y, 0],
        [(-x * (100 - f)) / f, (-y * (100 - f)) / f, 100],
      ];
    }); // through (0, 0, f), on to z = 100
    const H = View.beamHulls(rays, M);
    const inside = (h, [x, y]) =>
      h.every((p, i) => {
        const q = h[(i + 1) % h.length];
        return (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]) >= -1e-9;
      });
    const hit = p => H.some(h => inside(h, p));
    assert.ok(!hit([f, 1.5]) && !hit([f, -1.5]), 'beside the focus: outside');
    assert.ok(hit([f - 10, 0]) && hit([20, 6]) && hit([90, -6]), 'in the beam: inside');
    assert.ok(
      H.some(h => h.some(p => Math.hypot(p[0] - f, p[1]) < 1e-9)),
      'a piece ends at the focus',
    );
    assert.equal(View.beamHulls(rays, M, 4, 1).length, 5, 'one stretch: 4 stations and the focus');
    const A = p => [0.8 * p[2] - 0.3 * p[0] + 5, 0.6 * p[1] + 0.2 * p[0] - 1];
    const F = rays.map(r => r.map(A)); // an orthographic (affine) view
    const H1 = View.beamHulls(rays, A, 12);
    const H2 = View.beamHulls(rays, A, 12, undefined, F); // stations mapped one by one, or interpolated on the screen
    const area = h =>
      Math.abs(
        h.reduce((a, p, i) => {
          const q = h[(i + 1) % h.length];
          return a + p[0] * q[1] - q[0] * p[1];
        }, 0),
      ) / 2;
    assert.equal(H2.length, H1.length);
    H1.forEach((h, i) => near(area(H2[i]), area(h), 1e-9 * (1 + area(h)), `piece ${i}: the same outline`)); // (round-off may keep or drop a point on an edge)
  });
});

describe('fields as typed', () => {
  test('numbers are y fields, (x, y) pairs are 3D fields; x = 0 pairs are plain numbers; malformed text is refused', () => {
    assert.deepEqual(O.parseFields('0, .1, -0.1'), [0, 0.1, -0.1]);
    assert.deepEqual(O.parseFields('0 0.5  1e-3'), [0, 0.5, 0.001]);
    assert.deepEqual(O.parseFields('0, (0.3, -0.2), (0 0.4), -.5'), [0, [0.3, -0.2], 0.4, -0.5]);
    for (const bad of ['', '0, x', '(1, 2', '(1, 2, 3)', '0, ()', '((1, 2))'])
      assert.equal(O.parseFields(bad), null, JSON.stringify(bad));
    const f = [0, [0.3, -0.2], -1.5];
    assert.deepEqual(O.parseFields(f.map(O.fieldText).join(', ')), f, 'round trip');
  });
});
