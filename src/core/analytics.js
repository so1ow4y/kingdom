// Аналитика (обновление 0.3, п. 2.9): периоды, выполненные и монеты по дням, разбивки, лучший день, серии,
// тепловая карта. Чистые функции — графики рисует ui/screens/Analytics.js (SVG без библиотек).

import { localDateOf, addDays, daysBetween, mondayOf } from './dates.js';
import { doneByDay, streaks } from './game.js';
import { doneEntries } from './retention.js';
import { PRIORITY_NONE_ID } from './priorities.js';
import { tr } from './i18n.js';
import { priorityLabel } from './priorities.js';

export const PERIODS = [
  { id: '7d', label: tr('7 дней'), days: 7 },
  { id: '30d', label: tr('30 дней'), days: 30 },
  { id: '3m', label: tr('3 месяца'), days: 91 },
  { id: '1y', label: tr('Год'), days: 365 },
  { id: 'all', label: tr('Всё время') },
  { id: 'custom', label: tr('Свой') },
];

/** Первый день с выполненной задачей или начислением (для «Всё время»). */
function firstActiveDay(data, tz, today) {
  let first = today;
  for (const d of doneByDay(data, tz).keys()) if (d < first) first = d;
  for (const e of data.coinEvents.values()) {
    if (!e.deletedAt && e.at) {
      const d = localDateOf(e.at, tz);
      if (d < first) first = d;
    }
  }
  return first;
}

/** → { from, to } (включительно). custom: { from, to } от пользователя (перепутанные — меняем местами). */
export function periodRange(id, data, tz, today, custom = null) {
  if (id === 'custom' && custom?.from && custom?.to) {
    return custom.from <= custom.to ? { from: custom.from, to: custom.to } : { from: custom.to, to: custom.from };
  }
  if (id === 'all') return { from: firstActiveDay(data, tz, today), to: today };
  const p = PERIODS.find((x) => x.id === id) || PERIODS[1];
  return { from: addDays(today, -((p.days || 30) - 1)), to: today };
}

/** Даты от from до to включительно. */
export function datesBetween(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Выполнения в диапазоне (задачи, экземпляры повторов и сводки удалённых): [{ date, listIds, priorityId }]. */
function doneItems(data, tz, from, to) {
  return doneEntries(data, tz).filter((e) => e.date >= from && e.date <= to);
}

/** Монеты по дням: сумма активных начислений (покупки — отдельно, это траты). */
function coinsByDay(data, tz, from, to) {
  const m = new Map();
  let spent = 0;
  for (const e of data.coinEvents.values()) {
    if (e.deletedAt || !e.active || !e.at) continue;
    const d = localDateOf(e.at, tz);
    if (d < from || d > to) continue;
    if (e.type === 'award') m.set(d, (m.get(d) || 0) + (e.amount | 0));
    else if (e.type === 'purchase') spent += Math.abs(e.amount | 0);
  }
  return { m, spent };
}

/**
 * Вся аналитика за период.
 * → { from, to, days, done: Map<date,n>, coins: Map<date,n>, total, totalCoins, spent, average, best: {date,n}|null,
 *     byList: [{ id, name, color, n }], byPriority: [{ id, name, color, n }], streak: { current, best } }
 */
export function analyze(data, tz, today, from, to) {
  const items = doneItems(data, tz, from, to);
  const done = new Map();
  for (const { date } of items) done.set(date, (done.get(date) || 0) + 1);
  const { m: coins, spent } = coinsByDay(data, tz, from, to);
  const days = daysBetween(from, to) + 1;

  let best = null;
  for (const [date, n] of done) if (!best || n > best.n || (n === best.n && date > best.date)) best = { date, n };
  let totalCoins = 0;
  for (const n of coins.values()) totalCoins += n;

  // По спискам: задача в нескольких списках считается в каждом; без списков — «Входящие».
  const lists = new Map();
  const pri = new Map();
  for (const e of items) {
    const ids = (e.listIds || []).filter((id) => data.lists.get(id) && !data.lists.get(id).deletedAt);
    for (const id of ids.length ? ids : [null]) lists.set(id, (lists.get(id) || 0) + 1);
    const pid = data.priorities.has(e.priorityId) ? e.priorityId : PRIORITY_NONE_ID;
    pri.set(pid, (pri.get(pid) || 0) + 1);
  }
  const byList = [...lists].map(([id, n]) => {
    const l = id ? data.lists.get(id) : null;
    return { id, name: l ? (l.emoji ? l.emoji + ' ' : '') + l.name : tr('Входящие'), color: l?.color || '#9E9E9E', n };
  }).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'ru'));
  const byPriority = [...pri].map(([id, n]) => {
    const p = data.priorities.get(id);
    return { id, name: priorityLabel(p) || tr('Без приоритета'), color: p?.color || '#9E9E9E', n, order: p?.order || '' };
  }).sort((a, b) => (a.order < b.order ? 1 : -1));

  return {
    from, to, days, done, coins, total: items.length, totalCoins, spent,
    average: items.length / days, best, byList, byPriority, streak: streaks(doneByDay(data, tz), today),
  };
}

/**
 * Группировка для столбиков: до 62 дней — по дням, до ~1,5 лет — по неделям (с понедельника), дальше — по месяцам.
 * → [{ key, label, from, to, value }]
 */
export function buckets(map, from, to) {
  const days = daysBetween(from, to) + 1;
  const unit = days <= 62 ? 'day' : days <= 550 ? 'week' : 'month';
  const out = [];
  const keyOf = (d) => (unit === 'day' ? d : unit === 'week' ? mondayOf(d) : d.slice(0, 7));
  const idx = new Map();
  for (const d of datesBetween(from, to)) {
    const k = keyOf(d);
    if (!idx.has(k)) {
      idx.set(k, out.length);
      out.push({ key: k, from: d, to: d, value: 0 });
    }
    const b = out[idx.get(k)];
    b.to = d;
    b.value += map.get(d) || 0;
  }
  return { unit, items: out };
}

/** Уровень яркости клетки 0…4 относительно максимума за период (как на GitHub). */
export function heatLevel(n, max) {
  if (!n) return 0;
  if (max <= 4) return Math.min(4, n);
  return Math.min(4, Math.ceil((n / max) * 4));
}

/** Сетка тепловой карты: столбцы — недели (Пн…Вс сверху вниз). Дни вне периода — null. */
export function heatGrid(from, to) {
  const start = mondayOf(from);
  const weeks = [];
  for (let w = start; w <= to; w = addDays(w, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => {
      const d = addDays(w, i);
      return d < from || d > to ? null : d;
    }));
  }
  return weeks;
}

