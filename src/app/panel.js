// panel.js — the surface panel: docked at the bottom or the side (resizable), or in its own window.
$('stig').checked = pref('optic_stig') !== 'off';
setTimeout(() => showWatch(pref('optic_watch') === 'on')); // (after the first layout)
$('stig').onchange = e => {
  pref('optic_stig', e.target.checked ? 'on' : 'off');
  if (!e.target.checked) return toast('Stigmatic off (existing locks stay)');
  commit();
  const n = stigmatize();
  update();
  toast(n ? `Stigmatic: ${n} mirror${n > 1 ? 's' : ''} locked to image perfectly` : 'Stigmatic on');
};
function dock(mode) {
  if (mode === 'window') return popOut();
  if (tw) {
    const w = tw;
    tw = null;
    $('split').after(document.adoptNode(w.document.getElementById('panel')));
    w.close();
    document.body.classList.remove('popped');
  }
  document.body.classList.toggle('side', mode === 'side');
  pref('optic_dock', mode);
  $('panel').style.setProperty(
    '--panelSize',
    pref('optic_dock_' + mode) || (mode === 'side' ? '44%' : '38%'),
  );
  markDock(mode);
  hideJog();
  autoHide();
  view = null;
  requestAnimationFrame(draw); // re-fit the view to its new size
}

/** Put the cursor in a table cell for typing: the table opens first if it is tucked away, and only the table scrolls to the
 *  cell (focus() alone would scroll the whole page to a cell in the tucked-away table, jolting the view). */
function editCell(el) {
  if (!el) return;
  const P = $('panel');
  if (document.body.classList.contains('autohide')) P.classList.add('open');
  el.focus({ preventScroll: true });
  el.select?.();
  const pr = P.getBoundingClientRect();
  const er = el.getBoundingClientRect();
  const head = P.querySelector('.panelBar').offsetHeight + (P.querySelector('thead')?.offsetHeight ?? 0);
  const top = er.top - pr.top;
  if (top < head) P.scrollTop += top - head - 4;
  else if (er.bottom - pr.top > P.clientHeight) P.scrollTop += er.bottom - pr.top - P.clientHeight + 8;
}

/** Auto-hide (File ▸ Options, on by default): the docked table tucks into the window's bottom or right edge, leaving a strip
 *  labelled Surfaces, and slides out over the view while the mouse is over it or something in it has the focus. */
function autoHide() {
  const on = opts.autoHide && !tw;
  const was = document.body.classList.contains('autohide');
  document.body.classList.toggle('autohide', on);
  if (!on) $('panel').classList.remove('open');
  $('peek').querySelector('.arrow').textContent = document.body.classList.contains('side') ? '◀' : '▲';
  if (was !== on) {
    view = null; // the view's size changes
    requestAnimationFrame(draw);
  }
}
{
  const P = $('panel');
  let t = 0;
  const busy = () => P.contains(P.ownerDocument.activeElement) && P.ownerDocument.activeElement !== P;
  const open = () => {
    clearTimeout(t);
    if (document.body.classList.contains('autohide')) P.classList.add('open');
  };
  const close = (wait = 350) => {
    clearTimeout(t);
    t = setTimeout(() => {
      if (!P.matches(':hover') && !busy()) {
        P.classList.remove('open');
        hideJog();
      }
    }, wait);
  };
  P.addEventListener('mouseenter', () => {
    clearTimeout(t);
    t = setTimeout(open, 80); // (passing over the strip on the way somewhere else doesn't open it)
  });
  P.addEventListener('mouseleave', () => close());
  P.addEventListener('focusin', open);
  $('peek').addEventListener('click', open); // (touch screens: tap the strip)
  P.addEventListener('focusout', () => close(150));
}
function popOut() {
  const w = window.open('', 'optic_sketch_surfaces', 'width=1000,height=480');
  if (!w) {
    toast('This viewer blocks new windows, so the list is docked at the side instead');
    return dock('side');
  }
  tw = w;
  const d = w.document;
  hideJog();
  d.open();
  d.write(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Surfaces · Optic Sketch</title>${[...document.querySelectorAll('link[rel=stylesheet], style')].map(e => (e.href ? `<link rel="stylesheet" href="${e.href}">` : e.outerHTML)).join('')}</head><body class="popwin"></body></html>`,
  );
  d.close();
  const th = document.documentElement.dataset.theme;
  if (th) d.documentElement.dataset.theme = th;
  d.body.append(d.adoptNode($('panel')));
  document.body.classList.add('popped');
  docL.forEach(([t, f]) => d.addEventListener(t, f));
  w.addEventListener('pagehide', () => {
    if (tw === w) dock(pref('optic_dock') === 'side' ? 'side' : 'bottom');
  });
  markDock('window');
  autoHide();
  view = null;
  requestAnimationFrame(draw);
}
const markDock = m =>
  $('panel')
    .querySelectorAll('[data-dock]')
    .forEach(b => b.setAttribute('aria-pressed', b.dataset.dock === m));
$('panel').querySelector('.panelBar').onclick = e => {
  const m = e.target.closest('[data-dock]')?.dataset.dock;
  if (m) dock(m);
};
addEventListener('pagehide', () => tw?.close());
{
  const sp = $('split');
  const size = px => {
    const side = document.body.classList.contains('side');
    const wk = $('work').getBoundingClientRect();
    const total = side ? wk.width : wk.height;
    const v = `${Math.round(Math.max(120, Math.min(total - 220, px)))}px`;
    $('panel').style.setProperty('--panelSize', v);
    pref('optic_dock_' + (side ? 'side' : 'bottom'), v);
  };
  sp.onpointerdown = e => {
    sp.setPointerCapture(e.pointerId);
    sp.classList.add('drag');
    sp.onpointermove = m => {
      const wk = $('work').getBoundingClientRect();
      size(document.body.classList.contains('side') ? wk.right - m.clientX : wk.bottom - m.clientY);
    };
    sp.onpointerup = () => {
      sp.onpointermove = null;
      sp.classList.remove('drag');
    };
  };
  sp.onkeydown = e => {
    const d = { ArrowUp: 20, ArrowLeft: 20, ArrowDown: -20, ArrowRight: -20 }[e.key];
    if (!d) return;
    e.preventDefault();
    const r = $('panel').getBoundingClientRect();
    size((document.body.classList.contains('side') ? r.width : r.height) + d);
  };
}
