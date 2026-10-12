// watch.js — the watch window: a small movable list of chosen values, kept with the design (sys.watch) and updated with every edit.
// Each item is { q, ri?, fi?, ext?, key? }: a quantity from WQ, for the surface in row ri and field fi where it needs them,
// or an extension's value (its run returns { values: { name: number | text } }). + adds one, × removes it. W shows or
// hides the window; drag it by its title.
const WG = { sys: 'System', opt: 'Optic', beam: 'Beam leaving the optic', map: 'Pictures (field)' };
const WQ = {
  // what can be watched: group, name, needs a surface (s) / a field (f), value
  efl: { g: 'sys', n: 'EFL', get: () => (wSys().afocal ? 'afocal' : wmm(wSys().efl)) },
  fno: { g: 'sys', n: 'f/#', get: () => (wSys().afocal ? '—' : nf(wSys().efl / 2 / sys.rows[0].ap)) },
  na: { g: 'sys', n: 'image NA', get: () => nf(wSys().na) },
  naObj: {
    g: 'sys',
    n: 'object NA',
    get: () =>
      sys.rows[0].R ? nf(Math.sin(Math.atan(sys.rows[0].ap / Math.abs(sys.rows[0].R)))) : '— (collimated)',
  },
  bfd: { g: 'sys', n: 'BFD', get: () => wmm(wSys().bfd) },
  mag: { g: 'sys', n: '|m|', get: () => (sys.rows[0].R ? nf(wSys().mag) + '×' : '— (collimated)') },
  plate: { g: 'sys', n: 'plate scale', get: () => (wSys().afocal ? '—' : `${nf(206265 / wSys().efl)}″/mm`) },
  size: { g: 'sys', n: 'layout size', get: () => `${nf(wSys().box[0])} × ${nf(wSys().box[1])} mm` },
  wfe: { g: 'sys', n: 'RMS WFE at the image', f: 1, get: w => `${nf(wImg(w.fi).σ)} λ` },
  strehl: { g: 'sys', n: 'Strehl at the image', f: 1, get: w => wImg(w.fi).strehl.toFixed(3) },
  spot: { g: 'sys', n: 'RMS spot at the image', f: 1, get: w => wmm(wImg(w.fi).rms) },
  airy: { g: 'sys', n: 'spot / Airy radius', f: 1, get: w => nf(wImg(w.fi).rms / wImg(w.fi).airy) + '×' },
  axcol: {
    g: 'sys',
    n: 'axial colour (focus, longest − shortest λ)',
    get: () => (wColor().ax === undefined ? '— (one λ)' : wmm(wColor().ax)),
  },
  latcol: {
    g: 'sys',
    n: 'lateral colour (chief ray at the image)',
    f: 1,
    get: w => (wColor().ax === undefined ? '— (one λ)' : wmm(wColor().lat(w.fi))),
  },
  pspot: {
    g: 'sys',
    n: 'RMS spot at the image, all λ',
    f: 1,
    get: w => {
      const last = S.length - 1;
      const pts = [B[w.fi], ...BW.map(b => b.B[w.fi])].flatMap(Bf =>
        Bf.filter(r => r.length > last + 1).map(r => r[last + 1].loc),
      );
      return wmm(Optics.spot(pts).rms);
    },
  },
  lost: {
    g: 'sys',
    n: 'rays lost',
    f: 1,
    get: w => `${Math.round(100 * (1 - B[w.fi].filter(r => r.length > S.length).length / B[w.fi].length))} %`,
  },
  R: { g: 'opt', n: 'R', s: 1, get: w => (sys.rows[w.ri].R ? wmm(sys.rows[w.ri].R) : '∞') },
  k: { g: 'opt', n: 'k', s: 1, get: w => nf(sys.rows[w.ri].k) },
  d: {
    g: 'opt',
    n: 'off-axis',
    s: 1,
    get: w =>
      sys.rows[w.ri].oa === 'angle'
        ? `${nf(sys.rows[w.ri].d)}° (${wmm(S[w.ri - 1].d)})`
        : wmm(sys.rows[w.ri].d),
  },
  tilt: { g: 'opt', n: 'tilt', s: 1, get: w => `${nf(sys.rows[w.ri].tilt)}°` },
  t: { g: 'opt', n: 'dist →', s: 1, get: w => wmm(sys.rows[w.ri].t) },
  n: {
    g: 'opt',
    n: 'index after',
    s: 1,
    get: w => (sys.rows[w.ri].type === 'mirror' ? '— (mirror)' : nf(sys.rows[w.ri].n)),
  },
  ap: { g: 'opt', n: 'semi-aperture', s: 1, get: w => (sys.rows[w.ri].ap ? wmm(sys.rows[w.ri].ap) : 'auto') },
  aoi: {
    g: 'opt',
    n: 'AOI (chief ray)',
    s: 1,
    get: w => (AOIc[w.ri - 1] ? aoiText(AOIc[w.ri - 1]).replace(/^AOI /, '') : '—'),
  },
  f: {
    g: 'opt',
    n: 'focal length',
    s: 1,
    get: w => {
      const s = S[w.ri - 1];
      const f = s.mirror ? -0.5 / s.c : s.nOut / (s.c * (s.nOut - s.nIn));
      return isFinite(f) ? wmm(f) : '∞';
    },
  },
  th: { g: 'opt', n: 'normal angle', s: 1, get: w => `${nf(S[w.ri - 1].th)}°` },
  F1: { g: 'opt', n: 'F1 from the vertex', s: 1, get: w => wFocus(w, 0) },
  F2: { g: 'opt', n: 'F2 from the vertex', s: 1, get: w => wFocus(w, 1) },
  hit: { g: 'opt', n: 'hit point (y, z)', s: 1, get: w => S[w.ri - 1].P.slice(1).map(nf).join(', ') + ' mm' },
  stig: {
    g: 'opt',
    n: 'stigmatic?',
    s: 1,
    get: w => ({ true: 'yes', false: 'no', null: '—' })[Optics.stigmatic(S, w.ri - 1)],
  },
  roc: {
    g: 'beam',
    n: 'beam ROC',
    s: 1,
    f: 1,
    get: w => {
      const b = wBeam(w);
      return !b.w
        ? '—'
        : Math.abs(b.R) > 1e6 * sys.rows[0].ap
          ? '∞ (collimated)'
          : `${b.R > 0 ? '+' : ''}${wmm(b.R)}`;
    },
  },
  rad: { g: 'beam', n: 'beam radius', s: 1, f: 1, get: w => wmm(wBeam(w).rad) },
  bfno: { g: 'beam', n: 'beam f/#', s: 1, f: 1, get: w => wBeam(w).fno },
  fp: {
    g: 'beam',
    n: 'footprint half-width',
    s: 1,
    f: 1,
    get: w => {
      const P = footprint(w.ri - 1, w.fi).map(q => q.loc);
      return P.length ? wmm(Math.max(...P.map(p => Math.hypot(...p)))) : '—';
    },
  },
  bspot: {
    g: 'beam',
    n: 'RMS spot on the plane',
    s: 1,
    f: 1,
    get: w => wmm(Optics.spot(wBeam(w).pl.map(q => q.xy)).rms),
  },
  bwfe: {
    g: 'beam',
    n: 'RMS WFE',
    s: 1,
    f: 1,
    get: w => {
      const b = wBeam(w);
      return b.w ? `${nf(b.rms)} λ` : '—';
    },
  },
  bpv: {
    g: 'beam',
    n: 'PV WFE',
    s: 1,
    f: 1,
    get: w => {
      const b = wBeam(w);
      return b.w ? `${nf(b.pv)} λ` : '—';
    },
  },
  mapW: {
    g: 'map',
    n: 'WFE map',
    s: 1,
    f: 1,
    pic: (w, g, P) => {
      const b = wBeam(w);
      if (!b.w) return;
      const a = sys.rows[0].ap;
      const sc = (P / 2 - 3) / a;
      const m = Math.max(1e-3, ...b.opd.map(Math.abs));
      const cell = ((2 * a) / (sys.grid - 1)) * sc + 0.6;
      b.w.pp.forEach((p, k) => {
        g.fillStyle = heat(b.opd[k] / m);
        g.fillRect(P / 2 + p[0] * sc - cell / 2, P / 2 - p[1] * sc - cell / 2, cell, cell);
      });
    },
  },
  mapS: {
    g: 'map',
    n: 'spot diagram',
    s: 1,
    f: 1,
    pic: (w, g, P) => {
      const pts = wBeam(w).pl.map(q => q.xy);
      if (!pts.length) return;
      const c = Optics.spot(pts);
      const R = 1.1 * Math.max(...pts.map(p => Math.hypot(p[0] - c.cx, p[1] - c.cy))) || 1;
      g.fillStyle = fc(w.fi);
      pts.forEach(p =>
        g.fillRect(
          P / 2 + ((p[0] - c.cx) / R) * (P / 2 - 3) - 0.75,
          P / 2 - ((p[1] - c.cy) / R) * (P / 2 - 3) - 0.75,
          1.5,
          1.5,
        ),
      );
    },
  },
  mapF: {
    g: 'map',
    n: 'footprint',
    s: 1,
    f: 1,
    pic: (w, g, P) => {
      const s = S[w.ri - 1];
      const pts = footprint(w.ri - 1, w.fi).map(q => q.loc);
      const R = 1.1 * Math.max(s.ap || 0, ...pts.map(p => Math.hypot(...p))) || 1;
      const sc = (P / 2 - 3) / R;
      if (s.ap) {
        g.strokeStyle = tok('--mute');
        g.beginPath();
        g.arc(P / 2, P / 2, s.ap * sc, 0, 7);
        g.stroke();
      }
      g.fillStyle = fc(w.fi);
      pts.forEach(p => g.fillRect(P / 2 + p[0] * sc - 0.75, P / 2 - p[1] * sc - 0.75, 1.5, 1.5));
    },
  },
};
const wmm = v => (isFinite(v) ? `${nf(v)} mm` : v === Infinity || v === -Infinity ? '∞' : '—');
let wCache = null; // per update: system values, image values per field, beams per surface and field
function wSys() {
  if (wCache.sys) return wCache.sys;
  const a = sys.rows[0].ap;
  const last = S.length - 1;
  const efl = Optics.efl(S, a * 1e-4);
  const img = footprint(last, 0);
  const ε = 1e-3 * a;
  const box = [2, 1].map(k => {
    const v = [...T.flat().flatMap(r => r.map(q => q.p[k])), ...S.flatMap(s => s.prof.map(p => p[k]))];
    return Math.max(...v) - Math.min(...v);
  });
  return (wCache.sys = {
    efl,
    afocal: !(Math.abs(efl) < 1e5 * a),
    na:
      img.length > 1
        ? Optics.na(
            img.map(q => q.u),
            img[0].n,
          )
        : NaN,
    bfd: last > 0 ? 1 / Optics.curv(S, last - 1, a * 1e-4) : NaN,
    mag: Math.abs(Optics.trace(S, 0, 0, ε)[last]?.loc[1] / ε),
    box,
  });
}
/** Colour between the shortest and longest wavelengths: the shift of the paraxial focus behind the last optic (ax), and
 *  the distance between their chief rays on the image (lat(fi)). Nothing (ax undefined) with one wavelength. */
