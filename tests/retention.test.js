// Лимит хранения выполненных (обновление 0.5): что удаляется, сводки, статистика не меняется и не задваивается.

import { test, assert } from './runner.js';
import { makeCtx, makeData, addTask } from './helpers.js';
import { purgePlan, applyPurge, doneCount, doneEntries } from '../src/core/retention.js';
import { doneByDay, gameStats, balance, awardEvent } from '../src/core/game.js';
import { analyze } from '../src/core/analytics.js';
import { mergeData, MERGE_COLLECTIONS } from '../src/core/merge.js';
import { touch } from '../src/core/model.js';
import { canonicalJson } from '../src/core/canonical.js';
import { DEFAULT_LISTS } from '../src/config.js';

const TZ = 'Europe/Moscow';
const NOW = Date.parse('2026-10-03T12:00:00.000Z');
const TODAY = '2026-10-03';
const [L1, L2] = DEFAULT_LISTS.map((l) => l.id);
const HIGH = '00000000-0000-7000-8000-000000000203';
const day = (n) => new Date(NOW - n * 86400000).toISOString();

/** База: n выполненных задач по одной в день (i дней назад), с монетами; плюс дерево и активная задача. */
function sample(n = 20) {
  const c = makeCtx(NOW);
  const d = makeData();
  for (let i = 1; i <= n; i++) {
    const t = addTask(d, c, { title: 'T' + i, listIds: [i % 2 ? L1 : L2], priorityId: i % 3 ? undefined : HIGH, order: 'a' + i },
      { status: 'done', completedAt: day(i) });
    const e = awardEvent(d, t, null, { ...c, now: Date.parse(day(i)) });
    d.coinEvents.set(e.id, e);
  }
  // Дерево: родитель выполнен давно, подзадача выполнена давно → удаляется целиком
  const p = addTask(d, c, { title: 'P', order: 'b1' }, { status: 'done', completedAt: day(30) });
  addTask(d, c, { title: 'P.1', parentId: p.id, order: 'b2' }, { status: 'done', completedAt: day(30) });
  // Дерево с невыполненной подзадачей — не трогаем
  const q = addTask(d, c, { title: 'Q', order: 'b3' }, { status: 'done', completedAt: day(40) });
  addTask(d, c, { title: 'Q.1', parentId: q.id, order: 'b4' });
  addTask(d, c, { title: 'Активная', order: 'b5' });
  return { c, d };
}

const toArrays = (d) => {
  const out = { settings: [d.settings] };
  for (const k of MERGE_COLLECTIONS) if (k !== 'settings') out[k] = [...d[k].values()];
  return out;
};
const fromArrays = (a) => {
  const d = { settings: a.settings[0] };
  for (const k of MERGE_COLLECTIONS) if (k !== 'settings') d[k] = new Map((a[k] || []).map((x) => [x.id, x]));
  return d;
};
const apply = (d, changes) => {
  for (const ch of changes) d[ch.coll].set(ch.next.id, ch.next);
  return d;
};
const stats = (d) => {
  const a = analyze(d, TZ, TODAY, '2026-01-01', TODAY);
  const g = gameStats(d, TZ, TODAY);
  return canonicalJson({
    byDay: [...doneByDay(d, TZ)].sort(), total: a.total, coins: a.totalCoins, byList: a.byList, byPriority: a.byPriority,
    best: a.best, streak: a.streak, done: g.done, xp: g.xp, level: g.level, balance: balance(d), ach: g.achievements.map((x) => x.unlocked),
  });
};

