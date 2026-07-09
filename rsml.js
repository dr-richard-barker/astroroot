/* AstroRoot RSML parser — turns RootNav/RSML files into AstroRoot measurement records.
 * Lets the dashboard import RSML from the RootNav ecosystem (RootNav 1 / 2.0 / RootNav-Viewer).
 * Measurements mirror gen_skew_samples.py: per-plate mean primary-root length, root (tip) count,
 * lateral (branch) count, and mean tip angle from vertical (the skew). */
const AR_RSML = (() => {
  const num = s => parseFloat(s);
  function points(block){
    const out=[]; const re=/<point\s+x="([\d.\-]+)"\s+y="([\d.\-]+)"/g; let m;
    while((m=re.exec(block))) out.push([num(m[1]), num(m[2])]);
    return out;
  }
  function polyLen(p){ let L=0; for(let i=1;i<p.length;i++) L+=Math.hypot(p[i][0]-p[i-1][0], p[i][1]-p[i-1][1]); return L; }
  function angleFromVertical(p){
    const dx=p[p.length-1][0]-p[0][0], dy=p[p.length-1][1]-p[0][1], L=Math.hypot(dx,dy);
    if(L<1e-6) return 0; const a=Math.acos(Math.max(-1,Math.min(1,dy/L)))*180/Math.PI; return Math.min(a,180-a);
  }
  function meta(text, tag){ const m=text.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)); return m?m[1].trim():""; }

  // parse one RSML string -> a record (id/ts assigned by caller)
  function parse(text, filename){
    const unit = meta(text,"unit") || "pixel";
    const plants = text.match(/<plant\b[\s\S]*?<\/plant>/g) || [];
    const lens=[], angs=[]; let nroots=0, nlat=0;
    for(const p of plants){
      const polys = p.match(/<polyline>([\s\S]*?)<\/polyline>/g) || [];
      if(!polys.length) continue;
      const pts = points(polys[0]); if(pts.length<2) continue;
      lens.push(polyLen(pts)); angs.push(angleFromVertical(pts)); nroots++;
      nlat += Math.max(0, polys.length-1);
    }
    if(!lens.length) return null;
    const mean = a => a.reduce((s,v)=>s+v,0)/a.length;
    const lm = meta(text,"last-modified"); let ts = Date.parse(lm); if(isNaN(ts)) ts = Date.now();
    return {
      ts, name: (filename||meta(text,"file-key")||"rsml").replace(/\.rsml$/i,""),
      engine: "RootNav (RSML import)", marker: `rsml (${unit})`,
      pxPerCm: null, lengthVal: +mean(lens).toFixed(1), lengthUnit: unit==="pixel"?"px":unit,
      colorCorrected: false, tips: nroots, branches: nlat, angle: +mean(angs).toFixed(1), thumb: null
    };
  }
  return { parse };
})();
if(typeof window !== "undefined") window.AR_RSML = AR_RSML;
