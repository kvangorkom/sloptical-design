// guard.js — the Stigmatic guard: with Stigmatic on, no edit may make a mirror that images perfectly stop doing so (Optics.stigmatic), nor
// make a focus lock that held stop holding. An untouched mirror that an edit upstream would spoil is first locked to keep
// imaging perfectly onto the image it had (its F1 on the incoming focus, F2 on that point); if that holds, the edit stands
// and the mirror follows it. Otherwise the edit is refused: the system goes back to the last accepted state, with a note.
let good = null; // the last accepted state while Stigmatic is on
const stigOf = St => St.map((_, i) => Optics.stigmatic(St, i));
const snapGood = () => ({
  json: JSON.stringify(sys),
  n: sys.rows.length,
  stig: stigOf(Optics.build(sys.rows)),
  fails: new Set(fails),
});
const ownVals = r =>
  JSON.stringify(['type', 'R', 'k', 'd', 'oa', 'tilt', 'tiltY', 'clock', 'pivot', 'n', 'f'].map(k => r?.[k])); // a row's own shape and pose (not its distance out)
function guard(pre) {
  // pre: each row's own values as the edit left them, before solves
  if (!$('stig').checked) {
    good = null;
    return;
  }
  if (!good || good.n !== sys.rows.length) {
    good = snapGood();
    return;
  } // a new design, or optics added or removed: nothing to compare with
  const prev = JSON.parse(good.json).rows;
  // a flat mirror given a radius takes up imaging perfectly: locked to image its incoming focus onto its image now
  const curved = sys.rows.flatMap((r, ri) =>
    ri &&
    r.type === 'mirror' &&
    r.R &&
    !r.lock?.f1 &&
    !r.lock?.f2 &&
    prev[ri]?.type === 'mirror' &&
    !prev[ri].R
      ? [ri]
      : [],
  );
  if (curved.length) {
    const St = Optics.build(sys.rows);
    if (curved.filter(ri => stigLock(ri, St)).length) fails = Optics.applySolves(sys.rows);
  }
  const Sg = Optics.build(prev);
  const broken = st =>
    good.stig.flatMap((v, i) => (v === true && st[i] === false && !sys.rows[i + 1]?.ball ? [i] : [])); // (a caliball may be decentred or defocused: that is what it is for)
  let now = stigOf(Optics.build(sys.rows));
  let bad = broken(now);
  const follow = bad.filter(i => {
    const r = sys.rows[i + 1];
    return !r.lock?.f1 && !r.lock?.f2 && pre[i + 1] === ownVals(prev[i + 1]);
  }); // untouched by the edit itself
  if (follow.length) {
    follow.forEach(i => {
      stigLock(i + 1, Sg);
      if (drag?.rows0) stigLock(i + 1, Sg, drag.rows0);
    });
    fails = Optics.applySolves(sys.rows);
    now = stigOf(Optics.build(sys.rows));
    bad = broken(now);
  }
  const lost = [...fails]
    .filter(f => (f.endsWith('lock') || f.endsWith('room')) && !good.fails.has(f))
    .map(f => parseInt(f) - 1); // (room: the beam no longer reaches a flat held in the room)
  if (bad.length || lost.length) {
    const g = JSON.parse(good.json);
    for (const k of Object.keys(sys)) delete sys[k];
    Object.assign(sys, g);
    fails = new Set(good.fails);
    const el = document.activeElement; // a refused value typed into a field goes back to the kept one
    if (el?.matches?.('#tbl .num, .popP .num')) {
      el.value = show(el.dataset.k, sys.rows[el.closest('tr').dataset.i]?.[el.dataset.k]);
    }
    const who = [...new Set([...bad, ...lost])].map(label).join(', ');
    stigNote = `Refused: ${who} would stop imaging perfectly (Stigmatic is on)`;
    return;
  }
  good = { json: JSON.stringify(sys), n: sys.rows.length, stig: now, fails: new Set(fails) };
}
