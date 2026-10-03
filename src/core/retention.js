// Лимит хранения выполненных задач (обновление 0.5; DATA_FORMAT §13.4). Чистые функции.
//
// Самые старые выполненные задачи (сверх settings.completedLimit) удаляются навсегда, но статистика не теряется:
// вместо каждой удалённой выполненной задачи в коллекции doneArchive остаётся сводка
//   { id: <id задачи>, completedAt, listIds, priorityId, coins }.
// id сводки = id задачи, поля и метки берутся из самой задачи, поэтому два устройства, удалившие одну и ту же
// задачу независимо, создают одну и ту же сводку — слияние по id не задваивает. Если задача «воскресла»
// (правка на другом устройстве после удаления), живая задача считается, а её сводка — нет.

import { tombstone, taskListIds } from './model.js';
import { childrenIndex, parentOf } from './selectors.js';
import { PRIORITY_NONE_ID } from './priorities.js';
import { localDateOf } from './dates.js';
import { RETENTION } from '../config.js';

const DAY = 86400000;
const isDoneTask = (t) => t && !t.deletedAt && !t.trashedAt && !t.repeat && t.status === 'done';

/** Сколько выполненных задач хранится (живые, не в корзине, не повторы). */
export function doneCount(data) {
  let n = 0;
  for (const t of data.tasks.values()) if (isDoneTask(t)) n++;
  return n;
}

/**
 * Что удалить, чтобы выполненных стало не больше limit. Единица — дерево: корень и все подзадачи, если всё дерево
 * выполнено и не в корзине; самая поздняя отметка в дереве старше keepRecentDays. Старые деревья — первыми.
 * → { trees: [{ rootId, ids, latest }], count, total, over }
 */
export function purgePlan(data, limit, nowMs, keepRecentDays = RETENTION.keepRecentDays) {
  const total = doneCount(data);
  const over = limit == null ? 0 : Math.max(0, total - limit);
  if (!over) return { trees: [], count: 0, total, over };
  const border = nowMs - keepRecentDays * DAY;
  const idx = childrenIndex(data, { includeTrash: true });
  const subtree = (id) => (idx.get(id) || []).flatMap((k) => [k, ...subtree(k.id)]);
  const candidates = [];
  for (const t of data.tasks.values()) {
    if (!isDoneTask(t) || parentOf(data, t)) continue;
    const kids = subtree(t.id);
    if (!kids.every(isDoneTask)) continue;
    const tree = [t, ...kids];
    const latest = Math.max(...tree.map((x) => Date.parse(x.completedAt || x.updatedAt) || 0));
    if (latest > border) continue;
    candidates.push({ rootId: t.id, ids: tree.map((x) => x.id), latest });
  }
  candidates.sort((a, b) => a.latest - b.latest || (a.rootId < b.rootId ? -1 : 1));
  const trees = [];
  let count = 0;
  for (const c of candidates) {
    if (count >= over) break;
    trees.push(c);
    count += c.ids.length;
  }
  return { trees, count, total, over };
}

/** Сводка удалённой выполненной задачи. Метки — из меток самой задачи: одинаковые на всех устройствах. */
export function archiveRecord(data, t) {
  const ft = t.fieldTimes || {};
  const listT = Math.max(1, ...Object.values(t.lists || {}).map((v) => v?.t || 0));
  const award = data.coinEvents?.get(`a:${t.id}`); // начисление за задачу (core/game.js: awardId)
  const prio = data.priorities?.get(t.priorityId) || data.priorities?.get(PRIORITY_NONE_ID);
  const coins = award && !award.deletedAt && award.active ? award.amount | 0 : Math.max(0, prio?.coins | 0);
  return {
    id: t.id,
    createdAt: t.completedAt || t.updatedAt,
    updatedAt: t.updatedAt,
    updatedBy: t.updatedBy,
    deletedAt: null,
    fieldTimes: {
      completedAt: ft.completedAt ?? 1,
      listIds: listT,
      priorityId: ft.priorityId ?? 1,
      coins: ft.priorityId ?? 1,
    },
    completedAt: t.completedAt || t.updatedAt,
    listIds: taskListIds(t).sort(),
    priorityId: t.priorityId ?? null,
    coins,
  };
}

/** Применить план: надгробия задач + сводки. → [{ coll, prev, next }] */
export function applyPurge(data, plan, ctx) {
  const out = [];
  for (const tree of plan.trees) {
    for (const id of tree.ids) {
      const t = data.tasks.get(id);
      if (!t || t.deletedAt) continue;
      if (!data.doneArchive?.get(id)) out.push({ coll: 'doneArchive', prev: undefined, next: archiveRecord(data, t) });
      out.push({ coll: 'tasks', prev: t, next: tombstone(t, ctx) });
    }
  }
  return out;
}

/**
 * Все выполнения для статистики: живые выполненные задачи, выполненные экземпляры повторов и сводки удалённых
 * (кроме тех, чья задача снова жива). → [{ id, date, listIds, priorityId }]
 */
export function doneEntries(data, tz) {
  const out = [];
  for (const t of data.tasks.values()) {
    if (t.deletedAt || t.trashedAt) continue;
    if (!t.repeat && t.status === 'done' && t.completedAt) {
      out.push({ id: t.id, date: localDateOf(t.completedAt, tz), listIds: taskListIds(t), priorityId: t.priorityId });
    }
    for (const [k, o] of Object.entries(t.occurrences || {})) {
      if (o && o.state === 'done' && o.doneAt) out.push({ id: `${t.id}:${k}`, date: localDateOf(o.doneAt, tz), listIds: taskListIds(t), priorityId: t.priorityId });
    }
  }
  for (const a of data.doneArchive?.values() || []) {
    if (a.deletedAt || !a.completedAt) continue;
    const live = data.tasks.get(a.id);
    if (live && !live.deletedAt) continue; // задача снова жива — считается она сама
    out.push({ id: a.id, date: localDateOf(a.completedAt, tz), listIds: a.listIds || [], priorityId: a.priorityId });
  }
  return out;
}
