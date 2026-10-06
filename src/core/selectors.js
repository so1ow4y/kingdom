// Выборки для экранов. Чистые функции над данными в памяти. Формат v2 (обновление 0.3):
// задача состоит в нескольких списках (task.lists), может быть подзадачей другой задачи (task.parentId).
// data = { tasks: Map<id, Task>, lists: Map<id, List>, settings: Settings, priorities, … }

import { byOrder } from './order.js';
import { daysBetween, localDateOf } from './dates.js';
import * as RP from './repeat.js';
import { SOON_DEADLINE_DAYS, LIMITS } from '../config.js';

export const MAX_DEPTH = LIMITS.maxDepth; // уровней вложенности: задача → подзадача → … (4 уровня всего)

export const isAlive = (t) => !!t && !t.deletedAt;
export const isInTrash = (t) => isAlive(t) && !!t.trashedAt;
export const isActive = (t) => isAlive(t) && !t.trashedAt && t.status === 'active';
export const isDone = (t) => isAlive(t) && !t.trashedAt && t.status === 'done';

export function liveList(data, id) {
  if (!id) return null;
  const l = data.lists.get(id);
  return l && !l.deletedAt ? l : null;
}

/** Списки задачи, которые существуют (живые), в порядке «Списков». */
export function taskLists(data, t) {
  const out = [];
  for (const [id, v] of Object.entries(t.lists || {})) {
    const l = v && v.in ? liveList(data, id) : null;
    if (l) out.push(l);
  }
  return out.sort(byOrder);
}

export const inList = (t, listId) => !!t.lists?.[listId]?.in;

/** Все живые списки задачи — архивные: такая задача не показывается в «Сегодня». */
export function inArchivedList(data, t) {
  const ls = taskLists(data, t);
  return ls.length > 0 && ls.every((l) => l.archived);
}

/** Задача числится в списках, но ни одного из них уже нет → она во «Входящих» (TZ X13). */
export function hasMissingList(data, t) {
  return Object.values(t.lists || {}).some((v) => v && v.in) && taskLists(data, t).length === 0;
}

/** «Быт»: задача состоит в списке «Дом» (choresListId), даже если она и в других списках. */
export function isChore(data, t) {
  const id = data.settings.choresListId;
  return !!id && inList(t, id) && !!liveList(data, id);
}

// ---------- Дерево подзадач ----------

/**
 * Родитель, если он жив и не замыкает цикл. Цикл возможен только после слияния правок с двух устройств
 * (на одном A вложили в B, на другом B в A): тогда обе задачи показываются на верхнем уровне и ничего не теряется.
 */
export function parentOf(data, t) {
  const p = t.parentId ? data.tasks.get(t.parentId) : null;
  if (!p || !isAlive(p)) return null;
  let x = p;
  for (let i = 0; i < 64 && x?.parentId; i++) {
    if (x.parentId === t.id) return null;
    x = data.tasks.get(x.parentId);
  }
  return p;
}

/** Корень дерева: нет родителя, родитель удалён навсегда или задача в цикле. */
export const isRoot = (data, t) => !parentOf(data, t);

/** Индекс детей: Map<parentId, Task[]> (живые, не в корзине; сортировка по order). Строить раз на отрисовку. */
export function childrenIndex(data, { includeTrash = false } = {}) {
  const m = new Map();
  for (const t of data.tasks.values()) {
    if (!isAlive(t) || !parentOf(data, t) || (!includeTrash && t.trashedAt)) continue;
    if (!m.has(t.parentId)) m.set(t.parentId, []);
    m.get(t.parentId).push(t);
  }
  for (const list of m.values()) list.sort(byOrder);
  return m;
}

export function childrenOf(data, id, index = null) {
  return (index || childrenIndex(data)).get(id) || [];
}

/** Все потомки (в глубину), живые; includeTrash — вместе с теми, что в корзине. */
export function descendants(data, id, { includeTrash = false } = {}) {
  const idx = childrenIndex(data, { includeTrash });
  const out = [];
  const walk = (pid) => {
    for (const c of idx.get(pid) || []) {
      out.push(c);
      walk(c.id);
    }
  };
  walk(id);
  return out;
}

export function ancestors(data, t) {
  const out = [];
  const seen = new Set([t.id]);
  let p = parentOf(data, t);
  while (p && !seen.has(p.id)) {
    out.push(p);
    seen.add(p.id);
    p = parentOf(data, p);
  }
  return out;
}

