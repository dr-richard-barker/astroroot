"""Generate clean, artifact-free *synthetic* demo roots with a known ground-truth answer.

The bundled NASA/ABRS demo photos are real plates: great for showing what the tool does on
messy data, but their diversity (grid lines, glare, debris, curved roots) means there is no
single "correct" number to check against. These synthetic roots are the opposite — a simple,
high-contrast shape on a plain background, drawn at a known scale, so the measurements the app
reports can be checked against an exact expected value. Ideal for a first run, for teaching, and
for a smoke-test that segmentation + thinning + measurement still work.

Design notes (why the numbers are exact):
  * The app measures skeleton *length* as a pixel count, so axis-aligned strokes (vertical
    primary, horizontal laterals) give length == Euclidean length. Diagonals would under-count
    by ~sqrt(2), so we avoid them here.
  * Scale is fixed at 100 px/cm. We deliberately DON'T draw a scale bar or any text — a separate
    mark like that gets segmented as an extra "root" and pollutes the whole-image tip/branch/length
    counts. Instead the root's own geometry is the ruler: calibrate with "Manual — click 2 points"
    on the primary's ends and enter its known length (straight = 100 mm, fishbone = 80 mm).
  * "Root tips" are skeleton endpoints: the seed (top) end counts too, so a shape with T true
    growing tips reports T+1 endpoints. Both numbers are recorded below.

AstroRoot-authored (BSD-3-Clause). Outputs PNG (lossless — no JPEG artifacts) + an index.json
manifest carrying the ground truth.
"""
import json, os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), "..", "samples", "synthetic")
os.makedirs(OUT, exist_ok=True)

PPC = 100            # pixels per cm (ground-truth scale)
SS = 4               # supersample factor for smooth (anti-aliased) but clean edges
ROOT = (26, 22, 20)  # near-black warm brown — high contrast, easy Otsu
BG = (250, 250, 248) # near-white plain background (no grid, no noise)


def _canvas(w, h):
    im = Image.new("RGB", (w * SS, h * SS), BG)
    return im, ImageDraw.Draw(im)


def _stroke(d, p0, p1, w_cm0, w_cm1=None):
    """Draw a tapered stroke (a dense chain of circles) from p0 to p1 in device (supersampled) px."""
    w_cm1 = w_cm0 if w_cm1 is None else w_cm1
    dist = ((p1[0] - p0[0]) ** 2 + (p1[1] - p0[1]) ** 2) ** 0.5
    n = max(2, int(dist))                     # ~one circle per device px -> solid, smooth stroke
    for i in range(n + 1):
        t = i / n
        x = p0[0] + (p1[0] - p0[0]) * t
        y = p0[1] + (p1[1] - p0[1]) * t
        r = (w_cm0 + (w_cm1 - w_cm0) * t) * PPC * SS / 2
        d.ellipse([x - r, y - r, x + r, y + r], fill=ROOT)


