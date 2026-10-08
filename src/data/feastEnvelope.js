// Конверт базы Crimson Harvest (счётчик калорий; 0.11 — «Feast», DATA_FORMAT §19–20): тот же вид, что у базы задач,
// но свой format и своя версия схемы. Неизвестные поля конверта и коллекции сохраняются при записи.
// Схема 2 (0.12): рационы (meals), заметки к рационам (mealNotes), записи из нескольких продуктов (entries[].items).
// Файл схемы 1 читается как есть; клиенты 0.11 видят схему 2 и переходят в «только чтение».

import { APP_VERSION } from '../version.js';
import { writer } from './envelope.js';
import { SyncError } from '../core/errors.js';
import { FEAST_COLLECTIONS } from '../core/feast.js';
import { gunzipJson } from './serialize.js';
import { tr } from '../core/i18n.js';

export const FEAST_FORMAT = 'crimson-feast-db';
export const FEAST_MANIFEST_FORMAT = 'crimson-feast-manifest';
export const FEAST_SCHEMA_VERSION = 2;
const ENVELOPE_KEYS = new Set(['format', 'schemaVersion', 'createdAt', 'updatedAt', 'writer', 'data']);
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function buildFeastDb(data, { createdAt, deviceId, extraEnvelope = {}, extraCollections = {}, now = new Date() }) {
  const out = {};
  for (const c of FEAST_COLLECTIONS) out[c] = [...(data[c] || [])].sort(byId);
  return {
    ...extraEnvelope,
    format: FEAST_FORMAT,
    schemaVersion: FEAST_SCHEMA_VERSION,
    createdAt: createdAt || now.toISOString(),
    updatedAt: now.toISOString(),
    writer: writer(deviceId),
    data: { ...extraCollections, ...out },
  };
}

export function feastExtrasOf(db) {
  const extraEnvelope = {};
  for (const [k, v] of Object.entries(db)) if (!ENVELOPE_KEYS.has(k)) extraEnvelope[k] = v;
  const extraCollections = {};
  for (const [k, v] of Object.entries(db.data || {})) if (!FEAST_COLLECTIONS.includes(k)) extraCollections[k] = v;
  return { extraEnvelope, extraCollections };
}

/** Проверить конверт и структуру. E-DB-CORRUPT — не база Feast; E-READONLY — записана более новой версией. */
export function checkFeastDb(obj) {
  if (!obj || typeof obj !== 'object' || obj.format !== FEAST_FORMAT) {
    throw new SyncError('E-DB-CORRUPT', tr('Это не файл базы Crimson Harvest (неверный format)'));
  }
  if (!Number.isInteger(obj.schemaVersion) || obj.schemaVersion < 1) throw new SyncError('E-DB-CORRUPT', tr('В базе Crimson Harvest нет корректного schemaVersion'));
  if (obj.schemaVersion > FEAST_SCHEMA_VERSION) {
    throw Object.assign(new SyncError('E-READONLY', tr('База Crimson Harvest записана более новой версией приложения')), { remoteVersion: obj.schemaVersion });
  }
  if (!obj.data || typeof obj.data !== 'object') throw new SyncError('E-DB-CORRUPT', tr('В базе Crimson Harvest нет раздела data'));
  for (const c of FEAST_COLLECTIONS) {
    const arr = obj.data[c];
    if (arr === undefined) {
      obj.data[c] = [];
      continue;
    }
    if (!Array.isArray(arr)) throw new SyncError('E-DB-CORRUPT', tr('Раздел data.{c} базы Crimson Harvest не массив', { c }));
    for (const e of arr) {
      if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !e.id) throw new SyncError('E-DB-CORRUPT', tr('В data.{c} базы Crimson Harvest есть запись без id', { c }));
      if (!e.fieldTimes || typeof e.fieldTimes !== 'object') e.fieldTimes = {};
    }
  }
  for (const f of obj.data.foods) {
    if (f.deletedAt) continue;
    if (!f.barcodes || typeof f.barcodes !== 'object' || Array.isArray(f.barcodes)) f.barcodes = {};
    if (!f.nutrients || typeof f.nutrients !== 'object') f.nutrients = {};
  }
  for (const e of obj.data.entries) {
    if (e.deletedAt) continue;
    if (e.items === undefined || e.items === null) {
      if (!e.nutrients || typeof e.nutrients !== 'object') e.nutrients = {};
      continue;
    }
    if (!Array.isArray(e.items)) throw new SyncError('E-DB-CORRUPT', tr('В записи дневника items не массив'));
    for (const it of e.items) {
      if (!it || typeof it !== 'object' || typeof it.id !== 'string' || !it.id) throw new SyncError('E-DB-CORRUPT', tr('В записи дневника продукт без id'));
      if (!it.fieldTimes || typeof it.fieldTimes !== 'object') it.fieldTimes = {};
      if (!it.deletedAt && (!it.nutrients || typeof it.nutrients !== 'object')) it.nutrients = {};
    }
  }
  if (obj.data.settings.length > 1) throw new SyncError('E-DB-CORRUPT', tr('В базе Crimson Harvest больше одной записи настроек'));
  return obj;
}

export async function parseFeastBytes(bytes) {
  return checkFeastDb(await gunzipJson(bytes));
}

export function buildFeastManifest({ layout, createdAt, deviceId, lastPush = null, now = new Date() }) {
  return JSON.stringify({
    format: FEAST_MANIFEST_FORMAT,
    schemaVersion: FEAST_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    createdAt: createdAt || now.toISOString(),
    updatedAt: now.toISOString(),
    writer: writer(deviceId),
    files: {
      db: { id: layout.dbId, name: 'db.json.gz' },
      backupsFolder: { id: layout.backupsFolderId, name: 'backups' },
    },
    lastPush,
  }, null, 2);
}
