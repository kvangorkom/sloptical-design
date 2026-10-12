"""Reference results from batoid and optiland for tests/xcheck.test.js (run by it; needs python3 with numpy, and batoid
and/or optiland). Reads a JSON list of requests on stdin, writes a JSON list of results on stdout, one per request:

  {"op": "has"}                                   which libraries import: {"batoid": bool, "optiland": bool}
  {"op": "batoid", "script": path, "pupil": [[x, y], ...], "fields": [...], "wfe": bool}
      An exported batoid script (File > Export batoid): each field's rays from the pupil points (mm, on the pupil plane
      z = 0), traced; their global hit points on the last surface (null: lost). EFL from paraxial rays, and the RMS
      wavefront error (waves) from batoid.wavefront after removing piston, tilt and focus (collimated beams only).
  {"op": "optiland", "script": path, "pupil": [[px, py], ...] (normalised), "fields": [...], "wfe": bool}
      The same for an exported optiland script, traced with trace_generic; EFL and f/# from its paraxial module.
  {"op": "samples", "pupil": [[px, py], ...] (normalised)}
      Designs that ship with the libraries (optiland's sample lenses that this tool can describe: coaxial standard
      surfaces, an object at infinity, angle fields; batoid's Calypso telescope and the donsoptikz1 apochromat), each as
      a sequence of surfaces for the tool, with the library's own EFL, f/#, traced hits and RMS wavefront error.

Wavefront errors are compared after removing piston, tilt and focus (a best-fit sphere), which both libraries and this
tool can do, whatever their reference surfaces.
"""
import json, sys, math, importlib.util, warnings, io, contextlib
import numpy as np

warnings.filterwarnings("ignore")


