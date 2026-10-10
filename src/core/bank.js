// Банк задач (обновление 0.15): шаблоны часто повторяющихся дел — название, списки, приоритет, время, напоминания,
// повтор, подзадачи и заметки. Задача из шаблона создаётся в одно касание (в «Новой задаче» — поиском по банку), дата
// выбирается при создании. Коллекция templates; все поля — целиком (last-write-wins по полю). Чистые функции.
// Списки подзадач, заметок и напоминаний названы не notes/subtasks/reminders: эти имена у задач — вложенные массивы
// с id и метками (core/merge.js NESTED_ARRAYS), а у заготовки это простые значения.

import { uuidv7 } from './ids.js';
import { touch, normalizeTitle, taskListIds, liveNotes } from './model.js';
import { childrenIndex } from './selectors.js';
import { foldYo } from './query.js';
import { PRIORITY_NONE_ID } from './priorities.js';
import { LIMITS } from '../config.js';

export const TEMPLATE_FIELDS = ['title', 'listIds', 'priorityId', 'time', 'reminderRules', 'repeat', 'subtaskTitles', 'noteTexts', 'focus', 'uses', 'lastUsedAt', 'deletedAt'];
export const TEMPLATE_TEXT_MAX = 2000;
export const TEMPLATE_ITEMS_MAX = 30;

const iso = (ctx) => new Date(ctx.now).toISOString();
const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
const cleanTexts = (list, max) => (Array.isArray(list) ? list : []).map((s) => String(s ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max)).filter(Boolean).slice(0, TEMPLATE_ITEMS_MAX);
// у шаблона нет своей даты и дедлайна: остаются «за N минут до начала» и «в день задачи в ЧЧ:ММ»
const cleanReminder = (r) => {
  if (r?.kind === 'relative' && (r.anchor || 'scheduled') === 'scheduled' && Number.isFinite(+r.offsetMinutes)) return { kind: 'relative', anchor: 'scheduled', offsetMinutes: Math.round(+r.offsetMinutes) };
  if (r?.kind === 'timeOfDay' && timeRe.test(r.time || '')) return { kind: 'timeOfDay', time: r.time };
  return null;
};

/** Поля шаблона в чистом виде. reminderRules: null — по умолчанию из настроек, [] — без напоминаний. */
export function cleanTemplate(input = {}) {
  return {
    title: normalizeTitle(input.title).slice(0, LIMITS.titleMax),
    listIds: [...new Set((Array.isArray(input.listIds) ? input.listIds : []).filter((x) => typeof x === 'string' && x))].slice(0, 20),
    priorityId: typeof input.priorityId === 'string' && input.priorityId ? input.priorityId : PRIORITY_NONE_ID,
    time: timeRe.test(input.time || '') ? input.time : null,
    reminderRules: Array.isArray(input.reminderRules) ? input.reminderRules.map(cleanReminder).filter(Boolean).slice(0, 10) : null,
    repeat: input.repeat && typeof input.repeat === 'object' ? input.repeat : null,
    subtaskTitles: cleanTexts(input.subtaskTitles, LIMITS.titleMax),
    noteTexts: cleanTexts(input.noteTexts, TEMPLATE_TEXT_MAX),
    focus: !!input.focus,
  };
}

export function newTemplate(input, ctx) {
  const f = cleanTemplate(input);
  if (!f.title) throw new Error('newTemplate: пустое название');
  const at = iso(ctx);
  const t = ctx.stamp();
  return {
    id: uuidv7(ctx.now), createdAt: at, updatedAt: at, updatedBy: ctx.deviceId, deletedAt: null,
    fieldTimes: Object.fromEntries(TEMPLATE_FIELDS.map((k) => [k, t])), ...f, uses: 0, lastUsedAt: null,
  };
}

export function editTemplate(tpl, changes, ctx) {
  const merged = cleanTemplate({ ...tpl, ...changes });
  const out = {};
  for (const k of Object.keys(changes)) if (k in merged) out[k] = merged[k];
  if ('title' in out && !out.title) delete out.title;
  return touch(tpl, out, ctx);
}

