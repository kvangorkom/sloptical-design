// view.js — the view: mirroring, the camera (named views, orbit, perspective) and fitting the layout to the canvas.
// The view can be mirrored (sys.flip: {lr, ud}, set when importing from Zemax): fz, fy = −1 flip z (left–right) or y (up–down).
// Only the drawing mirrors; the design (tilts, off-axis heights, fields) is unchanged, so exports round-trip.
// The camera (cam): the x view is the planar layout (z right, y up), drawn exactly as always. The y and z views, their opposite
// sides and any orbit of them go through View3D.project (orthographic, or perspective about the pivot view.c), after the mirroring.
let fz = 1;
let fy = 1;
const SIDE = { ...View3D.VIEWS.side, name: 'side' };
let cam = SIDE;
let side = true; // side: the planar view (not orbited, orthographic)
const F3 = p => [p[0], fy * p[1], fz * p[2]]; // world ↔ mirrored (its own inverse)
const X = p =>
  side ? [view.ox + fz * p[2] * view.s, view.oy - fy * p[1] * view.s] : View3D.project(cam, view, F3(p)); // world → screen
const viewDir = () => F3(View3D.camBack(cam)); // world direction toward the viewer

/** Everything drawn, as world points (for fitting the view). */
const drawn = () => {
  const D = drawRange(viewSpan()); // (Show ▸ Surfaces: those drawn)
  const Sr = S.filter((_, i) => D.inR(i));
  return [
    ...sys.fields.flatMap((f, j) => T[j].flatMap(r => D.ray(f, r))),
    ...Sr.flatMap(s => s.prof),
    ...sys.shapes.flatMap(SH.outline),
    ...CJ.filter(D.conj).map(c => c.p),
    ...(look3() ? Sr.flatMap(s => rim3(s)) : []),
  ];
};
function fit(P = drawn(), k = 0.88, c = cam) {
  view = fitted(P, k, c);
}
/** The view that fits world points P (k of the canvas) as camera c sees them, with the pivot in their middle. */
function fitted(P, k, c) {
  const W = cv.clientWidth;
  const H = cv.clientHeight;
  const Q = P.map(F3);
  const lo = [0, 1, 2].map(i => Math.min(...Q.map(q => q[i])));
  const hi = [0, 1, 2].map(i => Math.max(...Q.map(q => q[i])));
  const m = lo.map((v, i) => (v + hi[i]) / 2);
  const D = 3 * Math.max(Math.hypot(...hi.map((v, i) => v - lo[i])), 1);
  if (c.name === 'side' && !c.persp) {
    const [z0, z1, y0, y1] = [2, 1].flatMap(k => [
      Math.min(...P.map(p => p[k])),
      Math.max(...P.map(p => p[k])),
    ]);
    const s = k * Math.min(W / (z1 - z0 || 1), H / (y1 - y0 || 1));
    return { s, ox: W / 2 - (fz * s * (z0 + z1)) / 2, oy: H / 2 + (fy * s * (y0 + y1)) / 2, c: m, D };
  }
  const v0 = { s: 1, ox: 0, oy: 0, c: m, D };
  const xy = Q.map(q => View3D.project(c, v0, q));
  const [x0, y0, x1, y1] = bbox(xy);
  const s = k * Math.min(W / (x1 - x0 || 1), H / (y1 - y0 || 1));
  return { s, ox: W / 2 - (s * (x0 + x1)) / 2, oy: H / 2 - (s * (y0 + y1)) / 2, c: m, D };
}
/** The world point under screen point e (an event, or [x, y]) on the plane through ref facing the viewer (default: the pivot).
 *  The x view keeps the planar mapping (x = 0; drags keep an optic's own x through their grab offset). */
function world(e, ref) {
  const x = e.offsetX ?? e[0];
  const y = e.offsetY ?? e[1];
  if (side) return [0, (fy * (view.oy - y)) / view.s, (fz * (x - view.ox)) / view.s];
  return F3(View3D.unproject(cam, view, [x, y], ref ? F3(ref) : view.c));
}

