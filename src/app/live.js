// live.js — Live: poll a system file over http and reload it whenever it changes, so a script can drive the view. One mechanism
// for every browser (plain fetch): `python3 optic_live.py serve file.json` serves the file (and this page) with CORS, so
// it works whether this page is served, opened from disk, or hosted. index.html?watch=<url> starts watching on load.
// The file wins: edits made here are replaced by the next change (solves and locks still run on what is read).
// Half-written files are skipped until they parse.
const live = { on: false, url: null, txt: null, err: 0, ok: false, timer: 0, doc: null }; // doc: the id of the design it feeds
async function poll() {
  if (!live.on) return;
  try {
    let txt;
    if (live.path) {
      const r = await host.api.changed(live.path, live.mtime ?? 0);
      if (r?.missing) throw Error('the file is gone');
      if (r) live.mtime = r.mtime;
      txt = r ? r.text : live.txt;
    } else {
      const r = await fetch(live.url, { cache: 'no-store' });
      if (!r.ok) throw Error(`HTTP ${r.status}`);
      txt = await r.text();
    }
    if (txt !== live.txt) {
      const o = JSON.parse(txt);
      if (!o?.rows?.length) throw Error('not a Sloptical Design system');
      const d = docs.find(x => x.id === live.doc);
      if (!d) return watch(false);
      if (d === doc) {
        load(o, true);
        file.saved = JSON.stringify(sys);
        showName();
      } else {
        d.sys = o;
        d.file.saved = JSON.stringify(o);
        d.dirty = false;
        saveDocs();
        renderTabs();
      } // in the background: its tab updates
      live.txt = txt;
    }
    live.err = 0;
    live.ok = true;
  } catch (e) {
    if (++live.err === (live.ok ? 20 : 1))
      toast(`Can’t read ${live.url}${live.ok ? ' (still trying)' : ' (serve it with optic_live.py serve)'}`);
  }
  if (live.on) live.timer = setTimeout(poll, live.path ? 250 : 150);
}
function watch(on, url = null) {
  clearTimeout(live.timer);
  Object.assign(live, {
    on,
    url,
    txt: null,
    err: 0,
    ok: false,
    doc: on ? doc?.id : null,
    path: on && host.api && /^(\/|[A-Za-z]:[\\/])/.test(url ?? '') ? url : null,
    mtime: 0,
  });
  $('watchItem').querySelector('kbd').textContent = on ? '✓' : '';
  showName();
  if (on) {
    toast(`Watching ${url} for changes`);
    poll();
  }
}
async function toggleWatch() {
  if (live.on) return watch(false);
  if (host.api) {
    // the app: pick the file on disk; it is followed directly
    let f;
    try {
      f = await host.api.open(file.path ? dirOf(file.path) : host.dir);
    } catch (e) {
      return toast(`Couldn’t open: ${hostErr(e)}`);
    }
    if (!f) return;
    fresh();
    Object.assign(file, { name: f.name, path: f.path, handle: null });
    return watch(true, f.path);
  }
  const def =
    pref('optic_watch') ||
    (/^https?:/.test(location.protocol) ? file.name : 'http://localhost:8000/live/' + file.name);
  const u = await askName(
    def,
    'Watch a file: its URL (e.g. printed by optic_live.py), or a path next to this page',
    false,
  );
  if (!u) return;
  pref('optic_watch', u);
  Object.assign(file, {
    name: decodeURIComponent(u.split(/[/?#]/).filter(Boolean).pop() ?? u),
    handle: null,
  });
  watch(true, u);
}
