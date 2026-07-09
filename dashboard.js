/* AstroRoot dashboard — reads the local IndexedDB and renders stats, charts and a table.
 * Inspired by RootNav-Viewer 2.0 (collection browse -> search -> per-item measurements),
 * reimagined as a dependency-free web page. */
const $ = id => document.getElementById(id);
let RECORDS = [], sortKey = "ts", sortDir = -1, filter = "";

async function load(){
  RECORDS = await AR_DB.all();
  render();
}
function view(){
  const f = filter.toLowerCase();
  let rows = RECORDS.filter(r => !f || `${r.name} ${r.engine} ${r.marker}`.toLowerCase().includes(f));
  rows.sort((a,b)=>{ const x=a[sortKey], y=b[sortKey];
    return (x<y?-1:x>y?1:0)*sortDir * (typeof x==="string"?1:1); });
  return rows;
}
function render(){
  const has = RECORDS.length>0;
  $("empty").style.display = has?"none":"block";
  $("content").style.display = has?"block":"none";
  if(!has) return;
  const rows = view();
  renderStats(rows); renderCharts(rows); renderTable(rows);
}

function fmtDate(ts){ if(!ts) return "—"; const d=new Date(ts);
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")+" "+String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0"); }
const mean = a => a.length ? a.reduce((s,v)=>s+v,0)/a.length : 0;

function renderStats(rows){
  const units = [...new Set(rows.map(r=>r.lengthUnit))];
  const lens = rows.map(r=>r.lengthVal).filter(v=>typeof v==="number");
  const lenLabel = lens.length ? (units.length===1 ? `${mean(lens).toFixed(units[0]==="cm"?2:0)} ${units[0]}` : "mixed units") : "—";
  const cards = [
    ["Records", rows.length],
    ["Mean length", lenLabel],
    ["Mean tips", rows.length?mean(rows.map(r=>r.tips)).toFixed(1):"—"],
    ["Mean branches", rows.length?mean(rows.map(r=>r.branches)).toFixed(1):"—"],
    ["Mean angle", rows.length?`${mean(rows.map(r=>r.angle)).toFixed(1)}°`:"—"],
  ];
  $("stats").innerHTML = cards.map(([k,v])=>`<div class="stat"><div class="statval">${v}</div><div class="statlbl">${k}</div></div>`).join("");
}

