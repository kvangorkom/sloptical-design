// presets.js — the example designs in the toolbar’s menu.

const PRESETS = {
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
  // An off-axis three-mirror anastigmat: a paraboloid primary, a convex hyperboloid secondary and a concave ellipsoid
  // tertiary, each locked to image perfectly (Stigmatic). The tertiary sends the image out of the plane (x = −300), so the
  // design is 3D: try the 3D view (4) and orbit.
  'Off-axis TMA (3D)': {
    fields: [0, 0.2, [0.2, 0]],
    rays: 7,
    grid: 21,
    rows: [
      { t: 400, ap: 30 },
      { name: 'Primary', type: 'mirror', R: -1600, k: -1, d: 200, t: 600 },
      {
        name: 'Secondary',
        type: 'mirror',
        R: 561.239664,
        k: -2.94974287,
        d: -62.6558609,
        tilt: -17.1486095,
        t: 1000,
        lock: { f1: { at: 'in' }, f2: { at: 'pt', p: [0, -250, 600] }, vary: ['R', 'k', 'd', 'tilt'] },
      },
      {
        name: 'Tertiary',
        type: 'mirror',
        R: -268.99507,
        k: -0.252622161,
        oa: 'angle',
        d: -39.0402597,
        tilt: 15.9886916,
        tiltY: 56.0151075,
        clock: -70.936982,
        t: 508.043228,
        solve: { t: { type: 'focus' } },
        lock: {
          f1: { at: 'in' },
          f2: { at: 'pt', p: [-300, -280, 400] },
          vary: ['R', 'k', 'd', 'tilt', 'tiltY', 'clock'],
        },
      },
      { name: 'Image', plot: 'spot' },
    ],
  },
};
