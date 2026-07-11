/* AstroRoot — client-side root image analysis.
 * Everything runs in the browser; no image is uploaded.
 * Pipeline: calibrate -> segment (classical baseline OR ONNX model) -> thin -> measure.
 * The ONNX path reuses the same measurement code on a better mask, so classical works today
 * and the deep model is a drop-in upgrade. Full RootNav2 seed/tip path-search is a TODO. */

const ORT_SRC = "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js";
const $ = (id) => document.getElementById(id);

/* ---------- tabs ---------- */
document.querySelectorAll(".tab").forEach(t => t.onclick = () => {
  document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
  document.querySelectorAll(".panel").forEach(x => x.classList.remove("active"));
  t.classList.add("active");
  $(t.dataset.tab).classList.add("active");
  if(t.dataset.tab==="batch" && typeof updateBatchApply==="function") updateBatchApply();
});

/* ================= SINGLE IMAGE ================= */
const cv = $("cv"), octx = $("overlay");
let img = null, imgW = 0, imgH = 0;
let pxPerCm = null;               // calibration
let lastResult = null;            // {mask, skel, traits, traces}
let ortSession = null, ortModelName = null, ortBackend = null;

$("imgFile").onchange = e => loadImage(e.target.files[0]);

AR_EST.load();                                              // load the ML lateral-trait estimator