/** Уровень задачи: 1 — корень. */
export const depthOf = (data, t) => ancestors(data, t).length + 1;

/** Высота поддерева: 1 — без детей. */
export function subtreeHeight(data, id, index = null) {
  const idx = index || childrenIndex(data);
  const kids = idx.get(id) || [];
  return 1 + (kids.length ? Math.max(...kids.map((k) => subtreeHeight(data, k.id, idx))) : 0);
}

/**
 * Можно ли сделать задачу childId подзадачей parentId: не сама в себя, без циклов, глубина ≤ MAX_DEPTH.
 * Возвращает null или текст причины.
 */
export function nestError(data, childId, parentId) {
  if (!parentId) return null;
  if (childId === parentId) return 'Задачу нельзя вложить саму в себя';
  const parent = data.tasks.get(parentId);
  if (!parent || !isAlive(parent)) return 'Родительская задача не найдена';
  if (ancestors(data, parent).some((a) => a.id === childId)) return 'Нельзя вложить задачу в её же подзадачу';
  if (depthOf(data, parent) + subtreeHeight(data, childId) > MAX_DEPTH) return `Вложенность не больше ${MAX_DEPTH} уровней`;
  return null;
}

/** Прогресс по прямым подзадачам: { done, total } (без корзины). */
export function progressOf(data, id, index = null) {
  const kids = childrenOf(data, id, index);
  return { done: kids.filter((k) => k.status === 'done').length, total: kids.length };
}

// ---------- Даты и «Сегодня» ----------

export function deadlinePassed(t, today, time) {
  if (!t.deadlineDate) return false;
  if (t.deadlineDate < today) return true;
  return t.deadlineDate === today && !!t.deadlineTime && t.deadlineTime <= time;
}

/** Просрочена (TZ §7.7). Повторяющаяся — если её текущий экземпляр раньше сегодняшнего дня (DATA_FORMAT §5.4). */
export function isOverdue(t, today, time) {
  if (!isActive(t)) return false;
  if (t.repeat) {
    const d = RP.dueDate(t, today);
    return !!d && d < today;
  }
  return deadlinePassed(t, today, time) || (!!t.scheduledDate && t.scheduledDate < today);
}

/** Дата, на которую задача запланирована: своя дата, а у повторяющейся — текущий экземпляр. */
export function plannedDate(t, today) {
  return t.repeat ? RP.dueDate(t, today) : t.scheduledDate || null;
}

const prioRank = (data, t) => {
  const p = data?.priorities?.get(t.priorityId);
  return p ? p.coins : 0; // чем «дороже» приоритет, тем он важнее
};

/** Порядок внутри дня: сначала со временем (по времени), потом без времени (приоритет ↓, order). */
export function dayCompare(a, b, data = null) {
  const ta = a.scheduledTime || (a.scheduledDate ? null : a.deadlineTime);
  const tb = b.scheduledTime || (b.scheduledDate ? null : b.deadlineTime);
  if (ta && tb && ta !== tb) return ta < tb ? -1 : 1;
  if (ta && !tb) return -1;
  if (!ta && tb) return 1;
  return prioRank(data, b) - prioRank(data, a) || byOrder(a, b);
}

function overdueKey(t) {
  const a = t.scheduledDate;
  const b = t.deadlineDate;
  if (a && b) return a < b ? a : b;
  return a || b || '';
}

const byIsoDesc = (field) => (a, b) => {
  const x = a[field] || '';
  const y = b[field] || '';
  return x === y ? byOrder(a, b) : x < y ? 1 : -1;
};

