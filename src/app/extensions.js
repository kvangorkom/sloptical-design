// extensions.js — extensions: Python scripts that add popup tabs or export formats. They run on Pyodide (loaded from jsDelivr
// the first time one is used) in a Web Worker of their own: a script sees the design it is given and can trace rays (a copy
// of the engine runs there too), but it can't reach this page, what the page stores, or the desktop app's files. A script
// defines NAME, run(ctx) and optionally DESCRIPTION, TARGETS ('beam', 'surface', or 'export') and PARAMS (settings shown
// with it); run gets the context (a dict: system, surfaces, target plane, the rays there per field, settings; plus
// ctx.trace() and ctx.plane() to trace any ray) and returns a plot (see plotSpec), or for an export {filename, text, notes}
// (see exportDialog). Results arrive asynchronously; each place that shows one keeps its latest.
// Scripts are kept in this browser (localStorage) with their settings; see extensions/README.md for the interface.
const PYODIDE = 'https://cdn.jsdelivr.net/npm/pyodide@314.0.7/';
/** Pyodide's own files and their hashes: a file that doesn't match is refused. The packages it fetches (numpy, …) are
 *  checked against the hashes in pyodide-lock.json, so these cover everything it loads. Update them with PYODIDE (the
 *  files are the npm package's: openssl dgst -sha384 -binary FILE | openssl base64 -A). */
const PY_SRI = {
  'pyodide.mjs': 'sha384-Lp79fMwxa4n2BLtugpUAoQMlbxIdg8iCUiP1r3h7nJLkQjwlXT1JzZTeHVL+f4Dg',
  'pyodide.asm.mjs': 'sha384-/2281iaC0Iimw0B3Kagy1DBfZcJG3W4KYW+EmOqhsdY3fR9BJ88FE2Zt6y0KQKpa',
  'pyodide.asm.wasm': 'sha384-y++qrQ72KPA1fTjLIuGMP+jppgGxjbLCgfdb0zMrnNnQVhxRUXTOTF6rTxNzllSu',
  'python_stdlib.zip': 'sha384-xW3A5jmenkrPXbsgrIaB1FCJh9OuLT7FRMagsJMgtlhVc19k/mSy3+7nMaF/d767',
  'pyodide-lock.json': 'sha384-o8SQQvpVlZnOl04+3dFTJipKxul9GbViVusA379wlOrfHSgxbzt0yPiqCTxOiYES',
};
const PYBOOT = [
  'import json, math',
  'class Ctx(dict):',
  '    """The popup\'s context: a dict of data plus ray-trace helpers (see extensions/README.md in Sloptical Design)."""',
  '    def trace(self, field, px, py):',
  '        """States of the ray from pupil point (px, py) of the field, one per surface reached: dicts p, u (world), n, L."""',
  '        return json.loads(self._js.trace(field, px, py))',
  '    def plane(self, segment, s, field, px, py):',
  '        """The ray on the plane s mm along axis segment `segment` (0: pupil to the first surface; k: after surface k-1),',
  '        perpendicular to the axis: x, y (mm from the axis point), dx, dy, dz (direction cosines there), index, L. None if lost."""',
  '        return json.loads(self._js.plane(segment, s, field, px, py))',
  'def _clean(o):',
  '    if hasattr(o, "tolist"): o = o.tolist()',
  '    if isinstance(o, float): return o if math.isfinite(o) else None',
  '    if isinstance(o, dict): return {str(k): _clean(v) for k, v in o.items()}',
  '    if isinstance(o, (list, tuple)): return [_clean(v) for v in o]',
  '    return o',
  'def _call(run, data, js):',
  '    c = Ctx(json.loads(data)); c._js = js',
  '    return json.dumps(_clean(run(c)))',
].join('\n');
/** The worker's code, run as a module of its own (it uses nothing from this page). Messages, each answered with its req:
 *  init (the engine's sources, Pyodide's address and hashes, the bootstrap), load (a script: its interface back), run (a
 *  script on a context and the design's rows: its result as JSON), drop (forget a script). */
