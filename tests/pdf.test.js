// The PDF writer: structure (every xref offset lands on its object), transparency, text encoding and widths.
// Run: node --test
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pdfPen, pdfDoc, pdfStr, pdfWidth } = require('../src/app/pdf.js');

test('a one-page PDF with a correct cross-reference table, page size and fonts', () => {
  const g = pdfPen();
  g.fill(
    [
      [
        [0, 0],
        [10, 0],
        [5, 8],
      ],
    ],
    { color: '#0072B2', alpha: 0.3, stroke: '#000', width: 0.5 },
  );
  g.line(
    [
      [0, 20],
      [100, 20],
    ],
    { color: '#D55E00', width: 0.6, dash: [3, 2] },
  );
  g.text('OAP 1 (f = 500) 0.5°', [10, 30], { size: 7, color: '#000', font: 'Helvetica' });
  g.text('Times', [90, 40], { size: 7, color: '#333', font: 'Times', align: 'right' });
  const b = pdfDoc(240.945, 120, g);
  const s = String.fromCharCode(...b);
  assert.ok(s.startsWith('%PDF-1.4') && s.trimEnd().endsWith('%%EOF'));
  const xref = +s.match(/startxref\n(\d+)/)[1];
  assert.equal(s.slice(xref, xref + 4), 'xref');
  const offs = s
    .slice(xref)
    .split('\n')
    .filter(l => / 00000 n $/.test(l))
    .map(l => +l.slice(0, 10));
  offs.forEach((o, i) =>
    assert.equal(s.slice(o, o + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`, `object ${i + 1} offset`),
  );
  const len = +s.match(/\/Length (\d+) >>\nstream\n/)[1];
  const start = s.indexOf('stream\n') + 7;
  assert.equal(s.slice(start + len, start + len + 10), '\nendstream', 'stream length');
  assert.ok(
    s.includes('/MediaBox [0 0 240.945 120]') &&
      s.includes('/BaseFont /Helvetica') &&
      s.includes('/BaseFont /Times-Roman'),
  );
  assert.ok(
    s.includes('/A30 << /Type /ExtGState /ca 0.3 /CA 0.3 >>') && s.includes('/A30 gs'),
    'transparency',
  );
  assert.ok(s.includes('1 0 0 -1 0 120 cm'), 'y-down page');
  assert.ok(/\/F2 7 Tf/.test(s) && /\/F1 7 Tf/.test(s));
});

test('text: WinAnsi encoding with escapes; widths from the font metrics', () => {
  assert.equal(pdfStr('a(b)\\c'), 'a\\(b\\)\\\\c');
  assert.equal(pdfStr('0.5°'), '0.5\\260');
  assert.equal(pdfStr('µm'), '\\265m');
  assert.equal(pdfStr('λ'), '?');
  assert.equal(pdfWidth('100 mm', 10, 'Helvetica'), ((3 * 556 + 278 + 2 * 833) * 10) / 1000);
  assert.equal(pdfWidth('100 mm', 10, 'Times'), ((3 * 500 + 250 + 2 * 778) * 10) / 1000);
});
