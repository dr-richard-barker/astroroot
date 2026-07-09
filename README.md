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
| **Batch** (many images → one CSV) | ✅ |
| **Classical baseline** (Otsu threshold + Zhang–Suen thinning) | ✅ works with no model |
| **Calibration** from the AstroCalibration marker (px → cm) | ✅ |
| **CSV / RSML / PNG export** | ✅ |
| **Train-your-own** (label → export dataset → cloud-train → re-import) | ✅ label + dataset export; training runs in the cloud |
| **Arabidopsis RootNav 2.0 model** (ONNX, in-browser) | ⏳ drops in once converted — see [`docs/MODEL_CONVERSION.md`](docs/MODEL_CONVERSION.md) |
| **Full RootNav2 seed/tip path-search → per-root RSML** | ⏳ roadmap |

The app is intentionally **useful before the neural net is wired up**: the classical baseline
gives real length/tips/branch/angle numbers immediately, and the ONNX model is a drop-in
upgrade that reuses the exact same measurement code on a cleaner mask.

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
| `index.html` | UI — Single / Batch / Train / About tabs |
| `app.js` | all logic — segmentation, thinning, measurement, exports, labelling, zip |
| `style.css` | light/dark theming |
| `models/` | drop `arabidopsis.onnx` here (see `docs/MODEL_CONVERSION.md`) |
| `docs/MODEL_CONVERSION.md` | export RootNav 2.0's Arabidopsis model to ONNX |
| `docs/TRAINING.md` | the label → cloud-train → re-import workflow |

## Attribution & licence

AstroRoot is **BSD-3-Clause**. It builds on two BSD-3-Clause works from the University of
Nottingham — **[RootNav 1](https://www.plant-image-analysis.org/software/rootnav)** (Pound et
al. 2013) and **[RootNav 2.0](https://github.com/robail-yasrab/RootNav-2.0)** (Yasrab et al.
2019). See [`NOTICE`](NOTICE). Model weights carry their upstream licence — check before
redistributing.
