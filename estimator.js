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
  const OOD_THRESHOLD = 2.6;                                  // RMS of standardized features; in-distribution ≈ 1
  function predict(desc){
    if(!model) return null;
    const f = featureVec(desc); if(!f) return null;
    let x = f.map((v,i)=>(v - model.featMean[i]) / (model.featStd[i] || 1));
    let ss=0; for(const z of x) ss+=z*z; const ood = Math.sqrt(ss / x.length);   // how far from the training set
    for(const L of model.layers){
      const out = new Array(L.b.length);
      for(let o=0;o<L.b.length;o++){ let s=L.b[o]; const w=L.W[o]; for(let i=0;i<x.length;i++) s+=w[i]*x[i];
        out[o] = L.act==="relu" ? (s>0?s:0) : s; }
      x = out;
    }
    const y = x.map((v,i)=>v*model.targetStd[i] + model.targetMean[i]);
    // The model extrapolated past a physically-possible value → the input is out of its range.
    const extrapolated = y[1] < -5 || y[1] > 95 || y[2] < -0.05 || y[2] > 1.05 || y[0] < -1;
    return { n_laterals: Math.max(0, Math.round(y[0])),
             lat_angle: +Math.max(0, Math.min(90, y[1])).toFixed(1),          // clamp to a valid root angle
             lateral_fraction: +Math.min(1, Math.max(0, y[2])).toFixed(3),
             reliable: ood < OOD_THRESHOLD && !extrapolated, ood: +ood.toFixed(2) };
  }
  return { load, predict, featureVec, ready: ()=>!!model };
})();
if(typeof window !== "undefined") window.AR_EST = AR_EST;
