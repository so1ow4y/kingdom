// Фабрики сущностей и чистые мутации. Единственное место, где ставятся метки fieldTimes,
// updatedAt и updatedBy (docs/DATA_FORMAT.md §5.0). Формат v2 (обновление 0.3).
//
// ctx = { now: число мс, stamp: () => метка гибридных часов, deviceId }
// Все функции возвращают НОВЫЙ объект и сохраняют неизвестные поля (spread исходной сущности).

import { uuidv7 } from './ids.js';
import { sameValue, canonicalJson } from './canonical.js';
import {
  SETTINGS_ID, DEFAULT_LISTS, DEFAULTS_CREATED_AT, DEFAULTS_DEVICE_ID, CHORES_LIST_ID, LIMITS,
} from '../config.js';
import { DEFAULT_PRIORITIES, PRIORITY_NONE_ID } from './priorities.js';

export const SERVICE_FIELDS = new Set(['id', 'createdAt', 'updatedAt', 'updatedBy', 'fieldTimes']);
// Вложенные массивы и словари с метками на уровне элементов — через touch не меняются.
export const NESTED_ARRAYS = ['notes', 'attachments', 'reminders'];
export const KEYED_MAPS = ['occurrences', 'lists'];
export const NESTED_FIELDS = new Set([...NESTED_ARRAYS, ...KEYED_MAPS, 'subtasks']);

export const TASK_FIELDS = ['title', 'priorityId', 'parentId', 'status', 'completedAt', 'trashedAt',
  'scheduledDate', 'scheduledTime', 'deadlineDate', 'deadlineTime', 'focusDate', 'focusOrder', 'order',
  'repeat', 'nag', 'createdVia', 'deletedAt'];
export const NOTE_FIELDS = ['text', 'order', 'deletedAt'];
export const LIST_FIELDS = ['name', 'color', 'emoji', 'order', 'archived', 'deletedAt'];
export const PRIORITY_FIELDS = ['name', 'color', 'coins', 'order', 'archived', 'deletedAt'];
export const REWARD_FIELDS = ['name', 'emoji', 'price', 'repeatable', 'order', 'archived', 'deletedAt'];
export const SETTINGS_FIELDS = ['timeZone', 'choresListId', 'photoMaxSide', 'photoQuality', 'photoFormat',
  'voiceBitrate', 'trashRetentionDays', 'orphanMediaRetentionDays', 'writeReadableCopy',
  'gameEnabled', 'reminderPresets', 'defaultReminderMinutes', 'dayReminderTime', 'deletedAt'];
export const DEVICE_FIELDS = ['name', 'platform', 'appVersion', 'lastPushAt', 'deletedAt'];

/** Новые поля настроек v2 и их значения по умолчанию (миграция 1→2 добавляет их с меткой 1). */
export const SETTINGS_V2_DEFAULTS = {
  gameEnabled: true,
  reminderPresets: [5, 15, 30, 60, 1440],
  defaultReminderMinutes: 5,
  dayReminderTime: '09:00',
};

const iso = (ctx) => new Date(ctx.now).toISOString();

function fieldTimesFor(names, t) {
  const ft = {};
  for (const k of names) ft[k] = t;
  return ft;
}

function create(id, fields, fieldNames, ctx) {
  const at = iso(ctx);
  return {
    id,
    createdAt: at,
    updatedAt: at,
    updatedBy: ctx.deviceId,
    deletedAt: null,
    fieldTimes: fieldTimesFor(fieldNames, ctx.stamp()),
    ...fields,
  };
}

export const isLive = (e) => !!e && !e.deletedAt;

/**
 * Применить изменения полей. Метка ставится только реально изменившимся полям.
 * Если ничего не изменилось — возвращается тот же объект (по ссылке).
 */
export function touch(entity, changes, ctx) {
  let changed = null;
  for (const [k, v] of Object.entries(changes)) {
    if (SERVICE_FIELDS.has(k) || NESTED_FIELDS.has(k)) throw new Error('touch: служебное поле ' + k);
    if (!sameValue(entity[k], v)) (changed ??= {})[k] = v;
  }
  if (!changed) return entity;
  const t = ctx.stamp();
  const fieldTimes = { ...entity.fieldTimes };
  for (const k of Object.keys(changed)) fieldTimes[k] = t;
  return { ...entity, ...changed, fieldTimes, updatedAt: iso(ctx), updatedBy: ctx.deviceId };
}

function bumped(entity, ctx) {
  return { ...entity, updatedAt: iso(ctx), updatedBy: ctx.deviceId };
}

