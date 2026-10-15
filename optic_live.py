#!/usr/bin/env python3
"""optic_live.py — drive Optic Sketch from Python (standard library only).

Optic Sketch can watch a system file and redraw whenever it changes, so any script that rewrites the file becomes a live
view. The file is the same JSON that File ▸ Save writes: {"fields", "rays", "grid", "lambda", "rows": [pupil, S1, …]},
each row with R, k, d, tilt, t, n, ap and optionally tiltY, clock, oa, solve, pivot and lock (the row format is described
at the top of src/engine/trace.js, and solves and locks in src/engine/solves.js). Solves and focus locks run in the
viewer on every change, so a script only sets the values it cares about. In a design with several configurations, "rows" is
the active one (src/engine/configs.js describes the rest of the format).

The viewer polls the file over http, the same way in every browser (Firefox, Safari, Chrome, Edge):
  • serve() (or `python3 optic_live.py serve file.json`) serves this folder and the file on localhost, and opens
    index.html?watch=… on it. Pages from other sites may read the watched file only (CORS), not the rest of the folder.
  • A viewer opened any other way (from disk, another server) can watch the URL serve() prints: File ▸ Watch file for changes.

    import optic_live as ol
    system = ol.read('live.json')
    ol.serve('live.json')                      # optional: serve the viewer and open it on this file
    for t in range(600, 900, 5):
        system['rows'][1]['t'] = t
        ol.write(system, 'live.json')         # atomic, so the viewer never reads a half-written file
        time.sleep(1/20)

From the command line:
    python3 optic_live.py serve my_system.json [--port 8000] [--no-browser]   # watch a file another script writes
    python3 optic_live.py demo [live.json] [--port 8000] [--no-browser]       # a Cassegrain, locked confocal, swept live
"""
import functools, http.server, json, math, os, sys, tempfile, threading, time, webbrowser

HERE = os.path.dirname(os.path.abspath(__file__))


def read(path):
    """The system in `path` as a dict."""
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def write(system, path):
    """Write `system` to `path` atomically (a temporary file in the same folder, then a rename)."""
    folder = os.path.dirname(os.path.abspath(path))
    fd, tmp = tempfile.mkstemp(dir=folder, prefix='.optic-', suffix='.json')
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        json.dump(system, f, indent=1)
    os.replace(tmp, path)


class _Handler(http.server.SimpleHTTPRequestHandler):
    """Serves this folder, plus the watched file at /live/<name> wherever it lives; nothing is cached. Only the watched
    file may be read by other sites' pages (CORS), so a viewer opened from disk or hosted elsewhere can watch it; the
    rest of the folder isn't theirs to read. Requests must be addressed to this computer (localhost), which keeps a
    site that points its own name at 127.0.0.1 ("DNS rebinding") out too."""
    watched = None

    def _is_live(self, path):
        return bool(self.watched) and path.split('?')[0] == '/live/' + os.path.basename(self.watched)

    def translate_path(self, path):
        return self.watched if self._is_live(path) else super().translate_path(path)

    def _local(self):
        host = (self.headers.get('Host') or '').strip().lower()
        host = host[1:host.index(']')] if host.startswith('[') and ']' in host else host.rsplit(':', 1)[0]
        return host in ('localhost', '127.0.0.1', '::1')

    def do_GET(self):
        if not self._local():
            return self.send_error(403, 'Optic Sketch serves only this computer (http://localhost)')
        super().do_GET()

    def do_HEAD(self):
        if not self._local():
            return self.send_error(403)
        super().do_HEAD()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        if self._is_live(self.path):
            self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def log_message(self, *args):
        pass


def serve(path, port=8000, browser=True):
    """Serve the viewer (this folder) and `path` on localhost in a background thread, and open the viewer watching it.
    Tries the next ports if `port` is busy. Returns the viewer URL; the file itself is at http://localhost:<port>/live/<name>."""
    handler = type('Handler', (_Handler,), {'watched': os.path.abspath(path)})
    for p in range(port, port + 20):
        try:
            server = http.server.ThreadingHTTPServer(('127.0.0.1', p), functools.partial(handler, directory=HERE))
            break
        except OSError:
            continue
    else:
        raise OSError(f'no free port in {port}–{port + 19}')
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f'http://localhost:{p}/index.html?watch=/live/{os.path.basename(path)}'
    print('Optic Sketch:', url, flush=True)
    print('Watched file:', f'http://localhost:{p}/live/{os.path.basename(path)}', flush=True)
    if browser:
        webbrowser.open(url)
    return url


def cassegrain(spacing=750.0, behind=150.0):
    """A Cassegrain whose secondary keeps F1 on the primary's focus and F2 on the focal plane by varying R and k.
    The focal plane sits `behind` mm behind the primary vertex."""
    return {'fields': [0, 0.1, -0.1], 'rays': 9, 'grid': 21, 'lambda': 0.55, 'view': 'rays', 'rows': [
        {'t': 500, 'ap': 100, 'R': 0},
        {'name': 'Primary', 'type': 'mirror', 'R': -2000, 'k': -1, 't': spacing},
        {'name': 'Secondary', 'type': 'mirror', 'R': 666.667, 'k': -2.77778, 't': spacing + behind,
         'lock': {'f1': {'at': 1, 'f': 1}, 'f2': {'at': 3}, 'vary': ['R', 'k']}},
        {'name': 'Focal plane'}]}


def _main():
    args = sys.argv[1:]
    opt = lambda flag, default: args[args.index(flag) + 1] if flag in args else default
    cmd = args[0] if args and args[0] in ('serve', 'demo') else 'demo'
    path = next((a for a in args if a.endswith('.json')), None)
    port, browser = int(opt('--port', 8000)), '--no-browser' not in args
    if cmd == 'serve':
        if not path or not os.path.exists(path):
            sys.exit('usage: python3 optic_live.py serve <existing file.json> [--port 8000] [--no-browser]')
        serve(path, port, browser)
        print(f'Serving; rewrite {path} from any script to update the view. Ctrl-C to stop.')
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            return
    path = path or 'live.json'
    write(cassegrain(), path)
    serve(path, port, browser)
    print(f'Sweeping the primary–secondary spacing in {path}; Ctrl-C to stop.')
    t0 = time.time()
    try:
        while True:
            spacing = 750 + 120*math.sin(2*math.pi*(time.time() - t0)/8)
            write(cassegrain(spacing), path)
            time.sleep(1/20)
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    _main()
