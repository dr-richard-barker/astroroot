"""Download a curated balanced subset of TICTOC cotton RSML (day 6, FL vs GC) for the demo."""
import json, re, os, urllib.request

REPO="dr-richard-barker/TICTOC"; DIR="Data/Final_RSML_format"
OUT="tictoc"; os.makedirs(OUT, exist_ok=True)

def api(p):
    return json.loads(urllib.request.urlopen(urllib.request.Request(
        "https://api.github.com/"+p, headers={"User-Agent":"astroroot"})).read())

files = api(f"repos/{REPO}/contents/{DIR}?per_page=200")
day6 = []
for f in files:
    m = re.match(r'(\w+?)_(\w+)_(FL|GC)_6\.rsml$', f['name'])
    if m and f['size'] < 60000:
        day6.append({"name":f['name'], "size":f['size'], "geno":m.group(1), "well":m.group(2),
                     "cond":m.group(3), "url":f['download_url']})
def spread(lst, k):
    lst = sorted(lst, key=lambda x:x['size'])
    if len(lst) <= k: return lst
    step = len(lst)/k
    return [lst[int(i*step)] for i in range(k)]

fl = spread([x for x in day6 if x['cond']=="FL"], 12)
gc = spread([x for x in day6 if x['cond']=="GC"], 12)
sub = fl + gc
manifest = []
for f in sub:
    data = urllib.request.urlopen(f['url']).read()
    open(f"{OUT}/{f['name']}","wb").write(data)
    manifest.append({"file":f['name'], "group":"Flight" if f['cond']=="FL" else "Ground",
                     "genotype":f['geno'], "well":f['well'], "day":6})
manifest.sort(key=lambda x:(x['group'],x['genotype'],x['file']))
json.dump({"source":"TICTOC cotton spaceflight RSML (Data/Final_RSML_format), day 6 subset",
           "files":manifest}, open(f"{OUT}/index.json","w"), indent=2)
print(f"downloaded {len(sub)} files ({sum(f['size'] for f in sub)} bytes); FL={len(fl)} GC={len(gc)}")
print("genotypes:", sorted(set(f['geno'] for f in sub)))
