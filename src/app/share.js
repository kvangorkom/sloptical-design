// share.js — designs in links: the design (its JSON, deflated, base64url) in the page address after "#d=". Opening such a
// link opens the design in a new tab. Links point at the hosted page (GitHub Pages) unless this page is itself on the web.

const SHARE_BASE = 'https://kvangorkom.github.io/sloptical-design/';

const b64url = bytes => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = t => Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const pipe = async (bytes, stream) =>
  new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

/** A design (any JSON value) as link text. */
async function packDesign(obj) {
  return b64url(
    await pipe(new TextEncoder().encode(JSON.stringify(obj)), new CompressionStream('deflate-raw')),
  );
}
/** The design in link text (from packDesign). Throws if it isn't one. */
async function unpackDesign(t) {
  return JSON.parse(
    new TextDecoder().decode(await pipe(unb64url(t), new DecompressionStream('deflate-raw'))),
  );
}

if (typeof module !== 'undefined') module.exports = { packDesign, unpackDesign };
else {
  /** The page's address for links: this one when it is on the web, else the hosted page. */
  const shareBase = () =>
    /^https?:$/.test(location.protocol) && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)
      ? location.origin + location.pathname
      : SHARE_BASE;
  /** File ▸ Copy link: the active design (and its configurations) as a link, on the clipboard. */
  window.copyLink = async () => {
    const link = `${shareBase()}#d=${await packDesign({ ...JSON.parse(JSON.stringify(sys)), name: file.name })}`;
    try {
      await navigator.clipboard.writeText(link);
      toast(`Link copied (${Math.round(link.length / 100) / 10}k characters)`);
    } catch {
      prompt('Copy this link:', link);
    }
  };
  /** Opening a link with a design: it opens in a tab of its own, unsaved; the address is cleared again. */
  window.openLink = async () => {
    const m = location.hash.match(/^#d=([\w-]+)/);
    if (!m) return;
    history.replaceState(null, '', location.pathname + location.search);
    try {
      const o = await unpackDesign(m[1]);
      const name = String(o.name || 'shared.json');
      delete o.name;
      openText(JSON.stringify(o), name);
    } catch {
      toast('That link doesn’t hold a design (it may be cut short)');
    }
  };
  addEventListener('hashchange', () => openLink());
}
