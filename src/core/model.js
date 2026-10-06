// Фабрики сущностей и чистые мутации. Единственное место, где ставятся метки fieldTimes,
// updatedAt и updatedBy (docs/DATA_FORMAT.md §5.0). Формат v3 (обновление 0.5: вложения в заметках, сводки удалённых выполненных).
//
// ctx = { now: число мс, stamp: () => метка гибридных часов, deviceId }
// Все функции возвращают НОВЫЙ объект и сохраняют неизвестные поля (spread исходной сущности).

import { uuidv7 } from './ids.js';
import { keyBetween } from './order.js';
import { sameValue, canonicalJson } from './canonical.js';
import {
  SETTINGS_ID, DEFAULT_LISTS, DEFAULTS_CREATED_AT, DEFAULTS_DEVICE_ID, CHORES_LIST_ID, LIMITS, RETENTION,
} from '../config.js';
import { DEFAULT_PRIORITIES, PRIORITY_NONE_ID } from './priorities.js';

export const SERVICE_FIELDS = new Set(['id', 'createdAt', 'updatedAt', 'updatedBy', 'fieldTimes']);
// Вложенные массивы и словари с метками на уровне элементов — через touch не меняются.
// focusSessions — с 0.7.1: фокус-сессии по задаче (необязательное поле, у новых задач его нет до первой сессии).
export const NESTED_ARRAYS = ['notes', 'attachments', 'reminders', 'focusSessions'];
export const KEYED_MAPS = ['occurrences', 'lists'];
export const NESTED_FIELDS = new Set([...NESTED_ARRAYS, ...KEYED_MAPS, 'subtasks']);

export const TASK_FIELDS = ['title', 'priorityId', 'parentId', 'status', 'completedAt', 'trashedAt',
  'scheduledDate', 'scheduledTime', 'deadlineDate', 'deadlineTime', 'focusDate', 'focusOrder', 'order',
  'repeat', 'nag', 'createdVia', 'deletedAt'];
export const NOTE_FIELDS = ['text', 'order', 'deletedAt'];
export const FOCUS_SESSION_FIELDS = ['startedAt', 'minutes', 'deletedAt'];
export const LIST_FIELDS = ['name', 'color', 'emoji', 'order', 'archived', 'deletedAt'];
export const PRIORITY_FIELDS = ['name', 'color', 'coins', 'order', 'archived', 'deletedAt'];
export const REWARD_FIELDS = ['name', 'emoji', 'price', 'repeatable', 'order', 'archived', 'deletedAt'];
export const SETTINGS_FIELDS = ['timeZone', 'choresListId', 'photoMaxSide', 'photoQuality', 'photoFormat',
  'voiceBitrate', 'trashRetentionDays', 'orphanMediaRetentionDays', 'writeReadableCopy',
  'gameEnabled', 'reminderPresets', 'defaultReminderMinutes', 'dayReminderTime',
  'completedLimit', 'voiceMaxSeconds', 'attachmentMaxMB', 'nagPresets', 'deletedAt'];
export const ATTACHMENT_FIELDS = ['mediaId', 'name', 'order', 'deletedAt'];
export const MEDIA_FIELDS = ['kind', 'mime', 'ext', 'codec', 'size', 'width', 'height', 'durationMs', 'original',
  'driveFileId', 'orphanedAt', 'deletedAt'];
export const ARCHIVE_FIELDS = ['completedAt', 'listIds', 'priorityId', 'coins', 'deletedAt'];
export const DEVICE_FIELDS = ['name', 'platform', 'appVersion', 'lastPushAt', 'deletedAt'];

/** Новые поля настроек v2 и их значения по умолчанию (миграция 1→2 добавляет их с меткой 1). */
export const SETTINGS_V2_DEFAULTS = {
  gameEnabled: true,
  reminderPresets: [5, 15, 30, 60, 1440],
  defaultReminderMinutes: 5,
  dayReminderTime: '09:00',
};

