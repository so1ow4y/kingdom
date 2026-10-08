// Локальная база в IndexedDB (docs/ARCHITECTURE.md §4).
// Версия IDB-схемы (IDB_VERSION) — это не schemaVersion формата данных: она меняется только при добавлении сторов.

import { openDb, req, txDone, deleteDb } from './idb.js';
import { DB_NAME, FEAST_DB_NAME } from '../config.js';
import { FEAST_COLLECTIONS } from '../core/feast.js';

const IDB_VERSION = 3;
const V1_STORES = ['settings', 'lists', 'tasks', 'media', 'devices'];
const V2_STORES = ['priorities', 'coinEvents', 'rewards']; // формат данных v2 (обновление 0.3)
const V3_STORES = ['doneArchive']; // формат данных v3 (обновление 0.5)
export const ENTITY_STORES = [...V1_STORES, ...V2_STORES, ...V3_STORES];
// Счётчик калорий (0.11) — отдельная база IndexedDB с тем же устройством сторов (без медиа);
// версия 2 (0.12) — сторы рационов и заметок к ним
const FEAST_IDB_VERSION = 2;
export const FEAST_STORES = FEAST_COLLECTIONS;

/** Создаёт все недостающие сторы — независимо от старой версии (переживает и «пустую» базу без сторов). */
const upgradeFor = (stores) => (db) => {
  const make = (name, opts, index = null) => {
    if (db.objectStoreNames.contains(name)) return;
    const s = db.createObjectStore(name, opts);
    if (index) s.createIndex(index, index);
  };
  for (const s of stores) make(s, { keyPath: 'id' });
  make('dirty', { keyPath: 'key' });
  make('base', { keyPath: 'key' });
  make('meta', { keyPath: 'key' });
  make('snapshots', { keyPath: 'key' });
  make('conflicts', { keyPath: 'id', autoIncrement: true }, 'at');
  make('errors', { keyPath: 'id', autoIncrement: true });
  make('blobs', { keyPath: 'id' }, 'lastAccess');
};

let current = null;
let feastCurrent = null;

/** Открытый репозиторий задач (после bootstrap). */
export function getRepo() {
  return current;
}

/** Открытый репозиторий Feast (0.11). */
export function getFeastRepo() {
  return feastCurrent;
}

export async function openRepo() {
  current = await createRepo(DB_NAME, IDB_VERSION, ENTITY_STORES);
  return current;
}

export async function openFeastRepo() {
  feastCurrent = await createRepo(FEAST_DB_NAME, FEAST_IDB_VERSION, FEAST_STORES);
  return feastCurrent;
}

