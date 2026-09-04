(() => {
  const DB_NAME = "fitness-pwa-db";
  const DB_VERSION = 1;
  const STORE = "kv";
  const STATE_KEYS = Object.freeze(["plans", "sessions", "body"]);

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const database = req.result;
        if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function get(db, key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function set(db, key, value) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function readState(db) {
    const [plans, sessions, body] = await Promise.all([
      get(db, "plans"),
      get(db, "sessions"),
      get(db, "body")
    ]);
    return {
      plans: Array.isArray(plans) ? plans : [],
      sessions: Array.isArray(sessions) ? sessions : [],
      body: Array.isArray(body) ? body : []
    };
  }

  function writeKeys(db, state, keys = STATE_KEYS) {
    const selected = [...new Set(keys)].filter(key => STATE_KEYS.includes(key));
    if (!selected.length) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const key of selected) store.put(state[key], key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function writeState(db, state) {
    return writeKeys(db, state, STATE_KEYS);
  }

  window.FitnessStorage = Object.freeze({ open, get, set, readState, writeKeys, writeState });
})();
