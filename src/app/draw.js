// draw.js — drawing the layout: pens (canvas and PDF share one interface), cones, the planar view, 3D solids, labels.

/** Split quad A→B (ray k) / D→C (ray k+1) into polygons wound counter-clockwise, so a nonzero fill of all cells paints
 *  their union once. Where the two rays cross inside the cell (a focus), it becomes its two triangles. */
function cell(A, B, C, D) {
  const ccw = (...P) =>
    P.reduce((s, p, i) => {
      const q = P[(i + 1) % P.length];
      return s + p[0] * q[1] - q[0] * p[1];
    }, 0) > 0
      ? P
      : P.reverse();
  const e = [B[0] - A[0], B[1] - A[1]];
  const g = [C[0] - D[0], C[1] - D[1]];
  const den = e[0] * g[1] - e[1] * g[0];
  const t = den && ((D[0] - A[0]) * g[1] - (D[1] - A[1]) * g[0]) / den;
  const u = den && ((D[0] - A[0]) * e[1] - (D[1] - A[1]) * e[0]) / den;
  if (!(t > 0 && t < 1 && u > 0 && u < 1)) return [ccw(A, B, C, D)];
  const Xp = [A[0] + t * e[0], A[1] + t * e[1]];
  return [ccw(A, Xp, D), ccw(Xp, B, C)];
}

/** A field's beam as polygons for one nonzero fill, from its fan of rays (device points; null = vignetted). Within each
 *  stretch between two surfaces where no two neighbouring rays cross, the union of the thin cells between them is simply
 *  the region from the first ray to the last, so it is one polygon (the rays' points on the surface in, back along the
 *  surface out). Only stretches where rays do cross (at a focus or caustic) are drawn cell by cell. This keeps the painted
 *  path small (~one polygon per stretch instead of ~60), which is what makes zooming with cones fast. */
function coneShape(sp) {
  const polys = [];
  const ccw = P =>
    P.reduce((s, p, i) => {
      const q = P[(i + 1) % P.length];
      return s + p[0] * q[1] - q[0] * p[1];
    }, 0) > 0
      ? P
      : P.reverse();
  for (let k0 = 0; k0 < sp.length;) {
    // runs of consecutive unvignetted rays
    if (!sp[k0]) {
      k0++;
      continue;
    }
    let k1 = k0;
    while (sp[k1 + 1]) k1++;
    const run = sp.slice(k0, k1 + 1);
    if (run.length > 1)
      for (let i = 1; i < run[0].length; i++) {
        const cells = [];
        for (let k = 1; k < run.length; k++)
          cells.push(cell(run[k - 1][i - 1], run[k - 1][i], run[k][i], run[k][i - 1]));
        if (cells.every(c => c.length === 1))
          polys.push(ccw([...run.map(r => r[i - 1]), ...run.map(r => r[i]).reverse()]));
        else polys.push(...cells.flat());
      }
    k0 = k1 + 1;
  }
  return polys;
}

/** Drawing primitives on a canvas 2D context (the screen and the PDF preview). Device units, y down. */
function canvasPen(c) {
  const path = (polys, close) => {
    c.beginPath();
    for (const P of polys) {
      P.forEach((p, i) => c[i ? 'lineTo' : 'moveTo'](...p));
      if (close) c.closePath();
    }
  };
  return {
    segs(L, { color, width = 1, alpha = 1 }) {
      path(L);
      c.setLineDash([]);
      Object.assign(c, { strokeStyle: color, lineWidth: width, globalAlpha: alpha });
      c.stroke();
      c.globalAlpha = 1;
    }, // several lines, one stroke
    line(P, { color, width = 1, dash = [], alpha = 1 }) {
      path([P]);
      c.setLineDash(dash);
      Object.assign(c, { strokeStyle: color, lineWidth: width, globalAlpha: alpha });
      c.stroke();
      c.globalAlpha = 1;
    },
    fill(polys, { color, alpha = 1, stroke, width = 1, blend, strokeAlpha = 1 }) {
      path(polys, 1);
      Object.assign(c, { fillStyle: color, globalAlpha: alpha });
      if (blend) c.globalCompositeOperation = blend;
      c.fill();
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
      if (stroke) {
        c.setLineDash([]);
        Object.assign(c, { strokeStyle: stroke, lineWidth: width, globalAlpha: strokeAlpha });
        c.stroke();
        c.globalAlpha = 1;
      }
    },
    text(s, [x, y], { size, color, align = 'left', font }) {
      Object.assign(c, { font: `${size}px ${font}`, fillStyle: color, textAlign: align });
      c.fillText(s, x, y);
      c.textAlign = 'left';
    },
    width: (s, size, font) => ((c.font = `${size}px ${font}`), c.measureText(s).width),
    /** Draw with another pen into a layer the size of this canvas, then lay the layer down at `alpha`. */
    layer(draw, alpha, box, coarse) {
      const L = (canvasPen.layer ??= document.createElement('canvas'));
      const W = c.canvas.width;
      const H = c.canvas.height;
      const T = c.getTransform();
      const q = coarse ? 0.5 : 1; // coarse: at half resolution (while the view moves)
      if (L.width !== W || L.height !== H) {
        L.width = W;
        L.height = H;
      }
      let [x0, y0, x1, y1] = [0, 0, W, H]; // only the box drawn in (device px): clearing and laying down a whole canvas is what costs
      if (box) {
        const P = [
          [box[0], box[1]],
          [box[2], box[1]],
          [box[0], box[3]],
          [box[2], box[3]],
        ].map(([u, v]) => [T.a * u + T.c * v + T.e, T.b * u + T.d * v + T.f]);
        x0 = Math.max(0, Math.floor(Math.min(...P.map(p => p[0]))) - 2);
        y0 = Math.max(0, Math.floor(Math.min(...P.map(p => p[1]))) - 2);
        x1 = Math.min(W, Math.ceil(Math.max(...P.map(p => p[0]))) + 2);
        y1 = Math.min(H, Math.ceil(Math.max(...P.map(p => p[1]))) + 2);
      }
      if (!(x1 > x0 && y1 > y0)) return;
      const x = L.getContext('2d');
      const w = Math.ceil((x1 - x0) * q);
      const h = Math.ceil((y1 - y0) * q);
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.clearRect(0, 0, w + 1, h + 1);
      x.setTransform(q * T.a, q * T.b, q * T.c, q * T.d, q * (T.e - x0), q * (T.f - y0));
      draw(canvasPen(x)); // (the box drawn at the layer's corner)
      c.save();
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalAlpha = alpha;
      c.drawImage(L, 0, 0, w, h, x0, y0, x1 - x0, y1 - y0);
      c.restore();
    },
  };
}
const ring = ([x, y], r, n = 24) =>
  Array.from({ length: n }, (_, i) => [
    x + r * Math.cos((2 * Math.PI * i) / n),
    y + r * Math.sin((2 * Math.PI * i) / n),
  ]);

/** What to draw of the system: surfaces a…b (a = −1: from the pupil, and the source), the rays between them, and the images
 *  of planes on the segments between them. Default (no range): everything. Used by render() and the figure's page fit. */
function drawRange(range) {
  const n = S.length;
  const a = Math.max(-1, Math.min(range?.[0] ?? -1, n - 1));
  const b = Math.max(a, Math.min(range?.[1] ?? n - 1, n - 1));
  const inR = i => i >= a && i <= b;
  const ray = (f, rs) =>
    a < 0 ? [...src(f), ...rs.slice(0, b + 2)].map(q => q.p ?? q) : rs.slice(a + 1, b + 2).map(q => q.p); // rs: [start, after S0, …]
  const cone = (f, r) => {
    const k = src(f).length;
    return a < 0 ? r.slice(0, k + b + 2) : r.slice(k + a + 1, k + b + 2);
  }; // r: [...src, start, S0, …]
  const segIn = j => (j === 0 ? a < 0 : j - 1 >= a) && (j === n ? b === n - 1 : j <= b); // segment j runs from S[j−1] (the pupil) to S[j]
  const conj = c => segIn(c.j);
  return { a, b, inR, ray, cone, conj, segIn, all: a < 0 && b === n - 1 };
}
/** The surfaces the view draws (Show ▸ Surfaces), [first, last] as drawRange takes them (−1: from the pupil; to the last),
 *  for configuration k (default: the one shown), or null for all of them. sys.span: [from, to] (to −1: the last), or with
 *  configurations { [configuration id]: [from, to] }, each its own (their surfaces differ). n: that layout's surfaces. */
