// Окно графика по времени (0.14): «По часам» — конкретный день, «По дням» — конкретная неделя (с понедельника),
// «По месяцам» — конкретный год; «По годам» — без окна. anchor — первый день окна ('YYYY-MM-DD'), null — весь период.
// Чистые функции: экраны лекарств и задач показывают переключатель «‹ окно ›» (ui/components/TimeWindow.js).

import { addDays, mondayOf, longDate, MONTH_NOM } from './dates.js';

/** Единица окна для группировки: day | week | year | null. */
export const windowUnit = (group) => ({ hour: 'day', day: 'week', month: 'year' })[group] || null;

/** Окно, в котором лежит дата d (сегодня — текущее). */
export function anchorOf(group, d) {
  const u = windowUnit(group);
  if (u === 'day') return d;
  if (u === 'week') return mondayOf(d);
  if (u === 'year') return d.slice(0, 4) + '-01-01';
  return null;
}

/** Границы окна { from, to } (включительно). */
export function windowRange(group, anchor) {
  const u = windowUnit(group);
  if (!anchor || !u) return null;
  if (u === 'day') return { from: anchor, to: anchor };
  if (u === 'week') return { from: anchor, to: addDays(anchor, 6) };
  return { from: anchor, to: anchor.slice(0, 4) + '-12-31' };
}

/** Соседнее окно: dir = -1 — раньше, +1 — позже. */
export function shiftWindow(group, anchor, dir) {
  const u = windowUnit(group);
  if (!anchor || !u) return anchor;
  if (u === 'day') return addDays(anchor, dir);
  if (u === 'week') return addDays(anchor, 7 * dir);
  return String(+anchor.slice(0, 4) + dir) + '-01-01';
}

/** Можно ли шагнуть вперёд: окно не позже того, где сегодня. */
export const canGoNext = (group, anchor, today) => !!anchor && anchor < anchorOf(group, today);

// пустые столбики в начале периода не показываются (у «по дням» — не меньше недели): видны сами события
const MIN_BUCKETS = { day: 7, month: 3, year: 1 };

/** Убрать пустые корзины в начале (кроме «по часам»), оставив не меньше MIN_BUCKETS. */
export function trimLead(list, group) {
  if (group === 'hour' || !MIN_BUCKETS[group]) return list;
  const first = list.findIndex((b) => Object.values(b.values).some(Boolean));
  if (first < 0) return list.slice(-MIN_BUCKETS[group]);
  return list.slice(Math.max(0, Math.min(first, list.length - MIN_BUCKETS[group])));
}

/**
 * Корзины графика по времени (0.13 — лекарства, 0.14 — и задачи): [{ key, label, title, values: { ключ ряда: число } }].
 * log — события с датой и временем ({ key: ряд, date, time, amount }), extra — итоги дней без времени ({ date, key, count, amount });
 * metric — 'count' (сколько раз) или 'amount' (сумма amount); group — hour (по часу суток за всё окно), day, month, year.
 */
export function timeBuckets({ log = [], extra = [], from, to, group = 'day', metric = 'count', keys = null }) {
  const want = (k) => !keys || keys.includes(k);
  const val = (x) => (metric === 'amount' ? x.amount || 0 : x.count ?? 1);
  const buckets = new Map();
  const order = [];
  const ensure = (key, label, title) => {
    if (!buckets.has(key)) {
      buckets.set(key, { key, label, title, values: {} });
      order.push(key);
    }
    return buckets.get(key);
  };
  if (group === 'hour') {
    for (let h = 0; h < 24; h++) ensure(String(h).padStart(2, '0'), String(h), `${String(h).padStart(2, '0')}:00–${String(h).padStart(2, '0')}:59`);
  } else if (group === 'day') {
    for (let d = from; d <= to; d = addDays(d, 1)) ensure(d, `${+d.slice(8)}.${d.slice(5, 7)}`, longDate(d, '0000')); // в подсказке — с годом
  } else if (group === 'month') {
    for (let d = from.slice(0, 7) + '-01'; d.slice(0, 7) <= to.slice(0, 7); d = addDays(d.slice(0, 7) + '-28', 4).slice(0, 7) + '-01') ensure(d.slice(0, 7), `${d.slice(5, 7)}.${d.slice(2, 4)}`, `${MONTH_NOM[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`);
  } else {
    for (let y = +from.slice(0, 4); y <= +to.slice(0, 4); y++) ensure(String(y), String(y), String(y));
  }
  const keyOf = (date, time) => (group === 'hour' ? (time ? time.slice(0, 2) : null) : group === 'day' ? date : group === 'month' ? date.slice(0, 7) : date.slice(0, 4));
  const put = (k, medKey, v) => {
    const b = k && buckets.get(k);
    if (!b) return;
    b.values[medKey] = Math.round(((b.values[medKey] || 0) + v) * 1000) / 1000;
  };
  for (const l of log) if (want(l.key)) put(keyOf(l.date, l.time), l.key, val({ count: 1, amount: l.amount }));
  if (group !== 'hour') for (const x of extra) if (want(x.key)) put(keyOf(x.date, null), x.key, val(x));
  return order.map((k) => buckets.get(k));
}
