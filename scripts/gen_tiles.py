"""Crop single-seedling tiles from ABRS panels (grid-removed) for cleaner demo/test images."""
import numpy as np, json, os
from PIL import Image
from grid_dev import remove_grid   # reuse the verified grid remover

SRC=r"C:\Users\drric\Downloads\Biomni_lab_downloads_20260624_220908\astroroot\samples\images\2010_8th.jpg"
OUT=r"C:\Users\drric\Downloads\Biomni_lab_downloads_20260624_220908\astroroot\samples\images\tiles"
os.makedirs(OUT, exist_ok=True)

im=np.asarray(Image.open(SRC).convert("RGB"))
panels={"GC":(60,600,15,615), "FL":(60,600,665,1270)}  # y0,y1,x0,x1
manifest=[]
tid=1
for name,(y0,y1,x0,x1) in panels.items():
    panel=im[y0:y1, x0:x1]
    clean,_=remove_grid(panel)          # degridded copy only used to locate seedlings
    g=clean.astype(np.float32).mean(2)
    H,W=g.shape
    # seedling x-positions = brightness peaks in the top shoot band
    band=g[:int(H*0.16)].sum(0)
    band=band-band.min()
    # find local maxima with min separation
    sep=max(20, W//14); peaks=[]
    order=np.argsort(band)[::-1]
    for x in order:
        if band[x] < band.max()*0.35: break
        if all(abs(x-p)>sep for p in peaks): peaks.append(int(x))
        if len(peaks)>=5: break
    peaks.sort()
    tw=int(sep*1.6)
    for x in peaks:
        a=max(0,x-tw//2); b=min(W,x+tw//2)
        tile=panel[:, a:b]              # crop from the RAW panel (keeps the grid for the GUI filter demo)
        # downsize to <=520px wide
        pim=Image.fromarray(tile);
        if pim.width>420: pim=pim.resize((420, round(pim.height*420/pim.width)))
        fn=f"tile_{name}_{tid}.jpg"; pim.save(os.path.join(OUT,fn),"JPEG",quality=85)
        manifest.append({"file":f"tiles/{fn}", "label":f"Single-root tile ({name}) #{tid}", "kind":"tile", "cond":name})
        tid+=1
json.dump(manifest, open(os.path.join(OUT,"tiles.json"),"w"), indent=2)
print(f"wrote {len(manifest)} tiles"); [print(" ",m["file"]) for m in manifest]