test('purgePlan: сверх лимита, самые старые; последние 7 дней и деревья с невыполненным не трогаются', () => {
  const { d } = sample(20);
  assert.equal(doneCount(d), 23); // 20 + P + P.1 + Q
  const plan = purgePlan(d, 10, NOW);
  assert.equal(plan.over, 13);
  const ids = plan.trees.flatMap((t) => t.ids).map((id) => d.tasks.get(id).title);
  assert.ok(!ids.includes('Q') && !ids.includes('Q.1'), 'дерево с невыполненной подзадачей остаётся');
  assert.ok(ids.includes('P') && ids.includes('P.1'), 'дерево удаляется целиком');
  for (let i = 1; i <= 7; i++) assert.ok(!ids.includes('T' + i), `выполненная ${i} дн. назад остаётся`);
  assert.ok(!ids.includes('P.1') || ids.indexOf('P') >= 0);
  assert.equal(purgePlan(d, null, NOW).trees.length, 0, 'лимит выключен');
  assert.equal(purgePlan(d, 1000, NOW).trees.length, 0, 'меньше лимита');
});

test('applyPurge: минимальные надгробия, сводки; статистика, монеты и уровни не меняются', () => {
  const { c, d } = sample(20);
  const before = stats(d);
  const plan = purgePlan(d, 10, NOW);
  const ch = applyPurge(d, plan, c);
  apply(d, ch);
  const tombs = ch.filter((x) => x.coll === 'tasks').map((x) => x.next);
  assert.equal(tombs.length, plan.count);
  for (const t of tombs) assert.deepEqual(Object.keys(t).sort(), ['createdAt', 'deletedAt', 'fieldTimes', 'id', 'updatedAt', 'updatedBy']);
  assert.equal(ch.filter((x) => x.coll === 'doneArchive').length, plan.count);
  assert.equal(doneCount(d), 23 - plan.count);
  assert.equal(stats(d), before, 'аналитика, серии, уровни, монеты, достижения — прежние');
  assert.ok(canonicalJson(toArrays(d)).length < canonicalJson(toArrays(sample(20).d)).length, 'база меньше');
});

test('два устройства чистят независимо (разные лимиты) — после слияния те же числа, без двойного счёта', () => {
  const base = sample(20);
  const before = stats(base.d);
  const A = fromArrays(structuredClone(toArrays(base.d)));
  const B = fromArrays(structuredClone(toArrays(base.d)));
  const cA = makeCtx(NOW + 1000);
  const cB = { ...makeCtx(NOW + 2000), deviceId: 'devB' };
  apply(A, applyPurge(A, purgePlan(A, 10, NOW), cA));
  apply(B, applyPurge(B, purgePlan(B, 15, NOW), cB));
  const AB = fromArrays(mergeData(toArrays(A), toArrays(B)));
  const BA = fromArrays(mergeData(toArrays(B), toArrays(A)));
  assert.equal(stats(AB), before);
  assert.equal(canonicalJson(toArrays(AB)), canonicalJson(toArrays(BA)), 'слияние коммутативно');
  // Одна и та же задача, удалённая на обоих, — одна сводка
  const ids = doneEntries(AB, TZ).map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('задача «воскресла» на другом устройстве (правка после удаления) — считается один раз', () => {
  const base = sample(20);
  const A = fromArrays(structuredClone(toArrays(base.d)));
  const B = fromArrays(structuredClone(toArrays(base.d)));
  apply(A, applyPurge(A, purgePlan(A, 10, NOW), makeCtx(NOW + 1000)));
  const t20 = [...B.tasks.values()].find((t) => t.title === 'T20');
  B.tasks.set(t20.id, touch(t20, { title: 'T20 (правка)' }, makeCtx(NOW + 5000)));
  const AB = fromArrays(mergeData(toArrays(A), toArrays(B)));
  assert.ok(!AB.tasks.get(t20.id).deletedAt, 'правка после удаления воскрешает');
  assert.equal(doneEntries(AB, TZ).filter((e) => e.id === t20.id).length, 1);
  assert.equal(stats(AB), stats(base.d));
  // Вернули в работу после удаления на другом устройстве — выполнение больше не считается
  const B2 = fromArrays(structuredClone(toArrays(base.d)));
  B2.tasks.set(t20.id, touch(t20, { status: 'active', completedAt: null }, makeCtx(NOW + 5000)));
  const AB2 = fromArrays(mergeData(toArrays(A), toArrays(B2)));
  assert.equal(doneEntries(AB2, TZ).filter((e) => e.id === t20.id).length, 0);
});
