// Фабрики сущностей и чистые мутации. Единственное место, где ставятся метки fieldTimes,
// updatedAt и updatedBy (docs/DATA_FORMAT.md §5.0).
//
// ctx = { now: число мс, stamp: () => метка гибридных часов, deviceId }
// Все функции возвращают НОВЫЙ объект и сохраняют неизвестные поля (spread исходной сущности).

import { uuidv7 } from './ids.js';
import { sameValue } from './canonical.js';
import {
  SETTINGS_ID, DEFAULT_LISTS, DEFAULTS_CREATED_AT, DEFAULTS_DEVICE_ID, CHORES_LIST_ID, LIMITS,
} from '../config.js';

export const SERVICE_FIELDS = new Set(['id', 'createdAt', 'updatedAt', 'updatedBy', 'fieldTimes']);
export const NESTED_FIELDS = new Set(['subtasks', 'attachments', 'reminders', 'occurrences']);

export const TASK_FIELDS = ['title', 'note', 'listId', 'priority', 'status', 'completedAt', 'trashedAt',
  'scheduledDate', 'scheduledTime', 'deadlineDate', 'deadlineTime', 'focusDate', 'focusOrder', 'order',
  'repeat', 'nag', 'createdVia', 'deletedAt'];
export const LIST_FIELDS = ['name', 'color', 'emoji', 'order', 'archived', 'deletedAt'];
export const SETTINGS_FIELDS = ['timeZone', 'choresListId', 'photoMaxSide', 'photoQuality', 'photoFormat',
  'voiceBitrate', 'trashRetentionDays', 'orphanMediaRetentionDays', 'writeReadableCopy', 'deletedAt'];
export const DEVICE_FIELDS = ['name', 'platform', 'appVersion', 'lastPushAt', 'deletedAt'];

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

/** Вернуть значения полей из prev (для «Отменить»). Это новая правка с новыми метками. */
export function revert(current, prev, ctx) {
  const changes = {};
  const keys = new Set([...Object.keys(current), ...Object.keys(prev)]);
  for (const k of keys) {
    if (SERVICE_FIELDS.has(k) || NESTED_FIELDS.has(k)) continue;
    const v = k in prev ? prev[k] : null;
    if (!sameValue(current[k], v)) changes[k] = v;
  }
  return touch(current, changes, ctx);
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

export function newTask(input, ctx) {
  const title = normalizeTitle(input.title);
  if (!title) throw new Error('newTask: пустое название');
  return create(uuidv7(ctx.now), {
    title,
    note: normalizeNote(input.note ?? ''),
    listId: input.listId ?? null,
    priority: input.priority ?? 0,
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
    subtasks: [],
    attachments: [],
    reminders: [],
    occurrences: {},
  }, TASK_FIELDS, ctx);
}

export const completeTask = (task, ctx) => touch(task, { status: 'done', completedAt: iso(ctx) }, ctx);
export const reopenTask = (task, ctx) => touch(task, { status: 'active', completedAt: null }, ctx);
export const trashTask = (task, ctx) => touch(task, { trashedAt: iso(ctx) }, ctx);
export const restoreTask = (task, ctx) => touch(task, { trashedAt: null }, ctx);

export function duplicateTask(task, order, ctx) {
  const copy = newTask({
    title: normalizeTitle(task.title.slice(0, LIMITS.titleMax - 8) + ' (копия)'),
    note: task.note,
    listId: task.listId,
    priority: task.priority,
    scheduledDate: task.scheduledDate,
    scheduledTime: task.scheduledTime,
    deadlineDate: task.deadlineDate,
    deadlineTime: task.deadlineTime,
    order,
  }, ctx);
  return { ...copy, repeat: task.repeat ?? null, nag: task.nag ?? copy.nag };
}

// ---------- Списки ----------

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
  };
}

// ---------- Устройства ----------

export function newDevice({ id, name, platform, appVersion }, ctx) {
  return create(id, { name, platform, appVersion, lastPushAt: null }, DEVICE_FIELDS, ctx);
}
