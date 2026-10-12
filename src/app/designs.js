// designs.js — designs: several open at once, one tab each. The active design lives in the globals (sys, file, view, hist); the others
// are kept as {id, sys, file: {name, handle, saved}, view, hist, dirty}. Switching stores the active one and loads the other,
// with its view and undo history. All are remembered in this browser (localStorage 'optic_docs'; undo history per design in
// sessionStorage), so a reload brings back every tab. Open, Import Zemax and New design add a tab (reusing an untouched,
// never-saved one); presets load into the current tab.
const docs = [];
let doc = null;
const newId = () => Math.random().toString(36).slice(2, 9);
/** Store the active design's state in its entry. */
function stash() {
  if (!doc) return;
  commit();
  Object.assign(doc, {
    sys: JSON.parse(JSON.stringify(sys)),
    file: { ...file },
    view: view && { ...view, cam },
    hist: { undo: hist.undo, redo: hist.redo, cur: hist.cur },
  });
  doc.dirty = isDirty(JSON.stringify(sys), file);
}
/** Make design d the active one: its system, file, view and undo history. */
function activate(d) {
  if (d === doc) return;
  stash();
  doc = d;
  Object.assign(file, { name: 'untitled.json', handle: null, saved: null, base: null, path: null }, d.file);
  if (!d.hist)
    try {
      d.hist = JSON.parse(sessionStorage.getItem('optic_hist:' + d.id));
    } catch {}
  clearTimeout(hist.t);
  Object.assign(hist, { undo: d.hist?.undo ?? [], redo: d.hist?.redo ?? [], cur: d.hist?.cur ?? null });
  cancelAnimationFrame(camAnim);
  cam = d.view?.cam ?? SIDE;
  side = cam.name === 'side' && !cam.persp;
  syncCam(); // its own camera
  load(d.sys);
  if (d.view) {
    view = { ...d.view };
    delete view.cam;
    draw();
  }
  if (!file.handle && file.saved !== null && window.showSaveFilePicker)
    idb.get(d.id).then(h => {
      if (h?.name === file.name && doc === d && !file.handle) file.handle = d.file.handle = h;
    }); // its own file only
  renderTabs();
}
/** A name not used by another open design: untitled.json, untitled-2.json, … */
function freeName(base = 'untitled') {
  const used = new Set(docs.map(d => (d === doc ? file.name : d.file.name)));
  let k = 1;
  let n;
  do n = `${base}${k > 1 ? '-' + k : ''}.json`;
  while (used.has(n) && ++k);
  return n;
}
/** A fresh tab for a design about to be loaded into it: the current one if it is untouched and never saved, else a new one. */
function fresh() {
  if (
    doc &&
    file.saved === null &&
    !file.handle &&
    !file.path &&
    !isDirty(JSON.stringify(sys), file) &&
    /^untitled/.test(file.name) &&
    live.doc !== doc.id
  )
    return doc;
  const d = {
    id: newId(),
    sys: JSON.parse(JSON.stringify(sys ?? PRESETS['Cassegrain f/20'])),
    file: { name: freeName(), handle: null, saved: null, path: null },
    view: null,
    hist: null,
  };
  docs.splice(doc ? docs.indexOf(doc) + 1 : docs.length, 0, d);
  activate(d);
  return d;
}
/** Start the active design's undo history afresh (a design just opened or imported into its tab). */
function resetHist() {
  clearTimeout(hist.t);
  Object.assign(hist, { undo: [], redo: [], cur: JSON.stringify(sys) });
  commit();
}
/** File ▸ New design: a new tab with the default preset. */
function newDesign() {
  const d = {
    id: newId(),
    sys: structuredClone(PRESETS['Cassegrain f/20']),
    file: { name: freeName(), handle: null, saved: null },
    view: null,
    hist: null,
  };
  docs.splice(doc ? docs.indexOf(doc) + 1 : docs.length, 0, d);
  activate(d);
  file.base = JSON.stringify(sys);
  resetHist();
  update();
  toast(`New design: ${file.name}`);
}
/** Close design d's tab (asking first if it has unsaved changes); the last one closed leaves a new untitled design. */
async function closeDesign(d) {
  const dirty =
    d === doc ? isDirty(JSON.stringify(sys), file) : (d.dirty ?? isDirty(JSON.stringify(d.sys), d.file));
  if (dirty) {
    if (d !== doc) activate(d);
    $('closeMsg').textContent = `${file.name} has changes that aren’t saved to a file.`;
    const dl = $('closeDlg');
    dl.returnValue = '';
    dl.showModal();
    const v = await new Promise(res => (dl.onclose = () => res(dl.returnValue)));
    if (v === 'save') {
      await save(false);
      if (isDirty(JSON.stringify(sys), file)) return;
    } else if (v !== 'close') return;
  }
  if (live.doc === d.id) watch(false);
  const k = docs.indexOf(d);
  docs.splice(k, 1);
  idb.del(d.id);
  try {
    sessionStorage.removeItem('optic_hist:' + d.id);
  } catch {}
  if (d === doc) {
    doc = null;
    if (docs.length) activate(docs[Math.min(k, docs.length - 1)]);
    else return newDesign();
  }
  saveDocs();
  renderTabs();
}
/** Remember every open design in this browser (the active one as json, if given). */
function saveDocs(json) {
  try {
    localStorage.setItem(
      'optic_docs',
      JSON.stringify({
        active: doc?.id,
        docs: docs.map(d =>
          d === doc
            ? {
                id: d.id,
                name: file.name,
                path: file.path,
                saved: file.saved,
                base: file.base,
                view: view && { ...view, cam },
                sys: json ? JSON.parse(json) : sys,
              }
            : {
                id: d.id,
                name: d.file.name,
                path: d.file.path,
                saved: d.file.saved,
                base: d.file.base,
                view: d.view,
                sys: d.sys,
              },
        ),
      }),
    );
  } catch {}
}
/** Bring back the designs open last time (or the single design kept by older versions). */
function restoreDocs() {
  let st = null;
  try {
    st = JSON.parse(localStorage.getItem('optic_docs'));
  } catch {}
  if (!st?.docs?.length) {
    // older versions: one design, its file name and saved state
    let o = null;
    let f = {};
    try {
      o = JSON.parse(localStorage.getItem('optic_sketch'));
      f = JSON.parse(localStorage.getItem('optic_file')) ?? {};
    } catch {}
    let h = null;
    try {
      h = JSON.parse(sessionStorage.getItem('optic_hist'));
    } catch {}
    st = {
      docs: [
        {
          id: newId(),
          name: f.name ?? 'untitled.json',
          saved: f.saved ?? null,
          sys: o?.rows ? o : PRESETS['Cassegrain f/20'],
        },
      ],
    };
    if (h)
      try {
        sessionStorage.setItem('optic_hist:' + st.docs[0].id, JSON.stringify(h));
      } catch {}
  }
  for (const x of st.docs)
    if (x?.sys?.rows?.length) {
      const f = {
        name: x.name ?? 'untitled.json',
        handle: null,
        saved: x.saved ?? null,
        base: x.base ?? null,
        path: x.path ?? null,
      };
      docs.push({
        id: x.id ?? newId(),
        sys: x.sys,
        file: f,
        view: x.view ?? null,
        hist: null,
        dirty: isDirty(JSON.stringify(x.sys), f),
      });
    }
  const blank = !docs.length;
  if (blank)
    docs.push({
      id: newId(),
      sys: PRESETS['Cassegrain f/20'],
      file: { name: 'untitled.json', handle: null, saved: null },
      view: null,
      hist: null,
    });
  activate(docs.find(d => d.id === st.active) ?? docs[0]);
  if (file.saved === null && file.base == null && !hist.undo.length) {
    file.base = JSON.stringify(sys);
    update();
  } // a first visit: nothing changed yet
}
/** The tab strip: one tab per design (• unsaved, ● live), + for a new one. Click to switch; × or a middle click closes. */
function renderTabs() {
  const el = $('tabs');
  const esc = t => String(t).replace(/[&<"]/g, c => `&#${c.charCodeAt(0)};`);
  const html =
    docs
      .map(d => {
        const on = d === doc;
        const name = on ? file.name : d.file.name;
        const dirty = on ? isDirty(JSON.stringify(sys), file) : d.dirty;
        const path = on ? file.path : d.file.path;
        return (
          `<div class="tab" role="tab" aria-selected="${on}" data-id="${d.id}" title="${esc(path ?? name)}${dirty ? ' (unsaved changes)' : ''}"><button data-go="${d.id}">${esc(name.replace(/\.json$/, ''))}${dirty ? ' <span class="dirty">•</span>' : ''}${live.on && live.doc === d.id ? ' <span class="live">●</span>' : ''}</button>` +
          `<button class="tabX" data-close="${d.id}" aria-label="Close ${esc(name)}" title="Close">×</button></div>`
        );
      })
      .join('') + `<button id="tabNew" title="New design (a new tab)" aria-label="New design">+</button>`;
  if (el.innerHTML !== html) el.innerHTML = html;
  if (host.api) {
    const u = docs
      .filter(d => (d === doc ? isDirty(JSON.stringify(sys), file) : d.dirty))
      .map(d => (d === doc ? file.name : d.file.name));
    const k = u.join('\n');
    if (k !== host.unsaved) {
      host.unsaved = k;
      try {
        host.api.set_unsaved(u).catch(() => {});
      } catch {}
    }
  } // the app asks before closing with these
}
$('tabs').onclick = e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.id === 'tabNew') return newDesign();
  const d = docs.find(x => x.id === (b.dataset.go ?? b.dataset.close));
  if (!d) return;
  if (b.dataset.close) closeDesign(d);
  else activate(d);
};
$('tabs').onauxclick = e => {
  if (e.button !== 1) return;
  const id = e.target.closest('.tab')?.dataset.id;
  const d = docs.find(x => x.id === id);
  if (d) {
    e.preventDefault();
    closeDesign(d);
  }
};
