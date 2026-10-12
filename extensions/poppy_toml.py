"""poppy_utils: export the design as a poppy_utils .toml optical system. (An Optic Sketch export extension.)

poppy_utils (https://github.com/kvangorkom/poppy_utils) builds a poppy optical system from a .toml file. This writes one
for a monochromatic, unpolarized Fresnel model of the sketch, unfolded along its optical axis:

* the pupil becomes a CircularAperture (preceded by a QuadraticLens when the beam comes from or goes to a focus);
* every mirror, and every refracting surface with power or a change of index, becomes a compound optic: a CircularAperture
  stop (the optic's semi-aperture, or the beam's footprint there when none is set) and a poppy_utils.ABCPSDWFE surface
  error, followed by a poppy_utils.ConicPhase for its power (skipped for flats);
* a plain plane (flat, no change of index) becomes a ScalarTransmission, or a stop when it has an aperture; the last one
  becomes a poppy.Detector (when that setting is on).

Distances (dz) are measured along the optical axis between the points where it meets each optic, so off-axis optics are
placed at their segment centres, as ConicPhase expects: roc is the parent's vertex radius (positive when concave, i.e.
focusing), oad the off-axis distance of the axis point on the parent and k the conic. A refracting surface's power
becomes the ConicPhase of the equivalent thin lens (roc = 2R / (n' - n)), with distances inside glass divided by the
index (reduced distances), which keeps the paraxial imaging right. Field angles, tilts and aberrations beyond the conic
phase (ConicPhase is a quadratic phase) are not modelled.
"""
import math

NAME = "poppy_utils (.toml)"
DESCRIPTION = "poppy_utils Fresnel optical system (.toml): apertures, ABC-PSD surface errors and conic phases"
TARGETS = ["export"]
PARAMS = {
    "npix": {"label": "npix", "type": "number", "default": 512},
    "oversample": {"label": "oversample", "type": "number", "default": 4},
    "margin": {"label": "unset stops: beam ×", "type": "number", "default": 1.1},
    "surf_powered": {"label": "surface rms, powered (nm)", "type": "number", "default": 4.7},
    "surf_flat": {"label": "surface rms, flat (nm)", "type": "number", "default": 5.0},
    "psd_b": {"label": "PSD b (1/m)", "type": "number", "default": 154},
    "psd_c": {"label": "PSD c", "type": "number", "default": 2.7},
    "amp_rms": {"label": "amplitude rms", "type": "number", "default": 0.07071067812},
    "detector": {"label": "detector at the last plane", "type": "bool", "default": True},
    "pixel_um": {"label": "pixel (µm, 0 = Nyquist)", "type": "number", "default": 0},
    "fov_pixels": {"label": "detector pixels", "type": "number", "default": 128},
}


def q(text):
    """A TOML basic string."""
    return '"' + str(text).replace("\\", "\\\\").replace('"', '\\"') + '"'


def num(v):
    return format(v, ".12g")


def mm(v):
    return q(num(0.0 if abs(v) < 1e-12 else v) + "mm")


def unique(names):
    seen, out = set(), []
    for n in names:
        m, k = n, 2
        while m in seen:
            m, k = f"{n} ({k})", k + 1
        seen.add(m)
        out.append(m)
    return out


