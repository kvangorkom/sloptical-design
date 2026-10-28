// configs.js — configurations (the model is in src/engine/configs.js): the strip in the surface panel's bar, switching,
// the Configs column (which configurations have each surface), cells that differ by configuration, and which other
// configurations are drawn (faded, under the active one).

const cfgLetter = i => String.fromCharCode(65 + (i % 26));
/** Each configuration's colour: its letter, and the tint of its faded drawing. */
const CFG_HUE = ['#7048e8', '#d6336c', '#0c8599', '#e67700', '#5c940d', '#1864ab', '#862e9c', '#495057'];
const cfgHue = i => CFG_HUE[i % CFG_HUE.length];
/** Colour c mixed fraction t of the way to colour h (hex or rgb() colours; anything else gives h). */
function mixColor(c, h, t) {
  const rgb = x => {
    const m = String(x).trim();
    if (m[0] === '#') {
      const v = m.length === 4 ? [...m.slice(1)].map(d => d + d) : m.slice(1, 7).match(/../g);
      return v.map(d => parseInt(d, 16));
    }
    const n = m
      .match(/rgba?\(([^)]+)\)/)?.[1]
      .split(',')
      .map(Number);
    return n?.slice(0, 3);
  };
  const a = rgb(c);
  const b = rgb(h);
  if (!a || !b) return h;
  return (
    '#' +
    a
      .map((v, i) =>
        Math.round(v + t * (b[i] - v))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
/** Layouts of the configurations (by index), traced once per update and only when asked for. */
let cfgLayouts = null;
function layoutFor(k) {
  cfgLayouts ??= new Map();
  if (!cfgLayouts.has(k)) cfgLayouts.set(k, layoutOf(Optics.solvedConfig(sys, k)));
  return cfgLayouts.get(k);
}
const EYE =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';

/** The other configurations drawn (indices). */
const shownConfigs = () => {
  const C = sys.configs;
  if (!C) return [];
  return C.list.flatMap((c, i) => (i !== C.active && (C.show ?? []).includes(c.id) ? [i] : []));
};

function renderConfigs() {
  const bar = $('cfgBar');
  const C = sys.configs;
  const esc = s => String(s).replace(/[&"<]/g, c => `&#${c.charCodeAt(0)};`);
  if (!C) {
    bar.innerHTML =
      '<button data-cfg="add" title="Add a configuration: a copy of this design whose values, and optics, can then differ">+ Configuration</button>';
    return;
  }
  const all = C.list.every((c, i) => i === C.active || C.show?.includes(c.id));
  bar.innerHTML =
    C.list
      .map((c, i) => {
        const on = i === C.active;
        const seen = on || C.show?.includes(c.id);
        return (
          `<span class="cfg${on ? ' on' : ''}" data-ci="${i}">` +
          `<button class="cfgEye" data-cfg="show" aria-pressed="${seen}" style="--hue:${cfgHue(i)}" ${on ? 'disabled ' : ''}aria-label="Draw ${esc(c.name)} too" title="${on ? 'The active configuration' : seen ? 'Drawn (faded): click to hide' : 'Draw this configuration too (faded)'}">${EYE}</button>` +
          `<button class="cfgName" data-cfg="pick" aria-pressed="${on}" title="${on ? 'Shown and edited (double-click to rename)' : 'Show and edit this configuration (C steps through them)'}">` +
          `<i style="color:${cfgHue(i)}">${cfgLetter(i)}</i>${esc(c.name)}</button>` +
          `<button class="cfgX" data-cfg="del" aria-label="Delete ${esc(c.name)}" title="Delete this configuration">×</button></span>`
        );
      })
      .join('') +
    '<button data-cfg="add" title="Add a configuration: a copy of the active one" aria-label="Add a configuration">+</button>' +
    `<button data-cfg="all" aria-pressed="${all}" title="Draw every configuration (the others faded), or only the active one">All</button>`;
}

/** Keep row references that live outside the rows (watched values, popups) on the same surfaces when the rows change
 *  to another configuration's. oldIds: the row ids before. */
function remapRows(oldIds, ids = sys.rows.map(r => r.id)) {
  for (const w of sys.watch ?? []) {
    if (!w.ri) continue;
    w.rid ??= oldIds[w.ri];
    const i = ids.indexOf(w.rid);
    w.ri = i < 0 ? -1 : i; // not in this configuration: shown as —
    if (!sys.configs) delete w.rid;
  }
  pops().forEach(p => {
    const t = p.tgt;
    if (!t) return;
    const to = ri => {
      const i = ids.indexOf(oldIds[ri]);
      return i < 0 ? null : i;
    };
    if (t.i !== undefined) {
      const v = to(t.i + 1);
      v === null ? closePop(p) : (t.i = v - 1);
    } else if (t.j !== undefined) {
      const v = to(t.j);
      v === null ? closePop(p) : (t.j = v);
    }
  });
}

/** Rows replaced by another configuration's (or by an operation on configurations): refresh everything that shows them. */
function rowsChanged(oldIds, newIds) {
  hideJog();
  hideLock();
  remapRows(oldIds, newIds);
  good = null; // the Stigmatic guard compares with the new rows from here
  renderTable();
  update();
}

function setConfig(ci) {
  const C = sys.configs;
  if (!C || ci === C.active || !C.list[ci]) return;
  commit();
  const ids = sys.rows.map(r => r.id);
  Optics.setActive(sys, ci);
  rowsChanged(ids);
}

$('cfgBar').onclick = e => {
  const b = e.target.closest('button[data-cfg]');
  if (!b) return;
  const C = sys.configs;
  const ci = +b.closest('[data-ci]')?.dataset.ci;
  const act = b.dataset.cfg;
  if (act === 'pick') return setConfig(ci);
  commit();
  if (act === 'add') {
    const from = C ? C.list[C.active].name : 'Config 1';
    Optics.addConfig(sys);
    rowsChanged(sys.rows.map(r => r.id)); // (the copy has the same rows as the one it copies)
    toast(`${sys.configs.list[sys.configs.active].name} added (a copy of ${from})`);
  } else if (act === 'del') {
    const name = C.list[ci].name;
    const ids = sys.rows.map(r => r.id);
    const next = C.active !== ci ? C.active : ci + 1 < C.list.length ? ci + 1 : ci - 1; // active afterwards (as now numbered)
    const nextIds = Optics.configRows(sys, next).map(r => r.id);
    Optics.removeConfig(sys, ci);
    rowsChanged(ids, nextIds);
    toast(`Deleted ${name} (undo brings it back)`);
  } else if (act === 'show') {
    const id = C.list[ci].id;
    C.show = C.show?.includes(id) ? C.show.filter(x => x !== id) : [...(C.show ?? []), id];
    renderConfigs();
    update();
  } else if (act === 'all') {
    const all = C.list.every((c, i) => i === C.active || C.show?.includes(c.id));
    C.show = all ? [] : C.list.map(c => c.id);
    renderConfigs();
    update();
  }
};
$('cfgBar').ondblclick = e => {
  const b = e.target.closest('.cfgName');
  if (!b || VIEWER) return;
  const ci = +b.closest('[data-ci]').dataset.ci;
  const c = sys.configs.list[ci];
  const inp = document.createElement('input');
  inp.className = 'cfgRename';
  inp.value = c.name;
  inp.setAttribute('aria-label', 'Configuration name');
  b.replaceWith(inp);
  inp.focus();
  inp.select();
  let done = false;
  const end = keep => {
    if (done) return;
    done = true;
    if (keep && inp.value.trim()) {
      commit();
      c.name = inp.value.trim();
      update();
    }
    renderConfigs();
  };
  inp.onkeydown = k => {
    if (k.key === 'Enter') end(true);
    if (k.key === 'Escape') end(false);
  };
  inp.onblur = () => end(true);
};

// C (or ]) steps to the next configuration, Shift+C (or [) back
onDoc('keydown', e => {
  const k = e.key;
  if (!sys.configs || !['[', ']', 'c', 'C'].includes(k) || e.ctrlKey || e.metaKey || e.altKey || e.repeat)
    return;
  if (e.target.closest?.('input, textarea, select, dialog')) return;
  e.preventDefault();
  const n = sys.configs.list.length;
  const back = k === '[' || k === 'C';
  setConfig((sys.configs.active + (back ? n - 1 : 1)) % n);
  toast(`${cfgLetter(sys.configs.active)} · ${sys.configs.list[sys.configs.active].name}`);
});

/** The Configs column: a letter per configuration, pressed where the surface is in it. */
function configCell(r, i) {
  const C = sys.configs;
  if (!i) return '<td class="cfgs" title="The entrance pupil is in every configuration">all</td>';
  const ids = Optics.configsOf(sys, r.id);
  return (
    '<td class="cfgs">' +
    C.list
      .map(
        (c, k) =>
          `<button data-cfgm="${k}" aria-pressed="${ids.includes(k)}" style="--hue:${cfgHue(k)}" title="${escHTML(c.name)}: ${ids.includes(k) ? 'has this surface (click to take it out)' : 'doesn’t have it (click to add it)'}">${cfgLetter(k)}</button>`,
      )
      .join('') +
    '</td>'
  );
}
function toggleMember(el) {
  const ri = +el.closest('tr').dataset.i;
  const id = sys.rows[ri].id;
  const k = +el.dataset.cfgm;
  const on = el.getAttribute('aria-pressed') !== 'true';
  if (!on && Optics.configsOf(sys, id).length === 1)
    return toast('That is the only configuration with this surface: delete it (×) instead');
  commit();
  const ids = sys.rows.map(r => r.id);
  Optics.setMember(sys, id, k, on);
  rowsChanged(ids);
}

/** Cells whose value differs by configuration: marked, with every configuration's value in the tooltip. */
function markConfigCells(root = $('tbl')) {
  root.querySelectorAll('.num').forEach(el => {
    const td = el.closest('td');
    const row = sys.rows[el.closest('tr').dataset.i];
    const on = !!(sys.configs && row?.id && Optics.variesByConfig(sys, row.id, el.dataset.k));
    td.classList.toggle('cfgv', on);
    if (!on) return;
    const vals = Optics.configValues(sys, row.id, el.dataset.k);
    const txt = sys.configs.list
      .flatMap((c, k) =>
        vals[k] === undefined && !Optics.configsOf(sys, row.id).includes(k)
          ? []
          : [`${cfgLetter(k)} ${show(el.dataset.k, vals[k])}`],
      )
      .join(' · ');
    el.title = `Differs by configuration: ${txt}.${el.title ? ' ' + el.title : ''}`;
  });
}

/** The jog popover's "different in each configuration" switch, for the cell it is open on. */
function renderCfgVary() {
  const ri = +jt.closest('tr').dataset.i;
  const on = !!sys.configs && !!sys.rows[ri]?.id && Optics.configsOf(sys, sys.rows[ri].id).length > 1;
  $('cfgVaryRow').hidden = !on;
  if (on) $('cfgVary').checked = Optics.variesByConfig(sys, sys.rows[ri].id, jt.dataset.k);
}
$('cfgVary').onchange = e => {
  if (!jt) return;
  const ri = +jt.closest('tr').dataset.i;
  commit();
  Optics.setVariesByConfig(sys, sys.rows[ri].id, jt.dataset.k, e.target.checked);
  update();
  toast(
    e.target.checked
      ? `${label(ri - 1)}: differs by configuration`
      : `${label(ri - 1)}: one value for all configurations`,
  );
};

/** A pen that draws everything fainter and tinted toward colour hue (another configuration). */
const fadePen = (g, a, hue) => {
  const tint = c => (hue && c ? mixColor(c, hue, 0.55) : c);
  return {
    ...g,
    line: (P, o) => g.line(P, { ...o, color: tint(o.color), alpha: (o.alpha ?? 1) * a }),
    segs: (L, o) => g.segs(L, { ...o, color: tint(o.color), alpha: (o.alpha ?? 1) * a }),
    fill: (P, o) =>
      g.fill(P, {
        ...o,
        color: tint(o.color),
        stroke: tint(o.stroke),
        alpha: (o.alpha ?? 1) * a,
        strokeAlpha: a,
      }),
    text: () => {},
    layer: g.layer && ((draw, alpha, box, coarse) => g.layer(draw, alpha * a, box, coarse)),
  };
};
/** Draw the other configurations shown, faded, with pen g (before the active one, which is drawn over them). */
function drawGhosts(g, M, o, list = ghosts, alpha = 0.4) {
  for (const L of list)
    withLayout(L, () => {
      if (o.d3) S.forEach(s => (s.sl = slice3(s)));
      render(fadePen(g, alpha, L.hue ?? cfgHue(L.k)), M, {
        ...o,
        labels: false,
        axes: false,
        aoi: false,
        conj: false,
        shapes: false,
        full: false,
        hots: new Set(),
        sel: new Set(),
        place: false,
        coneLayer: undefined,
        range: L.range ?? viewSpan(L.k, L.S.length), // the figure's choice; on screen, Show ▸ Surfaces'
        under: undefined,
        others: undefined,
      });
    });
}
