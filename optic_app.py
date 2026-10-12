#!/usr/bin/env python3
"""Optic Sketch as a desktop app: the same index.html in a native window, with real access to your files.

    pip install pywebview                  (once; on Linux also a GUI backend, e.g. pip install "pywebview[qt]")
    python3 optic_app.py [design.json ...]

pywebview (https://pywebview.flowrl.com) shows the page in the operating system's own web view: WebKit on macOS, Edge
WebView2 on Windows, Qt or GTK WebKit on Linux. There is no bundled browser, so the app is this one file plus the page.
Inside it the page finds window.pywebview.api (the Api class below) and uses it instead of the browser's download-only
saving:

* Save writes straight back to the design's own file on disk; Save as, Open and the exports use the native dialogs.
* Designs named on the command line open in tabs.
* File > Watch file for changes follows a file on disk directly (no server).
* Extensions are read from the extensions folder next to this file.
* Closing the window with unsaved changes asks first.

Open designs, settings and extension settings are kept between runs (the page's storage lives in ~/.optic_sketch).
The window shows a copy of index.html with its scripts and stylesheet (src/) inlined, written to ~/.optic_sketch/app at
each start, so an update to any of them always takes effect together (the web view can't keep an old script cached).
Packaging as a double-clickable app is optional; the README gives the PyInstaller command.
"""
import base64
import os
import re
import socket
import sys
import tempfile
from pathlib import Path

ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))   # (a PyInstaller bundle unpacks to _MEIPASS)
PORT = 47361              # a fixed local port keeps the page's storage (open designs, settings) the same from run to run
STORAGE = Path.home() / ".optic_sketch"
DESIGN_TYPES = ("Optic Sketch design (*.json)", "All files (*.*)")


def _info(p, text=None):
    p = Path(p)
    out = {"path": str(p), "name": p.name, "dir": str(p.parent), "mtime": p.stat().st_mtime_ns}
    if text is not None:
        out["text"] = text
    return out


class Api:
    """What the page can ask of the app, as window.pywebview.api.<method>(...) returning a promise. Paths are absolute.
    A cancelled dialog returns None; errors (a file that can't be read or written) reject the promise with the message."""

    def __init__(self, files=()):
        self._window = None                          # the pywebview window (private: pywebview exposes public attributes)
        self._files = [str(Path(f).expanduser().resolve()) for f in files]

    def _dialog(self, kind, directory="", name=""):
        import webview
        kind = {"open": webview.FileDialog.OPEN, "save": webview.FileDialog.SAVE}[kind]
        r = self._window.create_file_dialog(kind, directory=directory or "", save_filename=name, file_types=DESIGN_TYPES if kind != webview.FileDialog.SAVE or name.endswith(".json") else ())
        if not r:
            return None
        return r if isinstance(r, str) else r[0]     # (a string or a sequence, depending on the platform)

    def startup_files(self):
        """The designs named on the command line, read once (then forgotten)."""
        files, self._files = self._files, []
        return [self.read(f) for f in files]

    def read(self, path):
        return _info(path, Path(path).read_text(encoding="utf-8"))

    def write(self, path, text):
        """Write text to path atomically (a temporary file in the same folder, then a rename), so a crash or a watcher
        never sees half a file."""
        p = Path(path)
        fd, tmp = tempfile.mkstemp(dir=p.parent, prefix=f".{p.name}.", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
                f.write(text)
            if p.exists():
                os.chmod(tmp, p.stat().st_mode & 0o777)
            os.replace(tmp, p)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise
        return _info(p)

    def open(self, directory=""):
        """Ask for a design to open; returns it (path, name, text) or None."""
        path = self._dialog("open", directory)
        return self.read(path) if path else None

    def save_as(self, name, text, directory=""):
        """Ask where to save a design (named name.json by default), then write it there."""
        path = self._dialog("save", directory, name)
        if not path:
            return None
        if not Path(path).suffix:
            path += ".json"
        return self.write(path, text)

    def save_bytes(self, name, data_b64, directory=""):
        """Ask where to save an export (a figure, a script, a .zmx), then write its bytes there."""
        path = self._dialog("save", directory, name)
        if not path:
            return None
        Path(path).write_bytes(base64.b64decode(data_b64))
        return _info(path)

    def changed(self, path, mtime):
        """For watching a file: the file again if it changed since mtime (ns), else None; {"missing": True} if it's gone."""
        try:
            st = Path(path).stat()
        except FileNotFoundError:
            return {"missing": True}
        return None if st.st_mtime_ns == mtime else self.read(path)

    def extensions(self):
        """Every .py in the extensions folder, as {file name: source}."""
        d = ROOT / "extensions"
        return {p.name: p.read_text(encoding="utf-8") for p in sorted(d.glob("*.py"))} if d.is_dir() else {}

    def log(self, message):
        """The page reports an error (shown there too); printed here, for a terminal or a bug report."""
        print(f"[page] {message}", file=sys.stderr, flush=True)

    def set_unsaved(self, names):
        """The page reports the designs with unsaved changes; closing the window then asks first."""
        w = self._window
        if w is None:
            return
        w.confirm_close = bool(names)
        if names:
            w.localization["global.quitConfirmation"] = f"Unsaved changes in {', '.join(names)}. Quit anyway?"


def page():
    """The page the window shows: index.html with every local script and stylesheet inlined (as build.js does for the
    hosted site), written to STORAGE/app/index.html at every start. One self-contained file, so the web view can never
    pair a new index.html with an older copy of a script from its cache (macOS's web view kept stale scripts otherwise)."""
    html = (ROOT / "index.html").read_text(encoding="utf-8")

    def inline(m):
        name, tag = (m.group(1), "script") if m.group(1) else (m.group(2), "style")
        text = (ROOT / name).read_text(encoding="utf-8")
        return m.group(0) if f"</{tag}" in text.lower() else f"<{tag}>\n{text}</{tag}>"

    # one pass over the page, so text inside an inlined file is never mistaken for a tag
    html = re.sub(r'<script src="([^":]+)"></script>|<link rel="stylesheet" href="([^":]+)"\s*/?>', inline, html)
    out = STORAGE / "app" / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    return out


def _port():
    """PORT if it's free, else any (a second copy of the app then keeps its own storage)."""
    with socket.socket() as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)    # as the server will: a port just released (TIME_WAIT) counts as free
        try:
            s.bind(("127.0.0.1", PORT))
            return PORT
        except OSError:
            return None


def main(argv=None, start=None):
    import webview

    args = list(sys.argv[1:] if argv is None else argv)
    debug = "--debug" in args
    api = Api([a for a in args if not a.startswith("--")])
    STORAGE.mkdir(exist_ok=True)
    window = webview.create_window("Optic Sketch", str(page()), js_api=api, width=1440, height=920,
                                   min_size=(760, 480), text_select=True)
    api._window = window
    webview.start(start, http_server=True, http_port=_port(), private_mode=False, storage_path=str(STORAGE), debug=debug)


if __name__ == "__main__":
    main()
