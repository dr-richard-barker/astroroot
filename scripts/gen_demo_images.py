"""Download the ABRS FL_GC_Combined timelapse images and bundle web-optimized copies
for the AstroRoot demo image picker."""
import json, re, os, io, urllib.request
from PIL import Image

REPO="dr-richard-barker/image-analysis-software-and-R-codes"
DIR="ABRS_NASA_Roots_TimeLapse/FL_GC_Combined"
OUT="demo_images"; os.makedirs(OUT, exist_ok=True)
MAXW=1280

def api(p):
    return json.loads(urllib.request.urlopen(urllib.request.Request(
        "https://api.github.com/"+p, headers={"User-Agent":"astroroot"})).read())

files = sorted([f for f in api(f"repos/{REPO}/contents/{DIR}") if f['name'].lower().endswith('.jpg')],
               key=lambda x:x['name'])
manifest=[]
ordinals={"1st":1,"2nd":2,"3rd":3,"4th":4,"5th":5,"6th":6,"7th":7,"8th":8}
for f in files:
    raw = urllib.request.urlopen(f['download_url']).read()
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    w,h = im.size
    if w>MAXW: im = im.resize((MAXW, round(h*MAXW/w)))
    out = f['name']
    im.save(f"{OUT}/{out}", "JPEG", quality=82)
    n = os.path.getsize(f"{OUT}/{out}")
    m = re.search(r'(\d)(st|nd|rd|th)', out)
    frame = ordinals.get(m.group(0),0) if m else 0
    manifest.append({"file":out, "label":f"ABRS FL+GC timelapse — frame {frame}/8", "frame":frame,
                     "orig_px":[w,h], "bytes":n})
    print(f"  {out}: {w}x{h} -> {im.size[0]}x{im.size[1]}  {n//1024} KB")
manifest.sort(key=lambda x:x['frame'])
json.dump({"source":f"{REPO}/{DIR} (ABRS ISS flight+ground root timelapse, 2010)",
           "note":"web-optimized (<=1280px) copies for demo/test; originals ~3 MB each in the source repo",
           "files":manifest}, open(f"{OUT}/index.json","w"), indent=2)
print("total bundle:", sum(m['bytes'] for m in manifest)//1024, "KB")
