// figure.js — File ▸ Export figure (PDF).

// ── Figure export: the layout as a vector PDF, sized for a journal column. Same render() as the screen; the preview is
// the PDF drawn on a canvas. Options are remembered per browser.
const PAL = {
  okabe: ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#E69F00', '#56B4E9'],
  screen: FIELD,
  gray: ['#000000', '#6b6b6b', '#a3a3a3', '#383838', '#8a8a8a'],
  black: ['#000000'],
};
let fig = {
  W: 85,
  fields: null,
  beam: 'rays',
  col: 'okabe',
  shift: 0, // the fields' colours: the palette's from this one on (⟳ in the dialog cycles it)
  font: 'Helvetica',
  size: 7,
  lwO: 0.6,
  lwR: 0.3,
  labels: true,
  legend: true,
  scale: true,
  axes: false,
  blanks: true,
  full: false,
  shapes: true,
  conj: true,
  aoi: false,
  rot: 0,
  flipLR: false,
  flipUD: false,
  from: -1,
  to: -1,
  cfgs: null, // other configurations drawn (ids; null: those drawn on screen)
  ranges: {}, // with configurations: each one's first and last surface drawn, by id ([from, to] as from and to above)
  cfgStyle: 'faded',
};
/** The surfaces drawn, [first, last] (−1: from the pupil), of configuration k with n surfaces: its own range when the
 *  design has configurations (their optics differ, so their surface numbers do), else o.from and o.to. */
function figRange(o, k, n) {
  const [a, b] = sys.configs ? (o.ranges?.[sys.configs.list[k]?.id] ?? [-1, -1]) : [o.from, o.to];
  return [a ?? -1, b == null || b < 0 ? n - 1 : b];
}
/** Configuration k's colour in the figure: from the figure's palette, after the fields' colours (so a greyscale figure
 *  stays grey), cycled with them (⟳); as on screen for the screen palette. */
function figHue(o, k) {
  const sh = o.shift ?? 0;
  if (o.col === 'screen') return cfgHue(k + sh);
  const P = PAL[o.col];
  const r = k - (k > sys.configs.active ? 1 : 0); // among the other configurations
  return P[(sys.fields.length + r + sh) % P.length];
}
/** The other configurations the figure draws (their layouts, with k, range and hue), as the dialog chose (o.cfgs),
 *  else as on screen. */
function figGhosts(o) {
  const C = sys.configs;
  if (!C) return [];
  const ids = o.cfgs ?? C.show ?? [];
  return C.list.flatMap((c, k) => {
    if (k === C.active || !ids.includes(c.id)) return [];
    const L = layoutFor(k);
    return [{ ...L, k, range: figRange(o, k, L.S.length), hue: figHue(o, k) }];
  });
}
/** The configuration legend's entries for these ghosts (none without any): the active configuration first, each entry
 *  { k, t, x, row, rows } placed left to right and wrapped to rows within `width`. */
