// controls.js — the header controls (Examples, Trace: fields, wavelengths, rays, grid; the view buttons), zooming and toasts.
/** Load example `name` into this tab (Examples menu). */
function loadPreset(name) {
  Object.assign(file, {
    name: name.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') + '.json',
    handle: null,
    saved: null,
    path: null,
  });
  idb.del(doc.id);
  load(PRESETS[name]);
  file.base = JSON.stringify(sys);
  update();
  if (side && Optics.is3D(sys.rows)) setCam({ ...View3D.orbit(SIDE, -35, 25), persp: cam.persp }, true); // a 3D example opens in 3D
}
$('exMenu').replaceChildren(
  ...Object.keys(PRESETS).map(k =>
    Object.assign(document.createElement('button'), {
      textContent: k,
      role: 'menuitem',
      onclick: () => loadPreset(k),
    }),
  ),
);

// The header's drop-downs (Examples, Trace, Show): a button opens the panel after it; a click elsewhere or Esc closes it.
const DROPS = ['exBtn', 'traceBtn', 'showBtn'];
const closeDrops = except =>
  DROPS.forEach(id => {
    if (id === except) return;
    $(id).nextElementSibling.hidden = true;
    $(id).setAttribute('aria-expanded', 'false');
  });
for (const id of DROPS)
  $(id).onclick = () => {
    const panel = $(id).nextElementSibling;
    closeDrops(id);
    panel.hidden = !panel.hidden;
    $(id).setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) panel.querySelector('input, button')?.focus();
  };
$('exMenu').addEventListener('click', e => e.target.closest('button') && closeDrops());
onDoc('pointerdown', e => {
  if (!e.target.closest?.('.menu')) closeDrops();
});
onDoc('keydown', e => {
  if (e.key === 'Escape' && DROPS.some(id => !$(id).nextElementSibling.hidden)) {
    const open = DROPS.find(id => !$(id).nextElementSibling.hidden);
    closeDrops();
    $(open).focus();
  }
});
/** The Trace button's label: how many fields, and the wavelength(s). */
function syncTraceBtn() {
  const n = sys.fields.length;
  const L = sys.lambdas ?? [sys.lambda];
  $('traceBtn').textContent =
    `${n} field${n > 1 ? 's' : ''} · ${L.length > 1 ? `${L.length} λ` : `${L[0]} µm`}`;
}
$('fields').oninput = e => {
  const f = Optics.parseFields(e.target.value);
  if (f) {
    const was = three();
    sys.fields = f;
    if (three() !== was) renderTable();
    update();
  }
};
$('lambda').oninput = e => {
  // one wavelength, or several (µm, comma-separated): the first is the primary (layout, WFE, Airy disk)
  const L = e.target.value
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(Number);
  if (!L.length || !L.every(v => v > 0 && v < 100)) return;
  const was = !!sys.lambdas;
  sys.lambda = L[0];
  if (L.length > 1) sys.lambdas = L;
  else delete sys.lambdas;
  if (!!sys.lambdas !== was) renderTable(); // the Abbe column
  update();
};
$('airy').onchange = e => {
  sys.airy = e.target.checked;
  update();
};
$('full').onchange = e => {
  sys.full = e.target.checked;
  update();
};
$('aoiT').onchange = e => {
  sys.aoi = e.target.checked;
  update();
};
$('rays').oninput = e => {
  sys.rays = Math.max(1, e.target.value | 0);
  update();
};
$('grid').oninput = e => {
  sys.grid = Math.max(3, e.target.value | 0);
  update();
};
$('fit').onclick = () => {
  view = null;
  draw();
};
$('camM').onclick = e => {
  const c = e.target.closest('button')?.dataset.c;
  if (!c) return;
  c === '3d' ? setCam({ ...View3D.orbit(SIDE, -35, 25), persp: cam.persp }, true) : goView(c);
};
$('camP').onclick = () => setCam({ ...cam, persp: !cam.persp });
const TYPING = 'input:not([type=checkbox]):not([type=radio]):not([type=button]), textarea, select'; // where keys are typed, not commands
/** View keys (over the view, not while typing): 1 side, 2 top, 3 front (again: the opposite side), 4 3D, 5 perspective,
 *  arrows orbit 15° (Shift 5°), Alt+arrows pan, + / − zoom, F frames the selected optic (or everything), 0 back to the x view, fitted. */
