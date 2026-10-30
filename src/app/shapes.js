// shapes.js — shapes: rectangles, circles and lines sketched on the layout (world mm, fixed in place), drawn under everything with
// their dimensions. sys.shapes: {type: 'rect', z, y, w, h, a} (centre, size, rotation in degrees CCW, default 0),
// {type: 'circle', z, y, d}, {type: 'line', z, y, z2, y2}. Scripts can add 3D envelopes too ({type: 'box' | 'cylinder'}, see
// src/engine/shapes.js): drawn as their silhouette and edges from any side, with their name; not picked or edited here. And
// parts of the instrument off the light path ({type: 'part'}, its surfaces placed in the world): drawn faded, as the optics. A selected rectangle or line has a rotation handle (a round knob
// off the middle of its lower edge, or beside a line's middle) that turns it about its centre; Shift turns in 15° steps.
const SH = {
  /** A point at local (u along the width, v along the height) of a rectangle rotated by its angle about its centre. */
  at: (sh, u, v) => {
    const t = ((sh.a || 0) * Math.PI) / 180;
    const c = Math.cos(t);
    const s = Math.sin(t);
    return [0, sh.y + u * s + v * c, sh.z + u * c - v * s];
  },
  outline: sh =>
    Optics.isBeam(sh)
      ? [] // (light: not an outline to frame or measure)
      : Optics.isPart(sh)
      ? SH.partSurfaces(sh).flatMap(({ s, y0, y1 }) => Optics.profile(s, y0, y1))
      : Optics.isSolid(sh)
      ? (SH.wire(sh)?.pts ?? [])
      : sh.type === 'rect'
        ? [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ].map(([a, b]) => SH.at(sh, (a * sh.w) / 2, (b * sh.h) / 2))
        : sh.type === 'circle'
          ? Array.from({ length: 72 }, (_, i) => [
              0,
              sh.y + (sh.d / 2) * Math.sin((i * Math.PI) / 36),
              sh.z + (sh.d / 2) * Math.cos((i * Math.PI) / 36),
            ])
          : [
              [0, sh.y, sh.z],
              [0, sh.y2, sh.z2],
            ],
  /** A solid (box, cylinder) in the configuration shown: { c, pts, edges } in the world, or null when it isn't shown. */
  wire: sh => Optics.shapeWire(sh, sys.rows, S, sys.configs?.list?.[sys.configs.active]?.id ?? null),
  /** A part's surfaces in the configuration shown ({ s, y0, y1 }, world). */
  partSurfaces: sh => Optics.partSurfaces(sh, sys.configs?.list?.[sys.configs.active]?.id ?? null),
  centre: sh => (sh.type === 'line' ? [0, (sh.y + sh.y2) / 2, (sh.z + sh.z2) / 2] : [0, sh.y, sh.z]),
  /** The rotation knob (world): 22 px out from the middle of a rectangle's edge, or beside a line's middle, on the side lower
   *  on the screen (the size labels sit on the upper side); null for a circle. */
  knob: sh => {
    const off = 22 / view.s;
    const low = (p, q) => (X(p)[1] >= X(q)[1] ? p : q);
    if (sh.type === 'rect') return low(SH.at(sh, 0, -sh.h / 2 - off), SH.at(sh, 0, sh.h / 2 + off));
    if (sh.type !== 'line') return null;
    const L = Math.hypot(sh.z2 - sh.z, sh.y2 - sh.y) || 1;
    const [, cy, cz] = SH.centre(sh);
    const ny = (off * (sh.z2 - sh.z)) / L;
    const nz = (-off * (sh.y2 - sh.y)) / L;
    return low([0, cy - ny, cz - nz], [0, cy + ny, cz + nz]);
  },
  /** Drag handles: a rectangle's corners, a circle's rim or a line's ends, then the rotation knob (part 'rot'). */
  handles: sh => [
    ...(sh.type === 'circle' ? [[0, sh.y, sh.z + sh.d / 2]] : SH.outline(sh)),
    ...(SH.knob(sh) ? [SH.knob(sh)] : []),
  ],
  inside: (sh, [, y, z]) => {
    if (sh.type === 'circle') return Math.hypot(z - sh.z, y - sh.y) <= sh.d / 2;
    if (sh.type !== 'rect') return false;
    const t = ((sh.a || 0) * Math.PI) / 180;
    const dz = z - sh.z;
    const dy = y - sh.y;
    const u = dz * Math.cos(t) + dy * Math.sin(t);
    const v = -dz * Math.sin(t) + dy * Math.cos(t);
    return Math.abs(u) <= sh.w / 2 && Math.abs(v) <= sh.h / 2;
  },
  name: { rect: 'Rectangle', circle: 'Circle', line: 'Line', box: 'Box', cylinder: 'Cylinder', part: 'Part', beam: 'Beam' },
};
/** Another configuration's light (a `beam` shape), faded, as the cones are: each stretch filled between its stations (its
 *  cross-sections at the ends and between, so a focus between them narrows it), all in one fill (no darker overlaps). */