function cfgLegend(ghosts, o, width, w) {
  if (!ghosts.length) return [];
  const C = sys.configs;
  const out = [];
  let x = 0;
  let row = 0;
  for (const k of [C.active, ...ghosts.map(L => L.k)]) {
    const t = `${cfgLetter(k)} ${C.list[k].name}`;
    const span = 1.2 * o.size + w(t, o.size, o.font);
    if (x && x + span > width) [x, row] = [0, row + 1];
    out.push({ k, t, x, row });
    x += span + 1.5 * o.size;
  }
  return out.map(e => ({ ...e, rows: row + 1 }));
}
try {
  Object.assign(fig, JSON.parse(pref('optic_fig')) ?? {});
} catch {}
/** Page layout for the figure: fits everything drawn into the chosen width (points); a footer row holds legend and scale bar. */
function figure(o) {
  const pt = 72 / 25.4;
  const W = o.W * pt;
  const m = 2 * pt;
  const fs = o.fields.filter(j => j < sys.fields.length);
  if (o.beam !== 'rays' && !C.length) C = cones();
  const range = figRange(o, sys.configs?.active, S.length);
  const D = drawRange(range);
  const Sr = S.filter((_, i) => D.inR(i)); // first…last surface drawn
  const d3 = look3();
  if (d3) S.forEach(s => (s.sl = slice3(s))); // 3D: the figure is drawn as the view is
  const gh = figGhosts(o); // other configurations drawn
  const extent = () => [
    ...fs.flatMap(j => [...T[j], ...(d3 ? fanX()[j] : [])].flatMap(r => D.ray(sys.fields[j], r))),
    ...Sr.flatMap(s =>
      d3
        ? [
            ...s.sl,
            ...rim3(s),
            ...(s.mirror && o.blanks ? Optics.blankSolid(s, s.y0, s.y1, (s.y1 - s.y0) / 6, s.w3).back : []),
          ]
        : s.prof,
    ),
    ...(o.beam !== 'rays'
      ? fs.flatMap(j => (d3 ? ringC() : C)[j].filter(Boolean).flatMap(r => D.cone(sys.fields[j], r)))
      : []),
    ...(o.blanks && !d3
      ? Sr.filter(s => s.mirror).flatMap(s => Optics.blank(s, s.y0, s.y1, (s.y1 - s.y0) / 6))
      : []),
    ...(o.full ? Sr.filter(s => s.d).flatMap(s => Optics.parent(s, s.y0, s.y1)) : []),
    ...(o.shapes ? sys.shapes.flatMap(SH.outline) : []),
    ...(o.conj
      ? CJ.filter(D.conj).flatMap(c => [-1, 1].map(k => c.p.map((v, n) => v + k * c.half * c.e[n])))
      : []),
    ...(o.axes ? Sr.flatMap(s => (s.c && (s.d || s.k < 0) ? Optics.foci(s).filter(Boolean) : [])) : []),
  ];
  const P = [
    ...extent(),
    ...gh.flatMap(L =>
      withLayout(L, () => {
        // the other configurations drawn, each over its own range of surfaces
        if (o.beam !== 'rays' && !C.length) L.C = C = cones();
        if (d3) S.forEach(s => (s.sl = slice3(s)));
        const Dk = drawRange(L.range);
        return [
          ...fs.flatMap(j => [...T[j], ...(d3 ? fanX()[j] : [])].flatMap(r => Dk.ray(sys.fields[j], r))),
          ...S.filter((_, i) => Dk.inR(i)).flatMap(s => (d3 ? [...s.sl, ...rim3(s)] : s.prof)),
        ];
      }),
    ),
  ];
  // Orientation: as on screen (sys.flip), then turned by o.rot degrees (counter-clockwise) and mirrored (o.flipLR, o.flipUD).
  const θ = ((Number(o.rot) || 0) * Math.PI) / 180;
  const cs = Math.cos(θ);
  const sn = Math.sin(θ);
  const hx = o.flipLR ? -1 : 1;
  const hy = o.flipUD ? -1 : 1;
  const v1 = { s: 1, ox: 0, oy: 0, c: view?.c ?? [0, 0, 0], D: view?.D ?? 1e9 };
  const look = p => {
    const q = View3D.project(cam, v1, F3(p));
    return [q[0], -q[1]];
  }; // 3D: through the camera
  const pg = p => {
    const [a, b] = d3 ? look(p) : [fz * p[2], fy * p[1]];
    return [hx * (a * cs - b * sn), hy * (a * sn + b * cs)];
  }; // world → page [right, up] (mm)
  const Q = P.map(pg);
  const [x0, x1, y0, y1] = [0, 1].flatMap(k => [
    Math.min(...Q.map(q => q[k])),
    Math.max(...Q.map(q => q[k])),
  ]);
  const top = o.labels ? 1.4 * o.size : 0;
  const below = o.aoi ? 1.6 * o.size : 0;
  const cfgRows = o.legend ? (cfgLegend(gh, o, W - 2 * m, pdfWidth)[0]?.rows ?? 0) : 0;
  const foot = (o.legend || o.scale ? 2.6 * o.size : 0) + cfgRows * 1.6 * o.size;
  const pal = PAL[o.col].map((_, j, P) => P[(j + (o.shift ?? 0)) % P.length]); // cycled (⟳)
  const ro = {
    fields: fs,
    beam: o.beam,
    fc: j => pal[j % pal.length],
    ink: '#000000',
    mute: '#555555',
    glass: o.col === 'okabe' || o.col === 'screen' ? '#dbe7ef' : '#e6e6e6',
    glassLine: '#000000',
    blank: '#dcdcdc',
    blankLine: '#000000',
    font: o.font,
    size: o.size,
    lw: { optic: o.lwO, ray: o.lwR },
    labels: o.labels,
    axes: o.axes,
    blanks: o.blanks,
    full: o.full,
    shapes: o.shapes,
    shape: '#ececec',
    shapeLine: '#8c8c8c',
    conj: o.conj && '#c2255c',
    aoi: o.aoi,
    range,
    place: true,
    others: gh, // the other configurations drawn: their optics labelled too
    d3,
    rayAlpha: 1,
    coneAlpha: o.beam === 'both' ? 0.18 : 0.28,
    W: W - m,
  };
  // Text sits at fixed sizes beside the geometry (a shape's dimensions, labels), so it can reach past the drawing's own extent:
  // lay out, measure every piece of text render() draws, widen the margins (left, right, top, bottom) by any overflow, repeat.
  const lay = ([pl, pr, pt_, pb]) => {
    const s = (W - 2 * m - pl - pr) / (x1 - x0 || 1);
    const H = 2 * m + top + pt_ + (y1 - y0) * s + below + pb + foot;
    return {
      W,
      H,
      s,
      ro,
      M: p => {
        const [a, b] = pg(p);
        return [m + pl + (a - x0) * s, m + top + pt_ + (y1 - b) * s];
      },
      footY: H - m - 0.9 * o.size,
      m,
    };
  };
  const mw = (t, size, font) => {
    const c = (figure.ctx ??= document.createElement('canvas').getContext('2d')); // the preview's font (as wide or wider)
    c.font = `${size}px ${/serif|Times/i.test(font) && !/sans/i.test(font) ? 'Times, serif' : 'Helvetica, Arial, sans-serif'}`;
    return c.measureText(t).width;
  };
  let pad = [0, 0, 0, 0];
  let f = lay(pad);
  for (let it = 0; it < 6; it++) {
    const bx = [];
    const meas = {
      line() {},
      segs() {},
      fill() {},
      width: pdfWidth,
      text(t, [x, y], { size, align = 'left', font }) {
        const w = Math.max(pdfWidth(t, size, font), mw(t, size, font));
        const a = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
        bx.push([a, y - 0.8 * size, a + w, y + 0.25 * size]);
      },
    };
    render(textPen(meas, fig.edits), f.M, ro);
    if (!bx.length) break;
    const need = [
      m - Math.min(...bx.map(b => b[0])),
      Math.max(...bx.map(b => b[2])) - (W - m),
      m - Math.min(...bx.map(b => b[1])),
      Math.max(...bx.map(b => b[3])) - (f.H - m - foot),
    ].map(v => (v > 0.05 ? v + 0.5 : 0));
    if (!need.some(Boolean)) break;
    pad = pad.map((p, k) => p + need[k]);
    const side = pad[0] + pad[1];
    const cap = (W - 2 * m) / 2;
    if (side > cap) {
      pad[0] *= cap / side;
      pad[1] *= cap / side;
    } // the drawing keeps at least half the width
    f = lay(pad);
  }
  return Object.assign(f, { ghosts: gh });
}
/** A pen whose texts follow the figure's text edits (fig.edits: per text, the new text, or '' to leave it out) and moves
 *  (fig.moves: per text, [dx, dy] in points, dragged in the preview). A text is known by what it says and which of the
 *  texts saying that it is (in drawing order, the same for the preview and the PDF). A moved label's arrow is drawn from
 *  where the label ends up (none once it is next to its optic). boxes, if given, collects each text's box. */
