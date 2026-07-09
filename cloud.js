/* AstroRoot cloud sync — Supabase REST, METADATA ONLY (no images/thumbnails leave the device).
 * Config (project URL + publishable ANON key) is entered by the user and kept in localStorage —
 * never committed. Only the anon key is used client-side; never the service_role secret.
 * Sync is only safe with Row Level Security enabled (see supabase/schema.sql). */
const AR_CLOUD = (() => {
  const LS = "astroroot.supabase";
  const COLS = "id,ts,name,engine,marker,px_per_cm,length_val,length_unit,color_corrected,tips,branches,angle";

  function config(){ try{ return JSON.parse(localStorage.getItem(LS)) || {}; }catch{ return {}; } }
  function setConfig(url, key, table){
    const cfg = { url:(url||"").replace(/\/+$/,""), key:key||"", table:table||"measurements" };
    localStorage.setItem(LS, JSON.stringify(cfg)); return cfg;
  }
  function clearConfig(){ localStorage.removeItem(LS); }
  function configured(){ const c=config(); return !!(c.url && c.key && c.table); }

  function endpoint(){ const c=config(); return `${c.url}/rest/v1/${c.table}`; }
  function headers(extra){ const c=config(); return Object.assign(
    { apikey:c.key, Authorization:`Bearer ${c.key}`, "Content-Type":"application/json" }, extra||{}); }

  // local (camelCase) -> row (snake_case), METADATA ONLY: thumb/images are never included
  function toRow(r){ return {
    id:r.id, ts:r.ts, name:r.name, engine:r.engine, marker:r.marker,
    px_per_cm:r.pxPerCm ?? null, length_val:r.lengthVal, length_unit:r.lengthUnit,
    color_corrected:!!r.colorCorrected, tips:r.tips, branches:r.branches, angle:r.angle };
  }                                                    // NOTE: r.thumb is deliberately omitted
  function fromRow(row){ return {
    id:row.id, ts:row.ts, name:row.name, engine:row.engine, marker:row.marker,
    pxPerCm:row.px_per_cm, lengthVal:row.length_val, lengthUnit:row.length_unit,
    colorCorrected:row.color_corrected, tips:row.tips, branches:row.branches, angle:row.angle, thumb:null };
  }

  async function test(){
    if(!configured()) throw new Error("not configured");
    const res = await fetch(`${endpoint()}?select=id&limit=1`, { headers: headers() });
    if(!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
    return true;
  }
  async function push(records){
    if(!configured()) throw new Error("not configured");
    const rows = records.map(toRow);                   // <-- strips thumbnails here
    if(!rows.length) return 0;
    const res = await fetch(`${endpoint()}?on_conflict=id`, {
      method:"POST",
      headers: headers({ Prefer:"resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify(rows)
    });
    if(!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
    return rows.length;
  }
  async function pull(limit=1000){
    if(!configured()) throw new Error("not configured");
    const res = await fetch(`${endpoint()}?select=${COLS}&order=ts.desc&limit=${limit}`, { headers: headers() });
    if(!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
    return (await res.json()).map(fromRow);
  }
  return { config, setConfig, clearConfig, configured, test, push, pull, toRow, fromRow, endpoint, headers };
})();
if(typeof window !== "undefined") window.AR_CLOUD = AR_CLOUD;