/** Шаблон использован: счётчик и время — для «частых» сверху. */
export const markUsed = (tpl, ctx) => touch(tpl, { uses: (tpl.uses || 0) + 1, lastUsedAt: iso(ctx) }, ctx);

/** Шаблон из задачи: всё, кроме даты (подзадачи — названия живых, заметки — тексты). */
export function templateFromTask(data, task) {
  const kids = (childrenIndex(data).get(task.id) || []).filter((k) => !k.deletedAt && !k.trashedAt);
  return cleanTemplate({
    title: task.title, listIds: taskListIds(task), priorityId: task.priorityId, time: task.scheduledTime,
    reminderRules: (task.reminders || []).filter((r) => !r.deletedAt), repeat: task.repeat || null,
    subtaskTitles: kids.map((k) => k.title), noteTexts: liveNotes(task).map((n) => n.text), focus: false,
  });
}

/**
 * Поля для «Новой задачи» и createTask: date — день (или null — без даты; у повтора дата из правила, от сегодня).
 * reminders — правила шаблона (undefined — по умолчанию из настроек).
 */
export function taskInput(tpl, { date = null, today }) {
  const start = date || today;
  // повтор — от выбранного дня; «до» из прошлого (заготовку сохранили давно) не переносится
  const repeat = tpl.repeat ? { ...tpl.repeat, startDate: start, until: tpl.repeat.until && tpl.repeat.until >= start ? tpl.repeat.until : null } : null;
  return {
    title: tpl.title, listIds: [...(tpl.listIds || [])], priorityId: tpl.priorityId || PRIORITY_NONE_ID,
    scheduledDate: repeat ? null : date, scheduledTime: date || repeat ? tpl.time || null : null, repeat,
    reminders: tpl.reminderRules ?? undefined, notes: [...(tpl.noteTexts || [])], subtasks: [...(tpl.subtaskTitles || [])],
    focus: !!tpl.focus && !!date, focusDate: date || today,
  };
}

/** Живые шаблоны (поля — в чистом виде, даже если пришли неполными): частые и недавние сверху, потом по названию. */
export function templateList(data) {
  return [...(data.templates?.values() || [])].filter((t) => !t.deletedAt && t.title)
    .map((t) => (Array.isArray(t.listIds) && Array.isArray(t.subtaskTitles) && Array.isArray(t.noteTexts) ? t : { ...t, ...cleanTemplate(t) }))
    .sort((a, b) => (b.uses || 0) - (a.uses || 0) || (b.lastUsedAt || '').localeCompare(a.lastUsedAt || '') || a.title.localeCompare(b.title, 'ru'));
}

/** Поиск по банку: слова — в названии, заметках, подзадачах или названиях списков (ё = е, без регистра). */
export function searchTemplates(data, q, { listId = null, limit = Infinity } = {}) {
  const words = foldYo(String(q || '').toLowerCase()).split(/\s+/).filter(Boolean);
  const listName = (id) => data.lists.get(id)?.name || '';
  const out = [];
  for (const t of templateList(data)) {
    if (listId && !(listId === 'inbox' ? !t.listIds.length : t.listIds.includes(listId))) continue;
    const hay = foldYo([t.title, ...t.noteTexts, ...t.subtaskTitles, ...t.listIds.map(listName)].join('\n').toLowerCase());
    if (words.every((w) => hay.includes(w))) out.push(t);
    if (out.length >= limit) break;
  }
  // совпадение с началом названия — выше
  if (words.length) {
    const first = words[0];
    out.sort((a, b) => Number(foldYo(b.title.toLowerCase()).startsWith(first)) - Number(foldYo(a.title.toLowerCase()).startsWith(first)));
  }
  return out;
}

/** Есть ли уже шаблон с таким названием (без регистра и «ё»). */
export function findByTitle(data, title) {
  const key = foldYo(normalizeTitle(title).toLowerCase());
  return templateList(data).find((t) => foldYo(t.title.toLowerCase()) === key) || null;
}
