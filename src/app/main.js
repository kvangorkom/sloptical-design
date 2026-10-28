// main.js — theme, and starting up: restore the open designs and extensions.

// Theme: follows the system until toggled; the choice is remembered.
const dark = () =>
  (document.documentElement.dataset.theme ||
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
const ICON = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
};
function themeIcon() {
  const d = dark();
  $('theme').setAttribute('aria-label', d ? 'Switch to light mode' : 'Switch to dark mode');
  $('theme').title = $('theme').ariaLabel;
  $('theme').innerHTML =
    `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">${ICON[d ? 'sun' : 'moon']}</svg>`;
}
$('theme').onclick = () => {
  const t = dark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem('optic_theme', t);
  } catch {}
};
try {
  const t = localStorage.getItem('optic_theme');
  if (t) document.documentElement.dataset.theme = t;
} catch {}

new ResizeObserver(draw).observe(cv);
new MutationObserver(() => {
  themeIcon();
  if (tw) tw.document.documentElement.dataset.theme = document.documentElement.dataset.theme ?? '';
  update();
}).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
matchMedia('(prefers-color-scheme: dark)').onchange = () => {
  themeIcon();
  update();
};
themeIcon();
dock(pref('optic_dock') === 'side' ? 'side' : 'bottom');
syncCam();
if (VIEWER)
  viewerBoot(); // a read-only page (viewer.js): its own design, nothing restored, loaded or stored
else {
  restoreDocs();
  hostReady();
  /** Extensions built into the page: the hosted build (build.js) embeds some as script blocks of type text/x-python with a
   *  data-ext attribute naming the file. They are always the page's own version; their settings are remembered like any other's. */
  const bundled = Object.fromEntries(
    [...document.querySelectorAll('script[type="text/x-python"][data-ext]')].map(sc => [
      sc.dataset.ext,
      sc.textContent.replace(/^\n/, ''),
    ]),
  );
  syncFolder(bundled, 'bundle');
  if (!Object.keys(bundled).length) scanExtensions(); // the extensions folder, when served (the hosted build has none)
  {
    const w = new URLSearchParams(location.search).get('watch');
    if (w) {
      fresh();
      Object.assign(file, { name: w.split('/').pop(), handle: null });
      watch(true, w);
    }
  }
  openLink(); // a link with a design in it (share.js)
}
