// presets.js — the example designs in the toolbar’s menu.

/** The design a first visit opens with. */
const DEFAULT_DESIGN = 'OAP + off-axis ellipsoid';
/** File ▸ New design (and a new tab): a blank page, nearly — one off-axis paraboloid focusing a collimated beam. */
const NEW_DESIGN = {
  fields: [0, 0.5, -0.5],
  rays: 7,
  grid: 21,
  rows: [
    { t: 200, ap: 25 },
    { name: 'Mirror', type: 'mirror', R: -400, k: -1, d: 50, t: 203.125, solve: { t: { type: 'focus' } } },
    { name: 'Image', plot: 'spot' },
  ],
};
const PRESETS = {
  // A three-mirror anastigmat with a 6 m primary, made the classic way from three plain conics on one shared axis: the radii
  // set the focal lengths with the Petzval sum zero (1/R1 − 1/R2 + 1/R3 = 0, a flat field), and the three conic constants
  // then cancel spherical aberration, coma and astigmatism together (third order: an ellipsoid, a hyperboloid and an
  // ellipsoid), polished on real rays. None images perfectly on its own; the aberrations cancel between them. It is used
  // off-axis in both aperture and field (the beam 4.5 m off the axis, the field 0.2° off it: the primary's tilt) so that
  // nothing blocks the light: the secondary sits clear of the incoming beam, the intermediate image falls behind the
  // primary, and the tertiary sends the light to a fold flat at the exit pupil, which turns it out of the plane to the
  // image (f/14, its plane tilted as an off-axis field's is). The fields shown span ±0.05° (±3′); try the 3D view (4).
  TMA: {
    fields: [0, 0.05, -0.05, [0.05, 0]],
    rays: 7,
    grid: 21,
    view: 'cones',
    rows: [
      { t: 11378.279, ap: 3000 },
      { name: 'Primary', type: 'mirror', R: -16000, k: -0.99183431, d: 4460.2824, tilt: 0.2, t: 7434.2266 },
      {
        name: 'Secondary',
        type: 'mirror',
        R: 2485.681,
        k: -1.5036643,
        d: -591.08731,
        tilt: -31.362909,
        t: 12296.32,
      },
      {
        name: 'Tertiary',
        type: 'mirror',
        R: -2921.0092,
        k: -0.70114734,
        d: -474.225,
        tilt: 4.9701468,
        t: 1650,
      },
      { name: 'Fold', type: 'mirror', tiltY: 45, t: 1660.7259, solve: { t: { type: 'focus' } } },
      { name: 'Image', tilt: 13.51, plot: 'spot' },
    ],
  },
  'Cassegrain f/20': {
    fields: [0, 0.1, -0.1],
    rays: 9,
    grid: 21,
    rows: [
      { t: 500, ap: 100 },
      { name: 'Primary', type: 'mirror', R: -2000, k: -1, t: 750 },
      {
        name: 'Secondary',
        type: 'mirror',
        R: 666.667,
        k: -2.77778,
        t: 1000,
        solve: { t: { type: 'focus' } },
      },
      { name: 'Focal plane' },
    ],
  },
  'OAP relay (Z)': {
    fields: [0, 0.5, -0.5],
    rays: 7,
    grid: 21,
    rows: [
      { t: 300, ap: 25 },
      { name: 'OAP 1', type: 'mirror', R: -1000, k: -1, d: 150, t: 511.25 },
      { name: 'Focus', t: 511.25, plot: 'spot' },
      {
        name: 'OAP 2',
        type: 'mirror',
        R: -1000,
        k: -1,
        d: 150,
        tilt: -17.0604,
        t: 400,
        solve: { tilt: { type: 'collim' } },
      },
      { name: 'Exit pupil', plot: 'footprint' },
    ],
  },
  'OAP + off-axis ellipsoid': {
    fields: [0, 0.2, -0.2],
    rays: 7,
    grid: 21,
    rows: [
      { t: 300, ap: 25 },
      {
        name: 'OAP',
        type: 'mirror',
        R: -1000,
        k: -1,
        d: 150,
        t: 511.25,
        solve: { t: { type: 'focus' } },
        lock: { f1: { at: 'pt', p: [-150, -188.75] }, f2: { at: 'inf' }, vary: ['R', 'd'] },
      },
      { name: 'Focus', t: 511.25 },
      {
        name: 'Ellipsoid',
        type: 'mirror',
        R: -610.10848,
        k: -0.069424633,
        oa: 'angle',
        d: 34.257883,
        tilt: -42.787518,
        t: 800,
        solve: { t: { type: 'focus' } },
        lock: { f1: { at: 'in' }, f2: { at: 'pt', p: [-299.96841, 122.5] }, vary: ['R', 'k', 'd', 'tilt'] },
      },
      { name: 'Image', plot: 'spot' },
    ],
  },
  'Ellipsoid at its equator': {
    fields: [0, 2, -2],
    rays: 9,
    grid: 21,
    rows: [
      { t: 250, ap: 20, R: -50 },
      {
        name: 'Ellipsoid',
        type: 'mirror',
        R: 150,
        k: -0.5,
        oa: 'angle',
        d: -90,
        tilt: 45,
        t: 300,
        lock: { f1: { at: 'src' }, f2: { at: 2 }, vary: ['R', 'k', 'd', 'tilt'] },
      },
      { name: 'Focus', plot: 'spot' },
    ],
  },
  'Fiber collimator': {
    fields: [0, 1, -1],
    rays: 9,
    grid: 21,
    rows: [
      { t: 10, ap: 10, R: -90 },
      { name: 'Lens', t: 6, n: 1.5168 },
      { R: -51.68, t: 60, solve: { R: { type: 'collim' } } },
      { name: 'Output' },
    ],
  },
  'Singlet f/5': {
    fields: [0, 5, -5],
    rays: 9,
    grid: 21,
    rows: [
      { t: 20, ap: 10 },
      { name: 'Lens', R: 100, t: 5, n: 1.5168 },
      { R: -100, t: 94.859, solve: { t: { type: 'focus' } } },
      { name: 'Image' },
    ],
  },
  // Two configurations (the panel's Configurations strip): the science beam focuses straight from the OAP; the wavefront
  // sensor configuration flips a pickoff mirror in, which only it has. The OAP's distance out differs between them.
  'Flip-in pickoff (2 configs)': {
    fields: [0, 0.2, -0.2],
    rays: 7,
    grid: 21,
    rows: [
      { R: 0, t: 300, ap: 25, id: 'r0' },
      { name: 'OAP', type: 'mirror', R: -1000, k: -1, d: 150, t: 511.25, id: 'r1' },
      { name: 'Focus', plot: 'spot', id: 'r2' },
    ],
    configs: {
      active: 0,
      show: ['c2'],
      list: [
        { id: 'c1', name: 'Science', set: { r1: { t: 511.25 } }, solved: {} },
        { id: 'c2', name: 'Wavefront sensor', set: { r1: { t: 250 } }, solved: {} },
      ],
      rows: [
        { R: 0, t: 300, ap: 25, id: 'r0' },
        { name: 'OAP', type: 'mirror', R: -1000, k: -1, d: 150, t: 511.25, id: 'r1' },
        { name: 'Pickoff', type: 'mirror', tilt: -45, t: 261.25, id: 'r3', only: ['c2'] },
        { name: 'Focus', plot: 'spot', id: 'r2' },
      ],
    },
  },
};
