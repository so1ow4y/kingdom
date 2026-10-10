// Обозреватель задач (обновление 0.10) — перенос «обработки пользователей и сработок» из license-store
// (features/admin-security/log-explorer.tsx, routes/_app/admin.users.index.tsx) на задачи LifeTasks:
// строка «поле:значение», диапазон времени, гистограмма, топ значений по полям, массовые действия.
// Там это считает сервер (admin.controller.ts), здесь — сам клиент по данным в памяти.

import { parseQuery, evaluate, textMatch, textContains } from './query.js';
import * as S from './selectors.js';
import { liveNotes, liveAttachments } from './model.js';
import { localDateOf, isoWeekday, addDays, WEEKDAY_SHORT, WEEKDAY_LONG } from './dates.js';
import { LANG, tr } from './i18n.js';
import { priorityLabel } from './priorities.js';
import { describeRule, ruleCategory, CATEGORIES } from './repeat.js';

/** Виды обозревателя: какие задачи, по какому времени, какие поля в топе. */
export const KINDS = {
  all: { title: tr('Все задачи'), time: 'createdAt', timeLabel: tr('Создана'), histogram: tr('Создано задач'),
    facets: ['статус', 'список', 'приоритет', 'повтор', 'день', 'устройство'], columns: ['название', 'список', 'приоритет'] },
  done: { title: tr('Выполненные'), time: 'completedAt', timeLabel: tr('Выполнена'), histogram: tr('Выполнено задач'),
    facets: ['список', 'приоритет', 'день', 'устройство'], columns: ['название', 'список', 'приоритет'] },
  trash: { title: tr('Корзина'), time: 'trashedAt', timeLabel: tr('В корзине'), histogram: tr('Удалено в корзину'),
    facets: ['список', 'приоритет', 'день', 'устройство'], columns: ['название', 'список', 'приоритет'] },
  // 0.15: «Поиск» на четыре вкладки — все, активные (не выполнены и не в корзине), повторяющиеся и банк задач
  active: { title: tr('Активные'), time: 'createdAt', timeLabel: tr('Создана'), histogram: tr('Создано задач'),
    facets: ['список', 'приоритет', 'повтор', 'день', 'устройство'], columns: ['название', 'список', 'приоритет'] },
  repeat: { title: tr('Повторяющиеся'), time: 'createdAt', timeLabel: tr('Создана'), histogram: tr('Создано задач'),
    facets: ['повтор', 'статус', 'список', 'приоритет', 'устройство'], columns: ['название', 'список', 'приоритет'] },
};

/** Виды, где задачи живые (не архив и не корзина): у них действия «Выполнить», «Список…», «Приоритет…». */
export const LIVE_KINDS = ['all', 'active', 'repeat'];

/** Поля строки поиска и их синонимы (латиницей — чтобы не переключать раскладку ради «list:»). */
export const FIELDS = {
  'название': ['title', 'имя'],
  'заметка': ['note', 'notes', 'заметки'],
  'список': ['list', 'lists', 'списки'],
  'приоритет': ['priority', 'prio'],
  'статус': ['status', 'state'],
  'дата': ['date', 'time', 'когда'],
  'день': ['day', 'weekday'],
  'план': ['plan', 'scheduled'],
  'срок': ['due', 'deadline', 'дедлайн'],
  'повтор': ['repeat', 'повторы', 'повторяется'], // 0.12.3: дни, недели, месяцы, годы, нет — или текст правила
  'есть': ['has'],
  'устройство': ['device', 'by'],
};

/** Кнопки полей под строкой поиска (статус — во «Всех задачах» и повторах: у остальных он один). */
export function fieldChips(kind) {
  return Object.keys(FIELDS).filter((f) => kind === 'all' || kind === 'repeat' || f !== 'статус');
}