/** Экран «Сегодня» (TZ §6.2). Подзадачи с датой попадают сюда сами по себе (с подписью родителя в UI). */
export function todayView(data, today, time, nowMs = Date.now(), exactDay = false) {
  const tz = data.settings.timeZone;
  const v = { focus: [], yesterdayFocus: [], overdue: [], today: [], soon: [], chores: [], doneToday: [] };
  const recent = nowMs - 2 * 86400000;
  const dc = (a, b) => dayCompare(a, b, data);
  const oc = (a, b) => {
    const ka = overdueKey(a);
    const kb = overdueKey(b);
    return ka !== kb ? (ka < kb ? -1 : 1) : prioRank(data, b) - prioRank(data, a) || byOrder(a, b);
  };
  for (const t of data.tasks.values()) {
    if (!isAlive(t) || t.trashedAt || inArchivedList(data, t)) continue;
    if (t.focusDate === today) {
      v.focus.push(t);
      continue;
    }
    if (t.status === 'done') {
      if (t.completedAt && Date.parse(t.completedAt) >= recent && localDateOf(t.completedAt, tz) === today) v.doneToday.push(t);
      continue;
    }
    if (t.focusDate && t.focusDate < today) v.yesterdayFocus.push(t);
    let overdue;
    let forToday;
    if (t.repeat) {
      // повтор: экземпляр на этот день (на другом дне недели — по правилу), просрочен — если текущий раньше сегодня
      const due = exactDay ? null : RP.dueDate(t, today, tz);
      overdue = !exactDay && !!due && due < today;
      forToday = exactDay ? RP.matches(t.repeat, today) && !['done', 'skipped'].includes(t.occurrences?.[today]?.state) : due === today;
    } else {
      overdue = !exactDay && isOverdue(t, today, time);
      forToday = t.scheduledDate === today || t.deadlineDate === today;
    }
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
  v.overdue.sort(oc);
  v.today.sort(dc);
  v.soon.sort((a, b) => (a.deadlineDate === b.deadlineDate ? dc(a, b) : a.deadlineDate < b.deadlineDate ? -1 : 1));
  v.chores.sort((a, b) => {
    const oa = isOverdue(a, today, time);
    const ob = isOverdue(b, today, time);
    if (oa !== ob) return oa ? -1 : 1;
    return oa ? oc(a, b) : dc(a, b);
  });
  v.doneToday.sort(byIsoDesc('completedAt'));
  return v;
}

/**
 * Дерево экрана-подборки (обновление 0.4): blocks — { ключ блока: задачи блока в его порядке }, порядок ключей = важность.
 * Задача, чей родитель тоже на экране, показывается под родителем — если блок родителя не менее важен
 * (иначе сегодняшняя подзадача спряталась бы в свёрнутом «Скоро дедлайн» или «Выполнено»). Остальные — корни своего блока.
 * → { roots: { ключ: Task[] }, index: Map<parentId, Task[]> (по order), home: Map<id, ключ блока> }
 */
export function selectionForest(data, blocks) {
  const keys = Object.keys(blocks);
  const home = new Map();
  for (const k of keys) for (const t of blocks[k]) if (!home.has(t.id)) home.set(t.id, k);
  const rank = (id) => keys.indexOf(home.get(id));
  const index = new Map();
  const roots = {};
  for (const k of keys) {
    roots[k] = [];
    for (const t of blocks[k]) {
      if (home.get(t.id) !== k) continue;
      const p = parentOf(data, t);
      if (p && home.has(p.id) && rank(p.id) <= rank(t.id)) {
        if (!index.has(p.id)) index.set(p.id, []);
        index.get(p.id).push(t);
      } else roots[k].push(t);
    }
  }
  for (const list of index.values()) list.sort(byOrder);
  return { roots, index, home };
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

// ---------- «Входящие», списки, архив, корзина ----------

/** Задача без живых списков (корень дерева) — во «Входящих». */
export const isInboxRoot = (data, t) => isRoot(data, t) && taskLists(data, t).length === 0;

/** «Входящие»: активные корневые задачи без списков. Подзадачи показываются деревом под родителем. */
export function inboxView(data) {
  const r = [];
  for (const t of data.tasks.values()) if (isActive(t) && !t.repeat && isInboxRoot(data, t)) r.push(t);
  return r.sort(byOrder);
}

/** Вкладка «Повторяющиеся» во «Входящих» (0.9): все живые повторяющиеся задачи из любых списков — по ближайшей дате. */
export function repeatingView(data, today) {
  const r = [];
  for (const t of data.tasks.values()) if (isAlive(t) && !t.trashedAt && t.repeat) r.push({ t, d: t.status === 'done' ? '9999' : RP.dueDate(t, today, data.settings.timeZone) || '9998' });
  return r.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.t.title.localeCompare(b.t.title, 'ru'))).map((x) => x.t);
}

/** Корни дерева в списке: члены списка, чей родитель не состоит в этом же списке. */
const listRoot = (data, t, listId) => inList(t, listId) && !(parentOf(data, t) && inList(parentOf(data, t), listId));

