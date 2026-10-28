// Extensions come from the extensions/ folder (none are embedded in the page), and the example's physics checks out in
// plain CPython against a mock context (free space: z/z_T = λ z f² / 2D²). Skipped when python3 isn't installed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `got ${a}, expected ${b} ± ${tol}`);
const src = fs.readFileSync(path.join(root, 'extensions/talbot.py'), 'utf8');
// A ray in free space z from where it left pupil point (px, py) at field angle(s) (degrees: a number for y, or [x, y]).
const FREE = `
def free(z, field, px, py):
    fx, fy = field if isinstance(field, (list, tuple)) else (0.0, field)
    tx, ty = math.tan(math.radians(fx)), math.tan(math.radians(fy))
    n = math.sqrt(1 + tx*tx + ty*ty)
    return {"x": px + z*tx, "y": py + z*ty, "dx": tx/n, "dy": ty/n, "dz": 1/n, "index": 1.0, "L": 0.0}`;

test('extensions live in extensions/, not in the page: the page embeds no Python and reads the folder', () => {
  const app = path.join(root, 'src/app');
  const html = [path.join(root, 'index.html'), ...fs.readdirSync(app).map(f => path.join(app, f))]
    .map(f => fs.readFileSync(f, 'utf8'))
    .join('\n');
  assert.ok(!/<script[^>]*text\/x-python/.test(html) && !html.includes('NAME = "Talbot"'));
  assert.ok(html.includes("fetch('extensions/'"));
  assert.ok(
    ['talbot.py', 'poppy_toml.py'].every(f => fs.readdirSync(path.join(root, 'extensions')).includes(f)),
  );
});

