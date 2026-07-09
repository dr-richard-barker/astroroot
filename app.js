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
});

/* ================= SINGLE IMAGE ================= */
const cv = $("cv"), octx = $("overlay");
let img = null, imgW = 0, imgH = 0;
let pxPerCm = null;               // calibration
let lastResult = null;            // {mask, skel, traits, traces}
let ortSession = null, ortModelName = null, ortBackend = null;

$("imgFile").onchange = e => loadImage(e.target.files[0]);

/* demo/test images — NASA ABRS root timelapse (flight + ground) */
(async function initDemoImages(){
  try{
    const idx = await (await fetch("samples/images/index.json")).json();
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
    const idx = await (await fetch("samples/images/index.json")).json();
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
  redrawOverlay();
  setTraits(traits);
  measureROIs();
  $("methodNote").textContent = ortSession
    ? `Traced with ${ortModelName} (${ortBackend}).` + (ortBackend==="wasm" ? " First run is slow without WebGPU — see docs." : "")
    : "Classical baseline (auto threshold + thinning). Load the Arabidopsis model for accuracy.";
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
  if(!lastResult) return;
  const rec = resultRecord($("imgFile").files[0]?.name, lastResult.traits); rec.thumb = thumbnail();
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
  const rootsAreDark = mean > t;
  const mask = new Uint8Array(n);
  // note: Otsu can land the threshold on the darker cluster's value, so the dark side is
  // inclusive (<=) to avoid dropping root pixels; the light side stays exclusive (>).
  for(let i=0;i<n;i++) mask[i] = (rootsAreDark ? gray[i] <= t : gray[i] > t) ? 1 : 0;
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

function measureROIs(){
  if(!rois.length || !lastResult){ $("roiResults").hidden=true; $("measScope").textContent="(whole image)"; return; }
  const {skel,pw,ph}=lastResult;
  roiResults = rois.map(r => {
    const rx0=Math.max(0,Math.floor(r.x0*pw)), ry0=Math.max(0,Math.floor(r.y0*ph)),
          rx1=Math.min(pw,Math.ceil(r.x1*pw)), ry1=Math.min(ph,Math.ceil(r.y1*ph));
    const sub=new Uint8Array(pw*ph);
    for(let y=ry0;y<ry1;y++)for(let x=rx0;x<rx1;x++) if(skel[y*pw+x]) sub[y*pw+x]=1;
    return { name:r.name, traits: measure(sub, pw, ph, pxPerCm, lastResult.scale||1) };
  });
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
let batchRows = [];
$("batchFiles").onchange = e => $("batchRun").disabled = e.target.files.length===0;
$("batchRun").onclick = async () => {
  const files = [...$("batchFiles").files];
  const ppc = parseFloat($("batchScale").value) || null;
  const tbody = $("batchTable").querySelector("tbody"); tbody.innerHTML=""; batchRows=[];
  $("batchTable").hidden = false;
  for(let i=0;i<files.length;i++){
    $("batchProgress").textContent = `processing ${i+1} / ${files.length}…`;
    const t = await processFile(files[i], ppc);
    batchRows.push({name:files[i].name, ...t});
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${files[i].name}</td><td>${t.lengthVal.toFixed(2)} ${t.lengthUnit}</td>`+
                   `<td>${t.tips}</td><td>${t.branches}</td><td>${t.angle.toFixed(1)}</td>`;
    tbody.appendChild(tr);
  }
  $("batchProgress").textContent = `done — ${files.length} images.`;
  $("batchCsv").disabled = false; $("batchSaveDb").disabled = batchRows.length===0;
};
$("batchSaveDb").onclick = async () => {
  const eng = ortSession?`RootNav2 (${ortBackend})`:"classical";
  const recs = batchRows.map(r => ({ ts: Date.now(), name: r.name, engine: eng, marker: "batch",
    pxPerCm: parseFloat($("batchScale").value)||null, colorCorrected:false,
    lengthVal:r.lengthVal, lengthUnit:r.lengthUnit, tips:r.tips, branches:r.branches, angle:+r.angle.toFixed(1), thumb:null }));
  await AR_DB.saveMany(recs);
  const n = await AR_DB.count();
  $("batchSaveDb").textContent = `✓ saved ${recs.length} (${n} in DB)`;
  setTimeout(()=>$("batchSaveDb").textContent="💾 Save all to database", 2500);
};
function processFile(file, ppc){
  return new Promise(res => { const im=new Image(); im.onload=async()=>{
    const P=prepImage(im, im.naturalWidth, im.naturalHeight);
    if($("deGridBatch").checked) removeGrid(P.rgba,P.w,P.h);
    let mask; if(ortSession){ try{mask=await segmentOnnx(P.rgba,P.w,P.h);}catch{ mask=segmentClassical(P.rgba,P.w,P.h);} } else mask=segmentClassical(P.rgba,P.w,P.h);
    res(measure(zhangSuen(mask,P.w,P.h), P.w, P.h, ppc, P.scale));
  }; im.src=URL.createObjectURL(file); });
}
$("batchCsv").onclick = () => {
  const u = batchRows[0]?.lengthUnit || "px";
  let csv = `image,length_${u},tips,branches,angle_deg\n`;
  for(const r of batchRows) csv += `${r.name},${r.lengthVal.toFixed(3)},${r.tips},${r.branches},${r.angle.toFixed(1)}\n`;
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
