// Миграция формата 2 → 3 (обновление 0.5, docs/DATA_FORMAT.md §13.5). Чистая и детерминированная функция.
//
// Что меняется:
//   • вложения теперь живут в заметках (note.attachments); если у задачи были вложения на уровне задачи
//     (поле task.attachments из v1/v2 — интерфейса для них не было), они переносятся в новую заметку без текста
//     с id uuidFromString(taskId + ':attachments'); надгробия вложений остаются на месте;
//   • новая коллекция doneArchive (сводки удалённых выполненных задач) — пустая;
//   • новые поля настроек (лимит выполненных, длина голоса, размер вложения, варианты повтора) — с меткой 1.
// Неизвестные поля проходят насквозь. Ничего не теряется.

import { uuidFromString } from '../../core/ids.js';
import { SETTINGS_V3_DEFAULTS } from '../../core/model.js';
import { keyBetween } from '../../core/order.js';

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const maxStamp = (ft) => Math.max(1, ...Object.values(ft || {}).filter(Number.isInteger));

function migrateTask(t) {
  if (t.deletedAt) return t;
  const live = (t.attachments || []).filter((a) => !a.deletedAt);
  if (!live.length) return t;
  const notes = t.notes || [];
  const last = notes.filter((n) => !n.deletedAt).map((n) => n.order).filter(Boolean).sort().at(-1) ?? null;
  let order;
  try {
    order = keyBetween(last, null);
  } catch {
    order = 'zz';
  }
  const stamp = Math.max(...live.map((a) => maxStamp(a.fieldTimes)));
  const note = {
    id: uuidFromString(`${t.id}:attachments`),
    createdAt: t.createdAt, updatedAt: t.updatedAt, updatedBy: t.updatedBy, deletedAt: null,
    fieldTimes: { text: stamp, order: stamp, deletedAt: stamp },
    text: '', order,
    attachments: [...live].sort(byId),
  };
  return { ...t, notes: [...notes, note].sort(byId), attachments: (t.attachments || []).filter((a) => a.deletedAt) };
}

export default {
  from: 2,
  to: 3,
  allowedLosses: [],

  migrate(db) {
    const data = db.data || {};
    const settings = (data.settings || []).map((s) => {
      if (s.deletedAt) return s;
      const out = { ...s, fieldTimes: { ...(s.fieldTimes || {}) } };
      for (const [k, v] of Object.entries(SETTINGS_V3_DEFAULTS)) {
        if (!(k in out)) {
          out[k] = structuredClone(v);
          out.fieldTimes[k] = 1;
        }
      }
      return out;
    });
    return {
      ...db,
      schemaVersion: 3,
      data: { ...data, settings, tasks: (data.tasks || []).map(migrateTask), doneArchive: data.doneArchive || [] },
    };
  },
};
