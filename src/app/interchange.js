// interchange.js — import and export: Zemax .zmx in and out, and batoid / optiland scripts out.

/** Import a .zmx (text; Optics.fromZemax: a best-effort, absolute placement) as a new, unsaved system, and show what was
 *  read and what was dropped. plane: 'auto' (the default: the plane the system lies in, its y–z or x–z, else 3D), 'yz'
 *  (OpticStudio's Cross-Section plane), 'xz' or '3d'. The dialog's Plane menu and Keep dummy surfaces box import the same
 *  file again. */
let zin = null; // the last import: {txt, name}, for re-importing
function importZmx(txt, name, plane = 'auto', flip = {}) {
  let im;
  try {
    im = Optics.fromZemax(txt, { plane, keepDummies: $('zinDummy').checked });
  } catch (err) {
    return toast(`${name}: ${err.message ?? 'not a sequential Zemax file'}`);
  }
  plane = im.plane; // (auto: the plane the system lies in, else 3D)
  const again = $('zinDlg').open; // the Plane / flip controls re-import into the same tab
  zin = { txt, name };
  if (again) commit();
  else fresh();
  if (live.on && live.doc === doc.id) watch(false);
  const base = name.replace(/\.zmx$/i, '');
  const P = im.rows[0];
  load({
    fields: im.fields,
    lambda: im.lambda,
    ...(im.lambdas && { lambdas: im.lambdas }),
    rays: im.rays,
    grid: im.grid,
    rows: im.rows,
    ...(im.configs && { configs: im.configs }), // (every configuration in the file: the saved one shown)
    shapes: [],
    ...((flip.lr || flip.ud) && { flip: { lr: !!flip.lr, ud: !!flip.ud } }),
  });
  Object.assign(file, { name: base + '.json', handle: null, saved: null, path: null });
  if (!again) resetHist();
  update();
  const li = x => `<li>${x.replace(/[&<]/g, c => (c === '&' ? '&amp;' : '&lt;'))}</li>`;
  const other = plane === 'yz' ? 'xz' : 'yz';
  let hint = ''; // out of this plane but flat in the other: say so
  if (im.warnings.some(w => /out of the/.test(w)))
    try {
      if (!Optics.fromZemax(txt, { plane: other }).warnings.some(w => /out of the/.test(w)))
        hint = `<p><b>The system lies in the ${other[0]}–z plane:</b> choose ${other[0]}–z above.</p>`;
    } catch {}
  $('zinPlane').value = plane;
  $('zinLR').checked = !!flip.lr;
  $('zinUD').checked = !!flip.ud;
  $('zinBody').innerHTML =
    `<p>${im.rows.length - 1} surfaces${im.configs ? ` in the saved configuration, ${im.configs.list[im.configs.active].name} (of ${im.configs.list.length}: switch with the strip in the surface panel or [ and ])` : ''} from <b>${li(name).slice(4, -5)}</b>${im.name ? ` (${li(im.name).slice(4, -5)})` : ''}, placed at their absolute positions ${plane === '3d' ? 'in 3D' : `in the file's ${plane[0]}–z plane`}.</p>` +
    hint +
    `<p>The pupil is at the entrance pupil, ${nf(Math.abs(P.t))} mm ${P.t >= 0 ? 'before' : 'after'} the first surface, semi-diameter ${nf(P.ap)} mm; ` +
    `${P.R ? `the beam comes from the object point ${nf(-P.R)} mm before it` : 'the beam is collimated'}. Fields ${im.fields.map(fl).join(', ')}, λ ${(im.lambdas ?? [im.lambda]).join(', ')} µm.</p>` +
    `<p>Solves and apertures are not imported; glasses are modelled by their index and Abbe number at the d line.</p>` +
    (im.warnings.length ? `<p>Also note:</p><ul>${im.warnings.map(li).join('')}</ul>` : '');
  if (!$('zinDlg').open) $('zinDlg').showModal();
}
$('zmxFile').onchange = async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  importZmx(Optics.decodeText(new Uint8Array(await f.arrayBuffer())), f.name);
};
$('zinPlane').onchange = $('zinDummy').onchange = () =>
  zin &&
  importZmx(zin.txt, zin.name, $('zinPlane').value, { lr: $('zinLR').checked, ud: $('zinUD').checked });
