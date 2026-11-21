// Tiny IndexedDB key-value store, one object store per collection.
const DB = 'rill';
const STORES = ['chats', 'plans', 'files', 'notes'];
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
}

export const store = {
  all: (s) => tx(s, 'readonly', (o) => o.getAll()),
  get: (s, id) => tx(s, 'readonly', (o) => o.get(id)),
  put: (s, v) => tx(s, 'readwrite', (o) => o.put(structuredClone(v))),
  del: (s, id) => tx(s, 'readwrite', (o) => o.delete(id)),
  clear: async () => { for (const s of STORES) await tx(s, 'readwrite', (o) => o.clear()); },
};

const SETTINGS_KEY = 'rill.settings';
export const DEFAULT_SETTINGS = { name: '', thinking: false, webReader: false, autoRun: true, device: 'auto', maxSteps: 40 };
export function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }
