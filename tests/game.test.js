// Игра: журнал монет, баланс, опыт, уровни, серии (п. 2.6).

import { test, assert } from './runner.js';
import { makeCtx, makeData, addTask } from './helpers.js';
import { awardEvent, revokeEvent, purchaseEvent, balance, experience, levelInfo, xpForLevel, streaks, gameStats, awardId } from '../src/core/game.js';
import { mergeData } from '../src/core/merge.js';

const HIGH = '00000000-0000-7000-8000-000000000203';
const put = (d, e) => (e ? d.coinEvents.set(e.id, e) : null);

test('начисление: id детерминирован, сумма по приоритету; повтор без изменений — null', () => {
  const c = makeCtx();
  const d = makeData();
  const t = addTask(d, c, { title: 'A', priorityId: HIGH });
  const e = awardEvent(d, t, null, c);
  assert.equal(e.id, awardId(t.id));
  assert.equal(e.amount, 10);
  put(d, e);
  assert.equal(awardEvent(d, t, null, c), null);
  assert.equal(balance(d), 10);
});

test('снятие отметки забирает монеты, повторная отметка не начисляет второй раз (нельзя фармить)', () => {
  const c = makeCtx();
  const d = makeData();
  const t = addTask(d, c, { title: 'A', priorityId: HIGH });
  for (let i = 0; i < 3; i++) {
    put(d, awardEvent(d, t, null, c));
    assert.equal(balance(d), 10);
    put(d, revokeEvent(d, t.id, null, c));
    assert.equal(balance(d), 0);
  }
  put(d, awardEvent(d, t, null, c));
  assert.equal(d.coinEvents.size, 1, 'одно событие на задачу');
  assert.equal(experience(d), 10);
});

test('два устройства отметили одну задачу офлайн → после слияния монеты один раз', () => {
  const ca = makeCtx();
  const cb = makeCtx(Date.parse('2026-10-02T09:05:00.000Z'));
  const A = makeData();
  const t = addTask(A, ca, { title: 'A', priorityId: HIGH });
  const B = makeData();
  B.tasks.set(t.id, t);
  put(A, awardEvent(A, t, null, ca));
  put(B, awardEvent(B, t, null, cb));
  const merged = mergeData({ coinEvents: [...A.coinEvents.values()] }, { coinEvents: [...B.coinEvents.values()] }, ['coinEvents']);
  const M = makeData();
  for (const e of merged.coinEvents) M.coinEvents.set(e.id, e);
  assert.equal(balance(M), 10);
});

test('повторяющаяся задача: отдельное начисление на каждый экземпляр', () => {
  const c = makeCtx();
  const d = makeData();
  const t = addTask(d, c, { title: 'Полить цветы' });
  put(d, awardEvent(d, t, '2026-10-05', c));
  put(d, awardEvent(d, t, '2026-10-08', c));
  assert.equal(balance(d), 2);
  assert.ok(d.coinEvents.has(awardId(t.id, '2026-10-05')));
});

test('покупка уменьшает баланс, но не опыт', () => {
  const c = makeCtx();
  const d = makeData();
  const t = addTask(d, c, { title: 'A', priorityId: HIGH });
  put(d, awardEvent(d, t, null, c));
  put(d, purchaseEvent({ price: 7, title: 'Серия сериала' }, c));
  assert.equal(balance(d), 3);
  assert.equal(experience(d), 10);
});

test('уровни: пороги 0, 50, 150, 300; прогресс до следующего', () => {
  assert.deepEqual([1, 2, 3, 4].map(xpForLevel), [0, 50, 150, 300]);
  assert.equal(levelInfo(0).level, 1);
  assert.equal(levelInfo(49).level, 1);
  assert.equal(levelInfo(50).level, 2);
  const l = levelInfo(100);
  assert.equal(l.level, 2);
  assert.equal(l.progress, 0.5);
});

test('серии: текущая (сегодня или до вчера) и лучшая', () => {
  const m = new Map([['2026-09-20', 1], ['2026-09-21', 2], ['2026-09-22', 1], ['2026-09-30', 1], ['2026-10-01', 3]]);
  assert.deepEqual(streaks(m, '2026-10-02'), { current: 2, best: 3 });
  assert.deepEqual(streaks(m, '2026-10-01'), { current: 2, best: 3 });
  assert.deepEqual(streaks(m, '2026-10-04'), { current: 0, best: 3 });
});

test('статистика и достижения вычисляются из задач и журнала', () => {
  const c = makeCtx();
  const d = makeData();
  const t = addTask(d, c, { title: 'A' }, { status: 'done', completedAt: '2026-10-02T07:00:00.000Z' });
  put(d, awardEvent(d, t, null, c));
  const s = gameStats(d, 'Europe/Moscow', '2026-10-02');
  assert.equal(s.done, 1);
  assert.equal(s.currentStreak, 1);
  assert.ok(s.achievements.find((a) => a.id === 'first').unlocked);
  assert.ok(!s.achievements.find((a) => a.id === 'streak7').unlocked);
});
