// Аналитика: периоды, подсчёты по дням, разбивки, группировка столбиков, тепловая карта (п. 2.9).

import { test, assert } from './runner.js';
import { makeCtx, makeData, addTask } from './helpers.js';
import { periodRange, analyze, buckets, heatLevel, heatGrid, datesBetween } from '../src/core/analytics.js';
import { awardEvent } from '../src/core/game.js';
import { setListMembership } from '../src/core/model.js';

const TZ = 'Europe/Moscow';
const TODAY = '2026-10-02';
const HIGH = '00000000-0000-7000-8000-000000000203';

function doneTask(d, c, title, completedAt, input = {}) {
  const t = addTask(d, c, { title, ...input }, { status: 'done', completedAt });
  const e = awardEvent(d, t, null, { ...c, now: Date.parse(completedAt) });
  d.coinEvents.set(e.id, e);
  return t;
}

test('периоды: 7 дней включают сегодня, свой диапазон переворачивается, «всё время» — с первого дня', () => {
  const d = makeData();
  const c = makeCtx();
  assert.deepEqual(periodRange('7d', d, TZ, TODAY), { from: '2026-09-26', to: TODAY });
  assert.deepEqual(periodRange('custom', d, TZ, TODAY, { from: '2026-09-10', to: '2026-09-01' }), { from: '2026-09-01', to: '2026-09-10' });
  doneTask(d, c, 'Старая', '2026-03-15T10:00:00.000Z');
  assert.equal(periodRange('all', d, TZ, TODAY).from, '2026-03-15');
});

test('analyze: по дням, монеты, лучший день, среднее, разбивки по спискам и приоритетам', () => {
  const d = makeData();
  const c = makeCtx();
  const list = [...d.lists.values()][0];
  doneTask(d, c, 'A', '2026-10-01T10:00:00.000Z', { priorityId: HIGH, listIds: [list.id] });
  doneTask(d, c, 'B', '2026-10-01T12:00:00.000Z');
  doneTask(d, c, 'C', '2026-10-02T08:00:00.000Z');
  doneTask(d, c, 'Вне периода', '2026-09-01T08:00:00.000Z');
  addTask(d, c, { title: 'Не выполнена' });
  const a = analyze(d, TZ, TODAY, '2026-09-26', TODAY);
  assert.equal(a.total, 3);
  assert.equal(a.done.get('2026-10-01'), 2);
  assert.deepEqual(a.best, { date: '2026-10-01', n: 2 });
  assert.equal(a.days, 7);
  assert.equal(a.average, 3 / 7);
  assert.equal(a.totalCoins, 10 + 1 + 1);
  assert.equal(a.byList.find((x) => x.id === list.id).n, 1);
  assert.equal(a.byList.find((x) => x.id === null).n, 2);
  assert.equal(a.byPriority.find((x) => x.id === HIGH).n, 1);
  assert.equal(a.streak.current, 2);
});

test('задача в двух списках считается в каждом', () => {
  const d = makeData();
  const c = makeCtx();
  const [l1, l2] = [...d.lists.values()];
  let t = doneTask(d, c, 'A', '2026-10-01T10:00:00.000Z', { listIds: [l1.id] });
  t = setListMembership(t, l2.id, true, c);
  d.tasks.set(t.id, t);
  const a = analyze(d, TZ, TODAY, '2026-09-26', TODAY);
  assert.equal(a.byList.length, 2);
  assert.equal(a.total, 1);
});

test('buckets: дни до 62, недели до ~1,5 лет, потом месяцы; суммы сохраняются', () => {
  const m = new Map([['2026-10-01', 2], ['2026-09-01', 3]]);
  const short = buckets(m, '2026-09-26', TODAY);
  assert.equal(short.unit, 'day');
  assert.equal(short.items.length, 7);
  const mid = buckets(m, '2026-07-01', TODAY);
  assert.equal(mid.unit, 'week');
  assert.equal(mid.items.reduce((s, b) => s + b.value, 0), 5);
  const long = buckets(m, '2024-01-01', TODAY);
  assert.equal(long.unit, 'month');
  assert.equal(long.items.at(-1).key, '2026-10');
});

test('тепловая карта: столбцы по неделям с понедельника, уровни 0…4', () => {
  const g = heatGrid('2026-09-30', '2026-10-06'); // ср … вт
  assert.equal(g.length, 2);
  assert.equal(g[0][0], null); // пн 28.09 — вне периода
  assert.equal(g[0][2], '2026-09-30');
  assert.equal(g[1][1], '2026-10-06');
  assert.equal(g[1][2], null);
  assert.equal(heatLevel(0, 10), 0);
  assert.equal(heatLevel(10, 10), 4);
  assert.equal(heatLevel(1, 10), 1);
  assert.equal(heatLevel(3, 3), 3);
  assert.equal(datesBetween('2026-09-30', '2026-10-02').length, 3);
});
