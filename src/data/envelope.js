// Конверт файлов данных (docs/DATA_FORMAT.md §3) и сборка/разбор базы.

import { SCHEMA_VERSION, APP_VERSION } from '../version.js';
import { APP_NAME } from '../config.js';
import { SyncError } from '../core/errors.js';
import { tr } from '../core/i18n.js';

export const DB_FORMAT = 'lifetasks-db';
export const MANIFEST_FORMAT = 'lifetasks-manifest';
export const COLLECTIONS = ['settings', 'lists', 'tasks', 'media', 'devices', 'priorities', 'coinEvents', 'rewards', 'doneArchive', 'templates'];
const ENVELOPE_KEYS = new Set(['format', 'schemaVersion', 'createdAt', 'updatedAt', 'writer', 'data']);

export function writer(deviceId) {
  return { app: APP_NAME, appVersion: APP_VERSION, deviceId };
}

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Собрать объект базы для записи.
 * data — { settings: [...], lists: [...], … }; extra — неизвестные поля конверта и коллекции из прошлой версии.
 */
export function buildDb(data, { createdAt, deviceId, extraEnvelope = {}, extraCollections = {}, now = new Date() }) {
  const out = {};
  for (const c of COLLECTIONS) out[c] = [...(data[c] || [])].sort(byId);
  return {
    ...extraEnvelope,
    format: DB_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    createdAt: createdAt || now.toISOString(),
    updatedAt: now.toISOString(),
    writer: writer(deviceId),
    data: { ...extraCollections, ...out },
  };
}

/** Проверить конверт прочитанной базы. Бросает E-DB-CORRUPT. */
export function checkDb(obj) {
  if (!obj || typeof obj !== 'object' || obj.format !== DB_FORMAT) {
    throw new SyncError('E-DB-CORRUPT', tr('Это не файл базы задач Chronicle (неверный format)'));
  }
  if (!Number.isInteger(obj.schemaVersion) || obj.schemaVersion < 1) {
    throw new SyncError('E-DB-CORRUPT', tr('В базе нет корректного schemaVersion'));
  }
  if (!obj.data || typeof obj.data !== 'object') throw new SyncError('E-DB-CORRUPT', tr('В базе нет раздела data'));
  return obj;
}

/** Неизвестные поля конверта и коллекции — их надо сохранить при записи (DATA_FORMAT §1). */
export function extrasOf(db) {
  const extraEnvelope = {};
  for (const [k, v] of Object.entries(db)) if (!ENVELOPE_KEYS.has(k)) extraEnvelope[k] = v;
  const extraCollections = {};
  for (const [k, v] of Object.entries(db.data || {})) if (!COLLECTIONS.includes(k)) extraCollections[k] = v;
  return { extraEnvelope, extraCollections };
}

export function buildManifest({ layout, createdAt, deviceId, lastPush = null, now = new Date() }) {
  return JSON.stringify({
    format: MANIFEST_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    createdAt: createdAt || now.toISOString(),
    updatedAt: now.toISOString(),
    writer: writer(deviceId),
    files: {
      db: { id: layout.dbId, name: 'db.json.gz' },
      mediaFolder: { id: layout.mediaFolderId, name: 'media' },
      backupsFolder: { id: layout.backupsFolderId, name: 'backups' },
      readable: null,
    },
    lastPush,
  }, null, 2);
}
