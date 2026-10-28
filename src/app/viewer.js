// viewer.js — read-only pages. File ▸ Export read-only page writes the open design as one HTML file: this same app, with
// the design, the view and the docked popups in a viewerData block, which makes it start read-only. File ▸ Copy read-only
// link puts the same in a link to the hosted page (after "#v=", packed as share.js packs designs). Anyone can open either
// (the file needs no server or install; offline but for the web fonts) to look the system over: pan, zoom, orbit, hover the
// optics and the beam, pin and dock popups (values, footprints, spots, WFE, fringes, a double pass's way back), the watch
// window, the figure export. Nothing in it changes the system: no table edits, drags, inserts, solves, examples, files or
// extensions, and it stores nothing (so it can't touch the app's own designs or settings on the same site).
// One page or link per state of a system (a step of an alignment plan, say); each is self-contained, and the viewerData
// block is plain JSON, so pages can be made from designs by a script as well.

/** Disable every control in root (a read-only page: the table, a popup's values, the configurations strip). */
function lockInputs(root) {
  root?.querySelectorAll('input, select, textarea, button').forEach(el => (el.disabled = true));
}

/** The page's own source as one self-contained file, with `data` (the viewer's) in it: the markup as served (PAGE0, taken
 *  before any script ran), then every script of the app, inlined (the built page and the desktop app's already are; the
 *  source page's are fetched, which needs it served). Bundled extensions are left out. */
async function viewerHTML(data) {
  const at = typeof PAGE0 === 'string' ? PAGE0.lastIndexOf('<script', PAGE0.indexOf('window.PAGE0')) : -1;
  if (at < 0) throw Error('this page can’t copy itself');
  let markup = PAGE0.slice(0, at);
  const get = async f => {
    const r = await fetch(f);
    if (!r.ok) throw Error(`couldn’t read ${f}`);
    return r.text();
  };
  // the source page's own stylesheet (the built page's is inline already)
  const css = [...markup.matchAll(/<link rel="stylesheet" href="([^":]+)">/g)];
  const sheets = await Promise.all(css.map(m => get(m[1])));
  css.forEach((m, i) => (markup = markup.replace(m[0], () => `<style>\n${sheets[i]}</style>`)));
  const own = [...document.querySelectorAll('script')].filter(
    sc => !sc.type && !sc.id && !sc.textContent.trimStart().startsWith('window.PAGE0'),
  );
  const texts = await Promise.all(own.map(sc => (sc.src ? get(sc.src) : sc.textContent)));
  const end = '<' + '/script>\n'; // (written so, it doesn't end this file's own block in the built page)
  const json = JSON.stringify(data).replace(/</g, '\\u003c'); // (so nothing in it can end its block)
  return (
    '<!doctype html>\n' +
    markup +
    '<script>\n      window.PAGE0 = document.documentElement.outerHTML;\n    ' +
    end +
    `<script type="application/json" id="viewerData">${json}${end}` +
    texts.map(t => `<script>\n${t}${end}`).join('') +
    '</body>\n</html>\n'
  );
}

/** What a read-only page shows: the open design as it is now (its layout, view, docked and pinned popups, watch window). */
function viewerData() {
  const pinned = [...docks, ...(hov.pinned && hov.tgt ? [hov] : [])];
  return {
    v: 1,
    name: file.name.replace(/\.json$/i, ''),
    at: new Date().toISOString(),
    sys: JSON.parse(JSON.stringify(sys)),
    view: view && { ...view, cam },
    size: [cv.clientWidth, cv.clientHeight],
    pops: pinned.map(p => ({
      tgt: p.tgt,
      mode: p.mode ?? null,
      pos: [p.el.offsetLeft, p.el.offsetTop],
    })),
    watch: !$('watch').hidden && [$('watch').offsetLeft, $('watch').offsetTop], // (its place, when shown)
  };
}
/** File ▸ Export read-only page: viewerData in a page of its own, `<name>.html`. */
async function exportViewer() {
  const data = viewerData();
  let html;
  try {
    html = await viewerHTML(data);
  } catch (err) {
    return toast(
      `Couldn’t make the page: ${err.message}. Export from the hosted page or the desktop app (a page opened from disk can’t read its own scripts).`,
    );
  }
  download(`${data.name}.html`, new Blob([html], { type: 'text/html' }));
  toast(`Exported ${data.name}.html: read-only, as the view is now`);
}

