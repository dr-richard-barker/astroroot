# Converting RootNav 2.0's Arabidopsis model to ONNX

AstroRoot runs the RootNav 2.0 network **in the browser** via ONNX Runtime Web. RootNav 2.0
ships PyTorch weights; this is the one-time export to `models/arabidopsis.onnx`.

## Background

RootNav 2.0's network is a **stacked-hourglass CNN**
([`inference/models/hourglass.py`](https://github.com/robail-yasrab/RootNav-2.0/blob/master/inference/models/hourglass.py)).
It outputs a stack of heatmaps (seed locations, root tips, and a root-segmentation channel);
RootNav 2.0 then runs a classical path-search over those heatmaps to build per-root RSML.

For the AstroRoot MVP we export the **network only** and use its root-segmentation channel as a
mask (AstroRoot's own thinning/measurement takes it from there). Porting the full path-search
to JS is a later step — see the roadmap in the main README.

## Steps

```bash
# 1. Get RootNav 2.0 and its Arabidopsis weights
git clone https://github.com/robail-yasrab/RootNav-2.0
cd RootNav-2.0/inference
pip install -r requirements.txt torch onnx

# 2. Export (adapt the loader to the repo's current API — model_loader.py loads the weights
#    named in models/arabidopsis_plate.json)
python - <<'PY'
import torch, json
from models.model_loader import ModelLoader        # RootNav2's loader
model = ModelLoader.get_model('arabidopsis_plate', gpu=False)   # see arabidopsis_plate.json
model.eval()
dummy = torch.randn(1, 3, 512, 512)                 # AstroRoot feeds 512x512 RGB, 0..1, CHW
torch.onnx.export(
    model, dummy, "arabidopsis.onnx",
    input_names=["image"], output_names=["heatmaps"],
    opset_version=17, dynamic_axes=None)            # fixed 512 keeps ORT-Web fast
print("wrote arabidopsis.onnx")
PY

# 3. Drop it in
cp arabidopsis.onnx  <path-to>/astroroot/models/arabidopsis.onnx
```

## Match the output channel

`app.js → segmentOnnx()` currently takes the **last** output channel as the root map
(`const ch = C-1`). Confirm which channel is the root segmentation for the Arabidopsis model
(from `arabidopsis_plate.json` / the RootNav2 inference code) and set `ch` accordingly. If the
model emits logits rather than probabilities, apply a sigmoid before the `>0.5` threshold.

## Size & speed

- The hourglass net is a few tens of MB in ONNX — fine to serve from GitHub Pages; it loads
  once and caches.
- 512×512 inference is a second or two on a laptop via the WASM backend. For big batches on
  weak devices, consider the CyVerse/Docker path instead (see the AIRI write-up).
- To shrink/accelerate: export at opset 17, and optionally quantize to int8 with
  `onnxruntime.quantization` (test accuracy after).

## Licence

RootNav 2.0 is BSD-3-Clause. Its trained weights follow the upstream repo's terms — keep the
attribution in `NOTICE` and check the weights' licence before redistributing the `.onnx`.