/**
 * Вернуть значения из prev (для «Отменить»). Это новая правка с новыми метками —
 * и для обычных полей, и для словарей (членство в списках), и для вложенных элементов (заметки).
 */
export function revert(current, prev, ctx) {
  const changes = {};
  const keys = new Set([...Object.keys(current), ...Object.keys(prev)]);
  for (const k of keys) {
    if (SERVICE_FIELDS.has(k) || NESTED_FIELDS.has(k)) continue;
    const v = k in prev ? prev[k] : null;
    if (!sameValue(current[k], v)) changes[k] = v;
  }
  let out = touch(current, changes, ctx);
  for (const k of KEYED_MAPS) {
    const a = current[k] || {};
    const b = prev[k] || {};
    let next = null;
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (sameValue(a[key], b[key])) continue;
      next ??= { ...a };
      next[key] = { ...(b[key] || a[key]), ...(b[key] ? {} : { in: false }), t: ctx.stamp(), by: ctx.deviceId };
    }
    if (next) out = { ...bumped(out, ctx), [k]: next };
  }
  for (const k of NESTED_ARRAYS) {
    const cur = new Map((current[k] || []).map((x) => [x.id, x]));
    const old = new Map((prev[k] || []).map((x) => [x.id, x]));
    let changed = false;
    const items = [];
    for (const id of new Set([...cur.keys(), ...old.keys()])) {
      const c = cur.get(id);
      const o = old.get(id);
      if (c && o && canonicalJson(c) === canonicalJson(o)) {
        items.push(c);
        continue;
      }
      changed = true;
      const t = ctx.stamp();
      if (o) items.push({ ...o, fieldTimes: Object.fromEntries(Object.keys(o.fieldTimes || {}).map((f) => [f, t])), updatedAt: iso(ctx) });
      else items.push({ id, createdAt: c.createdAt, deletedAt: iso(ctx), fieldTimes: { deletedAt: t } });
    }
    if (changed) out = { ...bumped(out, ctx), [k]: items.sort((x, y) => (x.id < y.id ? -1 : 1)) };
  }
  return out;
}

/** Надгробие: окончательное удаление (содержимое вычищается). */
export function tombstone(entity, ctx) {
  const at = iso(ctx);
  return {
    id: entity.id,
    createdAt: entity.createdAt,
    updatedAt: at,
    updatedBy: ctx.deviceId,
    deletedAt: at,
    fieldTimes: { deletedAt: ctx.stamp() },
  };
}

/** Копия сущности с новым id и свежими метками (восстановление из журнала конфликтов). */
export function cloneAsNew(entity, ctx) {
  const at = iso(ctx);
  const t = ctx.stamp();
  const fieldTimes = {};
  const out = { ...entity, id: uuidv7(ctx.now), createdAt: at, updatedAt: at, updatedBy: ctx.deviceId, deletedAt: null };
  for (const k of Object.keys(out)) {
    if (!SERVICE_FIELDS.has(k) && !NESTED_FIELDS.has(k)) fieldTimes[k] = t;
  }
  out.fieldTimes = fieldTimes;
  return out;
}

// ---------- Нормализация ввода ----------

export function normalizeTitle(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.titleMax);
}

export function normalizeNote(s) {
  return String(s ?? '').replace(/\r\n?/g, '\n').slice(0, LIMITS.noteMax);
}

export function normalizeListName(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.listNameMax);
}

/** Первая графема строки (для эмодзи списка) или null. */
export function firstGrapheme(s) {
  const str = String(s ?? '').trim();
  if (!str) return null;
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const seg = new Intl.Segmenter('ru', { granularity: 'grapheme' });
    for (const { segment } of seg.segment(str)) return segment;
  }
  return Array.from(str)[0];
}

// ---------- Задачи ----------

/**
 * Новая задача. input: { title, listIds?: [], parentId?, priorityId?, scheduledDate?, scheduledTime?,
 * deadlineDate?, deadlineTime?, focusDate?, focusOrder?, order, createdVia?, notes?: [строки], reminders?: [Reminder без служебных] }
 */