/** Раздел экрана списка, в который попадает задача: 'done' | 'repeating' | 'scheduled' | 'noDate'. */
export function listSection(t) {
  if (t.status === 'done') return 'done';
  if (t.repeat) return 'repeating';
  return t.scheduledDate || t.deadlineDate ? 'scheduled' : 'noDate';
}

/** Экран списка (TZ §6.5): секции из корней дерева; подзадачи — под родителем. */
export function listView(data, listId) {
  const v = { scheduled: [], noDate: [], repeating: [], done: [], doneCount: 0 };
  for (const t of data.tasks.values()) {
    if (!isAlive(t) || t.trashedAt || !listRoot(data, t, listId)) continue;
    v[listSection(t)].push(t);
  }
  v.scheduled.sort((a, b) => {
    const ka = a.scheduledDate || a.deadlineDate;
    const kb = b.scheduledDate || b.deadlineDate;
    return ka === kb ? dayCompare(a, b, data) : ka < kb ? -1 : 1;
  });
  v.noDate.sort(byOrder);
  v.repeating.sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  v.done.sort(byIsoDesc('completedAt'));
  v.doneCount = v.done.length;
  v.done = v.done.slice(0, 50);
  return v;
}

/** Соседи для ручного порядка: корни списка (listId) или «Входящих» (null), либо дети родителя (parentId). */
export function containerTasks(data, listId, parentId = null) {
  const r = [];
  for (const t of data.tasks.values()) {
    if (!isActive(t)) continue;
    if (parentId) {
      if (t.parentId === parentId) r.push(t);
    } else if (listId ? listRoot(data, t, listId) : isInboxRoot(data, t)) r.push(t);
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

/** Число активных задач по спискам + 'inbox' (корни без списков). */
export function activeCounts(data) {
  const m = new Map();
  for (const t of data.tasks.values()) {
    if (!isActive(t)) continue;
    const ls = taskLists(data, t);
    if (!ls.length) {
      if (isRoot(data, t)) m.set('inbox', (m.get('inbox') || 0) + 1);
      continue;
    }
    for (const l of ls) m.set(l.id, (m.get(l.id) || 0) + 1);
  }
  return m;
}

/** Есть ли у списка хоть одна задача (включая выполненные и корзину) — тогда его нельзя удалить. */
export function listHasTasks(data, listId) {
  for (const t of data.tasks.values()) if (isAlive(t) && inList(t, listId)) return true;
  return false;
}

export function archiveView(data, listFilter = null) {
  const r = [];
  for (const t of data.tasks.values()) {
    if (!isDone(t)) continue;
    if (listFilter === 'inbox' ? taskLists(data, t).length > 0 : listFilter && !inList(t, listFilter)) continue;
    r.push(t);
  }
  return r.sort(byIsoDesc('completedAt'));
}

/** Корзина: задачи в корзине, кроме подзадач, ушедших туда вместе с родителем (они восстановятся с ним). */
export function trashView(data) {
  const r = [];
  for (const t of data.tasks.values()) {
    if (!isInTrash(t)) continue;
    const p = parentOf(data, t);
    if (p && p.trashedAt && p.trashedAt === t.trashedAt) continue;
    r.push(t);
  }
  return r.sort(byIsoDesc('trashedAt'));
}

/** Задачи в корзине старше срока хранения (кандидаты на надгробие), вместе с их потомками. */
export function expiredTrash(data, nowMs) {
  const days = data.settings.trashRetentionDays || 30;
  const limit = nowMs - days * 86400000;
  const out = [];
  for (const t of data.tasks.values()) if (isInTrash(t) && Date.parse(t.trashedAt) < limit) out.push(t);
  return out.sort(byIsoDesc('trashedAt'));
}

// ---------- Приоритеты ----------

export function sortedPriorities(data, { archived = false } = {}) {
  const r = [];
  for (const p of data.priorities.values()) if (!p.deletedAt && !!p.archived === archived) r.push(p);
  return r.sort(byOrder);
}

export function priorityOf(data, t) {
  const p = data.priorities.get(t.priorityId);
  return p && !p.deletedAt ? p : null;
}

export function priorityInUse(data, priorityId) {
  for (const t of data.tasks.values()) if (isAlive(t) && t.priorityId === priorityId) return true;
  return false;
}
