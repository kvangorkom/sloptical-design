// locks.js — focus locks (solved by the engine): per surface, pin F1 and/or F2 of its parent conic to a point, and choose the values
// that may vary to hold them: any that can move a pinned focus. With more than the pins need (R, k and off-axis with one
// focus pinned, say), each solve makes the smallest change that holds them, so they all follow a drag (Optics.varyPick, holdFoci).
const VNAME = {
  R: 'R',
  k: 'k',
  d: 'off-axis',
  tilt: 'tilt',
  tiltY: 'tilt y',
  clock: 'clock',
  t: 'dist out',
  tin: 'dist in',
};
const vname = k => (k === 'tilt' && Optics.is3D(sys.rows) ? 'tilt x' : VNAME[k]);
const VTIP = {
  R: 'Radius of curvature (solved as curvature, so it can pass through flat)',
  k: 'Conic constant',
  d: 'Off-axis distance',
  tilt: 'Tilt',
  tiltY: 'Tilt toward +x (3D)',
  clock: 'Clocking about the parent’s own axis, which also sets the off-axis direction (3D)',
  t: 'Distance to the next surface (moves everything downstream)',
  tin: 'Distance from the previous surface (slides this optic along its incoming axis)',
};
const tgtName = tg =>
  tg.at === 'src'
    ? 'source'
    : tg.at === 'in'
      ? 'incoming focus'
      : tg.at === 'pt'
        ? 'a point'
        : tg.at === 'inf'
          ? 'infinity'
          : tg.at === 0
            ? 'pupil centre'
            : sys.rows[tg.at]
              ? label(tg.at - 1) + (tg.f ? ` F${tg.f}` : '')
              : '?';
