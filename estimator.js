/* AstroRoot ML hidden-trait estimator — PRIMAL-style.
 * A tiny MLP (trained on a synthetic root library; scripts/train_lateral_estimator.py) that maps
 * the scale-invariant mask descriptors to hard-to-see lateral traits: number of laterals, mean
 * lateral angle, and lateral fraction (lateral length ÷ total). Pure-JS forward pass over JSON
 * weights — no runtime dependency. Feature order MUST match the Python training script.
 * NOTE: synthetic-trained — treat as an estimate; validate on real ground truth for quantitative use. */
const AR_EST = (() => {
  let model = null;
  async function load(){
    try{ model = await (await fetch("models/lateral_estimator.json", {cache:"no-cache"})).json(); }
    catch(e){ model = null; }
    return !!model;
  }
  function featureVec(desc){
    const p = desc && desc.depthProfile; if(!p || p.length < 30) return null;
    let max=p[0], mean=0, ai=0;
    for(let i=0;i<p.length;i++){ mean+=p[i]; if(p[i]>max)max=p[i]; if(p[i]>p[ai])ai=i; }
    mean/=p.length;
    return [...p.slice(0,30), desc.widthDepthRatio, desc.comX, desc.comY, desc.solidity, max, mean, ai/p.length];
  }
  function predict(desc){
    if(!model) return null;
    const f = featureVec(desc); if(!f) return null;
    let x = f.map((v,i)=>(v - model.featMean[i]) / (model.featStd[i] || 1));
    for(const L of model.layers){
      const out = new Array(L.b.length);
      for(let o=0;o<L.b.length;o++){ let s=L.b[o]; const w=L.W[o]; for(let i=0;i<x.length;i++) s+=w[i]*x[i];
        out[o] = L.act==="relu" ? (s>0?s:0) : s; }
      x = out;
    }
    const y = x.map((v,i)=>v*model.targetStd[i] + model.targetMean[i]);
    return { n_laterals: Math.max(0, Math.round(y[0])), lat_angle: +y[1].toFixed(1),
             lateral_fraction: +Math.min(1, Math.max(0, y[2])).toFixed(3) };
  }
  return { load, predict, featureVec, ready: ()=>!!model };
})();
if(typeof window !== "undefined") window.AR_EST = AR_EST;
