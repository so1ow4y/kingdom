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

// ---------- 0.14: «По времени», окно графика, срок хранения выполненных ----------

test('По времени (0.14): журнал с местным временем, ряды по спискам и приоритетам, час чаще всего', async () => {
  const { doneLog, timeSeries, busiestHour, timeBuckets } = await import('../src/core/analytics.js');
  const d = makeData();
  const c = makeCtx();
  const [l1, l2] = [...d.lists.values()];
  doneTask(d, c, 'A', '2026-10-01T07:15:00.000Z', { listIds: [l1.id], priorityId: HIGH });
  doneTask(d, c, 'B', '2026-10-01T07:40:00.000Z', { listIds: [l1.id, l2.id] });
  doneTask(d, c, 'C', '2026-10-02T15:00:00.000Z');
  doneTask(d, c, 'Раньше', '2026-09-20T10:00:00.000Z');
  const log = doneLog(d, TZ, '2026-10-01', TODAY);
  assert.deepEqual(log.map((e) => [e.title, e.date, e.time]), [['C', '2026-10-02', '18:00'], ['B', '2026-10-01', '10:40'], ['A', '2026-10-01', '10:15']], 'новые сверху, время — по поясу');
  assert.equal(busiestHour(log), 10);
  const byList = timeSeries(d, log, 'list');
  assert.equal(byList.log.length, 4, 'задача в двух списках — в каждом');
  assert.equal(byList.series[0].key, l1.id);
  assert.ok(byList.series.some((s) => s.key === 'inbox'), 'без списка — «Входящие»');
  const total = timeSeries(d, log, 'total');
  assert.deepEqual(total.series.map((s) => [s.key, s.n]), [['total', 3]]);
  const hours = timeBuckets({ log: total.log, from: '2026-10-01', to: TODAY, group: 'hour' });
  assert.equal(hours[10].values.total, 2);
  const days = timeBuckets({ log: total.log, from: '2026-10-01', to: TODAY, group: 'day' });
  assert.deepEqual(days.map((b) => b.values.total || 0), [2, 1]);
  assert.equal(timeSeries(d, log, 'priority').series.find((s) => s.key === HIGH).n, 1);
});

test('Окно графика (0.14): день, неделя с понедельника, год; стрелки; пустое начало обрезается', async () => {
  const TW = await import('../src/core/timeWindow.js');
  assert.equal(TW.anchorOf('hour', '2026-10-09'), '2026-10-09');
  assert.equal(TW.anchorOf('day', '2026-10-09'), '2026-10-05', 'неделя — с понедельника');
  assert.equal(TW.anchorOf('month', '2026-10-09'), '2026-01-01');
  assert.equal(TW.anchorOf('year', '2026-10-09'), null, 'по годам — без окна');
  assert.deepEqual(TW.windowRange('day', '2026-10-05'), { from: '2026-10-05', to: '2026-10-11' });
  assert.deepEqual(TW.windowRange('month', '2025-01-01'), { from: '2025-01-01', to: '2025-12-31' });
  assert.equal(TW.shiftWindow('day', '2026-10-05', -1), '2026-09-28');
  assert.equal(TW.shiftWindow('month', '2026-01-01', -1), '2025-01-01');
  assert.equal(TW.shiftWindow('hour', '2026-03-01', -1), '2026-02-28');
  assert.ok(!TW.canGoNext('day', '2026-10-05', '2026-10-09'), 'текущая неделя — дальше нельзя');
  assert.ok(TW.canGoNext('day', '2026-09-28', '2026-10-09'));
  const list = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((k, i) => ({ key: k, values: i === 8 ? { x: 1 } : {} }));
  assert.equal(TW.trimLead(list, 'day').length, 7, 'по дням — не меньше недели');
  assert.equal(TW.trimLead(list, 'month')[0].key, 'h', 'по месяцам — не меньше трёх');
  assert.equal(TW.trimLead(list, 'hour').length, 10, 'по часам не обрезается');
});

test('Срок хранения выполненных (0.14): старше срока — удаляются со сводкой, без срока — только лимит', async () => {
  const RT = await import('../src/core/retention.js');
  const d = makeData();
  const c = makeCtx();
  const now = Date.parse('2026-10-02T09:00:00.000Z');
  doneTask(d, c, 'Старая', '2026-08-01T10:00:00.000Z');
  doneTask(d, c, 'Свежая', '2026-09-30T10:00:00.000Z');
  assert.equal(RT.retentionPlan(d, now).count, 0, 'срока нет, лимит не превышен');
  assert.equal(RT.completedDaysOf({ completedDays: 3 }), 7, 'не меньше недели');
  assert.equal(RT.completedDaysOf({ completedDays: null }), null);
  d.settings = { ...d.settings, completedDays: 30 };
  const plan = RT.retentionPlan(d, now);
  assert.equal(plan.count, 1);
  assert.equal(plan.days, 30);
  const changes = RT.applyPurge(d, plan, c);
  assert.ok(changes.some((x) => x.coll === 'doneArchive'), 'статистика остаётся в сводке');
});
