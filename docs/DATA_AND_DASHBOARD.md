# Markers, data & the dashboard

## Scale & colour markers (PlantCV-compatible)

AstroRoot can auto-detect a **colour/scale card** in the frame and use it for *both* colour
normalisation *and* the pixel→cm scale — mirroring PlantCV's
[`detect_color_card`](https://docs.plantcv.org/en/stable/transform_detect_color_card/)
(`color_chip_size=…`). Pick the card in **Marker / scale**, then **Auto-detect**:

| Marker type | PlantCV equivalent | AstroRoot does |
|---|---|---|
| ColorChecker **Classic (24)** | `detect_color_card(color_chip_size="classic")` | detect grid, **full colour correction** to the 24 sRGB references + scale |
| **Passport / Mini / Nano / CameraTrax** | `color_chip_size="passport"/"mini"/"nano"/"cameratrax"` | detect grid, **grey-world white balance** + scale |
| **AstroCalibration Spectrum** | custom `color_chip_size` (mm) | same, with the AIRI sticker's chip pitch |
| **Size marker — known length** | [`report_size_marker_area`](https://docs.plantcv.org/en/stable/report_size_marker/) | click the marker's two ends, enter its length → scale |
| **Manual — 2 points** | — | click any two points a known distance apart |

**Scale** comes from the detected chip pitch: `px/cm = (card width ÷ columns) ÷ (chip pitch cm)`.
The chip-pitch mm field is pre-filled per card and **editable** — set it to your actual card so
the scale is correct. **Colour correction** fits detected chip colours toward references (Classic)
or greys the neutral chips (other cards) and is applied to the image before tracing.

> This is a PlantCV-**compatible** detector (same card families, same reference matrix), written
> in JavaScript so it runs in the browser. For byte-for-byte PlantCV output, run the Python
> `detect_color_card` path on the same image — the card types line up.

Detection is best-effort on a clean card against a plain background; if it can't find the card it
says so — use **Manual 2-pt** as the reliable fallback.

## Your data — saved on your device

Every analysis can be saved to a **local database** (the browser's IndexedDB) with **Save to
database** (single) or **Save all to database** (batch). Records hold the measurements, the
engine + marker used, the calibration, and a thumbnail. **Nothing leaves your device.**

- **Dashboard** (📊 in the nav, or `dashboard.html`): browse every saved measurement —
  summary stats, a length histogram, a tips-vs-length scatter, and a searchable, sortable table
  with per-row thumbnails and delete. Inspired by Nottingham's
  [RootNav-Viewer 2.0](https://github.com/robail-yasrab/RootNav-Viewer-2.0) (a Windows RSML
  browser), reimagined as a dependency-free web page.
- **Export**: CSV (for a spreadsheet/stats) or JSON (a full backup you can re-import on another
  machine). **Import** merges a JSON backup back in.

## "Our database" — the cloud option (a decision, not yet built)

AstroRoot is **local-first** by design: it matches the tool's promise that *student images stay
on the device*, and it needs no accounts or backend. A **shared/cloud database** (e.g. a class
or CoSE-wide store on cosecloud.com) is the natural next step but is a **separate decision**
because it means:

- standing up a backend (auth + storage API), and
- student measurements/thumbnails leaving the device — which needs a consent/privacy call.

The JSON export/import already makes the data portable, so a cloud sync can be layered on top
without changing how analysis works. **Tell us which backend** (Supabase, a CoSE API, Google
Sheets, …) and whether images may leave the device, and it can be wired in.
