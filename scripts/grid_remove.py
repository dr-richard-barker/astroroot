"""Reference implementation of AstroRoot's plate-grid remover (developed on the ABRS data).
The browser version in app.js (removeGrid/removeGridCore) is a direct port of this.

Method: white top-hat isolates thin bright features; a directional grayscale opening keeps only
the long axis-aligned ones (the etched grid); those are inpainted (horizontal lines filled
vertically, vertical lines horizontally). Deterministic — no training; periodic grids are better
removed this way. Whatever it misses, the GUI lets the user hand-correct.

Usage:  python grid_remove.py input.jpg output.jpg
"""
import sys
import numpy as np
from PIL import Image

def _maxf1d(a, k, axis):
    if k < 2: return a
    r = k // 2; out = a.copy()
    for s in range(1, r + 1):
        out = np.maximum(out, np.roll(a, s, axis)); out = np.maximum(out, np.roll(a, -s, axis))
    return out
def _minf1d(a, k, axis):
    if k < 2: return a
    r = k // 2; out = a.copy()
    for s in range(1, r + 1):
        out = np.minimum(out, np.roll(a, s, axis)); out = np.minimum(out, np.roll(a, -s, axis))
    return out
def _open1d(a, k, axis): return _maxf1d(_minf1d(a, k, axis), k, axis)
def _open2d(a, k):
    e = _minf1d(_minf1d(a, k, 0), k, 1); return _maxf1d(_maxf1d(e, k, 0), k, 1)

def detect_grid(g, w, h):
    th = np.clip(g - _open2d(g, 15), 0, None)              # white top-hat: thin bright features
    respH = _open1d(th, max(9, w // 7), 1)                 # horizontally elongated -> H grid lines
    respV = _open1d(th, max(9, h // 3), 0)                 # vertically elongated (long, to spare roots)
    def thr(r):
        v = r[r > 0]; return (v.mean() + 1.0 * v.std()) if v.size else 1e9
    return respH > thr(respH), respV > thr(respV)

def remove_grid(rgb):
    g = rgb.astype(np.float32).mean(2); h, w = g.shape
    gh, gv = detect_grid(g, w, h)
    out = rgb.astype(np.float32)
    for mask, axis in [(gh, 0), (gv, 1)]:                  # H lines fill vertically; V lines horizontally
        for c in range(3):
            ch = out[..., c]; valid = ~mask
            for _ in range(8):
                s1 = np.roll(ch, 1, axis); s2 = np.roll(ch, -1, axis)
                m1 = np.roll(valid, 1, axis); m2 = np.roll(valid, -1, axis)
                cand = np.where(m1 & m2, (s1 + s2) / 2, np.where(m1, s1, np.where(m2, s2, ch)))
                newv = mask & (m1 | m2) & ~valid
                ch = np.where(newv, cand, ch); valid = valid | newv
            out[..., c] = ch
    return np.clip(out, 0, 255).astype(np.uint8), (gh | gv)

if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]
    arr = np.asarray(Image.open(src).convert("RGB"))
    clean, mask = remove_grid(arr)
    Image.fromarray(clean).save(dst)
    print(f"grid pixels: {100 * mask.mean():.1f}%  ->  {dst}")
