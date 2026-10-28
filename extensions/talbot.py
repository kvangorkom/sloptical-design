"""Talbot: how far the beam here has propagated, in Talbot lengths, from a chosen optic. (A Sloptical Design extension.)

A ripple of period p on an optic (polishing error, a deformable mirror's actuator print, a grating) self-images every
Talbot length z_T = 2 p^2 / lambda as the beam propagates: phase ripples turn into intensity ripples at z_T/4 and back
into phase at z_T/2. This tab plots the fractional Talbot distance z / z_T at this plane for ripples of f cycles across
the beam diameter D at the chosen optic (p = D / f).

Between the optic and this plane the beam may converge, diverge or pass other optics. By Collins' integral a ripple of
spatial frequency nu on a flat wavefront picks up the Talbot phase pi lambda B nu^2 / A through the paraxial ray-transfer
matrix [[A, B], [C, D]] from the optic to here. The ripple rides on the beam, though, so the beam's own curvature at the
optic counts too; folding it in turns A into the beam's magnification m = D_here / D_optic (the Fresnel scaling theorem),
so z / z_T = lambda B nu^2 / (2 m) with nu = f / D_optic. B / m is the equivalent collimated distance: the gap itself in
a collimated beam, z / (1 - z/R) at z from an optic whose beam converges to a focus R away. B and m come from paraxial
rays traced through the real system (axial rays and small-field chief rays, in x and in y). In 3D (folds out of a plane,
off-axis mirrors at compound angles) they are 2x2 matrices: the beam turns about its axis, and an astigmatic path gives
ripples of different orientations different distances. The two extremes are then plotted, with the ripple orientation
(its crests' normal, from the optic's x axis) of each.
The 'optic' can also be the entrance pupil (the plane where the rays start), e.g. for a mask or DM placed there.
Its values (z/z_T at one cycle per beam, the equivalent distance, the beam diameter at the optic, the z_T/4 frequency) can be watched.
"""
import math

NAME = "Talbot"
DESCRIPTION = "Fractional Talbot distance from a chosen optic vs spatial frequency (cycles per beam diameter)"
TARGETS = ["beam", "surface"]
PARAMS = {
    "optic": {"label": "from", "type": "surface", "default": "previous", "pupil": True},   # the entrance pupil is a choice too
    "fmax": {"label": "up to (cycles/beam)", "type": "number", "default": 100},
    "ymax": {"label": "max z/z_T (0 = auto)", "type": "number", "default": 0},
    "xlog": {"label": "log x", "type": "bool", "default": True},
    "ylog": {"label": "log y", "type": "bool", "default": False},
}


def _inv(M):
    """Inverse of a small square matrix (Gauss-Jordan with pivoting); None if singular."""
    n = len(M)
    A = [list(map(float, r)) + [float(i == k) for k in range(n)] for i, r in enumerate(M)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(A[r][c]))
        if abs(A[p][c]) < 1e-300:
            return None
        A[c], A[p] = A[p], A[c]
        A[c] = [v/A[c][c] for v in A[c]]
        for r in range(n):
            if r != c and A[r][c]:
                A[r] = [x - A[r][c]*y for x, y in zip(A[r], A[c])]
    return [r[n:] for r in A]


def _mul(A, B):
    return [[sum(a*b for a, b in zip(r, c)) for c in zip(*B)] for r in A]


def _quad_roots(M0, M1):
    """Where det(M0 + s M1) = 0: (middle, half the gap) of its two roots, or None (no real pair, or one at infinity)."""
    d = lambda m: m[0][0]*m[1][1] - m[0][1]*m[1][0]
    qa, qc = d(M1), d(M0)
    qb = M0[0][0]*M1[1][1] + M1[0][0]*M0[1][1] - M0[0][1]*M1[1][0] - M1[0][1]*M0[1][0]
    n1 = max(abs(v) for r in M1 for v in r)
    if not abs(qa) > 1e-12*n1*n1:
        return None
    mid, disc = -qb/(2*qa), qb*qb - 4*qa*qc
    half = math.sqrt(abs(disc))/(2*abs(qa))
    if disc < 0 and half > 1e-3*max(1.0, abs(mid)):
        return None
    return mid, half