function wColor() {
  return (wCache.color ??= (() => {
    const L = sys.lambdas;
    if (!L || L.length < 2 || S.length < 2) return {};
    const lo = Math.min(...L);
    const hi = Math.max(...L);
    const at = l => Optics.atWavelength(S, sys.rows, l, sys.lambda);
    const h = sys.rows[0].ap * 1e-4;
    const last = S.length - 1;
    const bfd = l => 1 / Optics.curv(at(l), last - 1, h);
    const chief = (l, f) => Optics.trace(at(l), 0, 0, f)[last]?.loc ?? [NaN, NaN];
    return {
      ax: bfd(hi) - bfd(lo),
      lat: fi => {
        const [a, b] = [chief(hi, sys.fields[fi]), chief(lo, sys.fields[fi])];
        return Math.hypot(a[0] - b[0], a[1] - b[1]);
      },
    };
  })());
}
function wImg(fi) {
  return (wCache['img' + fi] ??= (() => {
    const st = footprint(S.length - 1, fi);
    const w = Optics.wavefrontIn(S, B[fi]);
    const σ = w ? Math.sqrt(w.opd.reduce((s, v) => s + v * v, 0) / w.opd.length) / (sys.lambda * 1e-3) : NaN;
    return {
      σ,
      strehl: Math.exp(-((2 * Math.PI * σ) ** 2)),
      rms: Optics.spot(st.map(q => q.loc)).rms,
      airy: (0.61e-3 * sys.lambda) / wSys().na,
    };
  })());
}
/** The beam leaving surface ri − 1 (arriving, at the last), as its popup shows it: ROC, radius, working f/#, plane samples, WFE. */
function wBeam(w) {
  return (wCache[`b${w.ri}:${w.fi}`] ??= (() => {
    const i = w.ri - 1;
    const last = i === S.length - 1;
    const j = last ? i : i + 1;
    const sAt = last ? seg(i) : 0;
    const ww = Optics.wavefrontIn(S, B[w.fi], j);
    const pl = Optics.toPlane(
      B[w.fi].filter(r => r.length > j).map(r => r[j]),
      at(j, sAt),
      AX[j].u,
    );
    const mx = k => pl.reduce((v, q) => v + q.xy[k], 0) / pl.length;
    const NA =
      pl.length > 1
        ? Optics.na(
            pl.map(q => q.u),
            pl[0].n,
          )
        : NaN;
    const opd = ww ? ww.opd.map(v => v / (sys.lambda * 1e-3)) : [];
    const mean = opd.reduce((s, v) => s + v, 0) / (opd.length || 1);
    return {
      w: ww,
      R: ww ? ww.R - (sAt - ww.s0) : NaN,
      pl,
      opd,
      rad: pl.length ? Math.max(...pl.map(q => Math.hypot(q.xy[0] - mx(0), q.xy[1] - mx(1)))) : NaN,
      fno: !(NA >= 0) ? '—' : NA < 1e-6 ? '∞' : nf(1 / (2 * NA)),
      rms: Math.sqrt(opd.reduce((s, v) => s + (v - mean) ** 2, 0) / (opd.length || 1)),
      pv: opd.length ? Math.max(...opd) - Math.min(...opd) : NaN,
    };
  })());
}
const wFocus = (w, n) => {
  const s = S[w.ri - 1];
  const f = s.c ? Optics.foci(s)[n] : null;
  return f ? wmm((f[1] - s.V[1]) * s.ez[1] + (f[2] - s.V[2]) * s.ez[2]) : '∞ / none';
};
/** An extension's value for row ri: run it there as its surface popup would. undefined while Python loads. */
function wExt(w) {
  const e = exts.find(x => x.id === w.ext);
  if (!e) return { v: 'extension removed' };
  if (!e.run) {
    if (!e.err)
      loadExt(e).then(
        () => update(),
        () => update(),
      );
    return { v: e.err ? 'error' : '…' };
  }
  try {
    const i = w.ri - 1;
    const out =
      JSON.parse(
        pyRT.globals.get('_call')(
          e.run,
          JSON.stringify(extCtx(e, { surf: true, i, j: i, s: seg(i) })),
          extJS,
        ),
      ) ?? {};
    return { out, v: out.values?.[w.key] };
  } catch {
    return { v: 'error' };
  }
}
const wLabel = w => {
  const q = WQ[w.q];
  const name = w.ext ? `${exts.find(x => x.id === w.ext)?.name ?? 'extension'}: ${w.key}` : (q?.n ?? w.q);
  const who = w.ri < 0 ? 'not in this configuration' : w.ri ? label(w.ri - 1) : '';
  return `${who ? who + ' · ' : ''}${name}${(q?.f || w.ext) && w.fi !== undefined && sys.fields.length > 1 && !w.ext ? ` (${fl(sys.fields[w.fi])})` : ''}`;
};
/** Watched value w in configuration ci (not the active one): worked out on that configuration's layout, on the same optic. */
function wIn(ci, w, value) {
  if (w.ext) return '—'; // (extensions run on the active configuration only)
  const L = layoutFor(ci);
  let w2 = w;
  if (w.ri) {
    const id = w.rid ?? sys.rows[w.ri]?.id;
    const ri = L.rows.findIndex(r => r.id === id);
    if (ri < 1) return '—'; // not in that configuration
    w2 = { ...w, ri };
  }
  const keep = wCache;
  wCache = {};
  try {
    return withLayout(L, () => value(w2));
  } finally {
    wCache = keep;
  }
}
function renderWatch() {
  const list = $('wList');
  const items = sys.watch ?? [];
  wCache = {};
  const esc = t => String(t).replace(/[&<"]/g, c => `&#${c.charCodeAt(0)};`);
  const ok = w =>
    (!w.ri || (sys.rows[w.ri] && S[w.ri - 1])) && (w.fi === undefined || w.fi < sys.fields.length);
  list.innerHTML = items.length
    ? items
        .map((w, k) => {
          const q = WQ[w.q];
          const value = w => {
            let v;
            try {
              v = !ok(w) ? '—' : w.ext ? wExt(w).v : q?.pic ? '' : q ? q.get(w) : '?';
            } catch {
              v = '—';
            }
            if (typeof v === 'number') v = nf(v);
            return v === undefined || v === null ? '—' : v;
          };
          // With configurations: every configuration's value side by side, each after its letter (pictures: the active one)
          const C = sys.configs;
          const val =
            C && !q?.pic
              ? `<span class="wV wCfgs">${C.list
                  .map(
                    (_, ci) =>
                      `<span><b style="color:${cfgHue(ci)}">${cfgLetter(ci)}</b>${esc(ci === C.active ? value(w) : wIn(ci, w, value))}</span>`,
                  )
                  .join('')}</span>`
              : q?.pic
                ? ''
                : `<span class="wV">${esc(value(w))}</span>`;
          return (
            `<div class="wRow${q?.pic ? ' pic' : ''}${C && !q?.pic ? ' cfgs' : ''}" data-k="${k}"><span class="wL" title="${esc(wLabel(w))}">${esc(wLabel(w))}</span>${val}` +
            `<button class="wX" data-x="${k}" aria-label="Stop watching ${esc(wLabel(w))}" title="Remove">×</button>${q?.pic ? '<canvas></canvas>' : ''}</div>`
          );
        })
        .join('')
    : '<div class="wEmpty">Nothing watched yet: + adds a value.</div>';
  list.querySelectorAll('.wRow.pic').forEach(el => {
    const w = items[+el.dataset.k];
    const c = el.querySelector('canvas');
    const P = 80;
    const r = devicePixelRatio;
    const g = c.getContext('2d');
    c.width = c.height = P * r;
    c.style.width = c.style.height = P + 'px';
    g.setTransform(r, 0, 0, r, 0, 0);
    g.clearRect(0, 0, P, P);
    g.strokeStyle = tok('--line');
    g.strokeRect(0.5, 0.5, P - 1, P - 1);
    try {
      if (ok(w)) WQ[w.q].pic(w, g, P);
    } catch {}
  });
}
$('wList').onclick = e => {
  const k = e.target.dataset.x;
  if (k === undefined) return;
  commit();
  sys.watch.splice(+k, 1);
  update();
};
/** The add form: the quantity (grouped), then the optic and field it needs; an extension's values are listed after a run there. */
function renderPick() {
  const optics = S.map((_, i) => `<option value="${i + 1}">${label(i)}</option>`).join('');
  const fields = sys.fields.map((f, j) => `<option value="${j}">field ${fl(f)}</option>`).join('');
  const xs = exts.filter(e => e.targets?.some(t => t === 'surface' || t === 'beam'));
  $('wQ').innerHTML =
    Object.entries(WG)
      .map(
        ([g, gn]) =>
          `<optgroup label="${gn}">${Object.entries(WQ)
            .filter(([, q]) => q.g === g)
            .map(([k, q]) => `<option value="${k}">${q.n}</option>`)
            .join('')}</optgroup>`,
      )
      .join('') +
    (xs.length
      ? `<optgroup label="Extensions">${xs.map(e => `<option value="ext:${e.id}">${e.name}</option>`).join('')}</optgroup>`
      : '');
  $('wS').innerHTML = optics;
  $('wF').innerHTML = fields;
  pickShow();
}
function pickShow() {
  const v = $('wQ').value;
  const q = WQ[v];
  const ext = v.startsWith('ext:');
  $('wS').hidden = !(q?.s || ext);
  $('wF').hidden = !q?.f || sys.fields.length < 2;
  $('wK').hidden = !ext;
  $('wPick').querySelector('[type=submit]').disabled = false;
  if (ext) {
    const r = wExt({ ext: v.slice(4), ri: +$('wS').value });
    const out = r.out;
    const keys = Object.keys(out?.values ?? {});
    $('wK').innerHTML = keys.length
      ? keys.map(k => `<option>${k}</option>`).join('')
      : `<option value="">${out ? 'no values to watch here' : r.v === 'error' ? 'it couldn’t run (see Extensions)' : 'loading Python…'}</option>`;
    $('wPick').querySelector('[type=submit]').disabled = !keys.length;
  }
}
$('wQ').onchange = $('wS').onchange = pickShow;
$('wAdd').onclick = () => {
  const f = $('wPick');
  f.hidden = !f.hidden;
  if (!f.hidden) {
    renderPick();
    $('wQ').focus();
  }
};
$('wCancel').onclick = () => ($('wPick').hidden = true);
$('wPick').onsubmit = e => {
  e.preventDefault();
  const v = $('wQ').value;
  const q = WQ[v];
  const ext = v.startsWith('ext:');
  const w = ext
    ? { q: 'ext', ext: v.slice(4), key: $('wK').value, ri: +$('wS').value }
    : { q: v, ...(q.s && { ri: +$('wS').value }), ...(q.f && { fi: +$('wF').value || 0 }) };
  if (ext && !w.key) return;
  commit();
  (sys.watch ??= []).push(w);
  $('wPick').hidden = true;
  update();
};
function showWatch(on) {
  $('watch').hidden = !on;
  $('watchBtn').checked = on;
  pref('optic_watch', on ? 'on' : 'off');
  if (on) {
    placeWatch();
    renderWatch();
  }
}
function placeWatch(pos) {
  const el = $('watch');
  const m = $('main');
  pos ??= JSON.parse(pref('optic_watch_pos') || 'null');
  if (pos) {
    el.style.left = Math.max(0, Math.min(pos[0], m.clientWidth - el.offsetWidth)) + 'px';
    el.style.top = Math.max(0, Math.min(pos[1], m.clientHeight - 40)) + 'px';
    el.style.right = 'auto';
  }
  el.style.maxHeight = Math.max(60, m.clientHeight - el.offsetTop - 8) + 'px';
} // never past the view's bottom edge
$('watchBtn').onchange = e => showWatch(e.target.checked);
$('wHide').onclick = () => showWatch(false);
$('watch').querySelector('.wH').onpointerdown = e => {
  if (e.target.closest('button')) return;
  const el = $('watch');
  const h = e.currentTarget;
  const x0 = e.clientX - el.offsetLeft;
  const y0 = e.clientY - el.offsetTop;
  h.setPointerCapture(e.pointerId);
  h.onpointermove = m => placeWatch([m.clientX - x0, m.clientY - y0]);
  h.onpointerup = () => {
    h.onpointermove = null;
    pref('optic_watch_pos', JSON.stringify([el.offsetLeft, el.offsetTop]));
  };
};
onDoc('keydown', e => {
  if (
    e.key.toLowerCase() !== 'w' ||
    e.ctrlKey ||
    e.metaKey ||
    e.altKey ||
    e.repeat ||
    e.target.closest?.('input, textarea, select, dialog')
  )
    return;
  e.preventDefault();
  showWatch($('watch').hidden);
});