def finish(im, name):
    w, h = im.size
    im = im.resize((w // SS, h // SS), Image.LANCZOS)
    path = os.path.join(OUT, name + ".png")
    im.save(path, "PNG")
    print(f"wrote {path}  {im.size[0]}x{im.size[1]}  {os.path.getsize(path)//1024} KB")
    return im.size


manifest = []

# ---------------------------------------------------------------------------
# 1. STRAIGHT ROOT — the simplest possible check: one vertical primary + scale bar.
#    Teaches calibrate -> segment -> length. Exact by construction.
# ---------------------------------------------------------------------------
W, H = 700, 1120
im, d = _canvas(W, H)
cx = W // 2 * SS
top, bot = 60 * SS, 1060 * SS                  # 1000 px = 10.00 cm
_stroke(d, (cx, top), (cx, bot), 0.09, 0.05)   # gently tapering, ~5-9 px wide
size = finish(im, "synthetic_straight_root")
manifest.append({
    "file": "synthetic_straight_root.png",
    "label": "▸ Synthetic: straight root (known answer)",
    "synthetic": True, "px_per_cm": PPC, "calibrate_on": "primary ends = 100 mm", "px": list(size),
    "truth": {"total_length_cm": 10.00, "tips_growing": 1, "endpoints": 2,
              "branch_points": 0, "angle_deg": 0},
    "note": "One vertical primary, 10.00 cm at 100 px/cm. Endpoints=2 (1 growing tip + seed end). "
            "Calibrate: Manual 2-pt on the two ends, enter 100 mm."
})

# ---------------------------------------------------------------------------
# 2. FISHBONE — a primary with 6 alternating laterals. Teaches tips, branch points,
#    laterals, manual-trace/RSML. Every stroke is axis-aligned so counts + lengths are exact.
# ---------------------------------------------------------------------------
W, H = 1000, 1100
im, d = _canvas(W, H)
cx = W // 2 * SS
top, bot = 150 * SS, 950 * SS                 # primary 800 px = 8.00 cm
_stroke(d, (cx, top), (cx, bot), 0.10, 0.05)
LAT_CM = 2.0
lat_len = int(LAT_CM * PPC)                    # 200 px each
ys = [300, 400, 500, 600, 700, 800]
for i, y in enumerate(ys):
    yy = y * SS
    side = 1 if i % 2 == 0 else -1             # alternate right / left
    x_end = cx + side * lat_len * SS
    _stroke(d, (cx, yy), (x_end, yy), 0.05, 0.03)
size = finish(im, "synthetic_fishbone")
primary_cm = 8.00
total = primary_cm + len(ys) * LAT_CM
manifest.append({
    "file": "synthetic_fishbone.png",
    "label": "▸ Synthetic: fishbone (6 laterals, known answer)",
    "synthetic": True, "px_per_cm": PPC, "calibrate_on": "primary ends = 80 mm", "px": list(size),
    "truth": {"total_length_cm": round(total, 2), "tips_growing": 1 + len(ys),
              "endpoints": 2 + len(ys), "branch_points": len(ys), "angle_deg": 0,
              "laterals": len(ys), "lateral_length_cm": LAT_CM, "primary_length_cm": primary_cm},
    "note": ("Vertical primary 8.00 cm + 6 laterals x 2.00 cm = 20.00 cm total. "
             "6 T-junctions => 6 branch points. Endpoints=8 (7 growing tips + seed end). "
             "Calibrate: Manual 2-pt on the primary's ends, enter 80 mm.")
})

# ---------------------------------------------------------------------------
# 3. MATCHING RSML — the SAME fishbone geometry as an RSML file (cm units), so the
#    archiDART-comparable trait engine (rsml.js) can be checked against a known answer too.
#    Primary 8 cm (order 1) + 6 laterals x 2 cm (order 2). unit=cm, resolution=1.
# ---------------------------------------------------------------------------
def _poly(pts):
    return ("<geometry><polyline>"
            + "".join(f"<point x='{x:.2f}' y='{y:.2f}'/>" for x, y in pts)
            + "</polyline></geometry>")


def _diam(n, d):
    return ("<functions><function name='diameter' domain='polyline'>"
            + "".join(f"<sample>{d}</sample>" for _ in range(n))
            + "</function></functions>")


def _line(x0, y0, x1, y1, steps=8):
    return [(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps) for i in range(steps + 1)]


prim_pts = _line(5.0, 1.5, 5.0, 9.5, 16)                 # 8.00 cm vertical primary
lat_children = ""
for i, yc in enumerate([3, 4, 5, 6, 7, 8]):
    side = 1 if i % 2 == 0 else -1
    lp = _line(5.0, float(yc), 5.0 + side * 2.0, float(yc), 6)   # 2.00 cm lateral
    lat_children += (f"<root ID='lat{i+1}' label='lateral'>{_poly(lp)}{_diam(len(lp), 0.04)}</root>")
primary = f"<root ID='primary' label='primary'>{_poly(prim_pts)}{_diam(len(prim_pts), 0.08)}{lat_children}</root>"
rsml_txt = (
    "<?xml version='1.0' encoding='UTF-8'?>\n<rsml>\n"
    "<metadata><version>1</version><unit>cm</unit><resolution>1</resolution>"
    "<last-modified>2024-01-01T09:00:00</last-modified><software>AstroRoot-synthetic</software>"
    "<file-key>synthetic_fishbone</file-key></metadata>\n"
    f"<scene><plant ID='1' label='synthetic'>{primary}</plant></scene>\n</rsml>\n"
)
rsml_path = os.path.join(OUT, "synthetic_fishbone.rsml")
open(rsml_path, "w", encoding="utf-8").write(rsml_txt)
print(f"wrote {rsml_path}  ({len(rsml_txt)} bytes)")
manifest.append({
    "file": "synthetic_fishbone.rsml",
    "label": "Synthetic fishbone — RSML (archiDART traits, known answer)",
    "synthetic": True, "kind": "rsml", "px_per_cm": PPC,
    "truth": {"TRL_cm": 20.0, "L1R_cm": 8.0, "TN1R": 1, "TNLR_laterals": 6,
              "magnitude_tips": 6, "max_order": 2, "angle_deg": 0},
    "note": ("Same geometry as synthetic_fishbone.png, as RSML. TRL=20.00 cm, 1 primary + 6 "
             "laterals. Load via Dashboard sample picker or 'Import RSML'.")
})

json.dump({
    "source": "AstroRoot synthetic demo roots (gen_synthetic_root.py)",
    "note": ("Clean, high-contrast synthetic roots with an EXACT known answer — for a first run, "
             "teaching, and smoke-testing. Drawn at 100 px/cm with a 2 cm scale bar; calibrate "
             "with 'Manual — click 2 points' on the bar (enter 20 mm)."),
    "px_per_cm": PPC,
    "files": manifest,
}, open(os.path.join(OUT, "index.json"), "w"), indent=2)
print("wrote", os.path.join(OUT, "index.json"))