/** Новые поля настроек v3 (обновление 0.5); миграция 2→3 добавляет их с меткой 1. */
export const SETTINGS_V3_DEFAULTS = {
  completedLimit: RETENTION.completedDefault, // null — без лимита
  voiceMaxSeconds: 600,
  attachmentMaxMB: 100,
  nagPresets: [1, 5, 10, 15, 30, 60],
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
      // ключа раньше не было: у списков — «не в списке», у экземпляров повтора — снова открыт
      const gone = k === 'occurrences' ? { state: 'open', doneAt: null } : { in: false };
      next[key] = { ...(b[key] || a[key]), ...(b[key] ? {} : gone), t: ctx.stamp(), by: ctx.deviceId };
    }
    if (next) out = { ...bumped(out, ctx), [k]: next };
  }
  for (const k of NESTED_ARRAYS) {
    const items = revertItems(current[k], prev[k], ctx);
    if (items) out = { ...bumped(out, ctx), [k]: items };
  }
  return out;
}

/** «Отменить» для вложенного массива: вернуть элементы из old новыми метками (и их вложенные массивы — тоже). null — без изменений. */
function revertItems(curArr, oldArr, ctx) {
  const cur = new Map((curArr || []).map((x) => [x.id, x]));
  const old = new Map((oldArr || []).map((x) => [x.id, x]));
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
    if (o) {
      const restored = { ...o, fieldTimes: Object.fromEntries(Object.keys(o.fieldTimes || {}).map((f) => [f, t])), updatedAt: iso(ctx) };
      for (const n of NESTED_ARRAYS) {
        const inner = c && !o.deletedAt ? revertItems(c[n], o[n], ctx) : null;
        if (inner) restored[n] = inner;
      }
      items.push(restored);
    } else items.push({ id, createdAt: c.createdAt, deletedAt: iso(ctx), fieldTimes: { deletedAt: t } });
  }
  return changed ? items.sort((x, y) => (x.id < y.id ? -1 : 1)) : null;
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
    // у повторяющейся задачи своей даты нет — она вычисляется из правила (core/repeat.js), время — общее
    scheduledDate: input.repeat ? null : input.scheduledDate ?? null,
    scheduledTime: input.scheduledDate || input.repeat ? (input.scheduledTime ?? null) : null,
    deadlineDate: input.deadlineDate ?? null,
    deadlineTime: input.deadlineDate ? (input.deadlineTime ?? null) : null,
    focusDate: input.focusDate ?? null,
    focusOrder: input.focusDate ? (input.focusOrder ?? null) : null,
    order: input.order ?? 'a0',
    repeat: input.repeat ?? null,
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

// ---------- Вложения заметок (формат v3) ----------

const byOrderId = (a, b) => (a.order === b.order ? (a.id < b.id ? -1 : 1) : a.order < b.order ? -1 : 1);

export function liveAttachments(note) {
  return (note?.attachments || []).filter((a) => !a.deletedAt).sort(byOrderId);
}

/** Заменить заметку noteId результатом fn(note); updatedAt заметки и задачи — сейчас. */
function updateNote(task, noteId, fn, ctx) {
  const notes = task.notes || [];
  const note = notes.find((n) => n.id === noteId);
  if (!note || note.deletedAt) return task;
  const next = fn(note);
  if (next === note) return task;
  return withNested(task, 'notes', notes.map((n) => (n.id === noteId ? { ...next, updatedAt: iso(ctx) } : n)), ctx);
}

function safeKeyAfter(last) {
  try {
    return keyBetween(last ?? null, null);
  } catch {
    return 'a0';
  }
}

/** att: { mediaId, name } — в конец списка вложений заметки. */
export function addAttachment(task, noteId, att, ctx) {
  return updateNote(task, noteId, (note) => {
    const order = safeKeyAfter(liveAttachments(note).at(-1)?.order);
    const item = nestedNew({ mediaId: att.mediaId, name: String(att.name || 'файл').slice(0, 255), order }, ATTACHMENT_FIELDS, ctx);
    delete item.updatedBy;
    return { ...note, attachments: [...(note.attachments || []), item].sort((a, b) => (a.id < b.id ? -1 : 1)) };
  }, ctx);
}

export function removeAttachment(task, noteId, attId, ctx) {
  return updateNote(task, noteId, (note) => {
    const items = note.attachments || [];
    if (!items.some((a) => a.id === attId && !a.deletedAt)) return note;
    const at = iso(ctx);
    return { ...note, attachments: items.map((a) => (a.id === attId ? { id: a.id, createdAt: a.createdAt, deletedAt: at, fieldTimes: { deletedAt: ctx.stamp() } } : a)) };
  }, ctx);
}