// ── Camera: named views (1 side, 2 top, 3 front; again for the opposite side), 4 a 3D view, 5 perspective, orbit by
// right-, middle- or Space-drag or the arrow keys, F frames the selected optic. Each change keeps the pivot where it is
// on the screen, and a change of view turns there smoothly. The planar x view is exactly the 2D layout.
const VIEW = {
  side: ['x view', 'looking along +x: z right, y up'],
  other: ['x view, reversed', 'looking along −x: z left, y up'],
  top: ['y view', 'looking along −y (from above): z right, x up'],
  bottom: ['y view, reversed', 'looking along +y (from below): z right, x down'],
  front: ['z view', 'looking along +z (down the beam): x left, y up'],
  back: ['z view, reversed', 'looking along −z (up the beam): x right, y up'],
};
const named = n => ({ name: n, ...View3D.VIEWS[n] });
const OPP = { side: 'other', other: 'side', top: 'bottom', bottom: 'top', front: 'back', back: 'front' };
let camAnim = 0;
/** Keep the pivot where it is on screen while the camera changes to c (and recentre the pivot on what is in the middle). */
function aim(c) {
  if (view) {
    view.c ??= View3D.unproject(
      cam,
      { ...view, c: [0, 0, 0], D: 1e9 },
      [cv.clientWidth / 2, cv.clientHeight / 2],
      [0, 0, 0],
    );
    const a = View3D.project(cam, view, view.c);
    const b = View3D.project(c, view, view.c);
    view.ox += a[0] - b[0];
    view.oy += a[1] - b[1];
  }
  const was = side;
  cam = c;
  side = c.name === 'side' && !c.persp;
  if (was !== side && !Optics.is3D(sys.rows)) renderTable(); // the 3D columns come and go with the view
  syncCam();
  viewMoved();
}
/** Recentre the pivot on the point in the middle of the view (at the pivot's depth), so orbiting turns about what is seen there. */
function centrePivot() {
  if (!view) return;
  const c0 = view.c ?? [0, 0, 0];
  const c = View3D.unproject(cam, view, [cv.clientWidth / 2, cv.clientHeight / 2], c0);
  const b = View3D.project(cam, { ...view, c }, c);
  view.c = c;
  view.ox += cv.clientWidth / 2 - b[0];
  view.oy += cv.clientHeight / 2 - b[1];
}
/** Go to camera c, turning there over 250 ms (at once if motion is reduced or no view yet). With fit, it also zooms and
 *  pans to fit the layout as c sees it (the named views); without, the pivot stays put on the screen. */
function setCam(c, fit) {
  cancelAnimationFrame(camAnim);
  if (!view) {
    aim(c);
    return draw();
  }
  const from = cam;
  const t0 = performance.now();
  const quick = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!fit) centrePivot();
  const tv = fit && fitted(drawn().concat(side ? S.flatMap(rim3) : []), 0.88, c); // (the rims too: they show from the new side)
  if (tv) {
    view.c = tv.c;
    view.D = tv.D;
  }
  const s0 = view.s;
  const p0 = View3D.project(cam, view, view.c);
  const p1 = tv && View3D.project(c, tv, tv.c);
  const at = e => {
    const k = e < 1 ? { ...View3D.lerpCam(from, c, e), name: null, persp: c.persp } : c;
    if (!tv) return aim(k);
    view.s = s0 + (tv.s - s0) * e;
    const q = View3D.project(k, { ...view, ox: 0, oy: 0 }, view.c); // the pivot glides to where the fit puts it
    view.ox = p0[0] + (p1[0] - p0[0]) * e - q[0];
    view.oy = p0[1] + (p1[1] - p0[1]) * e - q[1];
    aim(k);
  };
  const step = now => {
    const t = Math.min(1, (now - t0) / 250);
    at(t < 1 ? t * t * (3 - 2 * t) : 1);
    if (t < 1) camAnim = requestAnimationFrame(step);
  };
  if (quick) at(1);
  else camAnim = requestAnimationFrame(step);
}
const goView = n => {
  const m = cam.name === n ? OPP[n] : n;
  setCam({ ...named(m), persp: m !== 'side' && !!cam.persp }, true);
}; // fitted; the x view is the planar one
const orbitBy = (yaw, pitch) => {
  cancelAnimationFrame(camAnim);
  aim(View3D.orbit(cam, yaw, pitch));
};
/** The view's name and axes (top left of the view) and the toolbar's view buttons. */
function syncCam() {
  const v = VIEW[cam.name];
  const n =
    cam.name === 'other' ? 'side' : cam.name === 'bottom' ? 'top' : cam.name === 'back' ? 'front' : cam.name;
  $('camM')
    .querySelectorAll('button')
    .forEach(b => b.setAttribute('aria-pressed', b.dataset.c === n || (b.dataset.c === '3d' && !n)));
  $('camP').setAttribute('aria-pressed', !!cam.persp);
  $('camTag').textContent = side
    ? ''
    : `${v ? v[0] : '3D'}${cam.persp ? ' · perspective' : ''}${v ? ` · ${v[1]}` : ''}`;
}