export const PLACEHOLDER = {
  all: LANG === 'en' ? 'list:Work -status:done repeat:years has:note text' : 'список:Работа -статус:выполнена повтор:годы есть:заметка текст',
  done: LANG === 'en' ? 'date:2026-10 priority:high -list:Home' : 'дата:2026-10 приоритет:высокий -список:Дом',
  trash: LANG === 'en' ? 'device:phone list:inbox text' : 'устройство:телефон список:входящие текст',
  active: LANG === 'en' ? 'list:Work priority:high has:deadline text' : 'список:Работа приоритет:высокий есть:срок текст',
  repeat: LANG === 'en' ? 'repeat:weeks list:Home -status:done text' : 'повтор:недели список:Дом -статус:выполнена текст',
};

/** Как показать поле запроса: по-английски — первый английский синоним (запрос понимает оба). */
export const fieldLabel = (f) => (LANG === 'en' ? (FIELDS[f] || []).find((x) => /^[a-z]+$/.test(x)) || f : f);

export const STATUS_LABEL = { active: tr('активна'), done: tr('выполнена'), trash: tr('в корзине') };
const STATUS_ALIASES = {
  active: ['active', 'open', 'активна', 'активные', 'активная', 'открыта', 'открытые', 'в работе'],
  done: ['done', 'completed', 'выполнена', 'выполненные', 'выполнено', 'готово', 'сделано'],
  trash: ['trash', 'trashed', 'deleted', 'в корзине', 'корзина', 'удалена', 'удалённые'],
};

/** «есть:…» — признаки задачи. */
const HAS = {
  note: ['note', 'notes', 'заметка', 'заметки', 'заметку'],
  file: ['file', 'files', 'attachment', 'вложение', 'вложения', 'файл', 'файлы', 'фото', 'медиа'],
  reminder: ['reminder', 'reminders', 'напоминание', 'напоминания'],
  repeat: ['repeat', 'повтор', 'повторы', 'повторяется'],
  subtasks: ['subtasks', 'children', 'подзадачи', 'подзадача'],
  parent: ['parent', 'родитель', 'вложена'],
  deadline: ['deadline', 'due', 'срок', 'дедлайн'],
  plan: ['plan', 'date', 'план', 'дата'],
  focus: ['focus', 'фокус'],
};
export const HAS_HINT = LANG === 'en' ? 'note, file, reminder, repeat, subtasks, parent, deadline, plan, focus' : 'заметка, вложение, напоминание, повтор, подзадачи, родитель, срок, план, фокус';
export const REPEAT_HINT = LANG === 'en' ? 'days, weeks, months, years, yes, no — or a word from the rule: weekdays, March, 15th' : 'дни, недели, месяцы, годы, есть, нет — или слово из правила: будни, март, 15-го';

export const INBOX_NAME = tr('Входящие');
const NO = ['нет', 'no', 'none', 'без', '-'];
const YES = ['есть', 'yes', 'any', 'да', '*'];

export const statusOf = (t) => (t.trashedAt ? 'trash' : t.status === 'done' ? 'done' : 'active');
export const eventTime = (t, kind) => t[KINDS[kind].time] || t.createdAt;

