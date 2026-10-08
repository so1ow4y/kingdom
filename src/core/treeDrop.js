// Перетаскивание задач в дереве (обновление 0.4): куда упадёт задача и что при этом поменяется.
// Чистые функции без DOM — их вызывает контроллер ui/components/TaskTree.js и проверяют тесты.
//
// Модель экрана — плоский список видимых строк в порядке документа (все деревья экрана подряд):
//   rows: [{ id, depth, zone, collapsed?: boolean }]
// depth — отступ строки на экране (0 — корень своего блока), zone — ключ блока (дерева) экрана.
// Перетаскиваемая задача едет вместе с видимыми подзадачами («блок» — она и строки глубже неё сразу после неё).
//
// Цели:
//   { type: 'nest', index }                       — на середину строки: стать её последней подзадачей;
//   { type: 'gap', zone, prev, next, depth }      — между строками prev и next (индексы rows, −1 — край блока)
//                                                   на уровне depth: 0 — корень блока, d — подзадача строки выше уровня d−1.

import { keyBetween } from './order.js';
import { touch, setListMembership, taskListIds } from './model.js';
import { nestError, parentOf, ancestors, descendants, focusTasks, inList } from './selectors.js';
import { LIMITS } from '../config.js';
import { tr } from './i18n.js';

export const INDENT_STEP = 28; // px сдвига вбок на один уровень

/** Индексы блока перетаскиваемой задачи: [start, end). */
export function blockRange(rows, dragId) {
  const start = rows.findIndex((r) => r.id === dragId);
  if (start < 0) return [-1, -1];
  let end = start + 1;
  while (end < rows.length && rows[end].zone === rows[start].zone && rows[end].depth > rows[start].depth) end++;
  return [start, end];
}

const inBlock = (i, [s, e]) => i >= s && i < e;

function prevInZone(rows, i, zone, block) {
  for (let j = i - 1; j >= 0; j--) if (rows[j].zone === zone && !inBlock(j, block)) return j;
  return -1;
}

function nextInZone(rows, i, zone, block) {
  for (let j = i + 1; j < rows.length; j++) if (rows[j].zone === zone && !inBlock(j, block)) return j;
  return -1;
}

/** Сколько уровней даёт сдвиг вбок dx: ±1 начиная с ~20 px, ±2 с ~48 px. */
export function shiftLevels(dx, step = INDENT_STEP) {
  const n = Math.floor((Math.abs(dx) + step * 0.3) / step);
  return dx < 0 ? -n : n;
}

/** Допустимые уровни в промежутке: не глубже «строка выше + 1», не мельче строки ниже (её родителя не меняем). */
export function gapDepthRange(rows, prev, next) {
  return { min: next >= 0 ? rows[next].depth : 0, max: prev >= 0 ? rows[prev].depth + 1 : 0 };
}

/** Исходное место перетаскиваемой задачи (промежуток, из которого её взяли). */
export function originalGap(rows, dragId) {
  const block = blockRange(rows, dragId);
  const [s] = block;
  if (s < 0) return null;
  const zone = rows[s].zone;
  return { type: 'gap', zone, prev: prevInZone(rows, s, zone, block), next: nextInZone(rows, s, zone, block), depth: rows[s].depth };
}

/**
 * Указатель → цель. hit: { index, part: 'top' | 'middle' | 'bottom' } — строка под указателем и её часть;
 * dx — сдвиг указателя вбок от начала перетаскивания.
 * Уровень в промежутке: по умолчанию — как у строки ниже линии (в конце блока — верхний), на исходном месте — свой;
 * сдвиг вбок прибавляет или убавляет уровни в допустимых пределах.
 */
export function pointerTarget(rows, dragId, hit, dx = 0, step = INDENT_STEP) {
  const block = blockRange(rows, dragId);
  if (block[0] < 0 || !hit || hit.index < 0 || hit.index >= rows.length || inBlock(hit.index, block)) {
    return block[0] < 0 ? null : withShift(rows, originalGap(rows, dragId), rows[block[0]].depth, dx, step);
  }
  const i = hit.index;
  const zone = rows[i].zone;
  if (hit.part === 'middle') return { type: 'nest', index: i };
  const gap = hit.part === 'top'
    ? { type: 'gap', zone, prev: prevInZone(rows, i, zone, block), next: i }
    : { type: 'gap', zone, prev: i, next: nextInZone(rows, i, zone, block) };
  const orig = originalGap(rows, dragId);
  const isOrig = orig.zone === gap.zone && orig.prev === gap.prev && orig.next === gap.next;
  const base = isOrig ? rows[block[0]].depth : gap.next >= 0 ? rows[gap.next].depth : 0;
  return withShift(rows, gap, base, dx, step);
}

