# Optic Sketch

A browser sketchpad for quickly laying out optical systems: mirrors, lenses and off-axis conics, traced exactly in 3D,
with spots, footprints and wavefronts at any plane. Designs export to Zemax, batoid and optiland, and to a vector PDF
figure.

It is a sketchpad, not a design code: sketch here, then check the design properly in another tool. Bugs may abound!

**Try it:** https://kvangorkom.github.io/optic_sketch/

Press **H** in the app for the keys and a short guide to every feature.

## Running it

- **In a browser:** open `index.html`. Nothing to install or build.
- **Served locally:** `npm run serve` (or `python3 -m http.server`), then open http://localhost:8000. Served this way,
  the page also loads the Python scripts in `extensions/`.
- **As a desktop app:** `pip install pywebview`, then `python3 optic_app.py [design.json ...]`. This is the same page
  in a native window, where Save writes straight back to the file on disk. To package it as a double-clickable app:
  ```sh
  pyinstaller --windowed --name "Optic Sketch" --distpath app-dist --workpath app-build \
    --add-data "index.html:." --add-data "src:src" --add-data "extensions:extensions" optic_app.py
  ```
- **Driven from Python:** `python3 optic_live.py serve design.json` opens the page watching the file, so any script
  that rewrites the file updates the view. `optic_live.py` explains more.

Lengths are in mm, angles in degrees and wavelengths in µm.

## Layout

```
index.html          the page
src/engine/         the ray tracer and its analysis (no DOM; runs in Node too)
src/app/            the user interface: drawing, editing, popups, files, PDF export
extensions/         example Python extensions (see extensions/README.md)
optic_app.py        desktop app
optic_live.py       live view driven from a script
build.js            single-file build for GitHub Pages (dist/index.html)
tests/              node --test
```

## GitHub Pages

`.github/workflows/pages.yml` runs the tests on every push, then builds `dist/index.html` (one self-contained file)
and publishes it. To turn it on, go to **Settings ▸ Pages** and set **Source** to **GitHub Actions**. To try the build
locally, run `npm run build` and open `dist/index.html`.

## Tests

`npm test` needs Node 18 or newer. The suite cross-checks the tracer against [batoid](https://github.com/jmeyers314/batoid)
and [optiland](https://github.com/HarrisonKramer/optiland) when they are installed (`pip install batoid optiland`)
and skips those checks when they are not.
