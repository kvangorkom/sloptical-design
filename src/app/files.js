// files.js — files: Open / Save / Save as (JSON), per design. Where the browser can write files (Chrome, Edge: the File System
// Access API), Save writes back to the design's own file, silently once it has one (the file handle is kept in IndexedDB,
// so this survives a reload; the browser may ask once to allow editing), and Save as always asks where. Elsewhere
// (Firefox, Safari) a browser can't write to a file it opened: Save downloads the design under its name, Save as asks for
// a name first. Embedded in another page (the hosted viewer), downloads may be blocked, so the text is also offered to copy.
const file = { name: 'untitled.json', handle: null, saved: null, base: null, path: null }; // the active design's file (base: a never-saved design as it started; path: on disk, in the desktop app)
const framed = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();
/** Save a blob as a download. Firefox only follows a link that is in the page; a generic type keeps Safari from showing the
 *  file in a tab instead of saving it. Call it from the user's click (Safari and Firefox may ignore it later). */
const download = (name, blob) => {
  if (host.api) return hostSave(name, blob);
  const url = URL.createObjectURL(new Blob([blob], { type: 'application/octet-stream' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name, rel: 'noopener' });
  a.style.cssText = 'position:fixed;left:-9999px';
  document.body.append(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 6e4);
};
// A dialog's Cancel button doesn't submit its form, so Enter in a field takes the main action (it was the first button, so
// Enter used to cancel: Save as asked for a name and then did nothing).
document
  .querySelectorAll('dialog .dlgCancel')
  .forEach(b => (b.onclick = () => b.closest('dialog').close('cancel')));
/** File handles by design id (IndexedDB; structured-cloneable), so Save keeps writing to the same file after a reload. */
const idb = (() => {
  let p = null;
  const db = () =>
    (p ??= new Promise((res, rej) => {
      const r = indexedDB.open('optic_sketch', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('handles');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
  const tx = (mode, f) =>
    db().then(
      d =>
        new Promise((res, rej) => {
          const t = d.transaction('handles', mode);
          const q = f(t.objectStore('handles'));
          t.oncomplete = () => res(q.result);
          t.onerror = () => rej(t.error);
        }),
    );
  return {
    get: k => tx('readonly', s => s.get(k)).catch(() => null),
    set: (k, v) => tx('readwrite', s => s.put(v, k)).catch(() => {}),
    del: k => tx('readwrite', s => s.delete(k)).catch(() => {}),
  };
})();
/** Ask for a file name (ext: as .json) or a URL. onOk(name) runs right in the click or Enter that confirms it, so a download
 *  it starts counts as the user's own (Safari and Firefox can drop downloads started later); the promise gives the name too. */
const askName = (def, title = 'Save as', ext = true, onOk) =>
  new Promise(res => {
    const d = $('nameDlg');
    const f = d.querySelector('form');
    const val = () => {
      const v = $('nameIn').value.trim();
      return v ? (ext ? v.replace(/(\.json)?$/i, '.json') : v) : null;
    };
    $('nameH').textContent = title;
    $('nameOk').textContent = ext ? 'Save' : 'Watch';
    $('nameIn').value = def;
    d.returnValue = '';
    d.showModal();
    $('nameIn').select();
    let done = false;
    f.onsubmit = e => {
      const v = val();
      if (!v) {
        e.preventDefault();
        return;
      }
      done = true;
      onOk?.(v);
    }; // still within the user's gesture
    d.onclose = () => {
      f.onsubmit = null;
      res(done && d.returnValue === 'ok' ? val() : null);
    };
  });
/** Unsaved changes: since the last save, or for a design never saved, since it was created (file.base). */
const isDirty = (json, f) => json !== (f.saved ?? f.base);
const showName = () => {
  const d = $('docName');
  d.textContent = `${file.name}${isDirty(JSON.stringify(sys), file) ? ' •' : ''}`;
  d.title = `${file.name} (• unsaved changes)`;
  d.classList.toggle('live', live.on && live.doc === doc?.id);
  renderTabs();
};
async function save(as) {
  const txt = JSON.stringify(sys, null, 1);
  const d = doc;
  const snap = JSON.stringify(sys);
  if (host.api)
    try {
      // the desktop app: real files
      const r =
        !as && file.path
          ? await host.api.write(file.path, txt)
          : await host.api.save_as(file.name, txt, file.path ? dirOf(file.path) : host.dir);
      if (!r) return; // cancelled
      Object.assign(d === doc ? file : d.file, { name: r.name, path: r.path, handle: null, saved: snap });
      host.dir = r.dir;
      update();
      return toast(`Saved ${r.path}`);
    } catch (e) {
      return toast(`Couldn’t save: ${hostErr(e)}`);
    }
  if (window.showSaveFilePicker && !framed)
    try {
      let h = as ? null : file.handle; // Save: the design's own file, if it has one and may be written
      if (
        h &&
        ((await h.queryPermission?.({ mode: 'readwrite' })) ?? 'granted') !== 'granted' &&
        (await h.requestPermission?.({ mode: 'readwrite' })) !== 'granted'
      )
        h = null;
      h ??= await showSaveFilePicker({
        suggestedName: file.name,
        types: [{ description: 'Sloptical Design system', accept: { 'application/json': ['.json'] } }],
      });
      const w = await h.createWritable();
      await w.write(txt);
      await w.close();
      const f = d === doc ? file : d.file;
      Object.assign(f, { name: h.name, handle: h, saved: snap });
      idb.set(d.id, h);
      update();
      return toast(`Saved ${h.name}${as ? '' : ' (to the file itself)'}`);
    } catch (e) {
      if (e.name === 'AbortError') return;
      file.handle = null;
    } // cancelled; otherwise fall back to a download
  const get = as || file.saved === null; // never saved, or Save as: ask, then download from that click
  const name = get
    ? await askName(file.name, 'Save as', true, n =>
        download(n, new Blob([txt], { type: 'application/json' })),
      )
    : file.name;
  if (!name) return;
  if (!get) download(name, new Blob([txt], { type: 'application/json' }));
  Object.assign(file, { name, saved: snap });
  update();
  if (framed)
    return showText(`Save ${name}`, name, txt, [
      'This page is embedded in another one, which may block downloads. If no file arrived, copy the text below into a file named ' +
        name +
        ', or open Sloptical Design on its own (index.html, or its GitHub Pages site) to save files directly.',
    ]);
  toast(`Downloaded ${name}`);
}
/** Show text to copy or download, in the export dialog (used where a file can't be written). */
function showText(title, filename, text, notes = []) {
  xCur = { el: $('xDlg'), e: { params: {} }, out: { filename, text } };
  $('xH').textContent = title;
  $('xDesc').textContent = filename;
  $('xDlg').querySelector('.popE').innerHTML = '';
  $('xDlg').querySelector('.popE').dataset.k = '';
  $('xNotes').className = '';
  $('xNotes').innerHTML = notes
    .map(n => `<li>${n.replace(/[&<]/g, c => `&#${c.charCodeAt(0)};`)}</li>`)
    .join('');
  $('xText').value = text;
  if (!$('xDlg').open) $('xDlg').showModal();
}
/** Open design text in a tab (a new one unless the current is untouched): from a file, a handle, or a path in the app. */
function openText(text, name, { handle = null, path = null } = {}) {
  let o;
  try {
    o = JSON.parse(text);
    if (!o?.rows?.length) throw 0;
  } catch {
    return toast(`${name} is not a Sloptical Design system (JSON with rows)`);
  }
  const same = path && docs.find(d => (d === doc ? file.path : d.file.path) === path); // already open: switch to it
  if (same) {
    activate(same);
    return toast(`${name} is already open`);
  }
  fresh();
  load(o);
  Object.assign(file, { name, handle, path, saved: JSON.stringify(sys) });
  resetHist();
  if (handle) idb.set(doc.id, handle);
  update();
  toast(`Opened ${path ?? name}`);
}
async function openSystem() {
  // (not `open`: that would shadow window.open)
  if (host.api) {
    try {
      const f = await host.api.open(file.path ? dirOf(file.path) : host.dir);
      if (f) {
        host.dir = f.dir;
        openText(f.text, f.name, { path: f.path });
      }
    } catch (e) {
      toast(`Couldn’t open: ${hostErr(e)}`);
    }
    return;
  }
  const read = async (f, handle) => openText(await f.text(), f.name, { handle });
  if (window.showOpenFilePicker)
    try {
      const [h] = await showOpenFilePicker({
        types: [{ description: 'Sloptical Design system', accept: { 'application/json': ['.json'] } }],
      });
      return read(await h.getFile(), h);
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  $('openFile').onchange = e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) read(f, null);
  };
  $('openFile').click();
}
// ── Desktop app (optic_app.py): the page in a native window (pywebview), which provides window.pywebview.api for real
// files. Then Save writes the design's own file on disk with no questions, Save as / Open / exports use the native dialogs
// (remembering the last folder), Watch follows a file on disk, extensions come from the extensions folder next to the
// app, designs named on its command line open in tabs, and closing with unsaved changes asks first. In a browser, host.api
// stays null and nothing here runs.
const host = { api: null, dir: '', unsaved: null };
const dirOf = p => p.replace(/[\\/][^\\/]*$/, '');
const hostErr = e => String(e?.message ?? e).replace(/^Error:\s*/, '');
/** Save an export's bytes with the app's save dialog. */
async function hostSave(name, blob) {
  const b = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  try {
    const r = await host.api.save_bytes(name, btoa(s), file.path ? dirOf(file.path) : host.dir);
    if (r) {
      host.dir = r.dir;
      toast(`Saved ${r.path}`);
    }
  } catch (e) {
    toast(`Couldn’t save ${name}: ${hostErr(e)}`);
  }
}
async function hostReady() {
  const api = window.pywebview?.api;
  if (!api || host.api || !docs.length) return;
  host.api = api;
  document.documentElement.classList.add('app');
  try {
    const ext = await api.extensions();
    if (Object.keys(ext).length) syncFolder(ext);
  } catch {}
  for (const d of [...docs]) {
    // designs whose file changed on disk since last time (and no unsaved edits here): reread
    const f = d === doc ? file : d.file;
    const dirty = d === doc ? isDirty(JSON.stringify(sys), file) : d.dirty;
    if (!f.path || dirty) continue;
    try {
      const r = await api.changed(f.path, 0);
      if (!r || r.missing) continue;
      const o = JSON.parse(r.text);
      if (!o?.rows?.length || JSON.stringify(o) === JSON.stringify(JSON.parse(f.saved ?? 'null'))) continue;
      if (d === doc) {
        load(o, true);
        file.saved = JSON.stringify(sys);
        update();
      } else {
        d.sys = o;
        d.file.saved = JSON.stringify(o);
        d.dirty = false;
      }
    } catch {}
  }
  try {
    for (const f of await api.startup_files()) {
      host.dir = f.dir;
      openText(f.text, f.name, { path: f.path });
    }
  } catch (e) {
    toast(`Couldn’t open: ${hostErr(e)}`);
  }
  host.unsaved = null;
  renderTabs();
}
window.addEventListener('pywebviewready', hostReady);
/** Uncaught errors are shown (a toast) rather than failing silently, and in the app also printed in its terminal. */
function reportError(msg, where = '') {
  const t = `Error: ${msg}${where ? ` (${where})` : ''}`;
  try {
    toast(t);
  } catch {}
  try {
    host.api?.log?.(t).catch?.(() => {});
  } catch {}
}
window.addEventListener('error', e => reportError(e.message, e.lineno ? `line ${e.lineno}` : ''));
window.addEventListener('unhandledrejection', e => reportError(String(e.reason?.message ?? e.reason)));
