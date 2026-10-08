// Даты без времени — строки 'YYYY-MM-DD' в часовом поясе settings.timeZone («плавающие»).
// Арифметика идёт в UTC, чтобы переход на летнее время не сдвигал дни.

const DAY_MS = 86400000;
const fmtCache = new Map();

function partsFormatter(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

function partsIn(tz, date) {
  const p = {};
  for (const { type, value } of partsFormatter(tz).formatToParts(date)) p[type] = value;
  return p;
}

export function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function isValidTimeZone(tz) {
  try {
    partsFormatter(tz);
    return true;
  } catch {
    fmtCache.delete(tz);
    return false;
  }
}

export function allTimeZones() {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return [deviceTimeZone()];
  }
}

/** Сегодняшняя дата в поясе tz. */
export function todayIn(tz, now = new Date()) {
  const p = partsIn(tz, now);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Текущее время 'HH:MM' в поясе tz. */
export function nowTimeIn(tz, now = new Date()) {
  const p = partsIn(tz, now);
  return `${p.hour}:${p.minute}`;
}

/** ISO-момент → локальная дата в поясе tz. */
export function localDateOf(iso, tz) {
  return todayIn(tz, new Date(iso));
}

/**
 * Локальные дата 'YYYY-MM-DD' и время 'HH:MM' в поясе tz → момент (мс).
 * Несуществующее время (переход на летнее) сдвигается вперёд, повторяющееся — берётся первое.
 */
export function zonedToEpoch(date, time, tz) {
  const want = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), +time.slice(0, 2), +time.slice(3, 5));
  let t = want;
  for (let i = 0; i < 3; i++) {
    const p = partsIn(tz, new Date(t));
    const seen = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    if (seen === want) break;
    t += want - seen;
  }
  return t;
}

/** ISO-момент → 'DD.MM.YYYY HH:MM' в поясе tz. */
export function formatMoment(iso, tz) {
  const p = partsIn(tz, new Date(iso));
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`;
}

export function parseDate(d) {
  return Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
}

export function formatDateUTC(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(d, n) {
  return formatDateUTC(parseDate(d) + n * DAY_MS);
}

export function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / DAY_MS);
}

/** 1 = Пн … 7 = Вс */
export function isoWeekday(d) {
  const w = new Date(parseDate(d)).getUTCDay();
  return w === 0 ? 7 : w;
}

export function mondayOf(d) {
  return addDays(d, 1 - isoWeekday(d));
}

export function weekDates(monday) {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const WEEKDAY_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export const WEEKDAY_LONG = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
const MONTH_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const MONTH_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября',
  'октября', 'ноября', 'декабря'];

export const MONTH_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь',
  'Октябрь', 'Ноябрь', 'Декабрь'];

function dm(d, months) {
  return `${+d.slice(8, 10)} ${months[+d.slice(5, 7) - 1]}`;
}

/** «Сегодня», «Завтра», «Вчера», «Ср» (в пределах 6 дней вперёд), «12 окт», «12 окт 2027». */
export function humanDate(d, today) {
  const diff = daysBetween(today, d);
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Завтра';
  if (diff === -1) return 'Вчера';
  if (diff > 1 && diff < 7) return WEEKDAY_SHORT[isoWeekday(d) - 1];
  const s = dm(d, MONTH_SHORT);
  return d.slice(0, 4) === today.slice(0, 4) ? s : `${s} ${d.slice(0, 4)}`;
}

/** «Пн, 28 сен» */
export function dayLabel(d) {
  return `${WEEKDAY_SHORT[isoWeekday(d) - 1]}, ${dm(d, MONTH_SHORT)}`;
}

/** «28 сентября» (+ год, если не текущий) */
export function longDate(d, today) {
  const s = dm(d, MONTH_GEN);
  return today && d.slice(0, 4) !== today.slice(0, 4) ? `${s} ${d.slice(0, 4)}` : s;
}

/** «02.10.2026» */
export function dotted(d) {
  return `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
}
