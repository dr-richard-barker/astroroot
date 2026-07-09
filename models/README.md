# Models

Drop the RootNav 2.0 Arabidopsis model here as **`arabidopsis.onnx`**, and the tool's
"Arabidopsis (RootNav 2.0, ONNX)" option will use it. Until then, the app falls back to the
classical baseline automatically.

See [`../docs/MODEL_CONVERSION.md`](../docs/MODEL_CONVERSION.md) for how to export it from the
upstream PyTorch weights. Custom models trained via [`../docs/TRAINING.md`](../docs/TRAINING.md)
are loaded through the "My own model (.onnx)…" picker and don't need to live here.