def run(ctx):
    P = ctx["params"]
    get = lambda k: P.get(k, PARAMS[k]["default"])
    npix = max(16, int(round(float(get("npix")))))
    over = max(1.0, float(get("oversample")))
    margin, b, c, amp = float(get("margin")), float(get("psd_b")), float(get("psd_c")), float(get("amp_rms"))
    detector, fov = bool(get("detector")), max(1, int(round(float(get("fov_pixels")))))

    surfs, a, beam_R = ctx["surfaces"], ctx["pupil"]["semi_diameter"] or 1.0, ctx["pupil"]["beam_R"] or 0.0
    lam_um = ctx["wavelength_um"]
    names = unique([s["name"] for s in surfs])
    notes, glass, auto = [], False, []

    sub = lambda u, v: [u[0] - v[0], u[1] - v[1]]
    dot = lambda u, v: u[0]*v[0] + u[1]*v[1]

    def footprint(i):
        """Radius of the on-axis and field beams just after surface i, on the plane across the axis (None if lost)."""
        r = 0.0
        for f in ctx["fields"]:
            for k in range(16):
                t = 2*math.pi*k/16
                h = ctx.plane(i + 1, 0.0, f, a*math.cos(t), a*math.sin(t))
                if h:
                    r = max(r, math.hypot(h["x"], h["y"]))
        return r or None

    out = [
        "# Exported from Optic Sketch: a poppy_utils optical system (https://github.com/kvangorkom/poppy_utils).",
        "# Monochromatic, unpolarized Fresnel model unfolded along the optical axis; lengths in mm.",
        "",
        "[metadata]",
        f"design = {q(ctx['name'])}",
        f"notes = {q('Exported from Optic Sketch. Surface errors are default ABC-PSD values; stops without a set aperture follow the beam.')}",
        "",
        "[wavefront]",
        "optic_type = 'poppy.FresnelWavefront'",
        f"wavelength = {q(num(lam_um*1e3) + 'nm')}",
        f"npix = {npix}",
        f"oversample = {num(over)}",
        f"beam_radius = {mm(a)}",
        "",
        "[[osys]]",
        "optic_type = 'poppy.FresnelOpticalSystem'",
        f"name = {q(ctx['name'])}",
        f"pupil_diameter = {mm(2*a)} # 2x wavefront.beam_radius",
        f"npix = {npix}",
        f"beam_ratio = {num(1/over)} # inverse of wavefront.oversample",
        "",
        "[[osys.optics]]",
        "name = 'Pupil'",
        "optic_type = 'poppy.CircularAperture'",
        f"radius = {mm(a)}",
    ]
    if beam_R:
        out += ["", "[[osys.optics]] # the beam at the pupil comes from (f < 0) or goes to (f > 0) a focus this far away",
                "name = 'Pupil_curvature'", "optic_type = 'poppy.QuadraticLens'", f"f_lens = {mm(beam_R)}"]

    prev, prev_u, n_gap = [0.0, 0.0], [0.0, 1.0], 1.0   # previous axis point and direction; index of the gap
    last = len(surfs) - 1
    for i, (s, name) in enumerate(zip(surfs, names)):
        hit, u = s["hit"], s["out_axis"]
        dz = dot(sub(hit, prev), prev_u)/n_gap        # along the axis; reduced (÷ n) inside glass
        if n_gap != 1:
            glass = True
        prev, prev_u, n_gap = hit, u, s["n_out"]

        mirror = s["type"] == "mirror"
        powered, index = bool(s["R"]), not mirror and abs(s["n_out"] - s["n_in"]) > 1e-12
        ap = s["semi_aperture"] or 0.0
        gap = f"dz = {mm(dz)}" + (f" # {num(dz*s['n_in'])} mm of index {num(s['n_in'])}, reduced" if s["n_in"] != 1 else "")

        if not (mirror or powered or index):            # a plain plane
            out.append("")
            if i == last and detector:
                pix = float(get("pixel_um"))
                if pix <= 0:                            # automatic, from the on-axis marginal ray there
                    h = ctx.plane(i + 1, 0.0, 0.0, 0.0, a)
                    na = abs(h["dy"])*h["index"] if h else 0.0
                    if h and abs(h["y"]) < 0.02*a and na > 1e-6:   # at a focus: Nyquist, λ/(4 NA)
                        pix = lam_um/(4*na)
                        notes.append(f"Detector pixel {pix:.3g} µm: Nyquist at NA {na:.3g}.")
                    else:                               # not at a focus: the pixels span the beam
                        pix = 2e3*(footprint(i) or a)*max(margin, 1.0)/fov
                        notes.append(f"Detector pixel {pix:.3g} µm: the beam isn't focused there, so {fov} pixels span it.")
                out += [f"[[osys.optics]]", f"name = {q(name)}", gap, "optic_type = 'poppy.Detector'",
                        f"pixelscale = {q(num(pix) + 'micron/pixel')}", f"fov_pixels = {fov}"]
            elif ap:
                out += ["[[osys.optics]]", f"name = {q(name)}", "is_compound = true", gap,
                        "[[osys.optics.optics]]", f"name = {q(name + '_stop')}", "optic_type = 'poppy.CircularAperture'", f"radius = {mm(ap)}"]
            else:
                out += ["[[osys.optics]]", f"name = {q(name)}", gap, "optic_type = 'poppy.ScalarTransmission'"]
            continue

        # a physical surface: stop, surface error and (when powered) conic phase
        stop = ap
        if not stop:
            fp = footprint(i)
            stop = (fp or a)*margin
            auto.append(name)
        rms = float(get("surf_powered" if powered else "surf_flat"))
        scale = 2.0 if mirror else abs(s["n_out"] - s["n_in"])   # reflection doubles the surface error
        psd = f"[{num(rms)}, {num(b)}, {num(c)}]"
        out += ["", "[[osys.optics]]", f"name = {q(name)}", "is_compound = true", gap,
                "[[osys.optics.optics]]", f"name = {q(name + '_stop')}", "optic_type = 'poppy.CircularAperture'",
                f"radius = {mm(stop)}" + ("" if ap else " # no aperture set: the beam footprint" + (f" x {num(margin)}" if margin != 1 else "")),
                "[[osys.optics.optics]]", f"name = {q(name + '_surface')}", "optic_type = 'poppy_utils.ABCPSDWFE'",
                f"amp_params = {psd} # abc PSD: a = rms surface (nm), b (1/m), c exponent",
                f"wfe_params = {psd} # (a is ignored when the rms values below are given)",
                f"wfe_rms = {q(num(scale*rms) + 'nm')} # {'2x' if mirror else '|n′ - n| x'} the surface error",
                f"amp_rms = {num(amp)}"]
        if not powered:
            continue
        # ConicPhase: roc > 0 focuses. Here R > 0 puts the centre of curvature downstream of the incoming light.
        V, ez = s["vertex"], s["axis"]
        w = sub(hit, V)
        oad = abs(w[0]*ez[1] - w[1]*ez[0])             # distance of the axis point from the parent's axis
        if mirror:
            roc, k, why = -s["R"], s["k"], None
            if oad > 1e-9 and k > 0:
                notes.append(f"{name}: an off-axis oblate ellipsoid (k > 0) has no foci; ConicPhase's off-axis conversion won't apply.")
        else:
            roc, k, why = 2*s["R"]/(s["n_out"] - s["n_in"]), s["k"], "thin-lens equivalent of the refracting surface: roc = 2R/(n′ - n)"
            if oad > 1e-9:
                notes.append(f"{name}: an off-axis refracting surface is exported on axis (its thin-lens power only).")
            oad = 0.0
        out += ["", "[[osys.optics]]" + (f" # {why}" if why else ""), f"name = {q(name + '_power')}", "optic_type = 'poppy_utils.ConicPhase'",
                f"roc = {mm(roc)}", f"oad = {mm(oad)}", f"k = {num(k)}"]

    if auto:
        notes.append("Stops sized to the beam (no aperture set): " + ", ".join(auto) + ".")
    if glass:
        notes.append("Distances inside glass are reduced (divided by the index): poppy propagates in vacuum.")
    if any(f for f in ctx["fields"]):
        notes.append("Only the on-axis beam is modelled (poppy): the other fields aren't exported.")
    base = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in ctx["name"]) or "system"
    return {"filename": base + "_poppy.toml", "text": "\n".join(out) + "\n", "notes": notes}