/** Flip the imported layout's drawing (one undo step each); the view is fitted again. */
$('zinLR').onchange = $('zinUD').onchange = () => {
  commit();
  const lr = $('zinLR').checked;
  const ud = $('zinUD').checked;
  if (lr || ud) sys.flip = { lr, ud };
  else delete sys.flip;
  update();
  view = null;
  draw();
};

/** A Python script that rebuilds the system in batoid or optiland (Optics.toPython), downloaded and copied to the clipboard. */
/** A note for exports to other programs: the surfaces the beam meets at or past their parent's equator (Optics.pastEquator). */
function equatorNote(what) {
  const ix = Optics.pastEquator(
    S,
    B.flat().map(r => r.slice(1)),
  );
  return ix.length
    ? ` · ${ix.map(label).join(', ')}: beam past the equator, which ${what} can’t trace the same`
    : '';
}
/** The file name's stem, and (with configurations) the active configuration's letter and name after it. */
const cleanName = t => t.replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '');
const exportBase = () => cleanName(file.name.replace(/\.json$/, ''));
const exportStem = (ci = sys.configs?.active) =>
  sys.configs ? `${exportBase()}_${cfgLetter(ci)}_${cleanName(sys.configs.list[ci].name)}` : exportBase();
/** batoid and optiland take one configuration: the active one. */
function exportPy(lib) {
  let txt;
  try {
    txt = Optics.toPython(sys.rows, lib, {
      fields: sys.fields,
      lambda: sys.lambda,
      name: exportStem(),
    });
  } catch (e) {
    return toast(e.message);
  }
  const name = `${exportStem()}_${lib}.py`;
  download(name, new Blob([txt], { type: 'text/x-python' }));
  const note = equatorNote(lib);
  const which = sys.configs ? ` (configuration ${cfgLetter(sys.configs.active)}, the active one)` : '';
  navigator.clipboard?.writeText(txt).then(
    () => toast(`Exported ${name}${which} (also on the clipboard)${note}`),
    () => toast(`Exported ${name}${which}${note}`),
  );
}
/** One .zmx; with configurations, one .zmx with them all in OpticStudio's multi-configuration editor (the active one the
 *  saved configuration). Also on the clipboard. */
function exportZmx() {
  const opts = { fields: sys.fields, lambda: sys.lambda, lambdas: sys.lambdas };
  const note = equatorNote('OpticStudio');
  if (sys.configs) {
    const C = sys.configs;
    let out;
    try {
      out = Optics.zemaxConfigs(
        C.list.map((c, ci) => ({
          name: c.name,
          rows: ci === C.active ? sys.rows : Optics.solvedConfig(sys, ci),
        })),
        { ...opts, name: exportBase(), active: C.active },
      );
    } catch (e) {
      return toast(e.message);
    }
    const name = exportBase() + '.zmx';
    download(name, new Blob([out.text], { type: 'text/plain' }));
    navigator.clipboard?.writeText(out.text).catch(() => {});
    const warn = out.warnings.length ? ` (${out.warnings.join('; ')})` : '';
    return toast(
      `Exported ${name}: the ${C.list.length} configurations in its multi-configuration editor${warn}${note}`,
    );
  }
  const txt = Optics.zemax(sys.rows, { ...opts, name: exportStem() });
  download(file.name.replace(/\.json$/, '') + '.zmx', new Blob([txt], { type: 'text/plain' }));
  navigator.clipboard?.writeText(txt).then(
    () => toast(`Exported the .zmx (also on the clipboard)${note}`),
    () => toast(`Exported the .zmx${note}`),
  );
}
