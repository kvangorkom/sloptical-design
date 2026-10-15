// Names come from design files and links, which anyone can write: in the page's HTML they're always escaped. A check on
// the source: on a line that builds HTML (it has a tag), every optic name (label(…)) and every .name (a configuration's,
// an extension's, a design's) must be passed straight to an escape. Run: node --test
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'src', 'app');
const HTML = /<\/?[a-z][^>]*>|<option|<b\b|<small/; // the line builds HTML
const NAME = /\$\{[^}]*?\b(label\(|[a-z]\.name\b)/g; // a name inside a template's ${…}
const SAFE = /(escHTML|esc|li)\($/; // …passed straight to an escape

/** Lines of src that put a name into HTML unescaped. */
const unescaped = src =>
  src
    .split('\n')
    .flatMap((l, n) =>
      HTML.test(l) &&
      [...l.matchAll(NAME)].some(m => !SAFE.test(l.slice(0, m.index + m[0].length - m[1].length)))
        ? [`${n + 1}: ${l.trim()}`]
        : [],
    );

test('names in HTML are escaped', () => {
  const bad = fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.js'))
    .flatMap(f => unescaped(fs.readFileSync(path.join(dir, f), 'utf8')).map(l => `${f}:${l}`));
  assert.deepEqual(bad, []);
});

test('the check finds an unescaped name', () => {
  assert.equal(unescaped('el.innerHTML = `<b>${label(i)}</b>`;').length, 1);
  assert.equal(unescaped('el.innerHTML = `<small>after ${j ? label(j - 1) : "x"}</small>`;').length, 1);
  assert.equal(unescaped('el.innerHTML = `<option>${e.name}</option>`;').length, 1);
  assert.equal(unescaped('el.innerHTML = `<b>${escHTML(label(i))}</b><i>${esc(c.name)}</i>`;').length, 0);
});