/** File ▸ Copy read-only link: viewerData in a link to the hosted page (this one, when it is on the web), on the clipboard. */
async function copyViewerLink() {
  const link = `${shareBase()}#v=${await packDesign(viewerData())}`;
  try {
    await navigator.clipboard.writeText(link);
    toast(`Read-only link copied (${Math.round(link.length / 100) / 10}k characters)`);
  } catch {
    prompt('Copy this link:', link);
  }
}

/** A read-only page or link starting (main.js): its data from the viewerData block, or unpacked from the link (which takes a
 *  moment: a blank design shows until then). */
function viewerBoot() {
  const el = $('viewerData');
  if (el) return viewerStart(JSON.parse(el.textContent));
  const d0 = { id: 'blank', sys: NEW_DESIGN, file: { name: 'read-only.json' }, view: null, hist: null };
  docs.push(d0);
  activate(d0);
  hist.lock = true;
  unpackDesign(location.hash.slice(3)).then(
    D => {
      if (!D?.sys?.rows) throw Error('no design');
      viewerStart(D);
      docs.splice(docs.indexOf(d0), 1);
    },
    () => toast('That link doesn’t hold a design (it may be cut short)'),
  );
}

/** A read-only page starting with data D (viewerData): the design, frozen (no solves, no undo, nothing stored), the controls
 *  that would change it taken away, the view and popups as they were exported. */
function viewerStart(D) {
  document.body.classList.add('viewer');
  document.title = `${D.name} · Sloptical Design (read-only)`;
  const b = $('roBadge');
  b.hidden = false;
  b.textContent = `${D.name} · read-only${D.at ? ` · ${new Date(D.at).toLocaleString()}` : ''}`;
  hist.lock = true; // (what the update loop does for undo: shows the design exactly as it is, solving nothing)
  // the view, kept centred for this window's size
  let v = D.view;
  if (v && D.size?.[0] && cv.clientWidth) {
    const k = Math.min(cv.clientWidth / D.size[0], cv.clientHeight / D.size[1]);
    v = {
      ...v,
      s: v.s * k,
      ox: cv.clientWidth / 2 - k * (D.size[0] / 2 - v.ox),
      oy: cv.clientHeight / 2 - k * (D.size[1] / 2 - v.oy),
    };
  }
  const d = {
    id: 'viewer',
    sys: D.sys,
    file: { name: D.name + '.json', handle: null, saved: null },
    view: v,
    hist: null,
  };
  docs.push(d);
  activate(d);
  if (!v) {
    fit();
    draw();
  }
  for (const k of ['tracePop'])
    $(k)
      .querySelectorAll('input')
      .forEach(el => el.id !== 'airy' && (el.disabled = true));
  if (D.watch) {
    showWatch(true);
    if (Array.isArray(D.watch)) placeWatch(D.watch);
  }
  for (const q of D.pops ?? []) {
    const p = makePop();
    Object.assign(p, { tgt: q.tgt, mode: q.mode ?? undefined, pinned: true, docked: true, pos: q.pos });
    p.el.classList.add('docked', 'pinned');
    docks.push(p);
    renderPop(p);
  }
  draw();
}

// Keys that would change the system do nothing on a read-only page (view keys, H, W, D, T still work).
if (VIEWER)
  document.addEventListener(
    'keydown',
    e => {
      const k = e.key.toLowerCase();
      const edit =
        e.metaKey || e.ctrlKey
          ? ['z', 'y', 's', 'o'].includes(k)
          : !e.target.closest?.('input, textarea, select') &&
            ['a', 'm', 'b', 's', 'c', '[', ']', 'delete', 'backspace'].includes(k);
      if (edit) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    },
    true,
  );
