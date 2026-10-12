// zip.js — a minimal .zip writer (files stored uncompressed), for exports of several files at once. No dependencies.

/** CRC-32 (IEEE) of bytes. */
function crc32(bytes) {
  let c = ~0;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/** A .zip of files [{ name, text }] (UTF-8), as bytes. */
function zipFiles(files) {
  const enc = new TextEncoder();
  const parts = [];
  const dir = [];
  let at = 0;
  const u16 = v => [v & 255, (v >>> 8) & 255];
  const u32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = enc.encode(f.text);
    const crc = crc32(data);
    // version 2.0, flag 0x800 (UTF-8 names), stored, no date
    const common = [
      ...u16(20),
      ...u16(0x800),
      ...u16(0),
      ...u16(0),
      ...u16(0x21),
      ...u32(crc),
      ...u32(data.length),
      ...u32(data.length),
      ...u16(name.length),
      ...u16(0),
    ];
    const local = Uint8Array.from([...u32(0x04034b50), ...common]);
    parts.push(local, name, data);
    dir.push(
      Uint8Array.from([
        ...u32(0x02014b50),
        ...u16(20),
        ...common,
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u32(0),
        ...u32(at),
      ]),
      name,
    );
    at += local.length + name.length + data.length;
  }
  const size = dir.reduce((n, p) => n + p.length, 0);
  const end = Uint8Array.from([
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(files.length),
    ...u16(files.length),
    ...u32(size),
    ...u32(at),
    ...u16(0),
  ]);
  const all = [...parts, ...dir, end];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of all) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

if (typeof module !== 'undefined') module.exports = { zipFiles, crc32 };
