// trace.js — The sequential ray tracer: placing surfaces along the axis ray, and tracing rays through them.
//
// There are no coordinate breaks. The optical axis is the ray from the pupil centre at field 0,
// and each surface is placed a distance `t` along it:
//   • rows[0] is the entrance pupil (the stop): plane z=0, semi-diameter `ap`. Its `R` is the incoming beam's radius
//     of curvature there, signed like every beam ROC here (+ converging): 0 = collimated, fields are angles (deg);
//     R < 0 = diverging from a focus |R| before the pupil, R > 0 = converging to a focus R after it, and fields are
//     heights (mm) of that focus point. Either way the field's chief ray passes through the pupil centre.
//   • A surface's local +z is the incoming axis direction rotated by `tilt` (deg, CCW, about x), pivoting on the
//     axis hit point. With `pivot: {at, ref}` the surface is posed at tilt = ref about its hit point, then swung
//     rigidly by (tilt − ref) about `at`: 'coc' (its centre of curvature) or the row index of an upstream optic
//     (0 = pupil centre). Choosing a pivot therefore never moves the optic; later tilt changes swing it.
//     Tilts steer the axis ray, and every later surface follows it.
//   • `d` is the off-axis distance: the axis ray hits the parent conic at local height y=d.
//     So an OAP is simply {k:-1, d≠0}, and d=0 gives an on-axis surface. With `oa: 'angle'`, `d` is instead the angle (deg)
//     between the parent axis and the parent's normal where the axis ray lands (see atAngle): 90° puts the landing point
//     where the normal is ⊥ the parent axis (an ellipsoid's equator), and past 90° on the half beyond it, which no height
//     can reach. Such a segment is described from its own tangent plane rather than the parent's (see segPoint).
//   • Sag z = c r² / (1 + √(1 − (1+k) c² r²)), c = 1/R (R=0 ⇒ flat). R>0 puts the centre of curvature
//     downstream of the incoming light (Zemax convention while light travels +z).
//   • `n` is the index after a refracting surface. Mirrors keep the index. `ap` > 0 vignettes rays.
//   • A `paraxial` surface is an ideal thin lens of focal length `f` (in air; 0: no power), flat whatever its R: a ray's
//     slopes across it (its direction tangents, in the surface's frame) change as n′·tan′ = n·tan − h/f (h its height there),
//     as OpticStudio's Paraxial surface does, so a collimated beam at any angle focuses perfectly on the focal plane. The path
//     it adds keeps the wavefront of a collimated beam exactly spherical about that focus (OpticStudio's infinite-conjugate
//     OPD mode; exact for collimated light, the usual use).
//   • Foci are the parent conic's geometric foci (foci()); `lock` pins them to points by varying chosen values (holdFoci).
//   • In 3D (all optional, 0 by default, so a planar design is unchanged bit for bit): `tiltY` turns the surface's +z toward
//     +x after the tilt, and `clock` turns its +x toward +y about its own z after both (tilt, tiltY, clock: x, then y,
//     then z). A parent conic is symmetric about its axis, so `clock` is also the off-axis azimuth: the segment sits at
//     height d along the clocked +y. Each surface's incoming frame (x, y, the axis) is carried along the axis ray by the
//     smallest rotation that takes each axis into the next (about the surface's own x for a retro-reflection), so a
//     planar design keeps x = +x everywhere. Fields can be pairs [x, y]: angles with tan = u_x/u_z and u_y/u_z, or the
//     source point's x and y. Free lock points can be [x, y, z].
// Planar designs are traced in 3D too, so skew rays give real footprints and spots.