/* ================= DOWNLOADABLE SUMMARY REPORT ================= */
function tracedImageURI(){
  const m=document.createElement("canvas"); m.width=cv.width; m.height=cv.height;
  const x=m.getContext("2d"); x.drawImage(cv,0,0); x.drawImage(octx,0,0); return m.toDataURL("image/jpeg",0.72);
}
function barChart(title, items, unit, color){                // items:[{label,value}] → inline SVG bar chart
  if(!items.length) return "";
  const W=520,H=60+items.length*26,padL=140,padR=40, max=Math.max(...items.map(i=>Math.abs(i.value)),1e-9);
  const zero = items.some(i=>i.value<0);
  const x0 = zero ? padL+(W-padL-padR)*0.5 : padL, span = zero ? (W-padL-padR)*0.5 : (W-padL-padR);
  const bars=items.map((it,i)=>{ const y=34+i*26, w=span*Math.abs(it.value)/max, bx=it.value<0?x0-w:x0;
    return `<rect x="${bx.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="16" fill="${it.color||color}"/>`+
      `<text x="${padL-6}" y="${y+12}" font-size="11" text-anchor="end" fill="#333">${esc(it.label)}</text>`+
      `<text x="${(it.value<0?bx-4:bx+w+4).toFixed(1)}" y="${y+12}" font-size="10" fill="#555" text-anchor="${it.value<0?'end':'start'}">${(+it.value).toFixed(1)}${unit||""}</text>`; }).join("");
  const axis = zero?`<line x1="${x0}" y1="26" x2="${x0}" y2="${H-14}" stroke="#bbb"/>`:"";
  return `<h3>${esc(title)}</h3><svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px">${axis}${bars}</svg>`;
}
function depthProfileSVG(prof){
  if(!prof||!prof.length) return ""; const W=420,H=150,pad=26, max=Math.max(...prof,1e-9), bw=(W-2*pad)/prof.length;
  const bars=prof.map((v,i)=>`<rect x="${(pad+i*bw+1).toFixed(1)}" y="${(H-pad-(H-2*pad)*v/max).toFixed(1)}" width="${(bw-2).toFixed(1)}" height="${((H-2*pad)*v/max).toFixed(1)}" fill="#1a7f37"/>`).join("");
  return `<h3>Root depth distribution</h3><svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px">${bars}`+
    `<line x1="${pad}" y1="${H-pad}" x2="${W-pad}" y2="${H-pad}" stroke="#ccc"/><text x="${pad}" y="${H-8}" font-size="10" fill="#777">top</text><text x="${W-pad}" y="${H-8}" font-size="10" fill="#777" text-anchor="end">tip →</text></svg>`;
}
function tableHTML(headers, rows){
  return `<table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>`+
    rows.map(r=>`<tr>${r.map(c=>`<td>${c==null?"—":esc(String(c))}</td>`).join("")}</tr>`).join("")+`</tbody></table>`;
}
function buildReport(){
  const name = ($("imgFile").files[0]?.name) || $("demoImg").value || "image";
  const t = lastResult && lastResult.traits, d = lastResult && lastResult.desc, e = lastResult && lastResult.est;
  const eng = ortSession?`RootNav2 (${ortBackend})`:"classical";
  const cal = pxPerCm ? `${pxPerCm.toFixed(1)} px/cm` : "uncalibrated (px)";
  let body = `<h1>AstroRoot — root analysis report</h1>
    <p class="meta"><b>${esc(name)}</b> · engine: ${esc(eng)} · scale: ${cal}${markerInfo?` · marker: ${esc(markerInfo.type)}`:""}</p>
    <img class="trace" src="${tracedImageURI()}" alt="traced root image"/>`;
  if(t) body += `<h2>Measurements — whole image</h2>`+tableHTML(["Length","Tips","Branches","Angle from vertical"],
    [[t.length, t.tips, t.branches, `${t.angle.toFixed(1)}°`]]);
  if(d) body += depthProfileSVG(d.depthProfile) + tableHTML(["Depth","Width:Depth","Mass-depth","Directionality","Solidity","Convex hull"],
    [[`${d.depth} ${d.unit}`, d.widthDepthRatio, d.comY, d.directionality, d.solidity, d.convexHull]]);
  if(e) body += `<h2>Estimated lateral traits <span class="tag">AI estimate</span></h2>`+
    tableHTML(["Est. #laterals","Lateral fraction","Est. lateral angle"],[[`~${e.n_laterals}`, e.lateral_fraction, `~${e.lat_angle}°`]])+
    `<p class="cap">Synthetic-trained estimate — treat as a guide, not an exact count.</p>`;
  if(editRoots.length && lastTrace){ const tt=lastTrace;
    body += `<h2>Manual trace</h2>`+tableHTML(["Roots","Total length","Tips","Laterals","Mean skew"],
      [[tt.count, `${tt.lengthVal} ${tt.lengthUnit}`, tt.tips, tt.branches, `${tt.angle}°`]]);
    if(tt.meanDiameter!=null) body += tableHTML(["Mean diameter","Total surface","Total volume"],
      [[`${tt.meanDiameter} ${tt.diaUnit}`, `${tt.surface} ${tt.diaUnit}²`, `${tt.volume} ${tt.diaUnit}³`]]); }
  if(roiResults.length){ body += `<h2>Per region</h2>`+
    tableHTML(["Region","Length","Tips","Branches","Angle°"], roiResults.map(r=>[r.name, `${r.traits.lengthVal.toFixed?r.traits.lengthVal.toFixed(1):r.traits.lengthVal} ${r.traits.lengthUnit}`, r.traits.tips, r.traits.branches, r.traits.angle.toFixed(1)]))+
    barChart("Mean angle by region", roiResults.map(r=>({label:r.name, value:r.traits.angle})), "°", "#0969da"); }
  if(plantResults.length){ const gcol={}; const pal=["#1a7f37","#0969da","#9a6700","#cf222e","#8250df"]; let gi=0;
    plantResults.forEach(p=>{ const g=p.geno||"—"; if(!(g in gcol)) gcol[g]=pal[gi++%pal.length]; });
    body += `<h2>Per plant</h2>`+
    tableHTML(["#","Genotype","Length","Tips","Skew°"], plantResults.map(p=>[p.plant, p.geno||"—", `${p.traits.lengthVal.toFixed?p.traits.lengthVal.toFixed(1):p.traits.lengthVal} ${p.traits.lengthUnit}`, p.traits.tips, p.skew.toFixed(1)]))+
    barChart("Skew by plant (colour = genotype)", plantResults.map(p=>({label:`#${p.plant} ${p.geno||""}`, value:p.skew, color:gcol[p.geno||"—"]})), "°", "#1a7f37");
    // genotype means
    const byG={}; plantResults.forEach(p=>{ const g=p.geno||"—"; (byG[g]=byG[g]||[]).push(p.skew); });
    body += barChart("Mean skew by genotype", Object.entries(byG).map(([g,a])=>({label:g, value:a.reduce((s,v)=>s+v,0)/a.length, color:gcol[g]})), "°", "#1a7f37"); }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AstroRoot report — ${esc(name)}</title><style>
body{font:14px/1.5 system-ui,Segoe UI,Roboto,sans-serif;color:#1f2328;max-width:760px;margin:24px auto;padding:0 16px}
h1{font-size:22px;margin:0 0 4px} h2{font-size:17px;border-bottom:1px solid #d0d7de;padding-bottom:4px;margin-top:26px}
h3{font-size:13px;color:#59636e;margin:14px 0 4px} .meta{color:#59636e} .cap{font-size:12px;color:#59636e}
img.trace{max-width:460px;border:1px solid #d0d7de;border-radius:8px;margin:8px 0}
table{border-collapse:collapse;width:100%;font-size:13px;margin:6px 0} th,td{border:1px solid #d0d7de;padding:5px 8px;text-align:left}
th{background:#f6f8fa} .tag{background:#9a6700;color:#fff;font-size:11px;border-radius:10px;padding:1px 7px;vertical-align:middle}
footer{margin-top:28px;color:#8b949e;font-size:12px;border-top:1px solid #d0d7de;padding-top:8px}
</style></head><body>${body}
<footer>Generated by <a href="https://dr-richard-barker.github.io/astroroot/">AstroRoot</a> · ${new Date().toISOString().slice(0,10)}</footer>
</body></html>`;
}
function showReportSection(){ if(lastResult) $("reportSection").hidden=false; }
$("genReport").onclick = () => { const name=(($("imgFile").files[0]?.name)||$("demoImg").value||"image").replace(/\.[^.]+$/,"");
  download(`astroroot_report_${name}.html`, buildReport(), "text/html"); };
$("reportPreview").onclick = () => { const b=$("reportPreviewBox");
  if(b.innerHTML){ b.innerHTML=""; return; }
  const f=document.createElement("iframe"); f.style="width:100%;height:520px;border:1px solid var(--edge);border-radius:8px;margin-top:8px;background:#fff";
  b.appendChild(f); f.srcdoc=buildReport(); };

/* demo/test images — NASA ABRS root timelapse (flight + ground) */
(async function initDemoImages(){
  try{
    const idx = await (await fetch("samples/images/index.json", {cache:"no-cache"})).json();
    const sel = $("demoImg");
    idx.files.forEach(f => sel.add(new Option(f.label, f.file)));
    sel.onchange = () => $("loadDemo").disabled = !sel.value;
  }catch(e){ /* offline or not served — leave the picker empty */ }
})();
async function fetchAsFile(path){
  const blob = await (await fetch(path)).blob();
  return new File([blob], path.split("/").pop(), {type: blob.type || "image/jpeg"});
}
$("loadDemo").onclick = async () => {
  const f = $("demoImg").value; if(!f) return;
  $("loadDemo").textContent = "loading…";
  try{ loadImage(await fetchAsFile(`samples/images/${encodeURIComponent(f)}`)); }
  catch(e){ alert("Could not load demo image: " + e.message); }
  $("loadDemo").textContent = "Load";
};
$("loadDemoBatch").onclick = async () => {
  $("loadDemoBatch").disabled = true; $("loadDemoBatch").textContent = "loading…";
  try{
    const idx = await (await fetch("samples/images/index.json", {cache:"no-cache"})).json();
    const dt = new DataTransfer();
    for(const f of idx.files) dt.items.add(await fetchAsFile(`samples/images/${encodeURIComponent(f.file)}`));
    $("batchFiles").files = dt.files; $("batchRun").disabled = false;
    $("loadDemoBatch").textContent = `✓ ${idx.files.length} loaded — press Process all`;
  }catch(e){ alert("Could not load demo set: " + e.message); $("loadDemoBatch").textContent = "Load demo set (8)"; }
  setTimeout(()=>{ $("loadDemoBatch").textContent = "Load demo set (8)"; $("loadDemoBatch").disabled = false; }, 4000);
};

function loadImage(file){
  if(!file) return;
  const im = new Image();
  im.onload = () => {
    img = im; imgW = im.naturalWidth; imgH = im.naturalHeight;
    const scale = Math.min(1, 760 / imgW);
    cv.width = $("overlay").width = Math.round(imgW*scale);
    cv.height = $("overlay").height = Math.round(imgH*scale);
    drawBase();
    lastResult = null; redrawOverlay();                      // keep any regions, drop old skeleton
    $("runBtn").disabled = false;
    ["csvBtn","rsmlBtn","pngBtn"].forEach(b => $(b).disabled = true);
    $("editRow").hidden = true;
    setTraits(null);
    if(rois.length) measureROIs();
  };
  im.src = URL.createObjectURL(file);
}
function clearOverlay(){ octx.getContext("2d").clearRect(0,0,octx.width,octx.height); }
function drawBase(){                                         // draw preview, grid-removed if toggled
  if(!img) return;
  const ctx = cv.getContext("2d"); ctx.drawImage(img, 0, 0, cv.width, cv.height);
  if($("deGrid").checked){ const d=ctx.getImageData(0,0,cv.width,cv.height); removeGrid(d.data, cv.width, cv.height); ctx.putImageData(d,0,0); }
}
$("deGrid").onchange = () => { if(img){ $("deGrid").parentElement.style.opacity="0.5"; setTimeout(()=>{ drawBase(); $("deGrid").parentElement.style.opacity="1"; }, 20); } };

/* ---------- calibration: click two marker points, enter their real distance ---------- */
let calPts = [];
$("calBtn").onclick = () => {
  calPts = []; $("calStatus").textContent = "click TWO points a known distance apart…";
  octx.onclick = ev => {
    const r = octx.getBoundingClientRect();
    calPts.push([ev.clientX - r.left, ev.clientY - r.top]);
    const c = octx.getContext("2d"); c.fillStyle = "#58a6ff";
    const p = calPts[calPts.length-1]; c.beginPath(); c.arc(p[0],p[1],4,0,7); c.fill();
    if(calPts.length === 2){
      octx.onclick = null;
      const dpx = Math.hypot(calPts[0][0]-calPts[1][0], calPts[0][1]-calPts[1][1]);
      const dispScale = imgW / cv.width;                       // overlay px -> image px
      const mm = prompt("Distance between the two points, in mm?", "10");
      const dmm = parseFloat(mm);
      if(dmm > 0){
        pxPerCm = (dpx*dispScale) / (dmm/10);
        $("calStatus").textContent = `calibrated: ${pxPerCm.toFixed(1)} px/cm`;
      } else { $("calStatus").textContent = "calibration cancelled"; }
    }
  };
};

/* ================= MARKER AUTODETECT (PlantCV-compatible) =================
 * Detects a colour card in the frame and derives BOTH a colour correction and the px->cm
 * scale from the known chip pitch — mirroring PlantCV's detect_color_card(color_chip_size=…).
 * This is a PlantCV-*compatible* in-browser detector (same card types + reference matrix),
 * not the Python code itself; the Python/cloud path can run PlantCV exactly. */
const CARD_SPECS = {   // rows x cols of chips, default centre-to-centre pitch (mm, editable)
  classic:   {rows:4, cols:6, pitchMM:40.6, refs:true},
  passport:  {rows:4, cols:6, pitchMM:12.5},
  mini:      {rows:4, cols:6, pitchMM:13.0},
  nano:      {rows:4, cols:6, pitchMM:5.0},
  cameratrax:{rows:4, cols:6, pitchMM:8.0},
  astro:     {rows:4, cols:6, pitchMM:10.0},   // AstroCalibration Spectrum (edit to your sticker)
};
// standard ColorChecker Classic sRGB references (row-major, 24 patches)
const REF24 = [[115,82,68],[194,150,130],[98,122,157],[87,108,67],[133,128,177],[103,189,170],
  [214,126,44],[80,91,166],[193,90,99],[94,60,108],[157,188,64],[224,163,46],
  [56,61,150],[70,148,73],[175,54,60],[231,199,31],[187,86,149],[8,133,161],
  [243,243,242],[200,200,200],[160,160,160],[122,122,122],[85,85,85],[52,52,52]];

let activeCorrection = null;   // {gain:[3], bias:[3]} colour correction applied before segmentation
let markerInfo = null;         // {type, pxPerCm, colorCorrected} recorded with saved results

function detectColorCard(rgba, w, h, spec){
  // 1. coarse "colourfulness" map -> bounding box of the busiest (card) region
  const G = 48, cw = Math.max(1,(w/G)|0), ch = Math.max(1,(h/G)|0);
  const gx = Math.ceil(w/cw), gy = Math.ceil(h/ch);
  const score = new Float32Array(gx*gy);
  for(let cyi=0;cyi<gy;cyi++)for(let cxi=0;cxi<gx;cxi++){
    let n=0,sr=0,sg=0,sb=0,sr2=0,sg2=0,sb2=0;
    for(let y=cyi*ch;y<Math.min(h,(cyi+1)*ch);y+=2)for(let x=cxi*cw;x<Math.min(w,(cxi+1)*cw);x+=2){
      const p=(y*w+x)*4, r=rgba[p],g=rgba[p+1],b=rgba[p+2];
      n++; sr+=r;sg+=g;sb+=b; sr2+=r*r;sg2+=g*g;sb2+=b*b;
    }
    if(!n) continue;
    const v=(sr2/n-(sr/n)**2)+(sg2/n-(sg/n)**2)+(sb2/n-(sb/n)**2);
    score[cyi*gx+cxi]=Math.sqrt(Math.max(0,v));
  }
  let mx=0; for(const s of score) mx=Math.max(mx,s);
  const thr=mx*0.35; if(mx<8) return {ok:false};
  let x0=gx,y0=gy,x1=-1,y1=-1,hot=0;
  for(let cyi=0;cyi<gy;cyi++)for(let cxi=0;cxi<gx;cxi++) if(score[cyi*gx+cxi]>=thr){
    hot++; x0=Math.min(x0,cxi);y0=Math.min(y0,cyi);x1=Math.max(x1,cxi);y1=Math.max(y1,cyi);
  }
  if(hot<4) return {ok:false};
  const bbox={x:x0*cw, y:y0*ch, w:(x1-x0+1)*cw, h:(y1-y0+1)*ch};
  // 2. sample rows x cols chip colours at cell centres
  const chips=[];
  for(let r=0;r<spec.rows;r++)for(let c=0;c<spec.cols;c++){
    const px=bbox.x+(c+0.5)*bbox.w/spec.cols, py=bbox.y+(r+0.5)*bbox.h/spec.rows;
    let n=0,ar=0,ag=0,ab=0, rad=Math.max(2,(Math.min(bbox.w/spec.cols,bbox.h/spec.rows)/6)|0);
    for(let dy=-rad;dy<=rad;dy++)for(let dx=-rad;dx<=rad;dx++){
      const xx=(px+dx)|0, yy=(py+dy)|0; if(xx<0||yy<0||xx>=w||yy>=h) continue;
      const p=(yy*w+xx)*4; ar+=rgba[p];ag+=rgba[p+1];ab+=rgba[p+2];n++;
    }
    chips.push([ar/n,ag/n,ab/n]);
  }
  return {ok:true, bbox, chips, spec};
}

function deriveCorrection(chips, spec){
  // classic card with references -> per-channel linear fit detected->reference; else grey-world white balance
  if(spec.refs && chips.length===REF24.length){
    const gain=[1,1,1], bias=[0,0,0];
    for(let ch=0;ch<3;ch++){
      let sx=0,sy=0,sxx=0,sxy=0,n=chips.length;
      for(let i=0;i<n;i++){ const x=chips[i][ch], y=REF24[i][ch]; sx+=x;sy+=y;sxx+=x*x;sxy+=x*y; }
      const d=n*sxx-sx*sx; if(Math.abs(d)>1e-6){ gain[ch]=(n*sxy-sx*sy)/d; bias[ch]=(sy-gain[ch]*sx)/n; }
    }
    return {gain, bias};
  }
  // grey-world: use low-saturation (neutral) chips, scale channels so their mean is grey
  const neutral=chips.filter(c=>{ const mx=Math.max(...c),mn=Math.min(...c); return mx-mn < 22; });
  const use=neutral.length>=2?neutral:chips;
  const mean=[0,0,0]; for(const c of use){ mean[0]+=c[0];mean[1]+=c[1];mean[2]+=c[2]; }
  mean.forEach((_,i)=>mean[i]/=use.length);
  const grey=(mean[0]+mean[1]+mean[2])/3;
  return {gain:[grey/(mean[0]||1),grey/(mean[1]||1),grey/(mean[2]||1)], bias:[0,0,0]};
}
function applyCorrection(rgba, corr){
  const {gain,bias}=corr;
  for(let i=0;i<rgba.length;i+=4){
    rgba[i]  =Math.max(0,Math.min(255, rgba[i]*gain[0]+bias[0]));
    rgba[i+1]=Math.max(0,Math.min(255, rgba[i+1]*gain[1]+bias[1]));
    rgba[i+2]=Math.max(0,Math.min(255, rgba[i+2]*gain[2]+bias[2]));
  }
}

/* marker UI */
$("markerType").onchange = () => {
  const t=$("markerType").value, spec=CARD_SPECS[t];
  $("chipMMwrap").hidden = !(spec || t==="size");
  if(spec) $("chipMM").value = spec.pitchMM;
  else if(t==="size") $("chipMM").value = "";
  $("detectBtn").disabled = !spec;
};
$("detectBtn").onclick = () => {
  if(!img){ alert("Load a photo first."); return; }
  const t=$("markerType").value, spec=CARD_SPECS[t]; if(!spec) return;
  const full = getImagePixels(img, imgW, imgH);
  const det = detectColorCard(full, imgW, imgH, spec);
  if(!det.ok){ $("calStatus").textContent = "card not found — try Manual 2-pt"; activeCorrection=null; return; }
  // scale from chip pitch
  const chipMM = parseFloat($("chipMM").value) || spec.pitchMM;
  const cellWpx = det.bbox.w / spec.cols;
  pxPerCm = cellWpx / (chipMM/10);
  // colour correction
  if($("colorCorrect").checked){ activeCorrection = deriveCorrection(det.chips, spec); }
  else activeCorrection = null;
  markerInfo = {type:t, pxPerCm, colorCorrected: !!activeCorrection};
  // draw bbox on overlay
  const c=octx.getContext("2d"); const sx=octx.width/imgW, sy=octx.height/imgH;
  c.strokeStyle="#58a6ff"; c.lineWidth=2; c.strokeRect(det.bbox.x*sx, det.bbox.y*sy, det.bbox.w*sx, det.bbox.h*sy);
  $("calStatus").textContent = `card found · ${pxPerCm.toFixed(1)} px/cm` + (activeCorrection?" · colour-corrected":"");
};

/* ---------- model selection ---------- */
$("modelSelect").onchange = e => pickModel(e.target.value, $("modelStatus"), $("modelFile"));
$("batchModel").onchange = e => pickModel(e.target.value, null, null);
$("modelFile").onchange = e => e.target.files[0] && loadOnnx(e.target.files[0], e.target.files[0].name);

function pickModel(val, statusEl, fileEl){
  if(val === "classical"){ ortSession = null; ortModelName = null; if(statusEl) statusEl.textContent = "classical baseline ready"; }
  else if(val === "arabidopsis"){ loadOnnx("models/arabidopsis.onnx", "Arabidopsis (RootNav2)", statusEl); }
  else if(val === "custom"){ if(fileEl) fileEl.click(); }
}

async function loadOnnx(src, name, statusEl){
  try{
    if(statusEl) statusEl.textContent = "loading model…";
    if(!window.ort) await loadScript(ORT_SRC);
    const data = (typeof src === "string")
      ? new Uint8Array(await (await fetch(src)).arrayBuffer())
      : new Uint8Array(await src.arrayBuffer());
    // WebGPU runs the hourglass net in ~1s; WASM (single-threaded on Pages) is the fallback.
    const eps = (navigator.gpu ? ["webgpu"] : []).concat(["wasm"]);
    ortSession = await window.ort.InferenceSession.create(data, {executionProviders:eps});
    ortBackend = ortSession.__ep = eps[0];
    ortModelName = name;
    if(statusEl) statusEl.textContent = `model ready: ${name}`;
  }catch(err){
    ortSession = null; ortModelName = null;
    if(statusEl) statusEl.textContent = "model not available — using classical baseline";
    console.warn("ONNX load failed:", err);
  }
}
function loadScript(src){ return new Promise((res,rej)=>{const s=document.createElement("script");s.src=src;s.onload=res;s.onerror=rej;document.head.appendChild(s);}); }

/* ---------- run ---------- */
$("runBtn").onclick = async () => {
  $("runBtn").disabled = true; $("runBtn").textContent = "tracing…";
  const P = prepImage(img, imgW, imgH);                     // cap working resolution
  if(activeCorrection && $("colorCorrect").checked) applyCorrection(P.rgba, activeCorrection);  // PlantCV-style colour norm
  if($("deGrid").checked){ $("runBtn").textContent="removing grid…"; await new Promise(r=>requestAnimationFrame(r)); removeGrid(P.rgba, P.w, P.h); $("runBtn").textContent="tracing…"; }
  let mask;
  if(ortSession){ try{ mask = await segmentOnnx(P.rgba, P.w, P.h); } catch(e){ console.warn(e); mask = segmentClassical(P.rgba, P.w, P.h); } }
  else mask = segmentClassical(P.rgba, P.w, P.h);
  const skel = zhangSuen(mask, P.w, P.h);
  const traits = measure(skel, P.w, P.h, pxPerCm, P.scale);
  lastResult = {mask, skel, traits, pw:P.w, ph:P.h, scale:P.scale};
  lastResult.desc = computeDescriptors(mask, skel, P.w, P.h, P.scale, pxPerCm);   // PRIMAL-style descriptors
  redrawOverlay();
  setTraits(traits);
  measureROIs();
  measurePlants();
  showReportSection();
  $("methodNote").textContent = ortSession
    ? `Traced with ${ortModelName} (${ortBackend}).` + (ortBackend==="wasm" ? " First run is slow without WebGPU — see docs." : "")
    : "Classical baseline (auto threshold + thinning). Load the Arabidopsis model for accuracy.";
  if(lastResult.desc){ const d=lastResult.desc;
    $("methodNote").textContent += ` · Descriptors: depth ${d.depth} ${d.unit}, W:D ${d.widthDepthRatio}, mass-depth ${d.comY}, directionality ${d.directionality}, solidity ${d.solidity}.`;
    lastResult.est = AR_EST.predict(d);                     // ML estimate of hidden lateral traits
    if(lastResult.est){ const e=lastResult.est;
      $("methodNote").textContent += ` · ML estimate: ~${e.n_laterals} laterals, lateral fraction ${e.lateral_fraction}, angle ~${e.lat_angle}° (synthetic-trained — treat as an estimate).`; }
  }
  ["csvBtn","rsmlBtn","pngBtn","saveDbBtn"].forEach(b => $(b).disabled = false);
  $("editRow").hidden = false;
  $("runBtn").disabled = false; $("runBtn").textContent = "Trace roots";
};

/* ---------- save to local database ---------- */
function thumbnail(){
  const t=document.createElement("canvas"); const s=Math.min(1,140/cv.width); t.width=cv.width*s; t.height=cv.height*s;
  const x=t.getContext("2d"); x.drawImage(cv,0,0,t.width,t.height); x.drawImage(octx,0,0,t.width,t.height);
  return t.toDataURL("image/jpeg",0.6);
}
function resultRecord(name, traits){
  return { ts: Date.now(), name: name||"seedling",
    engine: ortSession?`RootNav2 (${ortBackend})`:"classical",
    marker: markerInfo ? markerInfo.type : "manual", pxPerCm: pxPerCm||null, colorCorrected: !!(activeCorrection&&$("colorCorrect").checked),
    lengthVal: traits.lengthVal, lengthUnit: traits.lengthUnit, tips: traits.tips, branches: traits.branches, angle: +traits.angle.toFixed(1),
    thumb: null };
}
$("saveDbBtn").onclick = async () => {
  const manual = editRoots.length ? traceTraits() : null;
  const traits = manual || (lastResult && lastResult.traits);
  if(!traits) return;
  const rec = resultRecord($("imgFile").files[0]?.name || $("demoImg").value, traits);
  if(manual){ rec.engine = "manual trace";
    if(manual.meanDiameter!=null){ rec.meanDiameter=manual.meanDiameter; rec.surface=manual.surface; rec.volume=manual.volume; } }
  else if(lastResult && lastResult.desc) applyDesc(rec, lastResult.desc);        // PRIMAL descriptors
  rec.thumb = thumbnail();
  await AR_DB.save(rec);
  const n = await AR_DB.count();
  $("saveDbBtn").textContent = `✓ saved (${n} in DB)`;
  setTimeout(()=>$("saveDbBtn").textContent="💾 Save to database", 2500);
};

/* ---------- image -> grayscale pixel array ---------- */
function getImagePixels(image, w, h){
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d"); x.drawImage(image, 0, 0, w, h);
  return x.getImageData(0,0,w,h).data;
}
/* cap the working resolution so thinning stays fast on big phone photos.
 * scale = processed/original; length is converted back via this scale in measure(). */
const MAX_PROC = 1100;
function prepImage(image, w, h){
  const scale = Math.min(1, MAX_PROC / Math.max(w, h));
  const pw = Math.max(1, Math.round(w*scale)), ph = Math.max(1, Math.round(h*scale));
  const c = document.createElement("canvas"); c.width=pw; c.height=ph;
  c.getContext("2d").drawImage(image, 0, 0, pw, ph);
  return { rgba: c.getContext("2d").getImageData(0,0,pw,ph).data, w:pw, h:ph, scale };
}

/* ---------- classical segmentation: Otsu threshold on inverted-if-needed luminance ---------- */
function segmentClassical(rgba, w, h){
  const n = w*h, gray = new Uint8Array(n); let sum = 0;
  for(let i=0;i<n;i++){ const g = (rgba[i*4]*0.299 + rgba[i*4+1]*0.587 + rgba[i*4+2]*0.114)|0; gray[i]=g; sum+=g; }
  const mean = sum/n;
  const t = otsu(gray);
  // roots are usually darker than background; if background is dark, invert.
  let rootsAreDark = mean > t;
  const build = dark => { const m=new Uint8Array(n); let c=0;
    // Otsu can land on the darker cluster's value, so the dark side is inclusive (<=).
    for(let i=0;i<n;i++){ m[i]=(dark ? gray[i]<=t : gray[i]>t)?1:0; c+=m[i]; } return {m,c}; };
  let {m:mask,c} = build(rootsAreDark);
  if(c > n*0.5){ rootsAreDark=!rootsAreDark; mask=build(rootsAreDark).m; }   // roots are the minority class, never the background
  removeSpecks(mask, w, h, 20);
  return mask;
}
function otsu(gray){
  const hist = new Array(256).fill(0); for(const g of gray) hist[g]++;
  const total = gray.length; let sum = 0; for(let i=0;i<256;i++) sum += i*hist[i];
  let sumB=0, wB=0, max=0, thr=127;
  for(let i=0;i<256;i++){ wB+=hist[i]; if(!wB) continue; const wF=total-wB; if(!wF) break;
    sumB += i*hist[i]; const mB=sumB/wB, mF=(sum-sumB)/wF, between=wB*wF*(mB-mF)*(mB-mF);
    if(between>max){max=between;thr=i;} }
  return thr;
}
function removeSpecks(mask, w, h, minSize){
  const seen = new Uint8Array(mask.length), stack = [];
  for(let i=0;i<mask.length;i++){
    if(!mask[i]||seen[i]) continue;
    const comp=[]; stack.push(i); seen[i]=1;
    while(stack.length){ const p=stack.pop(); comp.push(p); const x=p%w,y=(p/w)|0;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){ const nx=x+dx,ny=y+dy;
        if(nx<0||ny<0||nx>=w||ny>=h) continue; const q=ny*w+nx;
        if(mask[q]&&!seen[q]){seen[q]=1;stack.push(q);} } }
    if(comp.length<minSize) for(const p of comp) mask[p]=0;
  }
}

/* ===== plate-grid removal — deterministic morphological filter (developed on the ABRS data).
 * White top-hat isolates thin bright features; directional opening keeps only the long
 * axis-aligned ones (the etched grid); those are inpainted (H-lines filled vertically,
 * V-lines horizontally). Not a trained model — periodic grids are better removed this way;
 * whatever it misses, the user hand-corrects. */
function toGrayF(rgba, n){ const g=new Float32Array(n); for(let i=0;i<n;i++) g[i]=rgba[i*4]*0.299+rgba[i*4+1]*0.587+rgba[i*4+2]*0.114; return g; }
function extreme1D(a, w, h, r, axis, isMax){
  let A=Float32Array.from(a), B=new Float32Array(a.length); const op=isMax?Math.max:Math.min;
  for(let s=0;s<r;s++){
    if(axis===1){ for(let y=0;y<h;y++){ const o=y*w; for(let x=0;x<w;x++){ const i=o+x; const l=x>0?A[i-1]:A[i], rr=x<w-1?A[i+1]:A[i]; B[i]=op(A[i],op(l,rr)); } } }
    else       { for(let y=0;y<h;y++){ const o=y*w; for(let x=0;x<w;x++){ const i=o+x; const u=y>0?A[i-w]:A[i], d=y<h-1?A[i+w]:A[i]; B[i]=op(A[i],op(u,d)); } } }
    const t=A; A=B; B=t;
  }
  return A;
}
const open1d=(a,w,h,r,axis)=>extreme1D(extreme1D(a,w,h,r,axis,false),w,h,r,axis,true);
function open2d(a,w,h,r){ const e=extreme1D(extreme1D(a,w,h,r,1,false),w,h,r,0,false); return extreme1D(extreme1D(e,w,h,r,1,true),w,h,r,0,true); }
function gridInpaint(rgba,w,h,mask,axis,iters){
  const n=w*h;
  for(let c=0;c<3;c++){
    let ch=new Float32Array(n), valid=new Uint8Array(n);
    for(let i=0;i<n;i++){ ch[i]=rgba[i*4+c]; valid[i]=mask[i]?0:1; }
    for(let it=0;it<iters;it++){
      const nch=Float32Array.from(ch), nv=Uint8Array.from(valid);
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){ const i=y*w+x; if(valid[i]||!mask[i]) continue;
        let m1,m2,s1=0,s2=0;
        if(axis===0){ m1=y>0&&valid[i-w]; m2=y<h-1&&valid[i+w]; if(m1)s1=ch[i-w]; if(m2)s2=ch[i+w]; }
        else        { m1=x>0&&valid[i-1]; m2=x<w-1&&valid[i+1]; if(m1)s1=ch[i-1]; if(m2)s2=ch[i+1]; }
        if(m1&&m2){ nch[i]=(s1+s2)/2; nv[i]=1; } else if(m1){ nch[i]=s1; nv[i]=1; } else if(m2){ nch[i]=s2; nv[i]=1; }
      }
      ch=nch; valid=nv;
    }
    for(let i=0;i<n;i++) rgba[i*4+c]=Math.max(0,Math.min(255,ch[i]));
  }
}
function removeGrid(rgba, w, h){
  // morphology cost scales with size; cap the working resolution at 640px (grid detection is
  // coarse), clean there, and scale the cleaned image back — keeps it well under a second.
  const MAXG=640, mx=Math.max(w,h);
  if(mx>MAXG){
    const s=MAXG/mx, dw=Math.max(1,Math.round(w*s)), dh=Math.max(1,Math.round(h*s));
    const full=document.createElement("canvas"); full.width=w; full.height=h;
    full.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(rgba),w,h),0,0);
    const small=document.createElement("canvas"); small.width=dw; small.height=dh;
    const sx=small.getContext("2d"); sx.drawImage(full,0,0,dw,dh);
    const sd=sx.getImageData(0,0,dw,dh); removeGridCore(sd.data,dw,dh); sx.putImageData(sd,0,0);
    const up=document.createElement("canvas"); up.width=w; up.height=h;
    const ux=up.getContext("2d"); ux.imageSmoothingEnabled=true; ux.drawImage(small,0,0,w,h);
    rgba.set(ux.getImageData(0,0,w,h).data); return;
  }
  removeGridCore(rgba,w,h);
}
function removeGridCore(rgba, w, h){
  const n=w*h, g=toGrayF(rgba,n), bg=open2d(g,w,h,7);
  const th=new Float32Array(n); for(let i=0;i<n;i++) th[i]=Math.max(0,g[i]-bg[i]);
  const rH=open1d(th,w,h,Math.max(4,(w/14)|0),1), rV=open1d(th,w,h,Math.max(4,(h/6)|0),0);
  const thr=r=>{ let s=0,c=0; for(const v of r) if(v>0){s+=v;c++;} const m=c?s/c:0; let sd=0; for(const v of r) if(v>0) sd+=(v-m)*(v-m); return m+(c?Math.sqrt(sd/c):0); };
  const tH=thr(rH), tV=thr(rV); const gh=new Uint8Array(n), gv=new Uint8Array(n); let cnt=0;
  for(let i=0;i<n;i++){ gh[i]=rH[i]>tH?1:0; gv[i]=rV[i]>tV?1:0; if(gh[i]||gv[i])cnt++; }
  gridInpaint(rgba,w,h,gh,0,10); gridInpaint(rgba,w,h,gv,1,10);
  return cnt/n;
}

/* ---------- ONNX segmentation (RootNav 2.0 arabidopsis_plate) ----------
 * Spec from arabidopsis_plate.json: input 1024x1024 RGB in RAW 0-255 (scale=1, NOT /255);
 * output [1,6,512,512] where segmentation channels are Background=0, Primary=1, Lateral=3
 * (channels 2,4,5 are Seed/Primary/Lateral heatmaps). A pixel is "root" when Primary or
 * Lateral segmentation beats Background. */
const ONNX_IN = 1024, SEG_BG = 0, SEG_PRIMARY = 1, SEG_LATERAL = 3;
async function segmentOnnx(rgba, w, h){
  const c = document.createElement("canvas"); c.width=ONNX_IN; c.height=ONNX_IN;
  const x = c.getContext("2d"); const tmp = document.createElement("canvas");
  tmp.width=w; tmp.height=h; tmp.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
  x.drawImage(tmp, 0, 0, ONNX_IN, ONNX_IN);
  const d = x.getImageData(0,0,ONNX_IN,ONNX_IN).data, plane = ONNX_IN*ONNX_IN;
  const input = new Float32Array(3*plane);                  // CHW, RAW 0-255
  for(let i=0;i<plane;i++){ input[i]=d[i*4]; input[plane+i]=d[i*4+1]; input[2*plane+i]=d[i*4+2]; }
  const feeds = {}; feeds[ortSession.inputNames[0]] = new window.ort.Tensor("float32", input, [1,3,ONNX_IN,ONNX_IN]);
  const out = await ortSession.run(feeds);
  const o = out[ortSession.outputNames[0]];                 // [1,6,512,512]
  const hh = o.dims[2], ww = o.dims[3], p = hh*ww;
  const mask = new Uint8Array(w*h);
  for(let y=0;y<h;y++)for(let X=0;X<w;X++){
    const sy=(y/h*hh)|0, sx=(X/w*ww)|0, k=sy*ww+sx;
    const bg=o.data[SEG_BG*p+k], pr=o.data[SEG_PRIMARY*p+k], la=o.data[SEG_LATERAL*p+k];
    mask[y*w+X] = (pr>bg || la>bg) ? 1 : 0;                 // root = primary or lateral > background
  }
  removeSpecks(mask,w,h,20);
  return mask;
}

/* ---------- Zhang-Suen thinning -> 1px skeleton ---------- */
function zhangSuen(mask, w, h){
  const im = Uint8Array.from(mask); let changed = true;
  const idx=(x,y)=>y*w+x;
  const nb=(x,y)=>[im[idx(x,y-1)],im[idx(x+1,y-1)],im[idx(x+1,y)],im[idx(x+1,y+1)],
                   im[idx(x,y+1)],im[idx(x-1,y+1)],im[idx(x-1,y)],im[idx(x-1,y-1)]];
  function pass(step){
    const del=[];
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
      if(!im[idx(x,y)]) continue;
      const p=nb(x,y); let B=0; for(const v of p) B+=v;
      if(B<2||B>6) continue;
      let A=0; for(let i=0;i<8;i++) if(!p[i]&&p[(i+1)%8]) A++;
      if(A!==1) continue;
      const [n0,n1,n2,n3,n4,n5,n6,n7]=p;
      if(step===0){ if(n0&&n2&&n4) continue; if(n2&&n4&&n6) continue; }
      else { if(n0&&n2&&n6) continue; if(n0&&n4&&n6) continue; }
      del.push(idx(x,y));
    }
    for(const p of del) im[p]=0; return del.length>0;
  }
  while(changed){ changed=false; if(pass(0)) changed=true; if(pass(1)) changed=true; }
  return im;
}

/* ---------- measure skeleton: length, tips, branches, mean angle ---------- */
function measure(skel, w, h, ppc, procScale=1){
  let len=0, angSum=0, angN=0;
  const idx=(x,y)=>y*w+x;
  const tipPx=[], branchPx=[];
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
    if(!skel[idx(x,y)]) continue;
    len++;
    let deg=0, dxs=0, dys=0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dy) continue;
      if(skel[idx(x+dx,y+dy)]){ deg++; dxs+=dx; dys+=dy; }
    }
    if(deg===1) tipPx.push(idx(x,y));
    else if(deg>=3) branchPx.push(idx(x,y));
    if(deg>=1){ const a=Math.abs(Math.atan2(dxs, -dys))*180/Math.PI; angSum+=Math.min(a,180-a); angN++; }
  }
  // one junction can span several deg>=3 pixels — cluster 8-connected special pixels so the
  // count reflects real tips/branch points, not skeleton bookkeeping.
  const tips = clusterCount(tipPx, w), branches = clusterCount(branchPx, w);
  const origLen = len / procScale;                          // convert processed px -> original px
  const lenCm = ppc ? origLen/ppc : null;
  return {
    lengthPx: Math.round(origLen),
    length: lenCm!=null ? `${lenCm.toFixed(2)} cm` : `${Math.round(origLen)} px`,
    lengthVal: lenCm!=null ? lenCm : Math.round(origLen),
    lengthUnit: lenCm!=null ? "cm" : "px",
    tips, branches,
    angle: angN ? (angSum/angN) : 0
  };
}

function clusterCount(pixels, w){
  // count 8-connected clusters among a sparse pixel set
  const set = new Set(pixels); let clusters = 0;
  const seen = new Set();
  for(const p of pixels){
    if(seen.has(p)) continue;
    clusters++; const stack=[p]; seen.add(p);
    while(stack.length){ const q=stack.pop(); const x=q%w, y=(q/w)|0;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){ if(!dx&&!dy) continue;
        const r=(y+dy)*w+(x+dx); if(set.has(r)&&!seen.has(r)){ seen.add(r); stack.push(r); } } }
  }
  return clusters;
}

/* ===== PRIMAL-inspired root descriptors (independently reimplemented; PRIMAL is unlicensed
 * R/Shiny, so concept-only — see docs). Computed from the root mask + skeleton. These are also
 * the input features for a future ML hidden-trait estimator (n_laterals / density / angle). */
function convexArea(p){
  if(p.length<3) return 0;
  p=p.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
  const lo=[],up=[];
  for(const q of p){ while(lo.length>=2&&cross(lo[lo.length-2],lo[lo.length-1],q)<=0)lo.pop(); lo.push(q); }
  for(let i=p.length-1;i>=0;i--){ const q=p[i]; while(up.length>=2&&cross(up[up.length-2],up[up.length-1],q)<=0)up.pop(); up.push(q); }
  const h=lo.slice(0,-1).concat(up.slice(0,-1)); let a=0;
  for(let i=0;i<h.length;i++){ const j=(i+1)%h.length; a+=h[i][0]*h[j][1]-h[j][0]*h[i][1]; }
  return Math.abs(a)/2;
}
function computeDescriptors(mask, skel, pw, ph, scale, ppc){
  let minx=pw,maxx=-1,miny=ph,maxy=-1, area=0, sxSum=0, sySum=0;
  for(let y=0;y<ph;y++)for(let x=0;x<pw;x++){ if(!mask[y*pw+x]) continue;
    area++; sxSum+=x; sySum+=y; if(x<minx)minx=x; if(x>maxx)maxx=x; if(y<miny)miny=y; if(y>maxy)maxy=y; }
  if(area===0) return null;
  const wpx=maxx-minx+1, hpx=maxy-miny+1;
  const toLen = v => ppc ? v/scale/ppc : v/scale;                    // proc px -> cm or image px
  const unit = ppc ? "cm" : "px";
  // 30-bin depth profile: mean number of root "crossings" (separate runs) per row, by depth
  const BINS=30, prof=new Array(BINS).fill(0), nrow=new Array(BINS).fill(0);
  for(let y=miny;y<=maxy;y++){ let runs=0, on=false;
    for(let x=minx;x<=maxx;x++){ const v=!!mask[y*pw+x]; if(v&&!on){runs++;on=true;} else if(!v)on=false; }
    const b=Math.min(BINS-1, Math.floor((y-miny)/(hpx||1)*BINS)); prof[b]+=runs; nrow[b]++; }
  for(let b=0;b<BINS;b++) prof[b] = nrow[b] ? +(prof[b]/nrow[b]).toFixed(2) : 0;
  // convex hull from per-row left/right extremes
  const pts=[]; for(let y=miny;y<=maxy;y++){ let lo=-1,hi=-1;
    for(let x=minx;x<=maxx;x++){ if(mask[y*pw+x]){ if(lo<0)lo=x; hi=x; } } if(lo>=0){ pts.push([lo,y]); pts.push([hi,y]); } }
  const hull=convexArea(pts);
  // skeleton length + orientation coherence (directionality 0..1)
  let slen=0, C=0, S=0, N=0;
  for(let y=1;y<ph-1;y++)for(let x=1;x<pw-1;x++){ if(!skel[y*pw+x]) continue; slen++;
    let dxs=0,dys=0,deg=0; for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){ if(!dx&&!dy)continue; if(skel[(y+dy)*pw+(x+dx)]){deg++;dxs+=dx;dys+=dy;} }
    if(deg>=1){ const a=Math.atan2(dxs,dys); C+=Math.cos(2*a); S+=Math.sin(2*a); N++; } }
  return {
    depthProfile: prof, unit,
    width:+toLen(wpx).toFixed(2), depth:+toLen(hpx).toFixed(2), widthDepthRatio:+(wpx/hpx).toFixed(3),
    convexHull: ppc ? +(hull/scale/scale/ppc/ppc).toFixed(2) : +(hull/scale/scale).toFixed(1),
    comY:+((sySum/area-miny)/(hpx||1)).toFixed(3), comX:+((sxSum/area-minx)/(wpx||1)).toFixed(3),
    directionality: N ? +(Math.hypot(C,S)/N).toFixed(3) : 0,
    meanDiameter: slen ? +toLen(area/slen).toFixed(3) : 0,
    solidity:+(area/(hull||1)).toFixed(3)
  };
}
function applyDesc(rec, d){                                          // merge descriptor fields onto a DB record
  if(!d) return; for(const k of ["width","depth","widthDepthRatio","convexHull","comY","comX","directionality","meanDiameter","solidity"]) rec[k]=d[k];
  rec.depthProfile = d.depthProfile;
  const e = (typeof AR_EST!=="undefined") ? AR_EST.predict(d) : null;   // ML hidden-trait estimate
  if(e){ rec.est_n_laterals=e.n_laterals; rec.est_lat_angle=e.lat_angle; rec.est_lateral_fraction=e.lateral_fraction; }
}

/* ---------- draw + results ---------- */
function redrawOverlay(){
  const c = octx.getContext("2d"); c.clearRect(0,0,octx.width,octx.height);
  if(lastResult && lastResult.skel){                        // skeleton
    const {skel,pw,ph}=lastResult, sx=octx.width/pw, sy=octx.height/ph;
    c.fillStyle="#3fb950";
    for(let y=0;y<ph;y++)for(let x=0;x<pw;x++) if(skel[y*pw+x]) c.fillRect(x*sx, y*sy, Math.max(1,sx), Math.max(1,sy));
  }
  for(const r of rois){                                     // named regions
    const x=r.x0*octx.width, y=r.y0*octx.height, w=(r.x1-r.x0)*octx.width, h=(r.y1-r.y0)*octx.height;
    c.strokeStyle="#d29922"; c.lineWidth=2; c.strokeRect(x,y,w,h);
    c.fillStyle="#d29922"; c.font="bold 12px system-ui";
    c.fillText(r.name, x+4, y+14 > y+h ? y+h-4 : y+14);
  }
  if(roiDrag){ const {x0,y0,x1,y1}=roiDrag; c.strokeStyle="#f0b429"; c.setLineDash([5,4]);
    c.strokeRect(Math.min(x0,x1),Math.min(y0,y1),Math.abs(x1-x0),Math.abs(y1-y0)); c.setLineDash([]); }
  seeds.forEach((s,i)=>{                                     // numbered seed points (root origins)
    const x=s.x*octx.width, y=s.y*octx.height;
    c.fillStyle="#3fb950"; c.strokeStyle="#0d1117"; c.lineWidth=1.5;
    c.beginPath(); c.arc(x,y,6,0,7); c.fill(); c.stroke();
    c.fillStyle="#fff"; c.font="bold 9px system-ui"; c.textAlign="center"; c.textBaseline="middle";
    c.fillText(String(i+1),x,y); c.textAlign="left"; c.textBaseline="alphabetic";
  });
  drawTrace(c);
}
let smoothTrace = true;
function splinePoints(nodes){                                // Catmull-Rom spline through the control nodes
  if(!smoothTrace || nodes.length<3) return nodes;
  const P=i=>nodes[Math.max(0,Math.min(nodes.length-1,i))], S=6, out=[];
  for(let i=0;i<nodes.length-1;i++){ const p0=P(i-1),p1=P(i),p2=P(i+1),p3=P(i+2);
    for(let s=0;s<S;s++){ const t=s/S,t2=t*t,t3=t2*t;
      out.push([0.5*(2*p1[0]+(-p0[0]+p2[0])*t+(2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t2+(-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t3),
                0.5*(2*p1[1]+(-p0[1]+p2[1])*t+(2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t2+(-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t3)]); } }
  out.push(nodes[nodes.length-1]); return out;
}
$("traceSmooth").onclick = () => { smoothTrace=!smoothTrace; $("traceSmooth").classList.toggle("primary", smoothTrace); redrawOverlay(); computeTraceTraits(); };
const ORDER_COL = o => o<=1?"#f0b429":o===2?"#58a6ff":"#e668a7";     // primary / lateral / higher-order
function drawTrace(c){
  editRoots.forEach(r=>{
    if(r.nodes.length<1) return;
    const ctrl=r.nodes.map(n=>[n[0]*octx.width, n[1]*octx.height]);
    const line=splinePoints(r.nodes).map(n=>[n[0]*octx.width, n[1]*octx.height]);
    if(line.length>=2){ c.strokeStyle=ORDER_COL(r.order); c.lineWidth=(r.id===selRoot?3.5:2); c.lineJoin="round"; c.lineCap="round";
      c.beginPath(); line.forEach((p,i)=> i?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1])); c.stroke(); }
    if(traceMode){ ctrl.forEach((p,i)=>{ c.beginPath(); c.arc(p[0],p[1], i===0?5:3.5, 0,7);
      c.fillStyle = i===0?ORDER_COL(r.order):"#fff"; c.strokeStyle=ORDER_COL(r.order); c.lineWidth=1.5; c.fill(); c.stroke(); }); }
  });
  if(traceMode && liveWire && liveWire.points.length>=2){       // NeuronJ-style live-wire preview
    c.strokeStyle="#f0b429"; c.lineWidth=2; c.setLineDash([6,4]); c.beginPath();
    liveWire.points.forEach((p,i)=> i?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1])); c.stroke(); c.setLineDash([]);
  }
  if(traceMode && routeStart){                                   // pending route start
    c.beginPath(); c.arc(routeStart.px,routeStart.py,6,0,7); c.fillStyle="#f0b429"; c.fill();
    c.strokeStyle="#0d1117"; c.lineWidth=1.5; c.stroke();
  }
}

/* ---------- regions of interest (label roots by area, e.g. genotype) ---------- */
let rois = [], roiMode = false, roiDrag = null, roiResults = [];
$("roiDraw").onclick = () => { roiMode = !roiMode; $("roiDraw").classList.toggle("primary", roiMode);
  $("roiHint").textContent = roiMode ? "drag a box on the image, then name it" : "Draw boxes to label roots by area — e.g. one box per genotype.";
  octx.style.cursor = roiMode ? "crosshair" : "default"; };
$("roiClear").onclick = () => { rois=[]; roiResults=[]; $("roiResults").hidden=true; $("measScope").textContent="(whole image)"; redrawOverlay(); };
octx.addEventListener("mousedown", e => { if(!roiMode||!img) return; const r=octx.getBoundingClientRect();
  roiDrag={x0:e.clientX-r.left, y0:e.clientY-r.top, x1:e.clientX-r.left, y1:e.clientY-r.top}; });
octx.addEventListener("mousemove", e => { if(!roiDrag) return; const r=octx.getBoundingClientRect();
  roiDrag.x1=e.clientX-r.left; roiDrag.y1=e.clientY-r.top; redrawOverlay(); });
octx.addEventListener("mouseup", () => { if(!roiDrag) return; const d=roiDrag; roiDrag=null;
  const x0=Math.min(d.x0,d.x1),y0=Math.min(d.y0,d.y1),x1=Math.max(d.x0,d.x1),y1=Math.max(d.y0,d.y1);
  if(x1-x0<8||y1-y0<8){ redrawOverlay(); return; }
  const name=prompt("Name this region (e.g. a genotype or factor):", `region ${rois.length+1}`);
  if(name && name.trim()) rois.push({name:name.trim(), x0:x0/octx.width, y0:y0/octx.height, x1:x1/octx.width, y1:y1/octx.height});
  redrawOverlay(); if(lastResult) measureROIs(); });

function computeRegionResults(skel, pw, ph, scale){        // shared by Single + Batch
  return rois.map(r => {
    const rx0=Math.max(0,Math.floor(r.x0*pw)), ry0=Math.max(0,Math.floor(r.y0*ph)),
          rx1=Math.min(pw,Math.ceil(r.x1*pw)), ry1=Math.min(ph,Math.ceil(r.y1*ph));
    const sub=new Uint8Array(pw*ph);
    for(let y=ry0;y<ry1;y++)for(let x=rx0;x<rx1;x++) if(skel[y*pw+x]) sub[y*pw+x]=1;
    return { name:r.name, traits: measure(sub, pw, ph, pxPerCm, scale) };
  });
}
function measureROIs(){
  if(!rois.length || !lastResult){ $("roiResults").hidden=true; $("measScope").textContent="(whole image)"; return; }
  roiResults = computeRegionResults(lastResult.skel, lastResult.pw, lastResult.ph, lastResult.scale||1);
  const u = roiResults[0]?.traits.lengthUnit || "px";
  $("roiTable").innerHTML = `<thead><tr><th>Region</th><th>Length</th><th>Tips</th><th>Br.</th><th>Angle°</th></tr></thead><tbody>`+
    roiResults.map(x=>`<tr><td>${esc(x.name)}</td><td>${x.traits.lengthVal.toFixed?x.traits.lengthVal.toFixed(2):x.traits.lengthVal} ${x.traits.lengthUnit}</td>`+
      `<td>${x.traits.tips}</td><td>${x.traits.branches}</td><td>${x.traits.angle.toFixed(1)}</td></tr>`).join("")+`</tbody>`;
  $("roiResults").hidden=false; $("measScope").textContent=`(+ ${rois.length} region${rois.length>1?"s":""})`;
}
function esc(s){ return String(s==null?"":s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }
$("roiSaveDb").onclick = async () => {
  if(!roiResults.length) return;
  const imgName = $("imgFile").files[0]?.name || $("demoImg").value || "image";
  const recs = roiResults.map(x => { const rec = resultRecord(`${imgName} · ${x.name}`, x.traits);
    rec.group = x.name; rec.thumb = thumbnail(); return rec; });
  await AR_DB.saveMany(recs);
  const n = await AR_DB.count();
  $("roiSaveDb").textContent = `✓ saved ${recs.length} region(s) (${n} in DB)`;
  setTimeout(()=>$("roiSaveDb").textContent="💾 Save regions to database", 2500);
};

/* ---------- plants / seed points (root origins) → per-plant traits ---------- */
let seeds = [], seedMode = false, plantResults = [];
$("seedDraw").onclick = () => { seedMode = !seedMode; if(seedMode){ roiMode=false; $("roiDraw").classList.remove("primary"); }
  $("seedDraw").classList.toggle("primary", seedMode);
  $("seedHint").textContent = seedMode ? "click each seed position (root start); click again to add more" : "Mark where each seed was sown (the root's starting point) → per-plant traits.";
  octx.style.cursor = seedMode ? "cell" : "default"; };
$("seedClear").onclick = () => { seeds=[]; plantResults=[]; $("plantResults").hidden=true; redrawOverlay(); };
octx.addEventListener("mousedown", e => { if(!seedMode||!img) return; const r=octx.getBoundingClientRect();
  seeds.push({x:(e.clientX-r.left)/octx.width, y:(e.clientY-r.top)/octx.height}); redrawOverlay(); if(lastResult) measurePlants(); });
$("seedAuto").onclick = () => {
  if(!img){ alert("Load an image first."); return; }
  const n = Math.max(1, parseInt($("plantN").value)||11);
  const px = getImagePixels(img, imgW, imgH), bandH = Math.max(4, (imgH*0.18)|0);
  const col = new Float32Array(imgW);
  for(let y=0;y<bandH;y++)for(let x=0;x<imgW;x++){ const p=(y*imgW+x)*4; col[x]+=0.299*px[p]+0.587*px[p+1]+0.114*px[p+2]; }
  const sep = Math.max(6, (imgW/(n*1.8))|0), order=[...col.keys()].sort((a,b)=>col[b]-col[a]), peaks=[];
  for(const x of order){ if(peaks.every(p=>Math.abs(p-x)>sep)){ peaks.push(x); if(peaks.length>=n) break; } }
  peaks.sort((a,b)=>a-b);
  seeds = peaks.map(x=>({x:x/imgW, y:0.12}));
  redrawOverlay(); if(lastResult) measurePlants();
};

function computePlantResults(skel, pw, ph, scale){        // shared by Single + Batch
  const sx = seeds.map(s=>s.x*pw);
  const subs = seeds.map(()=>new Uint8Array(pw*ph));
  for(let y=0;y<ph;y++)for(let x=0;x<pw;x++){ if(!skel[y*pw+x]) continue;    // assign to nearest seed by column
    let best=0,bd=Infinity; for(let i=0;i<sx.length;i++){ const d=Math.abs(x-sx[i]); if(d<bd){bd=d;best=i;} }
    subs[best][y*pw+x]=1;
  }
  return seeds.map((s,i)=>{
    const t=measure(subs[i],pw,ph,pxPerCm,scale);
    let tipx=-1,tipy=-1;                                                     // lowest point = root tip
    for(let y=ph-1;y>=0 && tipy<0;y--)for(let x=0;x<pw;x++) if(subs[i][y*pw+x]){ tipx=x; tipy=y; break; }
    const skew = tipy>=0 ? Math.atan2(tipx-s.x*pw, Math.max(1,tipy-s.y*ph))*180/Math.PI : 0;  // signed seed→tip skew
    const geno = (rois.find(r=> s.x>=r.x0&&s.x<=r.x1&&s.y>=r.y0&&s.y<=r.y1)||{}).name || null;
    return { plant:i+1, geno, traits:t, skew:+skew.toFixed(1) };
  });
}
function measurePlants(){
  if(!seeds.length || !lastResult){ $("plantResults").hidden=true; return; }
  plantResults = computePlantResults(lastResult.skel, lastResult.pw, lastResult.ph, lastResult.scale||1);
  const u = plantResults[0]?.traits.lengthUnit || "px";
  $("plantCount").textContent = `(${seeds.length} plant${seeds.length>1?"s":""}${rois.length?" · genotype from region":""})`;
  $("plantTable").innerHTML = `<thead><tr><th>#</th>${rois.length?"<th>Genotype</th>":""}<th>Length</th><th>Tips</th><th>Skew°</th></tr></thead><tbody>`+
    plantResults.map(p=>`<tr><td>${p.plant}</td>${rois.length?`<td>${esc(p.geno||"—")}</td>`:""}`+
      `<td>${p.traits.lengthVal.toFixed?p.traits.lengthVal.toFixed(1):p.traits.lengthVal} ${p.traits.lengthUnit}</td>`+
      `<td>${p.traits.tips}</td><td>${p.skew.toFixed(1)}</td></tr>`).join("")+`</tbody>`;
  $("plantResults").hidden=false;
}
$("plantSaveDb").onclick = async () => {
  if(!plantResults.length) return;
  const imgName = $("imgFile").files[0]?.name || $("demoImg").value || "image";
  const recs = plantResults.map(p => { const rec = resultRecord(`${imgName} · plant ${p.plant}${p.geno?" ("+p.geno+")":""}`, p.traits);
    rec.group = p.geno || "plant"; rec.angle = p.skew; rec.thumb = thumbnail(); return rec; });   // per-plant angle = seed→tip skew
  await AR_DB.saveMany(recs);
  const n = await AR_DB.count();
  $("plantSaveDb").textContent = `✓ saved ${recs.length} plant(s) (${n} in DB)`;
  setTimeout(()=>$("plantSaveDb").textContent="💾 Save plants to database", 2500);
};

/* ============ MANUAL TRACE EDITOR (RootNav 1-style node/branch control) ============
 * Roots are polylines of draggable nodes with a parent hierarchy (primary → laterals).
 * Draw: click to lay nodes; starting on an existing root branches a lateral. Edit: drag a node,
 * click a segment to insert one, shift/right-click a node to delete, Delete removes a root+subtree.
 * Measurements + RSML come from what you actually traced (no dependence on the noisy skeleton). */
let traceMode=false, editSub="draw", editRoots=[], activeRoot=null, selRoot=null, dragNode=null, rootIdSeq=0, routeStart=null;
const rootById = id => editRoots.find(r=>r.id===id);
const toNorm = (px,py) => [px/octx.width, py/octx.height];
const toDisp = n => [n[0]*octx.width, n[1]*octx.height];
function nearestNode(px,py,thr=10){ let best=null;
  editRoots.forEach(r=>r.nodes.forEach((n,ni)=>{ const [x,y]=toDisp(n); const d=Math.hypot(x-px,y-py);
    if(d<thr&&(!best||d<best.d)) best={id:r.id,ni,d}; })); return best; }
function nearestSeg(px,py,thr=9){ let best=null;
  editRoots.forEach(r=>{ for(let i=0;i<r.nodes.length-1;i++){ const a=toDisp(r.nodes[i]),b=toDisp(r.nodes[i+1]);
    const dx=b[0]-a[0],dy=b[1]-a[1], L2=dx*dx+dy*dy||1, t=Math.max(0,Math.min(1,((px-a[0])*dx+(py-a[1])*dy)/L2));
    const cx=a[0]+t*dx, cy=a[1]+t*dy, d=Math.hypot(cx-px,cy-py);
    if(d<thr&&(!best||d<best.d)) best={id:r.id,seg:i,cx,cy,d}; } }); return best; }

function traceSetSub(sub){ editSub=sub; activeRoot=null; routeStart=null; liveWire=null;
  $("traceDrawBtn").classList.toggle("primary", sub==="draw");
  $("traceEditBtn").classList.toggle("primary", sub==="edit");
  $("traceRouteBtn").classList.toggle("primary", sub==="route");
  $("traceHint").textContent = sub==="draw" ? "Click to lay nodes; double-click to finish. Start on a root to branch a lateral."
    : sub==="route" ? "Click a START (a seed, or on a root for a lateral), then move toward the TIP — the wire snaps along the root live; click to commit. Hold Shift for a straight line."
    : "Drag a node to move · click a segment to insert · shift-click a node to delete · Delete key removes a root."; }
$("traceToggle").onclick = () => { traceMode=!traceMode;
  if(traceMode){ roiMode=false; seedMode=false; $("roiDraw").classList.remove("primary"); $("seedDraw").classList.remove("primary"); }
  $("traceToggle").classList.toggle("primary", traceMode); $("traceTools").hidden=!traceMode;
  octx.style.cursor = traceMode ? "crosshair" : "default";
  if(traceMode) traceSetSub("draw"); else $("traceHint").textContent="Hand-trace roots: click to lay nodes, drag to adjust; start on an existing root to branch a lateral.";
  redrawOverlay(); };
$("traceDrawBtn").onclick = () => traceSetSub("draw");
$("traceEditBtn").onclick = () => traceSetSub("edit");
$("traceRouteBtn").onclick = () => traceSetSub("route");
$("traceClear").onclick = () => { editRoots=[]; activeRoot=selRoot=null; redrawOverlay(); };

octx.addEventListener("pointerdown", e => {
  if(!traceMode||!img) return; e.preventDefault();
  const r=octx.getBoundingClientRect(), px=e.clientX-r.left, py=e.clientY-r.top;
  if(editSub==="draw"){
    if(activeRoot===null){
      const seg=nearestSeg(px,py,10);
      if(seg){ const parent=rootById(seg.id);                    // branch a lateral from an existing root
        editRoots.push({id:++rootIdSeq, order:parent.order+1, parent:parent.id, nodes:[toNorm(seg.cx,seg.cy)]}); }
      else { let sx=px,sy=py;                                    // new primary; snap to a nearby seed
        for(const s of seeds){ const [dx,dy]=toDisp([s.x,s.y]); if(Math.hypot(dx-px,dy-py)<16){ sx=dx; sy=dy; break; } }
        editRoots.push({id:++rootIdSeq, order:1, parent:null, nodes:[toNorm(sx,sy)]}); }
      activeRoot=editRoots[editRoots.length-1].id; selRoot=activeRoot;
    } else rootById(activeRoot).nodes.push(toNorm(px,py));
    redrawOverlay();
  } else if(editSub==="route"){ handleRoute(px,py,e.shiftKey);   // click start, click tip → A* route (Shift = straight)
  } else {                                                       // edit
    const nd=nearestNode(px,py);
    if(nd){ selRoot=nd.id;
      if(e.shiftKey||e.button===2){ const r2=rootById(nd.id); r2.nodes.splice(nd.ni,1);
        if(r2.nodes.length<2) deleteRoot(nd.id); redrawOverlay(); computeTraceTraits(); }
      else { dragNode=nd; try{octx.setPointerCapture(e.pointerId);}catch{} }
      return; }
    const seg=nearestSeg(px,py);
    if(seg){ rootById(seg.id).nodes.splice(seg.seg+1,0,toNorm(seg.cx,seg.cy));
      dragNode={id:seg.id,ni:seg.seg+1}; selRoot=seg.id; try{octx.setPointerCapture(e.pointerId);}catch{} redrawOverlay(); return; }
    selRoot=null; redrawOverlay();
  }
});
let liveWire=null;                                          // {points:[[dispx,dispy]...]} preview path
octx.addEventListener("pointermove", e => {
  if(dragNode){ const r=octx.getBoundingClientRect();
    rootById(dragNode.id).nodes[dragNode.ni]=toNorm(e.clientX-r.left, e.clientY-r.top); redrawOverlay(); return; }
  if(traceMode && editSub==="route" && routeStart && lastResult && lastResult.mask){   // NeuronJ-style live wire
    const r=octx.getBoundingClientRect(); const px=e.clientX-r.left, py=e.clientY-r.top;
    if(e.shiftKey){ liveWire={points:[[routeStart.px,routeStart.py],[px,py]]}; redrawOverlay(); return; }  // shift = straight line
    const now=performance.now(); if(now-_lwLast<45) return; _lwLast=now;                // throttle the A*
    const g=routeGridCache(); const path=routePath(g,routeStart.px,routeStart.py,px,py,45000);
    liveWire = path ? {points:path.map(p=>[p[0]/g.gw*octx.width, p[1]/g.gh*octx.height])} : null;
    redrawOverlay();
  }
});
let _lwLast=0;
octx.addEventListener("pointerup", () => { if(dragNode){ dragNode=null; computeTraceTraits(); } });
octx.addEventListener("contextmenu", e => { if(traceMode) e.preventDefault(); });
octx.addEventListener("dblclick", () => { if(traceMode && editSub==="draw"){
  if(activeRoot!==null && rootById(activeRoot).nodes.length<2) deleteRoot(activeRoot);
  activeRoot=null; redrawOverlay(); computeTraceTraits(); } });
window.addEventListener("keydown", e => { if(traceMode && (e.key==="Delete"||e.key==="Backspace") && selRoot!=null){
  deleteRoot(selRoot); selRoot=activeRoot=null; redrawOverlay(); computeTraceTraits(); } });
function deleteRoot(id){                                        // remove a root and its whole subtree
  const kill=new Set([id]); let grew=true;
  while(grew){ grew=false; editRoots.forEach(r=>{ if(r.parent!=null && kill.has(r.parent) && !kill.has(r.id)){ kill.add(r.id); grew=true; } }); }
  editRoots = editRoots.filter(r=>!kill.has(r.id));
}

function traceTraits(){                                         // measure from the vector roots
  const sum=a=>a.reduce((x,y)=>x+y,0);
  const rootLenPx = r => { const p=splinePoints(r.nodes); let L=0; for(let i=1;i<p.length;i++){ const dx=(p[i][0]-p[i-1][0])*imgW, dy=(p[i][1]-p[i-1][1])*imgH; L+=Math.hypot(dx,dy);} return L; };
  const valid=editRoots.filter(r=>r.nodes.length>=2);
  const lenPx=sum(valid.map(rootLenPx));
  const laterals=valid.filter(r=>r.parent!=null).length;
  const childCount={}; valid.forEach(r=>{ if(r.parent!=null) childCount[r.parent]=(childCount[r.parent]||0)+1; });
  const tips=valid.filter(r=>!childCount[r.id]).length;
  const prim=valid.filter(r=>r.parent==null);
  const skew = prim.length ? sum(prim.map(r=>{ const a=r.nodes[0],b=r.nodes[r.nodes.length-1];
    return Math.atan2((b[0]-a[0])*imgW, Math.max(1,(b[1]-a[1])*imgH))*180/Math.PI; }))/prim.length : 0;
  const lenCm = pxPerCm ? lenPx/pxPerCm : null;
  const out = { count:valid.length, lengthVal: lenCm!=null?+lenCm.toFixed(2):Math.round(lenPx), lengthUnit: lenCm!=null?"cm":"px",
    tips, branches:laterals, angle:+skew.toFixed(1) };
  const dia = traceDiameters(); if(dia){ out.meanDiameter=dia.meanDiameter; out.surface=dia.surface; out.volume=dia.volume; out.diaUnit=dia.unit; }
  return out;
}
function computeTraceTraits(){
  const t=traceTraits();
  if(!t.count){ setTraits(lastResult?lastResult.traits:null); $("measScope").textContent = lastResult?"(whole image)":""; return; }
  setTraits({length:`${t.lengthVal} ${t.lengthUnit}`, tips:t.tips, branches:t.branches, angle:t.angle});
  $("measScope").textContent=`(manual trace · ${t.count} roots)`;
  if(t.meanDiameter!=null) $("methodNote").textContent = `Manual trace · ${t.count} roots · mean diameter ${t.meanDiameter} ${t.diaUnit}, surface ${t.surface} ${t.diaUnit}², volume ${t.volume} ${t.diaUnit}³ (from the root mask).`;
  ["csvBtn","rsmlBtn","pngBtn","saveDbBtn"].forEach(b=>$(b).disabled=false);
  lastTrace=t;
}
let lastTrace=null;
$("traceMeasureBtn").onclick = () => computeTraceTraits();
$("traceRsmlBtn").onclick = () => download("astroroot_trace.rsml", traceRSML(), "application/xml");
function traceRSML(){
  const byId=Object.fromEntries(editRoots.map(r=>[r.id,r]));
  const kids=id=>editRoots.filter(r=>r.parent===id);
  const node=r=>{ const pts=splinePoints(r.nodes).map(n=>`<point x="${(n[0]*imgW).toFixed(1)}" y="${(n[1]*imgH).toFixed(1)}"/>`).join("");
    return `<root ID="r${r.id}"><geometry><polyline>${pts}</polyline></geometry>${kids(r.id).map(node).join("")}</root>`; };
  const roots=editRoots.filter(r=>r.parent==null).map(node).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rsml><metadata><version>1</version><unit>${pxPerCm?"cm":"pixel"}</unit>`+
    `<resolution>${pxPerCm?(pxPerCm/10).toFixed(4):1}</resolution><software>AstroRoot manual trace</software>`+
    `<image><size width="${imgW}" height="${imgH}"/></image></metadata><scene><plant>${roots}</plant></scene></rsml>`;
}
$("traceFromAuto").onclick = () => {                            // seed editor polylines from the auto skeleton
  if(!lastResult||!lastResult.skel){ alert("Run Trace roots first to get an auto-trace."); return; }
  editRoots = skeletonToRoots(lastResult.skel, lastResult.pw, lastResult.ph);
  activeRoot=selRoot=null; redrawOverlay(); computeTraceTraits();
  $("traceHint").textContent=`Imported ${editRoots.length} segments from the auto-trace — now edit them.`;
};
function skeletonToRoots(skel, pw, ph){                         // split skeleton into editable polylines
  const nbrs=(x,y)=>{ const o=[]; for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){ if(!dx&&!dy)continue;
    const nx=x+dx,ny=y+dy; if(nx>=0&&ny>=0&&nx<pw&&ny<ph&&skel[ny*pw+nx])o.push([nx,ny]); } return o; };
  const isNode=(x,y)=>{ const d=nbrs(x,y).length; return d===1||d>=3; };
  const seen=new Uint8Array(pw*ph), roots=[];
  const ds=(p,mx)=>{ if(p.length<=mx)return p; const o=[],st=(p.length-1)/(mx-1); for(let i=0;i<mx;i++)o.push(p[Math.round(i*st)]); return o; };
  for(let y=0;y<ph;y++)for(let x=0;x<pw;x++){ if(!skel[y*pw+x]||!isNode(x,y)) continue;
    for(const st of nbrs(x,y)){ if(seen[st[1]*pw+st[0]]) continue;
      let cx=st[0],cy=st[1],px=x,py=y; const path=[[x,y]];
      while(true){ path.push([cx,cy]); seen[cy*pw+cx]=1; if(isNode(cx,cy)) break;
        const ns=nbrs(cx,cy).filter(n=>!(n[0]===px&&n[1]===py) && !seen[n[1]*pw+n[0]]); if(!ns.length) break;
        px=cx;py=cy;cx=ns[0][0];cy=ns[0][1]; }
      if(path.length>=6){ const nd=ds(path,14).map(p=>[p[0]/pw,p[1]/ph]); if(nd.length>=2) roots.push({id:++rootIdSeq,order:1,parent:null,nodes:nd}); }
    } }
  return roots;
}
[$("roiDraw"),$("seedDraw")].forEach(b=> b && b.addEventListener("click", ()=>{      // leaving trace editor
  if(traceMode){ traceMode=false; $("traceToggle").classList.remove("primary"); $("traceTools").hidden=true; redrawOverlay(); } }));

/* ---- perpendicular cross-section probe: root CENTRE (for refine) + WIDTH (for diameter) ---- */
function perpProbe(mask, pw, ph, x, y, tx, ty){
  const on=(a,b)=>a>=0&&b>=0&&a<pw&&b<ph&&mask[b*pw+a];
  x=Math.round(x); y=Math.round(y);
  if(!on(x,y)){ let best=null,bd=1e9, R=14; for(let dy=-R;dy<=R;dy++)for(let dx=-R;dx<=R;dx++){ if(on(x+dx,y+dy)){ const d=dx*dx+dy*dy; if(d<bd){bd=d;best=[x+dx,y+dy];} } }
    if(!best) return null; x=best[0]; y=best[1]; }
  const L=Math.hypot(tx,ty)||1, nx=-ty/L, ny=tx/L;              // perpendicular unit
  const MAXR=Math.max(6, Math.round(Math.min(pw,ph)*0.12));
  let tp=0; for(let t=1;t<=MAXR;t++){ if(on(Math.round(x+nx*t),Math.round(y+ny*t))) tp=t; else break; }
  let tm=0; for(let t=1;t<=MAXR;t++){ if(on(Math.round(x-nx*t),Math.round(y-ny*t))) tm=t; else break; }
  const off=(tp-tm)/2;
  return { cx:x+nx*off, cy:y+ny*off, width:tp+tm+1 };
}
function refineTrace(){                                          // SmartRoot-style: snap nodes onto the centre-line
  if(!lastResult||!lastResult.mask){ alert("Run Trace roots first so there's a root mask to snap to."); return; }
  if(!editRoots.length){ alert("Trace or route a root first, then Refine."); return; }
  const {mask,pw,ph}=lastResult;
  for(let pass=0; pass<2; pass++) for(const r of editRoots){
    const N=r.nodes.length, px=r.nodes.map(n=>[n[0]*pw, n[1]*ph]);
    r.nodes = px.map((p,i)=>{ const a=px[Math.max(0,i-1)], b=px[Math.min(N-1,i+1)];
      const m=perpProbe(mask,pw,ph, p[0],p[1], b[0]-a[0], b[1]-a[1]);
      return m ? [m.cx/pw, m.cy/ph] : [p[0]/pw, p[1]/ph]; });
  }
  redrawOverlay(); computeTraceTraits();
  $("traceHint").textContent = "Refined onto the root centre-line — root widths measured (see diameter / surface / volume).";
}
$("traceRefine").onclick = refineTrace;
function traceDiameters(){                                       // per-node width along each root → mean diam, surface, volume
  if(!lastResult||!lastResult.mask) return null;
  const {mask,pw,ph}=lastResult, k = (lastResult.scale||1) * (pxPerCm ? 1/pxPerCm : 1);  // processing-px → image-px → cm
  let surf=0, vol=0, diamW=0, lenW=0;
  for(const r of editRoots){ if(r.nodes.length<2) continue;
    const px=splinePoints(r.nodes).map(n=>[n[0]*pw, n[1]*ph]); const N=px.length; const wid=[];
    for(let i=0;i<N;i++){ const a=px[Math.max(0,i-1)], b=px[Math.min(N-1,i+1)];
      const m=perpProbe(mask,pw,ph, px[i][0],px[i][1], b[0]-a[0], b[1]-a[1]); if(m) wid.push(m.width*k); }
    if(!wid.length) continue;
    for(let i=1;i<N;i++){ const dx=(px[i][0]-px[i-1][0])*k, dy=(px[i][1]-px[i-1][1])*k, sl=Math.hypot(dx,dy);
      const dm=((wid[Math.min(i,wid.length-1)]||wid[0])+(wid[Math.min(i-1,wid.length-1)]||wid[0]))/2;
      surf+=Math.PI*dm*sl; vol+=Math.PI*(dm/2)*(dm/2)*sl; }
    const mrd=wid.reduce((s,v)=>s+v,0)/wid.length, rl=(function(){let L=0;for(let i=1;i<N;i++)L+=Math.hypot((px[i][0]-px[i-1][0])*k,(px[i][1]-px[i-1][1])*k);return L;})();
    diamW+=mrd*rl; lenW+=rl;
  }
  if(lenW<=0) return null;
  const u = pxPerCm ? "cm" : "px";
  return { meanDiameter:+(diamW/lenW).toFixed(pxPerCm?3:1), surface:+surf.toFixed(pxPerCm?2:0), volume:+vol.toFixed(pxPerCm?3:0), unit:u };
}

/* ---- click-two-points auto-routing (A* along the root mask, RootNav 1-style) ---- */
function downsamplePath(p,mx){ if(p.length<=mx)return p; const o=[],st=(p.length-1)/(mx-1); for(let i=0;i<mx;i++)o.push(p[Math.round(i*st)]); return o; }
function buildCostGrid(){                                        // low cost on root, high off it, from the model's mask
  const {mask,pw,ph}=lastResult, MAXR=420, s=Math.min(1,MAXR/Math.max(pw,ph));
  const gw=Math.max(1,Math.round(pw*s)), gh=Math.max(1,Math.round(ph*s)), cost=new Float32Array(gw*gh);
  for(let y=0;y<gh;y++)for(let x=0;x<gw;x++){ const sxp=Math.min(pw-1,(x/s)|0), syp=Math.min(ph-1,(y/s)|0);
    cost[y*gw+x] = mask[syp*pw+sxp] ? 1 : 28; }                  // background crossable but expensive (bridges gaps)
  return {cost,gw,gh};
}
function snapToRoot(grid,gx,gy,rad){ if(grid.cost[gy*grid.gw+gx]<=1) return [gx,gy];
  let best=null,bd=Infinity; for(let dy=-rad;dy<=rad;dy++)for(let dx=-rad;dx<=rad;dx++){ const nx=gx+dx,ny=gy+dy;
    if(nx<0||ny<0||nx>=grid.gw||ny>=grid.gh)continue; if(grid.cost[ny*grid.gw+nx]<=1){ const d=dx*dx+dy*dy; if(d<bd){bd=d;best=[nx,ny];} } }
  return best||[gx,gy]; }
function astar(cost,gw,gh,sx,sy,tx,ty,maxExp){
  const N=gw*gh, g=new Float32Array(N).fill(Infinity), came=new Int32Array(N).fill(-1), closed=new Uint8Array(N);
  const h=(x,y)=>Math.hypot(x-tx,y-ty);                          // admissible (min step cost 1)
  const heap=[];                                                 // binary min-heap of [f,idx]
  const push=(f,i)=>{ heap.push([f,i]); let c=heap.length-1; while(c>0){ const p=(c-1)>>1; if(heap[p][0]<=heap[c][0])break; [heap[p],heap[c]]=[heap[c],heap[p]]; c=p; } };
  const pop=()=>{ const top=heap[0], last=heap.pop(); if(heap.length){ heap[0]=last; let c=0; for(;;){ let l=2*c+1,r=2*c+2,m=c;
    if(l<heap.length&&heap[l][0]<heap[m][0])m=l; if(r<heap.length&&heap[r][0]<heap[m][0])m=r; if(m===c)break; [heap[m],heap[c]]=[heap[c],heap[m]]; c=m; } } return top; };
  const si=sy*gw+sx, ti=ty*gw+tx; g[si]=0; push(h(sx,sy),si);
  const CAP = maxExp||N; let exp=0;
  while(heap.length){ const [,i]=pop(); if(closed[i])continue; closed[i]=1; if(i===ti)break; if(++exp>CAP) return null;
    const x=i%gw, y=(i/gw)|0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){ if(!dx&&!dy)continue; const nx=x+dx,ny=y+dy; if(nx<0||ny<0||nx>=gw||ny>=gh)continue;
      const ni=ny*gw+nx; if(closed[ni])continue; const ng=g[i]+(dx&&dy?1.41421:1)*cost[ni];
      if(ng<g[ni]){ g[ni]=ng; came[ni]=i; push(ng+h(nx,ny),ni); } } }
  if(came[ti]<0 && ti!==si) return null;
  const path=[]; let cur=ti; while(cur>=0){ path.push([cur%gw,(cur/gw)|0]); if(cur===si)break; cur=came[cur]; }
  return path.reverse();
}
let _routeGrid=null, _routeGridFor=null;
function routeGridCache(){ if(_routeGridFor!==lastResult){ _routeGrid=buildCostGrid(); _routeGridFor=lastResult; } return _routeGrid; }
function routePath(g, ax, ay, bx, by, cap){                  // A* path (grid coords) between two display points
  const toG=(x,y)=>[Math.max(0,Math.min(g.gw-1,Math.round(x/octx.width*g.gw))), Math.max(0,Math.min(g.gh-1,Math.round(y/octx.height*g.gh)))];
  let [sx,sy]=toG(ax,ay), [tx,ty]=toG(bx,by);
  [sx,sy]=snapToRoot(g,sx,sy,10); [tx,ty]=snapToRoot(g,tx,ty,10);
  return astar(g.cost, g.gw, g.gh, sx, sy, tx, ty, cap);
}
function handleRoute(px, py, shift){                         // click a start then a tip → commit a routed root
  if(!lastResult||!lastResult.mask){ alert("Run Trace roots first so there's a root mask to follow."); return; }
  if(!routeStart){ routeStart={px, py, seg:nearestSeg(px,py,10)}; liveWire=null; redrawOverlay(); return; }
  const start=routeStart; routeStart=null; liveWire=null;
  let nodes;
  if(shift){ nodes=[[start.px/octx.width, start.py/octx.height],[px/octx.width, py/octx.height]]; }  // straight-line fallback
  else { const g=routeGridCache(); const path=routePath(g, start.px, start.py, px, py);
    if(!path||path.length<2){ alert("Couldn't route — click nearer the root, or hold Shift for a straight line."); redrawOverlay(); return; }
    nodes=downsamplePath(path,18).map(p=>[p[0]/g.gw, p[1]/g.gh]); }
  if(start.seg){ const parent=rootById(start.seg.id); editRoots.push({id:++rootIdSeq,order:parent.order+1,parent:parent.id,nodes}); }
  else editRoots.push({id:++rootIdSeq,order:1,parent:null,nodes});
  selRoot=editRoots[editRoots.length-1].id; redrawOverlay(); computeTraceTraits();
}
function setTraits(t){
  $("tLen").textContent   = t ? t.length : "—";
  $("tTips").textContent  = t ? t.tips : "—";
  $("tBranch").textContent= t ? t.branches : "—";
  $("tAngle").textContent = t ? `${t.angle.toFixed(1)}°` : "—";
}

/* ---------- exports ---------- */
$("csvBtn").onclick = () => { const t=lastResult.traits;
  download("astroroot_result.csv",
    "length_"+t.lengthUnit+",tips,branches,angle_deg\n"+`${t.lengthVal.toFixed(3)},${t.tips},${t.branches},${t.angle.toFixed(1)}\n`,
    "text/csv"); };
$("pngBtn").onclick = () => { const m=document.createElement("canvas"); m.width=cv.width;m.height=cv.height;
  const x=m.getContext("2d"); x.drawImage(cv,0,0); x.drawImage(octx,0,0);
  m.toBlob(b=>download("astroroot_overlay.png", b, "image/png")); };
$("rsmlBtn").onclick = () => download("astroroot.rsml", buildRSML(lastResult.traits, imgW, imgH), "application/xml");

function buildRSML(t, w, h){
  // Minimal valid RSML capturing image size + measured scalars. Vector polylines are exported
  // from the Train/label tab; the auto path stores traits as <property> pending full path-search.
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsml xmlns:po="http://www.plantontology.org/xml-dtd/po.dtd">
  <metadata><version>1</version><unit>${t.lengthUnit}</unit><software>AstroRoot</software>
    <image><name>seedling</name><size width="${w}" height="${h}"/></image></metadata>
  <scene><plant>
    <root ID="auto-1"><properties>
      <length>${t.lengthVal.toFixed(3)}</length><tips>${t.tips}</tips>
      <branches>${t.branches}</branches><angle_from_vertical>${t.angle.toFixed(1)}</angle_from_vertical>
    </properties></root>
  </plant></scene>
</rsml>`;
}
function download(name, data, type){
  const blob = data instanceof Blob ? data : new Blob([data], {type});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
}

/* ================= BATCH ================= */
let batchRows = [], batchRecords = [];
function updateBatchApply(){                              // show what will be applied per frame
  const el = $("batchApply"); if(!el) return;
  el.textContent = seeds.length ? `Applying ${seeds.length} seeds${rois.length?` + ${rois.length} genotype regions`:""} from the Single tab → per-plant traits per frame.`
    : rois.length ? `Applying ${rois.length} regions from the Single tab → per-region traits per frame.`
    : "Whole-image traits per frame. Define regions/seeds on the Single tab to measure per genotype/plant.";
}
$("batchFiles").onchange = e => { $("batchRun").disabled = e.target.files.length===0; updateBatchApply(); };
$("batchRun").onclick = async () => {
  const files = [...$("batchFiles").files].sort((a,b)=>a.name.localeCompare(b.name, undefined, {numeric:true}));
  const ppc = parseFloat($("batchScale").value) || null;
  const tbody = $("batchTable").querySelector("tbody"); tbody.innerHTML=""; batchRows=[]; batchRecords=[];
  $("batchTable").hidden = false;
  const eng = ortSession?`RootNav2 (${ortBackend})`:"classical", base = Date.now();
  const mode = seeds.length ? "plant" : rois.length ? "region" : "whole";
  for(let i=0;i<files.length;i++){
    $("batchProgress").textContent = `processing ${i+1} / ${files.length}…`;
    const R = await processFile(files[i], ppc); const ts = base + i*1000;
    if(mode==="plant"){
      for(const p of computePlantResults(R.skel,R.pw,R.ph,R.scale)) batchRecords.push({ ts,
        name:`${files[i].name} · plant ${p.plant}${p.geno?" ("+p.geno+")":""}`, engine:eng, marker:"batch",
        pxPerCm:ppc, colorCorrected:false, lengthVal:p.traits.lengthVal, lengthUnit:p.traits.lengthUnit,
        tips:p.traits.tips, branches:p.traits.branches, angle:p.skew, group:p.geno||"plant", frame:files[i].name, plant:p.plant, thumb:null });
    } else if(mode==="region"){
      for(const x of computeRegionResults(R.skel,R.pw,R.ph,R.scale)) batchRecords.push({ ts,
        name:`${files[i].name} · ${x.name}`, engine:eng, marker:"batch", pxPerCm:ppc, colorCorrected:false,
        lengthVal:x.traits.lengthVal, lengthUnit:x.traits.lengthUnit, tips:x.traits.tips, branches:x.traits.branches,
        angle:+x.traits.angle.toFixed(1), group:x.name, frame:files[i].name, thumb:null });
    } else {
      const rec={ ts, name:files[i].name, engine:eng, marker:"batch", pxPerCm:ppc, colorCorrected:false,
        lengthVal:R.whole.lengthVal, lengthUnit:R.whole.lengthUnit, tips:R.whole.tips, branches:R.whole.branches,
        angle:+R.whole.angle.toFixed(1), group:null, frame:files[i].name, thumb:null };
      applyDesc(rec, R.desc); batchRecords.push(rec);
    }
    batchRows.push({name:files[i].name, ...R.whole});
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${files[i].name}</td><td>${R.whole.lengthVal.toFixed(1)} ${R.whole.lengthUnit}</td><td>${R.whole.tips}</td><td>${R.whole.branches}</td><td>${R.whole.angle.toFixed(1)}</td>`;
    tbody.appendChild(tr);
  }
  const extra = mode!=="whole" ? ` → ${batchRecords.length} per-${mode} rows` : "";
  $("batchProgress").textContent = `done — ${files.length} frames${extra}.`;
  $("batchCsv").disabled = false; $("batchSaveDb").disabled = batchRecords.length===0;
};
$("batchSaveDb").onclick = async () => {
  if(!batchRecords.length) return;
  await AR_DB.saveMany(batchRecords);
  const n = await AR_DB.count();
  $("batchSaveDb").textContent = `✓ saved ${batchRecords.length} (${n} in DB)`;
  setTimeout(()=>$("batchSaveDb").textContent="💾 Save all to database", 2500);
};
function processFile(file, ppc){
  return new Promise(res => { const im=new Image(); im.onload=async()=>{
    const P=prepImage(im, im.naturalWidth, im.naturalHeight);
    if($("deGridBatch").checked) removeGrid(P.rgba,P.w,P.h);
    let mask; if(ortSession){ try{mask=await segmentOnnx(P.rgba,P.w,P.h);}catch{ mask=segmentClassical(P.rgba,P.w,P.h);} } else mask=segmentClassical(P.rgba,P.w,P.h);
    const skel=zhangSuen(mask,P.w,P.h);
    res({ whole:measure(skel,P.w,P.h,ppc,P.scale), desc:computeDescriptors(mask,skel,P.w,P.h,P.scale,ppc), skel, pw:P.w, ph:P.h, scale:P.scale });
  }; im.src=URL.createObjectURL(file); });
}
$("batchCsv").onclick = () => {
  if(!batchRecords.length) return;
  const u = batchRecords[0].lengthUnit || "px";
  let csv = `frame,group,plant,name,length_${u},tips,branches,angle_deg\n`;
  for(const r of batchRecords) csv += `${r.frame||""},${r.group||""},${r.plant||""},"${r.name}",${(+r.lengthVal).toFixed(2)},${r.tips},${r.branches},${(+r.angle).toFixed(1)}\n`;
  download("astroroot_batch.csv", csv, "text/csv");
};

/* ================= TRAIN — labelling ================= */
const lblCv=$("lblCv"), lblOv=$("lblOverlay");
let lblImg=null, lblW=0, lblH=0, traces=[], cur=[], dataset=[];
$("lblImg").onchange = e => { const f=e.target.files[0]; if(!f) return;
  const im=new Image(); im.onload=()=>{ lblImg=im; lblW=im.naturalWidth; lblH=im.naturalHeight;
    const s=Math.min(1,620/lblW); lblCv.width=lblOv.width=Math.round(lblW*s); lblCv.height=lblOv.height=Math.round(lblH*s);
    lblCv.getContext("2d").drawImage(im,0,0,lblCv.width,lblCv.height); traces=[];cur=[];redrawLabels(); updCounts();
  }; im.src=URL.createObjectURL(f); };
lblOv.onclick = ev => { if(!lblImg) return; const r=lblOv.getBoundingClientRect();
  cur.push([ev.clientX-r.left, ev.clientY-r.top]); redrawLabels(); };
lblOv.ondblclick = () => finishRoot();
$("lblFinish").onclick = finishRoot;
$("lblUndo").onclick = () => { cur.pop(); redrawLabels(); };
$("lblClear").onclick = () => { traces=[];cur=[];redrawLabels();updCounts(); };
function finishRoot(){ if(cur.length>=2){ traces.push(cur); } cur=[]; redrawLabels(); updCounts(); }
function redrawLabels(){ const c=lblOv.getContext("2d"); c.clearRect(0,0,lblOv.width,lblOv.height);
  const drawLine=(pts,col)=>{ c.strokeStyle=col;c.lineWidth=2;c.beginPath();
    pts.forEach((p,i)=> i?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1])); c.stroke();
    c.fillStyle=col; pts.forEach(p=>{c.beginPath();c.arc(p[0],p[1],3,0,7);c.fill();}); };
  traces.forEach(t=>drawLine(t,"#3fb950")); if(cur.length) drawLine(cur,"#58a6ff");
}
function updCounts(){ $("lblCount").textContent = `${traces.length} roots traced`; $("dsExport").disabled = dataset.length===0; }
$("dsAdd").onclick = () => { if(!lblImg||!traces.length){ alert("Trace at least one root first."); return; }
  const s=lblW/lblCv.width;   // overlay -> image coords
  dataset.push({ name:`img_${dataset.length+1}.png`, w:lblW, h:lblH,
    rsml: labelRSML(traces.map(t=>t.map(p=>[p[0]*s,p[1]*s])), lblW, lblH),
    png: lblCv.toDataURL("image/png") });
  $("dsCount").textContent = `${dataset.length} images in dataset`; $("dsExport").disabled=false;
};
function labelRSML(traces, w, h){
  const roots = traces.map((t,i)=>`      <root ID="r${i+1}"><geometry><polyline>`+
    t.map(p=>`<point x="${p[0].toFixed(1)}" y="${p[1].toFixed(1)}"/>`).join("")+
    `</polyline></geometry></root>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsml><metadata><version>1</version><software>AstroRoot</software>
  <image><size width="${w}" height="${h}"/></image></metadata>
  <scene><plant>\n${roots}\n  </plant></scene></rsml>`;
}
$("dsExport").onclick = () => exportDataset();
function exportDataset(){
  // store-only ZIP of image+rsml pairs (RootNav2 training format).
  const files = [];
  dataset.forEach((d,i)=>{ const base=`train/${String(i+1).padStart(3,"0")}`;
    files.push([`${base}.png`, dataURLtoBytes(d.png)]);
    files.push([`${base}.rsml`, new TextEncoder().encode(d.rsml)]); });
  files.push(["README.txt", new TextEncoder().encode(
    "AstroRoot training set — image (.png) + label (.rsml) pairs.\nUpload to the training notebook (docs/TRAINING.md).")]);
  download("astroroot_dataset.zip", makeZip(files), "application/zip");
}
function dataURLtoBytes(u){ const b=atob(u.split(",")[1]); const a=new Uint8Array(b.length); for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i); return a; }

/* ---- minimal STORE zip (no deps) ---- */
function makeZip(files){
  const enc=new TextEncoder(); const chunks=[]; const central=[]; let offset=0;
  const u16=n=>[n&255,(n>>8)&255]; const u32=n=>[n&255,(n>>8)&255,(n>>16)&255,(n>>24)&255];
  for(const [name,data] of files){
    const nb=enc.encode(name), crc=crc32(data);
    const local=[...u32(0x04034b50),...u16(20),...u16(0),...u16(0),...u16(0),...u16(0),
      ...u32(crc),...u32(data.length),...u32(data.length),...u16(nb.length),...u16(0)];
    chunks.push(new Uint8Array(local), nb, data);
    central.push({name:nb,crc,len:data.length,offset});
    offset += local.length + nb.length + data.length;
  }
  const cstart=offset; const cd=[];
  for(const c of central){ const h=[...u32(0x02014b50),...u16(20),...u16(20),...u16(0),...u16(0),...u16(0),...u16(0),
    ...u32(c.crc),...u32(c.len),...u32(c.len),...u16(c.name.length),...u16(0),...u16(0),...u16(0),...u16(0),...u32(0),...u32(c.offset)];
    cd.push(new Uint8Array(h), c.name); offset += h.length + c.name.length; }
  const end=[...u32(0x06054b50),...u16(0),...u16(0),...u16(central.length),...u16(central.length),...u32(offset-cstart),...u32(cstart),...u16(0)];
  return new Blob([...chunks,...cd,new Uint8Array(end)],{type:"application/zip"});
}
const CRC_TABLE=(()=>{const t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
function crc32(bytes){let c=0xFFFFFFFF;for(let i=0;i<bytes.length;i++)c=CRC_TABLE[(c^bytes[i])&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0;}
