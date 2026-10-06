// Повторяющиеся задачи (обновление 0.9; правило и алгоритм — DATA_FORMAT §5.3.4, §5.3.6, §5.4). Чистые функции.
//
// У повторяющейся задачи scheduledDate = deadlineDate = null; её дата — текущий экземпляр по правилу repeat
// и словарю occurrences (ключ — исходная дата экземпляра). Закрыть экземпляр = occurrences[key].state = done;
// пропущенные раньше экземпляры не копятся: текущим становится последний незакрытый до сегодня (или ближайший после).

import { addDays, daysBetween, isoWeekday, mondayOf, localDateOf, WEEKDAY_SHORT } from './dates.js';

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => [Number(d.slice(0, 4)), Number(d.slice(5, 7)), Number(d.slice(8, 10))];
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthsBetween = (a, b) => {
  const [y1, m1] = ymd(a);
  const [y2, m2] = ymd(b);
  return (y2 - y1) * 12 + (m2 - m1);
};

/** Подходит ли дата d под правило (режим schedule). */
export function matches(rule, d) {
  if (!rule || d < rule.startDate || (rule.until && d > rule.until)) return false;
  const n = Math.max(1, rule.interval | 0 || 1);
  if (rule.freq === 'daily') return daysBetween(rule.startDate, d) % n === 0;
  if (rule.freq === 'weekly') {
    const days = rule.byWeekday?.length ? rule.byWeekday : [isoWeekday(rule.startDate)];
    if (!days.includes(isoWeekday(d))) return false;
    return (daysBetween(mondayOf(rule.startDate), mondayOf(d)) / 7) % n === 0;
  }
  if (rule.freq === 'monthly') {
    const [y, m, day] = ymd(d);
    const want = Math.min(rule.byMonthDay || ymd(rule.startDate)[2], daysInMonth(y, m));
    return day === want && monthsBetween(rule.startDate, d) % n === 0;
  }
  return false;
}

const isClosed = (o) => !!o && (o.state === 'done' || o.state === 'skipped');

/** Самый поздний закрытый ключ или null. */
export function lastClosedKey(task) {
  let best = null;
  for (const [k, o] of Object.entries(task.occurrences || {})) if (isClosed(o) && (!best || k > best)) best = k;
  return best;
}