function withShift(rows, gap, base, dx, step) {
  const { min, max } = gapDepthRange(rows, gap.prev, gap.next);
  return { ...gap, depth: Math.max(min, Math.min(max, base + shiftLevels(dx, step))) };
}

/**
 * Клавиатура: 'up' / 'down' (Alt+↑/↓) — на место соседа того же уровня; 'indent' (Tab) — в предыдущего соседа;
 * 'outdent' (Shift+Tab) — сразу после родителя. → цель или null, если двигать некуда.
 */
export function keyboardTarget(rows, id, key) {
  const block = blockRange(rows, id);
  const [s, e] = block;
  if (s < 0) return null;
  const { zone, depth } = rows[s];
  const sameZone = (j) => j >= 0 && j < rows.length && rows[j].zone === zone;
  // Предыдущий сосед того же уровня
  let ps = -1;
  for (let j = s - 1; sameZone(j); j--) {
    if (rows[j].depth < depth) break;
    if (rows[j].depth === depth) { ps = j; break; }
  }
  if (key === 'up') {
    if (ps < 0) return null;
    return { type: 'gap', zone, prev: prevInZone(rows, ps, zone, block), next: ps, depth };
  }
  if (key === 'indent') return ps < 0 ? null : { type: 'nest', index: ps };
  if (key === 'down') {
    if (!sameZone(e) || rows[e].depth !== depth) return null;
    let e2 = e + 1;
    while (sameZone(e2) && rows[e2].depth > depth) e2++;
    return { type: 'gap', zone, prev: e2 - 1, next: sameZone(e2) ? e2 : -1, depth };
  }
  if (key === 'outdent') {
    if (depth === 0) return null;
    let p = s - 1;
    while (rows[p].depth >= depth) p--;
    let pe = e;
    while (sameZone(pe) && rows[pe].depth > rows[p].depth) pe++;
    return { type: 'gap', zone, prev: pe - 1 >= e ? pe - 1 : s - 1, next: sameZone(pe) ? pe : -1, depth: rows[p].depth };
  }
  return null;
}

/**
 * Что значит цель для данных. zones: { [zone]: Zone }, где Zone —
 *   {
 *     manual: boolean,               // порядок корней ручной (иначе автоматический — по времени, дате, алфавиту)
 *     orderField?: 'order' | 'focusOrder',
 *     rootParentId?: string | null,  // корни блока — подзадачи этой задачи (подзадачи в карточке)
 *     listId?: string | null,        // блок списка (корень здесь = член списка); 'inbox' — «Входящие»
 *     accepts?: (task) => boolean,   // может ли задача быть корнем этого блока (раздел по дате, блок «Сегодня»)
 *     rejectReason?: string,       // почему задача не может быть корнем блока
 *     autoReason?: string,         // почему здесь нельзя переставлять (порядок автоматический)
 *     crossList?: boolean,         // принимать задачи из других списков в любой раздел (экран «Списки»)
 *   }
 * → { ok, noop?, reason?, label, move? }, где move — для applyDrop.
 */
