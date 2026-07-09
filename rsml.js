/* AstroRoot RSML parser + archiDART-comparable trait engine.
 * Parses RootNav/RSML (nested <root> = branching order; optional diameter function) and computes
 * the static 2D root-architecture traits that archiDART's architect() reports, plus Fitter
 * topological indices and a simplified H0 geodesic-distance persistence barcode (after perhomology).
 * What needs data we don't have from a single 2D RSML is intentionally omitted (growth rates =
 * time series; 3D convex hull; DART format) — see docs/ARCHIDART_PARITY.md. */
const AR_RSML = (() => {
  const UNIT_CM = { cm:1, mm:0.1, inch:2.54, pixel:null, px:null };

  function dist(a,b){ return Math.hypot(a[0]-b[0], a[1]-b[1]); }
  function polyLen(p){ let L=0; for(let i=1;i<p.length;i++) L+=dist(p[i-1],p[i]); return L; }
  function angleFromVertical(p){
    const dx=p[p.length-1][0]-p[0][0], dy=p[p.length-1][1]-p[0][1], L=Math.hypot(dx,dy);
    if(L<1e-9) return 0; const a=Math.acos(Math.max(-1,Math.min(1,dy/L)))*180/Math.PI; return Math.min(a,180-a);
  }
  function convexHullArea(pts){
    if(pts.length<3) return 0;
    const p=pts.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
    const lo=[],up=[];
    for(const q of p){ while(lo.length>=2&&cross(lo[lo.length-2],lo[lo.length-1],q)<=0)lo.pop(); lo.push(q); }
    for(let i=p.length-1;i>=0;i--){ const q=p[i]; while(up.length>=2&&cross(up[up.length-2],up[up.length-1],q)<=0)up.pop(); up.push(q); }
    const h=lo.slice(0,-1).concat(up.slice(0,-1));
    let a=0; for(let i=0;i<h.length;i++){ const j=(i+1)%h.length; a+=h[i][0]*h[j][1]-h[j][0]*h[i][1]; }
    return Math.abs(a)/2;
  }

  // read points of a <root>'s OWN polyline (not descendants)
  function rootPoints(rootEl){
    const geo = [...rootEl.children].find(c=>c.tagName==="geometry"); if(!geo) return [];
    const poly = [...geo.children].find(c=>c.tagName==="polyline"); if(!poly) return [];
    return [...poly.getElementsByTagName("point")].map(pt=>[parseFloat(pt.getAttribute("x")),parseFloat(pt.getAttribute("y"))]);
  }
  function rootMeanDiameter(rootEl){
    // RSML puts <functions> as a child of <root> (sibling of <geometry>)
    const fns=[...rootEl.children].find(c=>c.tagName==="functions"); if(!fns) return null;
    const f=[...fns.children].find(c=>c.tagName==="function" && c.getAttribute("name")==="diameter"); if(!f) return null;
    const s=[...f.getElementsByTagName("sample")].map(x=>parseFloat(x.textContent)).filter(v=>!isNaN(v));
    return s.length ? s.reduce((a,b)=>a+b,0)/s.length : null;
  }

  function collectRoots(el, order, parentGeoBase, parentPts, out){
    for(const r of [...el.children].filter(c=>c.tagName==="root")){
      const pts=rootPoints(r);
      if(pts.length>=2){
        // geodesic base = where this root attaches to its parent (parent geodesic + arc along parent to nearest pt)
        let geoBase=0;
        if(parentPts && parentPts.length){
          let best=Infinity, bi=0; for(let i=0;i<parentPts.length;i++){ const d=dist(parentPts[i],pts[0]); if(d<best){best=d;bi=i;} }
          geoBase = parentGeoBase + polyLen(parentPts.slice(0,bi+1));
        }
        const len=polyLen(pts), diam=rootMeanDiameter(r);
        const node={order, pts, len, diam, geoBase, geoTip:geoBase+len, children:0};
        out.push(node);
        // recurse; children increment handled by counting
        const before=out.length;
        collectRoots(r, order+1, geoBase, pts, out);
        node.children = out.slice(before).filter(n=>n.order===order+1).length;
      } else {
        collectRoots(r, order+1, parentGeoBase, parentPts, out);
      }
    }
  }

  function parse(text, filename){
    const xml = new DOMParser().parseFromString(text, "application/xml");
    if(xml.getElementsByTagName("parsererror").length) return null;
    const meta = t => { const e=xml.getElementsByTagName(t)[0]; return e?e.textContent.trim():""; };
    const unit = (meta("unit")||"pixel").toLowerCase();
    const roots=[];
    for(const plant of xml.getElementsByTagName("plant")) collectRoots(plant, 1, 0, null, roots);
    if(!roots.length) return null;

    const sum=a=>a.reduce((x,y)=>x+y,0), mean=a=>a.length?sum(a)/a.length:0;
    const o1=roots.filter(r=>r.order===1), lat=roots.filter(r=>r.order>=2);
    const o2=roots.filter(r=>r.order===2);
    const allPts=[].concat(...roots.map(r=>r.pts));
    const xs=allPts.map(p=>p[0]), ys=allPts.map(p=>p[1]);
    const TRL=sum(roots.map(r=>r.len)), L1R=sum(o1.map(r=>r.len)), TLRL=sum(lat.map(r=>r.len));
    const tips=roots.filter(r=>r.children===0);                      // external roots
    // diameter-based (only if diameter function present)
    const withD=roots.filter(r=>r.diam!=null);
    const Stot = withD.length ? sum(withD.map(r=>Math.PI*r.diam*r.len)) : null;
    const Vtot = withD.length ? sum(withD.map(r=>Math.PI*(r.diam/2)**2*r.len)) : null;
    const tort = mean(roots.map(r=>{ const s=dist(r.pts[0],r.pts[r.pts.length-1]); return s>1e-6?r.len/s:1; }));
    const barcode = roots.map(r=>({birth:+r.geoTip.toFixed(2), death:+r.geoBase.toFixed(2)}));
    const persist = barcode.map(b=>b.birth-b.death);
    const lm=meta("last-modified"); let ts=Date.parse(lm); if(isNaN(ts)) ts=Date.now();
    // resolution = pixels per <unit>. Physical units convert as unit_in_cm / resolution;
    // pixel unit stays in px (resolution can't give a physical scale there).
    const res = parseFloat(meta("resolution")) || 1;
    const toCm = UNIT_CM[unit]; const dispUnit = toCm!=null ? "cm" : "px"; const k = toCm!=null ? toCm/res : 1;

    const arch = {
      unit, TRL:+(TRL*k).toFixed(2), L1R:+(L1R*k).toFixed(2), TN1R:o1.length, TNLR:lat.length,
      TLRL:+(TLRL*k).toFixed(2), MLR:+(mean(lat.map(r=>r.len))*k).toFixed(2),
      N2LR:o2.length, D2LR:+(L1R>0 ? o2.length/(L1R*k):0).toFixed(3),
      maxOrder: Math.max(...roots.map(r=>r.order)),
      height:+(( (Math.max(...ys)-Math.min(...ys)) )*k).toFixed(2),
      width:+(( (Math.max(...xs)-Math.min(...xs)) )*k).toFixed(2),
      convexHullXY:+(convexHullArea(allPts)*k*k).toFixed(1),
      MDLR: lat.filter(r=>r.diam!=null).length ? +(mean(lat.filter(r=>r.diam!=null).map(r=>r.diam))*k).toFixed(3) : null,
      Stot: Stot!=null ? +(Stot*k*k).toFixed(2):null, Vtot: Vtot!=null ? +(Vtot*k*k*k).toFixed(3):null,
      tortuosity:+tort.toFixed(3),
      magnitude: tips.length, altitude:+(Math.max(...roots.map(r=>r.geoTip))*k).toFixed(2),
      extPathLength:+(sum(tips.map(r=>r.geoTip))*k).toFixed(1),
      barcode, maxPersistence:+(Math.max(...persist)*k).toFixed(2), totalPersistence:+(sum(persist)*k).toFixed(1)
    };
    return {
      ts, name:(filename||meta("file-key")||"rsml").replace(/\.rsml$/i,""),
      engine:"RootNav/RSML (archidart traits)", marker:`rsml (${unit})`,
      pxPerCm:null, lengthVal:arch.TRL, lengthUnit:dispUnit, colorCorrected:false,
      tips:arch.magnitude, branches:arch.TNLR, angle:+mean(o1.map(r=>angleFromVertical(r.pts))).toFixed(1),
      arch, thumb:null
    };
  }
  return { parse, convexHullArea };
})();
if(typeof window !== "undefined") window.AR_RSML = AR_RSML;
