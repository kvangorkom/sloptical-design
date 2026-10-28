// python.js — Python export: scripts that rebuild the design in batoid or optiland.

(function enginePython(Optics) {
  if (typeof module !== 'object') (Optics.SOURCES ??= []).push(String(enginePython)); // (extensions' worker rebuilds the engine from these)
  ('use strict');
  const { carry, cross, build, is3D, start } = Optics;

  /** Python scripts that rebuild the system in batoid (lib 'batoid') or optiland (lib 'optiland'), with every surface placed
   *  absolutely: vertex (0, y, z) in this tool's frame (pupil at the origin, the axis starting along +z), its axis tilted
   *  by rotX = atan2(−ez_y, ez_z) radians about x, radius 1/c in its own frame, conic k, and constant indices before and
   *  after. The last surface is the image (a batoid Detector when it is a plain plane). Rays start on the pupil plane z = 0:
   *  collimated at the field angles (degrees), or from/to the source point (0, h, R) when the beam comes from a focus.
   *  Run as a script, each prints the spot of every field on the last surface. */
  function toPython(rows, lib, { fields = [0], lambda = 0.55, name = 'Sloptical Design' } = {}) {
    const S = build(rows);
    if (S.some(s => s.para))
      throw Error(`this design has a paraxial (ideal) lens, which ${lib} doesn't model: export it for Zemax`);
    const py = v => {
      if (!isFinite(v)) throw Error('the layout has a surface the axis ray misses; fix it before exporting');
      return String(+v.toPrecision(15));
    };
    const three = is3D(rows) || fields.some(Array.isArray);
    if (three && lib !== 'batoid')
      throw Error(
        'this design leaves the y–z plane: export it for batoid or Zemax (the optiland script is planar)',
      );
    const vec = v => `(${v.map(py).join(', ')})`;
    const fld = f => (three ? vec(Array.isArray(f) ? f : [0, f]) : py(f));
    const seen = new Set();
    const uniq = n => {
      let m = n;
      let i = 2;
      while (seen.has(m)) m = `${n} (${i++})`;
      seen.add(m);
      return m;
    };
    const table = S.map((s, i) => {
      const last = i === S.length - 1;
      const kind = s.mirror ? 'mirror' : last && !s.c && s.nOut === s.nIn ? 'image' : 'refract';
      const ex = s.ex ?? cross(s.ey, s.ez);
      const where = three
        ? `${vec(s.V)}, (${[0, 1, 2].map(r => vec([ex[r], s.ey[r], s.ez[r]])).join(', ')})`
        : `${py(s.V[1])}, ${py(s.V[2])}, ${py(Math.atan2(-s.ez[1], s.ez[2]))}`;
      return `    (${JSON.stringify(uniq(s.name || 'S' + (i + 1)))}, "${kind}", ${where}, ${py(s.c ? 1 / s.c : 0)}, ${py(s.k)}, ${py(s.nIn)}, ${py(s.nOut)}),`;
    });
    const beam = rows[0].R || 0;
    const doc =
      lib === 'batoid'
        ? 'batoid (https://github.com/jmeyers314/batoid; tested with 0.9)'
        : 'optiland (https://github.com/HarrisonKramer/optiland; tested with 0.6)';
    const head = `"""${name}: exported from Sloptical Design for ${doc}.

Units: mm. The entrance pupil is the plane z = 0 at the origin, semi-diameter A; the optical axis starts along +z and y is up.
${
  three
    ? `Every surface is placed absolutely: its vertex at (x, y, z) and its frame given by ROT, whose columns are the surface's
own x, y and z axes (z its optical axis), with radius R = 1/curvature in that frame (0 = flat), conic k, and constant
refractive indices before and after (no dispersion). Rays start on the pupil plane: collimated with direction
(tan fx, tan fy, 1) for field angles (fx, fy) in degrees, or, when BEAM != 0, from (BEAM < 0) or toward (BEAM > 0) the
source point (hx, hy, BEAM) with the fields as its heights (mm). The last surface is the image.`
    : `Every surface is placed absolutely: its vertex at (0, y, z) and its axis tilted by rotX (radians, about x), with radius
R = 1/curvature in its own frame (0 = flat), conic k, and constant refractive indices before and after (no dispersion).
Rays start on the pupil plane: collimated at the field angles (degrees), or, when BEAM != 0, from (BEAM < 0) or toward
(BEAM > 0) the source point (0, h, BEAM) with the fields as its heights h (mm). The last surface is the image.`
}
Run this file to print each field's spot there; import it and call build() to use the system.
"""
import numpy as np
${lib === 'batoid' ? 'import batoid' : 'from optiland.optic import Optic\nfrom optiland.materials import IdealMaterial'}

NAME = ${JSON.stringify(name)}
A = ${py(rows[0].ap)}                # entrance-pupil semi-diameter
WAVELENGTH = ${py(lambda)}         # µm
BEAM = ${py(beam)}                # incoming beam's radius of curvature at the pupil (0 = collimated)
FIELDS = [${fields.map(fld).join(', ')}]   # ${beam ? 'source heights (mm)' : 'angles (degrees)'}${
      three
        ? `
ROT3D = True            # surfaces carry a vertex (x, y, z) and a full rotation`
        : ''
    }

# ${three ? 'name, kind, vertex (x, y, z), ROT (rows; columns = own x, y, z axes)' : 'name, kind, vertex y, vertex z, rotX (rad)'}, R (0 = flat), conic, index before, index after
SURFACES = [
${table.join('\n')}
]
`;
    const batoid = `

def surface(R, k):
    if R == 0:
        return batoid.Plane()
    if k == -1:
        return batoid.Paraboloid(R)
    if k == 0:
        return batoid.Sphere(R)
    return batoid.Asphere(R, k, [])        # (batoid.Quadric loses precision near k = -1)


def build():
    """The system as a batoid CompoundOptic, traced in the order listed."""
    items = []
    for name, kind, ${three ? 'V, ROT' : 'y, z, rx'}, R, k, n1, n2 in SURFACES:
        kw = dict(name=name, surface=surface(R, k), coordSys=batoid.CoordSys(${three ? 'origin=list(V), rot=np.array(ROT)' : 'origin=[0.0, y, z], rot=batoid.RotX(rx)'}),
                  inMedium=batoid.ConstMedium(n1), outMedium=batoid.ConstMedium(n2))
        items.append({"mirror": batoid.Mirror, "image": batoid.Detector}.get(kind, batoid.RefractiveInterface)(**kw))
    return batoid.CompoundOptic(items=items, name=NAME, inMedium=batoid.ConstMedium(SURFACES[0][${three ? -2 : 7}]), outMedium=batoid.ConstMedium(SURFACES[-1][${three ? -1 : 8}]))


def rays(field, rings=12):
    """Hexapolar pupil samples for one field, as a RayVector on the pupil plane."""
    rho = np.concatenate([[0.0]] + [np.full(6*i, i/rings) for i in range(1, rings + 1)])
    phi = np.concatenate([[0.0]] + [np.arange(6*i)*2*np.pi/(6*i) for i in range(1, rings + 1)])
    x, y = A*rho*np.sin(phi), A*rho*np.cos(phi)
${
  three
    ? `    if BEAM == 0:
        d = np.array([np.tan(np.radians(field[0])), np.tan(np.radians(field[1])), 1.0])
        u = np.tile(d/np.linalg.norm(d), (len(x), 1))
    else:
        q = np.stack([field[0] - x, field[1] - y, np.full_like(x, BEAM)], axis=1)`
    : `    if BEAM == 0:
        t = np.radians(field)
        u = np.tile([0.0, np.sin(t), np.cos(t)], (len(x), 1))
    else:
        q = np.stack([-x, field - y, np.full_like(x, BEAM)], axis=1)`
}
        u = np.sign(BEAM)*q/np.linalg.norm(q, axis=1, keepdims=True)
    n = SURFACES[0][${three ? -2 : 7}]
    return batoid.RayVector(x, y, np.zeros_like(x), u[:, 0]/n, u[:, 1]/n, u[:, 2]/n, t=0.0, wavelength=WAVELENGTH*1e-3)


if __name__ == "__main__":
    optic = build()
    for f in FIELDS:
        out = optic.trace(rays(f))                     # in the last surface's own frame
        ok = ~(out.vignetted | out.failed)
        x, y = out.x[ok], out.y[ok]
        print(f"field {f}: centroid ({x.mean():.6f}, {y.mean():.6f}) mm, RMS radius {np.sqrt(x.var() + y.var()):.6g} mm, {ok.sum()} rays")
`;
    const optiland = `

def build():
    """The system as an optiland Optic, with every surface at an absolute position."""
    op = Optic()
    op.surfaces.add(index=0, z=BEAM if BEAM else -np.inf)            # object: the source point, or at infinity
    op.surfaces.add(index=1, z=0.0, is_stop=True)                     # the entrance pupil
    for i, (name, kind, y, z, rx, R, k, n1, n2) in enumerate(SURFACES, start=2):
        kw = dict(index=i, y=y, z=z, rx=rx, conic=k, comment=name,
                  material="mirror" if kind == "mirror" else "air" if n2 == 1 else IdealMaterial(n=n2))
        if R:
            kw["radius"] = R
        op.surfaces.add(**kw)
    op.set_aperture(aperture_type="EPD", value=2*A)
    op.fields.set_type("object_height" if BEAM else "angle")
    for f in FIELDS:
        op.fields.add(y=f)
    op.wavelengths.add(value=WAVELENGTH, is_primary=True)
    return op


if __name__ == "__main__":
    optic = build()
    top = max(abs(f) for f in FIELDS) or 1
    for f in FIELDS:
        optic.trace(Hx=0, Hy=f/top, wavelength=WAVELENGTH, num_rays=12, distribution="hexapolar")
        img = optic.surfaces.surfaces[-1]                 # global coordinates, taken into the image plane's own x, y
        p = np.stack([np.asarray(img.x), np.asarray(img.y), np.asarray(img.z)], axis=1)
        p = p[np.isfinite(p).all(axis=1)]
        _, _, vy, vz, rx, *_ = SURFACES[-1]
        x, y = p[:, 0], (p[:, 1] - vy)*np.cos(rx) + (p[:, 2] - vz)*np.sin(rx)
        print(f"field {f}: centroid ({x.mean():.6f}, {y.mean():.6f}) mm, RMS radius {np.sqrt(x.var() + y.var()):.6g} mm, {len(p)} rays")
`;
    return head + (lib === 'batoid' ? batoid : optiland);
  }

  Object.assign(Optics, { toPython });
  if (typeof module === 'object') module.exports = Optics;
})(typeof module === 'object' ? require('./zemax.js') : globalThis.Optics);