function viewSpan(k = sys.configs?.active, n = S.length) {
  const sp = sys.configs ? sys.span?.[sys.configs.list[k]?.id] : Array.isArray(sys.span) ? sys.span : null;
  if (!sp) return null;
  const a = Number.isInteger(sp[0]) && sp[0] >= -1 && sp[0] < n ? sp[0] : -1;
  const b = Number.isInteger(sp[1]) && sp[1] >= 0 && sp[1] < n - 1 ? Math.max(a, sp[1]) : n - 1;
  return a < 0 && b === n - 1 ? null : [a, b];
}
/** Draw the layout with pen g, mapping world points to device points with M. Shared by the screen and the PDF export.
 *  o: { fields (indices), beam: 'rays'|'cones'|'both', fc(j), ink, mute, glass, glassLine, blank, blankLine, font, size,
 *       lw: {optic, ray}, labels, axes (parent axes and foci), blanks, full (whole parents of off-axis optics), aoi (chief-ray AOI labels), rayAlpha, coneAlpha,
 *       W (device width, keeps labels inside), hots, sel (selected optics: whole parent, vertex and foci shown; screen only),
 *       accent, lock (colour for pinned foci; screen only), shapes, shape, shapeLine,
 *       conj (colour for the images of planes, CJ; falsy: not drawn), coneLayer (draws the cones instead: the screen's cache),
 *       range ([first, last] surface to draw, −1 = the pupil; see drawRange),
 *       under (draws what lies under the layout but over the shapes: the other configurations),
 *       others (the figure: the other configurations drawn, layouts with k and range, whose optics are labelled too) } */
/** Where an optic's label goes from: the ends of its profile (3D: its rim; a caliball: its outline), or, when none of that
 *  can be drawn (a rim off its parent), its hit point. */
function labelEnds(s, o, M) {
  const P = s.ball ? ballRim(s, o.d3) : o.d3 ? rim3(s) : [s.prof[0], s.prof.at(-1)].filter(Boolean);
  return P.length ? P.map(M) : [M(s.P)];
}
/** A caliball (a mirror with ball): its centre, and its outline, the great circle across the y–z plane, or (look) across
 *  the line of sight, which is its silhouette from any side. */
const ballC = s => Optics.add(s.V, s.ez, 1 / s.c);
function ballRim(s, look) {
  const C = ballC(s);
  const r = Math.abs(1 / s.c);
  const w = look && typeof viewDir === 'function' ? Optics.unit(viewDir()) : [1, 0, 0];
  const a = Optics.unit(Math.abs(w[0]) < 0.9 ? Optics.cross(w, [1, 0, 0]) : Optics.cross(w, [0, 1, 0]));
  const b = Optics.cross(w, a);
  return Array.from({ length: 73 }, (_, k) => {
    const t = (k * Math.PI) / 36;
    return C.map((v, m) => v + r * (Math.cos(t) * a[m] + Math.sin(t) * b[m]));
  });
}
const ballStyle = (o, hot) => ({
  color: o.blank ?? o.glass,
  stroke: hot ? o.accent : (o.blankLine ?? o.ink),
  width: hot ? 1.5 * o.lw.optic : o.lw.optic,
});
/** A double pass's way back (TB): dashed, in each field's colour; as cones, just the fan's edge rays (the cones already
 *  show where the light goes, and coming straight back it overlies them). */
function drawReturn(g, M, o) {
  o.fields.forEach(j => {
    const rays = TB[j] ?? [];
    const pick = o.beam === 'cones' ? [rays[0], rays.at(-1)].filter(Boolean) : rays;
    for (const rs of pick)
      if (rs.length > 1)
        g.line(
          rs.map(q => M(q.p)),
          {
            color: o.fc(j),
            width: Math.max(o.lw.ray, 0.8 * o.lw.optic),
            alpha: Math.max(o.rayAlpha ?? 0.8, 0.6),
            dash: [4 * o.lw.optic, 3 * o.lw.optic],
          },
        );
  });
}
/** An ideal (paraxial) lens's symbol on its line P (screen points): arrowheads at both ends, pointing out for a
 *  converging lens (f > 0) and in for a diverging one. */
