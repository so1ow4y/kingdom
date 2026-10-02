// Выборки для экранов. Чистые функции над данными в памяти.
// data = { tasks: Map<id, Task>, lists: Map<id, List>, settings: Settings }

import { byOrder } from './order.js';
import { daysBetween, localDateOf } from './dates.js';
import { SOON_DEADLINE_DAYS, LIMITS } from '../config.js';

export const isAlive = (t) => !!t && !t.deletedAt;
export const isInTrash = (t) => isAlive(t) && !!t.trashedAt;
export const isActive = (t) => isAlive(t) && !t.trashedAt && t.status === 'active';
export const isDone = (t) => isAlive(t) && !t.trashedAt && t.status === 'done';

export function liveList(data, id) {
  if (!id) return null;
  const l = data.lists.get(id);
  return l && !l.deletedAt ? l : null;
}

/** Задача из архивного списка не показывается в «Сегодня». */
export function inArchivedList(data, t) {
  const l = liveList(data, t.listId);
  return !!l && l.archived;
}

/** Список задачи удалён или не существует → задача показывается во «Входящих» (TZ X13). */
export function hasMissingList(data, t) {
  return t.listId != null && !liveList(data, t.listId);
}

export function isChore(data, t) {
  return t.listId != null && t.listId === data.settings.choresListId;
}

export function deadlinePassed(t, today, time) {
  if (!t.deadlineDate) return false;
  if (t.deadlineDate < today) return true;
  return t.deadlineDate === today && !!t.deadlineTime && t.deadlineTime <= time;
}

/** Просрочена (TZ §7.7). Повторы появятся на этапе 4. */
export function isOverdue(t, today, time) {
  if (!isActive(t) || t.repeat) return false;
  return deadlinePassed(t, today, time) || (!!t.scheduledDate && t.scheduledDate < today);
}

const prioDesc = (a, b) => (b.priority || 0) - (a.priority || 0);

/** Порядок внутри дня: сначала со временем (по времени), потом без времени (приоритет ↓, order). */
export function dayCompare(a, b) {
  const ta = a.scheduledTime || (a.scheduledDate ? null : a.deadlineTime);
  const tb = b.scheduledTime || (b.scheduledDate ? null : b.deadlineTime);
  if (ta && tb && ta !== tb) return ta < tb ? -1 : 1;
  if (ta && !tb) return -1;
  if (!ta && tb) return 1;
  return prioDesc(a, b) || byOrder(a, b);
}

function overdueKey(t) {
  const a = t.scheduledDate;
  const b = t.deadlineDate;
  if (a && b) return a < b ? a : b;
  return a || b || '';
}

function overdueCompare(a, b) {
  const ka = overdueKey(a);
  const kb = overdueKey(b);
  if (ka !== kb) return ka < kb ? -1 : 1;
  return prioDesc(a, b) || byOrder(a, b);
}

const byIsoDesc = (field) => (a, b) => {
  const x = a[field] || '';
  const y = b[field] || '';
  return x === y ? byOrder(a, b) : x < y ? 1 : -1;
};

/** Экран «Сегодня» (TZ §6.2). */
export function todayView(data, today, time, nowMs = Date.now()) {
  const tz = data.settings.timeZone;
  const v = { focus: [], yesterdayFocus: [], overdue: [], today: [], soon: [], chores: [], doneToday: [] };
  const recent = nowMs - 2 * 86400000;
  for (const t of data.tasks.values()) {
    if (!isAlive(t) || t.trashedAt || inArchivedList(data, t)) continue;
    if (t.focusDate === today) {
      v.focus.push(t);
      continue;
    }
    if (t.status === 'done') {
      if (t.completedAt && Date.parse(t.completedAt) >= recent && localDateOf(t.completedAt, tz) === today) {
        v.doneToday.push(t);
      }
      continue;
    }
    if (t.focusDate && t.focusDate < today) v.yesterdayFocus.push(t);
    const overdue = isOverdue(t, today, time);
    const forToday = t.scheduledDate === today || t.deadlineDate === today;
    if (isChore(data, t)) {
      if (overdue || forToday) v.chores.push(t);
    } else if (overdue) {
      v.overdue.push(t);
    } else if (forToday) {
      v.today.push(t);
    } else if (t.deadlineDate && t.deadlineDate > today && daysBetween(today, t.deadlineDate) <= SOON_DEADLINE_DAYS) {
      v.soon.push(t);
    }
  }
  v.focus.sort((a, b) => byOrder(a, b, 'focusOrder'));
  v.yesterdayFocus.sort((a, b) => byOrder(a, b, 'focusOrder'));
  v.overdue.sort(overdueCompare);
  v.today.sort(dayCompare);
  v.soon.sort((a, b) => (a.deadlineDate === b.deadlineDate ? dayCompare(a, b) : a.deadlineDate < b.deadlineDate ? -1 : 1));
  v.chores.sort((a, b) => {
    const oa = isOverdue(a, today, time);
    const ob = isOverdue(b, today, time);
    if (oa !== ob) return oa ? -1 : 1;
    return oa ? overdueCompare(a, b) : dayCompare(a, b);
  });
  v.doneToday.sort(byIsoDesc('completedAt'));
  return v;
}

