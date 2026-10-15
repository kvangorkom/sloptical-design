// zemax.js — Zemax OpticStudio interchange: export a .zmx lens file, and best-effort import of one.

(function engineZemax(Optics) {
  if (typeof module !== 'object') (Optics.SOURCES ??= []).push(String(engineZemax)); // (extensions' worker rebuilds the engine from these)
  ('use strict');
  const { add, carry, cross, dot, euler, turn, unit, angleAt, build, grid, hit, angle, efl, secant } = Optics;

  /** Zemax OpticStudio sequential lens file (.zmx) for the current geometry: surfaces, conics, spacings, glasses, fields,
   *  wavelength and entrance pupil. A beam from a focus becomes a finite object (thickness −R; negative, i.e. virtual,
   *  when converging) with object-height fields; a collimated beam an object at infinity with angle fields. Solves, pivots and apertures are not exported (the geometry they produce is).
   *  Each surface is written in a frame with its vertex at the origin and z along its parent axis. Between surfaces, one
   *  coordinate break moves that frame onto the next vertex and axis, in the form a designer would type: when the next
   *  vertex lies straight down the current axis (before a fold), thickness then tilt; when it lies straight down the new
   *  axis (after a fold), tilt then thickness; otherwise (an OAP's parent vertex) thickness, then decenter y and tilt. Zemax's mirror convention is kept: after an odd
   *  number of mirrors, light travels −z, so those frames are flipped (z → −z, y → −y), their curvatures change sign and
   *  thicknesses come out negative; a 45° fold exports as the usual CB, mirror, CB, negative thickness. OpticStudio tilts
   *  are right-handed about +x, which in this tool's y-up, z-right view is clockwise: tilt x = −(CCW turn). */
  function zemax(rows, { fields = [0], lambda = 0.55, lambdas, name = 'Optic Sketch' } = {}) {
    const waves = lambdas?.length > 1 ? lambdas : [lambda]; // the primary first
    const S = build(rows);
    const E = v => (+v).toExponential(15);
    const out = [];
    const sf = [];
    const surf = (type, lines) => sf.push([`TYPE ${type}`, ...lines]);
    const three = S.some(s => s.ex) || fields.some(Array.isArray);
    let σ = 1; // −1 after an odd number of mirrors
    const frames = [
      { V: [0, 0, 0], ez: [0, 0, 1], lines: ['STOP', 'CURV 0'] },
      ...S.map((s, i, _, g = σ, __ = s.mirror && (σ = -σ)) => ({
        V: s.V,
        ez: s.ez.map(v => g * v),
        lines: [
          `COMM ${(s.name || 'S' + (i + 1)).replace(/\s+/g, '_')}`,
          `CURV ${E(g * s.c)}`,
          `CONI ${E(s.k)}`,
          ...(s.mirror
            ? ['GLAS MIRROR 0 0 1.5 40 0 0 0 0 0 0']
            : s.nOut !== 1
              ? [
                  s.abbe // a model glass: its n (taken as n_d) and Abbe number
                    ? `GLAS ___BLANK 1 0 ${E(s.nOut)} ${E(s.abbe)} 0 0 0 0 0 0`
                    : `GLAS ___BLANK 1 0 ${E(s.nOut)} 1.0E+6 0 0 0 0 0 0`,
                ]
              : []),
        ],
      })),
    ];
    const cb = (dy, tilt, order, z) =>
      surf('COORDBRK', [
        'PARM 1 0',
        `PARM 2 ${E(dy)}`,
        `PARM 3 ${E(-tilt)}`,
        'PARM 4 0',
        'PARM 5 0',
        `PARM 6 ${order}`,
        `DISZ ${E(z)}`,
      ]);
    if (three) {
      // 3D: each break decenters in x and y, then tilts about x, y, z (order 0)
      σ = 1;
      const F3 = [
        { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1], V: [0, 0, 0] },
        ...S.map((s, i, _, g = σ, __ = s.mirror && (σ = -σ)) => ({
          X: s.ex ?? [1, 0, 0],
          Y: s.ey.map(v => g * v),
          Z: s.ez.map(v => g * v),
          V: s.V,
        })),
      ];
      frames.forEach((F, i) => {
        const A = F3[i];
        const N = F3[i + 1] ?? A;
        const q = add(N.V, A.V, -1);
        const ε = 1e-9;
        surf('STANDARD', [...F.lines, `DISZ ${E(dot(q, A.Z))}`]);
        const [t, y, k] = euler([A.X, A.Y, A.Z].map(a => [N.X, N.Y, N.Z].map(b => dot(a, b))));
        const dx = dot(q, A.X);
        const dy = dot(q, A.Y); // Zemax: right-handed, so tilt x = −(this tool's tilt)
        if ([dx, dy, t, y, k].some(v => Math.abs(v) > ε))
          surf('COORDBRK', [
            `PARM 1 ${E(dx)}`,
            `PARM 2 ${E(dy)}`,
            `PARM 3 ${E(-t)}`,
            `PARM 4 ${E(y)}`,
            `PARM 5 ${E(k)}`,
            'PARM 6 0',
            'DISZ 0',
          ]);
      });
    } else
      frames.forEach((F, i) => {
        const N = frames[i + 1] ?? F;
        const q = add(N.V, F.V, -1);
        const yz = ez => [dot(q, [0, ez[2], -ez[1]]), dot(q, ez)];
        const ε = 1e-9;
        const [dyF, dzF] = yz(F.ez);
        const [dyN, dzN] = yz(N.ez);
        const turn = ((angle(N.ez) - angle(F.ez) + 540) % 360) - 180;
        const after = Math.abs(dyF) > ε && Math.abs(dyN) < ε; // tilt first, then travel along the new axis
        surf('STANDARD', [...F.lines, `DISZ ${E(after ? 0 : dzF)}`]);
        if (after) cb(0, turn, 1, dzN);
        else if (Math.abs(dyF) > ε || Math.abs(turn) > ε) cb(dyF, turn, 0, 0);
      });
    surf('STANDARD', ['CURV 0', 'DISZ 0']); // image plane, on the last surface
    out.push(
      'VERS 190513 80 123457',
      'MODE SEQ',
      `NAME ${name}`,
      'UNIT MM X W X CM MR CPMM',
      `ENPD ${E(2 * rows[0].ap)}`,
      'GCAT SCHOTT',
      'RAIM 0 0 1 1 0 0 0 0 0',
      `FTYP ${rows[0].R ? 1 : 0} 0 ${fields.length} 1 0 0 0`,
      `XFLN ${fields.map(f => (Array.isArray(f) ? f[0] : 0)).join(' ')}`,
      `YFLN ${fields.map(f => (Array.isArray(f) ? f[1] : f)).join(' ')}`,
      `FWGN ${fields.map(() => 1).join(' ')}`,
      ...waves.map((l, k) => `WAVM ${k + 1} ${l} 1`),
      'PWAV 1',
      'SURF 0',
      '  TYPE STANDARD',
      '  CURV 0',
      `  DISZ ${rows[0].R ? E(-rows[0].R) : 'INFINITY'}`,
      ...sf.flatMap((l, i) => [`SURF ${i + 1}`, ...l.map(x => '  ' + x)]),
    );
    return out.join('\r\n') + '\r\n';
  }

  /** Text of a .zmx file from its bytes: OpticStudio saves UTF-16 (little-endian, with a byte-order mark); older files are
   *  plain ASCII. */
  function decodeText(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const le = (b[0] === 0xff && b[1] === 0xfe) || (b.length > 1 && b[0] && !b[1]);
    const be = b[0] === 0xfe && b[1] === 0xff;
    return new TextDecoder(le ? 'utf-16le' : be ? 'utf-16be' : 'utf-8').decode(b).replace(/^﻿/, '');
  }

  /** d-line indices (587.6 nm) of common catalogue glasses, for .zmx files that name a glass without giving its index. */
  const GLASS = {
    'N-BK7': 1.5168,
    BK7: 1.5168,
    F_SILICA: 1.45846,
    SILICA: 1.45846,
    'N-SF11': 1.78472,
    SF11: 1.78472,
    CAF2: 1.43385,
    'N-F2': 1.62004,
    F2: 1.62004,
    'N-SF6': 1.80518,
    SF6: 1.80518,
    'N-BAF10': 1.67003,
    'N-LAK22': 1.65113,
    'N-SF5': 1.67271,
    'N-SK16': 1.62041,
    'N-SF2': 1.64769,
    'N-K5': 1.52249,
    'N-LASF9': 1.85025,
    'N-SF10': 1.72828,
    SF10: 1.72825,
    SAPPHIRE: 1.7682,
    MGF2: 1.3777,
  };
  /** Their Abbe numbers (d line). */
  const GLASS_ABBE = {
    'N-BK7': 64.17,
    BK7: 64.17,
    F_SILICA: 67.82,
    SILICA: 67.82,
    'N-SF11': 25.68,
    SF11: 25.76,
    CAF2: 94.99,
    'N-F2': 36.37,
    F2: 36.37,
    'N-SF6': 25.36,
    SF6: 25.43,
    'N-BAF10': 47.11,
    'N-LAK22': 55.89,
    'N-SF5': 32.25,
    'N-SK16': 60.32,
    'N-SF2': 33.82,
    'N-K5': 59.48,
    'N-LASF9': 32.17,
    'N-SF10': 28.53,
    SF10: 28.41,
    SAPPHIRE: 72.24,
    MGF2: 106.18,
  };

  /** Best-effort import of a Zemax OpticStudio sequential file (.zmx text; see decodeText) into rows for this tool.
   *  Kept: radius, conic, spacings, coordinate breaks, mirrors, glass indices and Abbe numbers, the stop,
   *  fields, primary wavelength, the aperture and surface comments. Ignored, with a warning where they occur: solves,
   *  multiple configurations (the lens data as saved), aspheric and other higher-order terms, apertures, and anything out
   *  of the drawn plane. plane: the file's global plane drawn as this tool's y–z plane: 'yz' (the default, as OpticStudio's
   *  Cross-Section layout; out of it: decenters in x, tilts about y) or 'xz' (global x drawn as y; for systems folded in x–z).
   *  Placement is absolute: every surface's vertex and axis are first found in the file's global frame with OpticStudio's
   *  rules (thickness along local z; a coordinate break decenters then tilts about x, y, z in the rotated frame, or tilts
   *  z, y, x then decenters). The on-axis ray is aimed through the stop centre, and the entrance pupil is where a small-field
   *  chief ray crosses it in object space. This tool's pupil goes there (the origin, z along the object-space axis), and each
   *  surface's distance, off-axis height and tilt are read off where the axis ray meets it, so the rows rebuild the same
   *  vertices and axes. Returns { name, plane, fields, lambda, rays, grid, rows, warnings }. */
  function fromZemax(txt, { plane = 'yz' } = {}) {
    if (!['yz', 'xz', '3d'].includes(plane)) throw Error(`plane ${plane}: choose yz or xz (or 3d)`);
    const D3 = plane === '3d'; // 3D: keep x (tilts about y and z, decenters in x)
    const inP = plane === 'xz' ? 0 : 1;
    const outP = 1 - inP; // the global axis drawn as this tool's y, and the one dropped
    const warnings = new Set();
    const warn = m => warnings.add(m);
    const head = {};
    const Z = [];
    let cur = null;
    for (const raw of txt.split(/\r?\n/)) {
      // indented lines belong to the SURF above them
      if (!raw.trim()) continue;
      const [key, ...a] = raw.trim().split(/\s+/);
      if (/^\s/.test(raw) && cur) {
        (cur[key] ??= []).push(a);
        continue;
      }
      cur = null;
      if (key === 'SURF') Z.push((cur = { i: +a[0] }));
      else (head[key] ??= []).push(a);
    }
    if (Z.length < 2) throw Error('no surfaces found: not a sequential .zmx file');
    const f =
      { MM: 1, CM: 10, IN: 25.4, METER: 1000, M: 1000 }[head.UNIT?.[0][0] ?? 'MM'] ??
      (warn(`unknown units ${head.UNIT[0][0]}; read as mm`), 1);
    const num = (v, d = 0) => (v === undefined ? d : /^inf/i.test(v) ? Infinity : +v);
    const get = (z, k, j = 0) => num(z[k]?.[0]?.[j]);
    if (num(head.MNUM?.[0]?.[0], 1) > 1)
      warn(`${head.MNUM[0][0]} configurations: imported the lens data as saved (the active configuration)`);
    // Frames in the file's global coordinates (surface 0 at the origin): vertex O and axes M = [X, Y, Z] as columns.
    const mul = (A, B) =>
      A.map((r, i) => B[0].map((_, j) => r.reduce((s, _, k) => s + A[i][k] * B[k][j], 0)));
    const Rx = t => {
      const c = Math.cos(t);
      const s = Math.sin(t);
      return [
        [1, 0, 0],
        [0, c, -s],
        [0, s, c],
      ];
    };
    const Ry = t => {
      const c = Math.cos(t);
      const s = Math.sin(t);
      return [
        [c, 0, s],
        [0, 1, 0],
        [-s, 0, c],
      ];
    };
    const Rz = t => {
      const c = Math.cos(t);
      const s = Math.sin(t);
      return [
        [c, -s, 0],
        [s, c, 0],
        [0, 0, 1],
      ];
    };
    const col = (M, v) => [0, 1, 2].map(i => M[i][0] * v[0] + M[i][1] * v[1] + M[i][2] * v[2]);
    const rd = Math.PI / 180;
    let O = [0, 0, 0];
    let M = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    let n = 1;
    let abbe = 0;
    let out = false;
    const obj = get(Z[0], 'DISZ') * f;
    const A = [];
    if (isFinite(obj)) O = [0, 0, obj];
    for (const z of Z.slice(1)) {
      const type = z.TYPE?.[0][0] ?? 'STANDARD';
      const t = get(z, 'DISZ') * f;
      const P = k => num(z.PARM?.find(p => +p[0] === k)?.[1]);
      const nm = (z.COMM?.[0] ?? []).join(' ');
      if (type === 'COORDBRK') {
        const dec = () => {
          O = add(O, col(M, [P(1) * f, P(2) * f, 0]));
        };
        if (P(6)) {
          M = mul(mul(mul(M, Rz(P(5) * rd)), Ry(P(4) * rd)), Rx(P(3) * rd));
          dec();
        } else {
          dec();
          M = mul(mul(mul(M, Rx(P(3) * rd)), Ry(P(4) * rd)), Rz(P(5) * rd));
        }
        if (
          !D3 &&
          ((plane === 'yz' ? P(1) || P(4) : P(2) || P(3)) || (P(5) && Math.abs(Math.sin(P(5) * rd)) > 1e-12))
        )
          out = true;
      } else {
        const g = z.GLAS?.[0];
        const mirror = g?.[0] === 'MIRROR';
        const ez = [M[0][2], M[1][2], M[2][2]];
        if (!mirror) {
          n =
            !g || (g[0] === '___BLANK' && !(+g[3] > 1))
              ? 1
              : +g[3] > 1 && +g[3] < 5
                ? +g[3]
                : (GLASS[g[0].toUpperCase()] ?? (warn(`unknown glass ${g[0]}: n = 1.5`), 1.5));
          abbe =
            n === 1
              ? 0
              : g?.[0] === '___BLANK'
                ? +g[4] > 0 && +g[4] < 1e5
                  ? +g[4]
                  : 0
                : (GLASS_ABBE[g?.[0]?.toUpperCase()] ?? 0);
        }
        if (
          !['STANDARD', 'EVENASPH', 'TOROIDAL', 'BICONICX', 'BICONIC', 'ODDASPH', 'XASPHERE'].includes(type)
        )
          warn(`${type} surface${nm ? ` (${nm})` : ''} read as a standard surface`);
        else if (type !== 'STANDARD' && z.PARM?.some(p => +p[1]))
          warn(`higher-order terms of ${type} surfaces ignored`);
        if (!D3 && (Math.abs(O[outP]) > 1e-9 || Math.abs(ez[outP]) > 1e-12)) out = true;
        const ax = j => [M[0][j], M[1][j], M[2][j]];
        A.push({
          zi: z.i,
          name: nm,
          V: D3 ? [...O] : [0, O[inP], O[2]],
          ez: D3 ? ax(2) : unit([0, ez[inP], ez[2]]),
          ...(D3 && { ex: ax(0), ey: ax(1) }),
          c: get(z, 'CURV') / f,
          k: get(z, 'CONI'),
          mirror,
          n,
          abbe,
          stop: !!z.STOP,
        });
      }
      O = add(O, col(M, [0, 0, t]));
    }
    if (out)
      warn(
        plane === 'yz'
          ? 'geometry out of the y–z plane (decenters in x, tilts about y or z) projected onto it (import in 3D to keep it)'
          : 'geometry out of the x–z plane (decenters in y, tilts about x or z) projected onto it (import in 3D to keep it)',
      );
    // Trace in global coordinates, aiming at the stop centre. Object space: collimated along the object z axis, or from the object point.
    const surf = (a, T = x => x, D = x => x) => {
      const ez = D(a.ez);
      return {
        ...a,
        V: T(a.V),
        ez,
        ...(a.ex ? { ex: D(a.ex), ey: D(a.ey) } : { ey: [0, ez[2], -ez[1]] }),
        d: 0,
        zM: 0,
        ap: 0,
      };
    };
    const G = A.map(a => surf(a));
    const si = Math.max(
      0,
      G.findIndex(a => a.stop),
    );
    const fin = isFinite(obj);
    const ray = (x, h) =>
      fin
        ? { p: [0, h, 0], u: [0, Math.sin(x), Math.cos(x)], n: 1 }
        : { p: [0, x, 0], u: [0, Math.sin(h), Math.cos(h)], n: 1 };
    const atStop = r => {
      for (let j = 0; j <= si; j++) if (!(r = hit(G[j], r))) return NaN;
      return r.loc[1];
    };
    const aim = (h, y = 0) => secant(x => atStop(ray(x, h)) - y, 0, 1e-3); // x: height (collimated) or angle (finite); h: field
    const x0 = aim(0);
    const ε = 1e-4;
    const xε = aim(fin ? 1e-3 * Math.max(1, Math.abs(obj) * 1e-3) : ε);
    if (!isFinite(x0)) throw Error('could not aim the on-axis ray through the stop');
    const r0 = ray(x0, 0);
    const u0 = r0.u;
    const Yw = [0, u0[2], -u0[1]];
    let E = r0.p; // entrance pupil: where a chief ray crosses the axis ray
    if (isFinite(xε)) {
      const r1 = ray(xε, fin ? 1e-3 * Math.max(1, Math.abs(obj) * 1e-3) : ε);
      const w = add(r1.p, r0.p, -1);
      const den = r0.u[1] * r1.u[2] - r0.u[2] * r1.u[1];
      const s = den && (w[1] * r1.u[2] - w[2] * r1.u[1]) / den;
      if (Math.abs(s) < 1e7) E = add(r0.p, r0.u, s);
    }
    // Aperture: the entrance pupil's semi-diameter.
    const stopY = get(Z[G[si].zi] ?? {}, 'DIAM') * f;
    const lateral = x => {
      const r = ray(x, 0);
      const s = dot(add(E, r.p, -1), u0) / dot(r.u, u0);
      return Math.abs(dot(add(add(r.p, r.u, s), E, -1), Yw));
    };
    let ap = NaN;
    if (head.FLOA) ap = stopY ? lateral(aim(0, stopY)) : NaN;
    else if (head.FNUM && !fin)
      ap = -num(head.FNUM[0][0]); // resolved from the EFL below
    else if (head.OBNA && fin)
      ap = Math.abs(dot(add(E, [0, 0, 0], -1), u0)) * Math.tan(Math.asin(num(head.OBNA[0][0])));
    else if (head.ENPD) ap = (num(head.ENPD[0][0]) * f) / 2;
    if (!(Math.abs(ap) > 0)) {
      ap = stopY || 10;
      warn(`aperture type not read: pupil semi-diameter ${+ap.toPrecision(6)} mm`);
    }
    // Into this tool's frame (pupil at the origin, z along the object-space axis) and down the axis ray.
    const Xw = cross(Yw, u0);
    const T = p => [D3 ? dot(add(p, E, -1), Xw) : 0, dot(add(p, E, -1), Yw), dot(add(p, E, -1), u0)];
    const Td = v => [D3 ? dot(v, Xw) : 0, dot(v, Yw), dot(v, u0)];
    const rows = [{ t: 0, ap, R: fin ? T([0, 0, 0])[2] : 0 }];
    let r = { p: [0, 0, 0], u: [0, 0, 1], n: 1 };
    let nIn = 1;
    let fx = [1, 0, 0];
    let fy = [0, 1, 0]; // (3D: the incoming frame, carried as build carries it)
    for (const [j, a] of A.entries()) {
      const s = surf(a, T, Td);
      if (
        j === si &&
        !s.c &&
        !s.mirror &&
        s.n === nIn &&
        Math.hypot(...s.V) < 1e-6 * (1 + Math.abs(obj === Infinity ? 0 : obj))
      ) {
        nIn = s.n;
        continue;
      } // the stop is the pupil
      const h = hit(s, r);
      if (!h) {
        warn(`the axis ray misses surface ${a.zi}${a.name ? ` (${a.name})` : ''}; import stops there`);
        break;
      }
      const σ = dot(s.ez, r.u) < 0 ? -1 : 1;
      const ez = s.ez.map(v => σ * v);
      const c = σ * s.c;
      const ey = [0, ez[2], -ez[1]];
      rows.at(-1).t = dot(add(h.p, r.p, -1), r.u);
      if (D3) {
        // the segment's azimuth on the parent becomes the clock: of ±, the smaller clock
        const q = add(h.p, s.V, -1);
        const zq = dot(q, ez);
        const ρv = add(q, ez, -zq);
        const ρ = c ? Math.hypot(...ρv) : 0;
        const Fin = [fx, fy, r.u];
        const yh =
          ρ > 1e-9 * (1 + Math.hypot(...q))
            ? ρv.map(v => v / ρ)
            : unit(
                add(
                  Math.abs(dot(fy, ez)) < 0.99 ? fy : fx,
                  ez,
                  -dot(Math.abs(dot(fy, ez)) < 0.99 ? fy : fx, ez),
                ),
              );
        const opt = [1, -1]
          .map(g => {
            const ey = yh.map(v => g * v);
            const ex = cross(ey, ez);
            const e = euler(Fin.map(f => [ex, ey, ez].map(w => dot(f, w))));
            return { g, ex, e };
          })
          .sort((a, b) => Math.abs(a.e[2]) - Math.abs(b.e[2]))[0];
        const y = opt.g * ρ;
        const th = angleAt(c, s.k, y, zq);
        const steep = Math.abs(th) > 80;
        rows.push({
          name: a.name || (j === A.length - 1 ? 'Image' : ''),
          type: s.mirror ? 'mirror' : 'refract',
          R: c ? 1 / c : 0,
          k: s.k,
          d: steep ? th : y,
          ...(steep ? { oa: 'angle' } : {}),
          tilt: opt.e[0],
          tiltY: opt.e[1],
          clock: opt.e[2],
          t: 0,
          n: s.mirror ? 1 : s.n,
          ...(s.abbe && !s.mirror ? { abbe: s.abbe } : {}),
          ap: 0,
        });
        [fx, fy] = carry(fx, fy, r.u, h.u, opt.ex);
      } else {
        const q = add(h.p, s.V, -1);
        const y = c ? dot(q, ey) : 0;
        const th = angleAt(c, s.k, y, dot(q, ez));
        const steep = Math.abs(th) > 80; // near or past an ellipsoid's equator: by angle
        rows.push({
          name: a.name || (j === A.length - 1 ? 'Image' : ''),
          type: s.mirror ? 'mirror' : 'refract',
          R: c ? 1 / c : 0,
          k: s.k,
          d: steep ? th : y,
          ...(steep ? { oa: 'angle' } : {}),
          tilt: ((angle(ez) - angle(r.u) + 540) % 360) - 180,
          t: 0,
          n: s.mirror ? 1 : s.n,
          ...(s.abbe && !s.mirror ? { abbe: s.abbe } : {}),
          ap: 0,
        });
      }
      r = h;
      nIn = h.n;
    }
    const size = Math.max(1, ...rows.map(r => Math.abs(r.t))); // round-off (1e-14 off-axis and the like) reads as 0
    for (const r of rows)
      for (const k of ['t', 'R', 'd', 'tilt', 'tiltY', 'clock', 'ap'])
        if (typeof r[k] === 'number')
          r[k] =
            Math.abs(r[k]) < 1e-11 * (['tilt', 'tiltY', 'clock'].includes(k) ? 1 : size)
              ? 0
              : +r[k].toPrecision(14);
    for (const r of rows) for (const k of ['tiltY', 'clock']) if (r[k] === 0) delete r[k]; // (a planar row stays planar)
    const [p, q] = rows.slice(-2); // an image plane written on top of the last surface
    if (
      rows.length > 2 &&
      !q.R &&
      !p.R &&
      p.type === 'refract' &&
      q.type === 'refract' &&
      Math.abs(p.t) < 1e-9 &&
      q.n === p.n &&
      !q.tilt &&
      !q.tiltY
    )
      rows.pop();
    const fty = num(head.FTYP?.[0]?.[0]);
    const nf = num(head.FTYP?.[0]?.[2], 1);
    const sg = Yw[1] < 0 ? -1 : 1;
    const [FIN, FOUT] = plane === 'xz' ? ['XFLN', 'YFLN'] : ['YFLN', 'XFLN']; // the fields in the drawn plane (3D: y, with x below)
    let fields = (head[FIN]?.[0] ?? ['0']).slice(0, nf).map(v => sg * num(v) * (fty === 1 ? f : 1));
    if (D3)
      fields = fields.map((y, k) => {
        const x = num(head.XFLN?.[0]?.[k]) * (fty === 1 ? f : 1);
        return x ? [x, y] : y;
      }); // (x as drawn: Xw is +x)
    else if ((head[FOUT]?.[0] ?? []).slice(0, nf).some(v => +v))
      warn(`${plane === 'yz' ? 'x' : 'y'} fields ignored`);
    if (!((fty === 0 && !fin) || (fty === 1 && fin))) {
      warn(`field type ${fty} not read: on-axis field only`);
      fields = [0];
    }
    if (ap < 0) {
      const S = build(rows);
      const F = efl(S, 1e-4);
      rows[0].ap = Math.abs(F) / (2 * -ap);
      if (!isFinite(rows[0].ap)) rows[0].ap = stopY || 10;
    }
    const wl = head.WAVM?.map(w => [num(w[0]), num(w[1])]).filter(w => w[1] > 0);
    const pw = num(head.PWAV?.[0]?.[0], 1);
    const lambda = wl?.find(w => w[0] === pw)?.[1] || 0.55;
    const lambdas = wl?.length > 1 ? [lambda, ...wl.filter(w => w[0] !== pw).map(w => w[1])] : undefined; // the primary first
    return {
      name: (head.NAME?.[0] ?? []).join(' '),
      plane,
      fields: [...new Map(fields.map(f => [JSON.stringify(f), f])).values()],
      lambda,
      ...(lambdas && { lambdas }),
      rays: 9,
      grid: 21,
      rows,
      warnings: [...warnings],
    };
  }

  Object.assign(Optics, { zemax, decodeText, GLASS, fromZemax });
  if (typeof module === 'object') module.exports = Optics;
})(typeof module === 'object' ? require('./edit.js') : globalThis.Optics);
