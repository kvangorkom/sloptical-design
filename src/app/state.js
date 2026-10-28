// state.js — the UI’s shared state and core loop: the open design (sys), what is traced from it, load() and update().
//
// The UI is a set of plain scripts loaded in order by index.html; they share their top-level names. All optics live in
// the engine (src/engine, the global Optics); the UI edits, draws and hit-tests. Lengths in mm.

/** A read-only page (File ▸ Export read-only page): the design and view it shows come in its own viewerData block, and
 *  nothing in it can change the system (viewer.js). */
const VIEWER = !!document.getElementById('viewerData') || /^#v=/.test(location.hash); // a read-only page or link (viewer.js)
let tw = null; // the surface list's own window, when popped out
const $ = id => document.getElementById(id) ?? tw?.document.getElementById(id);
const cv = $('cv');
const ctx = cv.getContext('2d');
const docL = [];
const onDoc = (type, fn) => {
  docL.push([type, fn]);
  document.addEventListener(type, fn);
}; // also bound in the pop-out
/** A setting kept in this browser: pref(k) reads it, pref(k, v) writes it (silently nothing where storage is blocked). */
const pref = (k, v) => {
  try {
    return v === undefined ? localStorage.getItem(k) : VIEWER ? undefined : localStorage.setItem(k, v); // (a read-only page leaves the app's settings be)
  } catch {}
};
const mac = /Mac|iP/.test(navigator.platform);
const DEF = { name: '', type: 'refract', R: 0, k: 0, d: 0, tilt: 0, t: 0, n: 1, ap: 0 };
const COLS = [
  // key, header, tooltip
  [
    'R',
    'R',
    'Radius of curvature (mm); ∞ = flat. R < 0: centre of curvature toward the incoming light. Pupil row: the incoming beam’s radius of curvature — ∞ collimated, −d diverging from a focus d before the pupil, +d converging to a focus d after it',
  ],
  ['k', 'k', 'Conic constant: 0 sphere, −1 parabola, < −1 hyperbola'],
  [
    'd',
    'Off-axis',
    'Where the axis ray meets the parent conic: its height (mm), or (∠, chosen in the cell’s popover) the angle (°) of the parent’s normal there to its axis, which reaches 90° and beyond',
  ],
  [
    'tilt',
    'Tilt °',
    'Rotation of the parent axis about the hit point, CCW-positive (3D: about x, turning +z toward +y, CCW in the x view)',
  ],
  ['t', 'Dist →', 'Distance (mm) along the axis ray to the next surface'],
  ['n', 'n', 'Refractive index after the surface'],
  ['ap', 'Semi-ap', 'Clear semi-aperture (mm); blank = unlimited'],
];
// In 3D (a design with them, or any view but the side one) two more columns follow Tilt: tiltY and clock (src/engine/trace.js header).
const COLS3 = [
  [
    'tiltY',
    'Tilt y °',
    'Rotation of the parent axis about y, after Tilt x: turning +z toward +x, CCW in the y view',
  ],
  [
    'clock',
    'Clock °',
    'Turn of the parent about its own axis, after both tilts: +x toward +y. It also sets which way the off-axis segment lies',
  ],
];
// With several wavelengths, a column for the glass's Abbe number follows n.
const ABBE = [
  'abbe',
  'Abbe V',
  'Abbe number of the glass after the surface (blank: no dispersion); n is its index at the primary wavelength (the first λ)',
];
const ALLCOLS = [...COLS, ...COLS3, ABBE];
const three = () => !side || Optics.is3D(sys.rows) || sys.fields.some(Array.isArray);
const TILTX = [
  'tilt',
  'Tilt x °',
  'Rotation of the parent axis about x, about the hit point: turning +z toward +y, CCW in the x view',
]; // (3D: Tilt is the tilt about x)
const cols = () => {
  const c = three() ? [...COLS.slice(0, 3), TILTX, ...COLS3, ...COLS.slice(4)] : [...COLS];
  if (sys.lambdas) c.splice(c.findIndex(x => x[0] === 'n') + 1, 0, ABBE);
  return c;
};
const noIndex = (k, r) =>
  ((k === 'n' || k === 'abbe') && r.type === 'mirror') || (k === 'k' && r.type === 'paraxial'); // (a mirror keeps the index; an ideal lens has no conic)
