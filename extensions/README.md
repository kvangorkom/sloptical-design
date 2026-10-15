# Extensions

Extensions are Python scripts that add tabs to the beam and surface popups, next to Footprint, Spot and WFE, or export formats to the File menu.
- **Where they come from:** every `.py` file in the `extensions` folder next to `index.html` is an extension.
  - **Served over http** (e.g. `python3 optic_live.py serve my_system.json`): the folder is read automatically when the page opens, and again with **Rescan extensions/** in **File ▸ Extensions…**. New, changed and deleted files are picked up.
  - **Opened from disk:** browsers don't let a page list a folder, so pick it once with **Load a folder…**. Its scripts are then remembered in this browser; pick it again after changing them.
  - **Elsewhere:** **Load .py…** adds single scripts from anywhere; they are remembered too.
  - Settings are kept per script.
- **Running:** they run on [Pyodide](https://pyodide.org), which is loaded from jsDelivr the first time a tab needs it (a few seconds) and checked against pinned hashes. The standard library is always there. numpy, scipy and the other Pyodide packages are fetched automatically when a script imports them, so they need internet access.
- **Sandboxed:** scripts run in a Web Worker of their own, with their own copy of the ray tracer. A script gets the `ctx` it's given and can use the internet, but it can't reach the page, what the page stores (other designs, other scripts), or the desktop app's files. `import js` there is the worker, not the page.
- **Still code:** load only scripts you trust, as you would any script you run. A script sees the design it's given and could send it somewhere.
- **Updates:** a tab re-runs when the design or its settings change while it is shown; the last result stays up meanwhile. An error shows its traceback in the tab.

## Writing one

A script defines:

| Name | Required | Meaning |
|---|---|---|
| `NAME` | yes | The tab's label. |
| `run(ctx)` | yes | Returns the plot (below). |
| `DESCRIPTION` | no | A tooltip and a line in the Extensions list. |
| `TARGETS` | no | `["beam", "surface"]` (the default), or just one: which popups get the tab. `["export"]` makes it an export instead (below). |
| `PARAMS` | no | Settings shown above the plot, e.g. `{"optic": {"label": "from", "type": "surface", "default": "previous"}}`. Types: `surface` (an optic's index, or `"previous"`; add `"pupil": True` to offer the entrance pupil too, as `"pupil"`), `number`, `choice` (with `options`), `bool`. |

`ctx` is a dict. Lengths are in mm, angles in degrees, and positions `[y, z]` are in the layout's frame (pupil at the origin, the axis starting along +z):
- **`wavelength_um`, `wavelengths_um`, `fields`, `field_unit`:** the primary wavelength, every wavelength (the primary first), the fields, and their unit, `"deg"` or `"mm"` (source heights).
- **`pupil`:** `semi_diameter` and `beam_R`, the incoming beam's radius of curvature (0 = collimated).
- **`surfaces`:** one per surface:
  - `index`, `name`, `type`
  - `R`, `k`, `off_axis` (always the height, mm), `normal_angle` (the parent's normal angle there, deg), `tilt`, `t`
  - `n_in`, `n_out`, `semi_aperture`
  - `vertex`, `axis`, `hit`, `out_axis`
  - `aoi_deg`, `foci`
- **`target`:** the popup's plane, perpendicular to the axis:
  - `kind` (`"beam"` or `"surface"`) and `surface`
  - `segment` and `s`: the plane is s mm along axis segment `segment`. Segment 0 runs from the pupil to the first surface, and segment k starts after surface k − 1 (0-based). A surface's plane is the one just before it.
  - `point`, `axis`, `after`
- **`footprint`:** per field, the grid rays on that plane:
  - `x`, `y`: position from the axis point
  - `dx`, `dy`, `dz`: direction cosines in the plane's frame
  - `pupil_x`, `pupil_y`: where each ray crossed the pupil
- **`name`, `system`:** the design's name (its file name) and the system JSON itself, as saved.
- **`params`:** the current settings.
- **`ctx.plane(segment, s, field, px, py)`** traces any ray from pupil point (px, py) of a field to any plane, returning `x, y, dx, dy, dz, index, L` (L is the optical path), or `None` if the ray is lost.
- **`ctx.trace(field, px, py)`** returns the ray's world state after every surface (`p`, `u`, `n`, `L`).

`run` returns a dict. Everything is optional:
- **`series`:** `[{"x": [...], "y": [...], "label": ..., "points": False}]`, drawn as lines (or as dots with `"points": True`). numpy arrays are fine.
- **Axes:** `xlabel`, `ylabel`, `xlog`, `ylog`, and fixed ranges `xlim` / `ylim` as `[lo, hi]` (either may be `None` for automatic; anything beyond is clipped).
- **Reference lines:** `hlines: [{"y": ..., "label": ...}]` and `vlines: [{"x": ...}]`.
- **Text:** `title` and `notes`, lines of text under the plot. Return only `notes` to show text alone.
- **`values`:** `{"name": number or text}`: values the watch window can track (Talbot returns its z/z_T at one cycle per beam, the equivalent distance, the beam diameter at the optic and the z_T/4 frequency).

**Export extensions** (`TARGETS = ["export"]`) appear in the File menu as **Export NAME…**. It opens a dialog with the script's settings and a preview of the file, with **Download** and **Copy** (the hosted viewer blocks downloads, so copy there). The script runs on the whole system: `ctx` has everything above except `footprint`, and `target` is `{"kind": "export"}`. `run` returns `{"filename": ..., "text": ..., "notes": [...]}`; the notes are listed above the preview.

## Examples

- `talbot.py`: a popup tab plotting the fractional Talbot distance z/z_T at the popup's plane against the spatial frequency of a ripple on a chosen optic.
- `poppy_toml.py`: **File ▸ Export poppy_utils (.toml)…**, a [poppy_utils](https://github.com/kvangorkom/poppy_utils) Fresnel model of the design, unfolded along the axis.
