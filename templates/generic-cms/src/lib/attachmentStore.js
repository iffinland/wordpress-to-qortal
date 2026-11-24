/** Owner/deployment-scoped binary draft storage. Blobs never enter localStorage. */
const DATABASE = 'qms-cms-attachment-drafts';
const TABLE = 'captures';

function openDatabase(factory) {
  return new Promise((resolve, reject) => {
    if (!factory) { reject(Error('Browser file storage is unavailable.')); return; }
    const request = factory.open(DATABASE, 1);
    const timer = setTimeout(() => reject(Error('Browser file storage is blocked.')), 3000);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(TABLE, { keyPath: 'key' });
      store.createIndex('scope', 'scope');
    };
    request.onsuccess = () => {
      clearTimeout(timer);
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => { clearTimeout(timer); reject(request.error); };
    request.onblocked = () => { clearTimeout(timer); reject(Error('Browser file storage is blocked.')); };
  });
}
function transaction(db, mode, operation) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TABLE, mode);
    const request = operation(tx.objectStore(TABLE));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(tx.error || Error('Could not save attachment files.'));
  });
}

/** @param {string} scope @param {any} factory @returns {any} */
export function createAttachmentStore(scope, factory = globalThis.indexedDB) {
  const store = new Map();
  let db;
  const removed = new Set();
  let tail = Promise.resolve();
  store.ready = (async () => {
    if (!scope) return;
    try {
      db = await openDatabase(factory);
      const rows = await transaction(db, 'readonly', table => table.index('scope').getAll(scope));
      for (const row of rows) if (!store.has(row.capture.identifier) && !removed.has(row.capture.identifier)) store.set(row.capture.identifier, row.capture);
    } catch { /* Memory capture still permits publishing in this session. */ }
  })();
  store.save = async (capture) => {
    removed.delete(capture.identifier);
    store.set(capture.identifier, capture);
    // Queue snapshots so an older save cannot overwrite a newer poster.
    const value = { ...capture, poster: capture.poster ? { ...capture.poster } : null };
    const operation = tail.then(async () => {
      await store.ready;
      if (!db || !scope) return false;
      try {
        await transaction(db, 'readwrite', table => table.put({ key: scope + '\0' + capture.identifier, scope, capture: value }));
        // Use the durable Blob copy rather than a revocable device File handle.
        const saved = await transaction(db, 'readonly', table => table.get(scope + '\0' + capture.identifier));
        if (store.get(capture.identifier) === capture && saved) store.set(capture.identifier, saved.capture);
        return true;
      } catch { return false; }
    });
    tail = operation.catch(() => false);
    return operation;
  };
  const remove = store.delete.bind(store);
  store.delete = (identifier) => {
    removed.add(identifier);
    const deleted = remove(identifier);
    tail = tail.then(async () => {
      await store.ready;
      if (db && scope) await transaction(db, 'readwrite', table => table.delete(scope + '\0' + identifier));
    }).catch(() => undefined);
    return deleted;
  };
  store.prune = async identifiers => {
    await store.ready;
    const keep = new Set(identifiers);
    for (const identifier of store.keys()) if (!keep.has(identifier)) store.delete(identifier);
    await tail;
  };
  store.settled = () => tail;
  store.close = async () => { await store.ready; await tail; if (db) db.close(); };
  return store;
}
