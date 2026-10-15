// Stigmatic imaging as images held or riding. A curved mirror that images perfectly is fixed by where it sits on the beam
// and where it images; its shape is solved from those. Its image is held in the room (mirrors reshape to keep it; flats on
// the way are held in the room too) or rides with the mirror (moving or tilting the mirror carries it). Run: node --test
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const O = require('../src/engine');

const DEF = { name: '', type: 'refract', R: 0, k: 0, d: 0, tilt: 0, t: 0, n: 1, ap: 0 };
const mirror = o => ({ ...DEF, type: 'mirror', ...o });
const near = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} got ${a}, expected ${b} ± ${tol}`);
const dist = (a, b) => Math.hypot(...O.add(a, b, -1));
const deg = r => (r * 180) / Math.PI;

/** A collimated beam onto an off-axis paraboloid, a sharp fold flat, then a focal plane: the paraboloid's focus pinned to
 *  the focal plane (a row downstream, the old way), varying its whole shape. */
const folded = () => [
  { R: 0, t: 903, ap: 100 },
  mirror({
    name: 'Primary',
    R: -3324.444172816131,
    k: -1,
    d: 6.497285902503772,
    oa: 'angle',
    t: 866.7656779212772,
    lock: { vary: ['k', 'R', 'd', 'tilt'], f2: { at: 'inf' }, f1: { at: 3 } },
  }),
  mirror({ name: 'Fold', tilt: -13.863116206739392, t: 817.0160785965661 }),
  { ...DEF, name: 'Focal plane' },
];
/** Move flat (surface 1) along its incoming beam by s mm, as a drag does, and solve. */
const slide = (rows, s) => {
  const S = O.build(rows);
  const R = O.moveOptic(rows, 1, O.add(S[1].P, S[0].uOut, s));
  return [R, O.applySolves(R)];
};

describe('stigmatic imaging: images held or riding', () => {
  test('a pin on a row downstream (a loop) becomes a point held in the room; the plane there focuses on it', () => {
    const rows = folded();
    const P3 = O.build(rows)[2].P;
    assert.equal(O.applySolves(rows).size, 0);
    const f1 = rows[1].lock.f1;
    assert.deepEqual([f1.at, f1.space], ['pt', 1]); // after the fold: seen through it
    near(dist([0, ...f1.p], P3), 0, 1e-9);
    assert.deepEqual(rows[2].solve, { t: { type: 'focus' } });
    assert.ok(rows[2].room, 'the fold is held in the room');
    // now exactly determined: the shape doesn't drift as the fold moves
    const J = O.lockJac(structuredClone(rows), 1, rows[1].lock.vary);
    assert.equal(J.length, 4);
  });

  test('holding the focus: sliding the fold reshapes the paraboloid smoothly; the focus stays put and stays perfect', () => {
    let R = folded();
    O.applySolves(R);
    const W = O.build(R)[2].P;
    let prev = R[1].d;
    for (let k = 0; k < 6; k++) {
      let fails;
      [R, fails] = slide(R, 10);
      assert.equal(fails.size, 0);
      const S = O.build(R);
      near(dist(S[2].P, W), 0, 1e-6, 'the focal plane where it was');
      assert.equal(O.stigmatic(S, 0), true);
      near(deg(Math.acos(Math.abs(S[0].ez[2]))), 0, 1e-9, 'axis along the beam');
      assert.ok(Math.abs(R[1].d - prev) < 0.1, `off-axis changes smoothly (${prev} → ${R[1].d})`);
      prev = R[1].d;
    }
  });

  test('a paraboloid pinned at infinity in a collimated beam keeps its axis along the beam (k = −1 alone is not enough)', () => {
    const rows = folded();
    O.applySolves(rows);
    const F = O.foci(O.build(rows)[0])[0];
    rows[1].lock = { vary: ['k', 'R', 'd', 'tilt'], f2: { at: 'inf' }, f1: { at: 'pt', p: [F[1], F[2]] } };
    rows[1].tilt += 2; // knocked off the beam
    assert.equal(O.holdFoci(rows, 1), true);
    const S = O.build(rows);
    near(deg(Math.acos(Math.abs(S[0].ez[2]))), 0, 1e-7, 'axis back along the beam');
    assert.equal(O.stigmatic(S, 0), true);
  });

  test('riding: the fold slides and the focus (and the plane on it) follows; the paraboloid is untouched', () => {
    const R0 = folded();
    O.applySolves(R0);
    const S0 = O.build(R0);
    R0[1].lock = { f1: { at: 'pt', ride: O.toRide(S0, 0, O.foci(S0[0])[0]) }, f2: { at: 'inf' } };
    R0[1].lock.vary = O.stigVary(R0, 1);
    assert.deepEqual(R0[1].lock.vary, ['R', 'd']);
    assert.equal(O.applySolves(R0).size, 0);
    assert.equal(R0[2].room, undefined, 'nothing held in the room');
    const [R, fails] = slide(R0, 30);
    assert.equal(fails.size, 0);
    const S = O.build(R);
    assert.deepEqual([R[1].R, R[1].d], [R0[1].R, R0[1].d]);
    near(dist(O.inFocus(S, 2), S[2].P), 0, 1e-6, 'the focal plane on the focus');
    assert.ok(dist(S[2].P, S0[2].P) > 20, 'and it moved with the fold');
  });

  test('riding: a paraboloid dragged across its collimated beam slides, image and all (same shape, still perfect)', () => {
    const R0 = folded();
    O.applySolves(R0);
    const S0 = O.build(R0);
    R0[1].lock = { f1: { at: 'pt', ride: O.toRide(S0, 0, O.foci(S0[0])[0]) }, f2: { at: 'inf' } };
    R0[1].lock.vary = O.stigVary(R0, 1);
    O.applySolves(R0);
    assert.equal(O.heldD(R0, 1), false, 'free to slide across');
    const R = O.moveOptic(R0, 0, O.add(S0[0].P, [0, 1, 0], 20));
    assert.equal(O.applySolves(R).size, 0);
    const S = O.build(R);
    near(R[1].R, R0[1].R, 1e-6, 'same shape');
    near(dist(S[0].V, O.add(S0[0].V, [0, 20, 0])), 0, 1e-6, 'slid by the drag');
    near(dist(O.foci(S[0])[0], O.add(O.foci(S0[0])[0], [0, 20, 0])), 0, 1e-6, 'its focus with it');
    assert.equal(O.stigmatic(S, 0), true);
  });

  test('riding: tilting a mirror swings its image round; holding, the image can’t move, so the tilt has no solution', () => {
    const relay = () => [
      { R: -200, t: 100, ap: 10 },
      mirror({ R: -300, k: 0, t: 400 }),
      { ...DEF, name: 'Image' },
    ];
    const lock = (rows, img) => {
      const S = O.build(rows);
      rows[1].lock = { f1: { at: 'in' }, f2: img(S) };
      rows[1].lock.vary = O.stigVary(rows, 1);
      O.offAxisAs(rows, 1, 'angle');
      O.applySolves(rows);
      return rows;
    };
    const ride = lock(relay(), S => ({ at: 'pt', ride: O.toRide(S, 0, O.inFocus(S, 1)) }));
    const I0 = O.inFocus(O.build(ride), 1);
    const R = O.tiltOptic(ride, 0, 3);
    assert.equal(O.applySolves(R).size, 0);
    const S = O.build(R);
    assert.equal(O.stigmatic(S, 0), true);
    near(dist(O.inFocus(S, 1), S[0].P), dist(I0, O.build(ride)[0].P), 1e-6, 'same distance from the mirror');
    assert.ok(dist(O.inFocus(S, 1), I0) > 1, 'swung round');
    const held = lock(relay(), S => {
      const q = O.inFocus(S, 1);
      return { at: 'pt', p: [q[1], q[2]] };
    });
    assert.ok(O.applySolves(O.tiltOptic(held, 0, 3)).has('1lock'), 'held: no solution with that tilt');
  });

  test('values varied: exactly as many as the pins fix', () => {
    const rows = folded();
    O.applySolves(rows);
    const S = O.build(rows);
    const at = (L, R = rows) => ((R[1].lock = L), O.stigVary(R, 1));
    assert.deepEqual(at({ f1: { at: 'pt', p: [0, 0] }, f2: { at: 'inf' } }), ['R', 'd']); // collimated in, image held
    assert.deepEqual(at({ f2: { at: 'inf' } }), ['tilt']); // collimated in, no image pinned: only facing the beam
    const finite = [{ R: -200, t: 100, ap: 10 }, mirror({ R: -300, t: 400 }), { ...DEF }];
    assert.deepEqual(at({ f1: { at: 'in' }, f2: { at: 'pt', ride: [400, 0] } }, finite), [
      'R',
      'k',
      'd',
      'tilt',
    ]);
    assert.deepEqual(at({ f1: { at: 'in' } }, finite), ['d', 'tilt']);
    assert.ok(S.length);
  });

  test('a flat held in the room is re-held where an edit puts it; one the beam can’t reach isn’t placed', () => {
    const rows = folded();
    O.applySolves(rows);
    const n0 = [...rows[2].room.n];
    rows[2].tilt += 2; // an edit of the held flat
    assert.equal(O.applySolves(rows).size, 0);
    assert.ok(dist(rows[2].room.n, n0) > 1e-3, 'held at its new tilt');
    near(
      dist(O.build(rows)[2].P, O.lockPoint(O.build(rows), rows[1].lock.f1)),
      0,
      1e-6,
      'the focus still on its point',
    );
    const S = O.build(rows);
    const R = structuredClone(rows);
    R[2].room.p = O.add(S[0].P, S[0].uOut, -100); // the held plane behind the paraboloid, as the beam now runs
    assert.equal(O.placeFlat(R, 2), false, 'the beam can’t reach it there');
  });

  test('configurations keep a held point’s space by its row', () => {
    const sys = { fields: [0], rows: folded() };
    O.applySolves(sys.rows);
    O.addConfig(sys);
    const pool = sys.configs.rows.find(r => r.name === 'Primary');
    assert.match(String(pool.lock.f1.space), /^@/);
    assert.equal(O.configRows(sys, 0)[1].lock.f1.space, 1);
  });
});
