# AstroRoot — hands-on tutorial

A task-by-task walkthrough of every AstroRoot feature, written to be read start-to-finish or
dipped into. Each section is a short workflow you can do in a browser in a few minutes.

> **New here? Start with the synthetic examples.** The bundled NASA/ABRS demo photos are real
> plates — great for showing what the tool does on messy data, but they curve, glare and carry
> plate-grid lines, so there is no single "right" number to check against. The **synthetic demo
> roots** are the opposite: a clean, high-contrast shape drawn at a known scale, so the numbers
> the app reports can be checked against an **exact expected answer**. Learn the controls on those
> first, then move to real images.

**Contents**

1. [Run it locally](#1-run-it-locally)
2. [The 60-second first run (synthetic straight root)](#2-the-60-second-first-run-synthetic-straight-root)
3. [Calibration — turning pixels into centimetres](#3-calibration--turning-pixels-into-centimetres)
4. [Reading the measurements (and the synthetic "known answer")](#4-reading-the-measurements-and-the-synthetic-known-answer)
5. [Choosing a model: classical vs RootNav 2.0](#5-choosing-a-model-classical-vs-rootnav-20)
6. [Cleaning the image: plate-grid removal](#6-cleaning-the-image-plate-grid-removal)
7. [Manual tracing (RootNav 1-style), Route, Refine, Smooth](#7-manual-tracing-rootnav-1-style-route-refine-smooth)
8. [Regions of interest — per-genotype traits](#8-regions-of-interest--per-genotype-traits)
9. [Multiple plants & seed markers — per-plant traits + skew](#9-multiple-plants--seed-markers--per-plant-traits--skew)
10. [The summary report](#10-the-summary-report)
11. [Batch processing & timelapses](#11-batch-processing--timelapses)
12. [Saving, the dashboard & groups](#12-saving-the-dashboard--groups)
13. [RSML & archiDART-comparable traits](#13-rsml--archidart-comparable-traits)
14. [Using archiDART's own example roots](#14-using-archidarts-own-example-roots)
15. [Train your own model](#15-train-your-own-model)
16. [Cloud sync (optional)](#16-cloud-sync-optional)
17. [Regenerating the synthetic examples](#17-regenerating-the-synthetic-examples)

---

## 1. Run it locally

It's a static site — no build step.

```bash
cd astroroot
python -m http.server 8777      # then open http://localhost:8777
```

Or just open the GitHub Pages copy: <https://dr-richard-barker.github.io/astroroot/>. Everything
runs in your browser; images never leave the device.

---

## 2. The 60-second first run (synthetic straight root)

1. Open the app on the **Single image** tab.
2. Under **2 · Photo**, open the demo picker (**— or a demo image —**). At the top, under
   **"Synthetic — clean, known answer"**, choose **▸ Synthetic: straight root** and press **Load**.
3. Leave **1 · Model** on *Quick estimate (classical)* — it works with no GPU.
4. Press **4 · Run → Trace roots**.

You'll see a coloured overlay on the root and four numbers in **Measurements**. Because this image
is synthetic, you know what they *should* be — see §4. This is also the fastest way to confirm the
app is working end-to-end (segment → thin → measure).

The straight root is the simplest possible check: **one vertical primary, 10.00 cm long**. The
fishbone (next) adds branch points and laterals.

---

## 3. Calibration — turning pixels into centimetres

Without a scale, results come out in **pixels**. The synthetic images are drawn at exactly
**100 px/cm** — and, on purpose, carry **no drawn scale bar or text** (a separate mark like that gets
segmented as an extra "root" and pollutes the counts). Instead the root's **own known length** is the
ruler:

**Manual — click 2 points**

1. In **3 · Marker / scale**, leave the type on **Manual — click 2 points**.
2. Click **Manual 2-pt**, then click the **top** of the primary root, then its **bottom tip**.
3. When prompted for the distance, enter the primary's known length in mm:
   **100** for the straight root, **80** for the fishbone.
4. The status reads `calibrated: 100.0 px/cm`. Now press **Trace roots** — lengths are in cm.

**Colour card (PlantCV-compatible)** — for real photos that include a ColorChecker/Passport/Nano/
CameraTrax/AstroCalibration card: pick the card type, press **Auto-detect**. AstroRoot finds the
card, colour-corrects the image, and derives px/cm from the known chip pitch (editable under
*chip pitch (mm)*). This mirrors PlantCV's `detect_color_card`.

**Size marker — known length** — if you photographed a ruler or a known-length object, pick this and
click its two ends.

> Tip: calibrate **before** you press *Trace roots*. If you calibrate after, just press *Trace roots*
> again to re-measure in cm.

---

## 4. Reading the measurements (and the synthetic "known answer")

The **Measurements** panel reports four core traits:

| Trait | What it is | How it's computed |
|---|---|---|
| **Total root length** | sum of all root length | skeleton pixel count ÷ (px/cm) |
| **Root tips** | number of skeleton **endpoints** | degree-1 skeleton pixels, clustered |
| **Branch points** | number of junctions | degree-≥3 skeleton pixels, clustered |
| **Mean angle from vertical** | a gravitropic/curvature proxy | mean local deviation from vertical |

**Known answers for the synthetic images** (classical model, calibrated to 100 px/cm):

| Image | Total length | Root tips (endpoints) | Branch points |
|---|---|---|---|
| `synthetic_straight_root` | **10.00 cm** | **2** (1 growing tip + the seed end) | **0** |
| `synthetic_fishbone` | **20.00 cm** (8 cm primary + 6 × 2 cm laterals) | **8** (7 growing tips + the seed end) | **6** |

Verified with the bundled classical engine: the straight root reads **997 px** (≈10.00 cm), the
fishbone **1987 px, 8 tips, 6 branches** — within ~1 % of the exact answer. Two things to know so the
numbers make sense:

- **The seed (top) end counts as a tip.** "Root tips" is the raw number of skeleton endpoints, so a
  single unbranched root reports **2** endpoints, not 1. On the fishbone: 7 growing tips + 1 seed end
  = 8.
- **Length is measured along the skeleton in pixels.** Vertical/horizontal strokes measure exactly;
  strongly diagonal strokes read ~30 % short (a known limitation of pixel-count length). The
  synthetic images are axis-aligned on purpose so their length is exact — real, curvy roots are
  approximate by nature.

Load **▸ Synthetic: fishbone** and calibrate it the same way to see all four traits exercised at once.

---

## 5. Choosing a model: classical vs RootNav 2.0

**1 · Model** offers three engines:

- **Quick estimate (classical)** — Otsu auto-threshold + Zhang–Suen thinning. No download, no GPU,
  works instantly. Great for clean images (like the synthetic ones) and as a baseline.
- **Arabidopsis (RootNav 2.0, ONNX)** — the bundled deep-learning segmentation model
  (`models/arabidopsis.onnx`). It produces a cleaner root mask on messy photos, then reuses the exact
  same measurement code. Runs via **WebGPU** (~1 s) where available, falling back to **WASM**
  (slower); the app shows which backend it used.
- **My own model (.onnx)…** — load a model you trained yourself (see §15).

On the synthetic images the two engines agree closely because the shape is already clean — that's a
good way to sanity-check the model path.

---

## 6. Cleaning the image: plate-grid removal

Real ABRS plates have a printed grid that the classical threshold can mistake for roots. Tick
**remove plate grid** (Single tab) or **remove plate grid** (Batch tab) to run a deterministic
morphological filter, with a live before/after preview. Try it on a **NASA ABRS timelapse** demo
image to see the grid lines disappear. (The synthetic images have no grid, so the toggle does
nothing there — which is the point of a clean example.)

---

## 7. Manual tracing (RootNav 1-style), Route, Refine, Smooth

When you want full control — or to correct an auto-trace — use the **🖉 Manual trace** tools. Load
the **fishbone** to practise, since you know the true structure.

1. Click **🖉 Manual trace** to reveal the tools.
2. **＋ Root** — click along a root to lay nodes; the first click on an **existing** root starts a
   **lateral branch** from it. Drag a node to adjust; insert/delete nodes as needed.
3. **⟿ Route** (live-wire, NeuronJ-style) — click a start, move the cursor and the path **snaps
   along the root** via a live A\* search; click to commit, hold **Shift** for a straight segment.
4. **Refine** (SmartRoot-style) — snaps your nodes onto the root's **centre-line** and measures
   **per-node width** → mean diameter, surface area, volume.
5. **Smooth** — fits a spline through the nodes for clean, curved roots.
6. **Edit nodes** / **From auto** (seed the editor from the automatic trace) / **Measure** / **RSML**
   (export the trace) / **Clear**.

**Measure** gives you trace-based totals (roots, length, tips, laterals, mean skew); **RSML** exports
the trace as RSML you can analyse elsewhere or load into the Dashboard.

---

## 8. Regions of interest — per-genotype traits

To compare areas of one plate (e.g. one box per genotype):

1. Click **✏️ Draw region**, drag a box, name it (e.g. `Col-0`). Repeat for each area.
2. Press **Trace roots**. Each region is measured **separately** and listed under **Per-region**.
3. **💾 Save regions to database** tags each result with its region name for group comparison later.

---

## 9. Multiple plants & seed markers — per-plant traits + skew

For a plate with several seedlings:

1. Set **plants** to N.
2. **🌱 Auto-place** to drop N seed markers automatically, or **Place seeds** to click each seed
   (the root's origin) yourself; **Clear** to redo.
3. Press **Trace roots**. Each plant gets its own traits under **Per-plant**, plus a **seed→tip
   skew** angle (how far the tip drifts sideways from straight-down under the seed).
4. If plants sit inside named regions (§8), each plant is tagged by genotype for replication.
5. **💾 Save plants to database**.

---

## 10. The summary report

After a run, the **Summary report** bar appears:

- **Preview** renders a self-contained HTML report — measurements, per-region and per-plant figures,
  and the traced image.
- **📄 Download report (HTML)** saves it. Open it in any browser, or print to PDF for a lab notebook
  or a class handout.

---

## 11. Batch processing & timelapses

**Batch (folder)** turns many images into one CSV.

1. Choose a **Model** and, optionally, a **Scale (px per cm)** to get cm for the whole batch.
2. **Images** — pick a folder of files, or press **Load demo set (8)** to load the ABRS timelapse.
3. **Process all** → a results table (Image, Length, Tips, Branches, Angle).
4. **💾 Save all to database** / **Download results CSV**.

**Across a timelapse:** if you set up **regions** and **seed markers** on the Single tab first, Batch
applies the *same* regions/seeds to every frame, producing a **per-plant × frame time-series** grouped
by genotype and stamped by frame — ready for growth-rate plots in the Dashboard.

---

## 12. Saving, the dashboard & groups

Everything you save goes to a **local IndexedDB** on your device. Open **📊 Dashboard** to work with it:

- **Stats** tiles, a **root-length distribution** chart, an **angle/skew** chart, and (for timelapses)
  a **growth trajectory** chart and a **root-depth-distribution** chart.
- A **searchable table**; click any row for a **detail view** with the root drawing and its **H0
  persistence barcode**.
- **Groups** — multi-select records → **Group selected…**, name the group (e.g. *Flight* vs *Ground*,
  or genotype), get a per-group summary, and filter by group. This is the Flight-vs-Ground comparison
  workflow.
- **Export CSV / JSON (backup)**, and **Import JSON** to restore.

The dashboard's **sample datasets** picker (top-left) can load bundled demos to explore without any of
your own data — including the **Synthetic fishbone (known answer)** (see §13).

---

## 13. RSML & archiDART-comparable traits

AstroRoot parses **RSML** (RootNav/RSML: nested `<root>` = branching order, optional diameter
function) and computes the static 2D root-system-architecture traits that
[archiDART](https://archidart.github.io/)'s `architect()` reports — TRL, per-order lengths, hull,
surface/volume, tortuosity, Fitter topology indices, and a simplified H0 persistence barcode. See
[`ARCHIDART_PARITY.md`](ARCHIDART_PARITY.md) for the honest coverage map.

**Check it against a known answer.** In the **Dashboard**, set the sample picker to **Synthetic
fishbone (known answer)** and press **🌱 Load**, then open the record's detail view. Expected traits
(the RSML is the *same* geometry as `synthetic_fishbone.png`):

| Trait | Expected |
|---|---|
| **TRL** (total root length) | **20.00 cm** |
| **L1R** (order-1 / primary length) | 8.00 cm |
| **TN1R** (number of order-1 roots) | 1 |
| **TNLR** (number of laterals) | 6 |
| **Magnitude** (terminal roots / tips) | 6 |
| **Max branching order** | 2 |
| **Mean primary angle from vertical** | ~0° |

> Note the two "tip" conventions: the **image** pipeline (§4) counts skeleton **endpoints**, so it
> reports 8 (7 tips + seed end); the **RSML** pipeline counts **terminal roots** (magnitude), so it
> reports 6 laterals as the tips. Same root system, two definitions — both correct.

You can also export RSML from a manual trace (§7) or import your own via **Import RSML** on the
Dashboard.

---

## 14. Using archiDART's own example roots

[archiDART](https://github.com/archidart/archidart) is an **analysis** package (R) — it reads root
architectures, it doesn't draw images — so it's not a source of demo *photos*. But it ships a clean,
**ArchiSimple-simulated** synthetic root system as RSML, which AstroRoot reads directly:

- **File:** [`monocot-archisimple.rsml`](https://github.com/archidart/archidart/blob/master/inst/extdata/monocot-archisimple.rsml)
  (a 45-root simulated monocot; `unit=inch`, `resolution=300` — AstroRoot handles both).
- **How to load it:** download the raw file, then in the **Dashboard** use **Import RSML** and pick it.
  It appears as a record with full archiDART-comparable traits.

> **Licensing:** archiDART is **GPL-2**, so its example files are **not** bundled into this
> BSD-3-Clause repo — download them from the archiDART repository yourself. The other files in
> archiDART's `inst/extdata` (`ch7.rac/.lie/.tps`) are the older **DART** text format, which AstroRoot
> does not parse — use the `.rsml` one.

This pairs nicely with AstroRoot's own BSD synthetic RSML (§13) and the `samples/stereotypes/*.rsml`
extreme-architecture demos: between them you can exercise the trait engine on a known-answer shape, on
a realistic simulated system, and on deliberately extreme architectures.

---

## 15. Train your own model

The neural net can't train in the browser (no GPU), so AstroRoot splits the job:

1. **Label roots** — on the **Train** tab, load a photo and click along each root (double-click to
   finish). Each trace is saved as an RSML polyline.
2. **Build the training set** — **Add this image to dataset**, repeat, then **Export training set
   (.zip)** — image + RSML pairs, the format RootNav 2.0 trains on.
3. **Train in the cloud** — open the [training guide](TRAINING.md), upload your zip to a free
   Colab/CyVerse GPU notebook (~30–60 min); it fine-tunes the model and returns `model.onnx`.
4. **Use it** — back on Single/Batch, choose **My own model (.onnx)…** and pick your file.

---

## 16. Cloud sync (optional)

On the Dashboard, expand **☁️ Cloud sync (Supabase)** to pool **metadata only** (not images) to a
Supabase table you control, protected by Row-Level Security. Keys stay in your browser's
localStorage. It's opt-in; see [`DATA_AND_DASHBOARD.md`](DATA_AND_DASHBOARD.md) and
[`../supabase/schema.sql`](../supabase/schema.sql).

---

## 17. Regenerating the synthetic examples

The synthetic roots are generated by a small script (Pillow), so you can tweak the geometry or add
your own known-answer shapes:

```bash
pip install Pillow
python scripts/gen_synthetic_root.py
```

It writes to `samples/synthetic/`:

- `synthetic_straight_root.png` — one vertical primary, 10.00 cm.
- `synthetic_fishbone.png` — primary + 6 laterals, 20.00 cm total, 6 branch points.
- `synthetic_fishbone.rsml` — the same fishbone as RSML, for the archiDART-style trait engine.
- `index.json` — labels + the ground-truth answer for each file.

Design choices that make the answers exact are documented at the top of the script: axis-aligned
strokes (so pixel-count length = real length), a fixed 100 px/cm scale (calibrate on the root's own
known length — no drawn bar to pollute the counts), and a plain high-contrast background (so there
are **no artifacts** for the segmenter to trip on).
