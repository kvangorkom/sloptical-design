// pdf.js — minimal single-page vector PDF writer (lines, filled paths with transparency, text in the standard
// Helvetica / Times fonts). No dependencies. Coordinates are points, y down (the page is flipped once with `cm`).

/** A pen with the same interface as canvasPen() in draw.js, recording PDF content operators. */
function pdfPen() {
  const ops = [];
  const alphas = new Set();
  const n = v => +v.toFixed(3);
  const col = (c, op) => {
    const h = c.replace('#', '');
    const v = h.length === 3 ? [...h].map(x => x + x) : h.match(/../g);
    return (
      v
        .slice(0, 3)
        .map(x => n(parseInt(x, 16) / 255))
        .join(' ') +
      ' ' +
      op
    );
  };
  const path = (polys, close) =>
    polys
      .map(P => P.map((p, i) => `${n(p[0])} ${n(p[1])} ${i ? 'l' : 'm'}`).join(' ') + (close ? ' h' : ''))
      .join(' ');
  const gs = a => (a < 1 ? (alphas.add(+a.toFixed(2)), `/A${Math.round(a * 100)} gs `) : '');
  return {
    ops,
    alphas,
    line(P, { color, width = 1, dash = [], alpha = 1 }) {
      ops.push(
        `q ${gs(alpha)}${col(color, 'RG')} ${n(width)} w 1 J 1 j [${dash.map(n).join(' ')}] 0 d ${path([P])} S Q`,
      );
    },
    segs(L, { color, width = 1, alpha = 1 }) {
      if (L.length) ops.push(`q ${gs(alpha)}${col(color, 'RG')} ${n(width)} w 1 J 1 j [] 0 d ${path(L)} S Q`);
    },
    fill(polys, { color, alpha = 1, stroke, width = 1, strokeAlpha = 1 }) {
      if (!polys.length) return;
      ops.push(`q ${gs(alpha)}${col(color, 'rg')} ${path(polys, 1)} f Q`);
      if (stroke)
        ops.push(`q ${gs(strokeAlpha)}${col(stroke, 'RG')} ${n(width)} w 1 j [] 0 d ${path(polys, 1)} S Q`);
    },
    text(s, [x, y], { size, color, align = 'left', font }) {
      const w = pdfWidth(s, size, font);
      const x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
      ops.push(
        `q ${col(color, 'rg')} BT /${/serif|Times/i.test(font) && !/sans/i.test(font) ? 'F2' : 'F1'} ${n(size)} Tf 1 0 0 -1 ${n(x0)} ${n(y)} Tm (${pdfStr(s)}) Tj ET Q`,
      );
    },
    width: pdfWidth,
  };
}

/** Text as a PDF string in WinAnsi encoding: ASCII as is (with ( ) \ escaped), Latin-1 as octal, anything else → '?'.
 *  Covers the labels used here, including °, µ, ± and ×; − and ′ (prime) become - and '. */
const pdfStr = s =>
  [...String(s)]
    .map(ch => {
      const c = ch.codePointAt(0);
      return c < 32
        ? ' '
        : c < 127
          ? /[()\\]/.test(ch)
            ? '\\' + ch
            : ch
          : c >= 160 && c < 256
            ? '\\' + c.toString(8)
            : c === 0x2212
              ? '-'
              : c === 0x2032
                ? "'"
                : '?';
    })
    .join('');

/** Approximate width of s in the standard fonts (Adobe AFM advance widths, per mille, for the common characters). */
function pdfWidth(s, size, font = '') {
  const times = /serif|Times/i.test(font) && !/sans/i.test(font);
  const d = times ? 500 : 556;
  const W = times
    ? {
        ' ': 250,
        '.': 250,
        ',': 250,
        '-': 333,
        '°': 400,
        i: 278,
        l: 278,
        t: 278,
        f: 333,
        r: 333,
        m: 778,
        w: 722,
        M: 889,
        W: 944,
        I: 333,
      }
    : {
        ' ': 278,
        '.': 278,
        ',': 278,
        '-': 333,
        '°': 400,
        i: 222,
        l: 222,
        j: 222,
        t: 278,
        f: 278,
        r: 333,
        m: 833,
        w: 722,
        M: 833,
        W: 944,
        I: 278,
      };
  return (
    ([...String(s)].reduce(
      (a, ch) =>
        a + (W[ch] ?? (/[0-9]/.test(ch) ? (times ? 500 : 556) : /[A-Z]/.test(ch) ? (times ? 667 : 667) : d)),
      0,
    ) *
      size) /
    1000
  );
}