/** Задачи вида: все живые / выполненные (архив) / корзина (без подзадач, ушедших туда с родителем). */
export function rowsOf(data, kind) {
  if (kind === 'done') return S.archiveView(data);
  if (kind === 'trash') return S.trashView(data);
  const keep = kind === 'active' ? (t) => !t.trashedAt && t.status !== 'done'
    : kind === 'repeat' ? (t) => !t.trashedAt && !!t.repeat : () => true;
  const out = [];
  for (const t of data.tasks.values()) if (S.isAlive(t) && keep(t)) out.push(t);
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/** Общий контекст проверки: часовой пояс, «сегодня», индекс подзадач, имена устройств. */
export function makeContext(data, tz, today) {
  return { data, tz, today, kids: S.childrenIndex(data, { includeTrash: true }), lists: new Map() };
}

/** Списки задачи; у подзадачи без своих списков — списки ближайшего предка; корень без списков — «Входящие». */
export function listNames(ctx, t) {
  let names = ctx.lists.get(t.id);
  if (names) return names;
  let ls = S.taskLists(ctx.data, t);
  if (!ls.length) {
    for (const a of S.ancestors(ctx.data, t)) {
      ls = S.taskLists(ctx.data, a);
      if (ls.length) break;
    }
  }
  names = ls.length ? ls.map((l) => l.name) : [INBOX_NAME];
  ctx.lists.set(t.id, names);
  return names;
}

export function priorityName(data, t) {
  return priorityLabel(S.priorityOf(data, t)) || tr('Без приоритета');
}

export function deviceName(data, id) {
  if (!id) return '—';
  const d = data.devices?.get(id);
  return d && d.name ? d.name : id.slice(0, 8);
}

const eventDate = (ctx, t, kind) => localDateOf(eventTime(t, kind), ctx.tz);
const weekdayOf = (date) => WEEKDAY_SHORT[isoWeekday(date) - 1];
const notesText = (t) => liveNotes(t).map((n) => n.text || '').join('\n');

function hasFlag(ctx, t, key) {
  switch (key) {
    case 'note': return liveNotes(t).some((n) => (n.text || '').trim());
    case 'file': return liveNotes(t).some((n) => liveAttachments(n).length) || (t.attachments || []).some((a) => !a.deletedAt);
    case 'reminder': return (t.reminders || []).some((r) => !r.deletedAt);
    case 'repeat': return !!t.repeat;
    case 'subtasks': return (ctx.kids.get(t.id) || []).length > 0;
    case 'parent': return !!S.parentOf(ctx.data, t);
    case 'deadline': return !!t.deadlineDate;
    case 'plan': return !!t.scheduledDate || !!t.repeat;
    case 'focus': return (t.focusSessions || []).some((s) => !s.deletedAt);
    default: return false;
  }
}

/** Дата (ГГГГ-ММ-ДД) против значения: «нет»/«есть», «сегодня»/«вчера»/«завтра», >, <, >=, <=, маска, начало (2026-10). */
function dateMatch(ctx, date, value) {
  const v = value.toLowerCase();
  if (NO.includes(v)) return !date;
  if (YES.includes(v)) return !!date;
  if (!date) return false;
  const named = { 'сегодня': 0, today: 0, 'вчера': -1, yesterday: -1, 'завтра': 1, tomorrow: 1 };
  if (v in named) return date === addDays(ctx.today, named[v]);
  const cmp = /^(>=|<=|>|<)(.+)$/.exec(v);
  if (cmp) {
    const [, op, d] = cmp;
    // «>2026-10» — после октября целиком, «<=2026-10» — по октябрь включительно
    if (op === '>') return date > d && !date.startsWith(d);
    if (op === '<') return date < d;
    return op === '>=' ? date >= d : date <= d || date.startsWith(d);
  }
  return v.includes('*') ? textMatch(date, v) : date.startsWith(v);
}

/** Значения поля у задачи — для топа и для подсветки. */
export function fieldValues(ctx, t, field, kind) {
  switch (field) {
    case 'список': return listNames(ctx, t);
    case 'приоритет': return [priorityName(ctx.data, t)];
    case 'статус': return [STATUS_LABEL[statusOf(t)]];
    case 'день': return [weekdayOf(eventDate(ctx, t, kind))];
    case 'устройство': return [deviceName(ctx.data, t.updatedBy)];
    case 'дата': return [eventDate(ctx, t, kind)];
    case 'повтор': return [repeatGroup(t)];
    default: return [];
  }
}

/** Группа повтора для топа: «по дням», «по неделям», «по месяцам», «по годам» или «без повтора». */
export function repeatGroup(t) {
  const c = ruleCategory(t.repeat);
  return c ? CATEGORIES.find((x) => x.key === c).label.toLowerCase() : tr('без повтора');
}

/** «повтор:годы», «повтор:нет», «повтор:есть», «повтор:март» (по тексту правила: «каждый год 8 марта»). */
function repeatMatch(t, value) {
  const v = value.toLowerCase();
  if (NO.includes(v) || v === 'без повтора' || v === tr('без повтора')) return !t.repeat;
  if (YES.includes(v)) return !!t.repeat;
  if (!t.repeat) return false;
  const cat = CATEGORIES.find((c) => c.aliases.includes(v) || c.label.toLowerCase() === v || c.label.toLowerCase().replace('по ', '').replace('by ', '') === v);
  if (cat) return ruleCategory(t.repeat) === cat.key;
  return v.includes('*') ? textMatch(describeRule(t.repeat), value) : textContains(describeRule(t.repeat), value);
}

/** Одно условие против задачи. */
export function matchTerm(ctx, t, { field, value }, kind) {
  switch (field) {
    case null: return textContains(t.title, value) || textContains(notesText(t), value);
    case 'название': return textContains(t.title, value);
    case 'заметка': return textContains(notesText(t), value);
    case 'список': return listNames(ctx, t).some((n) => textMatch(n, value))
      || (['inbox', 'входящие', INBOX_NAME.toLowerCase()].includes(value.toLowerCase()) && listNames(ctx, t)[0] === INBOX_NAME);
    case 'приоритет': return textMatch(priorityName(ctx.data, t), value);
    case 'статус': {
      const v = value.toLowerCase();
      const key = Object.keys(STATUS_ALIASES).find((k) => STATUS_ALIASES[k].includes(v));
      return key ? statusOf(t) === key : textMatch(STATUS_LABEL[statusOf(t)], value);
    }
    case 'дата': return dateMatch(ctx, eventDate(ctx, t, kind), value);
    case 'план': return t.repeat ? YES.includes(value.toLowerCase()) : dateMatch(ctx, t.scheduledDate, value); // у повтора своей даты нет
    case 'срок': return dateMatch(ctx, t.deadlineDate, value);
    case 'повтор': return repeatMatch(t, value);
    case 'день': {
      const i = isoWeekday(eventDate(ctx, t, kind)) - 1;
      const v = value.toLowerCase();
      return textMatch(WEEKDAY_SHORT[i], value) || (v.length >= 2 && WEEKDAY_LONG[i].startsWith(v));
    }
    case 'есть': {
      const v = value.toLowerCase();
      const key = Object.keys(HAS).find((k) => HAS[k].includes(v));
      return key ? hasFlag(ctx, t, key) : false;
    }
    case 'устройство': return textMatch(deviceName(ctx.data, t.updatedBy), value) || t.updatedBy === value;
    default: return false;
  }
}

/** Разобрать строку (QueryError — с понятным текстом). */
export const compile = (q) => parseQuery(q, FIELDS);

// ---------- Диапазон времени (siem.range.*) ----------

export const RANGES = ['24h', '7d', '30d', '90d', '365d', 'all'];
export const RANGE_LABEL = { '24h': tr('За сутки'), '7d': tr('За 7 дней'), '30d': tr('За 30 дней'), '90d': tr('За 90 дней'), '365d': tr('За год'), all: tr('За всё время') };
const RANGE_MS = { '24h': 864e5, '7d': 7 * 864e5, '30d': 30 * 864e5, '90d': 90 * 864e5, '365d': 365 * 864e5 };
export const rangeFrom = (key, nowMs = Date.now()) => (key === 'all' ? null : new Date(nowMs - RANGE_MS[key]).toISOString());

/** Поиск: { rows, error }. Неверная строка — пустой результат и текст ошибки (как SEARCH_SYNTAX в ответе сервера). */
export function search(ctx, kind, { q = '', from = null } = {}) {
  let node = null;
  try {
    node = compile(q);
  } catch (e) {
    return { rows: [], error: e.message };
  }
  const rows = rowsOf(ctx.data, kind).filter((t) => (!from || eventTime(t, kind) >= from)
    && evaluate(node, (term) => matchTerm(ctx, t, term, kind)));
  return { rows, error: null };
}

/** Топ значений по полям — по уже отфильтрованным задачам (как stats с тем же q). */
export function facets(ctx, rows, kind, limit = 8) {
  return KINDS[kind].facets.map((field) => {
    const counts = new Map();
    for (const t of rows) for (const v of fieldValues(ctx, t, field, kind)) counts.set(v, (counts.get(v) || 0) + 1);
    const values = [...counts].map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : 1)).slice(0, limit);
    return { field, values };
  });
}

