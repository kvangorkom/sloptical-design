// Configurations: one pool of rows, each configuration the rows it has, with values of its own where they vary.
// Run: node --test
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const O = require('../src/engine');

const DEF = { name: '', type: 'refract', R: 0, k: 0, d: 0, tilt: 0, t: 0, n: 1, ap: 0 };
const mirror = o => ({ ...DEF, type: 'mirror', ...o });
/** A collimated beam onto an OAP, a fold, then a detector. */
const design = () => ({
  fields: [0],
  rows: [
    { R: 0, t: 100, ap: 10 },
    mirror({ name: 'OAP', R: -400, k: -1, d: 60, t: 150 }),
    mirror({ name: 'Fold', tilt: 30, t: 50 }),
    { ...DEF, name: 'Detector' },
  ],
});
const names = rows => rows.map(r => r.name ?? 'pupil');
const edit = (sys, f) => {
  f(sys.rows);
  O.writeBack(sys);
  return sys;
};

describe('configurations', () => {
  test('adding the first one turns the design into configuration 1 and a copy of it, the copy active', () => {
    const sys = design();
    const plain = structuredClone(sys.rows);
    assert.equal(O.addConfig(sys), 1);
    assert.deepEqual(
      sys.configs.list.map(c => c.name),
      ['Config 1', 'Config 2'],
    );
    for (const ci of [0, 1])
      assert.deepEqual(
        O.configRows(sys, ci).map(({ id, ...r }) => r),
        plain,
      );
    assert.ok(sys.rows.every(r => r.id));
  });

  test('a shared value changes everywhere; one that varies changes only in the active configuration', () => {
    const sys = design();
    O.addConfig(sys);
    edit(sys, R => (R[1].R = -500)); // shared
    assert.equal(O.configRows(sys, 0)[1].R, -500);
    O.setVariesByConfig(sys, sys.rows[2].id, 'tilt', true);
    edit(sys, R => (R[2].tilt = 31));
    assert.equal(O.configRows(sys, 0)[2].tilt, 30);
    assert.equal(O.configRows(sys, 1)[2].tilt, 31);
    assert.deepEqual(O.configValues(sys, sys.rows[2].id, 'tilt'), [30, 31]);
    // the optics after the fold follow the beam in each configuration
    const P = ci => O.build(O.configRows(sys, ci))[2].P;
    assert.notDeepEqual(P(0), P(1));
    // no longer varying: every configuration takes the active one's value
    O.setVariesByConfig(sys, sys.rows[2].id, 'tilt', false);
    assert.equal(O.configRows(sys, 0)[2].tilt, 31);
    assert.equal(O.variesByConfig(sys, sys.rows[2].id, 'tilt'), false);
  });

  test('switching keeps each configuration’s rows; sys.rows is always a complete design', () => {
    const sys = design();
    O.addConfig(sys);
    O.setVariesByConfig(sys, sys.rows[2].id, 'tilt', true);
    edit(sys, R => (R[2].tilt = 40));
    O.setActive(sys, 0);
    assert.equal(sys.rows[2].tilt, 30);
    assert.ok(O.build(sys.rows).every(s => s.P.every(isFinite)));
    O.setActive(sys, 1);
    assert.equal(sys.rows[2].tilt, 40);
  });

  test('a fork: rows only in one configuration, and the distance into the fork varies by itself', () => {
    const sys = design();
    O.addConfig(sys, 'WFS');
    const fold = sys.rows[2].id;
    O.setMember(sys, fold, 1, false); // the WFS arm has no fold: the OAP's distance out now spans the gap there
    assert.deepEqual(names(sys.rows), ['pupil', 'OAP', 'Detector']);
    assert.equal(sys.rows[1].t, 200);
    assert.equal(O.configRows(sys, 0)[1].t, 150, 'the other configuration keeps its own distance');
    assert.ok(O.variesByConfig(sys, sys.rows[1].id, 't'), 'the OAP is now a fork point');
    // a pickoff inserted in the WFS arm joins only it; the OAP's distance there is split, the science arm's kept
    edit(sys, R => {
      R[1].t = 120;
      R.splice(2, 0, mirror({ name: 'Pickoff', tilt: -20, t: 80 }));
    });
    assert.deepEqual(names(O.configRows(sys, 0)), ['pupil', 'OAP', 'Fold', 'Detector']);
    assert.deepEqual(names(O.configRows(sys, 1)), ['pupil', 'OAP', 'Pickoff', 'Detector']);
    assert.equal(O.configRows(sys, 0)[1].t, 150);
    // a row inserted in the shared trunk joins this configuration; the Configs column adds it to the other
    edit(sys, R => {
      R[0].t = 90;
      R.splice(1, 0, { ...DEF, name: 'Window', t: 10 });
    });
    assert.deepEqual(names(O.configRows(sys, 0)), ['pupil', 'OAP', 'Fold', 'Detector']);
    assert.equal(O.configRows(sys, 0)[0].t, 100, 'the other configuration keeps its distance');
    O.setMember(sys, sys.rows[1].id, 0, true);
    O.setVariesByConfig(sys, sys.rows[0].id, 't', false); // one pupil distance again (this configuration's)
    assert.deepEqual(names(O.configRows(sys, 0)), ['pupil', 'Window', 'OAP', 'Fold', 'Detector']);
    assert.equal(O.configRows(sys, 0)[0].t, 90);
  });

  test('deleting a row takes it out of every configuration, each closing its own gap', () => {
    const sys = design();
    O.addConfig(sys);
    O.setVariesByConfig(sys, sys.rows[1].id, 't', true);
    edit(sys, R => (R[1].t = 170)); // this configuration's OAP → Fold distance
    edit(sys, R => {
      R[1].t += R[2].t;
      R.splice(2, 1);
    });
    assert.deepEqual(names(O.configRows(sys, 0)), ['pupil', 'OAP', 'Detector']);
    assert.equal(O.configRows(sys, 1)[1].t, 220);
    assert.equal(
      O.configRows(sys, 0)[1].t,
      200,
      'the other configuration adds the fold’s distance to its own',
    );
  });

  test('focus-lock targets and pivots follow their rows through a fork', () => {
    const sys = design();
    sys.rows[3] = mirror({ name: 'M3', R: -300, t: 100, lock: { f1: { at: 1 }, vary: ['tilt'] } });
    sys.rows.push({ ...DEF, name: 'Image' });
    O.addConfig(sys);
    O.setMember(sys, sys.rows[2].id, 1, false); // no fold in configuration 2: M3 is row 2 there
    const L = ci => O.configRows(sys, ci).find(r => r.name === 'M3').lock.f1.at;
    assert.equal(L(0), 1);
    assert.equal(L(1), 1, 'still the OAP');
    sys.rows.find(r => r.name === 'M3').lock.f1.at = 0; // retarget (the pupil centre)
    O.writeBack(sys);
    assert.equal(L(0), 0);
    const pool = sys.configs.rows.find(r => r.name === 'M3');
    assert.equal(pool.lock.f1.at, '@r0', 'stored by id');
  });

  test('solved values are each configuration’s own', () => {
    const sys = design();
    sys.rows[2].solve = { t: { type: 'focus' } }; // the fold's distance out: focus on the detector
    sys.rows[1].t = 120;
    O.applySolves(sys.rows);
    O.addConfig(sys);
    O.setVariesByConfig(sys, sys.rows[1].id, 't', true);
    edit(sys, R => (R[1].t = 140));
    O.applySolves(sys.rows);
    O.writeBack(sys);
    const t = ci => O.solvedConfig(sys, ci)[2].t;
    assert.ok(Math.abs(t(0) + 120 - (t(1) + 140)) < 1e-6, 'each keeps the focus on the detector');
    assert.notEqual(O.configRows(sys, 0)[2].t, O.configRows(sys, 1)[2].t);
  });

  test('a solve set on a value that differs by configuration is that configuration’s own', () => {
    // the OAP's distance out is a fork (straight to the focus in A, to a pickoff in B); A's focus solve on it mustn't
    // pull B's pickoff to A's focus
    const sys = design();
    O.addConfig(sys);
    O.setMember(sys, sys.rows[2].id, 1, false); // B: no fold
    edit(sys, R => R.splice(2, 0, mirror({ name: 'Pickoff', tilt: -45, t: 60 })));
    edit(sys, R => (R[1].t = 90));
    O.setActive(sys, 0);
    edit(sys, R => (R[1].solve = { t: { type: 'focus' } }));
    O.applySolves(sys.rows);
    O.writeBack(sys);
    assert.deepEqual(O.configRows(sys, 0)[1].solve, { t: { type: 'focus' } });
    assert.equal(O.configRows(sys, 1)[1].solve, undefined);
    assert.equal(O.solvedConfig(sys, 1)[1].t, 90, 'B keeps its pickoff 90 mm from the OAP');
    // and an edit of the OAP's shape (shared) leaves B's pickoff that distance along B's new beam
    edit(sys, R => (R[1].R = -380));
    assert.equal(O.solvedConfig(sys, 1)[1].R, -380);
    assert.equal(O.solvedConfig(sys, 1)[1].t, 90);
  });

  test('removing configurations: rows only the removed one had go; with one left, the design has none', () => {
    const sys = design();
    O.addConfig(sys);
    edit(sys, R => R.splice(3, 0, { ...DEF, name: 'Filter', t: 5 }));
    O.setMember(sys, sys.rows[3].id, 0, false);
    assert.deepEqual(names(O.configRows(sys, 0)), ['pupil', 'OAP', 'Fold', 'Detector']);
    O.removeConfig(sys, 1);
    assert.equal(sys.configs, undefined);
    assert.deepEqual(names(sys.rows), ['pupil', 'OAP', 'Fold', 'Detector']);
    assert.ok(sys.rows.every(r => r.id === undefined));
  });

  test('a design without configurations is untouched', () => {
    const sys = design();
    const before = JSON.stringify(sys);
    O.applySolves(sys.rows);
    assert.equal(JSON.stringify(sys), before);
    assert.equal(sys.configs, undefined);
  });
});