/** The value and lock popovers open over the view for a popup's editor, else in the surface list (where they live). */
const home = { jog: $('jog').parentElement, lock: $('lock').parentElement };
function hostFor(el, anchor) {
  const inPop = !!anchor.closest('.pop');
  const h = inPop ? $('main') : home[el.id];
  if (el.parentElement !== h) h.append(el);
  el.style.zIndex = inPop ? 3000 : '';
}
function showLock(ri, anchor) {
  hideJog();
  lk = { ri, anchor };
  hostFor($('lock'), anchor);
  $('lock').hidden = false;
  renderLock();
  placeLock();
  draw();
}
function hideLock() {
  if (!lk) return;
  lk = null;
  $('lock').hidden = true;
  draw();
}
function placeLock() {
  const el = $('lock');
  const sec = el.parentElement;
  const a = lk.anchor.getBoundingClientRect();
  const b = sec.getBoundingClientRect();
  const below = a.bottom + el.offsetHeight + 4 <= b.bottom;
  el.style.top =
    (below ? a.bottom + 2 : Math.max(b.top, a.top - el.offsetHeight - 2)) - b.top + sec.scrollTop + 'px';
  el.style.left =
    Math.max(
      0,
      Math.min(a.right - el.offsetWidth - b.left + sec.scrollLeft, sec.scrollWidth - el.offsetWidth - 4),
    ) + 'px';
}
function renderLock() {
  const ri = lk.ri;
  const r = sys.rows[ri];
  const s = S[ri - 1];
  const L = r?.lock ?? {};
  const el = $('lock');
  if (!s || !r) return hideLock();
  const had = el.ownerDocument.activeElement;
  const refocus =
    el.contains(had) &&
    (had.dataset.v ? `[data-v="${had.dataset.v}"]` : had.dataset.f ? `[data-f="${had.dataset.f}"]` : null);
  const F = Optics.foci(s);
  const dist = f => (f ? nf((f[1] - s.V[1]) * s.ez[1] + (f[2] - s.V[2]) * s.ez[2]) + ' mm' : '∞');
  const opts = [
    ['', 'free'],
    ['in', 'Incoming focus (stigmatic)'],
    ['pt', 'A point (drag it in the view)'],
    ...(S.beam ? [['src', 'Beam source (focus)']] : []),
    ['0', 'Pupil centre'],
    ...S.flatMap((q, j) =>
      j >= ri - 1 // (only upstream: a row downstream moves with this one, so a pin there goes round in a loop)
        ? []
        : [
            [`${j + 1}`, `${label(j)} · hit point`],
            ...Optics.foci(q).flatMap((f, n) =>
              f && !(n && q.k === 0) ? [[`${j + 1}:${n + 1}`, `${label(j)} · F${n + 1}`]] : [],
            ),
          ],
    ),
  ];
  const key = tg => (!tg ? '' : typeof tg.at === 'string' ? tg.at : tg.f ? `${tg.at}:${tg.f}` : `${tg.at}`);
  const sel = n => {
    const why = !F.length && !(L.f1 || L.f2) ? 'No foci on the axis' : '';
    return `<label>F${n} at <select data-f="${n}"${why ? ' disabled' : ''} title="${why}">${[
      ...opts,
      ...(n === 2 ? [['inf', 'Infinity (a paraboloid: k = −1)']] : []),
    ]
      .map(
        ([v, t]) => `<option value="${v}"${key(L['f' + n]) === v ? ' selected' : ''}>${escHTML(t)}</option>`,
      )
      .join('')}</select></label>`;
  };
  const pinned = L.f1 || L.f2;
  const bad = fails.has(ri + 'lock');
  const vary = L.vary ?? [];
  const spare =
    pinned && vary.length > 1 && Optics.varyPick(sys.rows, ri, [...vary].reverse()).spare.length > 0;
  const msg = !F.length
    ? 'No foci on this surface’s axis (flat, or an oblate ellipsoid with k > 0).'
    : !pinned
      ? 'Pin a focus: to the incoming beam’s focus, a point you drag in the view, another surface’s hit point or focus, the pupil centre, or the beam’s source.'
      : !vary.length
        ? 'Choose which values may vary to hold it.'
        : bad
          ? `No exact solution varying ${vary.map(vname).join(', ')}: let another value vary.`
          : `Held by varying ${vary.map(vname).join(', ')}${spare ? ' (more than the pins need: each solve changes them as little as possible)' : ''}.`;
  el.innerHTML =
    `<div class="lkH">Foci of ${escHTML(label(ri - 1))}<small>${F.length ? `F1 ${dist(F[0])}${s.k === 0 ? ' (the centre; F1 = F2)' : ` · F2 ${dist(F[1])}`} from the vertex` : 'none'}</small></div>` +
    sel(1) +
    sel(2) +
    `<label>Vary <span class="seg">${Optics.VARY.map(k => `<button data-v="${k}" aria-pressed="${vary.includes(k)}" title="${VTIP[k]}">${vname(k)}</button>`).join('')}</span></label>` +
    `<div class="lkS ${pinned && vary.length ? (bad ? 'bad' : 'ok') : ''}" role="status">${msg}</div>`;
  if (refocus) el.querySelector(refocus)?.focus(); // keep keyboard focus across the re-render
}
$('lock').onchange = e => {
  const n = e.target.dataset.f;
  if (!n) return;
  commit(); // a pending edit stays its own undo step
  const r = sys.rows[lk.ri];
  const v = e.target.value;
  const L = (r.lock ??= { vary: [] });
  if (!v) delete L['f' + n];
  else if (v === 'pt') {
    const i = lk.ri - 1;
    const s = S[i];
    const f = Optics.foci(s)[n - 1];
    const q = f
      ? Optics.realImage(S, i, f)
      : { p: s.P.map((x, k) => x + s.uOut[k] * Math.abs(1 / (s.c || 1e-3))), space: i };
    L['f' + n] = { at: 'pt', p: pt2(q.p), ...(q.space > i && { space: q.space }) };
  } // where that focus is now, held where its light converges (at infinity: out along the beam)
  else if (v === 'in' || v === 'inf' || v === 'src') L['f' + n] = { at: v };
  else {
    const [a, f] = v.split(':');
    L['f' + n] = { at: +a, ...(f && { f: +f }) };
  }
  if ($('stig').checked && stigLocked(lk.ri)) {
    L.vary = Optics.stigVary(sys.rows, lk.ri); // Stigmatic: held image, all the shape; free image, the pose
    L.vary.forEach(k => delete r.solve?.[k]);
  } else if (!stigPair(lk.ri)) {
    const { keep } = Optics.varyPick(sys.rows, lk.ri, [...(L.vary ?? [])].reverse());
    L.vary = (L.vary ?? []).filter(k => keep.includes(k));
  }
  if (!L.f1 && !L.f2 && !L.vary.length) delete r.lock;
  update();
};
$('lock').onclick = e => {
  const k = e.target.closest('[data-v]')?.dataset.v;
  if (!k) return;
  commit();
  const ri = lk.ri;
  const r = sys.rows[ri];
  const L = (r.lock ??= { vary: [] });
  if ((L.vary ??= []).includes(k)) L.vary = L.vary.filter(v => v !== k);
  else {
    const pick = Optics.varyPick(sys.rows, ri, [k, ...[...L.vary].reverse()]);
    if (pick.zero.includes(k)) return toast(`${vname(k)} can’t move the pinned foci of ${label(ri - 1)}`);
    if (k === 'tin') {
      delete sys.rows[ri - 1].solve?.t;
      Optics.unvary(sys.rows, ri - 1, 't');
    } else {
      delete r.solve?.[k];
      Optics.unvary(sys.rows, ri, k);
    } // one owner per value
    L.vary = [...L.vary.filter(v => pick.keep.includes(v)), k];
  }
  if (!L.f1 && !L.f2 && !L.vary.length) delete r.lock;
  update();
};

