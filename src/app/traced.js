// traced.js — what the drawing and popups derive from the traced layout: cone fans, cached per-layout rays, 3D slices,
// images of planes and angles of incidence.

/** Each field's cone: per ray of a dense meridional fan, its drawn points if it reaches the last surface (else null). */
const cones = () =>
  sys.fields.map(f =>
    Optics.fan(sys.rows[0].ap, Math.max(sys.rays, 61)).map(([x, y]) => {
      const r = Optics.trace(S, x, y, f);
      return r.length === S.length ? [...src(f), Optics.start(x, y, f, S.beam).p, ...r.map(q => q.p)] : null;
    }),
  );

/** 3D views (cached per layout): each field's fan across the meridian (in pupil x), drawn with the meridional fan; a ring
 *  of rays round the pupil's edge (and rings inside it) for the cones (as cones(): per ray its drawn points, or null if it doesn't reach the end);
 *  each surface's rim; and its slice across the view (the section through its axis facing the viewer, or across the
 *  middle when looking down its axis), which is what is drawn of it instead of its meridional profile. */
const perLayout = f => {
  const memo = new WeakMap(); // by layout (each configuration drawn has its own)
  return () => {
    if (!memo.has(S)) memo.set(S, f());
    return memo.get(S);
  };
};
const fanX = perLayout(() =>
  sys.fields.map(f =>
    Optics.fan(sys.rows[0].ap, sys.rays).map(([, y]) => [
      Optics.start(y, 0, f, S.beam),
      ...Optics.trace(S, y, 0, f),
    ]),
  ),
);
const ringC = perLayout(() => {
  const a = sys.rows[0].ap;
  const P = [
    [0, 0],
    ...[
      [1, 36],
      [0.75, 24],
      [0.5, 18],
      [0.25, 12],
    ].flatMap(([r, n]) =>
      [...Array(n).keys()].map(k => [
        r * a * Math.cos((2 * k * Math.PI) / n),
        r * a * Math.sin((2 * k * Math.PI) / n),
      ]),
    ),
  ]; // (inner rings too: what a clear aperture lets through)
  return sys.fields.map(f =>
    P.map(([x, y]) => {
      const r = Optics.trace(S, x, y, f);
      return r.length === S.length ? [...src(f), Optics.start(x, y, f, S.beam).p, ...r.map(q => q.p)] : null;
    }),
  );
});
const rim3 = s => (s.rim3 ??= Optics.rim(s, s.y0, s.y1));
/** The rays of field j's cone that can outline stretch k (rays: its drawn rays, nulls for lost ones): those on the hull of the
 *  beam's cross-section, seen down the beam, at any station. Found once per layout; drawing then hulls only these (a few dozen
 *  instead of every ray), whatever the view, since a view maps each (near-planar) cross-section's hull onto the drawn one. */
const edgeRaysOf = perLayout(() => new Map());
function edgeRays(j, k, rays) {
  const memo = edgeRaysOf();
  const key = j + '|' + k;
  if (memo.has(key)) return memo.get(key);
  const R = rays.map((r, n) => r && [r[k - 1], r[k], n]).filter(Boolean);
  const use = new Set();
  if (R.length) {
    const u = R.reduce((a, [p, q]) => a.map((v, m) => v + q[m] - p[m]), [0, 0, 0]);
    const F = Optics.axesAcross(u[0] ? u : [1e-12, u[1], u[2]]) ?? [
      [1, 0, 0],
      [0, 1, 0],
    ];
    for (let t = 0; t <= 1.0001; t += 1 / 32)
      View3D.hull(
        R.map(([p, q, n]) => {
          const x = p.map((v, m) => v + (q[m] - v) * t);
          return [Optics.dot(x, F[0]), Optics.dot(x, F[1]), n];
        }),
      ).forEach(h => use.add(h[2]));
  }
  memo.set(key, use);
  return use;
}
/** The local direction [x, y] across surface s of its section facing the viewer. */
function sliceDir(s) {
  const b = viewDir();
  const ex = s.ex ?? Optics.cross(s.ey, s.ez);
  const w0 = Optics.cross(s.ez, b);
  const w = Math.hypot(...w0) > 1e-3 ? w0 : F3(cam.u);
  const lx = Optics.dot(w, ex);
  const ly = Optics.dot(w, s.ey);
  const m = Math.hypot(lx, ly) || 1;
  return [lx / m, ly / m];
}
const slice3 = s => Optics.slice(s, s.y0, s.y1, (s.w3 = sliceDir(s)));
/** Drawn as solids, back to front: in every view but the x view, and in the x view too once the design leaves the plane
 *  (a planar design's x view is the 2D layout, drawn exactly as always). */
const look3 = () => !side || Optics.is3D(sys.rows) || sys.fields.some(Array.isArray);
/** A direction across axis direction u that shows on screen as a bar across the beam. */
const across = u => {
  if (side && !u[0]) return [0, u[2], -u[1]];
  const e = Optics.cross(u, viewDir());
  const m = Math.hypot(...e);
  return m > 1e-6 ? e.map(v => v / m) : Optics.cross(u, F3(cam.u));
};

/** The images of every plane whose Images box is ticked (Optics.conjugates; real, plus virtual ones in object and image space): per image its row, the point on the axis,
 *  the half-extent across it (the beam's half-width at the plane, times |m|) and the magnification. */
function images() {
  const a = sys.rows[0].ap;
  return sys.rows.flatMap((r, ri) =>
    !r.conj
      ? []
      : Optics.conjugates(S, ri - 1, a).map(c => {
          const A = AX[c.j];
          const p = A.p.map((v, k) => v + c.s * A.u[k]);
          const h0 = ri ? Math.max(probeHW(ri, 0), a / 20) : a;
          return { ...c, ri, p, e: [0, A.u[2], -A.u[1]], u: A.u, half: Math.abs(c.m) * h0 };
        }),
  );
}

/** The chief ray's angle of incidence (degrees) on each surface: for the first field (a), and the least and greatest over all
 *  fields (lo, hi). The chief ray of a field leaves the pupil centre (from the source point when the beam comes from a
 *  focus); for an on-axis first field it is the axis ray. null where it misses. */
function chiefAOI() {
  const per = sys.fields.map(f =>
    Optics.trace(S, 0, 0, f).map(r => {
      const a = (Math.acos(Math.min(1, r.ci)) * 180) / Math.PI;
      return a < 1e-4 ? 0 : a;
    }),
  ); // (round-off near normal reads as 0)
  return S.map((_, i) => {
    const v = per.map(a => a[i]).filter(Number.isFinite);
    if (!Number.isFinite(per[0][i])) return null;
    return { a: per[0][i], lo: Math.min(...v), hi: Math.max(...v) };
  });
}
/** An optic's AOI label: "AOI 12.3°", with the range over the fields when it spans more than 0.05°. */
const aoiText = q => `AOI ${nf(q.a)}°${q.hi - q.lo > 0.05 ? ` (${nf(q.lo)}–${nf(q.hi)}°)` : ''}`;

/** Where drawn rays begin: the focus point when the beam diverges from one, else the pupil. */
const src = f => (S.beam < 0 ? [[...(Array.isArray(f) ? f : [0, f]), S.beam]] : []); // (a field pair [x, y]: the source's x and y)

/** Grid-ray states on surface i for field index fi (rays that reach it). */
const footprint = (i, fi) => B[fi].filter(r => r.length > i + 1).map(r => r[i + 1]);
