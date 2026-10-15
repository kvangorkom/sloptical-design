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
a collimated beam, z / (1 - z/R) at z from an optic whose beam converges to a focus R away. B and m come from two paraxial
rays traced through the real system (an axial ray and a small-field chief ray).
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


def run(ctx):
    tgt, a = ctx["target"], ctx["pupil"]["semi_diameter"]
    j, s = tgt["segment"], tgt["s"]
    i = ctx["params"]["optic"]
    i = j - 1 if i == "previous" else -1 if i == "pupil" else int(i)   # -1: the entrance pupil (the start of segment 0)
    if not -1 <= i < j:
        return {"notes": ["Choose an optic before this plane (the 'from' menu)."]}
    name = lambda n: "the entrance pupil" if n < 0 else ctx["surfaces"][n]["name"]
    optic = name(i)

    # Two paraxial rays, each at the optic's exit plane (segment i + 1, distance 0) and here, relative to the axis ray:
    # height y and reduced angle v = index * slope. Then [y2, v2] = M [y1, v1] for both gives M's B; the axial ray's
    # heights give the beam's magnification m.
    h = 1e-4*a
    eps = 1e-3 if ctx["field_unit"] == "deg" else 1e-4*max(1.0, abs(ctx["pupil"]["beam_R"]))
    rays = [(0.0, 0.0, h), (eps, 0.0, 0.0)]                         # (field, pupil x, pupil y)
    at = lambda seg, dist, r: ctx.plane(seg, dist, *r)
    one, two = [at(i + 1, 0.0, r) for r in rays], [at(j, s, r) for r in rays]
    if None in one + two:
        return {"notes": ["A paraxial ray is lost between the optic and here."]}
    yv = lambda q: (q["y"], q["index"]*q["dy"]/q["dz"])
    (y1a, v1a), (y1b, v1b) = map(yv, one)
    (y2a, v2a), (y2b, v2b) = map(yv, two)
    det = y1a*v1b - y1b*v1a
    B = (y2b*y1a - y2a*y1b)/det                                       # M = Y2 · Y1^-1, first row, second column
    m = y2a/y1a                                                       # beam magnification from the optic to here
    if abs(m) < 1e-9:
        return {"notes": ["This plane is at a focus of the beam: every ripple is at infinite Talbot distance."]}

    # Beam diameter at the optic: the axial beam's marginal rays.
    edge = [at(i + 1, 0.0, (0.0, 0.0, y)) for y in (a, -a)]
    if None in edge:
        return {"notes": ["The beam's edge is vignetted before the optic."]}
    D = abs(edge[0]["y"] - edge[1]["y"])
    if D < 1e-9*a:
        return {"notes": [f"The beam is focused at {optic}: choose an optic where it has a size (the 'from' menu)."]}

    # Where ripples on the optic are re-imaged (z = 0): along each later axis segment B is linear in the distance, so it
    # vanishes at one point, found from the two rays at the segment's start (heights and geometric slopes).
    S, images = ctx["surfaces"], []
    for k in range(i + 1, len(S) + 1):
        st = [at(k, 0.0, r) for r in rays]
        if None in st:
            break
        (ya, ta), (yb, tb) = [(q["y"], q["dy"]/q["dz"]) for q in st]
        B0, dB = (yb*y1a - ya*y1b)/det, (tb*y1a - ta*y1b)/det
        if not dB:
            continue
        s0 = -B0/dB
        L = math.inf                                                  # the segment's length (the last one is unbounded)
        if k < len(S):
            p0, u0 = (S[k - 1]["hit"], S[k - 1]["out_axis"]) if k else ([0.0, 0.0], [0.0, 1.0])   # its start and direction
            L = sum((S[k]["hit"][n] - p0[n])*u0[n] for n in (0, 1))
        tol = 1e-6*max(1.0, a, abs(s0))
        if -tol <= s0 <= L + tol and not (k == i + 1 and abs(s0) < tol):
            images.append(f"{s0:.4g} mm after {name(k - 1)}")

    lam = ctx["wavelength_um"]*1e-3                                   # mm
    z = B/m                                                           # equivalent collimated distance (mm)
    P = ctx["params"]
    get = lambda k: P.get(k, PARAMS[k]["default"])                    # (settings saved before one was added: its default)
    fmax, ymax, xlog, ylog = max(2.0, float(get("fmax"))), float(get("ymax")), bool(get("xlog")), bool(get("ylog"))
    if xlog:                                                          # log: 0.5 … fmax; linear: 0 … fmax
        f = [10**(math.log10(0.5) + k*(math.log10(fmax) - math.log10(0.5))/199) for k in range(200)]
    else:
        f = [fmax*k/199 for k in range(200)]
    frac = [lam*abs(z)*(fk/D)**2/2 for fk in f]
    quarter = D*math.sqrt(0.5/(lam*abs(z))) if z else float("inf")   # frequency at z_T / 4
    return {
        "series": [{"x": f, "y": frac, "label": "z / z_T"}],
        "xlabel": "cycles / beam", "ylabel": "z / z_T", "xlog": xlog, "ylog": ylog,
        "ylim": [None if ylog else 0, ymax if ymax > 0 else None],       # a fixed upper bound, when set
        "values": {                                                       # what the watch window can track
            "z/z_T at 1 cycle/beam": lam*abs(z)/(2*D**2),
            "equivalent distance (mm)": z,
            "beam diameter at the optic (mm)": D,
            "z_T/4 frequency (cycles/beam)": quarter,
        },
        #"hlines": [{"y": 0.25, "label": "1/4: phase → amplitude"}, {"y": 0.5, "label": "1/2"}],
        "notes": [f"from {optic}: " + (f"this plane is an image of it (z = 0), beam Ø {D:.4g} mm there" if abs(z) < 1e-6*max(1.0, D)
                  else f"equivalent distance {z:.4g} mm{' (virtual)' if z < 0 else ''}, beam Ø {D:.4g} mm there"),
                  f"z_T/4 at {quarter:.3g} cycles/beam; z_T(1 cycle) = {2*D**2/lam/1e3:.4g} m, λ = {ctx['wavelength_um']} µm",
                  f"z = 0 (images of {optic}): " + ("; ".join(images[:3]) if images else "none after it")],
    }