function lensArrows(g, P, f, st) {
  if (P.length < 2 || !f) return;
  const [a, b] = [P[0], P.at(-1)];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!(L > 0)) return;
  const d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const h = Math.min(9 * st.width, L / 4);
  for (const [e, s] of [
    [b, 1],
    [a, -1],
  ]) {
    const o = f > 0 ? s : -s; // (out: the tip at the end; in: the tip at the end, opening outward)
    const base = [e[0] - o * h * d[0], e[1] - o * h * d[1]];
    g.line(
      [
        [base[0] - 0.55 * h * d[1], base[1] + 0.55 * h * d[0]],
        e,
        [base[0] + 0.55 * h * d[1], base[1] - 0.55 * h * d[0]],
      ],
      st,
    );
  }
}
function render(g, M, o) {
  const hot = i => o.hots?.has(i);
  const fw = o.fields;
  const D = drawRange(o.range);
  const inR = D.inR;
  const pf = s => (o.d3 ? s.sl : s.prof); // 3D views: each optic's slice facing the viewer
  if (o.shapes) drawShapes(g, M, o); // under everything else
  o.under?.(); // then what goes under this layout but over the shapes (other configurations, faded)
  if (o.full)
    S.forEach((s, i) => {
      if (!s.d || !inR(i)) return; // whole parent, faint, under everything else
      if (s.mirror && o.blanks && !s.seg && !o.d3)
        g.fill([Optics.blank(s, ...Optics.parentSpan(s, s.y0, s.y1), (s.y1 - s.y0) / 6).map(M)], {
          color: o.blank,
          alpha: 0.3,
        });
      g.line(Optics.parent(s, s.y0, s.y1).map(M), {
        color: s.mirror ? o.ink : o.glassLine,
        width: 0.8 * o.lw.optic,
        alpha: 0.3,
      });
    });
  S.forEach((s, i) => {
    if (!o.sel?.has(i) || !s.c) return; // a selected optic's whole parent, in the accent colour
    g.line(Optics.parent(s, s.y0, s.y1).map(M), {
      color: o.accent,
      width: 0.9 * o.lw.optic,
      alpha: 0.55,
      dash: [4 * o.lw.optic, 3 * o.lw.optic],
    });
  });
  if (o.d3)
    solids3(g, M, o, D); // 3D: optics, beam and images of planes, back to front
  else {
    S.forEach((s, i) => {
      if (!s.mirror && s.nOut > 1 && S[i + 1] && inR(i) && inR(i + 1))
        g.fill([[...pf(s), ...pf(S[i + 1]).toReversed()].map(M)], { color: o.glass });
    });
    S.forEach((s, i) => {
      if (!s.mirror || !inR(i)) return;
      if (s.ball) return void g.fill([ballRim(s).map(M)], ballStyle(o, hot(i))); // a caliball: the whole sphere
      if (o.blanks)
        g.fill([Optics.blank(s, s.y0, s.y1, (s.y1 - s.y0) / 6).map(M)], {
          color: o.blank,
          stroke: hot(i) ? o.accent : o.blankLine,
          width: hot(i) ? 1.5 * o.lw.optic : o.lw.optic * 0.7,
        });
      else g.line(s.prof.map(M), { color: hot(i) ? o.accent : o.ink, width: 1.6 * o.lw.optic });
    });
    if (o.beam !== 'rays') {
      if (o.coneLayer) o.coneLayer();
      else
        fw.forEach(j =>
          g.fill(coneShape(C[j].map(r => r && D.cone(sys.fields[j], r).map(M))), {
            color: o.fc(j),
            alpha: o.coneAlpha,
          }),
        );
    } // one nonzero fill per field
    if (o.beam !== 'cones')
      fw.forEach(j =>
        T[j].forEach(rs => {
          const P = D.ray(sys.fields[j], rs);
          if (P.length > 1) g.line(P.map(M), { color: o.fc(j), width: o.lw.ray, alpha: o.rayAlpha });
        }),
      );
    if (o.conj) for (const c of CJ) if (D.conj(c)) conjBar(g, M, o, c);
  }
  if (TB && D.all) drawReturn(g, M, o); // a double pass: the light on its way back
  const LP = o.place && (o.labels || o.aoi) ? placeLabels(g, M, o, D) : null; // (the figure: labels clear of the beam)
  S.forEach((s, i) => {
    if (!inR(i)) return;
    if (o.axes) axisFoci(g, M, o, s, i);
    if (!s.mirror && !o.d3)
      g.line(pf(s).map(M), {
        color: hot(i) ? o.accent : o.glassLine,
        width: s.para ? 1.4 * o.lw.optic : o.lw.optic,
        dash: s.n === s.nIn && !s.c && !s.para ? [5 * o.lw.optic, 3 * o.lw.optic] : [],
      });
    if (s.para && !o.d3)
      lensArrows(g, pf(s).map(M), s.f, { color: hot(i) ? o.accent : o.glassLine, width: 1.4 * o.lw.optic });
    if (o.labels && LP?.[i]?.name) {
      const L = LP[i].name;
      g.text(L.t, [L.x, L.y], {
        size: L.fs,
        color: hot(i) ? o.accent : o.mute,
        font: o.font,
        align: 'center',
        lead: L, // (a pen that moves texts draws the arrow, from where the text ends up)
        leadO: o,
      });
      if (!g.leads) leader(g, L, o);
    } else if (o.labels) {
      // centred above the optic's upper end, kept inside the page
      const ends = labelEnds(s, o, M);
      const [x, y] = ends.reduce((a, b) => (b[1] <= a[1] ? b : a));
      const t = label(i);
      const w = g.width(t, o.size, o.font);
      const top =
        o.blanks && s.mirror && !o.d3
          ? Math.min(y, ...Optics.blank(s, s.y0, s.y1, (s.y1 - s.y0) / 6).map(p => M(p)[1]))
          : y;
      g.text(t, [Math.max(w / 2 + 2, Math.min(x, (o.W ?? Infinity) - w / 2)), top - o.size * 0.45], {
        size: o.size,
        color: hot(i) ? o.accent : o.mute,
        font: o.font,
        align: 'center',
      });
    }
    const q = AOIc[i];
    if (o.aoi && LP?.[i]?.aoi) {
      const L = LP[i].aoi;
      g.text(L.t, [L.x, L.y], {
        size: L.fs,
        color: hot(i) ? o.accent : o.mute,
        font: o.font,
        align: 'center',
        lead: L, // (a pen that moves texts draws the arrow, from where the text ends up)
        leadO: o,
      });
      if (!g.leads) leader(g, L, o);
    } else if (o.aoi && q && (s.mirror || s.c || s.n !== s.nIn || s.tilt)) {
      // under the optic's lower end (not on plain, untilted planes)
      const ends = labelEnds(s, o, M);
      const [x, y] = ends.reduce((a, b) => (b[1] >= a[1] ? b : a));
      const t = aoiText(q);
      const fs = 0.9 * o.size;
      const w = g.width(t, fs, o.font);
      const bot =
        o.blanks && s.mirror && !o.d3
          ? Math.max(y, ...Optics.blank(s, s.y0, s.y1, (s.y1 - s.y0) / 6).map(p => M(p)[1]))
          : y;
      g.text(t, [Math.max(w / 2 + 2, Math.min(x, (o.W ?? Infinity) - w / 2)), bot + fs * 1.25], {
        size: fs,
        color: hot(i) ? o.accent : o.mute,
        font: o.font,
        align: 'center',
      });
    }
  });
  // the other configurations' labels (the figure), like this one's
  for (const e of LP?.others ?? [])
    for (const L of [e.name, e.aoi]) {
      if (!L) continue;
      g.text(L.t, [L.x, L.y], {
        size: L.fs,
        color: o.mute,
        font: o.font,
        align: 'center',
        lead: L,
        leadO: o,
      });
      if (!g.leads) leader(g, L, o);
    }
}

/** An image of a plane: a bar across the axis, labelled with a prime (dashed: virtual, or past the last surface, where the
 *  light never gets). An astigmatic one also marks the stretch of axis between its two line images, with a tick at each. */
function conjBar(g, M, o, c) {
  const e = o.d3 ? across(c.u) : c.e;
  const mid = M(c.p);
  const tip = M(c.p.map((v, n) => v + e[n]));
  const d = [tip[0] - mid[0], tip[1] - mid[1]];
  const dl = Math.hypot(...d) || 1;
  const hp = Math.max(c.half * dl, 3 * o.lw.optic);
  const ends = [-1, 1].map(k => [mid[0] + (k * hp * d[0]) / dl, mid[1] + (k * hp * d[1]) / dl]); // at least a short bar
  const dash = c.virtual || c.past ? [3 * o.lw.optic, 2 * o.lw.optic] : [];
  g.line(ends, { color: o.conj, width: 1.4 * o.lw.optic, dash });
  const A = c.lines?.map(M);
  if (A && Math.hypot(A[1][0] - A[0][0], A[1][1] - A[0][1]) > 2 * o.lw.optic) {
    g.line(A, { color: o.conj, width: 0.8 * o.lw.optic, dash });
    const tk = (3 * o.lw.optic) / dl;
    for (const q of A)
      g.line(
        [-1, 1].map(k => [q[0] + k * tk * d[0], q[1] + k * tk * d[1]]),
        { color: o.conj, width: 0.8 * o.lw.optic },
      );
  }
  const top = ends[0][1] < ends[1][1] ? ends[0] : ends[1];
  const name = c.ri ? label(c.ri - 1) : 'pupil';
  g.text(`${name}′`, [top[0], top[1] - o.size * 0.45], {
    size: 0.9 * o.size,
    color: o.conj,
    font: o.font,
    align: 'center',
  });
}
/** 3D drawing on a plain Canvas 2D: nearer things cover farther ones by drawing back to front (a painter's algorithm), each
 *  piece at its own depth along the line of sight. An optic is drawn as in the planar layout, through its section facing the
 *  viewer (a mirror: the grey blank with its face's edge in ink; a lens: the glass between its faces), over the faint outline
 *  of the whole solid (front and back rims), so a face seen square on is a disc. Rays go in short pieces, cones stretch by
 *  stretch (each one fill, so a field's cone doesn't darken where its pieces meet), the images of planes at their points. */