function addInterval(d, freq, n) {
  if (freq === 'daily') return addDays(d, n);
  if (freq === 'weekly') return addDays(d, 7 * n);
  const [y, m, day] = ymd(d);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(day, daysInMonth(ny, nm)))}`;
}

/** Ключ текущего экземпляра (исходная дата) или null, если серия завершена. tz — для режима «от даты выполнения». */
export function currentKey(task, today, tz = 'UTC') {
  const rule = task?.repeat;
  if (!rule) return null;
  const occ = task.occurrences || {};
  const last = lastClosedKey(task);
  if (rule.mode === 'afterCompletion') {
    if (!last) return rule.startDate;
    const base = occ[last].doneAt ? localDateOf(occ[last].doneAt, tz) : last;
    let key = addInterval(base, rule.freq, Math.max(1, rule.interval | 0 || 1));
    const after = addDays(last, 1);
    if (key < after) key = after;
    return rule.until && key > rule.until ? null : key;
  }
  const lo = last ? addDays(last, 1) : rule.startDate;
  // последний подходящий день от lo до сегодня (пропущенные раньше не копятся)
  if (lo <= today) {
    let d = today;
    for (let i = 0; i < 3700 && d >= lo; i++, d = addDays(d, -1)) if (matches(rule, d) && !isClosed(occ[d])) return d;
  }
  // иначе ближайший будущий
  let d = lo > today ? lo : addDays(today, 1);
  const end = addDays(today, 366 * 3);
  for (let i = 0; i < 1200 && d <= end; i++, d = addDays(d, 1)) if (matches(rule, d) && !isClosed(occ[d])) return d;
  return null;
}

/** Эффективная дата экземпляра (с учётом переноса). */
export const effDate = (task, key) => (key ? task.occurrences?.[key]?.date || key : null);

/** Дата текущего экземпляра (или null). */
export function dueDate(task, today, tz) {
  return effDate(task, currentKey(task, today, tz));
}

/** Ближайшие даты экземпляров для показа: начиная с текущего, до n штук (для schedule). */
export function upcoming(task, today, n = 3, tz = 'UTC') {
  const key = currentKey(task, today, tz);
  if (!key) return [];
  const out = [effDate(task, key)];
  if (task.repeat.mode === 'afterCompletion') return out;
  let d = addDays(key, 1);
  for (let i = 0; i < 800 && out.length < n; i++, d = addDays(d, 1)) if (matches(task.repeat, d) && !isClosed(task.occurrences?.[d])) out.push(effDate(task, d));
  return out;
}

/** Новое значение occurrences[key] (метка t и устройство by — для слияния по ключу). */
function occ(task, key, patch, ctx) {
  const cur = task.occurrences?.[key] || { state: 'open', doneAt: null, date: null, time: null };
  return { ...cur, ...patch, t: ctx.stamp(), by: ctx.deviceId };
}

const bumped = (task, ctx) => ({ ...task, updatedAt: new Date(ctx.now).toISOString(), updatedBy: ctx.deviceId });

/** Закрыть экземпляр key: state = done (или skipped). */
export function closeOccurrence(task, key, ctx, state = 'done') {
  return { ...bumped(task, ctx), occurrences: { ...(task.occurrences || {}), [key]: occ(task, key, { state, doneAt: new Date(ctx.now).toISOString() }, ctx) } };
}

/** Отменить закрытие экземпляра. */
export function reopenOccurrence(task, key, ctx) {
  return { ...bumped(task, ctx), occurrences: { ...(task.occurrences || {}), [key]: occ(task, key, { state: 'open', doneAt: null }, ctx) } };
}

/** Правило из простых настроек интерфейса: { kind: daily|weekly|monthly|every, weekdays, monthDay, interval, mode }. */
export function makeRule({ kind = 'daily', weekdays = null, monthDay = null, interval = 1, mode = 'schedule' }, startDate) {
  const base = { interval: 1, byWeekday: null, byMonthDay: null, mode, startDate, until: null, resetSubtasks: true };
  if (kind === 'weekly') {
    const days = [...new Set((weekdays?.length ? weekdays : [isoWeekday(startDate)]).map(Number))].filter((x) => x >= 1 && x <= 7).sort((a, b) => a - b);
    return { ...base, freq: 'weekly', byWeekday: mode === 'schedule' ? days : null };
  }
  if (kind === 'monthly') return { ...base, freq: 'monthly', byMonthDay: mode === 'schedule' ? Math.max(1, Math.min(31, monthDay | 0 || ymd(startDate)[2])) : null };
  if (kind === 'every') return { ...base, freq: 'daily', interval: Math.max(1, Math.min(365, interval | 0 || 2)) };
  return { ...base, freq: 'daily' };
}

/** Простой вид правила для редактора: { kind, weekdays, monthDay, interval }. */
export function ruleKind(rule) {
  if (!rule) return { kind: 'none', weekdays: [], monthDay: null, interval: 2 };
  if (rule.freq === 'weekly') return { kind: 'weekly', weekdays: rule.byWeekday || [isoWeekday(rule.startDate)], monthDay: null, interval: rule.interval };
  if (rule.freq === 'monthly') return { kind: 'monthly', weekdays: [], monthDay: rule.byMonthDay || ymd(rule.startDate)[2], interval: rule.interval };
  if ((rule.interval | 0) > 1) return { kind: 'every', weekdays: [], monthDay: null, interval: rule.interval };
  return { kind: 'daily', weekdays: [], monthDay: null, interval: 1 };
}

/** «каждый день», «по Пн, Ср, Пт», «каждый месяц 15-го», «каждые 3 дня», «каждые 2 недели (Пн)». */
export function describeRule(rule) {
  if (!rule) return '';
  const n = Math.max(1, rule.interval | 0 || 1);
  const after = rule.mode === 'afterCompletion' ? ' от выполнения' : '';
  if (rule.freq === 'daily') return n === 1 ? 'каждый день' + after : `каждые ${n} ${n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'дня' : 'дней'}${after}`;
  if (rule.freq === 'weekly') {
    const days = rule.byWeekday?.length ? rule.byWeekday : [isoWeekday(rule.startDate)];
    const list = days.length === 7 ? 'каждый день' : days.length === 5 && days.join() === '1,2,3,4,5' ? 'по будням' : days.length === 2 && days.join() === '6,7' ? 'по выходным' : 'по ' + days.map((d) => WEEKDAY_SHORT[d - 1]).join(', ');
    return n === 1 ? list + after : `${list}, раз в ${n} нед.${after}`;
  }
  if (rule.freq === 'monthly') {
    const day = rule.byMonthDay || ymd(rule.startDate)[2];
    return n === 1 ? `каждый месяц ${day}-го${after}` : `раз в ${n} мес. ${day}-го${after}`;
  }
  return 'повтор';
}