def load(path):
    spec = importlib.util.spec_from_file_location("exported", path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def fit(x, y, w):
    """w (a wavefront about the image point) with piston and tilt fitted out: (its x² + y² term, the RMS that is left)."""
    x, y, w = (np.asarray(v, float).ravel() for v in (x, y, w))
    ok = np.isfinite(w)
    x, y, w = x[ok], y[ok], w[ok]
    A = np.stack([np.ones_like(x), x, y, x * x + y * y], 1)
    c, *_ = np.linalg.lstsq(A, w, rcond=None)
    B = A[:, :3]
    b, *_ = np.linalg.lstsq(B, w, rcond=None)
    return float(c[3]), float(np.sqrt(np.mean((w - B @ b) ** 2))), float(np.sqrt(np.mean((w - A @ c) ** 2)))


def refocused(measure, d):
    """The least RMS wavefront error over focus (the image moved along its axis by dz), with piston and tilt removed: the
    error about the best-fit sphere, which is what this tool reports. measure(dz) → (focus term, RMS about the image
    point). The focus term, linear in dz, places the search; a few parabolic steps then find the least RMS."""
    c0 = measure(0.0)[0]
    c1 = measure(d)[0]
    k = (c1 - c0) / d if c1 != c0 else 1.0                               # focus term (waves) per unit of dz
    z, s = -c0 / k, abs(.1 / k)                                         # where the focus term vanishes; a tenth of a wave of focus
    f = {dz: measure(dz)[1] for dz in (z - s, z, z + s)}
    for _ in range(6):
        a, m, b = sorted(f)[:1] + [min(f, key=f.get)] + sorted(f)[-1:]
        if m in (a, b):                                                 # the least at an end: step out
            n = m + (m - (b if m == a else a))
        else:
            fa, fm, fb = f[a], f[m], f[b]
            den = (m - a) * (fm - fb) - (m - b) * (fm - fa)
            n = m - .5 * ((m - a) ** 2 * (fm - fb) - (m - b) ** 2 * (fm - fa)) / den if den else m
            if abs(n - m) < 1e-3 * s:
                break
        f[n] = measure(n)[1]
        if len(f) > 3:                                                  # keep the three around the least
            m = min(f, key=f.get)
            L = sorted(f)
            i = L.index(m)
            keep = L[max(0, min(i - 1, len(L) - 3)):][:3]
            f = {x: f[x] for x in keep}
    return min(f.values())


def has():
    out = {}
    for name in ("batoid", "optiland"):
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                __import__(name)
            out[name] = True
        except Exception:
            out[name] = False
    return out


# ── batoid ──────────────────────────────────────────────────────────────────────────────────────────────────────────
def field_dir(f):
    """This tool's collimated field: a number is a y angle (deg), direction (0, sin, cos); a pair has tan = u_x/u_z, u_y/u_z."""
    if isinstance(f, list):
        d = np.array([math.tan(math.radians(f[0])), math.tan(math.radians(f[1])), 1.0])
        return d / np.linalg.norm(d)
    t = math.radians(f)
    return np.array([0.0, math.sin(t), math.cos(t)])


def batoid_rays(batoid, x, y, z, u, n, wl):
    v = np.asarray(u, float) / n
    return batoid.RayVector(np.asarray(x, float), np.asarray(y, float), np.full(len(x), float(z)), v[:, 0], v[:, 1], v[:, 2], t=0.0, wavelength=wl)


def global_hits(batoid, out):
    g = out.toCoordSys(batoid.CoordSys())
    lost = np.asarray(out.vignetted) | np.asarray(out.failed)
    return [None if lost[i] else [float(g.x[i]), float(g.y[i]), float(g.z[i])] for i in range(len(g.x))]


def batoid_wfe(batoid, optic, d, wl, A, zs=0.0, n0=1.0, nx=101):
    """RMS wavefront error (waves) at best focus, from batoid's trace: rays on an nx × nx grid over the pupil (radius A on
    the plane z = zs, light along d) start in phase on a plane wave; each one's optical path to a reference sphere about the
    chief ray's image point (moved by dz along the chief ray: focus) is taken back along it from where it leaves; piston and
    tilt are fitted out and the least RMS over focus kept. (batoid.wavefront itself expects light running along −z and an
    image facing it; this works in any frame.)"""
    u = np.linspace(-1, 1, nx)
    X, Y = np.meshgrid(u, u)
    m = X * X + Y * Y <= 1
    x, y = X[m], Y[m]
    d = np.asarray(d, float) / np.linalg.norm(d)
    P = np.stack([x * A, y * A, np.full_like(x, zs)], 1)
    back = 10 * A + 1e3                                                 # start well before any surface
    S0 = P - back * d
    rv = batoid.RayVector(S0[:, 0], S0[:, 1], S0[:, 2], *(np.tile(d / n0, (len(x), 1)).T), t=n0 * (S0 @ d), wavelength=wl)
    out = optic.trace(rv).toCoordSys(batoid.CoordSys())
    ok = ~(np.asarray(out.vignetted) | np.asarray(out.failed))
    r = np.stack([out.x, out.y, out.z], 1)
    v = np.stack([out.vx, out.vy, out.vz], 1)
    n1 = 1 / np.linalg.norm(v, axis=1)
    v = v * n1[:, None]
    t = np.asarray(out.t, float)
    c = int(np.argmin(x * x + y * y))
    Rs = 1e3 * A

    def measure(dz):
        C = r[c] + dz * v[c]
        q = r - C
        bb = np.sum(q * v, 1)
        s = bb + np.sqrt(np.maximum(bb * bb - (np.sum(q * q, 1) - Rs * Rs), 0))   # back along each ray to the sphere
        opl = t - n1 * s
        w = (opl - opl[c]) / wl
        return fit(x[ok], y[ok], w[ok])
    return refocused(measure, .02 * A)


def paraxial_efl(trace, h):
    """EFL from three collimated on-axis rays at pupil heights 0 and ±h: h over the sine of the angle they leave at."""
    u0, up, um = (np.asarray(trace(y)) / np.linalg.norm(trace(y)) for y in (0.0, h, -h))   # (batoid's velocities are u/n)
    s = [np.linalg.norm(np.cross(u0, v)) for v in (up, um)]
    return float(h / np.mean(s))


def run_batoid(q):
    import batoid
    m = load(q["script"])
    optic = m.build()
    n0, A, wl, beam = m.SURFACES[0][-2], m.A, m.WAVELENGTH * 1e-3, m.BEAM
    P = np.asarray(q["pupil"], float)
    res = {"hits": []}
    for f in q["fields"]:
        if beam == 0:
            u = np.tile(field_dir(f), (len(P), 1))
        else:
            fx, fy = (f if isinstance(f, list) else [0.0, f])
            qv = np.stack([fx - P[:, 0], fy - P[:, 1], np.full(len(P), beam)], 1)
            u = np.sign(beam) * qv / np.linalg.norm(qv, axis=1, keepdims=True)
        res["hits"].append(global_hits(batoid, optic.trace(batoid_rays(batoid, P[:, 0], P[:, 1], 0.0, u, n0, wl))))

    def leave(y):
        u = field_dir(0.0)[None, :] if beam == 0 else None
        if beam != 0:
            qv = np.array([[0.0 - 0.0, 0.0 - y, beam]])
            u = np.sign(beam) * qv / np.linalg.norm(qv)
        out = optic.trace(batoid_rays(batoid, [0.0], [y], 0.0, u, n0, wl))
        return [float(out.vx[0]), float(out.vy[0]), float(out.vz[0])]
    res["efl"] = paraxial_efl(leave, 1e-4 * A) if beam == 0 else None
    if q.get("wfe") and beam == 0:
        res["wfe"] = [batoid_wfe(batoid, optic, field_dir(f), wl, A, 0.0, n0) for f in q["fields"]]
    return res


# ── optiland ────────────────────────────────────────────────────────────────────────────────────────────────────────
def optiland_trace(op, Hy, pupil, wl):
    P = np.asarray(pupil, float)
    with contextlib.redirect_stdout(io.StringIO()):
        op.trace_generic(np.zeros(len(P)), np.full(len(P), Hy), P[:, 0], P[:, 1], wl)
    sg = op.surface_group
    X, Y, Z = (np.asarray(v[-1], float).ravel() for v in (sg.x, sg.y, sg.z))
    return [None if not np.isfinite(X[i] + Y[i] + Z[i]) else [float(X[i]), float(Y[i]), float(Z[i])] for i in range(len(P))]


def optiland_wfe(op, Hy, wl, step, n=64, absolute=False):
    """RMS wavefront error (waves) at best focus, moving the image along the axis: by changing the last gap, or (absolute:
    an exported design, its surfaces placed at absolute positions) the image surface's own z."""
    from optiland.wavefront import Wavefront
    sg = op.surface_group
    i = sg.num_surfaces - 2
    t0 = float(np.ravel(sg.positions)[-1] - np.ravel(sg.positions)[-2])

    cs = sg.surfaces[-1].geometry.cs
    z0 = float(np.ravel(cs.z)[0])

    def move(dz):
        with contextlib.redirect_stdout(io.StringIO()):
            if absolute:
                cs.z = z0 + dz
            else:
                op.set_thickness(t0 + dz, i)

    def measure(dz):
        move(dz)
        with contextlib.redirect_stdout(io.StringIO()):
            wf = Wavefront(op, fields=[(0.0, Hy)], wavelengths=[wl], num_rays=n, distribution="uniform")
        d = list(wf.data.values())[0]
        w = np.asarray(d.opd, float).ravel()
        keep = np.asarray(d.intensity, float).ravel() > 0 if d.intensity is not None else np.ones_like(w, bool)
        x, y = np.asarray(wf.distribution.x, float), np.asarray(wf.distribution.y, float)
        return fit(x[keep], y[keep], w[keep])
    try:
        return refocused(measure, step)
    finally:
        move(0.0)


def run_optiland(q):
    m = load(q["script"])
    with contextlib.redirect_stdout(io.StringIO()):
        op = m.build()
    wl = m.WAVELENGTH
    top = max(abs(f) for f in q["fields"]) or 1.0
    def leave(py):                                                     # real paraxial rays (its paraxial module expects coaxial designs)
        with contextlib.redirect_stdout(io.StringIO()):
            r = op.trace_generic(0.0, 0.0, 0.0, py, wl)
        return [float(np.ravel(v)[0]) for v in (r.L, r.M, r.N)]
    efl = paraxial_efl(leave, 1e-4) * m.A                                # (normalised pupil height 1e-4 is 1e-4·A)
    res = {"hits": [optiland_trace(op, f / top, q["pupil"], wl) for f in q["fields"]], "efl": efl, "fno": efl / (2 * m.A)}
    if q.get("wfe"):
        res["wfe"] = [optiland_wfe(op, f / top, wl, .02 * m.A, absolute=True) for f in q["fields"]]
    return res


# ── the libraries' own designs ──────────────────────────────────────────────────────────────────────────────────────
def optiland_samples(pupil):
    import importlib, inspect, pkgutil
    import optiland.samples as samples
    out = []
    for mod_info in pkgutil.iter_modules(samples.__path__):
        mod = importlib.import_module("optiland.samples." + mod_info.name)
        for name, cls in inspect.getmembers(mod, inspect.isclass):
            if cls.__module__ != mod.__name__:
                continue
            try:
                with contextlib.redirect_stdout(io.StringIO()):
                    op = cls()
                d = describe_optiland(op, pupil)
            except Exception as e:                                     # not describable here (see describe_optiland)
                d = {"skip": str(e)[:120]}
            out.append({"lib": "optiland", "name": f"{mod_info.name}.{name}", **d})
    return out


def describe_optiland(op, pupil):
    sg = op.surface_group
    S = sg.surfaces
    if np.isfinite(float(np.ravel(sg.positions)[0])):
        raise ValueError("finite object")
    geos = {type(s.geometry).__name__ for s in S[1:]}
    if not geos <= {"Plane", "StandardGeometry"}:
        raise ValueError(f"surfaces {sorted(geos)}")
    for s in S:
        cs = s.geometry.cs
        if any(abs(float(np.ravel(getattr(cs, a, 0) or 0)[0])) > 0 for a in ("x", "y", "rx", "ry", "rz")):
            raise ValueError("decentred or tilted")
    op.ray_tracer.set_aiming("paraxial")                               # rays through the paraxial entrance pupil, as here
    with contextlib.redirect_stdout(io.StringIO()):
        op.image_solve()                                                # the image at paraxial focus (wavefront errors are compared near focus)
    fd = type(op.fields.field_definition).__name__ if hasattr(op.fields, "field_definition") else ""
    if "Angle" not in fd and "angle" not in str(getattr(op.fields, "field_type", "angle")):
        raise ValueError(f"fields: {fd}")
    wl = float(op.primary_wavelength)
    z = np.asarray(sg.positions, float).ravel()
    rows, d = [], 1.0
    for i in range(1, len(S)):
        s = S[i]
        R = float(np.ravel(s.geometry.radius)[0]) if hasattr(s.geometry, "radius") else math.inf
        k = float(np.ravel(getattr(s.geometry, "k", 0.0))[0])
        mirror = bool(getattr(s.interaction_model, "is_reflective", False))
        n = float(np.ravel(s.material_post.n(wl))[0])
        din = d
        if mirror:
            d = -d
        t = (z[i + 1] - z[i]) * d if i + 1 < len(S) else 0.0
        rows.append({"R": 0.0 if not np.isfinite(R) else R * din, "k": k, "t": float(t), "n": n, "mirror": mirror})
    epl, epd = float(np.ravel(op.paraxial.EPL())[0]), float(np.ravel(op.paraxial.EPD())[0])
    top = float(op.fields.max_field)
    fields = [float(f[1]) * top for f in op.fields.get_field_coords()]
    hits, wfe = [], []
    for f in fields:
        Hy = f / top if top else 0.0
        hits.append(optiland_trace(op, Hy, pupil, wl))
        wfe.append(optiland_wfe(op, Hy, wl, .02 * epd / 2))
    return {"lambda": wl, "pupil_t": -epl, "ap": epd / 2, "rows": rows, "fields": fields, "hits": hits, "wfe": wfe,
            "na": float(math.sin(math.atan(epd / 2 / abs(float(np.ravel(op.paraxial.f2())[0]))))),
            "efl": float(np.ravel(op.paraxial.f2())[0]), "fno": float(np.ravel(op.paraxial.FNO())[0])}


def batoid_samples(pupil):
    import batoid
    out = []
    for f, fields, stop in (("Calypso.yaml", [0.0, 0.1, 0.25], None), ("donsoptikz1.yaml", [0.0, 0.5, 1.0], "first")):
        try:
            out.append({"lib": "batoid", "name": f, **describe_batoid(batoid, batoid.Optic.fromYaml(f), fields, stop, pupil)})
        except Exception as e:
            out.append({"lib": "batoid", "name": f, "skip": str(e)[:120]})
    return out


def describe_batoid(batoid, optic, fields, stop, pupil, wl=500e-9):
    """A coaxial batoid optic (baffles left out) as this tool's rows, in mm. Light may run along −z (telescopes): the tool's
    frame is then the optic's turned 180° about x, (x, y, z) → (x, −y, −z)."""
    items = []

    def walk(o):
        if hasattr(o, "items"):
            for it in o.items:
                walk(it)
        elif type(o).__name__ != "Baffle":
            items.append(o)
    walk(optic)
    for it in items:
        if not np.allclose(it.coordSys.rot, np.eye(3)) or abs(it.coordSys.origin[0]) + abs(it.coordSys.origin[1]) > 0:
            raise ValueError("not coaxial")
    mm = 1e3
    keep = {k: getattr(optic, k) for k in ("stopSurface", "pupilSize", "pupilObscuration", "sphereRadius", "backDist") if hasattr(optic, k)}
    optic = batoid.CompoundOptic(items=items, name=optic.name, inMedium=optic.inMedium, outMedium=optic.outMedium)   # (no baffles: none here)
    for k, v in keep.items():
        setattr(optic, k, v)
    if stop == "first":                                                # (no stop defined: the first face, 90 % of its clear aperture)
        z0 = items[0].coordSys.origin[2]
        ob = items[0].obscuration
        r = getattr(ob, "radius", None) or getattr(getattr(ob, "original", None), "radius", None)
        ap = 0.9 * r if r else 0.01
        optic.stopSurface = batoid.Interface(batoid.Plane(), batoid.CoordSys(origin=[0, 0, z0]))
        optic.pupilSize, optic.pupilObscuration = 2 * ap, 0.0
        optic.sphereRadius = 1.0
        optic.backDist = 0.05
    zs, A = optic.stopSurface.coordSys.origin[2], optic.pupilSize / 2
    rv = batoid.RayVector.asPolar(optic=optic, wavelength=wl, theta_x=0.0, theta_y=0.0, nrad=2, naz=6)
    d0 = 1.0 if rv.vz[0] > 0 else -1.0
    rows, d = [], d0
    for i, it in enumerate(items):
        s = it.surface
        R = float(getattr(s, "R", math.inf))
        k = float(getattr(s, "conic", 0.0)) if hasattr(s, "conic") else (0.0 if type(s).__name__ != "Paraboloid" else -1.0)
        mirror = type(it).__name__ == "Mirror"
        n = float(it.outMedium.getN(wl)) if hasattr(it, "outMedium") else 1.0
        din = d
        if mirror:
            d = -d
        t = (items[i + 1].coordSys.origin[2] - it.coordSys.origin[2]) * d if i + 1 < len(items) else 0.0
        rows.append({"R": 0.0 if not np.isfinite(R) else R * din * mm, "k": k, "t": t * mm, "n": n, "mirror": mirror})
    n0 = float(optic.inMedium.getN(wl))
    flip = np.array([1.0, d0, d0])                                     # tool ↔ optic frame (a 180° turn about x when d0 = −1)
    h = 1e-3 * A                                                       # the detector to paraxial focus: where a near-axis ray crosses the axis
    out = optic.trace(batoid_rays(batoid, [0.0], [h * d0], zs, (field_dir(0.0) * flip)[None, :], n0, wl))
    dz = -float(out.y[0]) / (float(out.vy[0]) / float(out.vz[0]))
    det = items[-1]
    optic = optic.withLocallyShiftedOptic(det.name, [0.0, 0.0, dz])
    items[-1] = optic[det.name]
    optic.pupilObscuration = 0.0                                       # (the full pupil, as here: no central obstruction)
    rows[-2]["t"] += dz * d * mm
    P = np.asarray(pupil, float) * A
    hits, wfe = [], []
    for f in fields:
        u = np.tile(field_dir(f) * flip, (len(P), 1))
        out = optic.trace(batoid_rays(batoid, P[:, 0], P[:, 1] * d0, zs, u, n0, wl))
        g = global_hits(batoid, out)
        hits.append([None if p is None else [p[0] * mm, p[1] * d0 * mm, (p[2] - zs) * d0 * mm] for p in g])
        wfe.append(batoid_wfe(batoid, optic, field_dir(f) * flip, wl, A, zs, n0))

    def leave(y):
        out = optic.trace(batoid_rays(batoid, [0.0], [y * d0], zs, (field_dir(0.0) * flip)[None, :], n0, wl))
        return [float(out.vx[0]), float(out.vy[0]), float(out.vz[0])]
    return {"lambda": wl * 1e6, "pupil_t": (items[0].coordSys.origin[2] - zs) * d0 * mm, "ap": A * mm, "rows": rows,
            "fields": fields, "hits": hits, "wfe": wfe, "efl": paraxial_efl(leave, 1e-4 * A) * mm, "n_air": n0,
            "na": float(math.sin(math.atan(A / paraxial_efl(leave, 1e-4 * A))))}


def main():
    reqs = json.load(sys.stdin)
    out = []
    for q in reqs:
        try:
            if q["op"] == "has":
                out.append(has())
            elif q["op"] == "batoid":
                out.append(run_batoid(q))
            elif q["op"] == "optiland":
                out.append(run_optiland(q))
            elif q["op"] == "samples":
                L = []
                avail = has()
                if avail["optiland"]:
                    L += optiland_samples(q["pupil"])
                if avail["batoid"]:
                    L += batoid_samples(q["pupil"])
                out.append(L)
            else:
                out.append({"error": "unknown op " + q["op"]})
        except Exception as e:
            import traceback
            out.append({"error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()[-1500:]})
    def clean(v):                                                      # (JSON has no NaN)
        if isinstance(v, float) and not math.isfinite(v):
            return None
        if isinstance(v, list):
            return [clean(x) for x in v]
        if isinstance(v, dict):
            return {k: clean(x) for k, x in v.items()}
        return v
    json.dump(clean(out), sys.stdout)


if __name__ == "__main__":
    main()
