// Деревня (обновление 0.7): покупки, изумруды, шахты, фокус-сессии, настроение, время суток.

import { test, assert } from './runner.js';
import { makeCtx, makeData, addTask } from './helpers.js';
import {
  VILLAGE_ITEMS, villageItem, ownedVillage, levelAt, coinMultiplierAt, gemsForAward, gemsForFocus, gemBalance, canBuy,
  happiness, dayPhase, nightness, villageStyle, focusMinutes,
} from '../src/core/village.js';
import { awardEvent, purchaseEvent, focusEvent, balance, experience } from '../src/core/game.js';
import { mergeData, mergeEntity } from '../src/core/merge.js';
import { newTask, addFocusSession, focusTotal, liveFocusSessions, duplicateTask } from '../src/core/model.js';

const HIGH = '00000000-0000-7000-8000-000000000203';
const CRIT = '00000000-0000-7000-8000-000000000204';
const NOW = Date.parse('2026-10-05T12:00:00.000Z');
const put = (d, e) => d.coinEvents.set(e.id, e);
const buy = (d, id, c) => {
  const it = villageItem(id);
  put(d, purchaseEvent({ price: it.coins || 0, gems: it.gems || 0, title: it.name, itemId: id }, c));
};

test('каталог: id уникальны, у всего есть цена в одной валюте, требования существуют', () => {
  const ids = new Set();
  for (const it of VILLAGE_ITEMS) {
    assert.ok(!ids.has(it.id), 'дубль ' + it.id);
    ids.add(it.id);
    assert.ok(!!it.coins !== !!it.gems, 'одна валюта: ' + it.id);
    if (it.requires) assert.ok(villageItem(it.requires), 'требование ' + it.requires);
  }
  // питомцы из 0.6 остаются теми же покупками
  for (const id of ['pet:cat', 'pet:fox', 'pet:kitten', 'pet:spider', 'pet:neko']) assert.ok(villageItem(id), id);
});

test('золотая шахта увеличивает монеты за задачи, но только с момента покупки', () => {
  const c = makeCtx(NOW);
  const d = makeData();
  d.coinEvents.set('x', { id: 'x', deletedAt: null, active: true, type: 'award', amount: 1000, at: '2026-10-01T00:00:00.000Z' });
  const before = addTask(d, c, { title: 'До', priorityId: HIGH });
  const e1 = awardEvent(d, before, null, { ...c, now: Date.parse('2026-10-02T00:00:00.000Z') });
  assert.equal(e1.amount, 10);
  buy(d, 'v:mine-gold:1', { ...c, now: Date.parse('2026-10-03T00:00:00.000Z') });
  assert.equal(levelAt(d, 'goldmine'), 1);
  assert.equal(coinMultiplierAt(d, '2026-10-02T00:00:00.000Z'), 1, 'до покупки — без бонуса');
  const after = addTask(d, c, { title: 'После', priorityId: HIGH });
  assert.equal(awardEvent(d, after, null, c).amount, 11);
  buy(d, 'v:mine-gold:2', c);
  assert.equal(awardEvent(d, addTask(d, c, { title: 'Ещё', priorityId: CRIT }), null, c).amount, 24);
});

test('изумруды: шахта даёт за важные задачи (критичные — вдвое), фокус — за минуты, покупки тратят', () => {
  assert.equal(gemsForAward(5, 1), 0);
  assert.equal(gemsForAward(10, 1), 1);
  assert.equal(gemsForAward(20, 2), 4);
  assert.equal(gemsForAward(20, 0), 0);
  assert.equal(gemsForFocus(10), 0);
  assert.equal(gemsForFocus(15), 1);
  assert.equal(gemsForFocus(50), 2);
  assert.equal(gemsForFocus(25, 2), 2);
  const c = makeCtx(NOW);
  const d = makeData();
  put(d, { id: 'x', deletedAt: null, active: true, type: 'award', amount: 5000, at: '2026-10-01T00:00:00.000Z' });
  buy(d, 'v:mine-gem:1', c);
  const t = addTask(d, c, { title: 'Важная', priorityId: CRIT });
  put(d, awardEvent(d, t, null, { ...c, now: NOW + 1000 }));
  assert.equal(gemBalance(d), 2);
  put(d, focusEvent(d, { minutes: 25, title: 'Фокус' }, { ...c, now: NOW + 2000 }));
  assert.equal(gemBalance(d), 3);
  buy(d, 'v:daynight', { ...c, now: NOW + 3000 });
  assert.equal(gemBalance(d), 0);
  assert.equal(balance(d), 5000 - 400 + 20, 'покупка за изумруды не трогает монеты');
  assert.equal(experience(d), 5000 + 20, 'фокус и покупки не дают опыта');
});