/** Surface types: refracting, mirror, and paraxial (an ideal thin lens of focal length f; see src/engine/trace.js). */
const TYPES = ['refract', 'mirror', 'paraxial', 'caliball'];
/** A row's type as the Type menu shows it: a caliball is a mirror with `ball`. */
const typeOf = r => (r.ball ? 'caliball' : r.type);
/** Change row r's type. A paraxial lens is flat, with no conic and no foci to pin; a surface becoming one starts as a
 *  100 mm lens (a mirror's focal length, if it was a curved mirror). A caliball is a precision sphere, a convex mirror of
 *  radius R (it starts as a 1″ ball, 12.7 mm), centred on the focus of the beam arriving (a solve on the distance before
 *  it, which can be taken off to decentre or defocus it), so it sends the light straight back: last, it makes the system
 *  a double pass. */
function setType(r, ty) {
  const was = typeOf(r);
  const ri = sys.rows.indexOf(r);
  if (was === 'caliball' && ty !== 'caliball') {
    delete r.ball;
    if (sys.rows[ri - 1]?.solve?.t?.type === 'centre') delete sys.rows[ri - 1].solve.t;
  }
  r.type = ty === 'caliball' ? 'mirror' : ty;
  if (ty === 'paraxial' && was !== 'paraxial') {
    r.f = r.f || (r.R && was === 'mirror' ? -r.R / 2 : 100);
    Object.assign(r, { R: 0, k: 0, d: 0 }); // (centred on the beam)
    delete r.oa;
    delete r.lock;
    if (r.solve) for (const k of ['R', 'k']) delete r.solve[k];
  } else if (was === 'paraxial' && ty !== 'paraxial') delete r.f;
  if (ty === 'caliball' && was !== 'caliball') {
    Object.assign(r, { ball: true, R: r.R > 0 && r.R < 1e3 ? r.R : 12.7, k: 0, d: 0, tilt: 0 });
    for (const k of ['oa', 'tiltY', 'clock', 'pivot', 'lock', 'solve']) delete r[k];
    if (ri === sys.rows.length - 1) r.dp = true;
    const pr = sys.rows[ri - 1];
    if (ri > 1) {
      pr.solve = { ...pr.solve, t: { type: 'centre' } };
      Optics.unvary(sys.rows, ri - 1, 't');
    }
  }
}
/** The value a column edits in row r: a paraxial (ideal) lens's R column is its focal length. */
const colKey = (k, r) => (k === 'R' && r?.type === 'paraxial' ? 'f' : k);
const FTIP = 'Focal length (mm) of the ideal (paraxial) lens: + converging, − diverging; ∞ = no power';
const SPAN = { R: 100, f: 100, k: 1, d: 10, tilt: 5, tiltY: 5, clock: 15, t: 50, n: 0.25, ap: 5, abbe: 20 }; // jog half-range when the value is 0 (else ±50 %)
const span = (k, v) => Math.abs(v) / 2 || SPAN[k];
const FIELD = ['#e8590c', '#1c7ed6', '#2f9e44', '#ae3ec9', '#f08c00', '#0c8599'];
const fc = i => FIELD[i % FIELD.length];
/** A wavelength's colour (µm): its hue across the visible, violet below it, dark red beyond it. */
function lamColor(l) {
  const nm = l * 1000;
  if (nm < 400) return '#7b2fbf';
  if (nm > 700) return '#8f1d1d';
  const stops = [
    [400, [123, 47, 191]],
    [450, [41, 98, 255]],
    [490, [0, 170, 200]],
    [530, [40, 170, 60]],
    [580, [215, 175, 0]],
    [620, [240, 110, 0]],
    [700, [200, 20, 20]],
  ];
  const k = stops.findIndex(s => s[0] >= nm);
  const [a, b] = k > 0 ? [stops[k - 1], stops[k]] : [stops[0], stops[0]];
  const t = b[0] === a[0] ? 0 : (nm - a[0]) / (b[0] - a[0]);
  return `rgb(${a[1].map((v, i) => Math.round(v + t * (b[1][i] - v))).join(',')})`;
}
const fmt = v => +(+v).toPrecision(6);
const nf = v =>
  v !== v
    ? '—'
    : !isFinite(v)
      ? '∞'
      : Math.abs(v) >= 1e5 || (v && Math.abs(v) < 1e-3)
        ? v.toExponential(2)
        : +v.toPrecision(4);
