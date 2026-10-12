// options.js — File ▸ Options.

// ── Options (File ▸ Options…): view settings kept in this browser for every design. Cones: how overlapping fields mix (a
// canvas blend mode inside a layer laid down at the opacity; 'normal' is plain transparency per field, 'solid' paints the
// first field on top), in 3D and, if chosen, in the planar x view too (which otherwise keeps plain transparency, 30 %).
const CONE_STYLES = {
  screen: ['Screen: mix like light (overlaps lighten)', 60],
  normal: ['Plain transparency (each field see-through)', 30],
  multiply: ['Multiply: mix like filters (overlaps darken)', 45],
  lighter: ['Additive (overlaps add up)', 50],
  lighten: ['Lighten (brightest of each colour)', 50],
  darken: ['Darken (darkest of each colour)', 40],
  exclusion: ['Exclusion', 50],
  solid: ['Solid: first field on top, no mixing', 40],
};
const OPT0 = { cone: 'screen', coneOp: 60, cone2d: false, autoHide: true }; // autoHide: the surface table (panel.js)
let opts = (() => {
  try {
    return { ...OPT0, ...JSON.parse(pref('optic_opts') || '{}') };
  } catch {
    return { ...OPT0 };
  }
})();
if (!CONE_STYLES[opts.cone]) opts.cone = OPT0.cone;
/** The cones' mixing: { blend (a canvas composite mode, or undefined), layer (painted solid into a layer laid down at alpha),
 *  alpha, top (the first field painted last) }. */
const coneMix = () => {
  const a = Math.max(0.05, Math.min(1, opts.coneOp / 100));
  const n = opts.cone;
  return n === 'normal'
    ? { layer: false, alpha: a }
    : { layer: true, alpha: a, blend: n === 'solid' ? undefined : n, top: n === 'solid' };
};
/** Change options (remembered in this browser) and redraw with them. */
function setOpts(o) {
  Object.assign(opts, o);
  pref('optic_opts', JSON.stringify(opts));
  if ($('optDlg').open) $('oAutoHide').checked = opts.autoHide;
  cone.key = null;
  autoHide();
  draw();
}
function optionsDialog() {
  const d = $('optDlg');
  const sync = () => {
    $('oCone').value = opts.cone;
    $('oConeOp').value = opts.coneOp;
    $('oConeOpV').textContent = opts.coneOp + ' %';
    $('oCone2d').checked = opts.cone2d;
    $('oAutoHide').checked = opts.autoHide;
    $('oConeNote').textContent =
      opts.cone === 'screen'
        ? 'Overlapping fields lighten like light: blue and orange give pink, all three tend to white.'
        : opts.cone === 'normal'
          ? 'Each field drawn see-through; the mix depends on drawing order.'
          : opts.cone === 'solid'
            ? 'Where fields overlap, only the first field shows.'
            : '';
  };
  $('oCone').innerHTML = Object.entries(CONE_STYLES)
    .map(([k, [t]]) => `<option value="${k}">${t}</option>`)
    .join('');
  const set = o => {
    setOpts(o);
    sync();
  };
  $('oCone').onchange = e => set({ cone: e.target.value, coneOp: CONE_STYLES[e.target.value][1] }); // each style starts at its own usual opacity
  $('oConeOp').oninput = e => set({ coneOp: +e.target.value });
  $('oCone2d').onchange = e => set({ cone2d: e.target.checked });
  $('oAutoHide').onchange = e => set({ autoHide: e.target.checked });
  $('oReset').onclick = () => set({ ...OPT0 });
  sync();
  d.showModal();
}

// ⌘, (Ctrl+, elsewhere) opens the options; T turns the surface table's auto-hide on or off
onDoc('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === ',' && !e.altKey) {
    e.preventDefault();
    if (!$('optDlg').open) optionsDialog();
    return;
  }
  if (e.key.toLowerCase() !== 't' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if (e.target.closest?.(TYPING + ', dialog')) return;
  e.preventDefault();
  setOpts({ autoHide: !opts.autoHide });
  toast(opts.autoHide ? 'Surface table: auto-hide on' : 'Surface table: always shown');
});