function pyWorker() {
  let py;
  let ready;
  const spaces = new Map(); // script id → its namespace
  let lay = { key: null };
  const layout = rows => {
    const key = JSON.stringify(rows);
    if (lay.key !== key) {
      const S = Optics.build(rows);
      lay = { key, S, AX: [{ p: [0, 0, 0], u: [0, 0, 1] }, ...S.map(s => ({ p: s.P, u: s.uOut }))] };
    }
    return lay;
  };
  /** ctx.trace and ctx.plane, on the design's own surfaces (the same engine as the page's). */
  const helpers = rows => {
    const { S, AX } = layout(rows);
    const ray = (f, px, py_) => [Optics.start(px, py_, f, S.beam), ...Optics.trace(S, px, py_, f)];
    return {
      trace: (f, px, py_) => JSON.stringify(ray(f, px, py_).map(q => ({ p: q.p, u: q.u, n: q.n, L: q.L }))),
      plane: (j, s, f, px, py_) => {
        const r = ray(f, px, py_);
        if (r.length <= j) return 'null';
        const u = AX[j].u;
        const ey = [0, u[2], -u[1]];
        const [q] = Optics.toPlane(
          [r[j]],
          AX[j].p.map((v, k) => v + s * u[k]),
          u,
        );
        const d = q.u;
        return JSON.stringify({
          x: q.xy[0],
          y: q.xy[1],
          dx: d[0],
          dy: d[1] * ey[1] + d[2] * ey[2],
          dz: d[0] * u[0] + d[1] * u[1] + d[2] * u[2],
          index: q.n,
          L: q.L,
        });
      },
    };
  };
  async function init({ engine, base, sri, boot }) {
    self.Optics = {};
    for (const src of engine) (0, eval)(`(${src})`)(self.Optics);
    const get = async f => {
      const r = await fetch(base + f, { integrity: sri[f] }).catch(() => {
        throw Error(`couldn’t load ${f}: no connection, or the file isn’t the one expected`);
      });
      if (!r.ok) throw Error(`couldn’t load ${f} (HTTP ${r.status})`);
      return r;
    };
    const fetch0 = self.fetch.bind(self);
    self.fetch = (u, o) => {
      const f = Object.keys(sri).find(k => String(u?.url ?? u) === base + k);
      return fetch0(u, f ? { ...o, integrity: sri[f] } : o);
    }; // Pyodide's own fetches (the wasm, the standard library, the lock file) are checked too
    const mod = async f =>
      import(URL.createObjectURL(new Blob([await (await get(f)).text()], { type: 'text/javascript' }))); // (checked, then run)
    const { loadPyodide } = await mod('pyodide.mjs');
    py = await loadPyodide({ indexURL: base, createPyodideModule: (await mod('pyodide.asm.mjs')).default });
    // what this site keeps in the browser is out of the scripts' reach
    for (const [o, k] of [
      [self, 'indexedDB'],
      [self, 'caches'],
      [self.WorkerGlobalScope?.prototype, 'indexedDB'],
      [self.WorkerGlobalScope?.prototype, 'caches'],
      [self.StorageManager?.prototype, 'getDirectory'],
    ])
      try {
        if (o) delete o[k];
      } catch {}
    py.runPython(boot);
  }
  self.onmessage = async ({ data: m }) => {
    const reply = o => self.postMessage({ req: m.req, ...o });
    try {
      if (m.t === 'init') {
        await (ready = init(m));
        return reply({ ok: true });
      }
      await ready;
      if (m.t === 'load') {
        await py.loadPackagesFromImports(m.code);
        const g = py.globals.get('dict')();
        py.runPython(m.code, { globals: g });
        const get = k => {
          const v = g.get(k);
          return v?.toJs ? v.toJs({ dict_converter: Object.fromEntries }) : v;
        };
        if (typeof g.get('run') !== 'function') throw Error('the script defines no run(ctx)');
        spaces.get(m.id)?.destroy();
        spaces.set(m.id, g);
        return reply({
          ok: { name: get('NAME'), desc: get('DESCRIPTION'), targets: get('TARGETS'), params: get('PARAMS') },
        });
      }
      if (m.t === 'drop') {
        spaces.get(m.id)?.destroy();
        spaces.delete(m.id);
        return reply({ ok: true });
      }
      if (m.t === 'run') {
        const g = spaces.get(m.id);
        if (!g) throw Error('the script isn’t loaded');
        return reply({ ok: py.globals.get('_call')(g.get('run'), m.ctx, helpers(m.rows)) });
      }
    } catch (e) {
      reply({ err: String(e?.message ?? e) });
    }
  };
}
let pyW = null; // the worker
let pyP = null; // its start (a promise)
let pySeq = 0;
const pyWait = new Map(); // req → { res, rej }
/** Ask the worker (once started): resolves with its answer, rejects with its error. */
function pyAsk(m) {
  return new Promise((res, rej) => {
    if (!pyW) return rej(Error('Python isn’t running'));
    const req = ++pySeq;
    pyWait.set(req, { res, rej });
    pyW.postMessage({ ...m, req });
  });
}
/** Python, started once on demand: the worker, with the engine and Pyodide loaded. */
function python() {
  return (pyP ??= (async () => {
    const src = `(${pyWorker})()`;
    pyW = new Worker(
      location.protocol === 'file:' // (a page opened from disk can't start a module worker from a blob)
        ? 'data:text/javascript,' + encodeURIComponent(src)
        : URL.createObjectURL(new Blob([src], { type: 'text/javascript' })),
      { type: 'module' }, // (Pyodide runs only in module workers)
    );
    pyW.onmessage = ({ data: d }) => {
      const w = pyWait.get(d?.req);
      if (!w) return;
      pyWait.delete(d.req);
      if (d.err !== undefined) w.rej(Error(String(d.err)));
      else w.res(d.ok);
    };
    pyW.onerror = ev => {
      for (const w of pyWait.values()) w.rej(Error(ev.message || 'Python stopped'));
      pyWait.clear();
    };
    await pyAsk({ t: 'init', engine: Optics.SOURCES, base: PYODIDE, sri: PY_SRI, boot: PYBOOT });
  })().catch(e => {
    pyW?.terminate();
    pyW = null;
    pyP = null;
    throw Error(`couldn’t start Python (Pyodide, from ${PYODIDE}): ${e.message ?? e}`);
  }));
}
/** Run extension e on target tg (null: an export) for `owner` (a popup, the export dialog, a watched value): returns the
 *  latest result there ({ out } or { err }; null before the first), and done(result) is called when a newer one arrives.
 *  Only the newest request waits, and the same script on the same context isn't run again. */
