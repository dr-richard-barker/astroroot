# 🛰️ AstroRoot

**Free, install-free root-image analysis for students and teachers.** Load a photo of
seedling roots and get real numbers — total length, tips, branch points, gravitropic angle —
plus CSV and RSML export. Everything runs in the browser: **student images never leave the
device.**

AstroRoot brings together the two RootNav tools:

- the **correct-by-hand** interactivity of **RootNav 1** (University of Nottingham), and
- the **automatic tracing** of **RootNav 2.0**'s deep-learning model,

into one page that works on a school Chromebook. Part of the
[AIRI](https://github.com/dr-richard-barker/AIRI) astrobotany program.

## What works today

| Feature | Status |
|---|---|
| **Single image** → traced overlay + measurements | ✅ |
| **Demo/test images** — NASA ABRS root timelapse (8 full plates + 10 single-root tiles) | ✅ Single picker + Batch "load demo set" |
| **Plate-grid removal** — deterministic morphological filter, live before/after preview | ✅ "remove plate grid" toggle (Single + Batch) |
| **Batch** (many images → one CSV) | ✅ |
| **Classical baseline** (Otsu threshold + Zhang–Suen thinning) | ✅ works with no model |
| **Regions of interest** — draw + name areas (e.g. genotypes) → per-region traits | ✅ measured separately, saved tagged for group comparison |
| **Multiple plants** — set N + mark each seed (root origin) → per-plant traits + seed→tip skew | ✅ auto-place or click; tagged by genotype region; per-plant replication |
| **Marker auto-detect** — colour card → colour-correction + scale (PlantCV-compatible) | ✅ Classic/Passport/Mini/Nano/CameraTrax/AstroCalibration + size + manual |
| **Local database** (IndexedDB) — save single/batch results on-device | ✅ |
| **archiDART-comparable RSA traits** from RSML — TRL, per-order lengths, hull, surface/volume, tortuosity, Fitter topology, H0 barcode | ✅ [`docs/ARCHIDART_PARITY.md`](docs/ARCHIDART_PARITY.md) |
| **Dashboard** — stats, charts, searchable table, per-record detail (root drawing + barcode), CSV/JSON export | ✅ `dashboard.html` |
| **Groups** — multi-select records → named groups + per-group summary + filter | ✅ Flight-vs-Ground / genotype comparisons |
| **Cloud sync** — pool measurements to Supabase (metadata only, RLS) | ✅ opt-in; keys stay in your browser |
| **CSV / RSML / PNG export** | ✅ |
| **Train-your-own** (label → export dataset → cloud-train → re-import) | ✅ label + dataset export; training runs in the cloud |
| **Arabidopsis RootNav 2.0 model** (ONNX, in-browser) | ✅ **ships in `models/`** — WebGPU (~1 s), WASM fallback |
| **Full RootNav2 seed/tip path-search → per-root RSML** | ⏳ roadmap (uses the segmentation mask for now) |

The app is **useful with or without a GPU**: the classical baseline gives real
length/tips/branch/angle numbers instantly, and the bundled RootNav 2.0 Arabidopsis model is a
drop-in upgrade that reuses the exact same measurement code on a cleaner mask. It runs via
**WebGPU** where available (~1 s) and falls back to **WASM** (slower — the app shows which
backend it used). Model weights are CC-BY-4.0 (see [`NOTICE`](NOTICE)).

## Run it

It's a static site — no build step.

```bash
cd astroroot
python -m http.server 8777        # then open http://localhost:8777
```

Or host the folder on GitHub Pages.

## How it works

```
photo ──► calibrate (marker) ──► segment ──► thin (skeleton) ──► measure
                                   │                               │
                        classical Otsu  OR                length, tips,
                        RootNav2 ONNX mask               branches, angle
```

- **segment** — the classical path auto-thresholds (Otsu, auto-inverts for dark-on-light or
  light-on-dark). The model path runs the RootNav 2.0 hourglass net via ONNX Runtime Web and
  thresholds its root-probability map. Both produce a binary mask.
- **thin** — Zhang–Suen thinning reduces the mask to a 1-pixel skeleton.
- **measure** — walks the skeleton: length = skeleton pixels ÷ (px/cm); **tips** = endpoints,
  **branches** = junctions (both clustered so one junction counts once); **angle** = mean
  deviation from vertical.

## Files

| File | What |
|---|---|
| `index.html` | UI — Single / Batch / Train / About tabs + marker & save controls |
| `app.js` | all logic — marker detect, segmentation, thinning, measurement, exports, labelling, zip |
| `db.js` | IndexedDB wrapper (shared by app + dashboard) |
| `cloud.js` | Supabase REST sync — metadata only, keys via localStorage |
| `rsml.js` | RSML parser + archiDART-comparable trait engine (nested roots, diameter, topology) |
| `samples/18_way_skew.json` | bundled sample dataset (53 RootNav skew plates) |
| `samples/stereotypes/*.rsml` | 5 extreme-stereotype architectures (archidart-style demo) |
| `samples/tictoc/*.rsml` | 24 TICTOC cotton root systems (Flight vs Ground, day 6) |
| `samples/images/*.jpg` | 8 NASA ABRS timelapse demo images + `tiles/` (10 single-root crops) |
| `scripts/grid_remove.py` | reference impl of the grid filter (developed on the ABRS data) |
| `docs/ARCHIDART_PARITY.md` | honest map of archiDART trait coverage |
| `supabase/schema.sql` | table + Row Level Security to run in your Supabase project |
| `dashboard.html` / `dashboard.js` | saved-results dashboard — stats, charts, table, export |
| `style.css` | light/dark theming |
| `docs/DATA_AND_DASHBOARD.md` | marker types (PlantCV parity), database & dashboard, cloud option |
| `models/` | drop `arabidopsis.onnx` here (see `docs/MODEL_CONVERSION.md`) |
| `docs/MODEL_CONVERSION.md` | export RootNav 2.0's Arabidopsis model to ONNX |
| `docs/TRAINING.md` | the label → cloud-train → re-import workflow |

## Attribution & licence

AstroRoot is **BSD-3-Clause**. It builds on two BSD-3-Clause works from the University of
Nottingham — **[RootNav 1](https://www.plant-image-analysis.org/software/rootnav)** (Pound et
al. 2013) and **[RootNav 2.0](https://github.com/robail-yasrab/RootNav-2.0)** (Yasrab et al.
2019). See [`NOTICE`](NOTICE). Model weights carry their upstream licence — check before
redistributing.