export function newTask(input, ctx) {
  const title = normalizeTitle(input.title);
  if (!title) throw new Error('newTask: пустое название');
  const t = create(uuidv7(ctx.now), {
    title,
    priorityId: input.priorityId ?? PRIORITY_NONE_ID,
    parentId: input.parentId ?? null,
    status: 'active',
    completedAt: null,
    trashedAt: null,
    scheduledDate: input.scheduledDate ?? null,
    scheduledTime: input.scheduledDate ? (input.scheduledTime ?? null) : null,
    deadlineDate: input.deadlineDate ?? null,
    deadlineTime: input.deadlineDate ? (input.deadlineTime ?? null) : null,
    focusDate: input.focusDate ?? null,
    focusOrder: input.focusDate ? (input.focusOrder ?? null) : null,
    order: input.order ?? 'a0',
    repeat: null,
    nag: { enabled: false, intervalMinutes: 15 },
    createdVia: input.createdVia ?? 'app',
    notes: [],
    attachments: [],
    reminders: [],
    occurrences: {},
    lists: {},
  }, TASK_FIELDS, ctx);
  let out = t;
  for (const id of input.listIds || []) out = setListMembership(out, id, true, ctx);
  let order = null;
  for (const text of input.notes || []) {
    if (!String(text).trim()) continue;
    order = order ? nextOrderKey(order) : 'a0';
    out = addNote(out, text, order, ctx);
  }
  for (const r of input.reminders || []) out = addReminder(out, r, ctx);
  return { ...out, updatedAt: t.updatedAt };
}

// Простой рост ключа порядка для пачки новых элементов: a0, a1, … a9, aA … (хватает на 62 элемента).
const DIG = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function nextOrderKey(k) {
  const i = DIG.indexOf(k[1]);
  return i >= 0 && i < DIG.length - 1 && k.length === 2 ? k[0] + DIG[i + 1] : k + 'V';
}

export const completeTask = (task, ctx) => touch(task, { status: 'done', completedAt: iso(ctx) }, ctx);
export const reopenTask = (task, ctx) => touch(task, { status: 'active', completedAt: null }, ctx);
export const trashTask = (task, ctx, at = iso(ctx)) => touch(task, { trashedAt: at }, ctx);
export const restoreTask = (task, ctx) => touch(task, { trashedAt: null }, ctx);

/** Живые списки задачи (id), в которых она состоит. */
export function taskListIds(task) {
  const out = [];
  for (const [id, v] of Object.entries(task.lists || {})) if (v && v.in) out.push(id);
  return out;
}

/** Добавить в список или убрать из него (элемент словаря lists с собственной меткой). */
export function setListMembership(task, listId, inList, ctx) {
  const cur = task.lists?.[listId];
  if ((cur?.in || false) === inList && (cur || !inList)) return task;
  return { ...bumped(task, ctx), lists: { ...(task.lists || {}), [listId]: { in: inList, t: ctx.stamp(), by: ctx.deviceId } } };
}

// ---------- Вложенные элементы: заметки, напоминания ----------

function nestedNew(fields, names, ctx) {
  const at = iso(ctx);
  return { id: uuidv7(ctx.now), createdAt: at, updatedAt: at, updatedBy: ctx.deviceId, deletedAt: null, fieldTimes: fieldTimesFor(names, ctx.stamp()), ...fields };
}

function withNested(task, coll, items, ctx) {
  return { ...bumped(task, ctx), [coll]: items.sort((a, b) => (a.id < b.id ? -1 : 1)) };
}

/** Правка полей вложенного элемента (метки — только изменённым полям). */
export function touchNested(task, coll, itemId, changes, ctx) {
  const items = task[coll] || [];
  const item = items.find((x) => x.id === itemId);
  if (!item || item.deletedAt) return task;
  const next = touch(item, changes, ctx);
  if (next === item) return task;
  const { updatedBy, ...rest } = next; // у вложенных хранится updatedAt, автор — у задачи
  return withNested(task, coll, items.map((x) => (x.id === itemId ? { ...rest, updatedBy } : x)), ctx);
}

export function removeNested(task, coll, itemId, ctx) {
  const items = task[coll] || [];
  const item = items.find((x) => x.id === itemId);
  if (!item || item.deletedAt) return task;
  const at = iso(ctx);
  return withNested(task, coll, items.map((x) => (x.id === itemId
    ? { id: x.id, createdAt: x.createdAt, deletedAt: at, fieldTimes: { deletedAt: ctx.stamp() } } : x)), ctx);
}

export function liveNotes(task) {
  return (task.notes || []).filter((n) => !n.deletedAt).sort((a, b) => (a.order === b.order ? (a.id < b.id ? -1 : 1) : a.order < b.order ? -1 : 1));
}

export function addNote(task, text, order, ctx) {
  const note = nestedNew({ text: normalizeNote(text), order }, NOTE_FIELDS, ctx);
  return withNested(task, 'notes', [...(task.notes || []), note], ctx);
}