(function engineTrace(Optics) {
  if (typeof module !== 'object') (Optics.SOURCES ??= []).push(String(engineTrace)); // (extensions' worker rebuilds the engine from these)
  ('use strict');
  const {
    add,
    carry,
    cross,
    dot,
    frameRot,
    inFrame,
    rot,
    toL,
    toW,
    turn,
    unit,
    angleAt,
    atAngle,
    roots,
    sag,
  } = Optics;

  /** Whether a design uses the third dimension (a tiltY or clock, or a lock that varies one or pins a 3D point). */
  const is3D = rows =>
    rows.some(
      r =>
        r.tiltY ||
        r.clock ||
        ['tiltY', 'clock'].some(k => r.lock?.vary?.includes(k)) ||
        [r.lock?.f1, r.lock?.f2].some(t => t?.p?.length === 3),
    );

  /** Trace ray {p,u,n,L} through surface s. Returns {p,u,n,L,loc:[x,y],ci} or null. L is optical path length; loc is
   *  the hit point relative to the segment centre (across the parent's axis, or with oa 'angle' along its tangent plane);
   *  ci is the cosine of the angle of incidence. A line can meet the parent twice: the meeting counts where the ray crosses
   *  it the way the axis ray does at the segment centre (from the same side, s.side), so a segment may sit anywhere on the
   *  parent and be met from any direction (tilts through 90° and beyond). Without a side, the meeting nearer the centre.
   *  back: the light is on its way back (a double pass; see traceBack): it enters a refracting surface from the far side,
   *  into the index before it, and meets a mirror from the same side as before. */
  function hit(s, { p, u, n, L: opl = 0 }, back = false) {
    const P = toL(s, add(p, s.V, -1));
    const D = toL(s, u);
    const { c } = s;
    const K = 1 + s.k;
    const M = [0, s.d, s.zM];
    const ts = roots(c, K, P, D, back && !s.mirror ? -s.side : s.side);
    const far = τ => (isFinite(s.zM) ? Math.hypot(...add(add(P, D, τ), M, -1)) : Math.abs(τ));
    if (!ts.length) return null;
    const τ = ts.reduce((a, b) => (far(b) < far(a) ? b : a));
    const L = add(P, D, τ);
    const loc = s.seg ? [L[0], (L[1] - s.d) * s.tg[1] + (L[2] - s.zM) * s.tg[2]] : [L[0], L[1] - s.d];
    if ((s.ap > 0 && Math.hypot(...loc) > s.ap) || !isFinite(L[2])) return null;
    if (s.para) return lens(s, L, D, n, opl + n * τ, loc, back);
    let N = unit([c * L[0], c * L[1], c * K * L[2] - 1]);
    let cos = -dot(D, N);
    if (cos < 0) {
      N = N.map(v => -v);
      cos = -cos;
    } // normal faces the incoming ray
    const n2 = s.mirror ? n : back ? s.nIn : s.n;
    const mu = n / n2;
    const g = 1 - mu * mu * (1 - cos * cos);
    if (g < 0) return null; // TIR
    const D2 = s.mirror
      ? add(D, N, 2 * cos)
      : add(
          D.map(v => mu * v),
          N,
          mu * cos - Math.sqrt(g),
        );
    return { p: add(s.V, toW(s, L)), u: unit(toW(s, D2)), n: n2, L: opl + n * τ, loc, ci: cos }; // (kept a unit vector: round-off would otherwise grow from one surface's frame to the next)
  }

  /** An ideal thin lens (a paraxial surface) at local point L, ray direction D (local), index n before and s.n after (on the
   *  way back, s.nIn), path `opl` so far. Slopes: n′·t′ = n·t − h/f per transverse axis, which images every point perfectly
   *  (OpticStudio's Paraxial surface). Path: what makes that imaging perfect in phase too, for the conjugates the beam
   *  actually has (found along the axis when the system is built: s.zo, the incoming beam's focus, ±∞ for collimated, as
   *  OpticStudio's OPD mode 0 does). The object point is where this ray's line reaches that focus's plane (a point source's
   *  rays all agree on it), its image the lens's conjugate; the ray gets the path that makes its total from one to the other
   *  equal the ray's through the centre. With the object or the image at infinity, a plane wave across the lens stands for
   *  it. Exact for a point source or a collimated beam; a good approximation for an aberrated one. */
  function lens(s, L, D, n, opl, loc, back) {
    const n2 = (back ? s.nIn : s.n) || n;
    const g = Math.sign(D[2]) || 1; // light along −z: mirror the frame so it travels +z
    const z = Math.abs(D[2]);
    const a = D[0] / z;
    const b = D[1] / z;
    const f = s.f || 0;
    const [ta, tb] = f ? [(n * a - L[0] / f) / n2, (n * b - L[1] / f) / n2] : [(n * a) / n2, (n * b) / n2];
    const m = Math.hypot(ta, tb, 1);
    const D2 = [ta / m, tb / m, g / m];
    let dL = 0;
    if (f) {
      const x = [L[0], L[1], 0];
      const d = [D[0], D[1], z];
      const d2 = [D2[0], D2[1], 1 / m];
      const zo = back ? s.zoBack : s.zo;
      const far = v => !(Math.abs(v) < 1e7 * Math.max(1, Math.abs(f)));
      const len = v => Math.hypot(...v);
      const gain = P => (2 * dot(P, x) - dot(x, x)) / (len(P) + len(add(P, x, -1))); // |P| − |P − x|, without cancelling
      let I = null;
      let inT;
      if (zo === undefined || far(zo)) {
        inT = -n * dot(x, d); // a plane wave in
        I = [f * n * a, f * n * b, f * n2];
      } else {
        const O = add(x, d, zo / z); // the object: on this ray's line, in the focus's plane
        const σo = zo < 0 ? 1 : -1; // (a real object before the lens; else the beam converges on a virtual one)
        inT = σo * n * gain(O);
        const zi = n2 / (n / zo + 1 / f);
        if (!far(zi)) {
          const mag = (n * zi) / (n2 * zo);
          I = [mag * O[0], mag * O[1], zi];
        }
      }
      const outT = I ? (I[2] > 0 ? 1 : -1) * n2 * gain(I) : n2 * dot(x, d2); // (an image at infinity: a plane wave out)
      dL = inT + outT;
    }
    return { p: add(s.V, toW(s, L)), u: toW(s, D2), n: n2, L: opl + dL, loc, ci: z };
  }
  /** Where the beam arriving at paraxial surface i focuses, along its incoming axis from where the axis ray meets it (mm;
   *  − before it), from a ray just off the axis: on the way out, or (back) on the way back from the last surface. */
  function conjugate(S, i, back) {
    const h = (S.ap || 1) * 1e-4;
    let r = start(0, h, 0, S.beam);
    const path = back ? [...S.keys(), ...[...S.keys()].slice(0, -1).reverse()] : [...S.keys()];
    const stop = back ? S.length + (S.length - 2 - i) : i;
    for (let k = 0; k < stop; k++) {
      const j = path[k];
      if (!(r = hit(S[j], r, k >= S.length))) return Infinity;
    }
    const s = S[i];
    const u = back ? s.uOut.map(v => -v) : s.uIn; // (back: along the light as it returns, the axis reversed)
    const w = add(r.p, s.P, -1);
    const c = cross(u, r.u);
    const den = dot(c, c);
    if (den < 1e-24) return Infinity; // parallel: collimated
    return dot(cross(w, r.u), c) / den;
  }

  /** Place surfaces along the axis ray. rows = [pupil, ...surfaces]. Returns surfaces with frames, the axis hit P
   *  and the outgoing axis direction uOut. Untilted, the surface meets the axis ray `t` along it at local height d.
   *  Tilting about the hit point keeps that; a swing about a remote pivot moves the surface, and P is wherever the
   *  axis ray then lands (so the beam can walk across the parent conic). */
  function build(rows) {
    let ray = { p: [0, 0, 0], u: [0, 0, 1], n: 1 };
    let t = rows[0].t;
    let fx = [1, 0, 0];
    let fy = [0, 1, 0]; // the incoming frame: fx, fy and the axis
    const S = Object.assign([], { beam: rows[0].R || 0, ap: rows[0].ap || 1 }); // incoming beam ROC (for trace()) and pupil size
    for (const r of rows.slice(1)) {
      const P = add(ray.p, ray.u, t);
      const ey0 = [0, ray.u[2], -ray.u[1]];
      const para = r.type === 'paraxial';
      const c = r.R && !para ? 1 / r.R : 0; // (a paraxial lens is flat)
      const pv = r.pivot;
      const ref = pv ? pv.ref : r.tilt;
      const seg = r.oa === 'angle';
      const [yM, zM] = seg ? (c ? atAngle(c, r.k, r.d) : [0, 0]) : [r.d, sag(c, r.k, r.d * r.d)]; // the segment centre, local
      const at = pv?.at;
      const three = r.tiltY || r.clock || fx[0] !== 1 || fx[1] !== 0 || fx[2] !== 0;
      let s;
      if (!three) {
        // planar: exactly as it always was
        const V0 = add(add(P, ey0, -yM), ray.u, -zM);
        const Vb = add(P, rot(add(V0, P, -1), ref));
        const ezb = rot(ray.u, ref); // pose at `ref`
        const O =
          at === 'coc' && c ? add(Vb, ezb, 1 / c) : Number.isInteger(at) ? (at ? S[at - 1].P : [0, 0, 0]) : P;
        const ez = rot(ray.u, r.tilt);
        s = {
          ...r,
          c,
          mirror: r.type === 'mirror',
          ez,
          ey: [0, ez[2], -ez[1]],
          V: add(O, rot(add(Vb, O, -1), r.tilt - ref)),
          pivotAt: O,
          nIn: ray.n,
        };
      } else {
        // 3D: the frame turned by tilt, tiltY, clock; a swing turns about the incoming x
        const F = a => {
          const R = frameRot(a, r.tiltY || 0, r.clock || 0);
          return [0, 1, 2].map(j => inFrame(fx, fy, ray.u, [R[0][j], R[1][j], R[2][j]]));
        };
        const [xb, yb, zb] = F(ref);
        const Vb = add(P, inFrame(xb, yb, zb, [0, yM, zM]), -1);
        const O =
          at === 'coc' && c ? add(Vb, zb, 1 / c) : Number.isInteger(at) ? (at ? S[at - 1].P : [0, 0, 0]) : P;
        const [ex, ey, ez] = F(r.tilt);
        s = {
          ...r,
          c,
          mirror: r.type === 'mirror',
          ex,
          ey,
          ez,
          V: add(O, turn(add(Vb, O, -1), fx, (-(r.tilt - ref) * Math.PI) / 180)),
          pivotAt: O,
          nIn: ray.n,
        };
      }
      Object.assign(s, { d: yM, zM, th: angleAt(c, r.k, yM, zM), seg, uIn: ray.u, exIn: fx, eyIn: fy });
      if (para) Object.assign(s, { para, f: r.f || 0, n: r.n || ray.n });
      const Du = toL(s, ray.u);
      s.side = Math.sign(c * (yM * Du[1] + (1 + r.k) * zM * Du[2]) - Du[2]) || 0; // how the axis ray crosses the parent: sign of ∇F·u/2 at the centre
      if (seg) {
        // the segment's own frame: its tangent (toward increasing angle) and the normal pointing behind it
        const g = unit([0, 1 - c * (1 + r.k) * zM, c * yM]);
        const w = [0, -g[2], g[1]];
        const b = dot(w, toL(s, ray.u)) < 0 ? w.map(v => -v) : w;
        Object.assign(s, { tg: g, nb: b });
      }
      const h = hit(s, ray);
      const u0 = ray.u;
      ray = h || { ...ray, p: P };
      t = r.t;
      [fx, fy] = carry(fx, fy, u0, ray.u, s.ex ?? [1, 0, 0]);
      S.push(
        Object.assign(s, {
          P: ray.p,
          uOut: ray.u,
          nOut: ray.n,
          exOut: fx,
          eyOut: fy,
          aoi: h ? (Math.acos(Math.min(1, h.ci)) * 180) / Math.PI : NaN,
        }),
      );
    }
    S.dp = !!(rows.at(-1)?.dp && S.at(-1)?.mirror && S.length > 1); // a double pass: the light comes back off the last mirror
    S.forEach((s, i) => s.para && (s.zo = conjugate(S, i))); // (the paraxial lenses' conjugates, in order: each sees those before it)
    if (S.dp) for (let i = S.length - 2; i >= 0; i--) if (S[i].para) S[i].zoBack = conjugate(S, i, true); // (back: last first)
    return S;
  }

  /** Ray leaving pupil point (px,py) for field f of an incoming beam with ROC R at the pupil (see the header). Collimated:
   *  direction = field angle, L from the plane wavefront through the origin. From/to a focus: toward or away from the
   *  focus point [0, f, R], L = its distance from that point (negative while converging), so wavefronts are spheres. */
  function start(px, py, f, R = 0) {
    const p = [px, py, 0];
    const [fx, fy] = Array.isArray(f) ? f : [0, f]; // a field pair [x, y], or a number for y
    if (!R) {
      const u = fx
        ? unit([Math.tan((fx * Math.PI) / 180), Math.tan((fy * Math.PI) / 180), 1])
        : rot([0, 0, 1], fy);
      return { p, u, n: 1, L: dot(p, u) };
    }
    const q = add([fx, fy, R], p, -1);
    const m = Math.hypot(...q);
    const σ = Math.sign(R);
    return { p, u: q.map(v => (σ * v) / m), n: 1, L: -σ * m };
  }

  /** Trace one ray from the pupil through the first n surfaces (all by default). Returns the ray state after each surface
   *  (stops early if lost). R: incoming beam ROC, default the system's. */
  function trace(S, px, py, field, n = S.length, R = S.beam) {
    const out = [];
    let r = start(px, py, field, R);
    for (let i = 0; i < n; i++) {
      if (!(r = hit(S[i], r))) break;
      out.push(r);
    }
    return out;
  }

  /** A double pass: ray r (the state leaving the last surface, a mirror, on its way back) traced back through the surfaces
   *  before it, last to first, and on to the pupil plane (z = 0, where it started). Returns the state after each surface
   *  it meets on the way back (S[n−2], …, S[0]), then on the pupil plane (stops early if lost). The optics aren't copied:
   *  the same surfaces, met from the other side (hit's back). */
  function traceBack(S, r, from = S.length - 1) {
    const out = [];
    for (let i = from - 1; i >= 0; i--) {
      if (!(r = hit(S[i], r, true))) return out;
      out.push(r);
    }
    if (!(Math.abs(r.u[2]) > 1e-12)) return out;
    const t = -r.p[2] / r.u[2];
    const p = add(r.p, r.u, t);
    out.push({ p, u: r.u, n: r.n, L: r.L + r.n * t, loc: [p[0], p[1]], ci: Math.abs(r.u[2]) });
    return out;
  }
  /** Ray from pupil point (px, py), field f, there and back in a double-pass system (S.dp): the states after each surface
   *  on the way out, then (when it reaches the last) after each on the way back and on the pupil plane. */
  const traceDP = (S, px, py, f) => {
    const out = trace(S, px, py, f);
    return S.dp && out.length === S.length ? [...out, ...traceBack(S, out.at(-1))] : out;
  };

  /** Pupil samples: meridional fan (n rays) or square grid clipped to the pupil circle (n×n). */
  const fan = (a, n) => Array.from({ length: n }, (_, i) => [0, n > 1 ? a * ((2 * i) / (n - 1) - 1) : 0]);

  const grid = (a, n) =>
    fan(a, n)
      .flatMap(([, x]) => fan(a, n).map(([, y]) => [x, y]))
      .filter(([x, y]) => x * x + y * y <= a * a * (1 + 1e-9));

  /** Pupil-grid bundle for field f: per ray, [start, ...state after each surface]. */
  const bundle = (S, a, n, f) => grid(a, n).map(([x, y]) => [start(x, y, f, S.beam), ...trace(S, x, y, f)]);

  /** Fields as typed: numbers (y) and (x, y) pairs, e.g. "0, 0.5, (0.3, -0.2)"; a pair with x = 0 is just its y. null if malformed. */
  function parseFields(t) {
    const out = [];
    const re = /\(\s*([^(),\s]+)\s*[,\s]\s*([^(),\s]+)\s*\)|([^(),\s]+)/g;
    let m;
    let rest = t;
    while ((m = re.exec(t))) {
      rest = rest.replace(m[0], '');
      const v = m[3] !== undefined ? +m[3] : [+m[1], +m[2]];
      if (![v].flat().every(isFinite)) return null;
      out.push(Array.isArray(v) && !v[0] ? v[1] : v);
    }
    return /^[\s,]*$/.test(rest) && out.length ? out : null;
  }

  const fieldText = f => (Array.isArray(f) ? `(${f[0]}, ${f[1]})` : String(f));

  Object.assign(Optics, {
    is3D,
    hit,
    build,
    start,
    trace,
    traceBack,
    traceDP,
    fan,
    grid,
    bundle,
    parseFields,
    fieldText,
  });
  if (typeof module === 'object') module.exports = Optics;
})(typeof module === 'object' ? require('./conic.js') : globalThis.Optics);