const extJobs = new WeakMap(); // owner → Map(script id → job)
function extRun(owner, e, tg, done) {
  if (!extJobs.has(owner)) extJobs.set(owner, new Map());
  const jobs = extJobs.get(owner);
  if (!jobs.has(e.id)) jobs.set(e.id, {});
  const j = jobs.get(e.id);
  j.done = done;
  const ctx = JSON.stringify(extCtx(e, tg));
  const sig = `${e.gen}\n${ctx}`;
  if (sig !== j.want) {
    j.want = sig;
    j.next = { t: 'run', id: e.id, ctx, rows: JSON.parse(JSON.stringify(sys.rows)) };
    if (!j.busy) extPump(j);
  }
  return j.res ?? null;
}
async function extPump(j) {
  j.busy = true;
  while (j.next) {
    const m = j.next;
    j.next = null;
    let r;
    try {
      const out = JSON.parse(await pyAsk(m));
      r = { out: out && typeof out === 'object' && !Array.isArray(out) ? out : {} };
    } catch (err) {
      r = { err };
    }
    j.res = r;
    if (!j.next) j.done?.(r);
  }
  j.busy = false;
}
// Two kinds: the extensions folder's scripts (source 'dir': read from extensions/ next to the page when it is served, or
// from a folder picked in the dialog, and kept in step with it) and scripts loaded one by one from anywhere ('file').
const exts = []; // {id, file, code, source, name, desc, targets, params, values, run?, err?, ready?}
try {
  exts.push(...(JSON.parse(localStorage.getItem('optic_ext')) ?? []));
} catch {}
/** NAME and TARGETS read from the source without running it, so the File menu and the popup tabs are right before Python loads. */
function peek(e) {
  if (e.run || !e.code) return e;
  const t = e.code.match(/^TARGETS\s*=\s*[[(]([^\])]*)[\])]/m);
  const n = e.code.match(/^NAME\s*=\s*(["'])(.*?)\1/m);
  if (t) e.targets = [...t[1].matchAll(/["'](\w+)["']/g)].map(x => x[1]);
  if (n) e.name = n[2];
  return e;
}
for (const e of exts) {
  if (e.example) e.source = 'dir';
  delete e.example;
  e.source ??= 'file';
  peek(e);
} // (earlier built-in example: now the folder's)
const saveExts = () => {
  try {
    localStorage.setItem(
      'optic_ext',
      JSON.stringify(
        exts.map(({ id, file, code, source, name, desc, targets, params, values }) => ({
          id,
          file,
          code,
          source,
          name,
          desc,
          targets,
          params,
          values,
        })),
      ),
    );
  } catch {}
};
const extFor = surf =>
  exts.filter(e => (e.targets ?? ['beam', 'surface']).includes(surf ? 'surface' : 'beam'));
/** Run a script's top level (in the worker, its own namespace) and read its interface; packages it imports load first. */
function loadExt(e) {
  return (e.ready ??= python()
    .then(() => pyAsk({ t: 'load', id: e.id, code: e.code }))
    .then(i => {
      // (what comes back is the script's to say: kept to plain data of the expected kinds)
      const P = i.params && typeof i.params === 'object' && !Array.isArray(i.params) ? i.params : {};
      Object.assign(e, {
        name: String(i.name ?? e.file),
        desc: String(i.desc ?? ''),
        targets: Array.isArray(i.targets) ? i.targets.map(String) : ['beam', 'surface'],
        params: Object.fromEntries(
          Object.entries(P).filter(
            ([k, d]) => d && typeof d === 'object' && !/^(__proto__|constructor|prototype)$/.test(k),
          ),
        ),
        run: true, // (loaded: it runs in the worker)
        gen: (e.gen ?? 0) + 1, // results from before a reload don't count
        err: null,
      });
      for (const [k, v] of Object.entries(e.params)) if (!(k in (e.values ??= {}))) e.values[k] = v.default;
      saveExts();
      renderExtList();
      update();
    })
    .catch(err => {
      e.err = String(err.message ?? err)
        .split('\n')
        .filter(l => l.trim())
        .slice(-3)
        .join(' ');
      e.ready = null;
      renderExtList();
      throw err;
    }));
}
/** Forget a script in the worker (removed, or about to load again). */
const dropExt = e => pyW && pyAsk({ t: 'drop', id: e.id }).catch(() => {});
async function addExt(file, code) {
  const e = peek({
    id: Math.random().toString(36).slice(2, 9),
    file,
    code,
    source: 'file',
    name: file.replace(/\.py$/i, ''),
    values: {},
  });
  exts.push(e);
  saveExts();
  renderExtList();
  $('extStatus').textContent = 'Loading Python… (the first time takes a few seconds)';
  try {
    await loadExt(e);
    $('extStatus').textContent =
      `Loaded ${e.name}: ${e.targets?.includes('export') ? `File ▸ Export ${e.name}…` : 'pin a beam or surface popup and choose its tab'}.`;
  } catch {
    $('extStatus').textContent = `${e.file}: ${e.err}`;
  }
}
function renderExtList() {
  const esc = t => String(t).replace(/[&<"]/g, c => `&#${c.charCodeAt(0)};`);
  $('xMenu').innerHTML = exts
    .filter(e => e.targets?.includes('export'))
    .map(
      e =>
        `<button role="menuitem" data-f="x:${e.id}" title="${esc(e.desc) || esc(e.name)}">Export ${esc(e.name)}…</button>`,
    )
    .join('');
  $('extList').innerHTML = exts.length
    ? exts
        .map(
          (e, k) =>
            `<div class="row"><div><b>${esc(e.name)}</b> <small>${e.source === 'bundle' ? 'built in: ' : e.source === 'dir' ? 'extensions/' : ''}${esc(e.file)}${e.desc ? ' · ' + esc(e.desc) : ''}</small>${e.err ? `<small class="err">${esc(e.err)}</small>` : ''}</div>` +
            `<button type="button" data-rel="${k}" title="Run the script again">Reload</button><button type="button" class="popX" data-del="${k}" aria-label="Remove ${esc(e.name)}">×</button></div>`,
        )
        .join('')
    : `<p style="margin:0;font-size:12px;color:var(--mute)">No extensions yet${location.protocol === 'file:' ? ': opened from disk, pick the extensions folder with Load a folder…' : ''}.</p>`;
}
$('extList').onclick = e => {
  const d = e.target.dataset;
  if (d.del !== undefined) {
    dropExt(exts[+d.del]);
    exts.splice(+d.del, 1);
    saveExts();
    renderExtList();
    update();
  }
  if (d.rel !== undefined) {
    const x = exts[+d.rel];
    Object.assign(x, { ready: null, run: null, err: null });
    dropExt(x);
    loadExt(x).catch(() => {});
  }
};
$('extLoad').onclick = () => $('pyFile').click();
$('pyFile').onchange = async e => {
  for (const f of [...e.target.files]) await addExt(f.name, await f.text());
  e.target.value = '';
};
/** Make the folder extensions match `files` ({name: code}): new ones are added, changed ones reload (lazily, when their
 *  tab is next shown), and ones no longer there are removed. Settings are kept. */
function syncFolder(files, source = 'dir') {
  for (const [file, code] of Object.entries(files)) {
    const e = exts.find(x => x.source === source && x.file === file);
    if (!e)
      exts.push(
        peek({
          id: Math.random().toString(36).slice(2, 9),
          file,
          code,
          source,
          name: file.replace(/\.py$/i, ''),
          values: {},
        }),
      );
    else if (e.code !== code) {
      dropExt(e);
      peek(Object.assign(e, { code, run: null, ready: null, err: null }));
    }
  }
  for (let k = exts.length - 1; k >= 0; k--)
    if (exts[k].source === source && !(exts[k].file in files)) dropExt(exts.splice(k, 1)[0]);
  saveExts();
  renderExtList();
  update();
}
/** Read extensions/*.py next to the page. Needs the page served over http (e.g. python3 optic_live.py serve …): the server's
 *  folder listing names the files. A page opened from disk can't list folders; there, pick the folder in the dialog. */
async function scanExtensions() {
  if (host.api)
    try {
      const files = await host.api.extensions();
      syncFolder(files);
      return Object.keys(files);
    } catch {
      return null;
    } // the desktop app reads the folder itself
  if (!/^https?:/.test(location.protocol)) return null;
  try {
    const r = await fetch('extensions/', { cache: 'no-store' });
    if (!r.ok) throw Error(`HTTP ${r.status}`);
    const names = [
      ...new Set(
        [...(await r.text()).matchAll(/href="([^"?#]+\.py)"/gi)].map(m =>
          decodeURIComponent(m[1]).split('/').pop(),
        ),
      ),
    ];
    const files = {};
    for (const f of names) {
      const q = await fetch('extensions/' + encodeURIComponent(f), { cache: 'no-store' });
      if (q.ok) files[f] = await q.text();
    }
    syncFolder(files);
    return Object.keys(files);
  } catch {
    return null;
  }
}
$('extScan').onclick = async () => {
  const got = await scanExtensions();
  $('extStatus').textContent = got
    ? `extensions/: ${got.length ? got.join(', ') : 'no .py files'}.`
    : location.protocol === 'file:'
      ? 'Opened from disk, the browser can’t read the extensions folder by itself: use Load a folder… (or serve the tool, e.g. python3 optic_live.py serve my.json).'
      : 'Couldn’t list extensions/ on this server (it needs a folder listing, as python3 optic_live.py serve gives).';
};
$('extDir').onclick = () => $('pyDir').click();
$('pyDir').onchange = async e => {
  const files = {};
  for (const f of [...e.target.files])
    if (/\.py$/i.test(f.name) && f.webkitRelativePath.split('/').length === 2) files[f.name] = await f.text(); // the folder's own .py files
  e.target.value = '';
  syncFolder(files);
  $('extStatus').textContent =
    `Loaded ${Object.keys(files).length} from the folder: ${Object.keys(files).join(', ') || 'no .py files'}.`;
};
function extDialog() {
  renderExtList();
  $('extStatus').textContent = '';
  $('extScan').hidden = !/^https?:/.test(location.protocol) || !!Object.keys(bundled).length;
  $('extDlg').showModal();
  if (!$('extScan').hidden) $('extScan').click();
}

/** Add the extension tabs that fit this popup's target (once per change of the list). */
function syncExtTabs(p, surf) {
  const m = p.el.querySelector('.popM');
  const want = extFor(surf);
  const key = want.map(e => e.id + e.name).join();
  if (m.dataset.ext === key) return;
  m.dataset.ext = key;
  m.querySelectorAll('[data-m^="ext:"]').forEach(b => b.remove());
  want.forEach(e => {
    const b = document.createElement('button');
    b.dataset.m = 'ext:' + e.id;
    b.textContent = e.name;
    b.title = e.desc || e.name;
    m.append(b);
  });
}
/** The context a script's run(ctx) receives (JSON; lengths in mm, angles in degrees, positions [y, z] in the layout's frame). */
function extCtx(e, tg) {
  const a = sys.rows[0].ap;
  const yz = v => [v[1], v[2]];
  const params = Object.fromEntries(
    Object.keys(e.params ?? {}).map(k => [k, e.values?.[k] ?? e.params[k].default]),
  );
  const ctx = {
    wavelength_um: sys.lambda,
    wavelengths_um: sys.lambdas ?? [sys.lambda],
    fields: sys.fields,
    field_unit: sys.rows[0].R ? 'mm' : 'deg',
    pupil: { semi_diameter: a, beam_R: S.beam },
    surfaces: S.map((q, k) => ({
      index: k,
      name: label(k),
      type: q.type,
      R: q.c ? 1 / q.c : 0,
      k: q.k,
      off_axis: q.d,
      normal_angle: q.th,
      tilt: q.tilt,
      t: sys.rows[k + 1].t,
      n_in: q.nIn,
      n_out: q.nOut,
      semi_aperture: q.ap,
      vertex: yz(q.V),
      axis: yz(q.ez),
      hit: yz(q.P),
      out_axis: yz(q.uOut),
      aoi_deg: q.aoi,
      foci: Optics.foci(q).map(f => f && yz(f)),
      tilt_y: sys.rows[k + 1].tiltY ?? 0,
      clock: sys.rows[k + 1].clock ?? 0, // 3D: the same in full [x, y, z] (the y–z pairs above drop x)
      xyz: {
        vertex: q.V,
        axis: q.ez,
        x_axis: q.ex ?? Optics.cross(q.ey, q.ez),
        y_axis: q.ey,
        hit: q.P,
        out_axis: q.uOut,
        foci: Optics.foci(q),
      },
    })),
    name: file.name.replace(/\.json$/, ''),
    system: JSON.parse(JSON.stringify(sys)),
    params,
  };
  if (!tg) return { ...ctx, target: { kind: 'export' } }; // an export: the whole system, no plane
  const { surf, i, j, s } = tg;
  const u = AX[j].u;
  const ey = [0, u[2], -u[1]];
  const Q = at(j, s);
  return {
    ...ctx,
    target: {
      kind: surf ? 'surface' : 'beam',
      surface: surf ? i : null,
      segment: j,
      s,
      point: yz(Q),
      axis: yz(u),
      after: j ? label(j - 1) : 'the pupil',
      xyz: { point: Q, axis: u },
    },
    footprint: sys.fields.map((f, fi) => {
      const rs = B[fi].filter(r => r.length > j);
      const pl = Optics.toPlane(
        rs.map(r => r[j]),
        Q,
        u,
      );
      return {
        field: f,
        pupil_x: rs.map(r => r[0].p[0]),
        pupil_y: rs.map(r => r[0].p[1]),
        x: pl.map(q => q.xy[0]),
        y: pl.map(q => q.xy[1]),
        dx: pl.map(q => q.u[0]),
        dy: pl.map(q => q.u[1] * ey[1] + q.u[2] * ey[2]),
        dz: pl.map(q => q.u[1] * u[1] + q.u[2] * u[2]),
      };
    }),
  };
}
/** An extension's tab: its settings above, its plot below. It runs again (in the worker) when what it is given changes;
 *  the latest plot stays up meanwhile. */
function renderExt(p, id, tg) {
  const e = exts.find(x => x.id === id);
  extControls(p, e);
  if (!e.run) {
    extDraw(p, e, null);
    if (!e.err)
      loadExt(e).then(
        () => p.tgt && renderPop(p),
        () => p.tgt && renderPop(p),
      );
    return;
  }
  const shown = () =>
    !p.el.hidden && p.el.querySelector('.popM [aria-pressed="true"]')?.dataset.m === 'ext:' + id;
  extDraw(
    p,
    e,
    extRun(p, e, tg, r => shown() && extDraw(p, e, r)),
  );
}
/** Draw a result in a popup's canvas: the plot, the error, or that it's on its way. */
function extDraw(p, e, r) {
  const pc = p.c;
  const dpr = devicePixelRatio;
  const W = 380;
  const H = 250;
  const g = pc.getContext('2d');
  pc.width = W * dpr;
  pc.height = H * dpr;
  pc.style.width = W + 'px';
  pc.style.height = H + 'px';
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const say = lines => {
    g.font = '11px ' + tok('--mono');
    g.fillStyle = tok('--mute');
    wrap(g, lines, W - 12)
      .slice(0, 16)
      .forEach((l, k) => g.fillText(l, 6, 16 + 14 * k));
  };
  if (!e.run)
    return say(e.err ? [`${e.name}: ${e.err}`] : ['Loading Python… (the first time takes a few seconds)']);
  if (!r) return say(['Running…']);
  if (r.err) return say([`${e.name} raised an error:`, ...pyErr(r.err)]);
  plotSpec(g, r.out, W, H);
}
/** The last lines of a Python traceback, without the bridge's own frame. */
function pyErr(err) {
  const tb = String(err.message ?? err).split('\n');
  const k = tb.findIndex(l => /in _call$/.test(l.trim()));
  return tb.filter((l, n) => l.trim() && n !== k).slice(-6);
}
/** An export extension (TARGETS ['export']): File ▸ Export <NAME>… opens this dialog, which shows its settings and runs it on
 *  the whole system (ctx.target.kind 'export'). run returns { filename, text, notes }: the text is previewed here to
 *  download or copy, the notes listed above it. It runs again whenever a setting changes. */
let xCur = null;
function exportDialog(id) {
  const e = exts.find(x => x.id === id);
  if (!e) return;
  xCur = { el: $('xDlg'), e, rerun: runExport, out: null };
  $('xH').textContent = `Export ${e.name}`;
  $('xDesc').textContent = e.desc || '';
  $('xText').value = '';
  $('xDlg').showModal();
  runExport(xCur);
}
function runExport(p) {
  const e = p.e;
  const esc = t => String(t).replace(/[&<]/g, c => `&#${c.charCodeAt(0)};`);
  const say = (lines, bad) => {
    $('xNotes').className = bad ? 'err' : '';
    $('xNotes').innerHTML = lines.map(l => `<li>${esc(l)}</li>`).join('');
  };
  extControls(p, e);
  p.out = null;
  if (!e.run) {
    $('xText').value = '';
    say([e.err ? `${e.name}: ${e.err}` : 'Loading Python… (the first time takes a few seconds)'], !!e.err);
    if (!e.err)
      loadExt(e).then(
        () => xCur === p && $('xDlg').open && runExport(p),
        () => xCur === p && $('xDlg').open && runExport(p),
      );
    return;
  }
  const show = r => {
    if (!r) return say(['Running…']);
    if (r.err) {
      $('xText').value = '';
      return say([`${e.name} raised an error:`, ...pyErr(r.err)], true);
    }
    const out = r.out;
    p.out = out;
    $('xText').value = typeof out.text === 'string' ? out.text : '';
    say(Array.isArray(out.notes) ? out.notes : []);
    $('xDesc').textContent = [e.desc, out.filename].filter(Boolean).join(' · ');
  };
  show(extRun(p, e, null, r => xCur === p && $('xDlg').open && show(r)));
}
$('xSave').onclick = () => {
  const o = xCur?.out;
  if (!o?.text) return;
  const name = String(o.filename || 'export.txt');
  download(name, new Blob([o.text], { type: 'text/plain' }));
  toast(`Exported ${name}`);
};
$('xCopy').onclick = () => {
  const o = xCur?.out;
  if (!o?.text) return;
  navigator.clipboard?.writeText(o.text).then(
    () => toast('Copied to the clipboard'),
    () => {
      $('xText').select();
      toast('Select the text and copy it');
    },
  );
};
/** Settings for the extension (PARAMS): 'surface' (an optic's index, 'previous', or with pupil: true also 'pupil'), 'number',
 *  'choice' (options) or 'bool'. */
function extControls(p, e) {
  const box = p.el.querySelector('.popE');
  const P = Object.entries(e?.params ?? {});
  const key = e?.id + JSON.stringify(e?.params) + S.map((_, k) => label(k)).join();
  if (box.dataset.k === key) return;
  box.dataset.k = key;
  const esc = escHTML; // (the settings are the script's to name: everything it says is escaped)
  const v = k => e.values?.[k] ?? e.params[k].default;
  const optics = [
    ['previous', 'previous optic'],
    ['pupil', 'entrance pupil'],
    ...S.map((_, n) => [n, label(n)]),
  ];
  box.innerHTML = P.map(
    ([k, d]) =>
      `<label>${esc(d.label ?? k)} ` +
      (d.type === 'surface'
        ? `<select data-p="${esc(k)}">${optics
            .filter(([o]) => o !== 'pupil' || d.pupil)
            .map(
              ([o, l]) =>
                `<option value="${esc(o)}"${String(v(k)) === String(o) ? ' selected' : ''}>${esc(l)}</option>`,
            )
            .join('')}</select>`
        : d.type === 'choice'
          ? `<select data-p="${esc(k)}">${(Array.isArray(d.options) ? d.options : []).map(o => `<option${String(v(k)) === String(o) ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`
          : d.type === 'bool'
            ? `<input type="checkbox" data-p="${esc(k)}"${v(k) ? ' checked' : ''}>`
            : `<input data-p="${esc(k)}" inputmode="decimal" value="${esc(v(k))}">`) +
      '</label>',
  ).join('');
  box.onchange = box.oninput = ev => {
    const el = ev.target;
    const k = el.dataset.p;
    const d = e.params[k];
    if (!k) return;
    const val =
      el.type === 'checkbox'
        ? el.checked
        : d.type === 'number'
          ? +el.value
          : d.type === 'surface' && /^\d+$/.test(el.value)
            ? +el.value
            : el.value;
    if (d.type === 'number' && !(el.value.trim() && isFinite(val))) return;
    e.values[k] = val;
    saveExts();
    (p.rerun ?? renderPop)(p);
  };
}
/** Greedy word wrap for canvas text. */
function wrap(g, lines, w) {
  return lines.flatMap(l => {
    const out = [];
    let cur = '';
    for (const word of String(l).split(' ')) {
      const t = cur ? cur + ' ' + word : word;
      if (g.measureText(t).width > w && cur) {
        out.push(cur);
        cur = word;
      } else cur = t;
    }
    return [...out, cur];
  });
}
/** Draw an extension's result: { series: [{x, y, label?, points?, color?}], xlabel, ylabel, xlog, ylog, xlim, ylim
 *  ([lo, hi], either null for automatic), hlines: [{y, label?}], vlines: [{x, label?}], notes: [text], title }. Series are
 *  lines, or dots with points: true; anything past a fixed limit is clipped. */
function plotSpec(g, o, W, H) {
  const ser = (o.series ?? []).map(sr => ({
    ...sr,
    pts: (sr.x ?? [])
      .map((x, k) => [x, sr.y?.[k]])
      .filter(
        ([x, y]) => Number.isFinite(x) && Number.isFinite(y) && (!o.xlog || x > 0) && (!o.ylog || y > 0),
      ),
  }));
  const notes = [...(o.title ? [o.title] : []), ...(o.notes ?? [])];
  g.font = '11px ' + tok('--mono');
  const nl = wrap(g, notes, W - 12);
  const bottom = H - 14 * nl.length - 4;
  const L = 52;
  const T = 10;
  const R = W - 10;
  const Bm = bottom - 30;
  nl.forEach((l, k) => {
    g.fillStyle = tok('--mute');
    g.fillText(l, 6, bottom + 14 * k + 12);
  });
  const all = ser.flatMap(sr => sr.pts);
  if (!all.length) return;
  const tr = log => (log ? v => Math.log10(v) : v => v);
  const fx = tr(o.xlog);
  const fy = tr(o.ylog);
  const hl = (o.hlines ?? []).map(h => h.y).filter(y => Number.isFinite(y) && (!o.ylog || y > 0));
  let [x0, x1] = [Math.min(...all.map(p => fx(p[0]))), Math.max(...all.map(p => fx(p[0])))];
  let [y0, y1] = [
    Math.min(...all.map(p => fy(p[1])), ...hl.map(fy)),
    Math.max(...all.map(p => fy(p[1])), ...hl.map(fy)),
  ];
  if (x1 === x0) {
    x0 -= 0.5;
    x1 += 0.5;
  }
  if (y1 === y0) {
    y0 -= 0.5;
    y1 += 0.5;
  }
  const pad = (y1 - y0) * 0.05;
  y0 -= pad;
  y1 += pad;
  const lim = (l, log, f) => (Number.isFinite(l) && (!log || l > 0) ? f(l) : null); // fixed limits (xlim / ylim: [lo, hi], null = auto)
  x0 = lim(o.xlim?.[0], o.xlog, fx) ?? x0;
  x1 = lim(o.xlim?.[1], o.xlog, fx) ?? x1;
  y0 = lim(o.ylim?.[0], o.ylog, fy) ?? y0;
  y1 = lim(o.ylim?.[1], o.ylog, fy) ?? y1;
  if (!(x1 > x0)) x1 = x0 + 1;
  if (!(y1 > y0)) y0 = y1 - (o.ylog ? 1 : Math.abs(y1) || 1);
  const X = v => L + ((fx(v) - x0) / (x1 - x0)) * (R - L);
  const Y = v => Bm - ((fy(v) - y0) / (y1 - y0)) * (Bm - T);
  const ticks = (a, b, log) => {
    if (log) {
      const out = [];
      for (let e = Math.ceil(a - 1e-9); e <= b + 1e-9; e++) out.push(10 ** e);
      return out.length >= 2 ? out : [10 ** a, 10 ** b];
    }
    const st = 10 ** Math.floor(Math.log10((b - a) / 4));
    const m = [1, 2, 5, 10].find(m => (b - a) / (m * st) <= 6) * st;
    const out = [];
    for (let v = Math.ceil(a / m) * m; v <= b + 1e-9 * m; v += m) out.push(+v.toPrecision(12));
    return out;
  };
  g.strokeStyle = tok('--line');
  g.fillStyle = tok('--mute');
  g.lineWidth = 1;
  g.setLineDash([]);
  g.font = '10px ' + tok('--mono');
  g.beginPath();
  g.moveTo(L, T);
  g.lineTo(L, Bm);
  g.lineTo(R, Bm);
  g.stroke();
  const lab = v =>
    Math.abs(v) >= 1e4 || (v && Math.abs(v) < 1e-3) ? v.toExponential(0) : String(+v.toPrecision(3));
  ticks(x0, x1, o.xlog).forEach(v => {
    const x = X(v);
    if (x < L - 1 || x > R + 1) return;
    g.beginPath();
    g.moveTo(x, Bm);
    g.lineTo(x, Bm + 3);
    g.stroke();
    g.textAlign = 'center';
    g.fillText(lab(v), x, Bm + 13);
  });
  ticks(y0, y1, o.ylog).forEach(v => {
    const y = Y(v);
    if (y < T - 1 || y > Bm + 1) return;
    g.beginPath();
    g.moveTo(L - 3, y);
    g.lineTo(L, y);
    g.stroke();
    g.textAlign = 'right';
    g.fillText(lab(v), L - 5, y + 3);
  });
  g.textAlign = 'center';
  g.fillText(o.xlabel ?? '', (L + R) / 2, Bm + 25);
  g.save();
  g.translate(11, (T + Bm) / 2);
  g.rotate(-Math.PI / 2);
  g.fillText(o.ylabel ?? '', 0, 0);
  g.restore();
  g.textAlign = 'left';
  g.save();
  g.beginPath();
  g.rect(L, T, R - L, Bm - T);
  g.clip();
  (o.hlines ?? []).forEach((h, k) => {
    if (!hl.includes(h.y) || fy(h.y) < y0 || fy(h.y) > y1) return;
    const y = Y(h.y); // only lines in range g.strokeStyle = tok('--mute'); g.setLineDash([3, 3]); g.beginPath(); g.moveTo(L, y); g.lineTo(R, y); g.stroke(); g.setLineDash([]);
    if (h.label) {
      g.fillStyle = tok('--mute');
      g.textAlign = k % 2 ? 'right' : 'left';
      g.fillText(h.label, k % 2 ? R - 4 : L + 4, y - 12 < T ? y + 11 : y - 3);
      g.textAlign = 'left';
    }
  }); // below the line when there's no room above   // alternate sides so close lines' labels don't collide
  (o.vlines ?? []).forEach(v => {
    if (!Number.isFinite(v.x) || (o.xlog && v.x <= 0) || fx(v.x) < x0 || fx(v.x) > x1) return;
    const x = X(v.x);
    g.strokeStyle = tok('--mute');
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(x, T);
    g.lineTo(x, Bm);
    g.stroke();
    g.setLineDash([]);
    if (v.label) {
      g.fillStyle = tok('--mute');
      g.fillText(v.label, x + 3, T + 10);
    }
  });
  ser.forEach((sr, k) => {
    g.strokeStyle = g.fillStyle = sr.color ?? (ser.length > 1 ? fc(k) : tok('--accent'));
    g.lineWidth = 1.5;
    if (sr.points) sr.pts.forEach(([x, y]) => g.fillRect(X(x) - 1.5, Y(y) - 1.5, 3, 3));
    else {
      g.beginPath();
      sr.pts.forEach(([x, y], n) => g[n ? 'lineTo' : 'moveTo'](X(x), Y(y)));
      g.stroke();
    }
  });
  g.restore();
  if (ser.length > 1)
    ser.forEach((sr, k) => {
      if (!sr.label) return;
      g.fillStyle = sr.color ?? fc(k);
      g.textAlign = 'right';
      g.fillText(sr.label, R - 2, T + 10 + 12 * k);
      g.textAlign = 'left';
    });
}