export const REMINDER_FIELDS = ['kind', 'at', 'offsetMinutes', 'anchor', 'time', 'deletedAt'];

/** r: { kind: 'relative', offsetMinutes, anchor } | { kind: 'absolute', at } | { kind: 'timeOfDay', time } */
export function addReminder(task, r, ctx) {
  const fields = { kind: r.kind, at: r.at ?? null, offsetMinutes: r.offsetMinutes ?? null, anchor: r.anchor ?? null, time: r.time ?? null };
  const rem = nestedNew(fields, REMINDER_FIELDS, ctx);
  return withNested(task, 'reminders', [...(task.reminders || []), rem], ctx);
}

export function duplicateTask(task, order, ctx) {
  const copy = newTask({
    title: normalizeTitle(task.title.slice(0, LIMITS.titleMax - 8) + ' (копия)'),
    listIds: taskListIds(task),
    parentId: task.parentId ?? null,
    priorityId: task.priorityId,
    scheduledDate: task.scheduledDate,
    scheduledTime: task.scheduledTime,
    deadlineDate: task.deadlineDate,
    deadlineTime: task.deadlineTime,
    notes: liveNotes(task).map((n) => n.text),
    order,
  }, ctx);
  return { ...copy, repeat: task.repeat ?? null, nag: task.nag ?? copy.nag };
}

// ---------- Списки, приоритеты, награды ----------

export function newList({ name, color, emoji, order }, ctx) {
  const n = normalizeListName(name);
  if (!n) throw new Error('newList: пустое название');
  return create(uuidv7(ctx.now), { name: n, color, emoji: emoji ?? null, order, archived: false }, LIST_FIELDS, ctx);
}

/** Списки по умолчанию: фиксированные id и минимальные метки — любая правка пользователя их перебивает. */
export function defaultLists() {
  return DEFAULT_LISTS.map((l) => ({
    id: l.id,
    createdAt: DEFAULTS_CREATED_AT,
    updatedAt: DEFAULTS_CREATED_AT,
    updatedBy: DEFAULTS_DEVICE_ID,
    deletedAt: null,
    fieldTimes: fieldTimesFor(LIST_FIELDS, 1),
    name: l.name,
    color: l.color,
    emoji: l.emoji,
    order: l.order,
    archived: false,
  }));
}

export function defaultPriorities() {
  return DEFAULT_PRIORITIES.map((p) => ({
    id: p.id,
    createdAt: DEFAULTS_CREATED_AT,
    updatedAt: DEFAULTS_CREATED_AT,
    updatedBy: DEFAULTS_DEVICE_ID,
    deletedAt: null,
    fieldTimes: fieldTimesFor(PRIORITY_FIELDS, 1),
    name: p.name,
    color: p.color,
    coins: p.coins,
    order: p.order,
    archived: false,
  }));
}

export function newPriority({ name, color, coins, order }, ctx) {
  const n = normalizeListName(name);
  if (!n) throw new Error('newPriority: пустое название');
  return create(uuidv7(ctx.now), { name: n, color, coins: Math.max(0, Math.round(coins) || 0), order, archived: false }, PRIORITY_FIELDS, ctx);
}

export function newReward({ name, emoji, price, repeatable, order }, ctx) {
  const n = normalizeListName(name);
  if (!n) throw new Error('newReward: пустое название');
  return create(uuidv7(ctx.now), {
    name: n, emoji: emoji ?? null, price: Math.max(1, Math.round(price) || 1), repeatable: !!repeatable, order, archived: false,
  }, REWARD_FIELDS, ctx);
}

export function defaultSettings(timeZone) {
  return {
    id: SETTINGS_ID,
    createdAt: DEFAULTS_CREATED_AT,
    updatedAt: DEFAULTS_CREATED_AT,
    updatedBy: DEFAULTS_DEVICE_ID,
    deletedAt: null,
    fieldTimes: fieldTimesFor(SETTINGS_FIELDS, 1),
    timeZone,
    choresListId: CHORES_LIST_ID,
    photoMaxSide: 1600,
    photoQuality: 0.7,
    photoFormat: 'webp',
    voiceBitrate: 24000,
    trashRetentionDays: 30,
    orphanMediaRetentionDays: 30,
    writeReadableCopy: true,
    ...structuredClone(SETTINGS_V2_DEFAULTS),
  };
}

// ---------- Устройства ----------

export function newDevice({ id, name, platform, appVersion }, ctx) {
  return create(id, { name, platform, appVersion, lastPushAt: null }, DEVICE_FIELDS, ctx);
}
