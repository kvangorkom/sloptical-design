// undo.js — undo / redo: snapshots of the system JSON, unlimited. Edits less than 400 ms apart (a slider drag, typing) merge into
// one step. Stepping through history restores a snapshot exactly (solves are not re-run) and never counts as an edit.
// History is kept in sessionStorage, so it survives reloading the page.
const hist = { undo: [], redo: [], cur: null, t: 0, lock: false }; // the active design's (each design keeps its own)
function record(json) {
  if (!hist.lock) {
    clearTimeout(hist.t);
    hist.cur ??= json;
    if (json !== hist.cur) {
      hist.redo = [];
      if (drag?.i === undefined && drag?.shape === undefined) hist.t = setTimeout(commit, 400);
    } // a drag commits on release
  }
  $('undo').disabled = !hist.undo.length && json === hist.cur;
  $('redo').disabled = !hist.redo.length;
}
function commit() {
  if (VIEWER) return;
  clearTimeout(hist.t);
  const j = JSON.stringify(sys);
  if (j !== hist.cur) {
    hist.undo.push(hist.cur);
    hist.cur = j;
  }
  try {
    if (doc)
      sessionStorage.setItem(
        'optic_hist:' + doc.id,
        JSON.stringify({ undo: hist.undo, redo: hist.redo, cur: hist.cur }),
      );
  } catch {} // full: memory only
}
function step(from, to) {
  commit();
  if (!from.length) return;
  to.push(hist.cur);
  hist.lock = true;
  try {
    load(JSON.parse(from.pop()), true);
  } finally {
    hist.lock = false;
  }
  hist.cur = JSON.stringify(sys);
  commit();
  record(hist.cur);
}
const undo = () => step(hist.undo, hist.redo);
const redo = () => step(hist.redo, hist.undo);
$('undo').onclick = undo;
$('redo').onclick = redo;
onDoc('keydown', e => {
  const k = e.key.toLowerCase();
  if ((e.metaKey || e.ctrlKey) && (k === 'z' || k === 'y') && e.target.id !== 'json') {
    e.preventDefault();
    (k === 'y' || e.shiftKey ? redo : undo)();
  }
});
