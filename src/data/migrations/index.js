// Цепочка миграций формата данных (docs/DATA_FORMAT.md §8).
// Каждый шаг — модуль mNNN_to_MMM.js с { from, to, migrate(db) → db, allowedLosses: [] }.
// migrate — чистая функция: без сети, часов и хранилища; данные не теряются (устаревшее → entity.legacy).

import { SCHEMA_VERSION } from '../../version.js';
import { SyncError } from '../../core/errors.js';
import m001to002 from './m001_to_002.js';
import m002to003 from './m002_to_003.js';

export const MIGRATIONS = [m001to002, m002to003];

/** Довести базу до SCHEMA_VERSION. Версия новее приложения — E-READONLY. */
export function migrateDb(db, migrations = MIGRATIONS, target = SCHEMA_VERSION) {
  if (db.schemaVersion > target) {
    throw new SyncError('E-READONLY', `Формат v${db.schemaVersion} новее приложения (v${target})`, { remoteVersion: db.schemaVersion });
  }
  let cur = db;
  while (cur.schemaVersion < target) {
    const step = migrations.find((m) => m.from === cur.schemaVersion);
    if (!step) {
      throw new SyncError('E-MIGRATION', `Нет миграции v${cur.schemaVersion} → v${cur.schemaVersion + 1}`);
    }
    try {
      cur = { ...step.migrate(cur), schemaVersion: step.to };
    } catch (e) {
      throw new SyncError('E-MIGRATION', `Ошибка миграции v${step.from} → v${step.to}: ${e.message}`, { cause: e });
    }
  }
  return cur;
}
