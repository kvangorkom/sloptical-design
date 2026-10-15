// menu.js — the File menu and its keyboard shortcuts.

document
  .querySelectorAll('#fileMenu kbd[data-k]')
  .forEach(k => (k.textContent = (mac ? '⌘' : 'Ctrl+') + k.dataset.k.replace('⇧', mac ? '⇧' : 'Shift+')));
$('fileBtn').onclick = () => {
  const m = $('fileMenu');
  m.hidden = !m.hidden;
  $('fileBtn').setAttribute('aria-expanded', !m.hidden);
  if (!m.hidden) m.querySelector('button').focus();
};
$('fileMenu').onclick = e => {
  const f = e.target.closest('button')?.dataset.f;
  if (!f) return;
  $('fileMenu').hidden = true;
  if (f.startsWith('x:')) return exportDialog(f.slice(2));
  ({
    new: () => newDesign(),
    open: openSystem,
    save: () => save(false),
    saveas: () => save(true),
    link: copyLink,
    watch: toggleWatch,
    zmx: exportZmx,
    batoid: () => exportPy('batoid'),
    optiland: () => exportPy('optiland'),
    zin: () => $('zmxFile').click(),
    pdf: figureDialog,
    ext: extDialog,
    opts: optionsDialog,
    help: () => helpDialog('keys'),
    guide: () => helpDialog('guide'),
  })[f]();
};
$('fileMenu').onkeydown = e => {
  const b = [...$('fileMenu').querySelectorAll('button')];
  const i = b.indexOf(e.target);
  if (e.key === 'Escape') {
    $('fileMenu').hidden = true;
    $('fileBtn').focus();
  }
  if (/Arrow(Down|Up)/.test(e.key)) {
    e.preventDefault();
    b[(i + (e.key === 'ArrowDown' ? 1 : b.length - 1)) % b.length].focus();
  }
};
onDoc('keydown', e => {
  if (!(e.metaKey || e.ctrlKey)) return;
  const k = e.key.toLowerCase();
  if (k === 's') {
    e.preventDefault();
    save(e.shiftKey);
  } else if (k === 'o') {
    e.preventDefault();
    openSystem();
  } else if (k === 'e') {
    e.preventDefault();
    figureDialog();
  }
});