/** Сколько задач уже отмечены главными на дату (включая выполненные). */
export function focusTasks(data, date) {
  const r = [];
  for (const t of data.tasks.values()) {
    if (isAlive(t) && !t.trashedAt && t.focusDate === date) r.push(t);
  }
  return r.sort((a, b) => byOrder(a, b, 'focusOrder'));
}

export function focusIsFull(data, date) {
  return focusTasks(data, date).length >= LIMITS.focusMax;
}

/** «Входящие»: активные без списка (и с удалённым списком). */
export function inboxView(data) {
  const r = [];
  for (const t of data.tasks.values()) {
    if (isActive(t) && (t.listId == null || hasMissingList(data, t))) r.push(t);
  }
  return r.sort(byOrder);
}

/** Экран списка (TZ §6.5). */
export function listView(data, listId) {
  const v = { scheduled: [], noDate: [], repeating: [], done: [], doneCount: 0 };
  for (const t of data.tasks.values()) {
    if (!isAlive(t) || t.trashedAt || t.listId !== listId) continue;
    if (t.status === 'done') {
      v.done.push(t);
    } else if (t.repeat) {
      v.repeating.push(t);
    } else if (t.scheduledDate || t.deadlineDate) {
      v.scheduled.push(t);
    } else {
      v.noDate.push(t);
    }
  }
  v.scheduled.sort((a, b) => {
    const ka = a.scheduledDate || a.deadlineDate;
    const kb = b.scheduledDate || b.deadlineDate;
    return ka === kb ? dayCompare(a, b) : ka < kb ? -1 : 1;
  });
  v.noDate.sort(byOrder);
  v.repeating.sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  v.done.sort(byIsoDesc('completedAt'));
  v.doneCount = v.done.length;
  v.done = v.done.slice(0, 50);
  return v;
}

/** Все задачи контейнера (список или «Входящие») для расчёта ручного порядка. */
export function containerTasks(data, listId) {
  const r = [];
  for (const t of data.tasks.values()) {
    if (isActive(t) && (t.listId ?? null) === (listId ?? null)) r.push(t);
  }
  return r.sort(byOrder);
}

export function sortedLists(data, { archived = false } = {}) {
  const r = [];
  for (const l of data.lists.values()) {
    if (!l.deletedAt && !!l.archived === archived) r.push(l);
  }
  return r.sort(byOrder);
}

/** Число активных задач по спискам + 'inbox'. */
export function activeCounts(data) {
  const m = new Map();
  for (const t of data.tasks.values()) {
    if (!isActive(t)) continue;
    const key = t.listId == null || hasMissingList(data, t) ? 'inbox' : t.listId;
    m.set(key, (m.get(key) || 0) + 1);
  }
  return m;
}

/** Есть ли у списка хоть одна задача (включая выполненные и корзину) — тогда его нельзя удалить. */
export function listHasTasks(data, listId) {
  for (const t of data.tasks.values()) if (isAlive(t) && t.listId === listId) return true;
  return false;
}

export function archiveView(data, listFilter = null) {
  const r = [];
  for (const t of data.tasks.values()) {
    if (!isDone(t)) continue;
    if (listFilter === 'inbox' ? t.listId != null : listFilter && t.listId !== listFilter) continue;
    r.push(t);
  }
  return r.sort(byIsoDesc('completedAt'));
}

export function trashView(data) {
  const r = [];
  for (const t of data.tasks.values()) if (isInTrash(t)) r.push(t);
  return r.sort(byIsoDesc('trashedAt'));
}

/** Задачи в корзине старше срока хранения (кандидаты на надгробие). */
export function expiredTrash(data, nowMs) {
  const days = data.settings.trashRetentionDays || 30;
  const limit = nowMs - days * 86400000;
  return trashView(data).filter((t) => Date.parse(t.trashedAt) < limit);
}