function svg(w,h,inner){ return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="max-width:${w}px">${inner}</svg>`; }
function histogram(vals, unit, color){
  if(!vals.length) return `<p class="method">No records yet.</p>`;
  const W=340,H=170,pad=28, min=Math.min(...vals), max=Math.max(...vals), span=(max-min)||1, bins=Math.min(10, Math.max(4, Math.round(Math.sqrt(vals.length))));
  const counts=new Array(bins).fill(0); vals.forEach(v=>{ let b=Math.floor((v-min)/span*bins); if(b>=bins)b=bins-1; if(b<0)b=0; counts[b]++; });
  const cmax=Math.max(...counts)||1, bw=(W-2*pad)/bins;
  let bars=""; counts.forEach((c,i)=>{ const bh=(H-2*pad)*c/cmax; bars+=`<rect x="${(pad+i*bw+1.5).toFixed(1)}" y="${(H-pad-bh).toFixed(1)}" width="${(bw-3).toFixed(1)}" height="${bh.toFixed(1)}" fill="${color}"/>`; });
  const axis=`<line x1="${pad}" y1="${H-pad}" x2="${W-pad}" y2="${H-pad}" stroke="var(--edge)"/>`+
    `<text x="${pad}" y="${H-8}" font-size="10" fill="var(--muted)">${min.toFixed(1)}</text>`+
    `<text x="${W-pad}" y="${H-8}" font-size="10" fill="var(--muted)" text-anchor="end">${max.toFixed(1)} ${unit}</text>`+
    `<text x="${pad}" y="14" font-size="10" fill="var(--muted)">n=${vals.length}</text>`;
  return svg(W,H,bars+axis);
}
function renderCharts(rows){
  const units=[...new Set(rows.map(r=>r.lengthUnit))];
  $("chartLen").innerHTML = histogram(rows.map(r=>r.lengthVal).filter(v=>typeof v==="number"),
                                      units.length===1?units[0]:"", "var(--accent)");
  $("chartAngle").innerHTML = histogram(rows.map(r=>r.angle).filter(v=>typeof v==="number"), "°", "var(--accent2)");
}

function renderTable(rows){
  const tb = $("tbl").querySelector("tbody");
  tb.innerHTML = rows.map(r=>`<tr data-id="${r.id}">
    <td>${r.thumb?`<img src="${r.thumb}" width="48" style="border-radius:4px">`:"—"}</td>
    <td>${esc(r.name)}</td><td>${fmtDate(r.ts)}</td><td>${esc(r.engine)}</td><td>${esc(r.marker)}</td>
    <td>${r.lengthVal.toFixed?r.lengthVal.toFixed(2):r.lengthVal} ${r.lengthUnit}${r.colorCorrected?" ✓":""}</td>
    <td>${r.tips}</td><td>${r.branches}</td><td>${r.angle}</td>
    <td><button class="ghost del" data-id="${r.id}" title="delete" style="padding:2px 8px">✕</button></td>
  </tr>`).join("");
  tb.querySelectorAll(".del").forEach(b=>b.onclick=async e=>{ e.stopPropagation(); await AR_DB.remove(b.dataset.id); load(); });
  tb.querySelectorAll("tr").forEach(tr=>tr.onclick=()=>showDetail(RECORDS.find(r=>r.id===tr.dataset.id)));
}

/* ---------- per-record detail (archiDART trait set + H0 barcode) ---------- */
const ARCH_LABELS = {
  TRL:"Total root length (TRL)", L1R:"1st-order length (L1R)", TN1R:"# 1st-order roots (TN1R)",
  TNLR:"# lateral roots (TNLR)", TLRL:"Total lateral length (TLRL)", MLR:"Mean lateral length",
  N2LR:"# 2nd-order (N2LR)", D2LR:"Lateral density (D2LR)", maxOrder:"Max branching order",
  height:"Height / depth", width:"Width", convexHullXY:"Convex hull area (XY)",
  MDLR:"Mean lateral diameter", Stot:"Total surface (Stot)", Vtot:"Total volume (Vtot)",
  tortuosity:"Tortuosity", magnitude:"Magnitude (# tips)", altitude:"Altitude",
  extPathLength:"Ext. path length", maxPersistence:"Max persistence", totalPersistence:"Total persistence"
};
function showDetail(rec){
  if(!rec) return;
  $("detail").style.display="block";
  $("detailName").textContent = `${rec.name} — ${rec.engine}`;
  const a = rec.arch;
  if(!a){ $("detailTraits").innerHTML = `<p class="method">This record has basic traits only (length ${rec.lengthVal} ${rec.lengthUnit}, tips ${rec.tips}, branches ${rec.branches}, angle ${rec.angle}°). Import RSML for the full archiDART trait set.</p>`; $("detailBarcode").innerHTML=""; $("detail").scrollIntoView({behavior:"smooth",block:"nearest"}); return; }
  const u = rec.lengthUnit;
  const cells = Object.keys(ARCH_LABELS).filter(k=>a[k]!=null).map(k=>{
    let v=a[k]; const unit = /length|height|width|altitude|persistence|MLR|L1R|TRL|TLRL/.test(k)?` ${u}`:
      k==="convexHullXY"?` ${u}²`:k==="Stot"?` ${u}²`:k==="Vtot"?` ${u}³`:k==="D2LR"?` /${u}`:k==="MDLR"?` ${u}`:"";
    return `<div class="trait"><div class="tval">${v}${unit}</div><div class="tlbl">${ARCH_LABELS[k]}</div></div>`;
  }).join("");
  $("detailTraits").innerHTML = cells;
  // H0 geodesic persistence barcode
  const bars=a.barcode||[]; if(bars.length){
    const W=380,H=Math.min(240,18+bars.length*7),pad=6, maxB=Math.max(...bars.map(b=>b.birth))||1;
    const sorted=bars.slice().sort((x,y)=>(y.birth-y.death)-(x.birth-x.death));
    const rows=sorted.map((b,i)=>{ const y=12+i*7, x1=pad+(W-2*pad)*b.death/maxB, x2=pad+(W-2*pad)*b.birth/maxB;
      return `<line x1="${x1.toFixed(1)}" y1="${y}" x2="${x2.toFixed(1)}" y2="${y}" stroke="var(--accent2)" stroke-width="3"/>`; }).join("");
    $("detailBarcode").innerHTML = `<h3 style="font-size:13px;margin:14px 0 4px">H0 persistence barcode (geodesic distance, ${u})</h3>`+
      `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px">${rows}`+
      `<line x1="${pad}" y1="${H-3}" x2="${W-pad}" y2="${H-3}" stroke="var(--edge)"/><text x="${W-pad}" y="${H-6}" font-size="9" fill="var(--muted)" text-anchor="end">${maxB.toFixed(1)} ${u}</text></svg>`;
  } else $("detailBarcode").innerHTML="";
  $("detail").scrollIntoView({behavior:"smooth",block:"nearest"});
}
$("detailClose").onclick = ()=>$("detail").style.display="none";
function esc(s){ return String(s==null?"":s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }

/* sorting */
document.querySelectorAll("th[data-sort]").forEach(th=>th.style.cursor="pointer");
document.querySelector("#tbl thead").onclick = e=>{ const k=e.target.dataset.sort; if(!k) return;
  if(sortKey===k) sortDir*=-1; else { sortKey=k; sortDir=1; } render(); };

/* controls */
$("search").oninput = e=>{ filter=e.target.value; render(); };
$("expCsv").onclick = ()=>{ const rows=view();
  const A=["TRL","L1R","TN1R","TNLR","TLRL","MLR","D2LR","maxOrder","height","width","convexHullXY","MDLR","Stot","Vtot","tortuosity","magnitude","altitude","extPathLength","maxPersistence"];
  let csv="name,date,engine,marker,px_per_cm,length,unit,color_corrected,tips,branches,angle,"+A.join(",")+"\n";
  rows.forEach(r=>{ const a=r.arch||{};
    csv+=`${r.name},${fmtDate(r.ts)},${r.engine},${r.marker},${r.pxPerCm||""},${r.lengthVal},${r.lengthUnit},${r.colorCorrected?1:0},${r.tips},${r.branches},${r.angle},`+
      A.map(k=>a[k]!=null?a[k]:"").join(",")+"\n"; });
  dl("astroroot_database.csv", csv, "text/csv"); };
$("expJson").onclick = async ()=>dl("astroroot_backup.json", await AR_DB.exportJSON(), "application/json");
$("impJson").onchange = async e=>{ const f=e.target.files[0]; if(!f) return; const n=await AR_DB.importJSON(await f.text()); alert(`Imported ${n} records.`); load(); };
$("clearDb").onclick = async ()=>{ if(confirm("Delete ALL saved measurements from this device?")){ await AR_DB.clear(); load(); } };
const STEREOTYPES = ["tap_dominant","herringbone","dichotomous","shallow_spreading","fibrous_monocot"];
$("loadSamples").onclick = async ()=>{
  try{
    if($("sampleSet").value === "skew"){
      const obj = await (await fetch("samples/18_way_skew.json")).json();
      const n = await AR_DB.saveMany(obj.records);
      alert(`Loaded ${n} records (18-way skew, RootNav RSML).`);
    } else {
      const recs=[];
      for(const nm of STEREOTYPES){
        const rec = AR_RSML.parse(await (await fetch(`samples/stereotypes/${nm}.rsml`)).text(), nm+".rsml");
        if(rec){ rec.id = "sample_stereo_"+nm; recs.push(rec); }
      }
      await AR_DB.saveMany(recs);
      alert(`Loaded ${recs.length} extreme-stereotype architectures (archidart-style traits).`);
    }
    load();
  }catch(e){ alert("Could not load sample data: "+e.message); }
};
$("impRsml").onchange = async e=>{
  const files=[...e.target.files]; if(!files.length) return;
  let n=0, skipped=0;
  for(const f of files){ const rec = AR_RSML.parse(await f.text(), f.name);
    if(rec){ await AR_DB.save(rec); n++; } else skipped++; }
  alert(`Imported ${n} RSML file(s)` + (skipped?`, skipped ${skipped} (no roots found)`:"") + "."); load();
};
function dl(name,data,type){ const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([data],{type})); a.download=name; a.click(); }

