#!/usr/bin/env node
// build.js — the single-file site for hosting (GitHub Pages): dist/index.html with every local script and stylesheet
// inlined, and the extensions listed in BUNDLE embedded as <script type="text/x-python" data-ext="…"> blocks, which the
// page loads as built-in extensions. The source index.html bundles none: served locally it reads extensions/ itself.
//
//   node build.js [outDir]        (default: dist; also `npm run build`)
const fs = require('fs');
const path = require('path');

const BUNDLE = ['talbot.py', 'poppy_toml.py']; // extensions/ files built into the hosted page

// A local script or stylesheet (not http…) in index.html.
const LOCAL = /<script src="([^":]+)"><\/script>|<link rel="stylesheet" href="([^":]+)"\s*\/?>/g;

/** index.html as one self-contained page: local scripts and stylesheets inlined, `before` placed ahead of the first script.
 *  (One pass over the page, so text inside an inlined file is never mistaken for a tag.) */
function inline(html, read, before = '') {
  let first = true;
  return html.replace(LOCAL, (_, js, css) => {
    const [f, tag] = js ? [js, 'script'] : [css, 'style'];
    const text = read(f);
    if (text.toLowerCase().includes(`</${tag}`))
      throw Error(`${f} contains "</${tag}", which would end its block`);
    const block = `<${tag}>\n${text}</${tag}>`;
    if (!js || !first) return block;
    first = false;
    return before + block;
  });
}

/** Build the site into outDir; returns the path of the page written. */
function build(outDir = path.join(__dirname, 'dist')) {
  const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
  const py = BUNDLE.map(f => {
    const text = read('extensions/' + f);
    if (/<\/script/i.test(text)) throw Error(`${f} contains "</script", which would end its block`);
    return `<script type="text/x-python" data-ext="${f}">\n${text}</script>\n`;
  });
  const html = inline(read('index.html'), read, py.join(''));
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, 'index.html');
  fs.writeFileSync(out, html);
  fs.writeFileSync(path.join(outDir, '.nojekyll'), ''); // serve the files as they are
  return out;
}

if (require.main === module) {
  const out = build(process.argv[2] && path.resolve(process.argv[2]));
  const kB = (fs.statSync(out).size / 1024).toFixed(0);
  console.log(`Built ${path.relative(process.cwd(), out)} (${kB} kB) with ${BUNDLE.join(', ')} bundled.`);
}
module.exports = { build, inline, BUNDLE };
