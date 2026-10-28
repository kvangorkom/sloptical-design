// The hosted build (build.js → dist/index.html for GitHub Pages): one self-contained file with the scripts inlined and the
// listed extensions bundled, built from the unchanged source page.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build, inline, BUNDLE } = require('../build.js');
const root = path.join(__dirname, '..');

test('build: one file with every local script and stylesheet inlined and the listed extensions bundled; the source page is untouched', () => {
  const src = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'optic-build-'));
  const html = fs.readFileSync(build(dir), 'utf8');
  assert.ok(!/<script src=/.test(html), 'no external scripts');
  assert.ok(!html.includes('<link rel="stylesheet" href="src/app/style.css"'), 'no local stylesheet');
  const local = [...src.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  assert.ok(
    local.includes('src/engine/trace.js') &&
      local.includes('src/app/pdf.js') &&
      local.includes('src/app/main.js'),
  );
  for (const f of [...local, 'src/app/style.css'])
    assert.ok(html.includes(fs.readFileSync(path.join(root, f), 'utf8')), f);
  assert.deepEqual(BUNDLE, ['talbot.py', 'poppy_toml.py']);
  for (const f of BUNDLE)
    assert.ok(
      html.includes(
        `<script type="text/x-python" data-ext="${f}">\n${fs.readFileSync(path.join(root, 'extensions', f), 'utf8')}</script>`,
      ),
      f,
    );
  assert.ok(
    html.indexOf('data-ext="talbot.py"') < html.indexOf('// vector.js'),
    'bundled before the page scripts read it',
  );
  assert.equal(html.split('<script type="text/x-python"').length - 1, BUNDLE.length);
  assert.ok(fs.existsSync(path.join(dir, '.nojekyll')));
  assert.equal(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), src);
  // everything else in the page is the source page, unchanged
  let n = 0;
  const strip = h =>
    h
      .replace(/<script type="text\/x-python"[\s\S]*?<\/script>\n/g, '')
      .replace(/<script>\n[\s\S]*?<\/script>/g, b =>
        /^<script>\s*window\.PAGE0/.test(b) ? b : `<script src="${local[n++]}"></script>`,
      ) // (the page's own inline script, which keeps its markup for read-only pages, stays as it is)
      .replace(/<style>\n[\s\S]*?<\/style>/, '<link rel="stylesheet" href="src/app/style.css" />');
  assert.equal(strip(html), src);
  fs.rmSync(dir, { recursive: true });
});

test('build: inline() refuses a script that would end its own block', () => {
  assert.throws(() => inline('<script src="a.js"></script>', () => 'x = "</script>"'), /a\.js contains/);
});
