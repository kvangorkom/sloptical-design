// configs.js — several configurations of one design (like OpticStudio's multi-configuration editor).
//
// A design with configurations keeps every surface it has in any of them in one list, the pool, and each configuration
// is the pool's surfaces that belong to it, in pool order:
//
//   sys.configs = {
//     active: 0,                        // the configuration in sys.rows (what is shown and edited)
//     show: ['c2'],                     // the other configurations drawn too (faded)
//     list: [{ id: 'c1', name: 'Science', set: { r3: { tilt: 46 } }, solved: { … } }, …],
//     rows: [{ id: 'r0', … }, { id: 'r1', …, only: ['c2'] }, …],   // the pool
//   }
//
// • Membership: a row without `only` is in every configuration; `only` lists the configurations it is in. Configurations
//   that share the rows up to some point and then have different ones fork there (a flip-in pickoff sends one of them
//   down its own arm). Nothing is hidden or ignored: a configuration's rows are simply the ones it has.
// • Values: a pool row holds the value its configurations share. A configuration's `set` overrides values of its own
//   (a value set in any configuration's `set` "varies by configuration"; null there means the key is absent). Its `solved`
//   keeps what its solves and focus locks last found for rows it shares, so each configuration solves on its own.
// • A row's distance out (t) varies by configuration wherever configurations sharing the row continue to different rows.
// • References between rows (focus-lock targets, tilt pivots) are row indices in a configuration's rows, as everywhere
//   else, and '@' + row id in the pool, so they follow their row whatever the configuration.
// • sys.rows is always the active configuration, complete: a reader that ignores `configs` sees a valid design.
//
// A design without `configs` has one configuration and is exactly as before.

