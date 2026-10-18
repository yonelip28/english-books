// appStorage — the app's storage layer. Replaces localStorage.
//
//  * Primary store: IndexedDB through localForage (hundreds of MB, no 5MB quota).
//  * The app reads settings while rendering, so everything is loaded into memory
//    ONCE at startup (`appStorage.ready`, awaited before the first render). Reads
//    are then instant; every write updates memory and is saved to IndexedDB in
//    the background (`appStorage.flush()` resolves when all writes are saved).
//  * localStorage is ONLY an emergency backup: it is used if IndexedDB is
//    unavailable, or if a write to IndexedDB fails (e.g. storage full). Keys saved
//    that way are listed under BACKUP_LIST_KEY and are moved back into IndexedDB
//    the next time the app starts (the backup copy is the newer one, so it wins).
//  * Data that older versions of the app left in localStorage is migrated into
//    IndexedDB on first start and then removed from localStorage.
import localforage from "localforage";

const BACKUP_LIST_KEY = "__rr_ls_backup_keys__";

// Rollback safety. While true, the old localStorage copy of every migrated key is
// LEFT IN PLACE (the app itself no longer reads it), so if you ever have to go back
// to the previous version of the site it still finds your data. Deletions are
// always applied to both places so removed things never come back. Once the new
// version has proven itself, free the space with:  await appStorage.dropLegacyCopies()
// (or set this to false).
const KEEP_LEGACY_COPY = true;

let lf = null;
try {
  lf = localforage.createInstance({ name: "reading-room-app", storeName: "kv", driver: localforage.INDEXEDDB });
} catch (e) {
  lf = null;
}

const mem = Object.create(null); // key -> string
const dirty = new Set(); // keys written during startup (newer than anything on disk)
let idbOk = !!lf; // becomes false if IndexedDB turns out to be unusable
let chain = Promise.resolve(); // writes are saved one after another, in order

// ---- localStorage helpers: backup only, every call is guarded ----
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
function lsRemove(k) { try { localStorage.removeItem(k); } catch (e) {} }
function readBackupList() {
  try { const a = JSON.parse(lsGet(BACKUP_LIST_KEY) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
function writeBackupList(a) {
  if (a.length) lsSet(BACKUP_LIST_KEY, JSON.stringify(a));
  else lsRemove(BACKUP_LIST_KEY);
}
function markBackup(k) { const a = readBackupList(); if (!a.includes(k)) { a.push(k); writeBackupList(a); } }
function unmarkBackup(k) { const a = readBackupList(); const i = a.indexOf(k); if (i >= 0) { a.splice(i, 1); writeBackupList(a); } }

// Saves one key (v === null removes it). Never throws.
async function persist(k, v) {
  if (idbOk) {
    try {
      if (v === null) await lf.removeItem(k);
      else await lf.setItem(k, v);
      if (v === null || !KEEP_LEGACY_COPY) lsRemove(k); // deletions always propagate
      unmarkBackup(k);
      return;
    } catch (e) {
      // IndexedDB refused this write (full / blocked): fall through to the backup.
    }
  }
  if (v === null) { lsRemove(k); unmarkBackup(k); return; }
  if (lsSet(k, v)) markBackup(k); // if even this fails the value stays in memory for the session
}

function queue(k, v) {
  chain = chain.then(() => persist(k, v), () => persist(k, v));
  return chain;
}

async function hydrate() {
  const lsKeys = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k !== BACKUP_LIST_KEY) lsKeys.push(k);
    }
  } catch (e) {}
  const backup = new Set(readBackupList());

  if (lf) {
    try {
      await lf.ready();
      const stored = await lf.keys();
      for (const k of stored) {
        if (dirty.has(k)) continue;
        const v = await lf.getItem(k);
        if (typeof v === "string") mem[k] = v;
      }
      const storedSet = new Set(stored);
      // Move whatever is in localStorage (old data, or the emergency backup) into IndexedDB.
      for (const k of lsKeys) {
        if (dirty.has(k)) continue;
        if (storedSet.has(k) && !backup.has(k)) { if (!KEEP_LEGACY_COPY) lsRemove(k); continue; } // already migrated earlier
        const v = lsGet(k);
        if (v === null) continue;
        await lf.setItem(k, v); // if this throws we keep localStorage as it is
        mem[k] = v;
        if (!KEEP_LEGACY_COPY) lsRemove(k);
        unmarkBackup(k);
      }
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
      return;
    } catch (e) {
      console.warn("appStorage: IndexedDB unavailable, running on localStorage as backup", e);
      idbOk = false;
    }
  }
  // IndexedDB is unusable: load whatever localStorage has and keep working from it.
  for (const k of lsKeys) {
    if (dirty.has(k)) continue;
    const v = lsGet(k);
    if (v !== null) mem[k] = v;
  }
}

export const appStorage = {
  getItem(k) { k = String(k); return k in mem ? mem[k] : null; },
  setItem(k, v) { k = String(k); v = String(v); mem[k] = v; dirty.add(k); queue(k, v); },
  removeItem(k) { k = String(k); delete mem[k]; dirty.add(k); queue(k, null); },
  key(i) { const ks = Object.keys(mem); return i >= 0 && i < ks.length ? ks[i] : null; },
  keys() { return Object.keys(mem); },
  get length() { return Object.keys(mem).length; },
  clear() { Object.keys(mem).forEach((k) => appStorage.removeItem(k)); },
  flush() { return chain; },
  // Deletes the leftover localStorage copies of keys that are safely stored in IndexedDB.
  async dropLegacyCopies() {
    if (!lf || !idbOk) return 0;
    const backup = new Set(readBackupList());
    const ks = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k !== BACKUP_LIST_KEY && !backup.has(k)) ks.push(k); } } catch (e) {}
    let n = 0;
    for (const k of ks) {
      try { if ((await lf.getItem(k)) !== null) { lsRemove(k); n++; } } catch (e) {}
    }
    return n;
  },
  ready: hydrate(),
};

if (typeof window !== "undefined") window.appStorage = appStorage;
export default appStorage;
