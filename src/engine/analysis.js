// analysis.js — Analysis of traced rays: spots, NA, wavefront fits, paraxial focus, EFL, conjugate images, stigmatic tests.

(function engineAnalysis(Optics) {
  if (typeof module !== 'object') (Optics.SOURCES ??= []).push(String(engineAnalysis)); // (extensions' worker rebuilds the engine from these)
  ('use strict');
  const { add, cross, dot, toL, unit, angleAt, foci, sag, bundle, start, trace } = Optics;

  /** Centroid and RMS radius of 2D points. */
  function spot(pts) {
    const m = pts.length;
    const cx = pts.reduce((s, p) => s + p[0], 0) / m;
    const cy = pts.reduce((s, p) => s + p[1], 0) / m;
    return { cx, cy, rms: Math.sqrt(pts.reduce((s, p) => s + (p[0] - cx) ** 2 + (p[1] - cy) ** 2, 0) / m) };
  }

  /** Numerical aperture of a ray bundle with directions `us` in index n: n·sin(largest angle to the mean direction).
   *  The Airy first-zero radius is then 0.61 λ / NA (= 1.22 λ F#). */
  const na = (us, n) => {
    const m = unit(us.reduce((a, u) => add(a, u), [0, 0, 0]));
    return n * Math.max(...us.map(u => Math.hypot(...add(u, m, -dot(u, m)))));
  };

  /** Ray states carried to the plane through Q ⊥ u: plane coords xy (x, and y along [0,u_z,−u_y]), point, direction, path. */
  const toPlane = (rs, Q, u, F = axesAcross(u)) =>
    rs.map(r => {
      const t = dot(add(Q, r.p, -1), u) / dot(r.u, u);
      const p = add(r.p, r.u, t);
      const q = add(p, Q, -1);
      return {
        xy: F ? [dot(q, F[0]), dot(q, F[1])] : [q[0], dot(q, [0, u[2], -u[1]])],
        p,
        u: r.u,
        n: r.n,
        L: r.L + r.n * t,
      };
    }); // F: the plane's [x, y] axes (3D)

  /** x and y axes across a direction u with an x component (null in the y–z plane, where they are +x and u turned +90° about x):
   *  y as near that as can be, x = y × u. (A beam along ±x gets y = +y.) */
  function axesAcross(u) {
    if (u[0] === 0) return null;
    const e = [0, u[2], -u[1]];
    const m = Math.hypot(...e);
    const ey = m > 1e-6 ? e.map(v => v / m) : unit(add([0, 1, 0], u, -u[1]));
    return [cross(ey, u), ey];
  }

  /** Least squares over rows [a, b]: x minimising Σ(a·x − b)², by normal equations (SPD, so no pivoting). */
  function lstsq(rows) {
    const m = rows[0][0].length;
    const M = Array.from({ length: m }, () => Array(m + 1).fill(0));
    for (const [a, b] of rows)
      for (let i = 0; i < m; i++) {
        for (let j = 0; j < m; j++) M[i][j] += a[i] * a[j];
        M[i][m] += a[i] * b;
      }
    for (let i = 0; i < m; i++)
      for (let r = 0; r < m; r++)
        if (r !== i) {
          const f = M[r][i] / M[i][i];
          for (let c = i; c <= m; c++) M[r][c] -= f * M[i][c];
        }
    return M.map((row, i) => row[m] / row[i]);
  }

  /** Wavefront of a bundle at the plane through Q ⊥ u: the sphere best fitted to it (the radius R, > 0 converging, centre R
   *  downstream of Q) and each ray's residual OPD. The fit is made far from any focus: on a plane moved back (virtually, along
   *  the rays extended) until it is 100 radii from the sphere's centre. Near a focus the wavefront is small and sharply curved,
   *  and its error there, taken across the fitted sphere, is not yet the OPD each ray carries (it settles as the radius grows;
   *  checked against batoid and optiland, tests/xcheck). */
  function wavefront(rs, Q, u) {
    const w = fitWave(rs, Q, u);
    const k =
      Math.sqrt(toPlane(rs, Q, u).reduce((a, r) => a + r.xy[0] ** 2 + r.xy[1] ** 2, 0) / rs.length) || 1;
    if (!(Math.abs(w.R) < 1e6 * k)) return w; // collimated: nothing to move away from
    const D = 99 * Math.abs(w.R);
    const sg = Math.sign(w.R);
    const w2 = fitWave(rs, add(Q, u, -sg * D), u);
    return { R: w2.R - sg * D, opd: w2.opd };
  }

  /** Wavefront of a bundle at the plane through Q ⊥ u. Each ray is moved along itself to the mean optical path, giving
   *  points on one wavefront; these are fitted with piston + tilt + exact sphere. Returns the sphere radius R (> 0:
   *  converging, centre R downstream of Q) and each ray's residual OPD. Evaluate away from a focus, where the fit degenerates. */
  function fitWave(rs, Q, u) {
    const pl = toPlane(rs, Q, u);
    const L0 = pl.reduce((a, r) => a + r.L, 0) / pl.length;
    const F = axesAcross(u);
    const ey = F ? F[1] : [0, u[2], -u[1]];
    const W = pl.map(r => {
      const q = add(add(r.p, r.u, (L0 - r.L) / r.n), Q, -1);
      return [F ? dot(q, F[0]) : q[0], dot(q, ey), dot(q, u)];
    });
    const k = Math.sqrt(W.reduce((a, w) => a + w[0] * w[0] + w[1] * w[1], 0) / W.length) || 1; // scale for conditioning
    let cv = 0;
    let opd;
    let h0;
    let x0 = 0;
    let y0 = 0;
    // Fit h − (sphere − parabola) = a + bx + cy + e·r², then cv = 2e. The parabola's apex is free (the tilt terms move it), and
    // the sphere's correction is taken about that apex: an off-axis field's wavefront is a sphere about its own image point, and
    // measured about the axis instead it would leave a false coma.
    for (let it = 0; it < 8; it++) {
      const g = W.map(([x, y, h]) => {
        const r2 = x * x + y * y;
        const q2 = (x - x0) ** 2 + (y - y0) ** 2;
        return [[1, x / k, y / k, r2 / (k * k)], h - (sag(cv, 0, q2) - (cv * q2) / 2)];
      });
      const c = lstsq(g);
      const e = c[3] / (k * k);
      cv = 2 * e;
      if (e) {
        const ax = -c[1] / k / (2 * e);
        const ay = -c[2] / k / (2 * e);
        if (Math.hypot(ax, ay) < 1e3 * k) [x0, y0] = [ax, ay];
      }
      h0 = c[0] - e * (x0 * x0 + y0 * y0);
    }
    // Then the exact best-fit sphere (Gauss–Newton from there, on apex height h0, apex x0, y0 and curvature cv): each ray's
    // error is taken along itself (n·cos to the axis: the wavefront's normal, which leans off axis for an oblique beam), and
    // the sum of their squares made least. The parabola-based start alone falls short for fast beams (NA ≳ 0.3).
    const wt = pl.map(r => r.n * dot(r.u, u));
    const res = ([a, x1, y1, c1]) =>
      W.map(([x, y, h], i) => wt[i] * (h - a - sag(c1, 0, (x - x1) ** 2 + (y - y1) ** 2)));
    let p = [h0, x0, y0, cv];
    let f = res(p);
    let ss = f.reduce((a, v) => a + v * v, 0);
    for (let it = 0; it < 20 && cv; it++) {
      const J = W.map(([x, y], i) => {
        const dx = x - p[1];
        const dy = y - p[2];
        const r2 = dx * dx + dy * dy;
        const S = Math.sqrt(Math.max(1e-300, 1 - p[3] * p[3] * r2));
        const ds = p[3] / (2 * S);
        return [
          -wt[i],
          -wt[i] * ds * (-2 * dx),
          -wt[i] * ds * (-2 * dy),
          -wt[i] * (r2 / (1 + S) + (p[3] * p[3] * r2 * r2) / (S * (1 + S) ** 2)),
        ];
      });
      const sc = [1, k, k, 1 / (k * k)];
      const step = lstsq(J.map((row, i) => [row.map((v, m) => v * sc[m]), -f[i]])).map((v, m) => v * sc[m]); // (scaled columns)
      let t = 1;
      let q;
      let fq;
      let sq;
      do {
        q = p.map((v, m) => v + t * step[m]);
        fq = res(q);
        sq = fq.reduce((a, v) => a + v * v, 0);
        t /= 2;
      } while (!(sq <= ss) && t > 1e-4);
      if (!(sq <= ss)) break;
      const done = ss - sq <= 1e-14 * ss;
      [p, f, ss] = [q, fq, sq];
      if (done) break;
    }
    [h0, x0, y0, cv] = p;
    opd = f;
    return { R: 1 / cv + h0, opd }; // radius from the plane (the fitted apex sits h0 downstream of Q)
  }

  /** Meridional paraxial curvature 1/R (> 0 converging) of the on-axis beam leaving surface j, from a ray at pupil height h. */
  function curv(S, j, h) {
    const s = S[j];
    const r = s && trace(S, 0, h, 0, j + 1)[j];
    if (!r) return NaN;
    const [q] = toPlane([r], s.P, s.uOut);
    const u = s.uOut;
    if (u[0] === 0 && r.u[0] === 0 && r.p[0] === 0)
      return -dot(r.u, [0, u[2], -u[1]]) / dot(r.u, u) / q.xy[1]; // planar
    const t = tangent(S, j, h);
    return t ? -dot(t[1], t[0]) / dot(t[0], t[0]) : NaN;
  }

  /** 3D: the near-axis ray leaving surface j in the tangential plane (that of the last fold up to j: the plane of its incoming
   *  and outgoing axes; the pupil's y without one), as its offset from the axis and its transverse slope per unit along the
   *  axis. A combination of the pupil-x and pupil-y rays, which is exact to first order. Null when lost. */
  function tangent(S, j, h) {
    const s = S[j];
    const u = s.uOut;
    const one = (px, py) => {
      const r = trace(S, px, py, 0, j + 1)[j];
      if (!r) return null;
      const [q] = toPlane([r], s.P, u);
      return [
        add(q.p, s.P, -1),
        add(
          r.u.map(v => v / dot(r.u, u)),
          u,
          -1,
        ),
      ];
    };
    let n = null;
    for (let k = j; k >= 0 && !n; k--) {
      const c = cross(S[k].uIn, S[k].uOut);
      if (Math.hypot(...c) > 1e-9) n = unit(c);
    }
    const Y = one(0, h);
    if (!Y || !n) return Y;
    const X = one(h, 0);
    if (!X) return Y;
    const a = dot(Y[0], n);
    const b = -dot(X[0], n);
    return Math.hypot(a, b) < 1e-12 * h
      ? Y
      : [0, 1].map(m =>
          add(
            X[m].map(v => v * a),
            Y[m],
            b,
          ),
        );
  }

  /** Direction of a vector in the y–z plane, degrees CCW from +z. */
  const angle = u => (Math.atan2(u[1], u[2]) * 180) / Math.PI;

  /** Secant-method root of f from x0 (first step dx). Returns NaN if it does not converge. */
  function secant(f, x0, dx, tol = 1e-11) {
    let x1 = x0 + dx;
    let f0 = f(x0);
    let f1;
    if (Math.abs(f0) < tol) return x0;
    for (let i = 0; i < 60 && isFinite(x1); i++) {
      if (!isFinite((f1 = f(x1)))) return NaN;
      if (Math.abs(f1) < tol) return x1;
      [x0, f0, x1] = [x1, f1, x1 - (f1 * (x1 - x0)) / (f1 - f0)];
    }
    return NaN;
  }

  /** Wavefront of a pupil-grid bundle ([start, ...states] per ray) in axis segment j (0 = object space; default: the last,
   *  arriving at the final surface), fitted where the beam is widest in that segment (s0 = 0 or its length).
   *  Returns wavefront() plus s0, the pupil coordinates pp of the rays used, and the fraction kept; null if < 5 rays. */
  function wavefrontIn(S, bundle, j = S.length - 1) {
    const A = j ? S[j - 1].P : [0, 0, 0];
    const u = j ? S[j - 1].uOut : [0, 0, 1];
    const l = dot(add(S[j].P, A, -1), u);
    const sel = bundle.filter(r => r.length > j + 1);
    const rs = sel.map(r => r[j]);
    if (rs.length < 5) return null;
    const spread = s => spot(toPlane(rs, add(A, u, s), u).map(q => q.xy)).rms;
    const s0 = spread(0) >= spread(l) ? 0 : l;
    return {
      ...wavefront(rs, add(A, u, s0), u),
      s0,
      pp: sel.map(r => r[0].p),
      kept: rs.length / bundle.length,
    };
  }

  /** The focus of the beam arriving at surface i (0-based): where its paraxial on-axis beam converges or seems to diverge from,
   *  on the incoming axis; null when it is collimated. For a stigmatic upstream this is exact (one ray at any height crosses it). */
  function inFocus(S, i) {
    if (!i) return S.beam ? [0, 0, S.beam] : null;
    const s = S[i - 1];
    const h = S.ap * 1e-4;
    const r = trace(S, 0, h, 0, i)[i - 1]; // a near-axis ray, where it crosses the axis (as curv, inverted:
    if (!r) return null; // finite with the focus on the surface itself, as on a focal plane)
    const u = s.uOut;
    const [q] = toPlane([r], s.P, u);
    const planar = u[0] === 0 && r.u[0] === 0 && r.p[0] === 0;
    const t = planar ? null : tangent(S, i - 1, h);
    if (!planar && !t) return null;
    const z = planar
      ? -q.xy[1] / (dot(r.u, [0, u[2], -u[1]]) / dot(r.u, u))
      : -dot(t[0], t[1]) / dot(t[1], t[1]);
    return isFinite(z) && Math.abs(z) < 1e6 * S.ap ? add(s.P, u, z) : null; // (farther: collimated)
  }

  /** Whether curved mirror i (0-based) images perfectly (null when it isn't a curved mirror): one of its foci sits on the focus of
   *  the beam arriving at it (it then images that point on its other focus, at infinity for a paraboloid), or, in a collimated
   *  beam, it is a paraboloid whose axis is parallel to the beam. Geometry only; locks don't matter. */
  function stigmatic(S, i, tol = 1e-7) {
    const s = S[i];
    if (!s?.mirror || !s.c) return null;
    const fin = inFocus(S, i);
    if (fin) {
      const L = Math.hypot(...add(fin, s.P, -1)) + Math.abs(1 / s.c);
      return foci(s).some(f => f && Math.hypot(...add(f, fin, -1)) < tol * L);
    }
    const u = i ? S[i - 1].uOut : [0, 0, 1];
    return Math.abs(s.k + 1) < 1e-9 && Math.abs(Math.abs(dot(s.ez, u)) - 1) < 1e-12;
  }

  /** Distance from surface j's axis hit to the plane (⊥ axis) of minimum RMS spot for rays in state list `rs`.
   *  Each ray's transverse offset is linear in distance s: e + s·f, so the least-squares minimum is closed form. */
  function bestFocus(S, j, rs) {
    const { P, uOut: u } = S[j];
    const ef = rs.map(({ p, u: v }) => {
      const q = add(p, P, -1);
      const w = dot(q, u);
      const g = dot(v, u);
      const f = add(v, u, -g).map(x => x / g);
      return [add(add(q, u, -w), f, -w), f];
    });
    const mean = i => [0, 1, 2].map(k => ef.reduce((s, r) => s + r[i][k], 0) / ef.length);
    const E = mean(0);
    const F = mean(1);
    let num = 0;
    let den = 0;
    for (const [e, f] of ef) {
      const de = add(e, E, -1);
      const df = add(f, F, -1);
      num += dot(de, df);
      den += dot(df, df);
    }
    return -num / den;
  }

  /** Effective focal length from a near-axis collimated ray at height h: EFL = h / tan(output angle to the axis ray).
   *  A system property, so it ignores the incoming beam. */
  function efl(S, h) {
    const rs = trace(S, 0, h, 0, S.length, 0);
    const v = rs.at(-1)?.u;
    const u = S.at(-1).uOut;
    if (rs.length < S.length) return NaN;
    const g = dot(v, u);
    return (h * g) / Math.hypot(...add(v, u, -g));
  }

  /** The surfaces (0-based) that rays meet at or past their parent's equator (where its normal is ⊥ its axis, |angle| ≥ 90°):
   *  beyond what a sag z(r) describes, and so beyond a Standard surface in OpticStudio or a quadric in batoid or optiland.
   *  rays: state lists as trace returns them (state i after surface i). */
  function pastEquator(S, rays) {
    const out = new Set();
    for (const rs of rays)
      rs.forEach((r, i) => {
        const s = S[i];
        if (!s?.c || !(s.k > -1)) return;
        const L = toL(s, add(r.p, s.V, -1));
        if (Math.abs(angleAt(s.c, s.k, Math.hypot(L[0], L[1]), L[2])) >= 90 - 1e-6) out.add(i);
      });
    return [...out].sort((a, b) => a - b);
  }

  /** Real images (conjugates) of a plane through the whole system: the pupil (i = −1) or the plane across the axis at surface
   *  i (0-based). A paraxial ray leaving the plane's axis point is built from two traced rays (an axial ray and a small-field
   *  chief ray, as combinations stay rays paraxially); wherever it crosses the axis again, in any axis segment, is an image
   *  of the plane. Returns [{ j, s, m }]: s along segment j (0: pupil → S1; k: after surface k−1; S.length: past the last
   *  surface), the lateral magnification m (unfolded sign convention: negative = inverted), and virtual. Real images are
   *  those inside a segment; virtual ones are listed only in object space (segment 0, as seen from the source: e.g. a stop's
   *  entrance pupil) and image space (past the last surface: e.g. the exit pupil). */
  function conjugates(S, i, a) {
    const h = 1e-4 * a;
    const ε = S.beam ? 1e-4 * Math.max(1, Math.abs(S.beam)) : 1e-3;
    const A = trace(S, 0, h, 0);
    const B = trace(S, 0, 0, ε);
    const sA = start(0, h, 0, S.beam);
    const sB = start(0, 0, ε, S.beam);
    const seg = j => ({ p: j ? S[j - 1].P : [0, 0, 0], u: j ? S[j - 1].uOut : [0, 0, 1] });
    const yt = (r, j) => {
      const { p, u } = seg(j);
      const [q] = toPlane([r], p, u);
      const ey = [0, u[2], -u[1]];
      return [q.xy[1], dot(r.u, ey) / dot(r.u, u)];
    };
    const at = j => {
      const ra = j ? A[j - 1] : sA;
      const rb = j ? B[j - 1] : sB;
      return ra && rb ? [yt(ra, j), yt(rb, j)] : null;
    };
    const src = at(i + 1);
    if (!src) return [];
    const [[ya0], [yb0]] = src;
    const out = [];
    const pts = [seg(i + 1).p];
    const same = (p, q) => Math.hypot(...add(p, q, -1)) < 1e-6 * Math.max(1, a, Math.hypot(...p));
    for (let j = 0; j <= S.length; j++) {
      const g = at(j);
      if (!g) break;
      const [[ya, ta], [yb, tb]] = g;
      const Y = yb0 * ya - ya0 * yb;
      const T = yb0 * ta - ya0 * tb; // the combination with no height at the plane
      if (!T) continue;
      const s = -Y / T;
      const L = j < S.length ? dot(add(S[j].P, seg(j).p, -1), seg(j).u) : Infinity;
      const real = s >= -1e-9 * (1 + Math.abs(L === Infinity ? s : L)) && s <= L * (1 + 1e-12); // inside this segment
      if ((!real && !(j === S.length || (j === 0 && i >= 0))) || !(Math.abs(s) < 1e6 * Math.max(1, a)))
        continue; // virtual: object or image space only; beyond 1e6 a: at infinity
      const near = 1e-5 * Math.max(1, a, isFinite(L) ? Math.abs(L) : Math.abs(s));
      if ((j === i + 1 && Math.abs(s) < near) || (j === i && Math.abs(s - L) < near)) continue; // the plane itself, either side of it
      // Each mirror crossed reverses this tool's transverse axis (ey = u × x); undo that so m has the usual unfolded sign.
      const flips = S.slice(Math.min(i + 1, j), Math.max(i + 1, j)).filter(q => q.mirror).length;
      const pt = add(seg(j).p, seg(j).u, s); // a virtual image only seen through plain planes is one already found
      if (!real && pts.some(q => same(pt, q))) continue;
      pts.push(pt);
      out.push({
        j,
        s,
        virtual: !real,
        m: (flips % 2 ? -1 : 1) * (Math.abs(ya0) > Math.abs(yb0) ? (ya + s * ta) / ya0 : (yb + s * tb) / yb0),
      });
    }
    return out;
  }

  // ── Wavelengths. A refracting row's n is its index at the primary wavelength λ0; an optional Abbe number (row.abbe, at
  // the d line: (n_d − 1)/(n_F − n_C)) sets how it changes with wavelength, by a two-term Cauchy law n = A + B/λ². Rows without
  // one don't disperse. (A sketch's model: real glass catalogues fit several terms.)
  const LF = 0.4861327; // µm: the F, d and C lines
  const LD = 0.5875618;
  const LC = 0.6562725;
  /** Index at wavelength lam (µm) of a medium with index n at lam0 and Abbe number abbe (0 or none: no dispersion). */
  const nAt = (n, abbe, lam, lam0) =>
    !abbe || n === 1 || lam === lam0
      ? n
      : n + ((n - 1) / abbe / (LF ** -2 - LC ** -2)) * (lam ** -2 - lam0 ** -2);
  /** Whether any row disperses (has an Abbe number after a refracting surface into glass). */
  const dispersive = rows => rows.some((r, i) => i && r.type !== 'mirror' && r.abbe && r.n !== 1);
  /** Surfaces S (built at lam0, which sets where everything is) with the indices at wavelength lam: a ray traced through these
   *  takes the path that wavelength takes through the same optics. */
  function atWavelength(S, rows, lam, lam0) {
    if (lam === lam0 || !dispersive(rows)) return S;
    const out = S.map((s, i) => {
      const r = rows[i + 1];
      return s.mirror || !r.abbe ? s : { ...s, n: nAt(r.n, r.abbe, lam, lam0) };
    });
    return Object.assign(out, { beam: S.beam, ap: S.ap });
  }

  Object.assign(Optics, {
    spot,
    na,
    toPlane,
    axesAcross,
    lstsq,
    wavefront,
    fitWave,
    curv,
    tangent,
    angle,
    secant,
    wavefrontIn,
    inFocus,
    stigmatic,
    bestFocus,
    efl,
    pastEquator,
    conjugates,
    nAt,
    dispersive,
    atWavelength,
    LINES: { F: LF, d: LD, C: LC },
  });
  if (typeof module === 'object') module.exports = Optics;
})(typeof module === 'object' ? require('./trace.js') : globalThis.Optics);