function drawBeam(g0, M, o, sh) {
  if (!Optics.inConfig(sh, sys.configs?.list?.[sys.configs.active]?.id ?? null)) return;
  const K = 6;
  const polys = [];
  for (const [A, B] of sh.stretches ?? []) {
    const k = A.map((a, i) => (a && B[i] ? i : -1)).filter(i => i >= 0);
    if (k.length < 3) continue;
    const at = t => k.map(i => A[i].map((v, m) => v + (B[i][m] - v) * t));
    for (let j = 0; j < K; j++) {
      const H = Optics.hull2([...at(j / K), ...at((j + 1) / K)].map(M));
      if (H.length > 2) polys.push(H);
    }
  }
  if (polys.length)
    fadePen(g0, o.partAlpha ?? 0.45, null).fill(polys, { color: sh.color || o.fc?.(0) || o.ink, alpha: o.coneAlpha ?? 0.3 });
}
/** A part off the light path, faded, drawn as the optics are: a plate's glass between its faces, a mirror's blank (or its
 *  face), a refracting face's line (3D views: each face's rim). */
function drawPart(g0, M, o, sh) {
  const g = fadePen(g0, o.partAlpha ?? 0.45, null);
  const L = SH.partSurfaces(sh);
  const prof = ({ s, y0, y1 }) => Optics.profile(s, y0, y1);
  if (o.d3) {
    // as solids3 draws the optics: a solid's outline (its rims front and back) filled, and outlined; seen edge-on in a view
    // along an axis, its section facing the viewer instead (the faces' curves, as in the planar layout)
    const b = viewDir();
    const flat = !!cam.name && !cam.persp;
    const lw = o.lw.optic;
    const F = L.map(({ s, y0, y1 }) => {
      const f = { ...s, y0, y1 };
      f.sl = slice3(f);
      f.rim = Optics.rim(f, y0, y1);
      return f;
    });
    const solid = (front, back, section, axis, fill, line) => {
      const body = View3D.hull([...front, ...back].map(M));
      const edge = flat && Math.abs(Optics.dot(axis, b)) < 0.3 && section.length > 2;
      const out = edge ? section.map(M) : body;
      g.fill(edge ? [body, out] : [body], { color: fill });
      g.line([...out, out[0]], { color: line, width: 0.6 * lw });
    };
    const unit = v => v.map(x => x / (Math.hypot(...v) || 1));
    for (let i = 0; i < F.length; i++) {
      const f = F[i];
      const n = F[i + 1];
      if (f.mirror) {
        const B = Optics.blankSolid(f, f.y0, f.y1, (f.y1 - f.y0) / 6, f.w3);
        if (!o.blanks || !B.section.length) g.line([...B.front, B.front[0]].map(M), { color: roleLine(sh, o.ink), width: 0.6 * lw });
        else solid(B.front, B.back, B.section, f.ez, roleFill(sh, o.blank), roleLine(sh, o.blankLine));
      } else if (f.nOut > 1 && n && !n.mirror) {
        solid(f.rim, n.rim, [...f.sl, ...n.sl.toReversed()], unit(n.P.map((v, k) => v - f.P[k])),
          roleFill(sh, o.glass), roleLine(sh, o.glassLine));
        i++;
      } else g.line([...f.rim, f.rim[0]].map(M), { color: roleLine(sh, o.glassLine), width: 0.6 * lw });
    }
    return;
  }
  L.forEach((f, i) => {
    if (!f.s.mirror && f.s.nOut > 1 && L[i + 1])
      g.fill([[...prof(f), ...prof(L[i + 1]).toReversed()].map(M)], { color: roleFill(sh, o.glass) });
  });
  for (const f of L) {
    const { s, y0, y1 } = f;
    if (s.mirror && o.blanks)
      g.fill([Optics.blank(s, y0, y1, (y1 - y0) / 6).map(M)], {
        color: roleFill(sh, o.blank),
        stroke: roleLine(sh, o.blankLine),
        width: 0.7 * o.lw.optic,
      });
    else if (s.mirror) g.line(prof(f).map(M), { color: roleLine(sh, o.ink), width: 1.6 * o.lw.optic });
    else g.line(prof(f).map(M), { color: roleLine(sh, o.glassLine), width: o.lw.optic });
  }
}
/** Shapes with dimensions: a rectangle's width above it and height to its right, a circle's diameter, a line's length. */
function drawShapes(g0, M, o, collect) {
  // collect: only list the dimension texts ({t, p, align, fs}), drawing nothing
  const fs = 0.9 * o.size;
  const g = collect ? { line() {}, fill() {} } : g0;
  const texts = []; // each text: its spots to choose from, the usual one first ([p, align])
  const lab = (t, ...spots) =>
    texts.push({ t, spots: spots.map(s => (Array.isArray(s[0]) ? s : [s, 'center'])) });
  const outlines = sys.shapes.map(sh =>
    Optics.isSolid(sh) ? Optics.hull2(SH.outline(sh).map(M)) : SH.outline(sh).map(M),
  );
  for (const sh of sys.shapes) if (Optics.isBeam(sh)) drawBeam(g, M, o, sh); // (another configuration's light: under the rest)
  for (const [n, sh] of sys.shapes.entries()) {
    const P = outlines[n];
    if (Optics.isBeam(sh)) continue;
    if (Optics.isPart(sh)) {
      // a part off the light path: faded, as the optics are, and its name above it
      if (!P.length) continue;
      drawPart(g, M, o, sh);
      if (sh.name) {
        const xs = P.map(p => p[0]);
        const ys = P.map(p => p[1]);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        lab(sh.name, [cx, Math.min(...ys) - 0.4 * fs], [cx, Math.max(...ys) + 1.1 * fs]);
      }
      continue;
    }
    if (Optics.isSolid(sh)) {
      // a 3D envelope: its silhouette, filled, then its edges and its name
      if (P.length < 3) continue;
      g.fill([P], {
        color: roleFill(sh, o.shape),
        stroke: roleLine(sh, o.shapeLine),
        width: 0.7 * o.lw.optic,
      });
      for (const [a, b] of SH.wire(sh).edges)
        g.line([M(a), M(b)], { color: roleLine(sh, o.shapeLine), width: 0.5 * o.lw.optic, alpha: 0.6 });
      if (sh.name) {
        const xs = P.map(p => p[0]);
        const ys = P.map(p => p[1]);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        lab(
          sh.name,
          [cx, cy + 0.35 * fs],
          [cx, Math.min(...ys) - 0.4 * fs],
          [cx, Math.max(...ys) + 1.1 * fs],
        );
      }
      continue;
    }
    const xs = P.map(p => p[0]);
    const ys = P.map(p => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    if (sh.type === 'line') {
      g.line(P, { color: o.shapeLine, width: 0.8 * o.lw.optic });
      const [[ax, ay], [bx, by]] = P;
      const L = Math.hypot(bx - ax, by - ay) || 1;
      const up = (bx - ax) / L < 0 ? -1 : 1;
      const nx = (up * (by - ay)) / L;
      const ny = (-up * (bx - ax)) / L; // normal on the upper side
      const at = (f, k) => [
        ax + (bx - ax) * f + nx * k * fs,
        ay + (by - ay) * f + ny * k * fs + (ny * k > 0 ? fs * 0.7 : 0),
      ];
      lab(
        `${nf(Math.hypot(sh.z2 - sh.z, sh.y2 - sh.y))} mm`,
        ...[0.5, 0.3, 0.7, 0.15, 0.85].flatMap(f => [at(f, 0.7), at(f, -0.9), at(f, 1.8), at(f, -2)]),
      );
      continue;
    }
    g.fill([P], { color: roleFill(sh, o.shape), stroke: roleLine(sh, o.shapeLine), width: 0.7 * o.lw.optic });
    if (sh.type === 'rect' && !sh.a) {
      const [X0, X1, Y0, Y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      lab(
        `${nf(sh.w)} mm`,
        [cx, Y0 - 0.4 * fs],
        [cx, Y1 + 1.1 * fs],
        [cx, Y0 - 1.4 * fs],
        [cx, Y1 + 2.1 * fs],
      );
      lab(
        `${nf(sh.h)} mm`,
        [[X1 + 0.4 * fs, cy + 0.35 * fs], 'left'],
        [[X0 - 0.4 * fs, cy + 0.35 * fs], 'right'],
        [[X1 + 0.4 * fs, Y0 + 0.9 * fs], 'left'],
        [[X0 - 0.4 * fs, Y1], 'right'],
      );
    } else if (sh.type === 'rect') {
      // turned: each size beside the middle of its edge, on the outside
      const C = M([0, sh.y, sh.z]);
      const mid = (u, v) => M(SH.at(sh, u, v));
      const side = (p, gap = 0.9) => {
        const dx = p[0] - C[0];
        const dy = p[1] - C[1];
        const L = Math.hypot(dx, dy) || 1;
        const ux = dx / L;
        const uy = dy / L;
        return [
          [p[0] + ux * gap * fs, p[1] + uy * gap * fs + (uy > 0.5 ? fs * 0.8 : uy < -0.5 ? 0 : 0.35 * fs)],
          ux > 0.5 ? 'left' : ux < -0.5 ? 'right' : 'center',
        ];
      };
      const wEdges = [mid(0, sh.h / 2), mid(0, -sh.h / 2)].sort((p, q) => p[1] - q[1]); // the edge higher on the page first
      const hEdges = [mid(sh.w / 2, 0), mid(-sh.w / 2, 0)].sort((p, q) => q[0] - p[0]); // the edge further right first
      lab(`${nf(sh.w)} mm`, ...wEdges.flatMap(p => [side(p), side(p, 2)]));
      lab(`${nf(sh.h)} mm`, ...hEdges.flatMap(p => [side(p), side(p, 2)]));
      const corners = P.map(q => side(q, 1.2));
      lab(`${nf(sh.a)}°`, [C[0], C[1] + 0.35 * fs], ...corners);
    } else
      lab(
        `Ø ${nf(sh.d)} mm`,
        [cx, cy + 0.35 * fs],
        [cx, Math.min(...ys) - 0.4 * fs],
        [cx, Math.max(...ys) + 1.1 * fs],
      );
  }
  // The figure (o.place) picks each text's spot: clear of every shape's outline, the optics and the texts already placed,
  // then of the rays; on the screen each text keeps its usual spot.
  const boxOf = (t, [p, align]) => {
    const w = g0.width(t, fs, o.font);
    const x = align === 'left' ? p[0] : align === 'right' ? p[0] - w : p[0] - w / 2;
    return [x, p[1] - 0.8 * fs, x + w, p[1] + 0.25 * fs];
  };
  const crosses = (b, [[ax, ay], [bx, by]]) => {
    let n = 0;
    for (let k = 0; k <= 16; k++) {
      const x = ax + ((bx - ax) * k) / 16;
      const y = ay + ((by - ay) * k) / 16;
      if (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]) n++;
    }
    return n;
  };
  const segsOf = (P, closed) =>
    (closed ? [...P, P[0]] : P).slice(1).map((q, k) => [(closed ? [...P, P[0]] : P)[k], q]);
  const shapeSegs = sys.shapes.flatMap((sh, n) =>
    outlines[n].length > 1 ? segsOf(outlines[n], sh.type !== 'line' && !Optics.isPart(sh)) : [],
  );
  const optSegs = o.place
    ? S.flatMap(s => segsOf((o.d3 ? [...(s.sl ?? []), ...rim3(s)] : s.prof).map(M), false))
    : [];
  const raySegs = o.place
    ? (o.fields ?? []).flatMap(j =>
        (T[j] ?? []).flatMap(rs =>
          segsOf(
            rs.map(q => M(q.p)),
            false,
          ),
        ),
      )
    : [];
  const placed = [];
  for (const { t, spots } of texts) {
    let best = spots[0];
    if (o.place && spots.length > 1) {
      let bc = Infinity;
      spots.forEach((sp, k) => {
        const b = boxOf(t, sp);
        const pad = [b[0] - 0.15 * fs, b[1] - 0.1 * fs, b[2] + 0.15 * fs, b[3] + 0.1 * fs];
        const ov = placed.reduce(
          (a, q) => a + (q[0] < pad[2] && q[2] > pad[0] && q[1] < pad[3] && q[3] > pad[1] ? 1 : 0),
          0,
        );
        const cost =
          60 * shapeSegs.reduce((a, sg) => a + crosses(pad, sg), 0) +
          40 * ov +
          20 * optSegs.reduce((a, sg) => a + crosses(pad, sg), 0) +
          0.5 * raySegs.reduce((a, sg) => a + crosses(pad, sg), 0) +
          0.3 * k;
        if (cost < bc) [bc, best] = [cost, sp];
      });
    }
    placed.push(boxOf(t, best));
    if (collect) collect.push({ t, p: best[0], align: best[1], fs });
    else g.text(t, best[0], { size: fs, color: o.mute, font: o.font, align: best[1] });
  }
}
/** The shape under screen point (mx, my): the selected one's handles or inside, else any shape's outline (within 6 px). */
function pickShape(mx, my) {
  const w = [0, (fy * (view.oy - my)) / view.s, (fz * (mx - view.ox)) / view.s];
  const sel = sys.shapes[shSel];
  if (sel) {
    const H = SH.handles(sel);
    const h = H.map(X).findIndex(([x, y]) => Math.hypot(x - mx, y - my) <= 7);
    if (h >= 0) return { k: shSel, part: SH.knob(sel) && h === H.length - 1 ? 'rot' : h };
    if (SH.inside(sel, w)) return { k: shSel, part: 'body' };
  }
  const seg = ([ax, ay], [bx, by]) => {
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((mx - ax) * dx + (my - ay) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(mx - ax - t * dx, my - ay - t * dy);
  };
  for (let k = sys.shapes.length - 1; k >= 0; k--) {
    const sh = sys.shapes[k];
    if (Optics.isSolid(sh) || Optics.isPart(sh) || Optics.isBeam(sh)) continue; // (scripts' envelopes, parts, beams: not edited here)
    const P = SH.outline(sh).map(X);
    const E = sh.type === 'line' ? P : [...P, P[0]];
    if (E.some((p, i) => i && seg(E[i - 1], p) <= 6)) return { k, part: 'body' };
  }
  return null;
}
/** Reshape during a drag from the shape as it was (sh0) with the pointer at world (z, y): 'new' (being drawn from o), 'body'
 *  (moved), or a handle index (a rectangle's corner against the opposite one, a circle's rim, a line's end). Shift: square, 15° steps. */
function reshape(sh, d, z, y, shift) {
  const snap = (z0, y0) => {
    if (!shift) return [z, y];
    const L = Math.hypot(z - z0, y - y0);
    const a = (Math.round(Math.atan2(y - y0, z - z0) / (Math.PI / 12)) * Math.PI) / 12;
    return [z0 + L * Math.cos(a), y0 + L * Math.sin(a)];
  };
  const box = (z0, y0) => {
    let dz = z - z0;
    let dy = y - y0;
    if (shift) {
      const m = Math.max(Math.abs(dz), Math.abs(dy));
      dz = Math.sign(dz || 1) * m;
      dy = Math.sign(dy || 1) * m;
    }
    Object.assign(sh, { z: z0 + dz / 2, y: y0 + dy / 2, w: Math.abs(dz), h: Math.abs(dy) });
  };
  const s0 = d.sh0;
  const [oz, oy] = d.o ?? [0, 0];
  if (d.part === 'new') {
    if (sh.type === 'rect') box(oz, oy);
    else if (sh.type === 'circle') sh.d = 2 * Math.hypot(z - oz, y - oy);
    else [sh.z2, sh.y2] = snap(oz, oy);
  } else if (d.part === 'body') {
    const dz = z - d.w0[2];
    const dy = y - d.w0[1];
    Object.assign(
      sh,
      { z: s0.z + dz, y: s0.y + dy },
      sh.type === 'line' && { z2: s0.z2 + dz, y2: s0.y2 + dy },
    );
  } else if (d.part === 'rot') {
    // turn about the centre by the pointer's angle change
    const [, cy, cz] = SH.centre(s0);
    const [, ky, kz] = SH.knob(s0);
    const from = Math.atan2(ky - cy, kz - cz);
    const to = Math.atan2(y - cy, z - cz);
    let by = ((to - from) * 180) / Math.PI;
    if (sh.type === 'rect') {
      let a = (s0.a || 0) + by;
      if (shift) a = Math.round(a / 15) * 15;
      sh.a = +((((a % 360) + 540) % 360) - 180).toFixed(9);
    } else {
      const a0 = (Math.atan2(s0.y2 - s0.y, s0.z2 - s0.z) * 180) / Math.PI;
      if (shift) by = Math.round((a0 + by) / 15) * 15 - a0;
      const t = (by * Math.PI) / 180;
      const c = Math.cos(t);
      const sn = Math.sin(t);
      const r = (py, pz) => [cy + (pz - cz) * sn + (py - cy) * c, cz + (pz - cz) * c - (py - cy) * sn];
      [sh.y, sh.z] = r(s0.y, s0.z);
      [sh.y2, sh.z2] = r(s0.y2, s0.z2);
    }
  } else if (sh.type === 'rect') {
    // a corner against the opposite one, in the rectangle's own frame
    const [, oy2, oz2] = SH.outline(s0)[(d.part + 2) % 4];
    const t = ((s0.a || 0) * Math.PI) / 180;
    const c = Math.cos(t);
    const sn = Math.sin(t);
    let u = (z - oz2) * c + (y - oy2) * sn;
    let v = -(z - oz2) * sn + (y - oy2) * c;
    if (shift) {
      const m = Math.max(Math.abs(u), Math.abs(v));
      u = Math.sign(u || 1) * m;
      v = Math.sign(v || 1) * m;
    }
    Object.assign(sh, {
      z: oz2 + (u * c - v * sn) / 2,
      y: oy2 + (u * sn + v * c) / 2,
      w: Math.abs(u),
      h: Math.abs(v),
    });
  } else if (sh.type === 'circle') sh.d = 2 * Math.hypot(z - s0.z, y - s0.y);
  else if (d.part === 0) [sh.z, sh.y] = snap(s0.z2, s0.y2);
  else [sh.z2, sh.y2] = snap(s0.z, s0.y);
}
let shSel = null;
let tool = null; // selected shape index; draw tool ('rect' | 'circle' | 'line')
function selectShape(k) {
  shSel = k;
  syncShapeBar();
}
function setTool(t) {
  tool = t;
  $('drawM')
    .querySelectorAll('button')
    .forEach(b => b.setAttribute('aria-pressed', b.dataset.s === t));
  cv.style.cursor = t ? 'crosshair' : '';
  if (t !== 'measure') meas = null;
  if (t)
    toast(
      {
        rect: 'Drag a rectangle (Shift: square)',
        circle: 'Drag a circle from its centre',
        line: 'Drag a line (Shift: 15° steps)',
        measure: 'Drag to measure',
      }[t] + ' · Esc ends',
    );
  draw();
}
/** The editor bar of the selected shape: its dimensions and position, typed exactly. */
const SHF = {
  rect: [
    ['w', 'W'],
    ['h', 'H'],
    ['a', 'angle °'],
    ['z', 'centre z'],
    ['y', 'y'],
  ],
  circle: [
    ['d', 'Ø'],
    ['z', 'centre z'],
    ['y', 'y'],
  ],
  line: [
    ['L', 'length'],
    ['a', 'angle °'],
    ['z', 'start z'],
    ['y', 'y'],
  ],
};
const shGet = (sh, k) =>
  k === 'L'
    ? Math.hypot(sh.z2 - sh.z, sh.y2 - sh.y)
    : k === 'a'
      ? sh.type === 'line'
        ? (Math.atan2(sh.y2 - sh.y, sh.z2 - sh.z) * 180) / Math.PI
        : sh.a || 0
      : sh[k];
function shSet(sh, k, v) {
  if (sh.type === 'line' && ['L', 'a', 'z', 'y'].includes(k)) {
    let L = shGet(sh, 'L');
    let a = (shGet(sh, 'a') * Math.PI) / 180;
    if (k === 'L') L = v;
    else if (k === 'a') a = (v * Math.PI) / 180;
    else sh[k] = v;
    return Object.assign(sh, { z2: sh.z + L * Math.cos(a), y2: sh.y + L * Math.sin(a) });
  }
  if (['w', 'h', 'd'].includes(k) && !(v > 0)) return;
  sh[k] = v;
}
function syncShapeBar() {
  const bar = $('shapeBar');
  const sh = sys?.shapes[shSel];
  if (!sh) {
    bar.hidden = true;
    bar.dataset.k = '';
    return;
  }
  if (bar.hidden || bar.dataset.k !== `${shSel}${sh.type}`) {
    bar.dataset.k = `${shSel}${sh.type}`;
    bar.innerHTML =
      `<b>${SH.name[sh.type]}</b>` +
      SHF[sh.type]
        .map(
          ([k, l]) =>
            `<label>${l} <input data-p="${k}" inputmode="decimal" aria-label="${SH.name[sh.type]} ${l}"></label>`,
        )
        .join('') +
      `<button class="popX" data-x aria-label="Delete the shape" title="Delete (Del)">×</button>`;
  }
  bar.hidden = false;
  bar.querySelectorAll('input').forEach(el => {
    if (el !== el.ownerDocument.activeElement) el.value = fmt(shGet(sh, el.dataset.p));
  });
}
$('shapeBar').oninput = e => {
  const k = e.target.dataset.p;
  const v = parse('x', e.target.value ?? '');
  if (!k || v === null) return;
  shSet(sys.shapes[shSel], k, v);
  update();
};
$('shapeBar').onclick = e => {
  if (e.target.closest('[data-x]')) deleteShape();
};
$('shapeBar').onkeydown = e => {
  if (e.key === 'Enter') e.target.blur();
};
function deleteShape() {
  if (!sys.shapes[shSel]) return;
  commit();
  sys.shapes.splice(shSel, 1);
  selectShape(null);
  update();
}
$('drawM').onclick = e => {
  const t = e.target.closest('[data-s]')?.dataset.s;
  if (t) setTool(tool === t ? null : t);
};