test('canBuy: требования по порядку, обе валюты, уже куплено', () => {
  const c = makeCtx(NOW);
  const d = makeData();
  assert.equal(canBuy(d, villageItem('v:house:3'), 1000).reason, 'Сначала: Второй домик');
  assert.equal(canBuy(d, villageItem('v:house:2'), 100).ok, false);
  assert.equal(canBuy(d, villageItem('v:house:2'), 120).ok, true);
  buy(d, 'v:house:2', c);
  assert.equal(canBuy(d, villageItem('v:house:2'), 1000).reason, 'Уже есть');
  assert.ok(canBuy(d, villageItem('v:tower'), 1000).reason.includes('💎'));
  assert.ok(ownedVillage(d).has('base:house') && ownedVillage(d).has('v:house:2'));
});

test('покупки деревни и фокус-сессии сливаются с двух устройств без потерь', () => {
  const a = makeData();
  const b = makeData();
  buy(a, 'v:house:2', makeCtx(NOW));
  put(b, focusEvent(b, { minutes: 45, title: 'Отчёт' }, { ...makeCtx(NOW + 5), deviceId: 'devB' }));
  const m = mergeData({ coinEvents: [...a.coinEvents.values()] }, { coinEvents: [...b.coinEvents.values()] }, ['coinEvents']);
  const d = makeData();
  for (const e of m.coinEvents) d.coinEvents.set(e.id, e);
  assert.ok(ownedVillage(d).has('v:house:2'));
  assert.equal(gemBalance(d), 2);
  assert.equal(focusMinutes(d, 'Europe/Moscow', '2026-10-05'), 45);
});

test('фокус в задаче (0.7.1): сессии с двух устройств сливаются, считается сумма, копия задачи — без сессий', () => {
  const c = makeCtx(NOW);
  const t0 = newTask({ title: 'Отчёт' }, c);
  assert.deepEqual(focusTotal(t0), { minutes: 0, count: 0 });
  const a = addFocusSession(t0, { startedAt: '2026-10-05T10:00:00.000Z', minutes: 25 }, c);
  const b = addFocusSession(t0, { startedAt: '2026-10-05T11:00:00.000Z', minutes: 45 }, { ...makeCtx(NOW + 5), deviceId: 'devB' });
  const m = mergeEntity(a, b);
  assert.deepEqual(focusTotal(m), { minutes: 70, count: 2 });
  assert.equal(liveFocusSessions(m)[0].minutes, 45, 'свежая сессия первой');
  assert.deepEqual(mergeEntity(b, a).focusSessions, m.focusSessions, 'слияние коммутативно');
  assert.equal(focusTotal(duplicateTask(m, 'a1', c)).count, 0);
  assert.equal(addFocusSession(t0, { startedAt: '2026-10-05T10:00:00.000Z', minutes: 9999 }, c).focusSessions[0].minutes, 1440);
});

test('настроение: выполненные важные задачи и фокус радуют, просроченные расстраивают', () => {
  const c = makeCtx(NOW);
  const d = makeData();
  const base = happiness(d, 'Europe/Moscow', '2026-10-05');
  assert.equal(base.value, 35);
  addTask(d, c, { title: 'Важная', priorityId: CRIT }, { status: 'done', completedAt: '2026-10-05T09:00:00.000Z' });
  const happy = happiness(d, 'Europe/Moscow', '2026-10-05');
  assert.ok(happy.value > base.value + 20, 'критичная задача сильно радует');
  for (let i = 0; i < 5; i++) addTask(d, c, { title: 'Хвост ' + i, scheduledDate: '2026-10-01' });
  const sad = happiness(d, 'Europe/Moscow', '2026-10-05');
  assert.ok(sad.value < happy.value - 25);
  assert.equal(sad.parts.overdue, 5);
  assert.ok(['Унывают', 'Грустят', 'Спокойны', 'Довольны', 'Ликуют'].includes(sad.label));
});

test('время суток: смена каждые 5 минут, по часам, по теме; ночь темнее дня', () => {
  assert.equal(dayPhase('theme', NOW, { dark: false }), 0.5);
  assert.ok(nightness(dayPhase('theme', NOW, { dark: true })) > 0.3);
  assert.equal(dayPhase('real', NOW, { hour: 18 }), 0.75);
  assert.ok(nightness(0) > 0.9 && nightness(0.5) === 0);
  const start = 1800000000000 - (1800000000000 % 600000);
  const day = nightness(dayPhase('cycle', start + 150000)); // середина дневной половины
  const night = nightness(dayPhase('cycle', start + 450000)); // середина ночной
  assert.ok(day < 0.1 && night > 0.9, `${day} ${night}`);
  assert.ok(villageStyle('lavender').gothic && villageStyle('nope').name === 'Классическая деревня');
});
