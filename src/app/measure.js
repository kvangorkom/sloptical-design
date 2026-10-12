// measure.js — the measuring tool (the ruler button, or D): drag from one point to another for the distance between them
// (and, in the x view, the angle). The ends snap to the optics' hit points and vertices, their foci, the pupil centre and
// the shapes' corners; elsewhere a free end lies in the plane facing you through the other end. The measurement stays
// on screen until the tool is put away (Esc, D or the button again); it isn't part of the design.

let meas = null; // { a, b: world points, sa, sb: what each snapped to (or null) }

/** The snapping point under screen point [x, y] (within 9 px), as { p, what }, or null. */
function measureSnap(x, y) {
  const pts = [{ p: [0, 0, 0], what: 'pupil centre' }];
  S.forEach((s, i) => {
    pts.push({ p: s.P, what: `${label(i)} (hit point)` });
    if (s.c) pts.push({ p: s.V, what: `${label(i)} vertex` });
    if (s.c) Optics.foci(s).forEach((f, n) => f && pts.push({ p: f, what: `${label(i)} F${n + 1}` }));
  });
  for (const sh of sys.shapes ?? []) for (const p of SH.outline(sh)) pts.push({ p, what: 'shape' });
  let best = null;
  let bd = 9;
  for (const q of pts) {
    const [sx, sy] = X(q.p);
    const d = Math.hypot(sx - x, sy - y);
    if (d < bd) [best, bd] = [q, d];
  }
  return best;
}
/** The world point for pointer event e: a snap point, or the point on the plane facing the viewer through ref. */
const measurePoint = (e, ref) => {
  const s = measureSnap(e.offsetX, e.offsetY);
  return s ? [s.p, s.what] : [world(e, ref), null];
};

// The tool takes the pointer before the view's own handlers do (capture on the view's parent).
{
  const main = $('main');
  let dragging = false;
  main.addEventListener(
    'pointerdown',
    e => {
      if (tool !== 'measure' || e.target !== cv || e.button !== 0) return;
      e.stopPropagation();
      const [a, sa] = measurePoint(e);
      meas = { a, b: a, sa, sb: sa };
      dragging = true;
      cv.setPointerCapture(e.pointerId);
      draw();
    },
    true,
  );
  main.addEventListener(
    'pointermove',
    e => {
      if (tool !== 'measure' || e.target !== cv) return;
      e.stopPropagation();
      if (!dragging) {
        cv.style.cursor = measureSnap(e.offsetX, e.offsetY) ? 'cell' : 'crosshair';
        return;
      }
      [meas.b, meas.sb] = measurePoint(e, meas.a);
      redraw();
    },
    true,
  );
  main.addEventListener(
    'pointerup',
    e => {
      if (tool !== 'measure' || !dragging) return;
      e.stopPropagation();
      dragging = false;
    },
    true,
  );
}

/** Draw the measurement (screen overlay, pen g). */
function drawMeasure(g) {
  if (!meas || tool !== 'measure') return;
  const A = X(meas.a);
  const Bp = X(meas.b);
  const acc = tok('--accent');
  g.line([A, Bp], { color: acc, width: 1.5 });
  for (const [P, snapped] of [
    [A, meas.sa],
    [Bp, meas.sb],
  ])
    g.line(ring(P, snapped ? 4 : 2.5, 16).concat([ring(P, snapped ? 4 : 2.5, 16)[0]]), {
      color: acc,
      width: 1.5,
    });
  const D = meas.b.map((v, k) => v - meas.a[k]);
  const len = Math.hypot(...D);
  if (len < 1e-9) return;
  const mf = v => fmt(Math.abs(v) < 1e-9 ? 0 : v);
  const parts = [`${mf(len)} mm`];
  if (side) {
    const dz = fz * D[2];
    const dy = fy * D[1];
    parts.push(`Δz ${mf(dz)}`, `Δy ${mf(dy)}`, `${mf((Math.atan2(dy, dz) * 180) / Math.PI)}°`);
  } else parts.push(`Δx ${mf(D[0])}`, `Δy ${mf(D[1])}`, `Δz ${mf(D[2])}`);
  const t = parts.join('  ·  ');
  const font = tok('--ui');
  const w = g.width(t, 11, font);
  const mx = (A[0] + Bp[0]) / 2;
  const my = (A[1] + Bp[1]) / 2 - 10;
  g.fill(
    [
      [
        [mx - w / 2 - 5, my - 12],
        [mx + w / 2 + 5, my - 12],
        [mx + w / 2 + 5, my + 5],
        [mx - w / 2 - 5, my + 5],
      ],
    ],
    { color: tok('--panel'), alpha: 0.92 },
  );
  g.text(t, [mx, my], { size: 11, color: tok('--ink'), align: 'center', font });
}

// D: the measuring tool on or off
onDoc('keydown', e => {
  if (e.key.toLowerCase() !== 'd' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if (e.target.closest?.(TYPING + ', dialog')) return;
  e.preventDefault();
  setTool(tool === 'measure' ? null : 'measure');
});
