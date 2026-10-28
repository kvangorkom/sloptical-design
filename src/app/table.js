// table.js — the surface list: one row per surface, edited in place.
function renderTable() {
  hideJog();
  hideLock();
  const num = (i, k, v) =>
    `<td${k === 'f' ? ` title="${FTIP}"` : ''}><input class="num" data-k="${k}" inputmode="decimal" autocomplete="off" value="${show(k, v)}"` +
    ` aria-label="${k} of ${i ? 'S' + i : 'pupil'}"${k === 'ap' ? ' placeholder="auto"' : ''}>${k === 'tilt' ? '<span class="piv"></span>' : k === 'd' ? '<span class="piv oa"></span>' : ''}</td>`;
  const esc = s => s.replace(/[&"<]/g, c => `&#${c.charCodeAt(0)};`);
  $('tbl').innerHTML =
    `<thead><tr><th>#</th><th class="l" title="Optional label, shown in the view">Name</th><th class="l">Type</th>` +
    (sys.configs
      ? '<th class="l" title="Which configurations have this surface: click a letter to add it to that configuration or take it out">Configs</th>'
      : '') +
    cols()
      .map(([, h, tip]) => `<th title="${tip}">${h}</th>`)
      .join('') +
    '<th class="l" title="Pin a focus of the parent conic to a point, and choose which values vary to hold it">Foci</th>' +
    '<th title="Show where this plane is re-imaged through the system (in the pupil row: the entrance pupil)">Images</th><th></th></tr></thead><tbody>' +
    sys.rows
      .map(
        (r, i) =>
          `<tr data-i="${i}"><td class="idx" title="${i ? 'Pin footprint' : ''}">${i || ''}</td>` +
          (i
            ? `<td><input class="name" data-k="name" value="${esc(r.name)}" placeholder="S${i}" aria-label="Name of S${i}"></td>` +
              `<td><select data-k="type" aria-label="Type of S${i}">${TYPES.map(t => `<option${t === typeOf(r) ? ' selected' : ''}>${t}</option>`)}</select>${dpBox(r, i)}</td>`
            : `<td class="fixed">Entrance pupil</td><td><select data-k="beam" aria-label="Incoming beam" title="Incoming beam: collimated (fields in °) or from a focus (fields in mm)">` +
              ['collimated', 'focus']
                .map(t => `<option${(t === 'focus') === !!r.R ? ' selected' : ''}>${t}</option>`)
                .join('') +
              '</select></td>') +
          (sys.configs ? configCell(r, i) : '') +
          cols()
            .map(([k]) =>
              i || ['t', 'ap', 'R'].includes(k)
                ? noIndex(k, r)
                  ? '<td class="na">—</td>'
                  : num(i, colKey(k, r), r[colKey(k, r)])
                : '<td></td>',
            )
            .join('') +
          (i
            ? `<td class="foc"><button data-act="foci" aria-haspopup="dialog" aria-label="Foci of S${i}"></button></td>`
            : '<td></td>') +
          `<td class="cj"><input type="checkbox" data-k="conj" aria-label="Show the images of ${i ? 'S' + i : 'the pupil'}"${r.conj ? ' checked' : ''}></td>` +
          `<td class="act"><button data-act="add" aria-label="Insert a surface after ${i ? 'S' + i : 'the pupil'}" title="Insert after">+</button>` +
          (i && sys.rows.length > 2
            ? `<button class="del" data-act="del" aria-label="Delete S${i}" title="${sys.configs && Optics.configsOf(sys, r.id).length > 1 ? 'Delete (from every configuration; the Configs column takes it out of one)' : 'Delete'}">×</button>`
            : '') +
          '</td></tr>',
      )
      .join('') +
    '</tbody>';
  markRow();
  renderConfigs();
  if (VIEWER) [$('tbl'), $('cfgBar')].forEach(lockInputs);
}

const rowOf = el => sys.rows[el.closest('tr').dataset.i];
/** The double-pass box, on the last row when it is a mirror: the light comes back off it through the system. */
const dpBox = (r, i) =>
  i === sys.rows.length - 1 && i > 1 && r.type === 'mirror'
    ? `<label class="dp" title="Double pass: the light comes back off this mirror through every optic before it, to the pupil (drawn dashed; the popups' ⇄ shows the way back)"><input type="checkbox" data-k="dp"${r.dp ? ' checked' : ''}>2×</label>`
    : '';
$('tbl').oninput = ({ target: el }) => {
  const k = el.dataset.k;
  const r = rowOf(el);
  if (k === 'conj') {
    if (el.checked) r.conj = true;
    else delete r.conj;
    return update();
  }
  if (k === 'dp') {
    if (el.checked) r.dp = true;
    else delete r.dp;
    return update();
  }
  if (k === 'type') {
    setType(r, el.value);
    renderTable();
  } else if (k === 'beam') {
    setBeam(el.value === 'focus' ? -10 * r.ap : 0);
    renderTable();
  } else if (k === 'name') r.name = el.value;
  else {
    const v = parse(k, el.value);
    el.classList.toggle('bad', v === null);
    if (v === null) return;
    setVal(r, k, v);
    unsolve(el);
    if (k === 'k' && v !== -1 && r.lock?.f2?.at === 'inf') delete r.lock.f2;
  } // no longer a paraboloid: F2 is free (drag it to place the image)
  update();
};
$('tbl').onchange = ({ target: el }) => {
  if (el.matches('.num')) {
    el.value = show(el.dataset.k, rowOf(el)[el.dataset.k]);
    el.classList.remove('bad');
  }
};
$('tbl').onkeydown = e => {
  const el = e.target;
  if (!el.matches('.num, .name')) return;
  if (e.key === 'Enter') el.blur();
  if (e.key === 'Escape' && el.value !== el.dataset.orig) {
    el.value = el.dataset.orig;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.blur();
  }
  if (el.matches('.num') && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    // nudge by 2 % of the jog span (×10 with Shift)
    e.preventDefault();
    const k = el.dataset.k;
    const r = rowOf(el);
    setVal(
      r,
      k,
      fmt((r[k] ?? 0) + (((e.key === 'ArrowUp' ? 1 : -1) * span(k, r[k])) / 25) * (e.shiftKey ? 10 : 1)),
    );
    el.value = show(k, r[k]);
    unsolve(el);
    update();
  }
};
$('tbl').onclick = ({ target: el }) => {
  const tr = el.closest('tbody tr');
  if (!tr) return;
  const i = +tr.dataset.i;
  const R = sys.rows;
  const act = el.dataset.act;
  if (el.matches('.idx') && i) {
    hov.pinned = true;
    hov.at = popNear(i - 1);
    setHov({ i: i - 1 });
  }
  if (act === 'foci') return lk?.ri === i ? hideLock() : showLock(i, el.closest('button'));
  if (el.dataset.cfgm !== undefined) return toggleMember(el);
  if (act === 'add') {
    const last = i === R.length - 1;
    const t = last ? (R[i].t ||= 50) : (R[i].t /= 2); // split the gap: downstream stays put
    reindex(i, 1);
    R.splice(i + 1, 0, { ...DEF, t: last ? 0 : t, n: i ? S[i - 1].nOut : 1 });
  }
  if (act === 'del') {
    reindex(i, -1);
    R[i - 1].t += R[i].t;
    R.splice(i, 1);
  }
  if (act) {
    renderTable();
    update();
  }
};
/** Keep row references (tilt pivots, popups) on the same rows when row `at` is deleted (dir −1) or one is inserted after it (+1).
 *  Call before the splice. A probe in a deleted row's gap moves into the merged gap; a probe past a split point moves on. */
function reindex(at, dir) {
  const R = sys.rows;
  const move = ri => (dir > 0 ? ri + (ri > at) : ri === at ? null : ri - (ri > at));
  R.forEach(r => {
    if (Number.isInteger(r.pivot?.at)) {
      const v = move(r.pivot.at);
      v === null ? delete r.pivot : (r.pivot.at = v);
    }
    for (const f of ['f1', 'f2'])
      if (Number.isInteger(r.lock?.[f]?.at)) {
        const v = move(r.lock[f].at);
        v === null ? delete r.lock[f] : (r.lock[f].at = v);
      }
  });
  sys.watch = (sys.watch ?? []).filter(w => {
    if (!w.ri) return true;
    const v = move(w.ri);
    if (v === null) return false;
    w.ri = v;
    return true;
  }); // watched values stay on their optics
  pops().forEach(p => {
    const t = p.tgt;
    if (!t) return;
    if (t.back && t.i === undefined) return closePop(p); // (a place on the way back: its segments are renumbered too)
    if (t.i !== undefined) {
      const v = move(t.i + 1);
      v === null ? closePop(p) : (t.i = v - 1);
    } else if (dir < 0 && t.j === at) {
      t.j--;
      t.s += R[at - 1].t;
    } else if (dir > 0 && t.j === at && t.s > R[at].t) {
      t.j++;
      t.s -= R[at].t;
    } // R[at].t is already halved
    else t.j = move(t.j);
  });
}
const popNear = i => X(S[i].prof.at(-1));
$('tbl').onmouseover = e => {
  const tr = e.target.closest('tbody tr');
  const i = tr?.dataset.i - 1;
  if (tr && !hov.pinned && i >= 0 && hov.tgt?.i !== i) {
    hov.at = popNear(i);
    setHov({ i });
  }
};
$('tbl').onmouseleave = () => {
  if (!hov.pinned) setHov(null);
};