const show = (k, v = 0) =>
  (k === 'R' || k === 'f') && !v
    ? '∞'
    : (k === 'ap' || k === 'abbe') && !v
      ? ''
      : String(fmt(Math.abs(v) < 1e-12 ? 0 : v)); // solver round-off reads as 0
const parse = (k, s) => (
  (s = s.trim()),
  /^[+-]?(inf|∞)/i.test(s) || ((k === 'ap' || k === 'abbe') && !s) ? 0 : s && isFinite(+s) ? +s : null
);
const tok = k => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
const label = i => sys.rows[i + 1]?.name || 'S' + (i + 1);
/** Whether surface i is labelled in the layout and figures (a row's `nolabel` turns its label off: e.g. reference planes in
 *  a sequence of figures, where the optics' names matter). */
const labelled = i => !sys.rows[i + 1]?.nolabel;
/** Text made safe to put in HTML (names come from design files and links, which anyone can write). */
const escHTML = t => String(t).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const fl = f => (sys.rows[0].R ? `${fstr(f)} mm` : `${fstr(f)}°`); // a field value with its unit
const fstr = Optics.fieldText;
/** Set the incoming beam's ROC at the pupil (0 = collimated). Switching between collimated and a focus converts the fields
 *  (angle θ ↔ focus-point height h = R·tanθ) so every chief ray keeps its direction. */
function setBeam(R) {
  const P = sys.rows[0];
  const R0 = P.R || 0;
  const conv = f =>
    +(R ? R * Math.tan((f * Math.PI) / 180) : (Math.atan(f / R0) * 180) / Math.PI).toPrecision(12); // (a pair: each of x and y, as tan = x/z, y/z)
  if (!R0 !== !R) sys.fields = sys.fields.map(f => (Array.isArray(f) ? f.map(conv) : conv(f)));
  P.R = R;
  $('fields').value = sys.fields.map(fstr).join(', ');
}
const setVal = (r, k, v) =>
  r === sys.rows[0] && k === 'R'
    ? setBeam(v)
    : (k === 'tiltY' || k === 'clock' || k === 'abbe') && !v
      ? delete r[k]
      : (r[k] = v); // (no 3D keys at 0: planar designs stay as they were)
// S: surfaces; AX[j]: start point and direction of axis segment j (pupil → S1 is j = 0; segment j ends on S[j]);
// T / B: per field, ray-state arrays [start, ...after each surface] for the drawn fan / the N×N pupil grid; C: cone outlines.
let AOIc = []; // per surface: the chief rays' angles of incidence (chiefAOI)
let sys;
let S = [];
let AX = [];
let T = [];
let B = [];
let BW = []; // other wavelengths: [{ l (µm), S, B }] (see layout())
let C = [];
let CJ = [];
// A double pass (S.dp): the light back off the last mirror. AXB[k]: start and direction of return segment k (k = 0 leaves
// the last mirror; segment k ends on S[n−2−k], the last on the pupil plane, at AXB.end); TB / BB: per field, the return of
// each fan / grid ray, [state leaving the last mirror, ...after each surface on the way back, on the pupil plane], with its
// pupil point (.pp). Null without a double pass.
let AXB = null;
let TB = null;
let BB = null;
let fails = new Set();
let view = null;
let ghosts = []; // layouts of the other configurations drawn (faded)
let lk = null; // CJ: images of planes (images())   // lk: the open focus-lock popover {ri, anchor}
const at = (j, s) => AX[j].p.map((v, k) => v + s * AX[j].u[k]); // point s along axis segment j
const atB = (k, s) => AXB[k].p.map((v, m) => v + s * AXB[k].u[m]); // point s along return segment k
const segB = k => {
  const q = AXB[k + 1]?.p ?? AXB.end;
  return q ? AXB[k].u.reduce((a, u, m) => a + u * (q[m] - AXB[k].p[m]), 0) : 0;
}; // length of return segment k
const seg = j => AX[j].u.reduce((a, u, k) => a + u * (S[j].P[k] - AX[j].p[k]), 0); // length of axis segment j

