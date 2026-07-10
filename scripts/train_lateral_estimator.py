"""PRIMAL-style ML hidden-trait estimator for AstroRoot.
Generate a synthetic root library (known n_laterals / lateral angle / lateral fraction), compute
SCALE-INVARIANT mask descriptors that match app.js computeDescriptors, train an MLP, and export
JSON weights for a pure-JS forward pass in the browser. PRIMAL (unlicensed R/Shiny) is the concept
inspiration only — no code/data reused."""
import numpy as np, math, json, os
from PIL import Image, ImageDraw
import torch, torch.nn as nn

RNG = np.random.default_rng(42)
torch.manual_seed(42)
W, H = 360, 560
OUT = r"C:\Users\drric\Downloads\Biomni_lab_downloads_20260624_220908\astroroot\models"
VAL = r"C:\Users\drric\Downloads\Biomni_lab_downloads_20260624_220908\astroroot\_val_masks"  # gitignored
os.makedirs(OUT, exist_ok=True); os.makedirs(VAL, exist_ok=True)

# ---------- synthetic root generator (known ground truth) ----------
def synth():
    n_prim = int(RNG.integers(1, 4))
    diam = int(RNG.integers(2, 6))
    lat_angle = float(RNG.uniform(20, 85))          # deg from vertical
    n_lat_per = int(RNG.integers(0, 16))
    img = Image.new("L", (W, H), 0); d = ImageDraw.Draw(img)
    lat_lengths, prim_len_total = [], 0.0
    for _ in range(n_prim):
        x0 = W*0.5 + RNG.uniform(-70, 70); y0 = H*0.05
        length = float(RNG.uniform(220, 520)); skew = RNG.uniform(-0.35, 0.35); wave = RNG.uniform(0, 3)
        steps = 46; pts = []
        for s in range(steps+1):
            t = s/steps
            pts.append((x0 + skew*length*t + math.sin(t*math.pi*wave)*8, y0 + length*t))
        d.line(pts, fill=255, width=diam); prim_len_total += length
        for _ in range(n_lat_per):
            t = RNG.uniform(0.12, 0.95); bx, by = pts[int(t*steps)]
            side = 1 if RNG.random() < 0.5 else -1
            ang = math.radians(lat_angle + RNG.uniform(-12, 12))
            L = float(RNG.uniform(20, 130))
            lx, ly = bx + side*math.sin(ang)*L, by + math.cos(ang)*L
            d.line([(bx, by), ((bx+lx)/2 + side*4, (by+ly)/2), (lx, ly)], fill=255, width=max(1, diam-1))
            lat_lengths.append(L)
    mask = (np.asarray(img) > 0).astype(np.uint8)
    tot_lat = sum(lat_lengths)
    gt = dict(n_laterals=len(lat_lengths), mean_lat_angle=lat_angle,
              lateral_fraction=tot_lat/(tot_lat + prim_len_total + 1e-9))
    return mask, gt

# ---------- mask descriptors (match app.js computeDescriptors; scale-invariant subset) ----------
def convex_area(pts):
    if len(pts) < 3: return 0.0
    pts = sorted(pts)
    def cross(o, a, b): return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])
    lo = []
    for q in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], q) <= 0: lo.pop()
        lo.append(q)
    up = []
    for q in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], q) <= 0: up.pop()
        up.append(q)
    h = lo[:-1] + up[:-1]; a = 0.0
    for i in range(len(h)):
        j = (i+1) % len(h); a += h[i][0]*h[j][1] - h[j][0]*h[i][1]
    return abs(a)/2

def descriptors(mask):
    ys, xs = np.where(mask > 0)
    if len(xs) == 0: return None
    minx, maxx, miny, maxy = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    wpx, hpx = maxx-minx+1, maxy-miny+1
    comx = (xs.mean()-minx)/max(1, wpx); comy = (ys.mean()-miny)/max(1, hpx)
    BINS = 30; prof = np.zeros(BINS); nrow = np.zeros(BINS)
    for y in range(miny, maxy+1):
        row = mask[y, minx:maxx+1]
        runs = int(np.sum((row[1:] == 1) & (row[:-1] == 0))) + (1 if row[0] == 1 else 0)  # count runs (match JS)
        b = min(BINS-1, int((y-miny)/max(1, hpx)*BINS)); prof[b] += runs; nrow[b] += 1
    prof = np.where(nrow > 0, prof/np.maximum(nrow, 1), 0.0)
    pts = []
    for y in range(miny, maxy+1):
        r = np.where(mask[y] > 0)[0]
        if len(r): pts.append((int(r.min()), y)); pts.append((int(r.max()), y))
    hull = convex_area(pts); area = len(xs)
    return dict(depthProfile=[round(float(v), 2) for v in prof], widthDepthRatio=round(wpx/max(1, hpx), 3),
                comX=round(float(comx), 3), comY=round(float(comy), 3), solidity=round(area/max(1, hull), 3))

