/* AstroRoot dashboard — reads the local IndexedDB and renders stats, charts and a table.
 * Inspired by RootNav-Viewer 2.0 (collection browse -> search -> per-item measurements),
 * reimagined as a dependency-free web page. */
const $ = id => document.getElementById(id);
let RECORDS = [], sortKey = "ts", sortDir = -1, filter = "", groupSel = "";
const selected = new Set();

async function load(){
  RECORDS = await AR_DB.all();
  render();
}
function view(){
  const f = filter.toLowerCase();
  let rows = RECORDS.filter(r => (!f || `${r.name} ${r.engine} ${r.marker} ${r.group||""}`.toLowerCase().includes(f))
                              && (!groupSel || (r.group||"")===groupSel));
  rows.sort((a,b)=>{ const x=a[sortKey]??"", y=b[sortKey]??"";
    return (x<y?-1:x>y?1:0)*sortDir; });
  return rows;
}
function render(){
  const has = RECORDS.length>0;
  $("empty").style.display = has?"none":"block";
  $("content").style.display = has?"block":"none";
  if(!has) return;
  const rows = view();
  populateGroupFilter();
  renderGroupSummary();
  renderStats(rows); renderCharts(rows); renderTable(rows);
  updateSelUI();
}
function groups(){ return [...new Set(RECORDS.map(r=>r.group).filter(Boolean))].sort(); }
function populateGroupFilter(){
  const gf=$("groupFilter"), cur=gf.value;
  gf.innerHTML = `<option value="">all</option>` + groups().map(g=>`<option value="${esc(g)}">${esc(g)}</option>`).join("");
  gf.value = cur;
}
function updateSelUI(){
  $("selCount").textContent = `${selected.size} selected`;
  $("makeGroup").disabled = selected.size===0;
  $("ungroup").disabled = selected.size===0;
}
function renderGroupSummary(){
  const gs = groups();
  if(!gs.length){ $("groupSummary").innerHTML=""; return; }
  const rowsFor = g => RECORDS.filter(r=>r.group===g);
  const m = a => a.length? (a.reduce((s,v)=>s+v,0)/a.length):0;
  const col = (g)=>{ const rr=rowsFor(g); const cm=rr.filter(r=>r.lengthUnit==="cm").map(r=>r.lengthVal);
    const trl=rr.map(r=>r.arch?.TRL).filter(v=>v!=null);
    return `<tr><td><b>${esc(g)}</b></td><td>${rr.length}</td>`+
      `<td>${cm.length?m(cm).toFixed(2)+" cm":"—"}</td>`+
      `<td>${trl.length?m(trl).toFixed(1):"—"}</td>`+
      `<td>${m(rr.map(r=>r.tips)).toFixed(1)}</td>`+
      `<td>${m(rr.map(r=>r.branches)).toFixed(1)}</td>`+
      `<td>${m(rr.map(r=>r.angle)).toFixed(1)}°</td></tr>`; };
  $("groupSummary").innerHTML = `<h3 style="margin:4px 0 6px;font-size:15px">Group summary</h3>`+
    `<table class="datatable"><thead><tr><th>Group</th><th>n</th><th>Mean length</th><th>Mean TRL</th><th>Mean tips</th><th>Mean branches</th><th>Mean angle</th></tr></thead>`+
    `<tbody>${gs.map(col).join("")}</tbody></table>`;
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
  renderTrajectory(rows);
}

