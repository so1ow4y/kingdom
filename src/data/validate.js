// Лёгкая структурная проверка прочитанной базы. Полная проверка по JSON Schema — в тестах (schemas/v1).
// Задача — не пустить в локальные данные то, что сломает приложение, и ничего не выбросить молча.

import { SyncError } from '../core/errors.js';
import { COLLECTIONS } from './envelope.js';

export function validateDb(db) {
  for (const c of COLLECTIONS) {
    const arr = db.data[c];
    if (arr === undefined) {
      db.data[c] = [];
      continue;
    }
    if (!Array.isArray(arr)) throw new SyncError('E-DB-CORRUPT', `Раздел data.${c} не массив`);
    for (const e of arr) {
      if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !e.id) {
        throw new SyncError('E-DB-CORRUPT', `В data.${c} есть запись без id`);
      }
      if (!e.fieldTimes || typeof e.fieldTimes !== 'object') e.fieldTimes = {};
    }
  }
  // Живые задачи от других клиентов могут прийти без вложенных коллекций — дополняем пустыми.
  for (const t of db.data.tasks) {
    if (t.deletedAt) continue;
    for (const k of ['notes', 'attachments', 'reminders']) if (!Array.isArray(t[k])) t[k] = [];
    for (const k of ['occurrences', 'lists']) if (!t[k] || typeof t[k] !== 'object' || Array.isArray(t[k])) t[k] = {};
    if (t.parentId === undefined) t.parentId = null;
  }
  if (db.data.settings.length > 1) {
    throw new SyncError('E-DB-CORRUPT', 'В базе больше одной записи настроек');
  }
  return db;
}