function load(o, keepView) {
  if (sys) {
    hideLock();
    hideJog();
  }
  good = null; // popovers belong to the system being replaced (close them while it is still whole); a new baseline for the guard
  sys = {
    lambda: 0.55,
    airy: true,
    fields: [0],
    rays: 9,
    grid: 21,
    view: sys?.view ?? 'cones', // (beams as cones unless the design says rays)
    full: sys?.full ?? true,
    aoi: sys?.aoi ?? false,
    shapes: [],
    watch: [],
    ...structuredClone(o),
  };
  if (!keepView || !sys.shapes[shSel]) selectShape(null);
  const full = rows => rows.map((r, i) => (i ? { ...DEF, ...r } : { R: 0, ...r }));
  sys.rows = full(sys.rows); // view survives preset loads
  if (sys.configs) sys.configs.rows = full(sys.configs.rows); // (every configuration's rows complete too)
  sys.rows.forEach(r => {
    if (r.pivot !== undefined && typeof r.pivot !== 'object') r.pivot = { at: r.pivot, ref: 0 };
  }); // older saves
  $('fields').value = sys.fields.map(fstr).join(', ');
  $('rays').value = sys.rays;
  $('grid').value = sys.grid;
  $('lambda').value = (sys.lambdas ?? [sys.lambda]).join(', ');
  $('airy').checked = sys.airy;
  $('full').checked = sys.full;
  $('aoiT').checked = !!sys.aoi;
  if (!keepView) {
    view = null;
    docks.splice(0).forEach(p => p.el.remove());
    Object.assign(hov, { pinned: false, tgt: null });
    hov.el.hidden = true;
  }
  renderTable();
  update();
  if (!hist.lock) {
    const was = JSON.stringify(sys);
    const clean = was === (file.saved ?? file.base);
    if (matchStigMode()) {
      update();
      const json = JSON.stringify(sys); // the same design, its locks remade in this mode: not an edit
      if (clean) file[file.saved != null ? 'saved' : 'base'] = json;
      if (hist.cur === was) {
        clearTimeout(hist.t);
        hist.cur = json;
        record(json);
      }
    }
  }
}

/** Trace sys.rows: the surfaces S, axis segments AX, fans T, grids B (and each surface's drawn extent), cones C, chief-ray
 *  AOIs and images of planes. (layoutOf does this for other rows, such as another configuration's.) */