export function resolveDrop(data, rows, zones, dragId, target, { readOnly = false } = {}) {
  const task = data.tasks.get(dragId);
  const block = blockRange(rows, dragId);
  if (!task || block[0] < 0 || !target) return { ok: false, reason: tr('Нельзя переместить'), label: tr('Нельзя переместить') };
  if (readOnly) return bad(tr('Только чтение'));
  const src = rows[block[0]];
  const srcZone = zones[src.zone] || {};

  if (target.type === 'nest') {
    const row = rows[target.index];
    const parent = row && data.tasks.get(row.id);
    if (!parent) return bad(tr('Нельзя переместить'));
    const err = nestError(data, dragId, parent.id);
    if (err) return bad(err);
    return { ok: true, label: tr('Вложить в «{p0}»', { p0: short(parent.title) }), move: { id: dragId, parentId: parent.id, order: { append: true } } };
  }

  const zone = zones[target.zone] || {};
  const { prev, next, depth } = target;
  const orig = originalGap(rows, dragId);
  if (orig.zone === target.zone && orig.prev === prev && orig.next === next && depth === src.depth) {
    return { ok: true, noop: true, label: '' };
  }

  if (depth > 0) {
    // Родитель — ближайшая строка выше уровнем depth−1; соседи — строки того же уровня рядом с линией
    let p = prev;
    while (p >= 0 && rows[p].depth > depth - 1) p = prevInZone(rows, p, target.zone, block);
    const parent = p >= 0 && data.tasks.get(rows[p].id);
    if (!parent) return bad(tr('Нельзя переместить'));
    const err = nestError(data, dragId, parent.id);
    if (err) return bad(err);
    let order;
    if (p === prev && rows[p].collapsed) order = { append: true };
    else {
      let a = prev;
      while (a >= 0 && a !== p && rows[a].depth > depth) a = prevInZone(rows, a, target.zone, block);
      const before = next >= 0 && rows[next].depth === depth ? data.tasks.get(rows[next].id)?.order ?? null : null;
      const after = a >= 0 && a !== p && rows[a].depth === depth ? data.tasks.get(rows[a].id)?.order ?? null : null;
      // Видимых соседей нет (у родителя могут быть скрытые на этом экране подзадачи) — в конец
      order = after == null && before == null ? { append: true } : { field: 'order', after, before };
    }
    const changed = (task.parentId ?? null) !== parent.id;
    return { ok: true, label: changed ? tr('В «{p0}»', { p0: short(parent.title) }) : '', move: { id: dragId, parentId: parent.id, order } };
  }

  // Верхний уровень блока. Перенос из другого списка (экран «Списки») принимается в любой раздел списка —
  // задача встанет в свой раздел сама; место между соседями учитывается, только если раздел её.
  const fits = !zone.accepts || zone.accepts(task);
  const cross = !!zone.crossList && zone.listId != null && srcZone.listId !== zone.listId;
  if (!fits && !cross) return bad(zone.rejectReason || tr('Сюда эта задача не попадает'));
  let parentId;
  if (zone.rootParentId !== undefined && zone.rootParentId !== null) parentId = zone.rootParentId;
  else parentId = src.depth === 0 ? task.parentId ?? null : null; // корень остаётся при своём (скрытом) родителе
  if (parentId) {
    const err = nestError(data, dragId, parentId);
    if (err) return bad(err);
  }
  const lists = listChange(zone, srcZone, task);
  let order = null;
  if (zone.manual && fits) {
    const field = zone.orderField || 'order';
    let a = prev;
    while (a >= 0 && rows[a].depth > 0) a = prevInZone(rows, a, target.zone, block);
    const after = a >= 0 ? data.tasks.get(rows[a].id)?.[field] ?? null : null;
    const before = next >= 0 ? data.tasks.get(rows[next].id)?.[field] ?? null : null;
    order = { field, after, before };
  } else if ((task.parentId ?? null) === (parentId ?? null) && !lists) {
    return bad(zone.autoReason || tr('Порядок здесь автоматический — можно вложить или вынести'));
  }
  const label = lists?.add && lists.add !== srcZone.listId ? tr('В список «{p0}»', { p0: short(data.lists.get(lists.add)?.name || '') })
    : lists?.removeAll ? tr('Во «Входящие»') : (task.parentId ?? null) !== (parentId ?? null) ? tr('Вынести на верхний уровень') : '';
  return { ok: true, label, move: { id: dragId, parentId, order, lists } };
}

function bad(reason) {
  return { ok: false, reason, label: reason };
}

const short = (s) => (s.length > 40 ? s.slice(0, 39) + '…' : s);

/** Смена списков при броске в корень блока списка или «Входящих» (экран «Списки»: перенос между раскрытыми списками). */
function listChange(zone, srcZone, task) {
  const to = zone.listId;
  const from = srcZone.listId;
  if (to === undefined || to === null) return null;
  if (to === 'inbox') {
    if (from && from !== 'inbox' && taskListIds(task).length) return { removeAll: true, remove: from };
    return null;
  }
  const remove = from && from !== 'inbox' && from !== to ? from : null;
  if (inList(task, to) && !remove) return null;
  return { add: to, remove };
}

/** Ключ строго между a и b; если они перепутаны или равны (бывает после слияния) — сразу после a. */
export function keyBetweenSafe(a, b) {
  try {
    if (a != null && b != null && a >= b) return keyBetween(a, null);
    return keyBetween(a ?? null, b ?? null);
  } catch {
    try {
      return keyBetween(a ?? null, null);
    } catch {
      return 'a0';
    }
  }
}