export function moveAttachment(task, noteId, attId, order, ctx) {
  return updateNote(task, noteId, (note) => {
    const items = note.attachments || [];
    const a = items.find((x) => x.id === attId && !x.deletedAt);
    if (!a) return note;
    const next = touch(a, { order }, ctx);
    if (next === a) return note;
    const { updatedBy, ...rest } = next;
    return { ...note, attachments: items.map((x) => (x.id === attId ? rest : x)) };
  }, ctx);
}

/** Медиа: id = sha256 сохранённых байтов (DATA_FORMAT §5.5). meta: { id, kind, mime, ext, codec, size, width, height, durationMs, original } */
export function newMedia(meta, ctx) {
  return create(meta.id, {
    kind: meta.kind, mime: meta.mime, ext: meta.ext, codec: meta.codec ?? null, size: meta.size | 0,
    width: meta.width ?? null, height: meta.height ?? null, durationMs: meta.durationMs ?? null,
    original: !!meta.original, driveFileId: null, orphanedAt: null,
  }, MEDIA_FIELDS, ctx);
}

export const REMINDER_FIELDS = ['kind', 'at', 'offsetMinutes', 'anchor', 'time', 'deletedAt'];

/** r: { kind: 'relative', offsetMinutes, anchor } | { kind: 'absolute', at } | { kind: 'timeOfDay', time } */
export function addReminder(task, r, ctx) {
  const fields = { kind: r.kind, at: r.at ?? null, offsetMinutes: r.offsetMinutes ?? null, anchor: r.anchor ?? null, time: r.time ?? null };
  const rem = nestedNew(fields, REMINDER_FIELDS, ctx);
  return withNested(task, 'reminders', [...(task.reminders || []), rem], ctx);
}

// ---------- Фокус-сессии (0.7.1) ----------

/** Записать завершённую фокус-сессию в задачу: { startedAt: ISO, minutes }. Элементы сливаются по id, как заметки. */
export function addFocusSession(task, { startedAt, minutes }, ctx) {
  const m = Math.max(1, Math.min(1440, Math.round(minutes)));
  const s = nestedNew({ startedAt, minutes: m }, FOCUS_SESSION_FIELDS, ctx);
  delete s.updatedBy;
  return withNested(task, 'focusSessions', [...(task.focusSessions || []), s], ctx);
}

export function liveFocusSessions(task) {
  return (task?.focusSessions || []).filter((s) => !s.deletedAt).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

/** Сколько фокуса у задачи: { minutes, count }. */
export function focusTotal(task) {
  let minutes = 0;
  let count = 0;
  for (const s of task?.focusSessions || []) {
    if (s.deletedAt) continue;
    minutes += s.minutes | 0;
    count++;
  }
  return { minutes, count };
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
    order,
  }, ctx);
  // Заметки (в том числе голосовые без текста) и вложения — ссылками на те же медиа, файлы не дублируются
  let out = copy;
  let key = null;
  for (const n of liveNotes(task)) {
    if (!n.text.trim() && !liveAttachments(n).length) continue;
    key = key ? nextOrderKey(key) : 'a0';
    out = addNote(out, n.text, key, ctx);
    const dst = (out.notes || []).find((x) => x.order === key && !x.deletedAt);
    for (const a of liveAttachments(n)) out = addAttachment(out, dst.id, a, ctx);
  }
  return { ...out, repeat: task.repeat ?? null, nag: task.nag ?? copy.nag };
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

export function newPriority({ name, color, coins, order, xp = null }, ctx) {
  const n = normalizeListName(name);
  if (!n) throw new Error('newPriority: пустое название');
  const fields = { name: n, color, coins: Math.max(0, Math.round(coins) || 0), order, archived: false };
  // опыт навыка (0.8) — необязательное поле: без него берётся значение по умолчанию (core/skills.js)
  if (Number.isFinite(xp)) fields.xp = Math.max(0, Math.min(100000, Math.round(xp)));
  return create(uuidv7(ctx.now), fields, fields.xp != null ? [...PRIORITY_FIELDS, 'xp'] : PRIORITY_FIELDS, ctx);
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
    ...structuredClone(SETTINGS_V3_DEFAULTS),
  };
}

// ---------- Устройства ----------

export function newDevice({ id, name, platform, appVersion }, ctx) {
  return create(id, { name, platform, appVersion, lastPushAt: null }, DEVICE_FIELDS, ctx);
}