function layout() {
  const a = sys.rows[0].ap;
  const bundle = (pts, f) =>
    pts.map(([x, y]) => [Optics.start(x, y, f, S.beam), ...Optics.trace(S, x, y, f)]);
  S = Optics.build(sys.rows);
  AX = [{ p: [0, 0, 0], u: [0, 0, 1] }, ...S.map(s => ({ p: s.P, u: s.uOut }))];
  T = sys.fields.map(f => bundle(Optics.fan(a, sys.rays), f));
  B = sys.fields.map(f => bundle(Optics.grid(a, sys.grid), f));
  const d3 = Optics.is3D(sys.rows) || sys.fields.some(Array.isArray);
  const hits = i => [...T.flat(), ...fanX().flat()].filter(r => r[i + 1]).map(r => r[i + 1].loc);
  S.forEach((s, i) => {
    // drawn extent: the clear aperture, or (auto) the beam's own span, which can walk off the segment centre
    let ys = T.flat()
      .filter(r => r[i + 1])
      .map(r => r[i + 1].loc[1]);
    let lo = Math.min(...ys);
    let hi = Math.max(...ys);
    if (d3 && ys.length) {
      const L = hits(i);
      const c = (lo + hi) / 2;
      const r = Math.max(...L.map(q => Math.hypot(q[0], q[1] - c))); // 3D: a circle round the whole footprint,
      [lo, hi] = [c - r, c + r];
    } // which can lie across the meridian
    const m = Math.max(0.05 * (hi - lo), a / 20);
    [s.y0, s.y1] = s.ap ? [-s.ap, s.ap] : ys.length ? [lo - m, hi + m] : [-a / 20, a / 20];
    if (s.ball) [s.y0, s.y1] = [-0.999 / Math.abs(s.c), 0.999 / Math.abs(s.c)]; // (a caliball: the whole ball, whatever meets it)
    s.prof = Optics.profile(s, s.y0, s.y1);
  });
  // other wavelengths (when some glass disperses): the same optics, each traced with that wavelength's indices
  BW =
    sys.lambdas && Optics.dispersive(sys.rows)
      ? sys.lambdas.slice(1).map(l => {
          const Sl = Optics.atWavelength(S, sys.rows, l, sys.lambda);
          const bl = (pts, f) =>
            pts.map(([x, y]) => [Optics.start(x, y, f, S.beam), ...Optics.trace(Sl, x, y, f)]);
          return { l, S: Sl, B: sys.fields.map(f => bl(Optics.grid(a, sys.grid), f)) };
        })
      : [];
  C = sys.view === 'rays' ? [] : cones();
  AOIc = chiefAOI();
  CJ = images();
  returns();
}
/** The way back of a double pass (see AXB, TB, BB), or none. */
function returns() {
  AXB = TB = BB = null;
  if (!S.dp) return;
  const n = S.length;
  const back = rays =>
    rays
      .filter(r => r.length === n + 1)
      .map(r => Object.assign([r[n], ...Optics.traceBack(S, r[n])], { pp: r[0].p }));
  const ax = Optics.trace(S, 0, 0, 0);
  if (ax.length < n) return;
  const rb = [ax[n - 1], ...Optics.traceBack(S, ax[n - 1])];
  AXB = Object.assign(
    rb.slice(0, n).map(q => ({ p: q.p, u: q.u })),
    { end: rb.length > n ? rb[n].p : null },
  );
  TB = T.map(back);
  BB = B.map(back);
}
/** The globals layout() fills, for rows of another configuration: run fn with them in place (see layout()). */
function withLayout(L, fn) {
  const keep = { rows: sys.rows, S, AX, T, B, BW, C, CJ, AOIc, AXB, TB, BB };
  ({ rows: sys.rows, S, AX, T, B, BW = [], C, CJ, AOIc, AXB = null, TB = null, BB = null } = L);
  try {
    return fn();
  } finally {
    ({ rows: sys.rows, S, AX, T, B, BW, C, CJ, AOIc, AXB, TB, BB } = keep);
  }
}
const layoutOf = rows =>
  withLayout({ rows, S, AX, T, B, BW, C, CJ, AOIc }, () => {
    layout();
    return { rows: sys.rows, S, AX, T, B, BW, C, CJ, AOIc, AXB, TB, BB };
  });

let stigNote = ''; // shown after the update that refused an edit

