/* AstroRoot local database — IndexedDB. Shared by app.js (write) and dashboard.js (read).
 * Records live on the device (privacy-preserving). Export/import moves them as JSON. */
const AR_DB = (() => {
  const NAME = "astroroot", STORE = "results", VERSION = 1;
  let _db = null;

  function open(){
    return new Promise((res, rej) => {
      if(_db) return res(_db);
      const rq = indexedDB.open(NAME, VERSION);
      rq.onupgradeneeded = e => {
        const db = e.target.result;
        if(!db.objectStoreNames.contains(STORE)){
          const os = db.createObjectStore(STORE, {keyPath:"id"});
          os.createIndex("ts", "ts");
          os.createIndex("name", "name");
        }
      };
      rq.onsuccess = e => { _db = e.target.result; res(_db); };
      rq.onerror = e => rej(e.target.error);
    });
  }
  function tx(mode){ return open().then(db => db.transaction(STORE, mode).objectStore(STORE)); }

  const id = () => "r" + Math.random().toString(36).slice(2,10) + performance.now().toString(36).replace(".","");

  async function save(rec){
    const store = await tx("readwrite");
    const full = Object.assign({ id: id(), ts: null }, rec);   // ts stamped by caller (Date not always allowed)
    return new Promise((res,rej)=>{ const r = store.put(full); r.onsuccess=()=>res(full.id); r.onerror=e=>rej(e.target.error); });
  }
  async function saveMany(recs){ const ids=[]; for(const r of recs) ids.push(await save(r)); return ids; }

  async function all(){
    const store = await tx("readonly");
    return new Promise((res,rej)=>{ const r = store.getAll(); r.onsuccess=()=>res(r.result.sort((a,b)=>(b.ts||0)-(a.ts||0))); r.onerror=e=>rej(e.target.error); });
  }
  async function remove(rid){ const store = await tx("readwrite"); return new Promise((res,rej)=>{ const r=store.delete(rid); r.onsuccess=()=>res(); r.onerror=e=>rej(e.target.error); }); }
  async function clear(){ const store = await tx("readwrite"); return new Promise((res,rej)=>{ const r=store.clear(); r.onsuccess=()=>res(); r.onerror=e=>rej(e.target.error); }); }
  async function count(){ const store = await tx("readonly"); return new Promise((res,rej)=>{ const r=store.count(); r.onsuccess=()=>res(r.result); r.onerror=e=>rej(e.target.error); }); }

  async function exportJSON(){ return JSON.stringify({schema:"astroroot/v1", exported:null, records: await all()}, null, 2); }
  async function importJSON(text){
    const obj = JSON.parse(text);
    const recs = Array.isArray(obj) ? obj : (obj.records||[]);
    let n=0; for(const r of recs){ if(r && r.id){ const store=await tx("readwrite"); await new Promise((res)=>{ const q=store.put(r); q.onsuccess=res; q.onerror=res; }); n++; } }
    return n;
  }
  return { save, saveMany, all, remove, clear, count, exportJSON, importJSON };
})();
if(typeof window !== "undefined") window.AR_DB = AR_DB;