FEAT = [f"prof{i}" for i in range(30)] + ["widthDepthRatio", "comX", "comY", "solidity", "maxCross", "meanCross", "argmaxDepth"]
def feature_vec(desc):
    p = np.array(desc["depthProfile"])
    return np.array(list(p) + [desc["widthDepthRatio"], desc["comX"], desc["comY"], desc["solidity"],
                               float(p.max()), float(p.mean()), float(p.argmax())/len(p)], dtype=np.float32)

TARGETS = ["n_laterals", "mean_lat_angle", "lateral_fraction"]

# ---------- build dataset ----------
N = 7000
X, Y, val_samples = [], [], []
for i in range(N):
    m, gt = synth(); dsc = descriptors(m)
    if dsc is None: continue
    X.append(feature_vec(dsc)); Y.append([gt[t] for t in TARGETS])
    if len(val_samples) < 6:  # keep a few masks for Python<->JS descriptor cross-check
        Image.fromarray(m*255).save(os.path.join(VAL, f"synth_{len(val_samples)}.png"))
        val_samples.append(dict(file=f"synth_{len(val_samples)}.png", gt=gt, desc=dsc))
X = np.array(X, np.float32); Y = np.array(Y, np.float32)
print("dataset", X.shape, Y.shape)

# ---------- standardize + split ----------
fmean, fstd = X.mean(0), X.std(0) + 1e-6
tmean, tstd = Y.mean(0), Y.std(0) + 1e-6
Xn = (X-fmean)/fstd; Yn = (Y-tmean)/tstd
n_test = 1000
Xtr, Xte, Ytr, Yte = Xn[:-n_test], Xn[-n_test:], Yn[:-n_test], Yn[-n_test:]

# ---------- train MLP ----------
dev = "cuda" if torch.cuda.is_available() else "cpu"
model = nn.Sequential(nn.Linear(len(FEAT), 64), nn.ReLU(), nn.Linear(64, 64), nn.ReLU(), nn.Linear(64, len(TARGETS))).to(dev)
opt = torch.optim.Adam(model.parameters(), 2e-3, weight_decay=1e-5); lossf = nn.MSELoss()
xt = torch.tensor(Xtr, device=dev); yt = torch.tensor(Ytr, device=dev)
for ep in range(600):
    model.train(); opt.zero_grad(); l = lossf(model(xt), yt); l.backward(); opt.step()
model.eval()
with torch.no_grad():
    pred = model(torch.tensor(Xte, device=dev)).cpu().numpy()
# metrics in real units
pred_real = pred*tstd + tmean; true_real = Yte*tstd + tmean
print("\nHeld-out (n=%d):" % n_test)
for i, t in enumerate(TARGETS):
    yt_, yp_ = true_real[:, i], pred_real[:, i]
    ss_res = ((yt_-yp_)**2).sum(); ss_tot = ((yt_-yt_.mean())**2).sum()
    r2 = 1 - ss_res/ss_tot; mae = np.abs(yt_-yp_).mean()
    print(f"  {t:16s} R2={r2:.3f}  MAE={mae:.2f}  (range {yt_.min():.1f}..{yt_.max():.1f})")

# ---------- export JSON weights for pure-JS forward pass ----------
layers = []
for m_ in model:
    if isinstance(m_, nn.Linear):
        layers.append(dict(W=m_.weight.detach().cpu().numpy().tolist(), b=m_.bias.detach().cpu().numpy().tolist(), act="relu"))
layers[-1]["act"] = "linear"
out = dict(schema="astroroot/lateral-estimator/v1", features=FEAT, featMean=fmean.tolist(), featStd=fstd.tolist(),
           targets=TARGETS, targetMean=tmean.tolist(), targetStd=tstd.tolist(), layers=layers,
           note="Synthetic-trained; validate on real ground truth before quantitative use.")
json.dump(out, open(os.path.join(OUT, "lateral_estimator.json"), "w"))
json.dump(val_samples, open(os.path.join(VAL, "val.json"), "w"), indent=2)
print("\nwrote models/lateral_estimator.json (%.1f KB)" % (os.path.getsize(os.path.join(OUT, "lateral_estimator.json"))/1024))