/* ---------- cloud sync (Supabase, metadata only) ---------- */
function cloudState(){
  const ok = AR_CLOUD.configured();
  $("cloudState").textContent = ok ? "configured ✓" : "not configured";
}
function initCloud(){
  const c = AR_CLOUD.config();
  if(c.url) $("sbUrl").value = c.url;
  if(c.table) $("sbTable").value = c.table;   // key intentionally not pre-filled into the field
  cloudState();
  const status = m => $("sbStatus").textContent = m;
  $("sbSave").onclick = () => {
    const key = $("sbKey").value || AR_CLOUD.config().key || "";   // keep existing key if field left blank
    if(!$("sbUrl").value || !key){ status("need URL + anon key"); return; }
    AR_CLOUD.setConfig($("sbUrl").value, key, $("sbTable").value || "measurements");
    $("sbKey").value = ""; cloudState(); status("settings saved to this browser");
  };
  $("sbTest").onclick = async () => { status("testing…");
    try{ await AR_CLOUD.test(); status("✓ connected"); }catch(e){ status("✗ "+e.message.slice(0,80)); } };
  $("sbPush").onclick = async () => {
    if(!AR_CLOUD.configured()){ status("save settings first"); return; }
    status("syncing…");
    try{ const n = await AR_CLOUD.push(RECORDS); status(`✓ synced ${n} records (metadata only)`); }
    catch(e){ status("✗ "+e.message.slice(0,90)); }
  };
  $("sbPull").onclick = async () => {
    if(!AR_CLOUD.configured()){ status("save settings first"); return; }
    status("pulling…");
    try{ const recs = await AR_CLOUD.pull(); await AR_DB.saveMany(recs); status(`✓ pulled ${recs.length} records`); load(); }
    catch(e){ status("✗ "+e.message.slice(0,90)); }
  };
  $("sbForget").onclick = () => { AR_CLOUD.clearConfig(); $("sbUrl").value=""; $("sbKey").value=""; cloudState(); status("keys removed from this browser"); };
}

initCloud();
load();
