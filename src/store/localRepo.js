// Локальная база в IndexedDB (docs/ARCHITECTURE.md §4).
// Версия IDB-схемы (IDB_VERSION) — это не schemaVersion формата данных: она меняется только при добавлении сторов.

import { openDb, req, txDone, deleteDb } from './idb.js';
import { DB_NAME } from '../config.js';

const IDB_VERSION = 1;
export const ENTITY_STORES = ['settings', 'lists', 'tasks', 'media', 'devices'];

function upgrade(db, oldVersion) {
  if (oldVersion < 1) {
    for (const s of ENTITY_STORES) db.createObjectStore(s, { keyPath: 'id' });
    db.createObjectStore('dirty', { keyPath: 'key' });
    db.createObjectStore('base', { keyPath: 'key' });
    db.createObjectStore('meta', { keyPath: 'key' });
    db.createObjectStore('snapshots', { keyPath: 'key' });
    db.createObjectStore('conflicts', { keyPath: 'id', autoIncrement: true }).createIndex('at', 'at');
    db.createObjectStore('errors', { keyPath: 'id', autoIncrement: true });
    db.createObjectStore('blobs', { keyPath: 'id' }).createIndex('lastAccess', 'lastAccess');
  }
}

let current = null;

/** Открытый репозиторий (после bootstrap). */
export function getRepo() {
  return current;
}

export async function openRepo() {
  const db = await openDb(DB_NAME, IDB_VERSION, upgrade);
  // Другая вкладка удаляет базу («Очистить локальный кэш») — закрываемся и перезагружаемся.
  db.onversionchange = () => {
    db.close();
    location.reload();
  };

  current = {
    async loadAll() {
      const tx = db.transaction([...ENTITY_STORES, 'meta'], 'readonly');
      // Все запросы ставятся сразу, в одной транзакции, — получаем согласованный снимок.
      const [metaRows, ...lists] = await Promise.all([
        req(tx.objectStore('meta').getAll()),
        ...ENTITY_STORES.map((s) => req(tx.objectStore(s).getAll())),
      ]);
      const out = {};
      ENTITY_STORES.forEach((s, i) => { out[s] = lists[i]; });
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
      const tx = db.transaction([...ENTITY_STORES, 'dirty', 'base', 'conflicts', 'meta'], 'readwrite');
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
      const tx = db.transaction([...ENTITY_STORES, 'meta', 'snapshots'], 'readwrite');
      const done = txDone(tx);
      for (const s of ENTITY_STORES) {
        const st = tx.objectStore(s);
        st.clear();
        for (const e of data[s] || []) st.put(e);
      }
      if (snapshot) tx.objectStore('snapshots').put(snapshot);
      for (const [key, value] of Object.entries(meta)) tx.objectStore('meta').put({ key, value });
      await done;
    },

    close() {
      db.close();
    },
  };
  return current;
}

export async function deleteLocalDatabase() {
  await deleteDb(DB_NAME);
}
