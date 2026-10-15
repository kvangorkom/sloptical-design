// The desktop app's file API (optic_app.Api), in CPython with a stand-in for pywebview: atomic writes, Save as and export
// dialogs, watching, the extensions folder and the unsaved-changes guard, and that the page reaches only files you chose.
// The window itself (pywebview) isn't needed.
// Skipped when python3 isn't installed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');

test(
  'desktop app API: write in place, Save as, exports, watching, extensions, close guard',
  { skip: spawnSync('python3', ['--version']).status !== 0 && 'python3 not found' },
  () => {
    const py = `
import base64, enum, json, os, sys, tempfile, types, pathlib
wv = types.ModuleType('webview')
class FileDialog(enum.IntEnum):
    OPEN = 10; FOLDER = 20; SAVE = 30
wv.FileDialog = FileDialog; sys.modules['webview'] = wv
sys.path.insert(0, sys.argv[1]); import optic_app
tmp = pathlib.Path(tempfile.mkdtemp()); out = {}
st = pathlib.Path(tempfile.mkdtemp()); optic_app.STORAGE = st / 'store'  # (remembered files: not in your home folder)
class Win:                                            # answers dialogs like a user would
    confirm_close = False
    def __init__(self): self.localization = {}; self.asked = []
    def create_file_dialog(self, kind, directory='', allow_multiple=False, save_filename='', file_types=()):
        self.asked.append([int(kind), directory, save_filename, list(file_types)])
        return None if save_filename == 'cancel.json' else (str(tmp / 'chosen') if kind == FileDialog.SAVE else (str(tmp / 'a.json'),))
f = tmp / 'a.json'; f.write_text('{"rows": [1]}'); os.chmod(f, 0o640)
api = optic_app.Api([str(f)]); api._window = w = Win()
out['startup'] = [x['name'] for x in api.startup_files()]; out['again'] = api.startup_files()
r = api.write(str(f), '{"rows": [2]}'); out['write'] = [json.loads(f.read_text())['rows'], r['name'], oct(f.stat().st_mode & 0o777), sorted(p.name for p in tmp.iterdir())]
out['open'] = api.open(str(tmp))['text']
out['saveas'] = api.save_as('a.json', '{"rows": [3]}', str(tmp))['name']; out['saved'] = (tmp / 'chosen.json').read_text()
out['cancel'] = api.save_as('cancel.json', 'x')
out['bytes'] = api.save_bytes('fig.pdf', base64.b64encode(b'%PDF-x').decode())['name']; out['pdf'] = (tmp / 'chosen').read_bytes().decode()
out['types'] = [a[3] for a in w.asked]
m = f.stat().st_mtime_ns; out['unchanged'] = api.changed(str(f), m); out['changed'] = api.changed(str(f), 0)['text']
# only your files: nothing else can be read, and saving elsewhere asks (the Save dialog, offering that name and folder)
secret = tmp / 'secret.txt'; secret.write_text('key')
try: api.changed(str(secret), 0); out['refused'] = False
except PermissionError: out['refused'] = True
out['noread'] = [hasattr(api, k) for k in ('read', '_read')]
n = len(w.asked); r = api.write(str(tmp / 'other.json'), '{"rows": [4]}')
out['redirect'] = [r['name'], (tmp / 'other.json').exists(), w.asked[n][1:3], (tmp / 'chosen.json').read_text()]
out['cancelwrite'] = [api.write(str(tmp / 'cancel.json'), 'x'), (tmp / 'cancel.json').exists()]
api2 = optic_app.Api([]); api2._window = w        # the next run remembers what you opened and saved
out['remembered'] = [api2.changed(str(f), 0)['name'], api2.changed(str(tmp / 'chosen.json'), 0)['name'], json.loads((st / 'store' / 'files.json').read_text())[-1].endswith('chosen.json')]
f.unlink(); out['missing'] = api2.changed(str(f), 0)
out['ext'] = sorted(api.extensions())
api.set_unsaved(['x.json', 'y.json']); out['guard'] = [w.confirm_close, w.localization['global.quitConfirmation']]
api.set_unsaved([]); out['guard2'] = w.confirm_close
optic_app.STORAGE = tmp / 'store'; pg = optic_app.page(); html = pg.read_text()
out['page'] = [str(pg.relative_to(tmp)), '<script src=' in html or 'href="src/' in html, 'const heldD' in html, 'function pdfDoc' in html, '<style>' in html, html.count('<script') > 20]
out['tmp'] = str(tmp)
print(json.dumps(out))`;
    const r = spawnSync('python3', ['-c', py, root], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const o = JSON.parse(r.stdout);
    assert.deepEqual(o.startup, ['a.json']);
    assert.deepEqual(o.again, []); // command-line files, once
    assert.deepEqual(o.write, [[2], 'a.json', '0o640', ['a.json']]); // in place, mode kept, no temporary left
    assert.equal(o.open, '{"rows": [2]}');
    assert.equal(o.saveas, 'chosen.json');
    assert.equal(o.saved, '{"rows": [3]}');
    assert.equal(o.cancel, null); // .json added; cancel: nothing
    assert.equal(o.bytes, 'chosen');
    assert.equal(o.pdf, '%PDF-x');
    assert.deepEqual(
      o.types.map(t => t.length > 0),
      [true, true, true, false],
    ); // design filters for designs only
    assert.equal(o.unchanged, null);
    assert.equal(o.changed, '{"rows": [2]}');
    assert.deepEqual(o.missing, { missing: true });
    assert.equal(o.refused, true); // a file that wasn't opened or saved here can't be read
    assert.deepEqual(o.noread, [false, true]); // (no read(path) for the page)
    // a file not opened here: the Save dialog (its folder and name offered); the choice is written, not that file
    assert.deepEqual(o.redirect, ['chosen.json', false, [o.tmp, 'other.json'], '{"rows": [4]}']);
    assert.deepEqual(o.cancelwrite, [null, false]);
    assert.deepEqual(o.remembered, ['a.json', 'chosen.json', true]);
    assert.ok(o.ext.includes('talbot.py') && o.ext.includes('poppy_toml.py'));
    assert.deepEqual(o.guard, [true, 'Unsaved changes in x.json, y.json. Quit anyway?']);
    assert.equal(o.guard2, false);
    assert.deepEqual(o.page, ['store/app/index.html', false, true, true, true, true]); // one self-contained page: scripts and stylesheet inlined
  },
);