const TRAJ_PALETTE = ["#3fb950","#58a6ff","#d29922","#f85149","#b07fd0","#e668a7","#39c5cf","#db6d28"];
function renderTrajectory(rows){
  // build series from time-series records (batch-across-frames: have frame + plant)
  const ts = rows.filter(r => r.frame && r.plant!=null && typeof r[$("trajMetric").value]==="number");
  const series = {};
  ts.forEach(r => { const key = `${r.group||"plant"}#${r.plant}`;
    (series[key] = series[key] || {group:r.group||"plant", pts:[]}).pts.push(r); });
  const keys = Object.keys(series);
  if(!keys.length || Object.values(series).every(s=>s.pts.length<2)){ $("trajBox").style.display="none"; return; }
  $("trajBox").style.display="block";
  const metric = $("trajMetric").value;
  const allTs = [...new Set(ts.map(r=>r.ts))].sort((a,b)=>a-b);
  const tmin=allTs[0], tmax=allTs[allTs.length-1]||tmin+1;
  const vals = ts.map(r=>+r[metric]); let vmin=Math.min(...vals), vmax=Math.max(...vals);
  if(vmin===vmax){ vmin-=1; vmax+=1; }
  const groups = [...new Set(Object.values(series).map(s=>s.group))];
  const gcol = g => TRAJ_PALETTE[groups.indexOf(g)%TRAJ_PALETTE.length];
  const W=720,H=280,pad=42;
  const sx=t=>pad+(W-2*pad)*(t-tmin)/((tmax-tmin)||1), sy=v=>H-pad-(H-2*pad)*(v-vmin)/((vmax-vmin)||1);
  let faint="", mean="";
  Object.values(series).forEach(s=>{ const p=s.pts.slice().sort((a,b)=>a.ts-b.ts); if(p.length<2) return;
    faint += `<polyline points="${p.map(r=>sx(r.ts).toFixed(1)+","+sy(+r[metric]).toFixed(1)).join(" ")}" fill="none" stroke="${gcol(s.group)}" stroke-width="1" opacity="0.3"/>`; });
  groups.forEach(g=>{ const byTs={}; Object.values(series).filter(s=>s.group===g).forEach(s=>s.pts.forEach(r=>{ (byTs[r.ts]=byTs[r.ts]||[]).push(+r[metric]); }));
    const mp=Object.keys(byTs).map(t=>({ts:+t, v:byTs[t].reduce((a,b)=>a+b,0)/byTs[t].length})).sort((a,b)=>a.ts-b.ts);
    if(mp.length<2) return;
    mean += `<polyline points="${mp.map(p=>sx(p.ts).toFixed(1)+","+sy(p.v).toFixed(1)).join(" ")}" fill="none" stroke="${gcol(g)}" stroke-width="3.5" opacity="0.95"/>`;
    mean += mp.map(p=>`<circle cx="${sx(p.ts).toFixed(1)}" cy="${sy(p.v).toFixed(1)}" r="3" fill="${gcol(g)}"/>`).join(""); });
  const zeroLine = (vmin<0&&vmax>0) ? `<line x1="${pad}" y1="${sy(0).toFixed(1)}" x2="${W-pad}" y2="${sy(0).toFixed(1)}" stroke="var(--muted)" stroke-dasharray="3,3" opacity="0.5"/>` : "";
  const axis = `<line x1="${pad}" y1="${H-pad}" x2="${W-pad}" y2="${H-pad}" stroke="var(--edge)"/><line x1="${pad}" y1="${pad}" x2="${pad}" y2="${H-pad}" stroke="var(--edge)"/>`+
    `<text x="${pad}" y="${H-pad+16}" font-size="10" fill="var(--muted)">frame 1</text><text x="${W-pad}" y="${H-pad+16}" font-size="10" fill="var(--muted)" text-anchor="end">frame ${allTs.length}</text>`+
    `<text x="8" y="${pad+3}" font-size="10" fill="var(--muted)">${vmax.toFixed(1)}</text><text x="8" y="${(H-pad).toFixed(0)}" font-size="10" fill="var(--muted)">${vmin.toFixed(1)}</text>`;
  $("trajChart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px">${zeroLine}${faint}${mean}${axis}</svg>`;
  $("trajLegend").innerHTML = groups.map(g=>`<span style="color:${gcol(g)};font-weight:700">■</span> ${esc(g)}`).join("  ")+
    ` · thin = each plant, thick = genotype mean · ${keys.length} plant-tracks over ${allTs.length} frames`;
}
$("trajMetric").onchange = () => renderTrajectory(view());

function renderTable(rows){
  const tb = $("tbl").querySelector("tbody");
  tb.innerHTML = rows.map(r=>`<tr data-id="${r.id}">
    <td><input type="checkbox" class="rowsel" data-id="${r.id}" ${selected.has(r.id)?"checked":""}></td>
    <td>${r.thumb?`<img src="${r.thumb}" width="44" style="border-radius:4px">`:(r.geom?`<span class="minisketch" data-id="${r.id}"></span>`:"—")}</td>
    <td>${esc(r.name)}</td><td>${fmtDate(r.ts)}</td><td>${esc(r.engine)}</td>
    <td>${r.group?`<span class="grouptag">${esc(r.group)}</span>`:"—"}</td>
    <td>${r.lengthVal.toFixed?r.lengthVal.toFixed(2):r.lengthVal} ${r.lengthUnit}${r.colorCorrected?" ✓":""}</td>
    <td>${r.tips}</td><td>${r.branches}</td><td>${r.angle}</td>
    <td><button class="ghost del" data-id="${r.id}" title="delete" style="padding:2px 8px">✕</button></td>
  </tr>`).join("");
  tb.querySelectorAll(".del").forEach(b=>b.onclick=async e=>{ e.stopPropagation(); selected.delete(b.dataset.id); await AR_DB.remove(b.dataset.id); load(); });
  tb.querySelectorAll(".rowsel").forEach(c=>c.onclick=e=>{ e.stopPropagation();
    if(c.checked) selected.add(c.dataset.id); else selected.delete(c.dataset.id); updateSelUI(); });
  tb.querySelectorAll("tr").forEach(tr=>tr.onclick=e=>{ if(e.target.classList.contains("rowsel")) return; showDetail(RECORDS.find(r=>r.id===tr.dataset.id)); });
  tb.querySelectorAll(".minisketch").forEach(s=>{ const r=RECORDS.find(x=>x.id===s.dataset.id); if(r&&r.geom) s.innerHTML=rootSVG(r.geom, 40, 40, 1); });
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
function rootSVG(geom, W, H, sw){
  const pts=[].concat(...geom.map(g=>g.p)); if(!pts.length) return "";
  const xs=pts.map(p=>p[0]), ys=pts.map(p=>p[1]);
  const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
  const pad=4, span=Math.max(x1-x0,y1-y0,1), s=(Math.min(W,H)-2*pad)/span;
  const cx=(x)=>pad+(x-x0)*s+(W-2*pad-(x1-x0)*s)/2, cy=(y)=>pad+(y-y0)*s;
  const col=o=>o===1?"var(--accent)":o===2?"var(--accent2)":"#b07fd0";
  const paths=geom.map(g=>`<polyline points="${g.p.map(p=>cx(p[0]).toFixed(1)+","+cy(p[1]).toFixed(1)).join(" ")}" fill="none" stroke="${col(g.o)}" stroke-width="${g.o===1?sw*1.6:sw}" stroke-linecap="round" stroke-linejoin="round"/>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${paths}</svg>`;
}
function showDetail(rec){
  if(!rec) return;
  $("detail").style.display="block";
  $("detailName").textContent = `${rec.name} — ${rec.engine}` + (rec.group?` · ${rec.group}`:"");
  // image of the selected root: the analysis thumbnail, or a drawing from the RSML geometry
  if(rec.thumb) $("detailImage").innerHTML = `<img src="${rec.thumb}" style="max-width:220px;border-radius:8px"><div class="tlbl">saved image</div>`;
  else if(rec.geom) $("detailImage").innerHTML = rootSVG(rec.geom, 200, 260, 2) + `<div class="tlbl">root system (colour = branching order)</div>`;
  else $("detailImage").innerHTML = `<div class="tlbl">no image</div>`;
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

/* ---------- selection & groups ---------- */
$("selAll").onclick = e=>{ const on=e.target.checked;
  view().forEach(r=>{ if(on) selected.add(r.id); else selected.delete(r.id); });
  document.querySelectorAll(".rowsel").forEach(c=>c.checked=on); updateSelUI(); };
$("groupFilter").onchange = e=>{ groupSel=e.target.value; render(); };
$("makeGroup").onclick = async ()=>{
  if(!selected.size) return;
  const name = prompt(`Name the group for ${selected.size} selected record(s):`, "");
  if(name==null || !name.trim()) return;
  for(const r of RECORDS){ if(selected.has(r.id)){ r.group=name.trim(); await AR_DB.save(r); } }
  selected.clear(); load();
};
$("ungroup").onclick = async ()=>{
  if(!selected.size) return;
  for(const r of RECORDS){ if(selected.has(r.id)){ delete r.group; await AR_DB.save(r); } }
  selected.clear(); load();
};
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
    } else if($("sampleSet").value === "stereotypes"){
      const recs=[];
      for(const nm of STEREOTYPES){
        const rec = AR_RSML.parse(await (await fetch(`samples/stereotypes/${nm}.rsml`)).text(), nm+".rsml");
        if(rec){ rec.id = "sample_stereo_"+nm; recs.push(rec); }
      }
      await AR_DB.saveMany(recs);
      alert(`Loaded ${recs.length} extreme-stereotype architectures (archidart-style traits).`);
    } else {
      const idx = await (await fetch("samples/tictoc/index.json")).json();
      const recs=[];
      for(const f of idx.files){
        const rec = AR_RSML.parse(await (await fetch(`samples/tictoc/${encodeURIComponent(f.file)}`)).text(), f.file);
        if(rec){ rec.id="sample_tictoc_"+f.file.replace(/\W+/g,"_"); rec.group=f.group;
          rec.name=`${f.genotype} ${f.well} d${f.day}`; recs.push(rec); }
      }
      await AR_DB.saveMany(recs);
      alert(`Loaded ${recs.length} TICTOC cotton records, pre-grouped Flight vs Ground.`);
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
