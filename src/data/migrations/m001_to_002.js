// Миграция формата 1 → 2 (обновление 0.3, docs/DATA_FORMAT.md §12.4). Чистая и детерминированная функция:
// два устройства, мигрировавшие одну и ту же базу v1, получают побайтно одинаковый результат — поэтому
// новые id берутся из uuidFromString, а метки — из меток исходных полей.
//
// Что меняется у задачи:
//   note (строка)        → notes: [заметка]               (пустая заметка не создаётся)
//   listId               → lists: { listId: { in, t, by } } (членство сливается по ключу)
//   priority (0…3)       → priorityId базового приоритета
//   subtasks (чек-лист)  → отдельные задачи с parentId = id родителя (id подзадачи сохраняется)
// Добавляются коллекции priorities (базовые), rewards (пусто), coinEvents (начисления за уже выполненное)
// и поля настроек v2 с меткой 1. Неизвестные поля проходят насквозь.

import { uuidFromString } from '../../core/ids.js';
import { DEFAULT_PRIORITIES, PRIORITY_NONE_ID, priorityIdFromLegacy } from '../../core/priorities.js';
import { defaultPriorities, SETTINGS_V2_DEFAULTS, TASK_FIELDS } from '../../core/model.js';
import { COIN_EVENT_FIELDS, awardId } from '../../core/game.js';

const stampMax = (ft) => Math.max(1, ...Object.values(ft || {}).filter(Number.isInteger));
const coinsOf = (priorityId) => (DEFAULT_PRIORITIES.find((p) => p.id === priorityId) || DEFAULT_PRIORITIES[0]).coins;

function migrateTask(t) {
  if (t.deletedAt) return [t];
  const { note, listId, priority, subtasks, ...rest } = t;
  const ft = { ...(t.fieldTimes || {}) };
  const out = { ...rest };

  out.priorityId = priorityIdFromLegacy(Number.isInteger(priority) ? priority : 0);
  ft.priorityId = ft.priority ?? 1;
  delete ft.priority;

  out.parentId = null;
  ft.parentId = 1;

  const noteT = ft.note ?? 1;
  out.notes = typeof note === 'string' && note.trim()
    ? [{
      id: uuidFromString(`${t.id}:note`), createdAt: t.createdAt, updatedAt: t.updatedAt, updatedBy: t.updatedBy,
      deletedAt: null, fieldTimes: { text: noteT, order: noteT, deletedAt: noteT }, text: note, order: 'a0',
    }]
    : [];
  delete ft.note;

  out.lists = listId ? { [listId]: { in: true, t: ft.listId ?? 1, by: t.updatedBy } } : {};
  delete ft.listId;

  out.fieldTimes = ft;
  const children = (subtasks || []).map((s) => childFrom(s, t));
  return [out, ...children];
}

function childFrom(s, parent) {
  const f = s.fieldTimes || {};
  if (s.deletedAt) {
    return { id: s.id, createdAt: s.createdAt, updatedAt: parent.updatedAt, updatedBy: parent.updatedBy, deletedAt: s.deletedAt, fieldTimes: { deletedAt: f.deletedAt ?? 1 } };
  }
  const { id, createdAt, deletedAt, fieldTimes, title, done, order, ...unknown } = s;
  const base = f.title ?? stampMax(f);
  const ft = {};
  for (const k of TASK_FIELDS) ft[k] = base;
  ft.status = f.done ?? base;
  ft.completedAt = f.done ?? base;
  ft.order = f.order ?? base;
  ft.deletedAt = f.deletedAt ?? base;
  return {
    ...unknown,
    id,
    createdAt,
    updatedAt: parent.updatedAt,
    updatedBy: parent.updatedBy,
    deletedAt: null,
    fieldTimes: ft,
    title,
    priorityId: PRIORITY_NONE_ID,
    parentId: parent.id,
    status: done ? 'done' : 'active',
    completedAt: done ? parent.updatedAt : null,
    trashedAt: parent.trashedAt ?? null,
    scheduledDate: null,
    scheduledTime: null,
    deadlineDate: null,
    deadlineTime: null,
    focusDate: null,
    focusOrder: null,
    order: order ?? 'a0',
    repeat: null,
    nag: { enabled: false, intervalMinutes: 15 },
    createdVia: parent.createdVia ?? 'app',
    notes: [],
    attachments: [],
    reminders: [],
    occurrences: {},
    lists: {},
  };
}

function award(task, occKey, at) {
  const t = stampMax(task.fieldTimes);
  const fieldTimes = {};
  for (const k of COIN_EVENT_FIELDS) fieldTimes[k] = t;
  return {
    id: awardId(task.id, occKey), createdAt: at, updatedAt: at, updatedBy: task.updatedBy, deletedAt: null, fieldTimes,
    type: 'award', amount: coinsOf(task.priorityId), active: true, taskId: task.id, occKey,
    rewardId: null, itemId: null, title: task.title, at,
  };
}

/** Начисления за то, что уже было выполнено до обновления (чтобы уровень и серии учитывали историю). */
function retroAwards(tasks) {
  const out = [];
  for (const t of tasks) {
    if (t.deletedAt || t.trashedAt) continue;
    if (!t.repeat && t.status === 'done') out.push(award(t, null, t.completedAt || t.updatedAt));
    for (const [k, o] of Object.entries(t.occurrences || {})) {
      if (o && o.state === 'done') out.push(award(t, k, o.doneAt || t.updatedAt));
    }
  }
  return out;
}

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export default {
  from: 1,
  to: 2,
  // Что не переносится как есть (проверяется тестом инвентаря): число приоритета заменено ссылкой на приоритет.
  allowedLosses: [{ path: /^data\.tasks\[\]\.priority$/, why: 'priority (0…3) → priorityId базового приоритета' }],

  migrate(db) {
    const data = db.data || {};
    const tasks = (data.tasks || []).flatMap(migrateTask).sort(byId);

    const settings = (data.settings || []).map((s) => {
      if (s.deletedAt) return s;
      const out = { ...s, fieldTimes: { ...(s.fieldTimes || {}) } };
      for (const [k, v] of Object.entries(SETTINGS_V2_DEFAULTS)) {
        if (!(k in out)) {
          out[k] = structuredClone(v);
          out.fieldTimes[k] = 1;
        }
      }
      return out;
    });

    const priorities = data.priorities && data.priorities.length ? data.priorities : defaultPriorities();
    const known = new Set((data.coinEvents || []).map((e) => e.id));
    const coinEvents = [...(data.coinEvents || []), ...retroAwards(tasks).filter((e) => !known.has(e.id))].sort(byId);

    return {
      ...db,
      schemaVersion: 2,
      data: { ...data, settings, tasks, priorities: [...priorities].sort(byId), rewards: data.rewards || [], coinEvents },
    };
  },
};