onDoc('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.target.closest?.(TYPING + ', dialog, .pop, #fileMenu, #lock, #jog, #watch'))
    return; // (a toolbar checkbox or button keeps them)
  const d = e.code.match(/^(?:Digit|Numpad)(\d)$/)?.[1];
  const k = e.key;
  const step = e.shiftKey ? 5 : 15;
  const act =
    d === '1'
      ? () => goView('side')
      : d === '2'
        ? () => goView('top')
        : d === '3'
          ? () => goView('front')
          : d === '4'
            ? () => $('camM').querySelector('[data-c="3d"]').click()
            : d === '5'
              ? () => $('camP').click()
              : d === '0'
                ? () => setCam(SIDE, true)
                : k === 'f' || k === 'F'
                  ? frameSel
                  : /^Arrow/.test(k) && e.altKey
                    ? () => {
                        view.ox += { ArrowLeft: 40, ArrowRight: -40 }[k] ?? 0;
                        view.oy += { ArrowUp: 40, ArrowDown: -40 }[k] ?? 0;
                        viewMoved();
                      }
                    : /^Arrow/.test(k)
                      ? () =>
                          orbitBy(
                            { ArrowLeft: step, ArrowRight: -step }[k] ?? 0,
                            { ArrowUp: -step, ArrowDown: step }[k] ?? 0,
                          )
                      : k === '+' || k === '=' || k === '-'
                        ? () => zoomAt([cv.clientWidth / 2, cv.clientHeight / 2], k === '-' ? 1 / 1.25 : 1.25)
                        : null;
  if (!act || (e.altKey && !/^Arrow/.test(k))) return;
  e.preventDefault();
  if (/^Arrow/.test(k) && !e.altKey) centrePivot();
  act();
  draw();
});
/** Zoom by f about screen point [x, y]. */
function zoomAt([x, y], f) {
  view.ox = x - (x - view.ox) * f;
  view.oy = y - (y - view.oy) * f;
  view.s *= f;
  viewMoved();
}
/** F: fit the view to the selected optics (pinned popups, the row being edited), or to everything when none is selected;
 *  the pivot goes to its middle, so orbiting turns about it. */
function frameSel() {
  const sel = [...selected()].filter(i => S[i]);
  if (!sel.length) {
    view = null;
    return;
  }
  const P = sel.flatMap(i => [...S[i].prof, ...rim3(S[i]), S[i].P]);
  const o = view;
  fit(P, 0.35);
  if (o) {
    const n = view;
    view = o;
    cancelAnimationFrame(camAnim);
    const t0 = performance.now();
    const a = { ...o }; // glide there
    const go = now => {
      const t = Math.min(1, (now - t0) / 200);
      const e = t * t * (3 - 2 * t);
      for (const k of ['s', 'ox', 'oy']) view[k] = a[k] + (n[k] - a[k]) * e;
      view.c = n.c;
      view.D = n.D;
      viewMoved();
      if (t < 1) camAnim = requestAnimationFrame(go);
    };
    camAnim = requestAnimationFrame(go);
  }
}
$('viewM').onclick = e => {
  const v = e.target.dataset.v;
  if (v) {
    sys.view = v;
    update();
  }
};
$('focus').onclick = () => {
  // one-off: on-axis minimum-RMS focus for the last gap
  const i = S.length - 2;
  const r = sys.rows[i + 1];
  if (i < 0) return;
  const t = Optics.bestFocus(S, i, footprint(i, 0));
  if (!isFinite(t)) return;
  r.t = fmt(t);
  delete r.solve?.t;
  renderTable();
  update();
};
let noteAt = 0; // a refusal note stays up over the drag's own messages
const toast = (msg, note) => {
  if (!note && Date.now() - noteAt < 1500) return;
  if (note) noteAt = Date.now();
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t.timer);
  t.timer = setTimeout(() => (t.hidden = true), 3000);
};
$('json').oninput = e => {
  try {
    load(JSON.parse(e.target.value), true);
  } catch {}
};
