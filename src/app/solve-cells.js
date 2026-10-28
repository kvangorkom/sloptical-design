// solve-cells.js — solves (computed by the engine): row.solve[key] = {type, v}, re-applied in row order on every update.
const SOLVE = { focus: 'Focus at next', collim: 'Collimate', centre: 'Centre next on focus' };
const solveOpts = (ri, k) => Optics.solvesFor(sys.rows, ri, k);

/** Refresh solved cells: value, corner marker, tooltip. */
function syncCells(root = $('tbl')) {
  const multi = sys.rows.reduce((n, r) => n + Object.keys(r.solve ?? {}).length, 0) > 1;
  if (root === $('tbl'))
    pops().forEach(p => {
      const ed = p.el.querySelector('.popP');
      if (ed && !ed.hidden) syncCells(ed);
    }); // popup editors too
  root.querySelectorAll('.name').forEach(el => {
    if (el !== el.ownerDocument.activeElement) el.value = sys.rows[el.closest('tr').dataset.i]?.name ?? '';
  });
  root.querySelectorAll('.num').forEach(el => {
    const ri = el.closest('tr').dataset.i;
    const k = el.dataset.k;
    const sv = sys.rows[ri].solve?.[k];
    const bad = fails.has(ri + k);
    const vr = Optics.varies(sys.rows, +ri, k);
    const lr = vr && (sys.rows[ri].lock?.vary?.includes(k) ? +ri : +ri + 1);
    const lbad = vr && fails.has(lr + 'lock');
    const td = el.closest('td');
    td.classList.toggle('solved', !!sv);
    td.classList.toggle('fail', bad || lbad);
    td.classList.toggle('multi', !!sv && multi && !bad);
    td.classList.toggle('varied', vr);
    if (vr) {
      el.title = `Varies to hold the pinned foci of ${label(lr - 1)}${lbad ? ' (no exact solution; value unchanged)' : ''}. Editing the value stops it varying.`;
    } else
      el.title = sv
        ? `Solve: ${SOLVE[sv.type]}${bad ? ' (no solution; value unchanged)' : ''}${multi ? '. Another parameter is also being solved; solves run in row order and can fight' : ''}. Editing the value removes the solve.`
        : '';
    if (el !== el.ownerDocument.activeElement) el.value = show(k, sys.rows[ri][k]);
  });
  root.querySelectorAll('.cj input').forEach(el => {
    const ri = +el.closest('tr').dataset.i;
    const who = ri ? label(ri - 1) : 'The entrance pupil';
    const cs = CJ.filter(c => c.ri === ri);
    el.title = !sys.rows[ri].conj
      ? `Show where ${ri ? label(ri - 1) : 'the entrance pupil'} is re-imaged`
      : `${who} is re-imaged ` +
        (cs.length
          ? cs
              .map(
                c =>
                  `${c.virtual ? 'virtually ' : ''}${nf(Math.abs(c.s))} mm ${c.s < 0 ? 'before' : 'after'} ${c.j ? label(c.j - 1) : 'the pupil'}` +
                  `${c.past ? ' (past the last surface: where the light would go on)' : ''} (m ${nf(c.m)}${c.rot ? `, turned ${nf(c.rot)}°` : ''})` +
                  (c.astig
                    ? `, astigmatic: line images ${c.astig.map(t => nf(t)).join(' and ')} mm (${nf(c.astig[1] - c.astig[0])} mm apart)`
                    : ''),
              )
              .join('; ')
          : 'nowhere (the images are at infinity)');
  });
  root.querySelectorAll('.foc button').forEach(b => {
    const ri = +b.closest('tr').dataset.i;
    const s = S[ri - 1];
    const L = sys.rows[ri].lock;
    const F = s ? Optics.foci(s) : [];
    const pins = [1, 2].filter(n => L?.[`f${n}`]).map(n => `F${n} → ${tgtName(L[`f${n}`])}`);
    const bad = fails.has(ri + 'lock');
    b.textContent = pins.length ? pins.join(', ') : F.length ? 'free' : '—';
    b.className = pins.length ? (bad ? 'fail' : 'on') : 'off';
    b.title = pins.length
      ? `${pins.join(', ')}${L.vary?.length ? `; varying ${L.vary.map(vname).join(', ')}` : '; nothing varies yet'}${bad ? '. No exact solution' : ''}`
      : F.length
        ? 'Pin a focus to a point'
        : 'No foci on the axis (flat or oblate)';
  });
  if (lk && root === $('tbl')) renderLock();
  root.querySelectorAll('.piv.oa').forEach(el => {
    const ang = rowOf(el).oa === 'angle';
    const inp = el.parentElement.querySelector('.num'); // off-axis given as an angle
    el.textContent = ang ? '∠°' : '';
    inp.title = ang ? 'Normal angle (°): the parent’s normal where the axis ray lands, to its axis' : '';
  });
  root.querySelectorAll('.piv:not(.oa)').forEach(el => {
    const p = rowOf(el).pivot?.at; // tilt pivot tag
    el.textContent = p === undefined ? '' : '@ ' + (p === 'coc' ? 'CoC' : p ? label(p - 1) : 'pupil');
    el.parentElement.querySelector('.num').title ||=
      p === undefined ? '' : `Swings about ${el.textContent.slice(2)} from ${fmt(rowOf(el).pivot.ref)}°`;
  });
  markConfigCells(root);
}
const unsolve = el => {
  const r = rowOf(el);
  if (r.solve?.[el.dataset.k]) {
    delete r.solve[el.dataset.k];
    if (jt) renderSolves();
  }
  Optics.unvary(sys.rows, +el.closest('tr').dataset.i, el.dataset.k);
};