// ---------- Гистограмма ----------

const HOUR = 3600000;

/** Шаг гистограммы под длину диапазона (histogramInterval сервера + «30 дней» для долгих архивов). */
export function histogramInterval(fromMs, toMs) {
  const span = toMs - fromMs;
  if (span <= 3 * HOUR) return { ms: 5 * 60000, label: tr('5 минут') };
  if (span <= 2 * 24 * HOUR) return { ms: HOUR, label: tr('1 час') };
  if (span <= 14 * 24 * HOUR) return { ms: 6 * HOUR, label: tr('6 часов') };
  if (span <= 90 * 24 * HOUR) return { ms: 24 * HOUR, label: tr('1 день') };
  if (span <= 730 * 24 * HOUR) return { ms: 7 * 24 * HOUR, label: tr('7 дней') };
  return { ms: 30 * 24 * HOUR, label: tr('30 дней') };
}

/**
 * Столбики по времени события. from — начало диапазона (ISO) или null (тогда — от самой ранней задачи).
 * Границы шагов по местному времени устройства: «день» — с полуночи.
 */
export function histogram(rows, kind, from, nowMs = Date.now()) {
  const times = rows.map((t) => Date.parse(eventTime(t, kind))).filter(Number.isFinite);
  let fromMs = from ? Date.parse(from) : times.length ? Math.min(...times) : nowMs - 30 * 864e5;
  if (nowMs - fromMs < HOUR) fromMs = nowMs - HOUR;
  const interval = histogramInterval(fromMs, nowMs);
  const offset = -new Date(fromMs).getTimezoneOffset() * 60000;
  const align = (ms) => Math.floor((ms + offset) / interval.ms) * interval.ms - offset;
  const start = align(fromMs);
  const n = Math.min(400, Math.floor((nowMs - start) / interval.ms) + 1);
  const buckets = Array.from({ length: n }, (_, i) => ({ start: start + i * interval.ms, count: 0 }));
  for (const ms of times) {
    const i = Math.floor((align(ms) - start) / interval.ms);
    if (i >= 0 && i < n) buckets[i].count++;
  }
  return { interval: interval.label, ms: interval.ms, buckets };
}

// ---------- Массовые действия ----------

/** Почему элемент не прошёл массовую операцию (toastBulkResult: «сколько прошло, сколько нет и почему»). */
export const BULK_REASONS = {
  NOT_FOUND: tr('задача уже удалена'),
  ALREADY_DONE: tr('уже выполнены'),
  NOT_DONE: tr('ещё не выполнены'),
  IN_TRASH: tr('лежат в корзине'),
  NOT_IN_TRASH: tr('не в корзине'),
  REPEATING: tr('повторяющиеся — их отмечают по одной'),
  UNCHANGED: tr('и так такие'),
};

/** Итог массового действия одной строкой. */
export function bulkSummary(result, verb = tr('Готово')) {
  if (!result.failed.length) return `${verb}: ${result.succeeded}`;
  const byCode = new Map();
  for (const f of result.failed) byCode.set(f.code, (byCode.get(f.code) || 0) + 1);
  const why = [...byCode].map(([code, n]) => `${BULK_REASONS[code] || code} (${n})`).join(', ');
  return tr('{verb}: {succeeded} из {total}. Не подошли: {why}', { verb, succeeded: result.succeeded, total: result.total, why });
}