async function createRepo(name, version, stores) {
  const db = await openDb(name, version, upgradeFor(stores));
  // Другая вкладка удаляет базу («Очистить локальный кэш») — закрываемся и перезагружаемся.
  db.onversionchange = () => {
    db.close();
    location.reload();
  };

  return {
    async loadAll() {
      const tx = db.transaction([...stores, 'meta'], 'readonly');
      // Все запросы ставятся сразу, в одной транзакции, — получаем согласованный снимок.
      const [metaRows, ...lists] = await Promise.all([
        req(tx.objectStore('meta').getAll()),
        ...stores.map((s) => req(tx.objectStore(s).getAll())),
      ]);
      const out = {};
      stores.forEach((s, i) => { out[s] = lists[i]; });
      out.meta = {};
      for (const { key, value } of metaRows) out.meta[key] = value;
      return out;
    },

    /** Одна транзакция: сущности + отметки «непушнуто» + meta. */
    async commit({ puts = [], deletes = [], dirty = [], meta = {} }) {
      const stores = new Set(['dirty', 'meta']);
      for (const [s] of puts) stores.add(s);
      for (const [s] of deletes) stores.add(s);
      const tx = db.transaction([...stores], 'readwrite');
      const done = txDone(tx);
      for (const [s, value] of puts) tx.objectStore(s).put(value);
      for (const [s, key] of deletes) tx.objectStore(s).delete(key);
      const stamp = meta['clock.lastStamp'] ?? null;
      for (const key of dirty) tx.objectStore('dirty').put({ key, stamp });
      for (const [key, value] of Object.entries(meta)) tx.objectStore('meta').put({ key, value });
      await done;
    },

    async get(store, id) {
      return req(db.transaction(store, 'readonly').objectStore(store).get(id));
    },

    async dirtyCount() {
      return req(db.transaction('dirty', 'readonly').objectStore('dirty').count());
    },

    async getMeta(key) {
      const r = await req(db.transaction('meta', 'readonly').objectStore('meta').get(key));
      return r ? r.value : undefined;
    },

    async setMeta(key, value) {
      const tx = db.transaction('meta', 'readwrite');
      const done = txDone(tx);
      tx.objectStore('meta').put({ key, value });
      await done;
    },

    async logError(entry) {
      try {
        const tx = db.transaction('errors', 'readwrite');
        const done = txDone(tx);
        const s = tx.objectStore('errors');
        s.add(entry);
        const r = s.getAllKeys();
        r.onsuccess = () => {
          for (const k of r.result.slice(0, Math.max(0, r.result.length - 50))) s.delete(k);
        };
        await done;
      } catch {
        // журнал ошибок не должен ронять приложение
      }
    },

    async dirtyKeys() {
      return req(db.transaction('dirty', 'readonly').objectStore('dirty').getAllKeys());
    },

    /** Снимок fieldTimes последней синхронизации: Map<'coll/id', fieldTimes>. */
    async loadBase() {
      const rows = await req(db.transaction('base', 'readonly').objectStore('base').getAll());
      return new Map(rows.map((r) => [r.key, r.ft]));
    },

    async listConflicts() {
      const rows = await req(db.transaction('conflicts', 'readonly').objectStore('conflicts').getAll());
      return rows.reverse();
    },

    async updateConflict(row) {
      const tx = db.transaction('conflicts', 'readwrite');
      const done = txDone(tx);
      tx.objectStore('conflicts').put(row);
      await done;
    },

    async listErrors() {
      const rows = await req(db.transaction('errors', 'readonly').objectStore('errors').getAll());
      return rows.reverse();
    },

    /**
     * Результат синхронизации одной транзакцией. Транзакция создаётся синхронно, до первого await,
     * поэтому правки пользователя, сделанные после вызова, гарантированно запишутся позже.
     */
    applySync({ puts = [], deletes = [], dirtyAdd = [], dirtyRemove = [], base = null, conflicts = [], meta = {} }) {
      const tx = db.transaction([...stores, 'dirty', 'base', 'conflicts', 'meta'], 'readwrite');
      const done = txDone(tx);
      for (const [s, value] of puts) tx.objectStore(s).put(value);
      for (const [s, key] of deletes) tx.objectStore(s).delete(key);
      for (const key of dirtyRemove) tx.objectStore('dirty').delete(key);
      for (const key of dirtyAdd) tx.objectStore('dirty').put({ key, stamp: null });
      if (base) {
        const b = tx.objectStore('base');
        b.clear();
        for (const [key, ft] of base) b.put({ key, ft });
      }
      const c = tx.objectStore('conflicts');
      for (const row of conflicts) c.add(row);
      for (const [key, value] of Object.entries(meta)) tx.objectStore('meta').put({ key, value });
      return done;
    },

    /** Полная замена данных (миграция локальной базы). snapshot — копия до миграции. */
    async replaceAll(data, { meta = {}, snapshot = null } = {}) {
      const tx = db.transaction([...stores, 'meta', 'snapshots'], 'readwrite');
      const done = txDone(tx);
      for (const s of stores) {
        const st = tx.objectStore(s);
        st.clear();
        for (const e of data[s] || []) st.put(e);
      }
      if (snapshot) tx.objectStore('snapshots').put(snapshot);
      for (const [key, value] of Object.entries(meta)) tx.objectStore('meta').put({ key, value });
      await done;
    },

    // ---------- Байты медиа (стор blobs; docs/TZ.md §10.3): { id: sha256, blob, size, lastAccess, pinned } ----------

    async putBlob(id, blob, { pinned = false } = {}) {
      const tx = db.transaction('blobs', 'readwrite');
      const done = txDone(tx);
      tx.objectStore('blobs').put({ id, blob, size: blob.size, lastAccess: Date.now(), pinned });
      await done;
    },

    /** Байты или null; отмечает время обращения (для вытеснения по LRU). */
    async getBlob(id) {
      const tx = db.transaction('blobs', 'readwrite');
      const done = txDone(tx);
      const s = tx.objectStore('blobs');
      const row = await req(s.get(id));
      if (row) s.put({ ...row, lastAccess: Date.now() });
      await done;
      return row ? row.blob : null;
    },

    async hasBlob(id) {
      return !!(await req(db.transaction('blobs', 'readonly').objectStore('blobs').getKey(id)));
    },

    async setBlobPinned(id, pinned) {
      const tx = db.transaction('blobs', 'readwrite');
      const done = txDone(tx);
      const s = tx.objectStore('blobs');
      const row = await req(s.get(id));
      if (row && row.pinned !== pinned) s.put({ ...row, pinned });
      await done;
    },

    async deleteBlob(id) {
      const tx = db.transaction('blobs', 'readwrite');
      const done = txDone(tx);
      tx.objectStore('blobs').delete(id);
      await done;
    },

    /** Метаданные кэша без самих байтов: [{ id, size, lastAccess, pinned }]. */
    async listBlobs() {
      const out = [];
      await new Promise((resolve, reject) => {
        const r = db.transaction('blobs', 'readonly').objectStore('blobs').openCursor();
        r.onsuccess = () => {
          const cur = r.result;
          if (!cur) return resolve();
          const { id, size, lastAccess, pinned } = cur.value;
          out.push({ id, size, lastAccess, pinned });
          cur.continue();
        };
        r.onerror = () => reject(r.error);
      });
      return out;
    },

    close() {
      db.close();
    },
  };
}

export async function deleteLocalDatabase() {
  await deleteDb(DB_NAME);
  await deleteDb(FEAST_DB_NAME);
}