test(
  'Talbot: in a collimated gap z from the optic, z/z_T = λ z f²/(2 D²) and z_T/4 falls at f = D/√(2λz)',
  { skip: spawnSync('python3', ['--version']).status !== 0 && 'python3 not found' },
  () => {
    const py = `
import json, math, sys
exec(open(sys.argv[1]).read())
${FREE}
class Ctx(dict):
    def plane(self, seg, s, field, px, py):          # one flat optic, then free space: seg 1 starts on it
        return free(s if seg == 1 else 0.0, field, px, py)
ctx = Ctx({"target": {"segment": 1, "s": 800.0}, "pupil": {"semi_diameter": 12.5, "beam_R": 0}, "field_unit": "deg",
           "wavelength_um": 0.633, "params": {"optic": "previous", "fmax": 50}, "surfaces": [{"name": "DM"}]})
print(json.dumps(run(ctx)))`;
    const r = spawnSync('python3', ['-c', py, path.join(root, 'extensions/talbot.py')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    const lam = 0.633e-3;
    const z = 800;
    const D = 25;
    const s = out.series[0];
    s.x.forEach((f, k) => assert.ok(Math.abs(s.y[k] - (lam * z * (f / D) ** 2) / 2) <= 1e-12 * s.y[k]));
    assert.match(out.notes[0], /from DM: equivalent distance 800 mm, beam Ø 25 mm/);
    assert.match(
      out.notes[1],
      new RegExp(`z_T/4 at ${+(D * Math.sqrt(0.5 / (lam * z))).toPrecision(3)} cycles/beam`),
    );
    assert.equal(out.notes[2], 'z = 0 (images of DM): none after it'); // free space re-images nothing
    assert.equal(s.x.at(-1).toFixed(6), '50.000000');
    assert.ok(out.xlog && !out.ylog);
    assert.deepEqual(out.ylim, [0, null]);
    // linear axes from 0 with a fixed upper bound for z/z_T
    const lin = JSON.parse(
      spawnSync(
        'python3',
        [
          '-c',
          py.replace('"fmax": 50}', '"fmax": 50, "ymax": 0.3, "xlog": False, "ylog": False}'),
          path.join(root, 'extensions/talbot.py'),
        ],
        { encoding: 'utf8' },
      ).stdout,
    );
    assert.ok(!lin.xlog && !lin.ylog);
    assert.deepEqual(lin.ylim, [0, 0.3]);
    assert.equal(lin.series[0].x[0], 0);
    assert.equal(lin.series[0].x.at(-1), 50);
    lin.series[0].x.forEach((f, k) =>
      assert.ok(
        Math.abs(lin.series[0].y[k] - (lam * z * (f / D) ** 2) / 2) <= 1e-12 * (lin.series[0].y[k] || 1),
      ),
    );
  },
);

test(
  'Talbot from the entrance pupil: z is measured from the pupil plane, through a flat optic',
  { skip: spawnSync('python3', ['--version']).status !== 0 && 'python3 not found' },
  () => {
    const py = `
import json, math, sys
exec(open(sys.argv[1]).read())
${FREE}
class Ctx(dict):
    def plane(self, seg, s, field, px, py):          # pupil, then a flat optic 100 mm on: free space throughout
        return free(s + (100.0 if seg == 1 else 0.0), field, px, py)
out = []
for params, seg in (({"optic": "pupil"}, 1), ({"optic": "previous"}, 0)):
    ctx = Ctx({"target": {"segment": seg, "s": 800.0}, "pupil": {"semi_diameter": 12.5, "beam_R": 0}, "field_unit": "deg",
               "wavelength_um": 0.633, "params": params, "surfaces": [{"name": "DM", "hit": [0.0, 100.0], "out_axis": [0.0, 1.0]}]})
    out.append(run(ctx))
print(json.dumps(out))`;
    const r = spawnSync('python3', ['-c', py, path.join(root, 'extensions/talbot.py')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const [after, before] = JSON.parse(r.stdout);
    assert.match(after.notes[0], /^from the entrance pupil: equivalent distance 900 mm, beam Ø 25 mm there/); // 100 + 800
    assert.match(before.notes[0], /^from the entrance pupil: equivalent distance 800 mm/); // 'previous' before the first surface
    assert.equal(after.notes[2], 'z = 0 (images of the entrance pupil): none after it');
  },
);

test(
  'Talbot in 3D: a fold that turns the beam about its axis changes nothing; an astigmatic path gives each ripple orientation its distance',
  { skip: spawnSync('python3', ['--version']).status !== 0 && 'python3 not found' },
  () => {
    const py = `
import json, math, sys
exec(open(sys.argv[1]).read())
${FREE}
def turned(q):                                   # the plane's axes turned 90° about the beam (a fold out of the plane)
    return {**q, "x": -q["y"], "y": q["x"], "dx": -q["dy"], "dy": q["dx"]}
class Fold(dict):
    def plane(self, seg, s, field, px, py):      # pupil, a fold 100 mm on, free space
        q = free(s + (100.0 if seg == 1 else 0.0), field, px, py)
        return turned(q) if seg == 1 else q
class Cyl(dict):
    def plane(self, seg, s, field, px, py):      # from the optic, y spreads as if 900/800 as far: an anamorphic path
        q = free(s if seg == 1 else 0.0, field, px, py)
        return {**q, "y": q["y"] + (0.125*s*q["dy"]/q["dz"] if seg == 1 else 0.0)}
base = {"pupil": {"semi_diameter": 12.5, "beam_R": 0}, "field_unit": "deg", "wavelength_um": 0.633,
        "surfaces": [{"name": "Fold", "hit": [0.0, 100.0], "out_axis": [0.0, 1.0]}]}
out = [run(Fold({**base, "target": {"segment": 1, "s": 800.0}, "params": {"optic": "pupil"}})),
       run(Cyl({**base, "target": {"segment": 1, "s": 800.0}, "params": {"optic": "previous"}}))]
print(json.dumps(out))`;
    const r = spawnSync('python3', ['-c', py, path.join(root, 'extensions/talbot.py')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const [fold, cyl] = JSON.parse(r.stdout);
    assert.match(fold.notes[0], /^from the entrance pupil: equivalent distance 900 mm, beam Ø 25 mm there/);
    assert.equal(fold.series.length, 1);
    assert.match(cyl.notes[0], /^from Fold: equivalent distance 850 mm \(800 to 900 by ripple orientation\)/);
    assert.deepEqual(
      cyl.series.map(x => x.label),
      ['z / z_T, ripples at 90°', 'z / z_T, ripples at 0°'],
    );
    const lam = 0.633e-3;
    cyl.series.forEach((x, k) =>
      x.x.forEach((f, n) =>
        assert.ok(Math.abs(x.y[n] - (lam * [900, 800][k] * (f / 25) ** 2) / 2) < 1e-9 * x.y[n]),
      ),
    );
    near(cyl.values['equivalent distance spread (mm)'], 100, 1e-6);
  },
);

test(
  'poppy_utils export: compound optics with stop, ABC-PSD error and ConicPhase; plain planes; reduced glass; detector',
  { skip: spawnSync('python3', ['--version']).status !== 0 && 'python3 not found' },
  () => {
    const py = `
import json, sys
exec(open(sys.argv[1]).read())
try:
    import tomllib
except ImportError:
    tomllib = None
class Ctx(dict):
    def plane(self, seg, s, field, px, py):          # a focused beam everywhere: NA 0.05, heights ~0 on the y axis
        return {"x": px, "y": py*1e-3, "dx": 0.0, "dy": 0.05 if py > 0 else -0.05, "dz": 1.0, "index": 1.0, "L": 0.0}
S = lambda name, typ, R, k, hit, n_in=1.0, n_out=1.0, ap=0, vertex=None: {"name": name, "type": typ, "R": R, "k": k, "n_in": n_in, "n_out": n_out,
    "semi_aperture": ap, "hit": hit, "vertex": vertex or hit, "axis": [0, 1], "out_axis": [0, -1] if typ == "mirror" or hit[1] < 300 else [0, 1]}
surfs = [S("OAP 1", "mirror", -1000, -1, [0, 300], vertex=[-150, 294.375]), S("Focus", "refract", 0, 0, [0, -200]),
         S("Lens", "refract", 100, 0, [0, -210], 1.0, 1.5), S("S2", "refract", -100, 0, [0, -216], 1.5, 1.0),
         S("Stop", "refract", 0, 0, [0, -236], ap=3), S("Det", "refract", 0, 0, [0, -336])]
ctx = Ctx({"name": "demo", "wavelength_um": 0.633, "fields": [0], "pupil": {"semi_diameter": 10, "beam_R": 0}, "surfaces": surfs, "params": {}})
out = run(ctx)
out["parsed"] = tomllib.loads(out["text"]) if tomllib else None
print(json.dumps(out))`;
    const r = spawnSync('python3', ['-c', py, path.join(root, 'extensions/poppy_toml.py')], {
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    const t = out.text;
    assert.equal(out.filename, 'demo_poppy.toml');
    assert.match(
      t,
      /\[wavefront\]\noptic_type = 'poppy.FresnelWavefront'\nwavelength = "633nm"\nnpix = 512\noversample = 4\nbeam_radius = "10mm"/,
    );
    assert.match(
      t,
      /optic_type = 'poppy.FresnelOpticalSystem'[^]*pupil_diameter = "20mm"[^]*beam_ratio = 0.25/,
    );
    assert.match(
      t,
      /name = "OAP 1"\nis_compound = true\ndz = "300mm"\n\[\[osys.optics.optics\]\]\nname = "OAP 1_stop"\noptic_type = 'poppy.CircularAperture'\nradius = "11mm"/,
    );
    assert.match(
      t,
      /name = "OAP 1_surface"\noptic_type = 'poppy_utils.ABCPSDWFE'\namp_params = \[4.7, 154, 2.7\][^\n]*\nwfe_params = \[4.7, 154, 2.7\][^\n]*\nwfe_rms = "9.4nm"[^\n]*\namp_rms = 0.07071067812/,
    );
    assert.match(
      t,
      /name = "OAP 1_power"\noptic_type = 'poppy_utils.ConicPhase'\nroc = "1000mm"\noad = "150mm"\nk = -1/,
    ); // concave: roc > 0
    assert.match(t, /name = "Focus"\ndz = "500mm"\noptic_type = 'poppy.ScalarTransmission'/);
    assert.match(
      t,
      /name = "Lens_surface"[^]*wfe_rms = "2.35nm"[^]*name = "Lens_power"[^\n]*\n[^\n]*\nroc = "400mm"\noad = "0mm"/,
    ); // |n'-n| x 4.7 nm; roc 2R/(n'-n)
    assert.match(t, /name = "S2"\nis_compound = true\ndz = "4mm" # 6 mm of index 1.5, reduced/);
    assert.match(t, /name = "S2_power"[^\n]*\n[^\n]*\nroc = "400mm"/);
    assert.match(
      t,
      /name = "Stop"\nis_compound = true\ndz = "20mm"\n\[\[osys.optics.optics\]\]\nname = "Stop_stop"\noptic_type = 'poppy.CircularAperture'\nradius = "3mm"\n\n/,
    );
    assert.match(
      t,
      /name = "Det"\ndz = "100mm"\noptic_type = 'poppy.Detector'\npixelscale = "3.165micron\/pixel"\nfov_pixels = 128\n$/,
    );
    assert.ok(!/Focus_power|Stop_surface|Det_stop/.test(t));
    if (out.parsed) {
      // valid TOML with the structure poppy_utils reads
      const o = out.parsed.osys[0].optics;
      assert.deepEqual(
        o.map(x => x.name),
        ['Pupil', 'OAP 1', 'OAP 1_power', 'Focus', 'Lens', 'Lens_power', 'S2', 'S2_power', 'Stop', 'Det'],
      );
      assert.deepEqual(
        o[1].optics.map(x => x.optic_type),
        ['poppy.CircularAperture', 'poppy_utils.ABCPSDWFE'],
      );
      assert.equal(out.parsed.wavefront.npix, 512);
    }
  },
);