function lastChildOrder(data, parentId, exceptId) {
  let max = null;
  for (const t of data.tasks.values()) {
    if (t.deletedAt || t.trashedAt || t.parentId !== parentId || t.id === exceptId) continue;
    if (parentOf(data, t)?.id !== parentId) continue;
    if (max == null || (t.order ?? '') > max) max = t.order ?? null;
  }
  return max;
}

/**
 * Применить перемещение: новые версии задач (родитель, порядок, списки — и у видимых в списке подзадач).
 * move: { id, parentId, order: { append } | { field, after, before } | null, lists: { add, remove, removeAll } | null }
 * opts: { today, focusMax }. Правило ★: звёздочка только у задач верхнего уровня — вложенная задача её теряет,
 * а её место в «Главном» достаётся верхней задаче новой ветки (если та ещё не главная).
 * → [{ coll: 'tasks', prev, next }]
 */
export function applyDrop(data, move, ctx, { today = null, focusMax = LIMITS.focusMax } = {}) {
  const t = data.tasks.get(move.id);
  if (!t) return [];
  const out = new Map();
  const cur = (id) => out.get(id)?.next || data.tasks.get(id);
  const put = (prev, next) => {
    if (next !== prev) out.set(next.id, { coll: 'tasks', prev: out.get(next.id)?.prev || prev, next });
  };

  const fields = {};
  const newParent = move.parentId === undefined ? t.parentId ?? null : move.parentId ?? null;
  if ((t.parentId ?? null) !== newParent) fields.parentId = newParent;
  if (move.order) {
    if (move.order.append) {
      fields.order = keyBetweenSafe(newParent ? lastChildOrder(data, newParent, t.id) : null, null);
    } else {
      const field = move.order.field || 'order';
      const key = keyBetweenSafe(move.order.after, move.order.before);
      if (key !== t[field]) fields[field] = key;
    }
  }

  // ★ только у задач верхнего уровня
  let starTo = null;
  if (fields.parentId && today && t.focusDate === today) {
    fields.focusDate = null;
    fields.focusOrder = null;
    const chain = [data.tasks.get(newParent), ...ancestors(data, data.tasks.get(newParent))];
    const root = chain.filter(Boolean).at(-1);
    const others = focusTasks(data, today).filter((x) => x.id !== t.id);
    if (root && root.id !== t.id && root.status === 'active' && root.focusDate !== today && others.length < focusMax) starTo = root;
  }

  let next = Object.keys(fields).length ? touch(t, fields, ctx) : t;
  const lists = move.lists;
  if (lists) {
    if (lists.removeAll) for (const l of taskListIds(next)) next = setListMembership(next, l, false, ctx);
    else {
      if (lists.remove) next = setListMembership(next, lists.remove, false, ctx);
      if (lists.add) next = setListMembership(next, lists.add, true, ctx);
    }
  }
  put(t, next);

  // Подзадачи переезжают с задачей: у тех, что были в исходном списке, список меняется так же
  if (lists && lists.remove) {
    for (const d of descendants(data, t.id)) {
      if (!inList(d, lists.remove)) continue;
      let y = setListMembership(cur(d.id), lists.remove, false, ctx);
      if (lists.add) y = setListMembership(y, lists.add, true, ctx);
      put(d, y);
    }
  }

  if (starTo) put(starTo, touch(cur(starTo.id), { focusDate: today, focusOrder: t.focusOrder ?? keyBetweenSafe(null, null) }, ctx));
  return [...out.values()];
}

/** Готовое перемещение для пунктов меню: «Сделать подзадачей» (в конец) и «Вынести на верхний уровень» (сразу после родителя). */
export function menuMove(data, id, parentId) {
  const t = data.tasks.get(id);
  if (!t) return null;
  if (parentId) return { id, parentId, order: { append: true } };
  const old = parentOf(data, t);
  if (!old) return null;
  // Сразу после бывшего родителя среди задач верхнего уровня
  let nextKey = null;
  for (const x of data.tasks.values()) {
    if (x.deletedAt || x.parentId || x.id === id || !x.order || x.order <= (old.order ?? '')) continue;
    if (nextKey == null || x.order < nextKey) nextKey = x.order;
  }
  const lists = taskListIds(t).length || !taskListIds(old).length ? null : { add: taskListIds(old)[0], remove: null };
  return { id, parentId: null, order: { field: 'order', after: old.order ?? null, before: nextKey }, lists };
}
