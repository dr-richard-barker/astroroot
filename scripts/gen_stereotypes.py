"""Generate 'extreme stereotype' root-architecture RSML files (cm units) — illustrative
architectures at the extremes of the RSA trait space, in the spirit of the archiDART topology
paper (Delory et al. 2018). AstroRoot-authored (BSD), not the paper's exact files."""
import math, os

OUT = "stereotypes"; os.makedirs(OUT, exist_ok=True)

def poly(pts):
    return "<polyline>" + "".join(f'<point x="{x:.2f}" y="{y:.2f}"/>' for x,y in pts) + "</polyline>"
def diam(n, d):
    return "<functions><function name='diameter' domain='polyline'>" + "".join(f"<sample>{d}</sample>" for _ in range(n)) + "</function></functions>"
def seg(x0,y0,x1,y1,n=8,wig=0.0):
    pts=[]
    for i in range(n+1):
        t=i/n; x=x0+(x1-x0)*t + (wig*math.sin(t*math.pi*3)); y=y0+(y1-y0)*t
        pts.append((x,y))
    return pts

def root(pts, d, children=""):
    p=poly(pts)
    return f"<root ID='' label=''><geometry>{p}</geometry>{diam(len(pts),d)}{children}</root>"

def rsml(name, roots):
    return (f"<?xml version='1.0' encoding='UTF-8'?>\n<rsml>\n<metadata><version>1</version>"
            f"<unit>cm</unit><resolution>1</resolution><last-modified>2018-01-15T09:00:00</last-modified>"
            f"<software>AstroRoot-stereotype</software><file-key>{name}</file-key></metadata>\n"
            f"<scene><plant ID='1' label=''>{roots}</plant></scene>\n</rsml>\n")

files = {}

# 1. TAP-DOMINANT: one deep straight primary, 2 tiny laterals -> deep, low magnitude
lat = root(seg(5,10, 6.5,11.5, 4), 0.03)
files["tap_dominant"] = rsml("tap_dominant", root(seg(5,0, 5,20, 20, 0.05), 0.12, lat*2))

# 2. HERRINGBONE: long primary + many short laterals alternating -> classic herringbone
lats=""
for i in range(10):
    y=2+i*1.6; side=1 if i%2 else -1
    lats += root(seg(5,y, 5+side*3, y+2.5, 5), 0.03)
files["herringbone"] = rsml("herringbone", root(seg(5,0, 5,18, 20, 0.1), 0.12, lats))

# 3. DICHOTOMOUS: repeated bifurcation -> high magnitude, balanced tree
def fork(x,y,dx,dy,depth,d):
    tip=(x+dx, y+dy)
    kids=""
    if depth>0:
        kids += root(seg(*tip, tip[0]-abs(dx)*0.7, tip[1]+dy*0.8, 6), d*0.8, fork(tip[0], tip[1], -abs(dx)*0.7, dy*0.8, depth-1, d*0.8))
        kids += root(seg(*tip, tip[0]+abs(dx)*0.7, tip[1]+dy*0.8, 6), d*0.8, fork(tip[0], tip[1],  abs(dx)*0.7, dy*0.8, depth-1, d*0.8))
    return kids
files["dichotomous"] = rsml("dichotomous", root(seg(6,0, 6,4, 6), 0.12, fork(6,4, 2.5,3, 3, 0.1)))

# 4. SHALLOW-SPREADING: short primary, many wide near-horizontal laterals -> wide, shallow
lats=""
for i in range(8):
    y=1+i*0.5; side=1 if i%2 else -1
    lats += root(seg(6,y, 6+side*(4+i*0.6), y+1.2, 6, 0.3), 0.03)
files["shallow_spreading"] = rsml("shallow_spreading", root(seg(6,0, 6,5, 8, 0.1), 0.1, lats))

# 5. FIBROUS (monocot-like): many primaries from base fanning out, each 1-2 laterals -> high TN1R
roots=""
for i in range(9):
    ang=-0.6+i*0.15; x1=6+math.sin(ang)*8; y1=14+math.cos(ang)*2
    kid = root(seg((6+x1)/2,(y1)/2+2, (6+x1)/2+1.5, y1/2+4, 4), 0.03)
    roots += root(seg(6,0, x1,y1, 14, 0.4), 0.08, kid)
files["fibrous_monocot"] = rsml("fibrous_monocot", roots)

for name, txt in files.items():
    open(f"{OUT}/{name}.rsml","w",encoding="utf-8").write(txt)
    print(f"wrote {OUT}/{name}.rsml ({len(txt)} bytes)")
