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
  const cm = rows.filter(r=>r.lengthUnit==="cm").map(r=>r.lengthVal);
  const cards = [
    ["Records", rows.length],
    ["Mean length", cm.length?`${mean(cm).toFixed(2)} cm`:"—"],
    ["Mean tips", rows.length?mean(rows.map(r=>r.tips)).toFixed(1):"—"],
    ["Mean branches", rows.length?mean(rows.map(r=>r.branches)).toFixed(1):"—"],
    ["Mean angle", rows.length?`${mean(rows.map(r=>r.angle)).toFixed(1)}°`:"—"],
  ];
  $("stats").innerHTML = cards.map(([k,v])=>`<div class="stat"><div class="statval">${v}</div><div class="statlbl">${k}</div></div>`).join("");
}

function svg(w,h,inner){ return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="max-width:${w}px">${inner}</svg>`; }
function renderCharts(rows){
  // length histogram (calibrated cm records only)
  const cm = rows.filter(r=>r.lengthUnit==="cm").map(r=>r.lengthVal);
  if(cm.length){
    const W=340,H=170,pad=28, min=Math.min(...cm), max=Math.max(...cm)||1, bins=8;
    const counts=new Array(bins).fill(0); cm.forEach(v=>{ let b=Math.floor((v-min)/((max-min)||1)*bins); if(b>=bins)b=bins-1; counts[b]++; });
    const cmax=Math.max(...counts)||1, bw=(W-2*pad)/bins;
    let bars=""; counts.forEach((c,i)=>{ const bh=(H-2*pad)*c/cmax; bars+=`<rect x="${pad+i*bw+2}" y="${H-pad-bh}" width="${bw-4}" height="${bh}" fill="var(--accent)"/>`; });
    const axis=`<line x1="${pad}" y1="${H-pad}" x2="${W-pad}" y2="${H-pad}" stroke="var(--edge)"/><text x="${pad}" y="${H-8}" font-size="10" fill="var(--muted)">${min.toFixed(1)}</text><text x="${W-pad}" y="${H-8}" font-size="10" fill="var(--muted)" text-anchor="end">${max.toFixed(1)} cm</text>`;
    $("chartLen").innerHTML = svg(W,H,bars+axis);
  } else $("chartLen").innerHTML = `<p class="method">No calibrated (cm) records yet.</p>`;
  // tips vs length scatter
  const pts = rows.filter(r=>r.lengthUnit==="cm");
  if(pts.length){
    const W=340,H=170,pad=30, xs=pts.map(p=>p.lengthVal), ys=pts.map(p=>p.tips);
    const xmin=Math.min(...xs),xmax=Math.max(...xs)||1,ymax=Math.max(...ys,1);
    const sx=v=>pad+(W-2*pad)*(v-xmin)/((xmax-xmin)||1), sy=v=>H-pad-(H-2*pad)*v/ymax;
    let dots=pts.map(p=>`<circle cx="${sx(p.lengthVal).toFixed(1)}" cy="${sy(p.tips).toFixed(1)}" r="4" fill="var(--accent2)" opacity="0.75"/>`).join("");
    const axis=`<line x1="${pad}" y1="${H-pad}" x2="${W-pad}" y2="${H-pad}" stroke="var(--edge)"/><line x1="${pad}" y1="${pad}" x2="${pad}" y2="${H-pad}" stroke="var(--edge)"/><text x="${W-pad}" y="${H-8}" font-size="10" fill="var(--muted)" text-anchor="end">length (cm)→</text><text x="6" y="${pad}" font-size="10" fill="var(--muted)">tips</text>`;
    $("chartScatter").innerHTML = svg(W,H,dots+axis);
  } else $("chartScatter").innerHTML = `<p class="method">No calibrated (cm) records yet.</p>`;
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
}
function esc(s){ return String(s==null?"":s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }

/* sorting */
document.querySelectorAll("th[data-sort]").forEach(th=>th.style.cursor="pointer");
document.querySelector("#tbl thead").onclick = e=>{ const k=e.target.dataset.sort; if(!k) return;
  if(sortKey===k) sortDir*=-1; else { sortKey=k; sortDir=1; } render(); };

/* controls */
$("search").oninput = e=>{ filter=e.target.value; render(); };
$("expCsv").onclick = ()=>{ const rows=view(); let csv="name,date,engine,marker,px_per_cm,length,unit,color_corrected,tips,branches,angle\n";
  rows.forEach(r=>csv+=`${r.name},${fmtDate(r.ts)},${r.engine},${r.marker},${r.pxPerCm||""},${r.lengthVal},${r.lengthUnit},${r.colorCorrected?1:0},${r.tips},${r.branches},${r.angle}\n`);
  dl("astroroot_database.csv", csv, "text/csv"); };
$("expJson").onclick = async ()=>dl("astroroot_backup.json", await AR_DB.exportJSON(), "application/json");
$("impJson").onchange = async e=>{ const f=e.target.files[0]; if(!f) return; const n=await AR_DB.importJSON(await f.text()); alert(`Imported ${n} records.`); load(); };
$("clearDb").onclick = async ()=>{ if(confirm("Delete ALL saved measurements from this device?")){ await AR_DB.clear(); load(); } };
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