function textPen(g, edits = {}, boxes, moves = {}) {
  const seen = {};
  return {
    ...g,
    leads: true,
    text(s, p, o) {
      const key = `${s}\u0001${(seen[s] = (seen[s] ?? -1) + 1)}`;
      const t = edits[key] ?? s;
      if (t === '') return;
      const mv = moves[key];
      const q = mv ? [p[0] + mv[0], p[1] + mv[1]] : p;
      g.text(t, q, o);
      const w = g.width(t, o.size, o.font);
      const x = o.align === 'right' ? q[0] - w : o.align === 'center' ? q[0] - w / 2 : q[0];
      const box = [x, q[1] - 0.85 * o.size, x + w, q[1] + 0.25 * o.size];
      const L = o.lead;
      if (L) leader(g, { fs: L.fs, lead: mv ? arrowFrom(box, L.to, L.fs) : L.lead }, o.leadO);
      boxes?.push({ key, orig: s, t, box, size: o.size, at: p });
    },
  };
}
/** An arrow from a text's box to point `to`: from the box's edge toward it, or none when the box is beside it already. */
function arrowFrom(b, to, fs) {
  if (!to) return null;
  const gap = Math.hypot(Math.max(b[0] - to[0], 0, to[0] - b[2]), Math.max(b[1] - to[1], 0, to[1] - b[3]));
  if (gap <= 1.3 * fs) return null;
  const c = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  const d = Math.hypot(to[0] - c[0], to[1] - c[1]);
  const e = [(to[0] - c[0]) / d, (to[1] - c[1]) / d];
  const k =
    Math.min(
      e[0] ? (b[2] - b[0]) / 2 / Math.abs(e[0]) : Infinity,
      e[1] ? (b[3] - b[1]) / 2 / Math.abs(e[1]) : Infinity,
    ) +
    0.25 * fs;
  return [[c[0] + e[0] * k, c[1] + e[1] * k], to];
}
function drawFigure(g, f, o) {
  // the other configurations under the active one, over the shapes (whose fill would hide them)
  const under = () => drawGhosts(g, f.M, f.ro, f.ghosts, o.cfgStyle === 'tinted' ? 0.85 : 0.4);
  render(g, f.M, f.ghosts.length ? { ...f.ro, under } : f.ro);
  if (o.legend) {
    let x = f.m; // field legend: a short line and the field
    for (const j of f.ro.fields) {
      g.line(
        [
          [x, f.footY - o.size * 0.35],
          [x + 3 * o.size, f.footY - o.size * 0.35],
        ],
        { color: f.ro.fc(j), width: Math.max(o.lwR, 0.5) },
      );
      g.text(fl(sys.fields[j]), [x + 3.5 * o.size, f.footY], {
        size: o.size,
        color: '#000000',
        font: o.font,
      });
      x += 4.2 * o.size + g.width(fl(sys.fields[j]), o.size, o.font);
    }
  }
  // the configurations drawn, in rows above the field legend: the active one, then the others in their colours
  if (o.legend)
    for (const it of cfgLegend(f.ghosts, o, f.W - 2 * f.m, g.width)) {
      const x = f.m + it.x;
      const y = f.footY - (it.rows - it.row) * 1.6 * o.size;
      const ghost = it.k !== sys.configs.active;
      g.fill(
        [
          [
            [x, y - o.size * 0.75],
            [x + 0.8 * o.size, y - o.size * 0.75],
            [x + 0.8 * o.size, y + o.size * 0.05],
            [x, y + o.size * 0.05],
          ],
        ],
        {
          color: ghost ? figHue(o, it.k) : '#555555',
          alpha: !ghost ? 1 : o.cfgStyle === 'tinted' ? 0.85 : 0.5,
        },
      );
      g.text(it.t, [x + 1.2 * o.size, y], { size: o.size, color: '#000000', font: o.font });
    }
  if (o.scale && !(cam.persp && !side)) scaleBar(g, [f.W - f.m, f.footY - o.size * 0.35], f.s, f.W / 4, f.ro);
}
function figureDialog() {
  fig.fields = (fig.fields ?? sys.fields.map((_, j) => j)).filter(j => j < sys.fields.length);
  if (!fig.fields.length) fig.fields = sys.fields.map((_, j) => j);
  const ids = {
    pW: 'W',
    pBeam: 'beam',
    pCol: 'col',
    pFont: 'font',
    pSize: 'size',
    pLwO: 'lwO',
    pLwR: 'lwR',
    pLabels: 'labels',
    pLegend: 'legend',
    pScale: 'scale',
    pAxes: 'axes',
    pBlanks: 'blanks',
    pFull: 'full',
    pShapes: 'shapes',
    pConj: 'conj',
    pRot: 'rot',
    pFlipLR: 'flipLR',
    pFlipUD: 'flipUD',
    pFrom: 'from',
    pTo: 'to',
    pAoi: 'aoi',
  };
  const opt = (v, t) => `<option value="${v}">${t.replace(/[&<]/g, c => `&#${c.charCodeAt(0)};`)}</option>`;
  // the From and To choices over the current layout's surfaces (a configuration's own, inside withLayout)
  const fromOpts = () =>
    opt(-1, 'the pupil (start)') + S.map((_, i) => opt(i, `${i + 1} · ${label(i)}`)).join('');
  const toOpts = () =>
    S.map((_, i) =>
      opt(i === S.length - 1 ? -1 : i, `${i + 1} · ${label(i)}${i === S.length - 1 ? ' (last)' : ''}`),
    ).join('');
  const C = sys.configs;
  const ns = C ? C.list.map((_, k) => (k === C.active ? S : layoutFor(k).S).length) : [S.length];
  const ok = ([a, b], n) => a >= -1 && a < n && b >= -1 && b < n - 1;
  // the ranges belong to one design (its configurations and their surfaces): another starts afresh
  const design = `${file.name}:${C ? C.list.map((c, k) => `${c.id}=${ns[k]}`).join() : ns[0]}`;
  if (
    fig.design !== design ||
    (C ? C.list.some((c, k) => !ok(fig.ranges?.[c.id] ?? [-1, -1], ns[k])) : !ok([fig.from, fig.to], ns[0]))
  ) {
    const vs = viewSpan(); // (a new design's figure starts from what the view draws: Show ▸ Draw from … to)
    Object.assign(fig, {
      from: vs?.[0] ?? -1,
      to: vs && vs[1] < S.length - 1 ? vs[1] : -1,
      ranges: C && sys.span && !Array.isArray(sys.span) ? structuredClone(sys.span) : {},
      design,
      edits: {},
      moves: {},
      cfgs: null,
    });
  }
  fig.ranges ??= {};
  $('pFrom').innerHTML = fromOpts();
  $('pTo').innerHTML = toOpts();
  $('pFrom').parentElement.hidden = $('pTo').parentElement.hidden = !!C; // with configurations: each its own, below
  for (const [id, k] of Object.entries(ids)) $(id)[$(id).type === 'checkbox' ? 'checked' : 'value'] = fig[k];
  $('pFields').replaceChildren(
    Object.assign(document.createElement('legend'), { textContent: 'Fields' }),
    ...sys.fields.map((f, j) => {
      const l = document.createElement('label');
      l.innerHTML = `<input type="checkbox" value="${j}"${fig.fields.includes(j) ? ' checked' : ''}> <span style="color:${fc(j)}">${fl(f)}</span>`;
      return l;
    }),
  );
  // Configurations: the active one always, and any others chosen (as on screen until changed here), each drawn from and
  // to surfaces of its own
  $('pCfgs').hidden = !C;
  if (C) {
    const on = fig.cfgs ?? C.show ?? [];
    const esc = t => String(t).replace(/[&<"]/g, c => `&#${c.charCodeAt(0)};`);
    $('pCfgs').innerHTML =
      '<legend>Configurations</legend>' +
      C.list
        .map((c, k) => {
          const act = k === C.active;
          const [from, to] = act
            ? [fromOpts(), toOpts()]
            : withLayout(layoutFor(k), () => [fromOpts(), toOpts()]);
          return (
            `<div class="cfgRow"><label${act ? ' title="The configuration shown: always drawn"' : ''}><input type="checkbox" data-cfg="${c.id}"${act || on.includes(c.id) ? ' checked' : ''}${act ? ' disabled' : ''}> <b data-k="${k}">${cfgLetter(k)}</b> ${esc(c.name)}</label>` +
            `<span>From</span><select data-from="${c.id}" title="The first surface drawn in ${esc(c.name)}, and where its rays start">${from}</select>` +
            `<span>To</span><select data-to="${c.id}" title="The last surface drawn in ${esc(c.name)}, and where its rays end">${to}</select></div>`
          );
        })
        .join('') +
      `<label title="How the other configurations are drawn, under the active one">Others <select id="pCfgStyle"><option value="faded">faded</option><option value="tinted">tinted</option></select></label>`;
    for (const c of C.list) {
      const [a, b] = fig.ranges[c.id] ?? [-1, -1];
      $('pCfgs').querySelector(`[data-from="${c.id}"]`).value = a;
      $('pCfgs').querySelector(`[data-to="${c.id}"]`).value = b;
    }
    $('pCfgStyle').value = fig.cfgStyle ?? 'faded';
  }
  /** Each configuration's range from its selects (the last surface never before the first); unchosen ones greyed. */
  const readRanges = () => {
    for (const c of C?.list ?? []) {
      const q = a => $('pCfgs').querySelector(a);
      const [f, t] = [q(`[data-from="${c.id}"]`), q(`[data-to="${c.id}"]`)];
      if (+t.value >= 0 && +t.value < +f.value) t.value = f.value;
      fig.ranges[c.id] = [+f.value, +t.value];
      f.disabled = t.disabled = !q(`[data-cfg="${c.id}"]`).checked;
    }
  };
  readRanges();
  const read = () => {
    for (const [id, k] of Object.entries(ids)) {
      const el = $(id);
      fig[k] =
        el.type === 'checkbox'
          ? el.checked
          : el.type === 'number' || ['pW', 'pFrom', 'pTo'].includes(id)
            ? +el.value
            : el.value;
    }
    if (fig.to >= 0 && fig.to < fig.from) {
      fig.to = fig.from;
      $('pTo').value = fig.from;
    } // the last surface is never before the first
    fig.fields = [...$('pFields').querySelectorAll('input:checked')].map(i => +i.value);
    if (sys.configs) {
      // the active one too: switch configurations and the one that was active stays in the figure
      fig.cfgs = [...$('pCfgs').querySelectorAll('input[data-cfg]:checked')].map(i => i.dataset.cfg);
      fig.cfgStyle = $('pCfgStyle').value;
      readRanges();
    }
    pref('optic_fig', JSON.stringify(fig));
    $('pFields')
      .querySelectorAll('span')
      .forEach((sp, j) => (sp.style.color = PAL[fig.col][(j + (fig.shift ?? 0)) % PAL[fig.col].length]));
    $('pColCycle').disabled = PAL[fig.col].length < 2;
    if (sys.configs)
      $('pCfgs')
        .querySelectorAll('b[data-k]')
        .forEach(b => (b.style.color = +b.dataset.k === sys.configs.active ? '' : figHue(fig, +b.dataset.k)));
    preview();
  };
  let boxes = [];
  let scale = 1; // the preview's texts (figure units) and its px per unit
  const preview = () => {
    const f = figure(fig);
    const c = $('pPrev');
    const r = devicePixelRatio;
    const k = (scale = Math.min(520 / f.W, 360 / f.H));
    c.width = f.W * k * r;
    c.height = f.H * k * r;
    c.style.width = f.W * k + 'px';
    c.style.height = f.H * k + 'px';
    const x = c.getContext('2d');
    x.setTransform(k * r, 0, 0, k * r, 0, 0);
    x.fillStyle = '#fff';
    x.fillRect(0, 0, f.W, f.H);
    boxes = [];
    drawFigure(textPen(canvasPen(x), fig.edits, boxes, fig.moves), f, {
      ...fig,
      font: fig.font === 'Times' ? 'Times, serif' : 'Helvetica, Arial, sans-serif',
    });
    $('pTextReset').hidden = !Object.keys(fig.edits ?? {}).length && !Object.keys(fig.moves ?? {}).length;
    $('pInfo').textContent =
      `${fig.W} × ${((f.H * 25.4) / 72).toFixed(0)} mm · vector PDF, text in ${fig.font}. The hosted viewer blocks downloads; use the local copy to save.`;
  };
  $('pColCycle').onclick = () => {
    fig.shift = ((fig.shift ?? 0) + 1) % PAL[fig.col].length; // each field to the next colour
    read();
  };
  $('pdfForm').oninput = e => {
    if (e.target.id !== 'pEdit') read();
  };
  fig.edits ??= {};
  fig.moves ??= {};
  read();
  // Text edits: double-click a text in the preview to change or remove it.
  const at = e => {
    const u = e.offsetX / scale;
    const v = e.offsetY / scale;
    return boxes.findLast(
      b => u >= b.box[0] - 1 && u <= b.box[2] + 1 && v >= b.box[1] - 1 && v <= b.box[3] + 1,
    );
  };
  // Drag a text to move it (kept on the page); a click without a drag does nothing, so a double-click still edits.
  let tdrag = null;
  $('pPrev').onpointerdown = e => {
    const b = at(e);
    if (!b || !$('pEdit').hidden) return;
    tdrag = { b, x: e.offsetX, y: e.offsetY, mv: fig.moves[b.key] ?? [0, 0], moved: false };
    $('pPrev').setPointerCapture(e.pointerId);
  };
  $('pPrev').onpointermove = e => {
    if (!tdrag) return void ($('pPrev').style.cursor = at(e) ? 'move' : '');
    const du = (e.offsetX - tdrag.x) / scale;
    const dv = (e.offsetY - tdrag.y) / scale;
    if (!(tdrag.moved ||= Math.hypot(du, dv) * scale > 3)) return;
    const { box } = tdrag.b;
    const [mu, mv] = tdrag.mv;
    const W = $('pPrev').width / devicePixelRatio / scale;
    const H = $('pPrev').height / devicePixelRatio / scale;
    const lim = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    fig.moves[tdrag.b.key] = [
      mu + lim(du, 1 - box[0], W - 1 - box[2]),
      mv + lim(dv, 1 - box[1], H - 1 - box[3]),
    ];
    preview();
  };
  $('pPrev').onpointerup = () => {
    if (tdrag?.moved) {
      const m = fig.moves[tdrag.b.key];
      if (m && Math.hypot(...m) < 0.01) delete fig.moves[tdrag.b.key];
      pref('optic_fig', JSON.stringify(fig));
    }
    tdrag = null;
  };
  $('pPrev').ondblclick = e => {
    const b = at(e);
    if (!b) return;
    const ed = $('pEdit');
    Object.assign(ed.style, { left: b.box[0] * scale - 4 + 'px', top: b.box[1] * scale - 4 + 'px' });
    ed.value = b.t;
    ed.hidden = false;
    ed.focus();
    ed.select();
    const done = keep => {
      if (ed.hidden) return;
      ed.hidden = true;
      ed.onkeydown = ed.onblur = null;
      if (keep) {
        if (ed.value === b.orig) delete fig.edits[b.key];
        else fig.edits[b.key] = ed.value;
        pref('optic_fig', JSON.stringify(fig));
        preview();
      }
    };
    ed.onkeydown = k => {
      if (k.key === 'Enter') {
        k.preventDefault();
        done(true);
      }
      if (k.key === 'Escape') {
        k.preventDefault();
        k.stopPropagation();
        done(false);
      }
    };
    ed.onblur = () => done(true);
  };
  $('pTextReset').onclick = () => {
    fig.edits = {};
    fig.moves = {};
    pref('optic_fig', JSON.stringify(fig));
    preview();
  };
  const d = $('pdfDlg');
  d.returnValue = '';
  d.showModal();
  d.onclose = () => {
    $('pEdit').hidden = true;
    if (d.returnValue !== 'ok') return;
    const f = figure(fig);
    const g = pdfPen();
    drawFigure(textPen(g, fig.edits, null, fig.moves), f, fig);
    download(
      file.name.replace(/\.json$/, '') + '.pdf',
      new Blob([pdfDoc(f.W, f.H, g, file.name.replace(/\.json$/, ''))], { type: 'application/pdf' }),
    );
    toast('Exported the figure (PDF)');
  };
}