/** Apply solves, rebuild layout, trace fans and grids, refresh status, popup, table, history and storage. */
function update() {
  fz = sys.flip?.lr ? -1 : 1;
  fy = sys.flip?.ud ? -1 : 1;
  if (!hist.lock) {
    const pre = sys.rows.map(ownVals);
    stig3D();
    fails = Optics.applySolves(sys.rows);
    guard(pre);
    if (sys.configs) {
      Optics.writeBack(sys); // the edit, into the configuration(s) it belongs to
      if (good) good.json = JSON.stringify(sys);
    }
  } // undo/redo restore a snapshot exactly, without re-solving
  else good = $('stig').checked ? snapGood() : null;
  const json = JSON.stringify(sys);
  record(json); // before rendering, so a drawing error can't lose an edit
  layout();
  cfgLayouts = null;
  ghosts = sys.configs ? shownConfigs().map(k => ({ ...layoutFor(k), k })) : []; // the other configurations shown (faded)
  $('fieldU').textContent = sys.rows[0].R ? 'Fields mm' : 'Fields °';
  syncTraceBtn();
  $('viewM')
    .querySelectorAll('button')
    .forEach(b => b.setAttribute('aria-pressed', b.dataset.v === sys.view));
  try {
    // the readouts; whatever happens there, the layout is drawn
    quickLook();
    if (!$('watch').hidden) {
      renderWatch();
      placeWatch();
    }
    pops().forEach(p =>
      (p.tgt?.i ?? p.tgt?.j) >= S.length || (p.tgt?.back && p.tgt.i === undefined && !AXB?.[p.tgt.j])
        ? closePop(p)
        : p.tgt && renderPop(p),
    ); // (a place on the way back closes when the double pass goes)
    syncCells();
    syncShapeBar();
    if ($('json').ownerDocument.activeElement !== $('json')) $('json').value = JSON.stringify(sys, null, 1);
    showName();
    saveDocs(json);
  } finally {
    draw();
  }
  if (stigNote) {
    toast(stigNote, true);
    stigNote = '';
  }
}

/** Bottom left of the view: a key to the fields' colours, and warnings (lost rays, locks that can't hold, solves that don't
 *  settle) when there are any. Values are in the watch window (W), which shows only what is asked for. */
function quickLook() {
  const lost = sys.fields
    .map((f, j) => [f, 1 - B[j].filter(r => r.length > S.length).length / B[j].length])
    .filter(([, l]) => l > 0)
    .map(([f, l]) => `${fl(f)}: ${Math.round(100 * l)}% of rays lost`);
  const solves = sys.rows.flatMap((r, ri) =>
    Object.keys(r.solve ?? {}).map(k => `${label(ri - 1)} ${ALLCOLS.find(c => c[0] === k)[1]}`),
  );
  solves.push(...sys.rows.flatMap((r, ri) => (r.lock?.f1 || r.lock?.f2 ? [`${label(ri - 1)} foci`] : [])));
  const held = [...fails]
    .filter(f => f.endsWith('lock'))
    .map(
      f =>
        `${label(parseInt(f) - 1)}: pinned foci can’t be held by varying ${(sys.rows[parseInt(f)].lock.vary ?? []).map(vname).join(', ') || 'nothing'}`,
    );
  const warn = [
    ...lost,
    ...held,
    ...(solves.length > 1 && fails.has('fight')
      ? [
          `${solves.length} solves and locks active (${solves.join(', ')}) don’t settle: they run in row order and fight`,
        ]
      : []),
  ];
  const esc = t => t.replace(/[&<]/g, c => (c === '&' ? '&amp;' : '&lt;'));
  const C = sys.configs;
  const cfgName = k => `<span><b style="color:${cfgHue(k)}">${cfgLetter(k)}</b>${esc(C.list[k].name)}</span>`;
  const cfgKey = C
    ? `<div class="key">${cfgName(C.active)}${shownConfigs().length ? `<span class="mute">faded:</span>${shownConfigs().map(cfgName).join('')}` : ''}</div>`
    : '';
  $('status').innerHTML =
    cfgKey +
    `<div class="key">${sys.fields.map((f, j) => `<span><i style="background:${fc(j)}"></i>${esc(fl(f))}</span>`).join('')}</div>` +
    (warn.length ? `<div class="warn">⚠ ${esc(warn.join(' · '))}</div>` : '');
}