// Cell popover: one jog slider (±50 % of the value at grab time) plus the solves available for that cell.
let jt = null;
function showJog(el) {
  jt = el;
  hostFor($('jog'), el);
  const jog = $('jog');
  const sec = jog.parentElement;
  const a = el.getBoundingClientRect();
  const b = sec.getBoundingClientRect();
  jog.hidden = false;
  $('jogR').value = 0;
  $('jogR').base = null;
  $('jogL').textContent = '±' + nf(span(el.dataset.k, rowOf(el)[el.dataset.k]));
  renderSolves();
  renderPivot();
  renderOA();
  renderCfgVary();
  const below = a.bottom + jog.offsetHeight + 4 <= b.bottom; // open upward when there's no room below
  jog.style.top = (below ? a.bottom + 2 : a.top - jog.offsetHeight - 2) - b.top + sec.scrollTop + 'px';
  jog.style.left =
    Math.max(0, Math.min(a.left - b.left + sec.scrollLeft, sec.scrollWidth - jog.offsetWidth - 4)) + 'px';
}
function hideJog() {
  $('jog').hidden = true;
  jt = null;
}
/** Tilt pivot picker: this surface's hit point (default), its centre of curvature, or an upstream optic's hit point. */
function renderPivot() {
  const ri = +jt.closest('tr').dataset.i;
  const r = sys.rows[ri];
  const on = jt.dataset.k === 'tilt' && ri > 0;
  $('pivotRow').hidden = !on;
  if (!on) return;
  $('pivot').replaceChildren(
    ...[
      ['', 'Own hit point'],
      ['coc', 'Own centre of curvature'],
      ...sys.rows.slice(0, ri).map((_, j) => [j, j ? `${label(j - 1)} (hit point)` : 'Pupil centre']),
    ].map(([v, l]) => new Option(l, v, false, String(r.pivot?.at ?? '') === String(v))),
  );
}
/** Off-axis as a height or as the parent's normal angle (Optics.offAxisAs): only for a powered surface's off-axis cell. */
function renderOA() {
  const ri = +jt.closest('tr').dataset.i;
  const r = sys.rows[ri];
  const on = jt.dataset.k === 'd' && ri > 0 && (!!r.R || r.oa === 'angle');
  $('oaRow').hidden = !on;
  if (!on) return;
  const ang = r.oa === 'angle';
  $('oaRow')
    .querySelectorAll('button')
    .forEach(b => b.setAttribute('aria-pressed', String((b.dataset.oa === 'angle') === ang)));
}
$('oaRow').onclick = e => {
  const m = e.target.dataset?.oa;
  if (!m || !jt) return;
  commit();
  const ri = +jt.closest('tr').dataset.i;
  const r = sys.rows[ri];
  if (!Optics.offAxisAs(sys.rows, ri, m))
    return toast(
      m === 'height'
        ? `${label(ri - 1)}: no height reaches past 90°`
        : `${label(ri - 1)} is flat: it has no normal angle`,
    );
  jt.value = show('d', r.d);
  jt.dataset.orig = jt.value;
  renderOA();
  update();
  toast(`${label(ri - 1)}: off-axis as ${m === 'angle' ? 'the normal angle' : 'a height'}`);
};
$('pivot').onchange = e => {
  const r = rowOf(jt);
  const v = e.target.value; // the current tilt becomes the pose the swing starts from
  if (v === '') delete r.pivot;
  else r.pivot = { at: /^\d+$/.test(v) ? +v : v, ref: r.pivot?.ref ?? r.tilt };
  update();
};
function renderSolves() {
  const ri = +jt.closest('tr').dataset.i;
  const k = jt.dataset.k;
  const cur = sys.rows[ri].solve?.[k];
  const opts = solveOpts(ri, k);
  $('solveBar').hidden = !opts.length;
  $('solveBar').innerHTML =
    'Solve <span class="seg">' +
    ['', ...opts]
      .map(
        t =>
          `<button data-s="${t}" aria-pressed="${(cur?.type ?? '') === t}">${t ? SOLVE[t] : 'Off'}</button>`,
      )
      .join('') +
    '</span>';
}
$('solveBar').onclick = e => {
  const t = e.target.dataset.s;
  if (t === undefined) return;
  commit();
  const r = rowOf(jt);
  const k = jt.dataset.k;
  if (t) {
    (r.solve ??= {})[k] = { type: t };
    Optics.unvary(sys.rows, +jt.closest('tr').dataset.i, k);
  } else delete r.solve?.[k];
  update();
  renderSolves();
};
$('jogR').oninput = e => {
  if (!jt) return;
  const s = e.target;
  const k = jt.dataset.k;
  const r = rowOf(jt);
  s.base ??= r[k] ?? 0;
  setVal(r, k, fmt(s.base + s.value * span(k, s.base)));
  jt.value = show(k, r[k]);
  jt.classList.remove('bad');
  unsolve(jt);
  update();
};
$('jog').onkeydown = e => {
  if (e.key !== 'Escape' || jt.value === jt.dataset.orig) return; // revert to the value before editing
  jt.value = jt.dataset.orig;
  jt.dispatchEvent(new Event('input', { bubbles: true }));
  jt.dispatchEvent(new Event('change', { bubbles: true }));
  hideJog();
};
$('jogR').onchange = e => {
  e.target.value = 0;
  e.target.base = null;
  $('jogL').textContent = '±' + nf(span(jt.dataset.k, rowOf(jt)[jt.dataset.k]));
};
onDoc('focusin', ({ target: el }) => {
  if (el.closest('#tbl, #jog')) redraw(); // the table's optic is selected while it is edited
  if (el.matches('#tbl input, .popP input')) el.dataset.orig = el.value;
  if (el.matches('#tbl .num, .popP .num')) showJog(el);
  else if (!$('jog').contains(el)) hideJog();
});
onDoc('focusout', e => {
  if (e.target.closest?.('#tbl, #jog')) redraw();
});
onDoc('pointerdown', e => {
  if (!e.target.closest('#jog, #tbl .num, .popP .num')) hideJog();
  if (!e.target.closest('#lock, #tbl .foc, .popP .foc')) hideLock();
  if (!e.target.closest('.menu')) $('fileMenu').hidden = true;
});
onDoc('keydown', e => {
  if (
    (e.key === 'Delete' || e.key === 'Backspace') &&
    sys.shapes[shSel] &&
    !e.target.matches('input, textarea, select')
  ) {
    e.preventDefault();
    deleteShape();
  }
});
onDoc('keydown', e => {
  if (e.key !== 'Escape') return;
  if (tool) setTool(null);
  else if (shSel !== null && !e.target.closest?.('#tbl')) {
    selectShape(null);
    draw();
  } else if (lk) {
    const b = lk.anchor;
    hideLock();
    b.focus();
  } else if (hov.pinned) closePop(hov);
});
