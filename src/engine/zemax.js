// zemax.js — Zemax OpticStudio interchange: export a .zmx lens file, and best-effort import of one. Also a system reversed
// (reverseSystem), and placeRows, which re-describes surfaces placed absolutely (as the import and the reversal do) from
// any starting point, direction and frame.

(function engineZemax(Optics) {
  if (typeof module !== 'object') (Optics.SOURCES ??= []).push(String(engineZemax)); // (extensions' worker rebuilds the engine from these)
  ('use strict');
  const {
    add,
    carry,
    cross,
    dot,
    euler,
    turn,
    unit,
    angleAt,
    build,
    grid,
    hit,
    angle,
    efl,
    secant,
    trace,
    start,
    inFocus,
  } = Optics;

  /** Zemax OpticStudio sequential lens file (.zmx) for the current geometry: surfaces, conics, spacings, glasses, fields,
   *  wavelength and entrance pupil. A beam from a focus becomes a finite object (thickness −R; negative, i.e. virtual,
   *  when converging) with object-height fields; a collimated beam an object at infinity with angle fields. Solves, pivots and apertures are not exported (the geometry they produce is).
   *  Each surface is written in a frame with its vertex at the origin and z along its parent axis. Between surfaces, one
   *  coordinate break moves that frame onto the next vertex and axis, in the form a designer would type: when the next
   *  vertex lies straight down the current axis (before a fold), thickness then tilt; when it lies straight down the new
   *  axis (after a fold), tilt then thickness; otherwise (an OAP's parent vertex) thickness, then decenter y and tilt. Zemax's mirror convention is kept: after an odd
   *  number of mirrors, light travels −z, so those frames are flipped (z → −z, y → −y), their curvatures change sign and
   *  thicknesses come out negative; a 45° fold exports as the usual CB, mirror, CB, negative thickness. OpticStudio tilts
   *  are right-handed about +x, which in this tool's y-up, z-right view is clockwise: tilt x = −(CCW turn). A double pass
   *  is written by zemaxConfigs: the way back as surfaces of its own. */
  function zemax(rows, { fields = [0], lambda = 0.55, lambdas, name = 'Sloptical Design' } = {}) {
    const waves = lambdas?.length > 1 ? lambdas : [lambda]; // the primary first
    const S = build(rows);
    if (S.dp) return zemaxConfigs([{ rows }], { fields, lambda, lambdas, name }).text; // the way back written out
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
        type: s.para ? 'PARAXIAL' : 'STANDARD',
        lines: [
          `COMM ${(s.name || 'S' + (i + 1)).replace(/\s+/g, '_')}`,
          `CURV ${E(g * s.c)}`,
          ...(s.para ? [`PARM 1 ${E(s.f)}`, 'PARM 2 1'] : [`CONI ${E(s.k)}`]), // (an ideal lens: focal length, OPD by integration)
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
        surf(F.type ?? 'STANDARD', [...F.lines, `DISZ ${E(dot(q, A.Z))}`]);
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
        surf(F.type ?? 'STANDARD', [...F.lines, `DISZ ${E(after ? 0 : dzF)}`]);
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
      `FTYP ${rows[0].R ? 1 : 0} 0 ${fields.length} ${waves.length} 0 0 0`,
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

  /** The sequence a design's light meets, as frames for a .zmx: the stop (the pupil), each surface, and in a double pass
   *  (S.dp) the way back: the surfaces before the last mirror again, last first, met from the other side, then the pupil
   *  plane where the light came in. Each: { key (the row's id, or its index; '<' marks the way back), V and frame X, Y, Z
   *  (Z the surface's axis, signed so that, as OpticStudio expects, the light travels +Z before an even number of mirrors
   *  and −Z after an odd one), lines (TYPE, COMM, CURV, CONI or PARM, GLAS) }. */
  function zmxPath(rows) {
    const S = build(rows);
    const E = v => (+v).toExponential(15);
    const key = i => (rows[i]?.id !== undefined ? String(rows[i].id) : 'r' + i);
    const glass = (n, abbe) =>
      n === 1
        ? []
        : [
            abbe // a model glass: its n (taken as n_d) and Abbe number
              ? `GLAS ___BLANK 1 0 ${E(n)} ${E(abbe)} 0 0 0 0 0 0`
              : `GLAS ___BLANK 1 0 ${E(n)} 1.0E+6 0 0 0 0 0 0`,
          ];
    const els = [
      { key: 'stop', V: [0, 0, 0], ez: [0, 0, 1], ey: [0, 1, 0], u: [0, 0, 1], plain: ['STOP', 'CURV 0'] },
    ];
    const ax = trace(S, 0, 0, 0);
    S.forEach((s, i) =>
      els.push({
        key: key(i + 1),
        s,
        u: s.uIn,
        n: s.mirror ? 1 : s.nOut,
        abbe: rows[i + 1].abbe,
        name: s.name || 'S' + (i + 1),
      }),
    );
    if (S.dp && ax.length === S.length) {
      const back = Optics.traceBack(S, ax.at(-1));
      let u = S.at(-1).uOut;
      for (let i = S.length - 2, k = 0; i >= 0 && k < back.length; i--, k++) {
        const s = S[i];
        els.push({
          key: key(i + 1) + '<',
          s,
          u,
          n: s.mirror ? 1 : s.nIn,
          abbe: s.mirror ? 0 : i ? rows[i].abbe || 0 : 0,
          name: (s.name || 'S' + (i + 1)) + ' (back)',
        });
        u = back[k].u;
      }
      if (back.length === S.length)
        els.push({
          key: 'stop<',
          V: [0, 0, 0],
          ez: [0, 0, 1],
          ey: [0, 1, 0],
          u,
          plain: ['COMM Pupil_(back)', 'CURV 0'],
        });
    }
    let σ = 1;
    return els.map(e => {
      const s = e.s;
      const ez = s ? s.ez : e.ez;
      const g = σ * (dot(e.u, ez) < 0 ? -1 : 1);
      if (s?.mirror) σ = -σ;
      const X = s ? (s.ex ?? [1, 0, 0]) : [1, 0, 0];
      const out = {
        key: e.key,
        V: s ? s.V : e.V,
        X,
        Y: (s ? s.ey : e.ey).map(v => g * v),
        Z: ez.map(v => g * v),
      };
      if (!s) return { ...out, type: 'STANDARD', lines: e.plain };
      out.type = s.para ? 'PARAXIAL' : 'STANDARD';
      out.lines = [
        `COMM ${e.name.replace(/\s+/g, '_')}`,
        `CURV ${E(g * s.c)}`,
        ...(s.para ? [`PARM 1 ${E(s.f)}`, 'PARM 2 1'] : [`CONI ${E(s.k)}`]),
        ...(s.mirror ? ['GLAS MIRROR 0 0 1.5 40 0 0 0 0 0 0'] : glass(e.n, e.abbe)),
      ];
      return out;
    });
  }

  /** One .zmx holding several configurations of a design in OpticStudio's multi-configuration editor. designs: [{ name,
   *  rows }], each a configuration's rows (as configRows gives them: rows shared between configurations carry the same
   *  id). Every surface any of them meets is in the one lens table, in an order each configuration's own follows; each is
   *  written as the surface then a coordinate break to the next one (decenter x, y, then tilt about x, y, z), and the
   *  values that differ between configurations (thicknesses, the breaks, curvatures, conics, paraxial focal lengths,
   *  comments) go in the editor (THIC, PRAM, CRVT, CONN, MCOM), as do the surfaces a configuration doesn't have (IGNM,
   *  surface and break together). A double pass (the last row's dp) is written out: the way back as surfaces of its own,
   *  ending on the pupil plane. Fields, wavelengths and the entrance pupil are the first configuration's (warned when they
   *  differ); active (an index) is the one saved as current. Returns { text, warnings }. */
  function zemaxConfigs(
    designs,
    { fields = [0], lambda = 0.55, lambdas, name = 'Sloptical Design', active = 0 } = {},
  ) {
    const waves = lambdas?.length > 1 ? lambdas : [lambda];
    const E = v => (+v).toExponential(15);
    const warnings = [];
    const paths = designs.map(d => zmxPath(d.rows));
    // one order for every configuration's surfaces: each configuration's own order is kept (a surface met out of the order
    // so far gets an entry of its own)
    const L = [];
    paths.forEach((P, ci) => {
      let at = -1;
      for (const el of P) {
        let k = L.indexOf(el.key);
        if (k >= 0 && k <= at) {
          el.key += `@${ci}`;
          k = -1;
        }
        if (k < 0) {
          L.splice(at + 1, 0, el.key);
          k = at + 1;
        }
        at = k;
      }
    });
    // per configuration, each surface's lines, thickness and break to the next surface it meets
    const per = paths.map(P => {
      const m = new Map();
      P.forEach((A, i) => {
        const N = P[i + 1] ?? A;
        const q = add(N.V, A.V, -1);
        const [t, y, k] = euler([A.X, A.Y, A.Z].map(a => [N.X, N.Y, N.Z].map(b => dot(a, b))));
        m.set(A.key, {
          type: A.type,
          lines: A.lines,
          disz: dot(q, A.Z),
          cb: [dot(q, A.X), dot(q, A.Y), -t, y, k].map(v => (Math.abs(v) < 1e-12 ? 0 : v)),
        });
      });
      return m;
    });
    const nC = designs.length;
    const first = j => (per[active]?.has(L[j]) ? active : per.findIndex(m => m.has(L[j])));
    const ops = [];
    const op = (code, surf, ci, value, int2 = 0) =>
      ops.push(`${code} ${surf} ${ci + 1} ${value} 0 ${int2} 0 1 1 1 0 0 "" 0`);
    const sf = [];
    const val = (lines, k) => lines.find(l => l.startsWith(k + ' '))?.slice(k.length + 1);
    L.forEach((key, j) => {
      const base = per[first(j)].get(key);
      const sEl = 2 * j + 1; // the surface; its break follows
      sf.push([`TYPE ${base.type}`, ...base.lines, `DISZ ${E(base.disz)}`]);
      sf.push(['TYPE COORDBRK', ...base.cb.map((v, p) => `PARM ${p + 1} ${E(v)}`), 'PARM 6 0', 'DISZ 0']);
      const have = per.map(m => m.get(key));
      if (nC < 2) return;
      if (have.some(h => !h))
        for (let ci = 0; ci < nC; ci++) op('IGNM', sEl, ci, have[ci] ? '0' : '1', sEl + 1);
      const each = f => per.map((m, ci) => f(have[ci] ?? base));
      const same = (a, b) =>
        a === b ||
        (isFinite(+a) &&
          isFinite(+b) &&
          a !== '' &&
          b !== '' &&
          Math.abs(+a - +b) <= 1e-10 * (1 + Math.abs(+a)));
      const differ = vs => vs.some((v, ci) => have[ci] && !same(v, vs[first(j)]));
      const write = (code, surf, vs, int2, fmt = v => v) => {
        if (differ(vs)) vs.forEach((v, ci) => op(code, surf, ci, fmt(v), int2));
      };
      write(
        'THIC',
        sEl,
        each(h => E(h.disz)),
        0,
      );
      for (let p = 0; p < 5; p++)
        write(
          'PRAM',
          sEl + 1,
          each(h => E(h.cb[p])),
          p + 1,
        );
      write(
        'CRVT',
        sEl,
        each(h => val(h.lines, 'CURV')),
        0,
      );
      write(
        'CONN',
        sEl,
        each(h => val(h.lines, 'CONI') ?? E(0)),
        0,
      );
      if (base.type === 'PARAXIAL')
        write(
          'PRAM',
          sEl,
          each(h => val(h.lines, 'PARM 1') ?? E(0)),
          1,
        );
      write(
        'MCOM',
        sEl,
        each(h => val(h.lines, 'COMM') ?? ''),
        0,
        v => `"${v}"`,
      );
      if (differ(each(h => h.type)))
        warnings.push(
          `${key}: its type differs between configurations; written as configuration ${first(j) + 1}'s`,
        );
      if (differ(each(h => val(h.lines, 'GLAS') ?? '')))
        warnings.push(
          `${key}: its glass differs between configurations; written as configuration ${first(j) + 1}'s`,
        );
    });
    sf.push(['TYPE STANDARD', 'CURV 0', 'DISZ 0']); // the image, on the last surface met
    const r0 = designs[active].rows[0];
    for (const d of designs)
      if (d.rows[0].ap !== r0.ap || (d.rows[0].R || 0) !== (r0.R || 0))
        warnings.push(
          `${d.name || 'a configuration'}: its entrance pupil or beam differs; written as the saved configuration's`,
        );
    const head = [
      'VERS 190513 80 123457',
      'MODE SEQ',
      `NAME ${name}`,
      'UNIT MM X W X CM MR CPMM',
      `ENPD ${E(2 * r0.ap)}`,
      'GCAT SCHOTT',
      'RAIM 0 0 1 1 0 0 0 0 0',
      `FTYP ${r0.R ? 1 : 0} 0 ${fields.length} ${waves.length} 0 0 0`,
      `XFLN ${fields.map(f => (Array.isArray(f) ? f[0] : 0)).join(' ')}`,
      `YFLN ${fields.map(f => (Array.isArray(f) ? f[1] : f)).join(' ')}`,
      `FWGN ${fields.map(() => 1).join(' ')}`,
      ...waves.map((l, k) => `WAVM ${k + 1} ${l} 1`),
      'PWAV 1',
      'SURF 0',
      '  TYPE STANDARD',
      '  CURV 0',
      `  DISZ ${r0.R ? E(-r0.R) : 'INFINITY'}`,
      ...sf.flatMap((l, i) => [`SURF ${i + 1}`, ...l.map(x => '  ' + x)]),
    ];
    const mce =
      nC < 2
        ? []
        : [
            `MNUM ${nC} ${active + 1}`,
            ...designs.map(
              (d, ci) => `MOFF 0 ${ci + 1} "${(d.name ?? '').replace(/"/g, "'")}" 0 0 0 1 1 0 0.0 "" 0`,
            ),
            ...ops,
          ];
    return { text: [...head, ...mce].join('\r\n') + '\r\n', warnings };
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
    'S-BAL35': 1.58913,
    'S-BAL35R': 1.58913,
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
    'S-BAL35': 61.14,
    'S-BAL35R': 60.96,
  };

  /** A surface placed absolutely (s: vertex V, axis ez, in 3D also ex, ey; curvature c along ez, conic k, mirror, n after,
   *  abbe, para and f) as a row of this tool, met by the axis ray r (hit there: h). Its axis is taken facing the light, its
   *  off-axis height (or, near an equator, its normal angle) read where the ray lands, and its tilt (3D: tilt, tilt y and
   *  clock, from the incoming frame fr = [x, y], carried on as build carries it) from its axis. Returns { row, fr }. */
  function placed(s, r, h, D3, fr) {
    const σ = dot(s.ez, r.u) < 0 ? -1 : 1;
    const ez = s.ez.map(v => σ * v);
    const c = σ * s.c;
    const base = {
      type: s.mirror ? 'mirror' : s.para ? 'paraxial' : 'refract',
      ...(s.para && { f: s.f }),
      R: c ? 1 / c : 0,
      k: s.k,
      t: 0,
      n: s.mirror ? 1 : s.n,
      ...(s.abbe && !s.mirror ? { abbe: s.abbe } : {}),
      ap: 0,
    };
    const q = add(h.p, s.V, -1);
    if (!D3) {
      const y = c ? dot(q, [0, ez[2], -ez[1]]) : 0;
      const th = angleAt(c, s.k, y, dot(q, ez));
      const steep = Math.abs(th) > 80; // near or past an ellipsoid's equator: by angle
      return {
        row: {
          ...base,
          d: steep ? th : y,
          ...(steep ? { oa: 'angle' } : {}),
          tilt: ((angle(ez) - angle(r.u) + 540) % 360) - 180,
        },
        fr,
      };
    }
    // the segment's azimuth on the parent becomes the clock: of ±, the smaller clock
    const [fx, fy] = fr;
    const zq = dot(q, ez);
    const ρv = add(q, ez, -zq);
    const ρ = c ? Math.hypot(...ρv) : 0;
    const Fin = [fx, fy, r.u];
    const ref = Math.abs(dot(fy, ez)) < 0.99 ? fy : fx;
    const yh = ρ > 1e-9 * (1 + Math.hypot(...q)) ? ρv.map(v => v / ρ) : unit(add(ref, ez, -dot(ref, ez)));
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
    return {
      row: {
        ...base,
        d: steep ? th : y,
        ...(steep ? { oa: 'angle' } : {}),
        tilt: opt.e[0],
        tiltY: opt.e[1],
        clock: opt.e[2],
      },
      fr: carry(fx, fy, r.u, h.u, opt.ex),
    };
  }
  /** Round-off in placed rows (1e-14 off-axis and the like) read as 0; planar rows keep no tilt y or clock. */
  function tidy(rows) {
    const size = Math.max(1, ...rows.map(r => Math.abs(r.t)));
    for (const r of rows)
      for (const k of ['t', 'R', 'd', 'tilt', 'tiltY', 'clock', 'ap'])
        if (typeof r[k] === 'number')
          r[k] =
            Math.abs(r[k]) < 1e-11 * (['tilt', 'tiltY', 'clock'].includes(k) ? 1 : size)
              ? 0
              : +r[k].toPrecision(14);
    for (const r of rows) for (const k of ['tiltY', 'clock']) if (r[k] === 0) delete r[k];
    return rows;
  }

  // ── Configurations (OpticStudio's multi-configuration editor). Each operand line is `OP int1 config value solve int2 …`:
  // int1 the surface (IGNM: the first of a range, int2 its last; PRAM: int2 the parameter), value as the editor shows it
  // (pickups already resolved). The lens data in the file is the saved configuration's.
  /** The operands that change the surfaces, applied to the parsed surfaces Z for configuration k (IGNM and IGNR are read
   *  by the importer itself). */
  const MCE_DONE = ['THIC', 'CRVT', 'CONN', 'PRAM', 'GLSS', 'MCOM', 'SDIA', 'IGNM', 'IGNR', 'MOFF'];
  const quoted = a => /"([^"]*)"/.exec(a.join(' '))?.[1];
  function mceApply(head, Z, k) {
    const at = i => Z.find(z => z.i === i);
    const glassOf = name => Z.find(z => z.GLAS?.[0]?.[0] === name)?.GLAS[0]; // (another surface's record of it: its n_d, V_d)
    for (const op of MCE_DONE)
      for (const a of head[op] ?? []) {
        if (+a[1] !== k || ['IGNM', 'IGNR', 'MOFF'].includes(op)) continue;
        const z = at(+a[0]);
        if (!z) continue;
        if (op === 'THIC') z.DISZ = [[a[2]]];
        else if (op === 'CRVT') z.CURV = [[a[2], ...(z.CURV?.[0]?.slice(1) ?? [])]];
        else if (op === 'CONN') z.CONI = [[a[2]]];
        else if (op === 'SDIA') z.DIAM = [[a[2], ...(z.DIAM?.[0]?.slice(1) ?? [])]];
        else if (op === 'PRAM') z.PARM = [...(z.PARM ?? []).filter(p => +p[0] !== +a[4]), [a[4], a[2]]];
        else if (op === 'MCOM') z.COMM = [(quoted(a) ?? '').split(' ').filter(Boolean)];
        else if (op === 'GLSS') {
          const g = quoted(a) ?? '';
          if (!g) delete z.GLAS;
          else if (z.GLAS?.[0]?.[0] !== g) z.GLAS = [glassOf(g) ?? [g]];
        }
      }
  }
  /** Curvatures solved from a thickness: OpticStudio's pickup of a radius from another surface's thickness column
   *  (CURV c 0 p s 2: c = s / thickness; R = thickness / s, e.g. −2 × the distance from a focus for an OAP collimating
   *  it). The file stores the relation's scale (s) and the value it last gave, but names the surface in a way not
   *  documented; the surface is the one whose thickness gives exactly that value (p − 20 when several do). Returns
   *  [{ z, from, k }]. */
  function thicknessPickups(Z) {
    const out = [];
    for (const z of Z) {
      const a = z.CURV?.[0];
      const c = +a?.[0];
      const k = +a?.[3];
      if (!a || a[4] !== '2' || !c || !k || !+a[2]) continue;
      const fits = Z.filter(q => {
        const t = +q.DISZ?.[0]?.[0];
        return t && Math.abs(k / t - c) <= 1e-9 * Math.abs(c);
      });
      const from = fits.length > 1 ? (fits.find(q => q.i === +a[2] - 20) ?? null) : fits[0];
      if (from) out.push({ z, from, k });
    }
    return out;
  }

  /** Operand lines of the multi-configuration editor: [op, its lines]. */
  const mceOps = (head, n) =>
    Object.entries(head).filter(
      ([op, ls]) =>
        /^[A-Z]{4}$/.test(op) &&
        ls.every(
          a => a.length >= 6 && a.includes('""') && Number.isInteger(+a[1]) && +a[1] >= 1 && +a[1] <= n,
        ),
    );

  /** Every configuration of a .zmx: each imported on its own (fromZemax with config k), then put together as this tool's
   *  configurations (src/engine/configs.js): the rows of the file's surfaces in their order, each configuration having the
   *  ones it doesn't ignore, and the values that differ between them its own. The saved configuration is the active one.
   *  The plane ('auto') is one they all lie in, else 3D. Returns fromZemax's result for the saved configuration, its rows
   *  with ids, plus configs. */
  function fromZemaxConfigs(txt, { plane, keepDummies, n }) {
    const all = p => {
      const out = [];
      for (let k = 1; k <= n; k++)
        try {
          out.push({ k, im: fromZemax(txt, { plane: p, keepDummies, config: k }) });
        } catch (err) {
          out.push({ k, err });
        }
      return out;
    };
    let per;
    if (plane === 'auto') {
      for (const p of ['yz', 'xz', '3d']) {
        per = all(p);
        if (p === '3d' || per.every(x => !x.im?.warnings.some(w => /out of the/.test(w)))) break;
      }
    } else per = all(plane);
    const head = {};
    for (const raw of txt.split(/\r?\n/)) {
      if (!raw.trim() || /^\s/.test(raw)) continue;
      const [key, ...a] = raw.trim().split(/\s+/);
      (head[key] ??= []).push(a);
    }
    const saved = +head.MNUM?.[0]?.[1] || 1;
    const ok = per.filter(x => x.im);
    if (!ok.length) throw per[0].err;
    const main = (ok.find(x => x.k === saved) ?? ok[0]).im;
    const warnings = new Set();
    for (const x of per)
      if (x.err) warnings.add(`configuration ${x.k} not imported: ${x.err.message}`);
      else if (x.im !== main)
        for (const w of x.im.warnings)
          if (!main.warnings.includes(w)) warnings.add(`configuration ${x.k}: ${w}`);
    // names: the comments on the editor's comment lines (MOFF), per configuration
    const names = {};
    for (const a of head.MOFF ?? []) {
      const t = quoted(a);
      if (t && !(names[+a[1]] ??= []).some(x => x.toLowerCase() === t.toLowerCase())) names[+a[1]].push(t);
    }
    // operands not carried over (wavelengths, apertures, …), where they differ between configurations
    const skipped = mceOps(head, n)
      .filter(([op]) => !MCE_DONE.includes(op))
      .filter(([, ls]) => {
        const by = {};
        for (const a of ls) (by[a[0] + ' ' + (a[4] ?? '')] ??= new Set()).add(a[2]);
        return Object.values(by).some(v => v.size > 1);
      })
      .map(([op]) => op);
    if (skipped.length)
      warnings.add(
        `not imported per configuration (each has the saved one's): ${skipped.join(', ')} in the multi-configuration editor`,
      );
    // the pool: every configuration's rows by the file's surface, in its order (the pupil first)
    const id = r => (r._zi === undefined ? 'p' : 'z' + r._zi);
    const list = ok.map(x => ({
      id: 'c' + x.k,
      name: names[x.k]?.join(' · ') || `Config ${x.k}`,
      set: {},
      solved: {},
    }));
    const rowsOf = ok.map(x => x.im.rows.map(r => ({ ...r, id: id(r) })));
    const order = [...new Set(rowsOf.flat().map(r => r.id))].sort((a, b) =>
      a === 'p' ? -1 : b === 'p' ? 1 : +a.slice(1) - +b.slice(1),
    );
    const mi = ok.findIndex(x => x.im === main);
    const pool = order.map(rid => {
      const have = rowsOf.map((rs, ci) => [ci, rs.find(r => r.id === rid)]).filter(([, r]) => r);
      const base = { ...(have.find(([ci]) => ci === mi) ?? have[0])[1] };
      delete base._zi;
      for (const k of new Set(have.flatMap(([, r]) => Object.keys(r)))) {
        if (k === '_zi' || k === 'id') continue;
        const vals = have.map(([, r]) => JSON.stringify(r[k]));
        if (vals.every(v => v === vals[0])) continue;
        for (const [ci, r] of have) (list[ci].set[rid] ??= {})[k] = r[k] === undefined ? null : r[k];
      }
      if (have.length < ok.length) base.only = have.map(([ci]) => list[ci].id);
      return base;
    });
    const sys = { rows: [], configs: { active: mi, show: [], list, rows: pool } };
    const rows = Optics.configRows(sys, mi);
    const counts = rowsOf.map(rs => rs.length - 1);
    warnings.add(
      `${n} configurations${ok.length < n ? ` (${ok.length} imported)` : ''}: ${list.map((c, ci) => `${c.name} (${counts[ci]} surfaces)`).join('; ')}. The saved one is shown; each leaves out the surfaces it ignores.`,
    );
    return {
      ...main,
      rows,
      configs: sys.configs,
      warnings: [...main.warnings, ...warnings],
    };
  }

  /** Best-effort import of a Zemax OpticStudio sequential file (.zmx text; see decodeText) into rows for this tool.
   *  Kept: radius, conic, spacings, coordinate breaks, mirrors, paraxial (ideal) lenses, glass indices and Abbe numbers,
   *  the stop, fields, wavelengths, the aperture and surface comments. Several configurations: all of them, as this tool's
   *  configurations (fromZemaxConfigs; `configs: false` for the saved one alone, `config: k` for configuration k alone),
   *  each without the surfaces it ignores (IGNM, IGNR in the multi-configuration editor). Ignored, with a warning where they
   *  occur: solves, aspheric and other higher-order terms, apertures, and (in a plane) anything out of it. plane: the
   *  file's global plane drawn as this tool's y–z plane: 'yz' (the default, as OpticStudio's Cross-Section layout; out of
   *  it: decenters in x, tilts about y), 'xz' (global x drawn as y; for systems folded in x–z), '3d', or 'auto' (the first
   *  of yz, xz the system lies in, else 3d).
   *  Placement is absolute: every surface's vertex and axis are first found in the file's global frame with OpticStudio's
   *  rules (thickness along local z; a coordinate break decenters then tilts about x, y, z in the rotated frame, or tilts
   *  z, y, x then decenters), so the breaks themselves vanish. The axis ray is the on-axis field's chief ray, aimed through
   *  the stop centre; a system with no on-axis field (built for an off-axis field, as a relay behind a telescope's focal
   *  plane is) takes field 1's, and the fields become angles from it. The entrance pupil is where a nearby chief ray
   *  crosses it in object space. This tool's pupil goes there (the origin, z along the axis ray), and each surface's
   *  distance, off-axis height and tilt are read off where the axis ray meets it, so the rows rebuild the same vertices and
   *  axes. Dummy planes (no power, no change of index) that are unnamed or hidden in OpticStudio, there for breaks, solves
   *  and merit functions, are dropped unless keepDummies. Returns { name, plane, fields, lambda, lambdas, rays, grid, rows,
   *  warnings }. */
  function fromZemax(txt, { plane = 'yz', keepDummies = false, config, configs = true } = {}) {
    if (configs && config === undefined) {
      const n = +/^MNUM\s+(\d+)/m.exec(txt)?.[1] || 1;
      if (n > 1) return fromZemaxConfigs(txt, { plane, keepDummies, n });
    }
    if (plane === 'auto') {
      // the first plane the system lies in (its own y–z, else x–z), else 3D
      for (const p of ['yz', 'xz']) {
        const im = fromZemax(txt, { plane: p, keepDummies, config, configs });
        if (!im.warnings.some(w => /out of the/.test(w))) return im;
      }
      return fromZemax(txt, { plane: '3d', keepDummies, config, configs });
    }
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
    // Configurations: the lens data is saved as the active one shows it. The surfaces a configuration ignores (the lens
    // data's flag, HIDE's 6th field, as saved; IGNM, a range, and IGNR, one surface, in the multi-configuration editor)
    // are left out here as OpticStudio leaves them out of the trace (thickness and all).
    const nConf = num(head.MNUM?.[0]?.[0], 1);
    const saved = num(head.MNUM?.[0]?.[1], 1) || 1;
    const conf = config ?? saved;
    if (conf < 1 || conf > nConf) throw Error(`no configuration ${conf}: the file has ${nConf}`);
    if (conf !== saved) mceApply(head, Z, conf);
    const ignored = new Set(Z.filter(z => z.HIDE?.[0]?.[5] === '1').map(z => z.i));
    for (const op of ['IGNM', 'IGNR'])
      for (const a of head[op] ?? [])
        if (+a[1] === conf)
          for (let k = +a[0]; k <= (op === 'IGNM' ? Math.max(+a[0], +a[4] || 0) : +a[0]); k++)
            +a[2] ? ignored.add(k) : ignored.delete(k);
    if (nConf > 1 && config === undefined) {
      const cname = (head.MOFF ?? [])
        .map(a => a.join(' '))
        .map(l => +l.split(/\s+/)[1] === conf && /"([^"]*)"/.exec(l)?.[1])
        .find(Boolean);
      const runs = [...ignored]
        .sort((a, b) => a - b)
        .reduce((r, k) => (r.length && r.at(-1)[1] === k - 1 ? (r.at(-1)[1] = k) : r.push([k, k]), r), [])
        .map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`));
      warn(
        `${nConf} configurations: imported configuration ${conf}${cname ? ` (${cname})` : ''}, as saved` +
          (runs.length ? `; the surfaces it ignores (${runs.join(', ')}) are left out` : ''),
      );
    }
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
      if (ignored.has(z.i)) continue;
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
          // a catalogue glass by its name (the n_d, V_d written beside it are often placeholders); a model glass
          // (___BLANK) by those values; another name by them when they look real, else n = 1.5
          const name = g?.[0]?.toUpperCase();
          const nd = +g?.[3];
          const vd = +g?.[4];
          const real = nd > 1 && nd < 5;
          n = !g
            ? 1
            : name === '___BLANK'
              ? real
                ? nd
                : 1
              : (GLASS[name] ??
                (real
                  ? (warn(`glass ${g[0]}: n_d ${nd} as the file gives it`), nd)
                  : (warn(`unknown glass ${g[0]}: n = 1.5`), 1.5)));
          abbe =
            n === 1
              ? 0
              : (GLASS_ABBE[name] ??
                (real && vd > 0 && vd < 1e5 && (name === '___BLANK' || !GLASS[name]) ? vd : 0));
        }
        const para = type === 'PARAXIAL';
        if (
          ![
            'STANDARD',
            'PARAXIAL',
            'EVENASPH',
            'TOROIDAL',
            'BICONICX',
            'BICONIC',
            'ODDASPH',
            'XASPHERE',
          ].includes(type)
        )
          warn(`${type} surface${nm ? ` (${nm})` : ''} read as a standard surface`);
        else if (!['STANDARD', 'PARAXIAL'].includes(type) && z.PARM?.some(p => +p[1]))
          warn(`higher-order terms of ${type} surfaces ignored`);
        if (!D3 && (Math.abs(O[outP]) > 1e-9 || Math.abs(ez[outP]) > 1e-12)) out = true;
        const ax = j => [M[0][j], M[1][j], M[2][j]];
        A.push({
          zi: z.i,
          name: nm,
          V: D3 ? [...O] : [0, O[inP], O[2]],
          ez: D3 ? ax(2) : unit([0, ez[inP], ez[2]]),
          ...(D3 && { ex: ax(0), ey: ax(1) }),
          c: para ? 0 : get(z, 'CURV') / f,
          k: para ? 0 : get(z, 'CONI'),
          mirror,
          n,
          abbe,
          stop: !!z.STOP,
          ...(para && { para, f: P(1) * f }), // an ideal lens: its focal length
          hidden: z.HIDE?.[0]?.[0] === '1', // (hidden in OpticStudio's layouts)
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
    // The axis: the on-axis field's chief ray, or, when the fields leave out the axis (a system used off-axis, built for
    // field 1, say), field 1's: a collimated beam along its direction, aimed through the stop centre. Fields are then
    // taken relative to it.
    const fty = num(head.FTYP?.[0]?.[0]);
    const nf = num(head.FTYP?.[0]?.[2], 1);
    const FX = (head.XFLN?.[0] ?? []).slice(0, nf).map(v => num(v));
    const FY = (head.YFLN?.[0] ?? ['0']).slice(0, nf).map(v => num(v));
    const F2 = FY.map((y, k) => [FX[k] ?? 0, y]); // (x, y) angles
    const inPlane = ([x, y]) => (D3 ? [x, y] : [plane === 'xz' ? x : y]); // (the components drawn)
    const fdir = ([x, y]) =>
      D3
        ? unit([Math.tan(x * rd), Math.tan(y * rd), 1])
        : unit([0, Math.tan((plane === 'xz' ? x : y) * rd), 1]);
    const offAxis = !fin && fty === 0 && FY.length && !F2.some(F => inPlane(F).every(v => !v));
    const w0 = offAxis ? fdir(F2[0]) : [0, 0, 1];
    if (offAxis)
      warn(
        `no on-axis field: the axis is field 1's chief ray (${inPlane(F2[0]).join('°, ')}°), and the fields are angles from it`,
      );
    const ray = (x, h) =>
      fin
        ? { p: [0, h, 0], u: [0, Math.sin(x), Math.cos(x)], n: 1 }
        : offAxis
          ? {
              p: [D3 ? x[0] : 0, D3 ? x[1] : x, 0],
              u: h ? unit(add(w0, [0, 1, -w0[1] / w0[2]], h)) : w0,
              n: 1,
            }
          : { p: [0, x, 0], u: [0, Math.sin(h), Math.cos(h)], n: 1 };
    const atStop = (r, k = 1) => {
      for (let j = 0; j <= si; j++) if (!(r = hit(G[j], r))) return NaN;
      return r.loc[k];
    };
    // aiming: the start height (collimated; in 3D off-axis, the start point x, y) or angle (from an object point)
    const aim = (h, y = 0) => {
      if (!(offAxis && D3)) return secant(x => atStop(ray(x, h)) - y, 0, 1e-3);
      let q = [0, 0];
      const res = q => [atStop(ray(q, h), 0), atStop(ray(q, h), 1) - y];
      for (let it = 0; it < 40; it++) {
        const r0 = res(q);
        if (!r0.every(isFinite)) return [NaN, NaN];
        if (Math.hypot(...r0) < 1e-12 * (1 + Math.abs(y) + Math.hypot(...q))) break;
        const e = 1e-6 * (1 + Math.hypot(...q));
        const J = [0, 1].map(k => res(q.map((v, i) => v + (i === k ? e : 0))).map((v, i) => (v - r0[i]) / e));
        const det = J[0][0] * J[1][1] - J[1][0] * J[0][1];
        if (!det) return [NaN, NaN];
        q = [
          q[0] - (r0[0] * J[1][1] - r0[1] * J[1][0]) / det,
          q[1] - (J[0][0] * r0[1] - J[0][1] * r0[0]) / det,
        ];
      }
      return q;
    };
    const ok = x => [x].flat().every(isFinite);
    const x0 = aim(0);
    const ε = 1e-4;
    const xε = aim(fin ? 1e-3 * Math.max(1, Math.abs(obj) * 1e-3) : ε);
    if (!ok(x0)) throw Error('could not aim the axis ray through the stop');
    const r0 = ray(x0, 0);
    const u0 = r0.u;
    const Yw = unit([0, u0[2], -u0[1]]); // the drawn y: across the axis, in the file's y–z plane
    let E = r0.p; // entrance pupil: where a chief ray crosses the axis ray
    if (ok(xε)) {
      const r1 = ray(xε, fin ? 1e-3 * Math.max(1, Math.abs(obj) * 1e-3) : ε);
      // the point of the axis ray nearest the nearby chief ray
      const w = add(r1.p, r0.p, -1);
      const c = cross(r0.u, r1.u);
      const den = dot(c, c);
      const s = den ? dot(cross(w, r1.u), c) / den : NaN;
      if (Math.abs(s) < 1e7) E = add(r0.p, r0.u, s);
    }
    // Aperture: the entrance pupil's semi-diameter.
    const stopY = get(Z[G[si].zi] ?? {}, 'DIAM') * f;
    const lateral = x => {
      const r = ray(x, 0);
      const s = dot(add(E, r.p, -1), u0) / dot(r.u, u0);
      const q = add(add(r.p, r.u, s), E, -1);
      return Math.hypot(...add(q, u0, -dot(q, u0)));
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
        !s.para &&
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
      rows.at(-1).t = dot(add(h.p, r.p, -1), r.u);
      const pl = placed(s, r, h, D3, [fx, fy]);
      rows.push({
        name: a.name || (j === A.length - 1 ? 'Image' : ''),
        ...pl.row,
        _zi: a.zi, // (the file's surface: what identifies it across configurations)
        _drop: !s.mirror && !s.para && !s.c && !a.stop && s.n === nIn && (s.hidden || !a.name), // (a dummy plane: see below)
      });
      [fx, fy] = pl.fr;
      r = h;
      nIn = h.n;
    }
    // Dummy planes (no power, no change of index) that OpticStudio hides or that have no name, there to anchor coordinate
    // breaks, solves and merit-function targets, are dropped: the axis runs straight through them, so the distance to them
    // and on from them add up. Named, visible ones (focal planes, pupil planes, stops) are kept.
    const dropped = [];
    for (let i = rows.length - 2; i > 0; i--)
      if (rows[i]._drop && !keepDummies) {
        rows[i - 1].t += rows[i].t;
        dropped.push(i);
        rows.splice(i, 1);
      }
    for (const r of rows) {
      delete r._drop;
      if (config === undefined) delete r._zi;
    }
    if (dropped.length)
      warn(
        `${dropped.length} dummy surface${dropped.length > 1 ? 's' : ''} (no power; unnamed or hidden in OpticStudio) left out: the optics are placed as they were`,
      );
    tidy(rows);
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
    const sg = Yw[1] < 0 ? -1 : 1;
    const [FIN, FOUT] = plane === 'xz' ? ['XFLN', 'YFLN'] : ['YFLN', 'XFLN']; // the fields in the drawn plane (3D: y, with x below)
    let fields;
    if (fty === 0 && !fin) {
      // angles: each field's direction, as seen from the axis (exactly the file's angles when the axis is along z)
      const deg = (a, b) => {
        const v = Math.atan2(a, b) / rd;
        return Math.abs(v) < 1e-12 ? 0 : offAxis ? Math.round(v * 1e7) / 1e7 : +v.toPrecision(14); // (from field 1: to 1e-7°)
      };
      fields = F2.map(F => {
        const w = Td(fdir(F));
        const y = deg(w[1], w[2]);
        const x = D3 ? deg(w[0], w[2]) : 0;
        return x ? [x, y] : y;
      });
    } else {
      fields = (head[FIN]?.[0] ?? ['0']).slice(0, nf).map(v => sg * num(v) * (fty === 1 ? f : 1));
      if (D3)
        fields = fields.map((y, k) => {
          const x = num(head.XFLN?.[0]?.[k]) * (fty === 1 ? f : 1);
          return x ? [x, y] : y;
        }); // (x as drawn: Xw is +x)
    }
    if (!D3 && (head[FOUT]?.[0] ?? []).slice(0, nf).some(v => +v))
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
    const nw = (head.WAVM?.length >= 24 && num(head.FTYP?.[0]?.[3], Infinity)) || Infinity; // (OpticStudio lists all 24 slots; FTYP says how many are in use)
    const wl = head.WAVM?.map(w => [num(w[0]), num(w[1])]).filter(w => w[1] > 0 && w[0] <= nw);
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

  /** The frame with its origin at `origin`, z along `dir` and x along `x` made square to it (in a planar design, x is left
   *  out; without `x`, y is taken across the beam in the y–z plane, as reverseSystem does). T maps a point into it, Td a
   *  direction. */
  function frameAt(origin, dir, x, D3) {
    const w = unit(dir);
    let Xn;
    let Yn;
    if (x) {
      Xn = unit(add(x, w, -dot(x, w)));
      Yn = cross(w, Xn);
    } else {
      Yn = Math.hypot(w[1], w[2]) > 1e-9 ? unit([0, w[2], -w[1]]) : unit(cross(w, [1, 0, 0]));
      Xn = cross(Yn, w);
    }
    const Td = v => [D3 ? dot(v, Xn) : 0, dot(v, Yn), dot(v, w)];
    const T = p => Td(add(p, origin, -1));
    return { T, Td, X: Xn, Y: Yn, Z: w };
  }

  /** Built surface S[i] of a system with rows `rows`, to be met from the other side (the light on its way back): the same
   *  optic in the same place, leading into the index before it. For placeRows. */
  const facingBack = (s, rows, i) => ({
    ...s,
    n: s.mirror ? s.n : s.nIn,
    abbe: s.mirror ? 0 : i ? rows[i].abbe || 0 : 0,
    side: s.mirror ? s.side : -s.side,
    ap: 0,
  });

  /** A plain plane through point p with normal ez (world), named `name`, for placeRows (in 3D, its x is the world x made
   *  square to ez). */
  function planeAt(p, ez, name, D3) {
    const e = unit(ez);
    const g = { V: p, ez: e, ey: [0, e[2], -e[1]], c: 0, k: 0, d: 0, zM: 0, n: 1, name, plain: true };
    if (D3) {
      const ex0 = add([1, 0, 0], e, -e[0]);
      const ex = Math.hypot(...ex0) > 1e-9 ? unit(ex0) : unit(cross([0, 1, 0], e));
      Object.assign(g, { ex, ey: cross(e, ex) });
    }
    return g;
  }

  /** Rows of this tool for surfaces placed absolutely: G is [[surface, row], …], each surface as build makes them (vertex
   *  V, axis ez and ey (3D: ex too), curvature c, conic k, side, n, …) in any one frame, `row` extra values to keep (its
   *  name and aperture). The axis ray starts at `origin` along `dir` (in that frame) and meets them in order; the new
   *  design's frame has its pupil there, z along `dir` and x along `x` made square to it (default as frameAt). Each surface
   *  becomes a row met by that ray (see placed): its off-axis height where the ray lands and its tilts from its axis, so
   *  the optics stay exactly where they were. The pupil row gets ap, R (the incoming beam) and t; n is the index the light
   *  starts in. Stops at a surface the ray misses (warned). Returns { rows (tidied), warnings, frame }. */
  function placeRows(G, { origin = [0, 0, 0], dir = [0, 0, 1], x = null, D3, ap = 0, R = 0, n = 1 } = {}) {
    const d3 = D3 ?? (!!x || G.some(([g]) => g.ex));
    const frame = frameAt(origin, dir, x, d3);
    const { T, Td } = frame;
    const warnings = [];
    const out = [{ t: 0, ap, R }];
    let r = { p: [0, 0, 0], u: [0, 0, 1], n };
    let fr = [
      [1, 0, 0],
      [0, 1, 0],
    ];
    for (const [g0, row = {}] of G) {
      const ex0 = g0.ex ?? (d3 ? cross(g0.ey, g0.ez) : null);
      const g = { ...g0, V: T(g0.V), ez: Td(g0.ez), ey: Td(g0.ey), ...(ex0 && { ex: Td(ex0) }) };
      if (!d3) delete g.ex;
      const h = hit(g, r);
      if (!h) {
        warnings.push(`the light misses ${row.name || g.name || 'a surface'}: the system stops there`);
        break;
      }
      out.at(-1).t = dot(add(h.p, r.p, -1), r.u);
      const pl = placed(g, r, h, d3, fr);
      out.push({ name: row.name ?? g.name ?? '', ...pl.row, ...(row.ap && { ap: row.ap }) });
      fr = pl.fr;
      r = h;
    }
    return { rows: tidy(out), warnings, frame };
  }

  /** The system run backwards: light from where it was imaged, through the same optics in the opposite order, to where it
   *  came from. The optics stay put (each surface's vertex, axis, curvature and conic), so every ray retraces its path; what
   *  changes is how they are described: the pupil moves to the exit pupil (where the chief rays leave from; its size the
   *  beam's there), each surface is met from the other side (its R flips sign as seen by the light, refracting surfaces
   *  lead back into the index before them), and the beam starts from the image: from the point the axis ray reaches on the
   *  last surface with the fields as the image points' heights there, or, when the light left collimated, collimated with
   *  the fields as the angles it left at. It ends where the original started: on the original pupil (collimated light), or
   *  at its source point (a plane there). Solves, locks and configurations are not carried over (the geometry is).
   *  sys: { rows, fields, ... }. Returns { rows, fields, warnings }. */
  function reverseSystem(sys) {
    const rows = sys.rows;
    const S = build(rows);
    const n = S.length;
    const warnings = [];
    if (n < 2) throw Error('nothing to reverse: the system needs an optic before its last surface');
    const fields = sys.fields ?? [0];
    const D3 = S.some(s => s.ex) || fields.some(Array.isArray);
    const beam = S.beam;
    const a = rows[0].ap;
    const last = S[n - 1];
    const L = S[n - 2]; // the last optic: image space follows it
    const u0 = L.uOut;
    let fin = inFocus(S, n - 1); // where the light arriving at the last surface focuses (null: collimated)
    const after = (px, py, f) => trace(S, px, py, f)[n - 2];
    // the exit pupil: where a chief ray a little off axis crosses the axis ray in image space
    const ε = beam ? 1e-4 * Math.max(1, Math.abs(beam)) : 1e-4;
    const r0 = { p: L.P, u: u0 };
    const r1 = after(0, 0, ε);
    let E = null;
    if (r1) {
      const c = cross(r0.u, r1.u);
      const den = dot(c, c);
      const sAx = den ? dot(cross(add(r1.p, r0.p, -1), r1.u), c) / den : NaN;
      if (Math.abs(sAx) < 1e7 * Math.max(1, a)) E = add(r0.p, r0.u, sAx);
    }
    if (!E) {
      E = L.P;
      warnings.push('the chief rays leave parallel (telecentric): the pupil is put at the last optic');
    }
    // its size: the marginal ray's distance from the axis there
    const rm = after(0, a, 0);
    let ap = a;
    if (rm) {
      const t = dot(add(E, rm.p, -1), u0) / dot(rm.u, u0);
      const q = add(add(rm.p, rm.u, t), E, -1);
      ap = Math.hypot(...add(q, u0, -dot(q, u0)));
    }
    // the reversed frame: the pupil at E, z back along the beam
    const w = u0.map(v => -v);
    const { T, Td } = frameAt(E, w, null, D3);
    const round = v => (Math.abs(v) < 1e-12 ? 0 : +v.toPrecision(12));
    const fround = v => (Math.abs(v) < 1e-9 ? 0 : +v.toPrecision(9)); // (fields, as typed)
    // the source: the image, where the axis ray reaches the last surface when that is (near) the focus, else the focus
    // itself; a beam slower than f/500 counts as collimated
    let src = null;
    if (fin) {
      const dE = Math.abs(dot(add(fin, E, -1), u0));
      if (dE > 1000 * Math.max(ap, a)) fin = null;
      else if (Math.abs(dot(add(fin, last.P, -1), u0)) <= 0.1 * dE) src = last.P;
      else {
        src = fin;
        warnings.push('the last surface is not at the image: the light starts from the focus instead');
      }
    }
    const R = fin ? T(src)[2] : 0;
    if (fin && (last.c || Math.abs(dot(last.ez, u0)) < 1 - 1e-9))
      warnings.push(
        'the image surface is tilted or curved: the field points are taken on a plane across the beam',
      );
    const nf = fields.map(f => {
      const tr = trace(S, 0, 0, f);
      if (tr.length < n) return null;
      const v = Td(tr[n - 2].u.map(x => -x));
      if (!fin) {
        const ax = fround((Math.atan2(v[0], v[2]) * 180) / Math.PI);
        const ay = fround((Math.atan2(v[1], v[2]) * 180) / Math.PI);
        return D3 && ax ? [ax, ay] : ay;
      }
      const q = T(tr[n - 2].p); // (the chief ray leaving the last optic, carried to the source's plane)
      const λ = (R - q[2]) / v[2];
      const [x, y] = [fround(q[0] + λ * v[0]), fround(q[1] + λ * v[1])];
      return D3 && x ? [x, y] : y;
    });
    if (nf.some(f => f === null)) warnings.push('some fields don’t reach the image: they are left out');
    // the optics, last to first, met from the other side
    const G = [
      ...S.slice(0, n - 1)
        .map((s, i) => [facingBack(s, rows, i), rows[i + 1]])
        .reverse(),
      [
        planeAt(
          beam ? [0, 0, beam] : [0, 0, 0],
          [0, 0, 1],
          beam ? 'Image (the source)' : 'Pupil (where the light came in)',
          D3,
        ),
        {},
      ],
    ];
    const placedOut = placeRows(G, { origin: E, dir: w, D3, ap: round(ap), R: round(R), n: last.nIn });
    warnings.push(
      ...placedOut.warnings.map(m => m.replace(': the system', ' on the way back: the reversed system')),
    );
    const out = placedOut.rows;
    // the pupil's size: so that its marginal ray meets the first optic where the original's left it
    const rmL = after(0, a, 0);
    if (rmL && out.length > 2) {
      const want = Math.hypot(...add(rmL.p, L.P, -1));
      const Sr = build(
        out.map((r, i) => (i ? { name: '', R: 0, k: 0, d: 0, tilt: 0, t: 0, n: 1, ...r } : { R: 0, ...r })),
      );
      const got = h => {
        const q = trace(Sr, 0, h, nf[0] ?? 0)[0];
        return q ? Math.hypot(...add(q.p, Sr[0].P, -1)) - want : NaN;
      };
      const h = secant(got, out[0].ap, 1e-3 * out[0].ap);
      if (isFinite(h) && h > 0) out[0].ap = h;
    }
    if (rows.some(r => r.solve && Object.keys(r.solve).length) || rows.some(r => r.lock))
      warnings.push(
        'solves and focus locks are not carried over: the reversed system is the geometry as it stands',
      );
    return { rows: tidy(out), fields: nf.filter(f => f !== null), warnings };
  }

  Object.assign(Optics, {
    zemax,
    decodeText,
    GLASS,
    fromZemax,
    reverseSystem,
    placeRows,
    facingBack,
    planeAt,
    frameAt,
    zemaxConfigs,
  });
  if (typeof module === 'object') module.exports = Optics;
})(typeof module === 'object' ? require('./edit.js') : globalThis.Optics);
