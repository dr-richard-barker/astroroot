# The Arabidopsis model (RootNav 2.0 → ONNX)

AstroRoot ships with `models/arabidopsis.onnx` — the RootNav 2.0 `arabidopsis_plate` model
exported to ONNX and run in the browser via ONNX Runtime Web. **This is already done**; this
page documents how, so you can reproduce it or export other RootNav 2.0 models (wheat, OSR).

The reproducible export script is [`scripts/export_onnx.py`](../scripts/export_onnx.py).

## Verified spec (from `arabidopsis_plate.json`)

| | Value |
|---|---|
| Architecture | stacked hourglass, `HourglassNet(num_classes=6)` |
| Weights | `arabidopsis_plate-ea874d94.pth` (17 MB) from `cvl.cs.nott.ac.uk` |
| **Input** | `[1,3,1024,1024]`, RGB, **RAW 0–255** (scale=1 — *not* divided by 255), CHW |
| **Output** | `[1,6,512,512]` |
| Channels | seg: **Background=0, Primary=1, Lateral=3**; heatmaps: Primary=2, Lateral=4, Seed=5 |
| Root mask | a pixel is root where `Primary>Background` **or** `Lateral>Background` |
| Model licence | **CC-BY-4.0** (redistributable with attribution — see `NOTICE`) |

These are exactly the values wired into `app.js → segmentOnnx()`.

## How it was exported

```bash
git clone https://github.com/robail-yasrab/RootNav-2.0
cd RootNav-2.0/inference/models
pip install torch onnx onnxruntime
curl -L -o arabidopsis_plate.pth \
  https://cvl.cs.nott.ac.uk/resources/trainedmodels/arabidopsis_plate-ea874d94.pth
python export_onnx.py            # the copy in astroroot/scripts/export_onnx.py
```

`export_onnx.py` builds `hg()`, loads the weights (`convert_state_dict` strips the DataParallel
`module.` prefix), **unwraps the hourglass forward's list output** to its last tensor, and
exports at opset 17 with a dynamic batch axis.

## How it was validated

- **Numerical fidelity:** ONNX vs PyTorch on the same input → **100 % argmax agreement**
  (max logit diff ~0.02, which changes no segmentation decision).
- **Detection:** on a real spaceflight Arabidopsis root frame with raw 0–255 input, the root
  channels activate and the Seed heatmap peaks (≈4.3); with 0–1 input it produces nothing —
  confirming the raw-0–255 requirement.

## Performance — WebGPU vs WASM

The 1024² hourglass is heavy. AstroRoot requests the **WebGPU** execution provider first
(≈1 s on a real GPU) and falls back to **WASM** if WebGPU is unavailable. WASM is
single-threaded on GitHub Pages (no COOP/COEP for threads), so the first WASM run can take tens
of seconds — the app labels the backend and warns. For WASM-only devices or big batches, prefer
the **classical baseline** or the cloud/Docker path.

> The full RootNav 2.0 pipeline also runs a CRF + A\* path-search over the heatmaps to build
> per-root RSML. AstroRoot currently uses only the segmentation mask (then its own
> thinning/measurement); porting the path-search to JS is on the roadmap.

## Licence

RootNav 2.0 code is BSD-3-Clause; the `arabidopsis_plate` **weights are CC-BY-4.0** (its
training dataset is CC-BY-NC-4.0). Attribution is in [`../NOTICE`](../NOTICE).