function solids3(g, M, o, D) {
  const b = viewDir();
  const dep = p => Optics.dot(p, b);
  const mean = P => P.reduce((a, p) => a + dep(p), 0) / (P.length || 1);
  const items = [];
  const hot = i => o.hots?.has(i);
  const fw = o.fields;
  const lw = o.lw.optic;
  const done = new Set();
  const mix = o.mix ?? { alpha: o.coneAlpha };
  // Optics as plain cylinders: one opaque fill of the solid's outline (rims front and back), soft edges, and the cap facing
  // the viewer outlined. In a view along an axis (side, top, front, orthographic), an optic seen near edge-on (its axis
  // within ~17° of the screen) shows its faces' curves as in the planar layout: its section facing the viewer is added (a
  // convex face bulges past its rim) and a concave face's dish is cut out. Orbiting, it stays a cylinder.
  const flat = !!cam.name && !cam.persp;
  const area = P =>
    P.reduce((t, p, k) => {
      const q = P[(k + 1) % P.length];
      return t + p[0] * q[1] - q[0] * p[1];
    }, 0);
  const wind = (P, sg) => (Math.sign(area(P)) === sg ? P : P.toReversed());
  const unit = v => {
    const m = Math.hypot(...v) || 1;
    return v.map(x => x / m);
  };
  const dished = (f, inward) => {
    const c = f.sl;
    const m = c[c.length >> 1];
    const h = c[0].map((v, k) => (v + c.at(-1)[k]) / 2); // a face hollow from outside
    return (
      c.length > 2 &&
      Optics.dot(
        m.map((v, k) => v - h[k]),
        inward,
      ) >
        1e-9 * (1 + Math.abs(f.y1 - f.y0))
    );
  };
  const soft = (i, base) => ({
    color: hot(i) ? o.accent : base,
    width: (hot(i) ? 1.2 : 0.6) * lw,
    alpha: hot(i) ? 1 : 0.75,
  });
  const ring = P => [...P, P[0]];
  function cylinder(i, front, back, section, holes, axis, fill, line, caps) {
    const edge = flat && Math.abs(Optics.dot(axis, b)) < 0.3;
    const body = wind(View3D.hull([...front, ...back].map(M)), 1);
    const sec = section.length > 2 ? wind(section.map(M), 1) : null;
    const shape = [body, ...(sec ? [sec] : []), ...(edge ? holes.map(h => wind(h.map(M), -1)) : [])];
    g.fill(shape, { color: fill });
    if (edge && sec)
      g.line(ring(sec), soft(i, line)); // edge-on: the planar outline
    else {
      g.line(ring(body), soft(i, line));
      caps.forEach(c => g.line(ring(c.map(M)), { ...soft(i, line), width: 0.5 * lw }));
    }
    return shape; // (what it covers, for the cones' layer)
  }
  S.forEach((s, i) => {
    if (!D.inR(i) || done.has(i)) return;
    if (s.ball)
      return items.push([dep(ballC(s)), () => g.fill([ballRim(s, true).map(M)], ballStyle(o, hot(i)))]);
    if (s.mirror) {
      const B = Optics.blankSolid(s, s.y0, s.y1, (s.y1 - s.y0) / 6, s.w3);
      const n = unit(s.seg ? s.ey.map((v, k) => v * s.nb[1] + s.ez[k] * s.nb[2]) : s.ez); // the back's normal, outward
      return items.push([
        dep(s.P),
        () => {
          if (!o.blanks || !B.section.length) return void g.line(ring(B.front), soft(i, o.ink));
          return cylinder(
            i,
            B.front,
            B.back,
            B.section,
            dished(s, n) ? [s.sl] : [],
            n,
            o.blank,
            o.blankLine,
            [Optics.dot(n, b) > 0 ? B.back : B.front],
          );
        },
      ]);
    }
    const n = S[i + 1];
    const lens = s.nOut > 1 && n && !n.mirror && D.inR(i + 1);
    if (lens) {
      done.add(i + 1);
      const ax = unit(n.P.map((v, k) => v - s.P[k]));
      const back = ax.map(v => -v);
      return items.push([
        mean([s.P, n.P]),
        () =>
          cylinder(
            i,
            rim3(s),
            rim3(n),
            [...s.sl, ...n.sl.toReversed()],
            [...(dished(s, ax) ? [s.sl] : []), ...(dished(n, back) ? [n.sl] : [])],
            ax,
            o.glass,
            o.glassLine,
            [rim3(s), rim3(n)],
          ),
      ]);
    }
    const d = s.n === s.nIn && !s.c && !s.para ? [5 * lw, 3 * lw] : []; // a plain plane (dashed) or a lone interface: its rim and section
    items.push([
      dep(s.P),
      () => {
        g.line(ring(rim3(s)).map(M), { ...soft(i, o.glassLine), dash: d });
        g.line(s.sl.map(M), { ...soft(i, o.glassLine), dash: d });
        if (s.para) lensArrows(g, s.sl.map(M), s.f, { ...soft(i, o.glassLine), width: 1.4 * lw }); // an ideal lens
      },
    ]);
  });
  // Cones stretch by stretch, all fields together (the first field painted last). On screen they mix as File ▸ Options says
  // (o.mix; by default the screen blend, 1 − (1 − a)(1 − b), mixing like light: order-free, so the colours don't change as
  // the view turns, and overlaps lighten, blue and orange to pink, all three toward white, instead of darkening to brown),
  // painted into a layer laid down translucent. (The figure, for the PDF, mixes by plain transparency.) Each stretch is
  // painted whole, so where the beam meets an optic the stretches in and out overlap over its whole footprint.
  if (o.beam !== 'rays') {
    const Rs = fw.map(j => ringC()[j].map(r => r && D.cone(sys.fields[j], r)));
    const Ls = Rs.map(R => R.filter(Boolean));
    const ok = Ls.filter(L => L.length);
    const m = ok.length ? Math.min(...ok.map(L => Math.min(...L.map(r => r.length)))) : 0;
    let P2 = null;
    const flat = () => (P2 ??= Rs.map(R => R.map(r => r && r.map(M)))); // (orthographic: each ray point mapped once a frame)
    const steps = cone.moving ? 8 : 16; // (fewer stations while the view moves)
    for (let k = 1; k < m; k++) {
      let P = null;
      const polys = () =>
        (P ??= fw.map((j, q) => {
          const L = Ls[q];
          if (!L.length) return null;
          const F = cam.persp ? null : flat()[q];
          const use = edgeRays(j, k, Rs[q]);
          const pick = A => A.map((r, n) => (use.has(n) ? r : null));
          const R = pick(Rs[q]);
          const F2 = F && pick(F);
          return View3D.beamHulls(R, M, steps, k, F2);
        }));
      const paint = (pen, alpha) =>
        polys().forEach((_, n) => {
          const q = fw.length - 1 - n;
          if (P[q]) pen.fill(P[q], { color: o.fc(fw[q]), alpha, blend: mix.blend });
        });
      items.push([
        mean(ok.flatMap(L => L.flatMap(r => [r[k - 1], r[k]]))),
        () => paint(g, mix.alpha),
        { polys, paint },
      ]);
    }
    // the incoming beam's flat face where it starts (the pupil): outlined, so it reads apart from the bundle's sides
    fw.forEach((j, q) => {
      const E = Rs[q].filter(Boolean).map(r => r[0]);
      if (E.length < 3) return;
      const c = [0, 1, 2].map(k => E.reduce((t, p) => t + p[k], 0) / E.length);
      if (
        Math.max(...E.map(p => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]))) <
        1e-6 * (1 + sys.rows[0].ap)
      )
        return; // (a point source: no face)
      items.push([
        mean(E),
        () => {
          const h = View3D.hull(E.map(M)); // (its rim: the face is flat, so its outline on screen is the hull of its points)
          g.line([...h, h[0]], { color: o.fc(j), width: 1, alpha: 0.9 });
        },
      ]);
    });
  }
  if (o.beam !== 'cones')
    fw.forEach(j =>
      [...T[j], ...fanX()[j]].forEach(rs => {
        const P = D.ray(sys.fields[j], rs);
        const Q = cam.persp ? null : P.map(M);
        const d = P.map(dep);
        for (let k = 1; k < P.length; k++)
          for (let h = 0; h < 4; h++) {
            // each stretch in 4 pieces (orthographic: mapped once, split on the screen)
            const at = t =>
              Q
                ? [Q[k - 1][0] + (Q[k][0] - Q[k - 1][0]) * t, Q[k - 1][1] + (Q[k][1] - Q[k - 1][1]) * t]
                : M(P[k - 1].map((v, n) => v + (P[k][n] - v) * t));
            items.push([
              d[k - 1] + ((d[k] - d[k - 1]) * (h + 0.5)) / 4,
              null,
              null,
              { j, seg: [at(h / 4), at((h + 1) / 4)] },
            ]);
          }
      }),
    );
  if (o.conj) for (const c of CJ) if (D.conj(c)) items.push([dep(c.p), () => conjBar(g, M, o, c)]);
  // Back to front. With a mixing style the cones go into one layer, laid down once over everything at the end (a layer per
  // stretch costs a pass each, which is what slowed views with many optics): each optic, as it is drawn on the canvas, also
  // erases what is behind it from the layer, so a cone shows in front of the optics nearer than it and not through them.
  const S2 = items.sort((p, q) => p[0] - q[0]);
  const layered = mix.layer && g.layer;
  const ops = [];
  let batch = null; // ray pieces in a row of one field's colour: one stroke
  const flush = () => {
    if (batch) g.segs(batch.segs, { color: o.fc(batch.j), width: o.lw.ray, alpha: o.rayAlpha });
    batch = null;
  };
  for (const [, f, cone, ray] of S2) {
    if (ray) {
      if (batch?.j !== ray.j) {
        flush();
        batch = { j: ray.j, segs: [] };
      }
      batch.segs.push(ray.seg);
      continue;
    }
    flush();
    if (!cone) {
      const shape = f();
      if (layered && shape) ops.push(pen => pen.fill(shape, { color: '#000', blend: 'destination-out' }));
    } else if (layered) ops.push(pen => cone.paint(pen, 1));
    else f();
  }
  flush();
  if (layered && ops.length) {
    const box = bbox(S2.flatMap(it => (it[2] ? it[2].polys().filter(Boolean).flat(2) : [])));
    if (isFinite(box[0])) g.layer(pen => ops.forEach(op => op(pen)), mix.alpha, box, cone.moving);
  }
}

