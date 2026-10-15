// help.js — help: the keys and mouse (H, File ▸ Keyboard shortcuts), or the features guide (File ▸ Features guide), one line
// per feature. One dialog, either view; a button switches to the other.
function helpDialog(view = 'keys') {
  const d = $('helpDlg');
  if (d.open && d.dataset.view === view) return d.close();
  d.dataset.view = view;
  const K = mac ? '⌘' : 'Ctrl+';
  const S = mac ? '⇧' : 'Shift+';
  const A = mac ? '⌥' : 'Alt+';
  const keys = [
    ['H', 'this help'],
    ['A', 'add a plane where the cursor is on the beam'],
    ['M', 'add a mirror there (Stigmatic: a flat; give it an R to curve it)'],
    ['drag an optic', 'move it: its parent slides, nothing upstream changes'],
    [`${S.replace('+', '')} drag`, 'move it along the axis only'],
    [`${A.replace('+', '')} drag`, 'tilt it about its pivot (3D views: turn it about the line of sight)'],
    ['W', 'show or hide the watch window'],
    [`C / ${S}C`, 'next / previous configuration (also ] and [)'],
    ['T', 'auto-hide the surface table, or keep it shown'],
    ['D', 'measure: drag between two points (they snap to optics and foci)'],
    [`${K},`, 'options'],
    ['drag a square', 'move a mirror’s image (Stigmatic)'],
    ['S', 'Stigmatic: foci follow their mirrors, or hold foci'],
    ['drag empty space', 'pan'],
    ['wheel', 'zoom'],
    ['double-click', 'fit the view'],
    ['1 / 2 / 3', 'x / y / z view: looking along that axis (press again: from the other side)'],
    ['4 / 5', '3D view / perspective on or off'],
    ['0', 'back to the x view, fitted'],
    ['right-, middle- or Space-drag', 'orbit the view'],
    ['← → ↑ ↓', `orbit 15° (${S.replace('+', '')}: 5°; ${A.replace('+', '')}: pan)`],
    ['+ / −', 'zoom'],
    ['F', 'frame the selected optic (or everything)'],
    ['click', 'pin a popup; drag its title to keep it open'],
    ['Esc', 'close a popup, cancel drawing, deselect'],
    ['Delete', 'delete the selected shape'],
    [`${S.replace('+', '')} (drawing)`, 'square, or 15° steps'],
    [`${K}Z / ${K}${S}Z`, 'undo / redo'],
    [`${K}S / ${K}${S}S`, 'save / save as'],
    [`${K}O`, 'open'],
    [`${K}E`, 'export a figure (PDF)'],
    ['Enter / Esc', 'table: commit / revert a value'],
    ['↑ ↓', 'table: nudge (Shift ×10)'],
    ['Tab', 'table: next value'],
  ];
  const feats = [
    [
      'Surface list',
      'conic surfaces placed along the traced axis ray; tilts steer it, with no coordinate breaks.',
    ],
    ['Solves', 'a value can focus the beam on the next surface or collimate it (click the value).'],
    [
      'Focus locks',
      'the Foci column pins a conic’s F1 or F2 to a point and chooses what may vary to hold it.',
    ],
    [
      'Off-axis ∠°',
      'in the off-axis cell’s popover, give it as the parent’s normal angle instead of a height: 90° puts the beam on an ellipsoid’s equator, and past 90° on its far half; any tilt works.',
    ],
    [
      'Stigmatic',
      'curved mirrors image perfectly: each keeps a focus on the beam coming in, and its image is where its other focus is. Beside it, choose what moving an optic does. Foci follow (the default): each image moves with its mirror (it keeps its place relative to where the beam hits it), so moving or tilting a mirror carries its image and focal plane along, and a paraboloid in a collimated beam can slide across it; the shape adjusts as needed. Holds foci: images stay where they are in the room and mirrors reshape (R, k, off-axis, tilt) to keep them; flats between a mirror and its image stay put too, the beam sliding across them. Drag a square to move an image. An edit that would spoil perfect imaging is refused.',
    ],
    [
      '3D',
      'look from any side (x, y, z, 3D; orbit with a right-drag or the arrow keys). In a 3D view an optic drags in the plane facing you and Alt-drag turns it about your line of sight; Tilt y and Clock in the table turn it out of the plane, and fields can be (x, y) pairs. The side view is the planar layout, unchanged.',
    ],
    [
      'Watch',
      'a small movable window of values you pick (+ adds, × removes): system values, an optic’s values, the beam leaving it, WFE maps, spots, footprints, extension values.',
    ],
    [
      'Popups',
      'Values, footprint, spot, WFE and extension tabs for any surface or any point on the beam; click an optic to pin its popup on its Values tab and edit them there.',
    ],
    [
      'Options',
      'File ▸ Options… sets how overlapping cones mix (screen, plain transparency, multiply, additive, lighten, darken, exclusion or solid) and their opacity, in 3D and optionally in the planar view; remembered in this browser.',
    ],
    [
      'Field key',
      'bottom left: each field’s colour (and a warning when rays are lost or locks can’t hold). Values such as EFL, WFE and spot size go in the watch window (W).',
    ],
    ['Rays, Cones', 'show the beam as rays or filled cones.'],
    [
      'Show',
      'off-axis optics’ whole parents; AOI labels (the chief ray’s angle of incidence on each optic); the watch window.',
    ],
    [
      'Trace',
      'the button showing the fields and wavelengths: fields, wavelengths, the Airy disk, and how many rays are traced.',
    ],
    [
      'Wavelengths',
      'list several (µm, the primary first) and give glasses an Abbe number (V column): spot diagrams show each wavelength in its colour, and the watch window has axial and lateral colour.',
    ],
    ['Examples', 'the Examples menu loads an example design into this tab.'],
    [
      'Desktop app',
      'python3 optic_app.py runs this page in a native window where Save writes back to the file on disk (pip install pywebview).',
    ],
    [
      'Tabs',
      'several designs open at once: + adds one, click to switch, × closes; each keeps its own view and undo, and all come back after a reload.',
    ],
    [
      'Images',
      'the Images box on a row marks where that plane (or the entrance pupil) is re-imaged through the system.',
    ],
    [
      'Selection',
      'a selected optic (pinned popup, or its row being edited) shows its whole parent, vertex (V) and foci (F1, F2; C for a sphere).',
    ],
    [
      'Shapes',
      'sketch dimensioned rectangles, circles and lines under the layout; drag a selected one’s round knob to rotate it.',
    ],
    [
      'Configurations',
      'several versions of one design (+ Configuration in the surface table’s bar). A value can differ in each configuration (a cell’s popover: marked with a bar), and the Configs column says which configurations have each surface, so one can have optics another lacks (they fork there). The eye draws other configurations faded; the Zemax export writes one .zmx per configuration, batoid and optiland the active one.',
    ],
    [
      'Surface table',
      'auto-hides into the bottom or right edge (T, or File ▸ Options) and opens while the mouse is over it.',
    ],
    ['Live', 'File ▸ Watch file redraws whenever a script rewrites the system file.'],
    [
      'Import and export',
      'Zemax .zmx in (y–z plane by default, as OpticStudio draws it, or x–z; optionally mirrored left–right or up–down) and out, batoid and optiland scripts, and vector PDF figures. File ▸ Copy link puts the whole design in a link that opens it in Sloptical Design.',
    ],
    [
      'Extensions',
      'Python scripts in the extensions folder (or loaded from anywhere) that add popup tabs or File ▸ Export formats, such as poppy_utils .toml (File ▸ Extensions…).',
    ],
  ];
  const esc = t => t.replace(/[&<]/g, c => (c === '&' ? '&amp;' : '&lt;'));
  const keysView = view === 'keys';
  $('helpH').textContent = keysView ? 'Keys and mouse' : 'Sloptical Design: features';
  $('helpKeys').hidden = !keysView;
  $('helpFeatBox').hidden = keysView;
  $('helpOther').textContent = keysView ? 'Features guide' : 'Keys and mouse';
  $('helpKeys').innerHTML = keys.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
  $('helpFeat').innerHTML = feats.map(([k, v]) => `<li><b>${esc(k)}:</b> ${esc(v)}</li>`).join('');
  if (!d.open) d.showModal();
}
$('helpOther').onclick = () => helpDialog($('helpDlg').dataset.view === 'keys' ? 'guide' : 'keys');
onDoc('keydown', e => {
  if (
    e.key.toLowerCase() !== 'h' ||
    e.ctrlKey ||
    e.metaKey ||
    e.altKey ||
    e.repeat ||
    e.target.closest?.('input, textarea, select')
  )
    return;
  if (e.target.closest?.('dialog') && !$('helpDlg').open) return;
  e.preventDefault();
  helpDialog();
});
