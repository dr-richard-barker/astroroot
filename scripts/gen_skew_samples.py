"""Parse the 18_way_skew RootNav RSML files -> AstroRoot sample records JSON."""
import json, re, math, urllib.request, calendar, time

REPO = "dr-richard-barker/image-analysis-software-and-R-codes"
DIR = "18_way_skew"

def api(path):
    req = urllib.request.Request("https://api.github.com/"+path, headers={"User-Agent":"astroroot"})
    return urllib.request.urlopen(req).read().decode("utf-8")

listing = json.loads(api(f"repos/{REPO}/contents/{DIR}"))
files = [f for f in listing if f["name"].endswith(".rsml")]
print("rsml files:", len(files))

def parse_points(block):
    return [(float(x), float(y)) for x, y in re.findall(r'<point\s+x="([\d.\-]+)"\s+y="([\d.\-]+)"', block)]

def poly_len(pts):
    return sum(math.hypot(pts[i+1][0]-pts[i][0], pts[i+1][1]-pts[i][1]) for i in range(len(pts)-1))

def angle_from_vertical(pts):
    # overall root direction (start->end) vs straight-down (0,1), folded to [0,90]
    dx, dy = pts[-1][0]-pts[0][0], pts[-1][1]-pts[0][1]
    L = math.hypot(dx, dy)
    if L < 1e-6: return 0.0
    a = math.degrees(math.acos(max(-1, min(1, dy/L))))
    return min(a, 180-a)

def parse_condition(name):
    m = re.match(r'Gradient_([\d.]+)%([AP])_([\d.]+)%S_(\d+)', name)
    if not m: return name
    conc, gel, suc, rep = m.groups()
    return f"{conc}% {'agar' if gel=='A' else 'phytogel'}, {suc}% suc #{rep}"

def to_ts(iso):
    try: return int(calendar.timegm(time.strptime(iso[:19], "%Y-%m-%dT%H:%M:%S")))*1000
    except: return 1511772000000  # 2017-11-27 fallback

records = []
for f in files:
    txt = urllib.request.urlopen(f["download_url"]).read().decode("utf-8", "replace")
    lm = re.search(r'<last-modified>([^<]+)</last-modified>', txt)
    ts = to_ts(lm.group(1).strip()) if lm else 1511772000000
    # each <plant> ... </plant> holds one primary root polyline
    plants = re.findall(r'<plant\b.*?</plant>', txt, re.S)
    lens, angs, nroots, nlat, geom = [], [], 0, 0, []
    def ds(p):
        if len(p) <= 18: return p
        step = (len(p)-1)/17.0
        return [p[round(i*step)] for i in range(18)]
    for p in plants:
        polys = re.findall(r'<polyline>(.*?)</polyline>', p, re.S)
        if not polys: continue
        pts = parse_points(polys[0])          # primary root = first polyline
        if len(pts) < 2: continue
        lens.append(poly_len(pts)); angs.append(angle_from_vertical(pts)); nroots += 1
        nlat += max(0, len(polys)-1)           # extra polylines = laterals
        geom.append({"o":1, "p":[[round(x,1),round(y,1)] for x,y in ds(pts)]})
    if not lens: continue
    records.append({
        "id": "sample_" + re.sub(r'[^A-Za-z0-9]+','_', f["name"].replace(".rsml","")),
        "ts": ts, "name": parse_condition(f["name"]),
        "engine": "RootNav (RSML import)", "marker": "rsml (pixel)",
        "pxPerCm": None, "lengthVal": round(sum(lens)/len(lens), 1), "lengthUnit": "px",
        "colorCorrected": False, "tips": nroots, "branches": nlat,
        "angle": round(sum(angs)/len(angs), 1), "thumb": None, "geom": geom,
    })

records.sort(key=lambda r: r["name"])
out = {"schema":"astroroot/v1","source":"18_way_skew RSML (RootNav) — image-analysis-software-and-R-codes","records":records}
open("18_way_skew.json","w",encoding="utf-8").write(json.dumps(out, indent=2))
print("wrote 18_way_skew.json:", len(records), "records")
print("sample:", json.dumps(records[0], indent=2))
# quick sanity: angle range
angs = [r["angle"] for r in records]
print(f"angle range: {min(angs):.1f}..{max(angs):.1f} deg; mean roots/plate: {sum(r['tips'] for r in records)/len(records):.1f}")