/** Assemble a one-page PDF of w × h points from a pen's operators. Returns the file bytes. */
function pdfDoc(w, h, pen, title = 'Sloptical Design figure') {
  const content = `1 0 0 -1 0 ${h} cm\n${pen.ops.join('\n')}`;
  const gs = [...pen.alphas]
    .map(a => `/A${Math.round(a * 100)} << /Type /ExtGState /ca ${a} /CA ${a} >>`)
    .join(' ');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${+w.toFixed(3)} ${+h.toFixed(3)}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> /ExtGState << ${gs} >> >> >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>',
    `<< /Title (${pdfStr(title)}) /Producer (Sloptical Design) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z) >>`,
  ];
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const at = [];
  objs.forEach((o, i) => {
    at.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const x = out.length;
  out +=
    `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map(a => `${String(a).padStart(10, '0')} 00000 n \n`).join('')}` +
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${objs.length} 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Uint8Array.from(out, c => c.charCodeAt(0));
}

/** The same pen for SVG: what a figure draws, as SVG elements (points, y down), for pages and slides. */
function svgPen() {
  const els = [];
  const n = v => +v.toFixed(3);
  const esc = t =>
    String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const d = (polys, close) =>
    polys
      .map(P => P.map((p, i) => `${i ? 'L' : 'M'}${n(p[0])} ${n(p[1])}`).join('') + (close ? 'Z' : ''))
      .join('');
  const op = (k, a) => (a < 1 ? ` ${k}="${+a.toFixed(2)}"` : '');
  return {
    els,
    line(P, { color, width = 1, dash = [], alpha = 1 }) {
      els.push(
        `<path d="${d([P])}" fill="none" stroke="${color}" stroke-width="${n(width)}" stroke-linecap="round" stroke-linejoin="round"${dash.length ? ` stroke-dasharray="${dash.map(n).join(' ')}"` : ''}${op('stroke-opacity', alpha)}/>`,
      );
    },
    segs(L, { color, width = 1, alpha = 1 }) {
      if (L.length)
        els.push(
          `<path d="${d(L)}" fill="none" stroke="${color}" stroke-width="${n(width)}" stroke-linecap="round"${op('stroke-opacity', alpha)}/>`,
        );
    },
    fill(polys, { color, alpha = 1, stroke, width = 1, strokeAlpha = 1 }) {
      if (!polys.length) return;
      els.push(`<path d="${d(polys, 1)}" fill="${color}"${op('fill-opacity', alpha)}/>`);
      if (stroke)
        els.push(
          `<path d="${d(polys, 1)}" fill="none" stroke="${stroke}" stroke-width="${n(width)}" stroke-linejoin="round"${op('stroke-opacity', strokeAlpha)}/>`,
        );
    },
    text(s, [x, y], { size, color, align = 'left', font }) {
      const fam =
        /serif|Times/i.test(font) && !/sans/i.test(font) ? 'Times, serif' : 'Helvetica, Arial, sans-serif';
      const anchor = align === 'right' ? 'end' : align === 'center' ? 'middle' : 'start';
      els.push(
        `<text x="${n(x)}" y="${n(y)}" font-family="${fam}" font-size="${n(size)}" fill="${color}" text-anchor="${anchor}">${esc(s)}</text>`,
      );
    },
    width: pdfWidth,
  };
}

/** An SVG document of w × h points from an svgPen. */
function svgDoc(w, h, pen, title = 'Sloptical Design figure') {
  const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${+w.toFixed(3)} ${+h.toFixed(3)}" width="${+w.toFixed(3)}pt" height="${+h.toFixed(3)}pt">\n` +
    `<title>${esc(title)}</title>\n<rect width="100%" height="100%" fill="#ffffff"/>\n${pen.els.join('\n')}\n</svg>\n`
  );
}

if (typeof module !== 'undefined') module.exports = { pdfPen, pdfDoc, pdfStr, pdfWidth, svgPen, svgDoc };
