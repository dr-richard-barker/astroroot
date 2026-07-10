"""Download APEX-03 root plate images, web-optimize, bundle for the AstroRoot demo picker,
and merge into samples/images/index.json."""
import json, re, os, io, urllib.request
from PIL import Image

REPO="dr-richard-barker/image-analysis-software-and-R-codes"; DIR="APEX03"; MAXW=1280
REPO_IMG=r"C:\Users\drric\Downloads\Biomni_lab_downloads_20260624_220908\astroroot\samples\images"
OUT=os.path.join(REPO_IMG,"apex03"); os.makedirs(OUT, exist_ok=True)

def api(p): return json.loads(urllib.request.urlopen(urllib.request.Request(
    "https://api.github.com/"+p, headers={"User-Agent":"astroroot"})).read())

files=[f for f in api(f"repos/{REPO}/contents/{DIR}") if f['name'].lower().endswith((".jpg",".jpeg"))]
entries=[]
for f in files:
    m=re.match(r'(\d+)D\s+(FLT|GC)\s+(.+?)\s+(\d+)\b', f['name'])
    if not m: continue
    day, cond, geno, gid = m.groups()
    geno=geno.strip().replace("SKU6(spiral1)","spr1").replace("SKU6","spr1")
    clean=f"apex03_{cond}_{re.sub(r'[^A-Za-z0-9]+','',geno)}_{gid}.jpg"
    raw=urllib.request.urlopen(f['download_url']).read()
    im=Image.open(io.BytesIO(raw)).convert("RGB"); w,h=im.size
    if w>MAXW: im=im.resize((MAXW, round(h*MAXW/w)))
    im.save(os.path.join(OUT,clean),"JPEG",quality=82)
    cw="Flight" if cond=="FLT" else "Ground"
    entries.append({"file":f"apex03/{clean}","label":f"APEX-03 · {cw} · {geno} ({day}d)","kind":"apex03",
                    "genotype":geno,"cond":cw,"day":int(day),"bytes":os.path.getsize(os.path.join(OUT,clean))})
    print(f"  {clean}: {w}x{h} -> {im.size[0]}x{im.size[1]}  {entries[-1]['bytes']//1024} KB")

# merge into the demo manifest
idxp=os.path.join(REPO_IMG,"index.json"); idx=json.load(open(idxp))
have={x['file'] for x in idx['files']}
for e in sorted(entries,key=lambda x:(x['cond'],x['genotype'])):
    if e['file'] not in have: idx['files'].append(e)
json.dump(idx, open(idxp,"w"), indent=2)
print(f"added {len(entries)} APEX-03 images; manifest now {len(idx['files'])} entries; total apex bundle {sum(e['bytes'] for e in entries)//1024} KB")
