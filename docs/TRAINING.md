# Train your own AstroRoot model

Your roots don't look like the Arabidopsis training set? Train a model on **your own** images.
The network can't be trained inside a browser (it needs a GPU), so AstroRoot splits the work:

```
   in AstroRoot            in the cloud (free GPU)         back in AstroRoot
 ┌───────────────┐        ┌────────────────────┐        ┌──────────────────┐
 │ 1. label roots│  zip   │ 2. fine-tune RootNav│ .onnx  │ 3. load your model│
 │  export set   │ ─────► │    2.0 on your set  │ ─────► │  trace in your    │
 │               │        │                     │        │  style            │
 └───────────────┘        └────────────────────┘        └──────────────────┘
```

## 1 · Label (in AstroRoot → *Train your own model* tab)

1. Load a photo.
2. Trace each root: click along it (point by point), **double-click** (or *Finish root*) to end
   a root. Repeat for every root.
3. **Add this image to dataset.** Do several images (10–20+ is a reasonable start; more is
   better).
4. **Export training set (.zip)** — you get image + `.rsml` pairs, the exact format RootNav 2.0
   trains on, under `train/`.

## 2 · Train (in the cloud)

Use a free GPU notebook (Google Colab or a CyVerse VICE JupyterLab). Outline:

```python
# Colab / CyVerse — fine-tune RootNav 2.0 on your exported set
!git clone https://github.com/robail-yasrab/RootNav-2.0
%cd RootNav-2.0/training
!pip install -r ../inference/requirements.txt torch onnx

# upload astroroot_dataset.zip, then:
!unzip -o astroroot_dataset.zip -d OSR_Root_dataset_custom
# start from the Arabidopsis weights and fine-tune (fewer epochs, low LR)
!python train.py --dataset OSR_Root_dataset_custom --pretrained arabidopsis_plate \
                 --epochs 40 --lr 1e-4 --out my_model.pth

# export to ONNX exactly as in MODEL_CONVERSION.md
!python export_onnx.py --weights my_model.pth --out model.onnx
```

> The exact `train.py` flags depend on the RootNav 2.0 version — check its `training/README`.
> The key ideas are: **start from the Arabidopsis weights** (transfer learning needs far fewer
> labels than training from scratch) and keep the **learning rate low**.

Training 40 epochs on a small set is ~30–60 min on a free GPU. Download `model.onnx`.

## 3 · Use it (back in AstroRoot)

On the **Single** or **Batch** tab, choose **My own model (.onnx)…** and pick your file. Done —
AstroRoot now traces roots the way you labelled them.

## Tips

- **Consistency beats volume.** Trace roots the same way every time (e.g. always centre-line,
  always from base to tip).
- **Cover your variation.** Include your real lighting, media, and camera angles in the set.
- **Keep the marker in frame** so calibration is available at analysis time.
- Your labelled `.rsml` files are reusable — keep the exported zips as your growing gold set.