def run(ctx):
    tgt, a = ctx["target"], ctx["pupil"]["semi_diameter"]
    j, s = tgt["segment"], tgt["s"]
    i = ctx["params"]["optic"]
    i = j - 1 if i == "previous" else -1 if i == "pupil" else int(i)   # -1: the entrance pupil (the start of segment 0)
    if not -1 <= i < j:
        return {"notes": ["Choose an optic before this plane (the 'from' menu)."]}
    name = lambda n: "the entrance pupil" if n < 0 else ctx["surfaces"][n]["name"]
    optic = name(i)

    # Four paraxial rays (pupil heights in x and y, small fields in x and y), each at the optic's exit plane (segment i + 1,
    # distance 0) and here, relative to the axis ray: heights y and reduced angles v = index * slope, in each plane's own
    # x, y axes. Then [y2; v2] = M [y1; v1] for all four gives the 4x4 ray-transfer matrix M = [[A, B], [C, D]] (2x2 blocks);
    # the two axial rays' heights give the beam's magnification m (2x2: the beam may turn about its axis).
    h = 1e-4*a
    eps = 1e-3 if ctx["field_unit"] == "deg" else 1e-4*max(1.0, abs(ctx["pupil"]["beam_R"]))
    rays = [([0.0, 0.0], h, 0.0), ([0.0, 0.0], 0.0, h), ([eps, 0.0], 0.0, 0.0), ([0.0, eps], 0.0, 0.0)]   # (field, px, py)
    at = lambda seg, dist, r: ctx.plane(seg, dist, *r)
    one, two = [at(i + 1, 0.0, r) for r in rays], [at(j, s, r) for r in rays]
    if None in one + two:
        return {"notes": ["A paraxial ray is lost between the optic and here."]}
    col = lambda q: [q["x"], q["y"], q["index"]*q["dx"]/q["dz"], q["index"]*q["dy"]/q["dz"]]
    W1 = [list(r) for r in zip(*map(col, one))]                       # columns: the rays
    W2 = [list(r) for r in zip(*map(col, two))]
    G = _inv(W1)
    if G is None:
        return {"notes": ["The paraxial rays don't span the beam at the optic (a focus there?)."]}
    M = _mul(W2, G)
    B = [r[2:] for r in M[:2]]
    Y1, Y2 = [r[:2] for r in W1[:2]], [r[:2] for r in W2[:2]]       # the axial rays' heights
    Y1i = _inv(Y1)
    m = _mul(Y2, Y1i) if Y1i else None
    dm = m and m[0][0]*m[1][1] - m[0][1]*m[1][0]
    if not dm or abs(dm) < 1e-18:
        return {"notes": ["This plane is at a focus of the beam: every ripple is at infinite Talbot distance."]}

    # Beam diameter at the optic: the axial beam's marginal rays, across x and across y (their mean).
    edge = [at(i + 1, 0.0, ([0.0, 0.0], px, py)) for px, py in ((0.0, a), (0.0, -a), (a, 0.0), (-a, 0.0))]
    if None in edge:
        return {"notes": ["The beam's edge is vignetted before the optic."]}
    gap = lambda p, q: math.hypot(p["x"] - q["x"], p["y"] - q["y"])
    D = (gap(edge[0], edge[1]) + gap(edge[2], edge[3]))/2
    if D < 1e-9*a:
        return {"notes": [f"The beam is focused at {optic}: choose an optic where it has a size (the 'from' menu)."]}

    # The equivalent distance: Z = m^-1 B, in the optic's frame (symmetric, up to round-off). A ripple of frequency vector
    # nu there gets the Talbot phase pi lambda nu.Z.nu: its principal values are the distances for the two extreme
    # orientations (equal unless the path is astigmatic).
    Zf = _mul(_inv(m), B)
    za, zb, zc = Zf[0][0], (Zf[0][1] + Zf[1][0])/2, Zf[1][1]
    mid, rad = (za + zc)/2, math.hypot((za - zc)/2, zb)
    th = math.degrees(0.5*math.atan2(2*zb, za - zc))                  # the orientation of the larger one
    zs = [(mid + rad, th), (mid - rad, th - 90 if th > 0 else th + 90)]
    astig = rad > 1e-4*max(1.0, abs(mid))
    z = mid                                                           # equivalent collimated distance (mm): the mean

    # Where ripples on the optic are re-imaged (z = 0): along each later axis segment B is linear in the distance, singular
    # at two points (line images, coinciding when stigmatic); found from the four rays at the segment's start.
    S, images, run_ = ctx["surfaces"], [], 0.0                       # run_: the axis length from the optic to segment k
    Gb = [r[2:] for r in G]                                           # the part of W1^-1 that gives B
    for k in range(i + 1, len(S) + 1):
        st = [at(k, 0.0, r) for r in rays]
        if None in st:
            break
        Yk = [[q["x"] for q in st], [q["y"] for q in st]]
        Tk = [[q["dx"]/q["dz"] for q in st], [q["dy"]/q["dz"] for q in st]]
        r = _quad_roots(_mul(Yk, Gb), _mul(Tk, Gb))
        L = math.inf                                                  # the segment's length (the last one is unbounded)
        if k < len(S):
            if "xyz" in S[k]:
                p0, u0 = (S[k - 1]["xyz"]["hit"], S[k - 1]["xyz"]["out_axis"]) if k else ([0.0, 0.0, 0.0], [0.0, 0.0, 1.0])
                pk = S[k]["xyz"]["hit"]
            else:
                p0, u0 = (S[k - 1]["hit"], S[k - 1]["out_axis"]) if k else ([0.0, 0.0], [0.0, 1.0])   # its start and direction
                pk = S[k]["hit"]
            L = sum((pk[n] - p0[n])*u0[n] for n in range(len(u0)))
        if r:
            s0, half = r
            tol = 1e-6*max(1.0, a, abs(s0))
            if -tol <= s0 <= L + tol and run_ + s0 > tol:             # (not the optic itself, through optics of no length)
                images.append(f"{s0:.4g} mm after {name(k - 1)}" + (f" (line images ±{half:.3g} mm)" if half > tol else ""))
        run_ += L

    lam = ctx["wavelength_um"]*1e-3                                   # mm
    P = ctx["params"]
    get = lambda k: P.get(k, PARAMS[k]["default"])                    # (settings saved before one was added: its default)
    fmax, ymax, xlog, ylog = max(2.0, float(get("fmax"))), float(get("ymax")), bool(get("xlog")), bool(get("ylog"))
    if xlog:                                                          # log: 0.5 … fmax; linear: 0 … fmax
        f = [10**(math.log10(0.5) + k*(math.log10(fmax) - math.log10(0.5))/199) for k in range(200)]
    else:
        f = [fmax*k/199 for k in range(200)]
    curve = lambda zz: [lam*abs(zz)*(fk/D)**2/2 for fk in f]
    series = ([{"x": f, "y": curve(zz), "label": f"z / z_T, ripples at {t:.0f}°"} for zz, t in zs] if astig
              else [{"x": f, "y": curve(z), "label": "z / z_T"}])
    quarter = D*math.sqrt(0.5/(lam*abs(z))) if z else float("inf")   # frequency at z_T / 4
    spread = f" ({min(zs)[0]:.4g} to {max(zs)[0]:.4g} by ripple orientation)" if astig else ""
    return {
        "series": series,
        "xlabel": "cycles / beam", "ylabel": "z / z_T", "xlog": xlog, "ylog": ylog,
        "ylim": [None if ylog else 0, ymax if ymax > 0 else None],       # a fixed upper bound, when set
        "values": {                                                       # what the watch window can track
            "z/z_T at 1 cycle/beam": lam*abs(z)/(2*D**2),
            "equivalent distance (mm)": z,
            "equivalent distance spread (mm)": 2*rad,
            "beam diameter at the optic (mm)": D,
            "z_T/4 frequency (cycles/beam)": quarter,
        },
        "notes": [f"from {optic}: " + (f"this plane is an image of it (z = 0), beam Ø {D:.4g} mm there" if abs(z) < 1e-6*max(1.0, D) and not astig
                  else f"equivalent distance {z:.4g} mm{spread}{' (virtual)' if z < 0 else ''}, beam Ø {D:.4g} mm there"),
                  f"z_T/4 at {quarter:.3g} cycles/beam; z_T(1 cycle) = {2*D**2/lam/1e3:.4g} m, λ = {ctx['wavelength_um']} µm",
                  f"z = 0 (images of {optic}): " + ("; ".join(images[:3]) if images else "none after it")],
    }