(function engineConfigs(Optics) {
  if (typeof module !== 'object') (Optics.SOURCES ??= []).push(String(engineConfigs)); // (extensions' worker rebuilds the engine from these)
  ('use strict');

  const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const inConfig = (row, c) => !row.only || row.only.includes(c.id);

  /** Row indices of references (lock targets, pivots) → '@id' (to the pool), or back (from it). */
  function mapRefs(row, f) {
    for (const k of ['f1', 'f2']) {
      const t = row.lock?.[k];
      if (t && t.at !== undefined) {
        const v = f(t.at);
        if (v === null) delete row.lock[k];
        else t.at = v;
      }
      if (t && t.space !== undefined) {
        // a held point's space (after surface `space`): by its row, like a target
        const v = f(Number.isInteger(t.space) ? t.space + 1 : t.space);
        if (v === null) delete t.space;
        else t.space = Number.isInteger(v) ? v - 1 : v;
      }
    }
    if (row.pivot && row.pivot.at !== undefined && row.pivot.at !== 'coc') {
      const v = f(row.pivot.at);
      if (v === null) delete row.pivot;
      else row.pivot.at = v;
    }
    return row;
  }
  const toPool = (row, ids) =>
    mapRefs(row, at => (Number.isInteger(at) ? (ids[at] ? '@' + ids[at] : null) : at));
  const fromPool = (row, ids) =>
    mapRefs(row, at => {
      if (typeof at !== 'string' || at[0] !== '@') return at;
      const i = ids.indexOf(at.slice(1));
      return i < 0 ? null : i; // a target that isn't in this configuration: dropped here
    });

  /** The pool rows of configuration ci, in order. */
  const poolPath = (sys, ci) => sys.configs.rows.filter(r => inConfig(r, sys.configs.list[ci]));

  /** Configuration ci's rows: the pool's values, then its solved values, then its own (as plain rows, with ids). */
  function configRows(sys, ci) {
    const c = sys.configs.list[ci];
    const path = poolPath(sys, ci);
    const ids = path.map(r => r.id);
    return path.map(p => {
      const row = clone(p);
      delete row.only;
      for (const layer of [c.solved?.[p.id], c.set?.[p.id]])
        for (const [k, v] of Object.entries(layer ?? {})) {
          if (v === null) delete row[k];
          else row[k] = clone(v);
        }
      return fromPool(row, ids);
    });
  }

  /** The configurations (indices) whose rows include row `id`. */
  const configsOf = (sys, id) => {
    const row = sys.configs.rows.find(r => r.id === id);
    return sys.configs.list.flatMap((c, i) => (row && inConfig(row, c) ? [i] : []));
  };
  /** Whether rows[id][k] varies by configuration. */
  const variesByConfig = (sys, id, k) => sys.configs.list.some(c => c.set?.[id] && k in c.set[id]);

  /** Every configuration's value of rows[id][k] (undefined where the row isn't in it). */
  const configValues = (sys, id, k) =>
    sys.configs.list.map((c, ci) => configRows(sys, ci).find(r => r.id === id)?.[k]);

  /** Write value v of rows[id][k] (undefined: remove it) into one layer of a configuration or the pool. */
  function put(obj, id, k, v, nullForAbsent) {
    const o = (obj[id] ??= {});
    if (v === undefined && !nullForAbsent) delete o[k];
    else o[k] = v === undefined ? null : clone(v);
    if (!Object.keys(o).length) delete obj[id];
  }
  const poolRow = (sys, id) => sys.configs.rows.find(r => r.id === id);
  function putBase(sys, id, k, v, ids) {
    const p = poolRow(sys, id);
    if (v === undefined) delete p[k];
    else p[k] = k === 'lock' || k === 'pivot' ? toPool({ [k]: clone(v) }, ids)[k] : clone(v);
  }
  /** Pool form of a value (references as ids) for a configuration's layers. */
  const layerValue = (k, v, ids) =>
    v !== undefined && (k === 'lock' || k === 'pivot') ? toPool({ [k]: clone(v) }, ids)[k] : v;

  /** Make rows[id][k] vary by configuration (on: every configuration that has the row keeps its current value as its
   *  own), or stop it varying (off: every configuration takes the active one's value). */
  function setVariesByConfig(sys, id, k, on) {
    const C = sys.configs;
    if (on) {
      if (variesByConfig(sys, id, k)) return;
      for (const ci of configsOf(sys, id)) {
        const rows = configRows(sys, ci);
        put(
          (C.list[ci].set ??= {}),
          id,
          k,
          layerValue(
            k,
            rows.find(r => r.id === id)[k],
            rows.map(r => r.id),
          ),
          true,
        );
      }
    } else {
      const rows = configRows(sys, C.active);
      const row = rows.find(r => r.id === id);
      if (row)
        putBase(
          sys,
          id,
          k,
          row[k],
          rows.map(r => r.id),
        );
      for (const c of C.list) if (c.set?.[id]) put(c.set, id, k, undefined);
    }
  }

  /** Set rows[id][k] to v in configuration ci alone (other configurations keep theirs). */
  function setIn(sys, ci, id, k, v) {
    const rows = configRows(sys, ci);
    const ids = rows.map(r => r.id);
    if (same(rows.find(r => r.id === id)?.[k], v)) return;
    const c = sys.configs.list[ci];
    if (configsOf(sys, id).length === 1 && !variesByConfig(sys, id, k)) return putBase(sys, id, k, v, ids);
    setVariesByConfig(sys, id, k, true);
    put((c.set ??= {}), id, k, layerValue(k, v, ids), true);
  }

  /** Keys of rows[i] that its solves and focus locks set (their values are each configuration's own). */
  function solvedKeys(rows, i) {
    const r = rows[i];
    const L = r.lock && (r.lock.f1 || r.lock.f2) ? (r.lock.vary ?? []) : [];
    const ks = new Set([...Object.keys(r.solve ?? {}), ...L.filter(k => k !== 'tin')]);
    const n = rows[i + 1]?.lock;
    if (n && (n.f1 || n.f2) && n.vary?.includes('tin')) ks.add('t');
    return ks;
  }

  /** Where configurations sharing a row continue to different rows, its distance out varies by configuration. */
  function forkDistances(sys) {
    const C = sys.configs;
    const paths = C.list.map((_, ci) => poolPath(sys, ci).map(r => r.id));
    for (const row of C.rows) {
      const next = paths.filter(p => p.includes(row.id)).map(p => p[p.indexOf(row.id) + 1] ?? null);
      if (new Set(next).size > 1) setVariesByConfig(sys, row.id, 't', true);
    }
  }

  const newId = (sys, pre) => {
    const used = new Set([...sys.configs.rows.map(r => r.id), ...sys.configs.list.map(c => c.id)]);
    let n = 1;
    while (used.has(pre + n)) n++;
    return pre + n;
  };

  /** Take the active configuration's rows as edited (rows, ids kept on the rows) back into the design. Values change where
   *  they live: a value that varies by configuration changes in this configuration only, a shared one for every
   *  configuration that has the row; values found by solves and locks are kept per configuration. New rows (no id) join
   *  this configuration only; a deleted row leaves every configuration (each
   *  closes the gap the way this one did, adding the row's distance to the one before). Mutates sys; returns it. */
  function writeBack(sys, rows = sys.rows) {
    const C = sys.configs;
    const ci = C.active;
    const c = C.list[ci];
    const before = C.list.map((_, k) => configRows(sys, k));
    const old = before[ci];
    const oldIds = old.map(r => r.id);
    const used = new Set([...C.rows.map(r => r.id), ...C.list.map(x => x.id)]);
    for (const r of rows) {
      if (r.id && oldIds.includes(r.id)) continue;
      let n = 1;
      while (used.has('r' + n)) n++;
      if (!r.id || used.has(r.id)) r.id = 'r' + n; // a new row (or a copy of one)
      used.add(r.id);
    }
    const ids = rows.map(r => r.id);
    const shared = id => configsOf(sys, id).length > 1;

    // new rows: into the pool after the row before them, in this configuration only (the Configs column adds them to others)
    rows.forEach((r, i) => {
      if (oldIds.includes(r.id)) return;
      const row = toPool(clone(r), ids);
      if (C.list.length > 1) row.only = [c.id];
      const pos = C.rows.findIndex(q => q.id === ids[i - 1]);
      C.rows.splice(pos + 1, 0, row);
    });
    forkDistances(sys); // a new row makes the one before it a fork: its distance out is then this configuration's own

    // changed values
    rows.forEach((r, i) => {
      const o = old[oldIds.indexOf(r.id)];
      if (!o) return;
      const sk = solvedKeys(rows, i);
      for (const k of new Set([...Object.keys(o), ...Object.keys(r)])) {
        if (k === 'id' || same(o[k], r[k])) continue;
        if (k === 'solve' && !variesByConfig(sys, r.id, 'solve')) {
          // a solve on a value that differs by configuration is that configuration's own (a focus solve on a fork's
          // distance out, say: the configurations continue to different surfaces)
          const solves = new Set([...Object.keys(o.solve ?? {}), ...Object.keys(r.solve ?? {})]);
          const own = [...solves].some(
            v => !same(o.solve?.[v], r.solve?.[v]) && variesByConfig(sys, r.id, v),
          );
          if (own) setVariesByConfig(sys, r.id, 'solve', true);
        }
        if (variesByConfig(sys, r.id, k)) put((c.set ??= {}), r.id, k, layerValue(k, r[k], ids), true);
        else if (sk.has(k) && shared(r.id)) put((c.solved ??= {}), r.id, k, layerValue(k, r[k], ids));
        else {
          putBase(sys, r.id, k, r[k], ids);
          for (const cc of C.list) if (cc.solved?.[r.id]) put(cc.solved, r.id, k, undefined); // a typed value replaces solved ones
        }
      }
    });

    // deleted rows: out of the pool; every other configuration that had one closes its gap too
    const gone = oldIds.filter(id => !ids.includes(id));
    const gaps = [];
    for (const id of gone)
      before.forEach((b, k) => {
        const at = b.findIndex(r => r.id === id);
        if (k !== ci && at > 0) gaps.push([k, b[at - 1].id, (b[at - 1].t ?? 0) + (b[at].t ?? 0)]);
      });
    C.rows = C.rows.filter(r => !gone.includes(r.id));
    for (const cc of C.list) for (const L of [cc.set, cc.solved]) for (const id of gone) if (L) delete L[id];
    for (const [k, id, t] of gaps) if (!gone.includes(id)) setIn(sys, k, id, 't', t);

    forkDistances(sys);
    return sys;
  }

  /** Start configurations (the design becomes configuration 1) and add one: a copy of the active configuration, made active.
   *  Returns its index. */
  function addConfig(sys, name) {
    if (!sys.configs) {
      const rows = sys.rows.map((r, i) => ({ ...r, id: 'r' + i }));
      const ids = rows.map(r => r.id);
      sys.configs = {
        active: 0,
        show: [],
        list: [{ id: 'c1', name: 'Config 1', set: {}, solved: {} }],
        rows: rows.map(r => toPool(clone(r), ids)),
      };
      sys.rows = configRows(sys, 0);
    }
    const C = sys.configs;
    const from = C.list[C.active];
    const id = newId(sys, 'c');
    C.list.push({
      id,
      name: name ?? `Config ${C.list.length + 1}`,
      set: clone(from.set ?? {}),
      solved: clone(from.solved ?? {}),
    });
    for (const r of C.rows) if (r.only?.includes(from.id)) r.only.push(id);
    C.active = C.list.length - 1;
    sys.rows = configRows(sys, C.active);
    return C.active;
  }

  /** Remove configuration ci (and the rows only it had). With one left, the design goes back to having none. */
  function removeConfig(sys, ci) {
    const C = sys.configs;
    if (!C || C.list.length < 2) return;
    const [gone] = C.list.splice(ci, 1);
    C.rows = C.rows.filter(r => !r.only || (r.only = r.only.filter(x => x !== gone.id)).length);
    C.show = (C.show ?? []).filter(x => x !== gone.id);
    if (C.active > ci) C.active--;
    else if (C.active === ci) C.active = Math.min(ci, C.list.length - 1);
    forkDistances(sys);
    sys.rows = configRows(sys, C.active);
    if (C.list.length === 1) {
      sys.rows.forEach(r => delete r.id);
      delete sys.configs;
    }
  }

  /** Make configuration ci the one in sys.rows. */
  function setActive(sys, ci) {
    sys.configs.active = ci;
    sys.rows = configRows(sys, ci);
  }

  /** Put row `id` into configuration ci, or take it out (taking it out of the active configuration closes the gap there:
   *  its distance joins the row before's). A row in no configuration is deleted. */
  function setMember(sys, id, ci, on) {
    const C = sys.configs;
    const row = poolRow(sys, id);
    const c = C.list[ci];
    if (!row || row === C.rows[0] || inConfig(row, c) === on) return; // (the pupil is in every configuration)
    const before = configRows(sys, ci);
    const at = before.findIndex(r => r.id === id);
    if (on) row.only = [...row.only, c.id];
    else row.only = (row.only ?? C.list.map(x => x.id)).filter(x => x !== c.id);
    if (row.only.length === C.list.length) delete row.only;
    if (!on && at > 0) setIn(sys, ci, before[at - 1].id, 't', (before[at - 1].t ?? 0) + (before[at].t ?? 0));
    if (row.only && !row.only.length) {
      C.rows = C.rows.filter(r => r !== row);
      for (const x of C.list) for (const L of [x.set, x.solved]) if (L) delete L[id];
    }
    forkDistances(sys);
    sys.rows = configRows(sys, C.active);
  }

  /** A configuration's rows with its solves and locks applied (for drawing or exporting one that isn't active). */
  function solvedConfig(sys, ci) {
    const rows = configRows(sys, ci);
    Optics.applySolves(rows);
    return rows;
  }

  Object.assign(Optics, {
    configRows,
    configsOf,
    variesByConfig,
    configValues,
    setVariesByConfig,
    setIn,
    writeBack,
    addConfig,
    removeConfig,
    setActive,
    setMember,
    forkDistances,
    solvedConfig,
  });
  if (typeof module === 'object') module.exports = Optics;
})(typeof module === 'object' ? require('./python.js') : globalThis.Optics);