/** Optic labels for the figure, each where it covers the least of the beam: names (preferably above the optic) and AOI labels
 *  (preferably below) are tried at spots all round the optic, a little further out each ring, and scored by the length of ray
 *  and the area of cone under the text, overlap with any optic or label already placed, how far the text pushes the page out,
 *  and how far it strays from its preferred spot. Returns, by surface, { name, aoi } as { t, x, y (baseline), fs }. */
function placeLabels(g, M, o, D) {
  const edges = []; // shapes' outlines: a label never straddles one (it sits inside a shape or outside it)
  const out = {};
  const fw = o.fields;
  const segs = [];
  const cones = [];
  const hard = [];
  const boxes = [];
  const all = [];
  const pf = s => (o.d3 ? s.sl : s.prof);
  const optic = s =>
    [
      ...pf(s),
      ...(o.d3 ? rim3(s) : o.blanks && s.mirror ? Optics.blank(s, s.y0, s.y1, (s.y1 - s.y0) / 6) : []),
    ].map(M);
  /** The current layout's rays, cones and optics (surfaces in D's range), for the labels to keep clear of. */
  const gather = D => {
    fw.forEach(j =>
      [...T[j], ...(o.d3 ? fanX()[j] : [])].forEach(rs => {
        const P = D.ray(sys.fields[j], rs).map(M);
        all.push(...P);
        for (let k = 1; k < P.length; k++) segs.push([P[k - 1], P[k]]);
      }),
    );
    if (o.beam !== 'rays')
      fw.forEach(j =>
        (o.d3
          ? View3D.beamHulls(
              ringC()[j].map(r => r && D.cone(sys.fields[j], r)),
              M,
            )
          : coneShape(C[j].map(r => r && D.cone(sys.fields[j], r).map(M)))
        ).forEach(P => cones.push(withBox(P))),
      );
    S.forEach((s, i) => {
      if (!D.inR(i)) return;
      const P = optic(s);
      all.push(...P);
      const L = pf(s);
      for (let k = 1; k < L.length; k++) hard.push([M(L[k - 1]), M(L[k])]);
      if ((o.blanks || o.d3) && s.mirror) cones.push({ ...withBox(o.d3 ? View3D.hull(P) : P), hard: true });
    });
  };
  gather(D);
  // the other configurations drawn (the figure's o.others, each with its range): their beams and optics too
  const others = o.others ?? [];
  for (const L of others) withLayout(L, () => gather(drawRange(L.range)));
  if (o.shapes) {
    const T = [];
    drawShapes(g, M, o, T); // shapes' dimension texts: labels keep off them, and off the shapes' edges
    for (const { t, p, align, fs } of T) {
      const w = g.width(t, fs, o.font);
      const x = align === 'left' ? p[0] : align === 'right' ? p[0] - w : p[0] - w / 2;
      boxes.push([x, p[1] - 0.8 * fs, x + w, p[1] + 0.25 * fs]);
    }
    for (const sh of sys.shapes) {
      const P = Optics.isSolid(sh) ? Optics.hull2(SH.outline(sh).map(M)) : SH.outline(sh).map(M);
      if (P.length < 2) continue;
      const E = sh.type === 'line' ? P : [...P, P[0]];
      for (let k = 1; k < E.length; k++) edges.push([E[k - 1], E[k]]);
    }
  }
  const [gx0, gy0, gx1, gy1] = bbox(all);
  const clip = ([[ax, ay], [bx, by]], [x0, y0, x1, y1]) => {
    // length of segment inside the box (Liang–Barsky)
    if (Math.max(ax, bx) < x0 || Math.min(ax, bx) > x1 || Math.max(ay, by) < y0 || Math.min(ay, by) > y1)
      return 0;
    let t0 = 0;
    let t1 = 1;
    const dx = bx - ax;
    const dy = by - ay;
    for (const [p, q] of [
      [-dx, ax - x0],
      [dx, x1 - ax],
      [-dy, ay - y0],
      [dy, y1 - ay],
    ]) {
      if (!p) {
        if (q < 0) return 0;
        continue;
      }
      const r = q / p;
      if (p < 0) {
        if (r > t1) return 0;
        t0 = Math.max(t0, r);
      } else {
        if (r < t0) return 0;
        t1 = Math.min(t1, r);
      }
    }
    return (t1 - t0) * Math.hypot(dx, dy);
  };
  const cover = (b, polys) => {
    let n = 0;
    let inside = 0; // fraction of the box over the polygons (5 × 3 samples)
    for (let u = 0; u < 5; u++)
      for (let v = 0; v < 3; v++, n++) {
        const x = b[0] + ((b[2] - b[0]) * (u + 0.5)) / 5;
        const y = b[1] + ((b[3] - b[1]) * (v + 0.5)) / 3;
        if (
          polys.some(
            c => x >= c.box[0] && x <= c.box[2] && y >= c.box[1] && y <= c.box[3] && inPoly(c.P, x, y),
          )
        )
          inside++;
      }
    return inside / n;
  };
  /** Whether segments p and q cross. */
  const meet = ([[ax, ay], [bx, by]], [[cx, cy], [dx, dy]]) => {
    const o = (px, py, qx, qy, rx, ry) => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
    return (
      o(ax, ay, bx, by, cx, cy) * o(ax, ay, bx, by, dx, dy) < 0 &&
      o(cx, cy, dx, dy, ax, ay) * o(cx, cy, dx, dy, bx, by) < 0
    );
  };
  const ov = (a, b) =>
    Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) *
    Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const place = (i, t, fs, pref) => {
    const w = g.width(t, fs, o.font);
    const h = 1.05 * fs;
    const P = optic(S[i]);
    const [X0, Y0, X1, Y1] = bbox(P);
    const cx = (X0 + X1) / 2;
    const cy = (Y0 + Y1) / 2;
    // Far from its optic (beyond 1.6 text heights), a label gets a thin arrow from its box to the nearest point of the optic.
    const leadFor = b => {
      const bc = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
      const near = P.reduce((a, q) =>
        Math.hypot(q[0] - bc[0], q[1] - bc[1]) < Math.hypot(a[0] - bc[0], a[1] - bc[1]) ? q : a,
      );
      if (
        Math.hypot(
          Math.max(b[0] - near[0], 0, near[0] - b[2]),
          Math.max(b[1] - near[1], 0, near[1] - b[3]),
        ) <=
        1.6 * fs
      )
        return null;
      const ux = near[0] - bc[0];
      const uy = near[1] - bc[1];
      const L = Math.hypot(ux, uy);
      const ex = ux / L;
      const ey = uy / L;
      const k =
        Math.min(
          ex ? (b[2] - b[0]) / 2 / Math.abs(ex) : Infinity,
          ey ? (b[3] - b[1]) / 2 / Math.abs(ey) : Infinity,
        ) +
        0.25 * fs; // leave the text's box
      return [
        [bc[0] + ex * k, bc[1] + ey * k],
        [near[0] - ex * 0.3 * fs, near[1] - ey * 0.3 * fs],
      ];
    };
    /** Where an arrow from box b would point: the optic's nearest point, a little short of it. */
    const nearTo = b => {
      const bc = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
      const near = P.reduce((a, q) =>
        Math.hypot(q[0] - bc[0], q[1] - bc[1]) < Math.hypot(a[0] - bc[0], a[1] - bc[1]) ? q : a,
      );
      const d = Math.hypot(near[0] - bc[0], near[1] - bc[1]) || 1;
      return [near[0] - ((near[0] - bc[0]) / d) * 0.3 * fs, near[1] - ((near[1] - bc[1]) / d) * 0.3 * fs];
    };
    let best = null;
    [0.45, 1.2, 2.2, 3.5, 5].forEach((gap, ring) => {
      gap *= fs;
      const spots = [
        ...[cx, X0, X1, cx - w / 2, cx + w / 2].flatMap(x => [
          ['above', x, Y0 - gap - h / 2],
          ['below', x, Y1 + gap + h / 2],
        ]),
        ...[cy, Y0 + h / 2, Y1 - h / 2].flatMap(y => [
          ['left', X0 - gap - w / 2, y],
          ['right', X1 + gap + w / 2, y],
        ]),
      ];
      for (const [side, x, y] of spots) {
        const b = [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
        const ray = segs.reduce((a, sg) => a + clip(sg, b), 0) / fs;
        const pad = [b[0] - 0.2 * fs, b[1] - 0.15 * fs, b[2] + 0.2 * fs, b[3] + 0.15 * fs]; // (a little clearance)
        const edge = edges.reduce((a, sg) => a + clip(sg, pad), 0) / fs;
        const cone = cones.length
          ? cover(
              b,
              cones.filter(c => !c.hard),
            )
          : 0;
        const opt =
          hard.reduce((a, sg) => a + clip(sg, b), 0) +
          cover(
            b,
            cones.filter(c => c.hard),
          ) *
            10;
        const lab = boxes.reduce((a, q) => a + ov(b, q), 0) / (fs * fs);
        const grow =
          (Math.max(0, gx0 - b[0]) +
            Math.max(0, b[2] - gx1) +
            Math.max(0, gy0 - b[1]) +
            Math.max(0, b[3] - gy1)) /
          fs;
        const page = o.W && (b[0] < 2 || b[2] > o.W) ? 50 : 0;
        const lead = leadFor(b);
        const arrow = lead
          ? 0.3 +
            (boxes.reduce((a, q) => a + clip(lead, q), 0) / fs) * 10 +
            30 * edges.filter(e => meet(lead, e)).length
          : 0; // an arrow shouldn't cross other labels, nor a shape's outline
        const cost =
          ray +
          4 * cone +
          20 * opt +
          60 * edge +
          40 * lab +
          0.6 * grow +
          page +
          0.5 * ring +
          arrow +
          (side === pref ? 0 : side === 'above' || side === 'below' ? 0.8 : 1.2) +
          (Math.abs(x - cx) / w) * 0.2;
        if (!best || cost < best.cost) best = { cost, x, y: y + h / 2 - 0.25 * fs, b, lead, to: nearTo(b) };
      }
    });
    boxes.push(best.b);
    if (best.lead) segs.push(best.lead); // later labels keep off the arrow too
    return { t, x: best.x, y: best.y, fs, lead: best.lead, to: best.to };
  };
  S.forEach((s, i) => {
    if (!D.inR(i)) return;
    const L = (out[i] = {});
    if (o.labels) L.name = place(i, label(i), o.size, 'above');
  });
  S.forEach((s, i) => {
    const q = AOIc[i];
    if (!D.inR(i) || !o.aoi || !q || !(s.mirror || s.c || s.n !== s.nIn || s.tilt)) return;
    out[i].aoi = place(i, aoiText(q), 0.9 * o.size, 'below');
  });
  // Then the other configurations' optics, after this one's: each that this one doesn't draw in the same place (by row,
  // within a micron), so an optic they share keeps one label. As out.others: [{ k, name, aoi }].
  const here = new Map();
  S.forEach((s, i) => D.inR(i) && sys.rows[i + 1]?.id && here.set(sys.rows[i + 1].id, s.P));
  out.others = others.flatMap(L =>
    withLayout(L, () => {
      const Dk = drawRange(L.range);
      return S.flatMap((s, i) => {
        const P = here.get(sys.rows[i + 1]?.id);
        if (!Dk.inR(i) || (P && Math.hypot(...P.map((v, n) => v - s.P[n])) < 1e-3)) return [];
        const e = { k: L.k };
        if (o.labels) e.name = place(i, label(i), o.size, 'above');
        const q = AOIc[i];
        if (o.aoi && q && (s.mirror || s.c || s.n !== s.nIn || s.tilt))
          e.aoi = place(i, aoiText(q), 0.9 * o.size, 'below');
        return [e];
      });
    }),
  );
  return out;
}
/** A placed label's arrow to its optic (placeLabels' lead): a thin line and a small filled head. */
function leader(g, L, o) {
  if (!L.lead) return;
  const [[ax, ay], [bx, by]] = L.lead;
  const d = Math.hypot(bx - ax, by - ay) || 1;
  const ux = (bx - ax) / d;
  const uy = (by - ay) / d;
  const hl = 0.5 * L.fs;
  const hw = 0.2 * L.fs;
  g.line(
    [
      [ax, ay],
      [bx - ux * hl * 0.8, by - uy * hl * 0.8],
    ],
    { color: o.mute, width: Math.max(0.4 * o.lw.optic, 0.25) },
  );
  g.fill(
    [
      [
        [bx, by],
        [bx - ux * hl - uy * hw, by - uy * hl + ux * hw],
        [bx - ux * hl + uy * hw, by - uy * hl - ux * hw],
      ],
    ],
    { color: o.mute },
  );
}
const bbox = P => {
  const b = [Infinity, Infinity, -Infinity, -Infinity]; // (a loop: a big beam has too many points to spread into Math.min)
  for (const [x, y] of P) {
    if (x < b[0]) b[0] = x;
    if (y < b[1]) b[1] = y;
    if (x > b[2]) b[2] = x;
    if (y > b[3]) b[3] = y;
  }
  return b;
};
const withBox = P => ({ P, box: bbox(P) });
function inPoly(P, x, y) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i];
    const [xj, yj] = P[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** A surface's parent axis (dashed, when it leaves the beam axis: off-axis or tilted) through its vertex and foci, and the
 *  foci: F1 filled, F2 open (they coincide for a sphere). Shown for off-axis optics, non-spherical conics and locked
 *  surfaces. A pinned focus is ringed in the lock colour, with a dashed line to its target while the lock doesn't hold.
 *  A selected optic (o.sel) shows all of this in the accent colour, whatever its shape, with its vertex and labels: V, F1,
 *  F2 (C for a sphere, whose foci are its centre; f, the paraxial focus, for an oblate ellipsoid, which has none on its axis). */
function axisFoci(g, M, o, s, i) {
  const L = sys.rows[i + 1].lock;
  const pinned = n => L?.[`f${n}`];
  const sel = o.sel?.has(i);
  const col = sel ? o.accent : o.mute;
  if (!s.c || !(sel || s.d || s.k < 0 || pinned(1) || pinned(2))) return;
  const F = Optics.foci(s);
  const ends = [s.V, ...(F.length ? F.filter(Boolean) : [s.V.map((v, k) => v + s.ez[k] / (2 * s.c))])];
  const r = 1.6 * o.lw.optic;
  const along = p => (p[0] - s.V[0]) * s.ez[0] + (p[1] - s.V[1]) * s.ez[1] + (p[2] - s.V[2]) * s.ez[2];
  const lo = ends.reduce((a, p) => (along(p) < along(a) ? p : a));
  const hi = ends.reduce((a, p) => (along(p) > along(a) ? p : a));
  if (s.d || s.tilt || sel)
    g.line([lo, hi].map(M), { color: col, width: o.lw.ray, dash: [2 * o.lw.optic, 4 * o.lw.optic] });
  if (sel) {
    const v = M(s.V);
    const tag = (p, t) => g.text(t, [p[0] + 6, p[1] - 6], { size: 10, color: o.accent, font: o.font });
    g.fill(
      [
        [
          [v[0], v[1] - 1.3 * r],
          [v[0] + 1.3 * r, v[1]],
          [v[0], v[1] + 1.3 * r],
          [v[0] - 1.3 * r, v[1]],
        ],
      ],
      { color: o.accent },
    );
    tag(v, 'V'); // the vertex: a diamond
    if (!F.length) {
      const c = M(ends[1]);
      g.line([...ring(c, 1.3 * r), ring(c, 1.3 * r)[0]], { color: o.accent, width: 0.8 * o.lw.optic });
      tag(c, 'f');
    } else F.forEach((f, n) => f && !(n && s.k === 0) && tag(M(f), s.k === 0 ? 'C' : `F${n + 1}`));
  }
  F.forEach((f, n) => {
    if (!f || (n && s.k === 0)) return;
    const c = M(f);
    if (n) g.line([...ring(c, 1.3 * r), ring(c, 1.3 * r)[0]], { color: col, width: 0.8 * o.lw.optic });
    else g.fill([ring(c, r)], { color: col });
    if (!o.lock || !pinned(n + 1)) return;
    g.line([...ring(c, 3.2 * r), ring(c, 3.2 * r)[0]], { color: o.lock, width: 1.2 });
    const Q = Optics.lockPoint(S, L[`f${n + 1}`], i); // as seen from this surface (through fold flats)
    if (Q && Math.hypot(Q[0] - f[0], Q[1] - f[1], Q[2] - f[2]) > 1e-6 * (1 + Math.hypot(...f)))
      g.line([f, Q].map(M), { color: o.lock, width: 1, dash: [3, 3] });
  });
  if (o.lock && hot(i) && !sel)
    F.forEach(
      (f, n) =>
        f &&
        !(n && s.k === 0) &&
        g.text(
          `F${n + 1}`,
          M(f).map((v, k) => v + (k ? -5 : 5)),
          { size: 10, color: o.mute, font: o.font },
        ),
    );
  if (o.lock)
    [1, 2].forEach(n => {
      const tg = L?.[`f${n}`];
      const inf = tg?.at === 'inf' && !F[n - 1] && ($('stig').checked || sel);
      if (tg?.at !== 'pt' && !inf) return;
      const at = !inf && pinAt(tg, i + 1);
      if (!inf && !at) return;
      const [x, y] = M(inf ? infHandle(i) : at.p);
      const h = 4.5; // a point target: a square handle to drag (dashed: at infinity, drag it in to make an image)
      g.line(
        [
          [x - h, y - h],
          [x + h, y - h],
          [x + h, y + h],
          [x - h, y + h],
          [x - h, y - h],
        ],
        { color: o.lock, width: 1.4, dash: inf ? [2, 2] : [] },
      );
      g.text(inf ? `F${n} ∞` : `F${n}`, [x + 7, y + 13], { size: 10, color: o.lock, font: o.font });
    });
  function hot(i) {
    return o.hots?.has(i);
  }
}

/** The world axes as seen (3D views): x, y, z from point c, the nearer ones drawn last. */
function triad(g, c, ink, font) {
  const col = { x: '#e03131', y: '#2f9e44', z: '#1c7ed6' };
  const b = viewDir();
  [
    ['x', [1, 0, 0]],
    ['y', [0, 1, 0]],
    ['z', [0, 0, 1]],
  ]
    .sort((p, q) => Optics.dot(p[1], b) - Optics.dot(q[1], b))
    .forEach(([n, a]) => {
      const f = F3(a);
      const d = [Optics.dot(cam.r, f), -Optics.dot(cam.u, f)];
      const tip = [c[0] + 22 * d[0], c[1] + 22 * d[1]];
      g.line([c, tip], { color: col[n], width: 2, alpha: Optics.dot(a, b) < -0.2 ? 0.45 : 1 });
      if (Math.hypot(...d) > 0.2)
        g.text(n, [c[0] + 30 * d[0] - 3, c[1] + 30 * d[1] + 4], { size: 11, color: col[n], font });
    });
}
/** Scale bar with its right end at [x, y] (device), for a map of s device units per mm, at most `max` long. */
function scaleBar(g, [x, y], s, max, o) {
  const b = 10 ** Math.floor(Math.log10(max / s));
  const len = [5, 2, 1].map(m => m * b).find(l => l * s <= max);
  const x0 = x - len * s;
  const tk = o.size * 0.35;
  g.line(
    [
      [x0, y],
      [x, y],
    ],
    { color: o.ink, width: o.lw.optic * 0.8 },
  );
  for (const xx of [x0, x])
    g.line(
      [
        [xx, y - tk],
        [xx, y + tk],
      ],
      { color: o.ink, width: o.lw.optic * 0.8 },
    );
  g.text(`${nf(len)} mm`, [(x0 + x) / 2, y - tk - o.size * 0.3], {
    size: o.size,
    color: o.ink,
    font: o.font,
    align: 'center',
  });
}

/** Redraw at the next frame, once however many wheel, pan or hover events arrive before it. */
let drawQ = 0;
const redraw = () => {
  drawQ ||= requestAnimationFrame(() => {
    drawQ = 0;
    draw();
  });
};
/** Cones are drawn through a cached picture of them (with a margin around the view). While the view is zooming or panning
 *  the picture is only moved and scaled (made at 1× if it has to be made then); 150 ms after the last change it is
 *  redrawn afresh at full resolution. At rest it is reused while nothing changes, so hovering doesn't refill the cones.
 *  Filling hundreds of translucent cells every frame is what made zooming with cones slow. */
const cone = {
  canvas: document.createElement('canvas'),
  key: null,
  C: null,
  snap: null,
  moving: 0,
  timer: 0,
};
function viewMoved() {
  cone.moving = performance.now();
  clearTimeout(cone.timer);
  cone.timer = setTimeout(() => {
    cone.moving = 0;
    draw();
  }, 150);
  redraw();
}
function coneLayer(o, W, H, dpr) {
  const x = o.mix2;
  const key = [W, H, o.fc(0), o.coneAlpha, o.fields.join(), fz, fy, JSON.stringify(x), o.range].join();
  const D = drawRange(o.range);
  const same = cone.key === key && cone.C === C && cone.snap;
  const still =
    same &&
    cone.snap.s === view.s &&
    cone.snap.ox === view.ox &&
    cone.snap.oy === view.oy &&
    cone.snap.r === dpr;
  if (!(still || (same && cone.moving))) {
    // (re)make the picture for this view
    const r = cone.moving ? Math.min(dpr, 1) : dpr;
    const c = cone.canvas;
    const m = 0.15;
    const cw = W * (1 + 2 * m);
    const ch = H * (1 + 2 * m);
    const g = c.getContext('2d');
    c.width = Math.ceil(cw * r);
    c.height = Math.ceil(ch * r);
    g.setTransform(r, 0, 0, r, m * W * r, m * H * r);
    g.clearRect(-m * W, -m * H, cw, ch);
    const pen = canvasPen(g);
    const fs = x ? o.fields.toReversed() : o.fields; // (File ▸ Options can mix them in this view too: first field painted last)
    fs.forEach(j =>
      pen.fill(coneShape(C[j].map(q => q && D.cone(sys.fields[j], q).map(X))), {
        color: o.fc(j),
        alpha: !x ? o.coneAlpha : x.layer ? 1 : x.alpha,
        blend: x?.blend,
      }),
    );
    Object.assign(cone, { key, C, snap: { s: view.s, ox: view.ox, oy: view.oy, m, r } });
  }
  const { s, ox, oy, m, r } = cone.snap;
  const k = view.s / s; // picture CSS px → now: x' = x·k + (view.ox − ox·k)
  if (x?.layer) ctx.globalAlpha = x.alpha;
  ctx.drawImage(
    cone.canvas,
    view.ox - ox * k - m * W * k,
    view.oy - oy * k - m * H * k,
    (cone.canvas.width / r) * k,
    (cone.canvas.height / r) * k,
  );
  ctx.globalAlpha = 1;
}
/** The selected optics: pinned or docked popups', the one whose foci are being pinned, and the one being edited in the table. */
function selected() {
  const el = $('tbl').ownerDocument.activeElement;
  const tr = el?.closest?.('#tbl tr[data-i]') ?? ($('jog').contains(el) ? jt?.closest('tr[data-i]') : null);
  return new Set(
    [
      ...pops()
        .filter(p => p.pinned || p.docked)
        .map(p => p.tgt?.i),
      lk?.ri - 1,
      tr ? +tr.dataset.i - 1 : undefined,
    ].filter(i => i >= 0),
  );
}
function draw() {
  if (drawQ) {
    cancelAnimationFrame(drawQ);
    drawQ = 0;
  } // a direct draw makes a queued one unnecessary
  if (S.length !== sys.rows.length - 1) return; // mid-load (the rows are new, the layout not yet built): update() draws
  const W = cv.clientWidth;
  const H = cv.clientHeight;
  const r = devicePixelRatio;
  if (cv.width !== W * r || cv.height !== H * r) {
    cv.width = W * r;
    cv.height = H * r;
  }
  if (!view) fit();
  ctx.setTransform(r, 0, 0, r, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const g = canvasPen(ctx);
  const acc = tok('--accent');
  const mute = tok('--mute');
  const sel = selected();
  const o = {
    fields: sys.fields.map((_, j) => j),
    beam: sys.view,
    fc,
    ink: tok('--ink'),
    mute,
    glass: tok('--glass'),
    glassLine: tok('--glassline'),
    blank: tok('--blank'),
    blankLine: tok('--blankline'),
    font: tok('--ui'),
    size: 11,
    lw: { optic: 1.5, ray: 1 },
    labels: true,
    axes: true,
    blanks: true,
    rayAlpha: 0.8,
    coneAlpha: 0.3,
    W,
    hots: new Set([...pops().map(p => p.tgt?.i), lk?.ri - 1, ...sel]),
    sel,
    accent: acc,
    full: sys.full,
    aoi: sys.aoi,
    lock: tok('--lock'),
    shapes: true,
    shape: tok('--shape'),
    shapeLine: tok('--shapeline'),
    conj: tok('--conj'),
    d3: look3(),
    mix: coneMix(),
    mix2: opts.cone2d ? coneMix() : null,
    range: viewSpan(), // (Show ▸ Surfaces: null, all of them)
  }; // (mix: how cones mix, File ▸ Options; mix2: in the planar view too)
  if (o.d3)
    S.forEach(s => (s.sl = slice3(s))); // what is drawn of each optic from here (its section facing the viewer)
  else o.coneLayer = () => coneLayer(o, W, H, r); // the screen draws cones through its cache
  if (ghosts.length) o.under = () => drawGhosts(g, X, o); // other configurations shown: faded, under the active one
  $('showBtn').classList.toggle('span', !!o.range); // (a mark: part of the system drawn)
  render(g, X, o);
  drawMeasure(g); // (the measuring tool's line, if any)
  S.forEach((s, i) => {
    if (!(drag?.mode === 'tilt' && drag.i === i) && (!o.hots.has(i) || !s.tilt || s.pivot === undefined))
      return; // tilt pivot: a highlighted or turning optic
    const [x, y] = X(s.pivotAt);
    g.line(ring([x, y], 4).concat([ring([x, y], 4)[0]]), { color: acc });
    g.line(
      [
        [x - 7, y],
        [x + 7, y],
      ],
      { color: acc },
    );
    g.line(
      [
        [x, y - 7],
        [x, y + 7],
      ],
      { color: acc },
    );
  });
  const sh = sys.shapes[shSel]; // the selected shape: outline and handles
  if (sh) {
    const P = SH.outline(sh).map(X);
    g.line(sh.type === 'line' ? P : [...P, P[0]], { color: acc, width: 1.5 });
    const kn = SH.knob(sh);
    const H = SH.handles(sh).map(X);
    if (kn) H.pop();
    H.forEach(([x, y]) =>
      g.fill(
        [
          [
            [x - 4, y - 4],
            [x + 4, y - 4],
            [x + 4, y + 4],
            [x - 4, y + 4],
          ],
        ],
        { color: tok('--panel'), stroke: acc, width: 1.5 },
      ),
    );
    if (kn) {
      const k = X(kn);
      const C = SH.centre(sh);
      const base =
        sh.type === 'rect'
          ? X(
              SH.at(
                sh,
                0,
                (Math.sign(
                  (kn[1] - C[1]) * Math.cos(((sh.a || 0) * Math.PI) / 180) -
                    (kn[2] - C[2]) * Math.sin(((sh.a || 0) * Math.PI) / 180),
                ) *
                  sh.h) /
                  2,
              ),
            )
          : X(C); // the rotation knob, on a stem
      g.line([base, k], { color: acc, width: 1 });
      g.fill([ring(k, 4.5)], { color: tok('--panel'), stroke: acc, width: 1.5 });
    }
  }
  if (!cam.persp) scaleBar(g, [W - 16, H - 20], view.s, 120, { ...o, ink: mute, lw: { optic: 1.25 } }); // (no one scale in perspective)
  if (!side) triad(g, [36, 40], mute, o.font);
  pops().forEach(p => {
    const t = p.tgt;
    if (t?.j === undefined) return; // probe planes across the beam
    const bk = t.back && AXB?.[t.j]; // (on a double pass's way back)
    if (t.back && !bk) return;
    const u = bk ? AXB[t.j].u : AX[t.j].u;
    const Q = bk ? atB(t.j, t.s) : at(t.j, t.s);
    const e = across(u);
    const hw = bk ? probeHWB(t.j, t.s) : probeHW(t.j, t.s);
    const r = hw + 4 / view.s;
    const e2 = Optics.cross(u, e); // 3D views: the plane across the beam, seen as a ring (a line from the side)
    g.line(
      side
        ? [-1, 1].map(k => Q.map((v, m) => v + k * r * e[m])).map(X)
        : Array.from({ length: 49 }, (_, n) => {
            const a = (2 * Math.PI * n) / 48;
            return X(Q.map((v, m) => v + r * (Math.cos(a) * e[m] + Math.sin(a) * e2[m])));
          }),
      { color: p.docked ? mute : acc, width: 2 },
    );
  });
}
