// Crimson Harvest (обновление 0.12): рационы (основные, свои общие и на один день, порядок, время, скрытие),
// записи из нескольких продуктов со временем и заметкой, совместимость с записями 0.11, слияние, формат схемы 2.

import { test, assert } from './runner.js';
import { makeCtx } from './helpers.js';
import { entryNutrients, nv } from '../src/core/nutrition.js';
import * as N from '../src/core/nutrition.js';
import * as F from '../src/core/feast.js';
import { mergeEntity } from '../src/core/merge.js';
import { revert, tombstone } from '../src/core/model.js';
import { canonicalJson } from '../src/core/canonical.js';
import { buildFeastDb, checkFeastDb, FEAST_SCHEMA_VERSION } from '../src/data/feastEnvelope.js';
import * as B from '../src/core/body.js';
import * as G from '../src/core/game.js';
import { gemBalance } from '../src/core/village.js';
import { setExtraEarnings } from '../src/core/earnings.js';
import { makeData } from './helpers.js';

const NOW = Date.parse('2026-10-08T09:00:00.000Z');
const TODAY = '2026-10-08';
const OTHER = '01926f3a-8c1e-7b2a-9f00-000000000002';

function feastData() {
  return {
    settings: F.defaultFeastSettings(), foods: new Map(), entries: new Map(), dayArchive: new Map(), body: new Map(),
    meals: new Map(F.defaultMeals().map((m) => [m.id, m])), mealNotes: new Map(),
  };
}
const put = (d, coll, e) => (d[coll].set(e.id, e), e);
const names = (list) => list.map((m) => m.name);

/** Запись в виде 0.11: один продукт в полях самой записи. */
function legacyEntry(c, { date = TODAY, meal = 'breakfast', name = 'Каша', amount = 200, kcal = 100 } = {}) {
  const at = new Date(c.now).toISOString();
  return {
    id: '01926f3a-0000-7000-8000-' + String(Math.floor(Math.random() * 1e12)).padStart(12, '0'),
    createdAt: at, updatedAt: at, updatedBy: c.deviceId, deletedAt: null,
    fieldTimes: { date: 5, meal: 5, foodId: 5, name: 5, amount: 5, unit: 5, nutrients: 5, deletedAt: 5 },
    date, meal, foodId: null, name, amount, unit: 'g', nutrients: { kcal, protein: 3 },
  };
}

test('Рационы: основные — одинаковые на всех устройствах, по порядку, переименовываются', () => {
  const a = F.defaultMeals();
  const b = F.defaultMeals();
  assert.equal(canonicalJson(a), canonicalJson(b), 'два устройства создают одно и то же');
  assert.deepEqual(a.map((m) => m.id), ['breakfast', 'lunch', 'dinner', 'snack']);
  assert.ok(a.every((m, i) => i === 0 || a[i - 1].order < m.order), 'порядок по возрастанию');
  assert.ok(a.every((m) => m.fieldTimes.name === 1 && !m.date));
  const c = makeCtx(NOW);
  const renamed = F.editMeal(a[0], { name: '  Ранний   завтрак ', time: '7:30', icon: '' }, c);
  assert.equal(renamed.name, 'Ранний завтрак');
  assert.equal(renamed.time, '07:30');
  assert.equal(renamed.icon, a[0].icon, 'пустой значок не стирает старый');
  assert.equal(mergeEntity(a[0], renamed).name, 'Ранний завтрак', 'правка побеждает умолчание');
  assert.equal(F.cleanTime('24:00'), null);
  assert.equal(F.cleanTime('9:05'), '09:05');
});

test('Рационы: свой между основными — на один день или на каждый, скрытый виден только там, где есть записи', () => {
  const d = feastData();
  const c = makeCtx(NOW);
  const day = F.mealsForDay(d, TODAY);
  const second = put(d, 'meals', F.newMeal({ name: 'Второй завтрак', icon: '🥪', time: '10:30', order: F.orderAfter(day, 'breakfast'), date: TODAY }, c));
  const tea = put(d, 'meals', F.newMeal({ name: 'Полдник', order: F.orderAfter(F.globalMeals(d), 'lunch') }, c));
  assert.deepEqual(names(F.mealsForDay(d, TODAY)), ['Завтрак', 'Второй завтрак', 'Обед', 'Полдник', 'Ужин', 'Перекус']);
  assert.deepEqual(names(F.mealsForDay(d, '2026-10-09')), ['Завтрак', 'Обед', 'Полдник', 'Ужин', 'Перекус'], 'рацион дня — только в своём дне');
  assert.equal(second.date, TODAY);
  const first = put(d, 'meals', F.newMeal({ name: 'Кофе', order: F.orderAfter(F.mealsForDay(d, TODAY), null) }, c));
  assert.equal(F.mealsForDay(d, TODAY)[0].id, first.id, 'в начало');
  put(d, 'meals', F.editMeal(tea, { archived: true }, c));
  assert.ok(!F.mealsForDay(d, TODAY).some((m) => m.id === tea.id), 'скрытый — не показывается');
  put(d, 'entries', F.newEntry({ date: TODAY, meal: tea.id, time: '16:00', quick: { nutrients: { kcal: 200 } } }, c));
  assert.ok(F.mealsForDay(d, TODAY).some((m) => m.id === tea.id), 'но виден в дне, где в нём есть записи');
  put(d, 'entries', F.newEntry({ date: TODAY, meal: 'gone-meal', quick: { nutrients: { kcal: 50 } } }, c));
  const lost = F.mealsForDay(d, TODAY).find((m) => m.id === 'gone-meal');
  assert.ok(lost && lost.missing && lost.name === 'Другое', 'записи удалённого на другом устройстве рациона не пропадают');
});

test('Рационы: рацион по времени — последний наступивший, без времени — по часам', () => {
  const d = feastData();
  const c = makeCtx(NOW);
  assert.equal(F.mealByTime(d, TODAY, '08:10'), 'breakfast');
  assert.equal(F.mealByTime(d, TODAY, '13:00'), 'lunch');
  assert.equal(F.mealByTime(d, TODAY, '23:30'), 'snack');
  put(d, 'meals', F.editMeal(d.meals.get('breakfast'), { time: '08:00' }, c));
  put(d, 'meals', F.editMeal(d.meals.get('lunch'), { time: '13:00' }, c));
  const late = put(d, 'meals', F.newMeal({ name: 'После тренировки', time: '19:30', order: F.orderAfter(F.globalMeals(d), 'dinner') }, c));
  assert.equal(F.mealByTime(d, TODAY, '12:59'), 'breakfast');
  assert.equal(F.mealByTime(d, TODAY, '20:00'), late.id);
  assert.equal(F.mealByTime(d, TODAY, '06:00'), late.id, 'раньше всех — последний (вчерашний вечер)');
});

test('Записи: несколько продуктов, время и заметка; состав меняется поэлементно', () => {
  const c = makeCtx(NOW);
  const oat = F.newFood({ name: 'Овсянка', nutrients: { kcal: 350, protein: 12 } }, c);
  const milk = F.newFood({ name: 'Молоко', unit: 'ml', nutrients: { kcal: 60, protein: 3 } }, c);
  let e = F.newEntry({ date: TODAY, meal: 'breakfast', time: '8:05', note: 'дома', items: [{ food: oat, amount: 60 }, { food: milk, amount: 200 }] }, c);
  assert.equal(e.time, '08:05');
  assert.equal(e.note, 'дома');
  assert.equal(F.entryItems(e).length, 2);
  assert.equal(F.entryTitle(e), 'Овсянка, Молоко');
  assert.equal(Math.round(nv(entryNutrients(e), 'kcal')), 330);
  const milkId = F.entryItems(e).find((x) => x.name === 'Молоко').id;
  e = F.setItemAmount(e, milkId, 100, c);
  assert.equal(Math.round(nv(entryNutrients(e), 'kcal')), 270);
  e = F.addItems(e, [{ quick: { name: 'Мёд', nutrients: { kcal: 30 } }, amount: 1 }], c);
  assert.equal(F.entryItems(e).length, 3);
  assert.equal(F.entryTitle(e), 'Овсянка, Молоко, Мёд');
  e = F.removeItem(e, milkId, c);
  assert.equal(F.entryItems(e).length, 2);
  assert.equal(Math.round(nv(entryNutrients(e), 'kcal')), 240, 'убранный продукт не считается');
  e = F.editEntry(e, { time: 'ерунда', note: 'x'.repeat(5000), meal: 'lunch' }, c);
  assert.equal(e.time, null);
  assert.equal(e.note.length, F.NOTE_MAX);
  assert.equal(e.meal, 'lunch');
  let thrown = false;
  try {
    F.editEntry(e, { items: [] }, c);
  } catch {
    thrown = true;
  }
  assert.ok(!thrown, 'editEntry не трогает состав');
});

test('Записи: два устройства добавили по продукту в одну запись — после слияния оба на месте', () => {
  const a = makeCtx(NOW);
  const b = { ...makeCtx(NOW + 1000), deviceId: OTHER };
  const base = F.newEntry({ date: TODAY, meal: 'lunch', quick: { name: 'Суп', nutrients: { kcal: 150 } } }, a);
  const onA = F.addItems(base, [{ quick: { name: 'Хлеб', nutrients: { kcal: 80 } } }], a);
  const onB = F.editEntry(F.addItems(base, [{ quick: { name: 'Компот', nutrients: { kcal: 60 } } }], b), { note: 'с работы' }, b);
  const m = mergeEntity(onA, onB);
  assert.deepEqual(F.entryItems(m).map((x) => x.name).sort(), ['Компот', 'Суп', 'Хлеб']);
  assert.equal(m.note, 'с работы');
  assert.equal(canonicalJson(m), canonicalJson(mergeEntity(onB, onA)), 'слияние симметрично');
});

test('Записи 0.11: читаются как есть, перевод на продукты детерминированный, «Отменить» не теряет продукт', () => {
  const a = makeCtx(NOW);
  const b = { ...makeCtx(NOW + 1000), deviceId: OTHER };
  const old = legacyEntry(a, { name: 'Каша', amount: 200, kcal: 100 });
  assert.equal(nv(entryNutrients(old), 'kcal'), 200);
  assert.equal(F.entryTitle(old), 'Каша');
  assert.ok(F.entryItems(old)[0].legacy);
  const upA = F.upgradeEntry(old, a);
  const upB = F.upgradeEntry(old, b);
  assert.equal(upA.items[0].id, old.id, 'id продукта = id записи');
  const both = mergeEntity(F.setItemAmount(upA, old.id, 300, a), F.addItems(upB, [{ quick: { name: 'Чай', nutrients: { kcal: 5 } } }], b));
  assert.equal(F.entryItems(both).length, 2, 'одна каша, а не две');
  assert.equal(nv(entryNutrients(both), 'kcal'), 305);
  // «Отменить» правки записи 0.11: возвращаемся к переведённому состоянию (base), а не к «без продуктов»
  const edited = F.setItemAmount(upA, old.id, 50, a);
  const undone = revert(edited, upA, a);
  assert.equal(nv(entryNutrients(undone), 'kcal'), 200);
  assert.equal(nv(entryNutrients(F.upgradeEntry(upA, a)), 'kcal'), 200, 'повторный перевод ничего не меняет');
});

test('Дневник: записи по рационам и по времени, итоги, сводка дня по продуктам и рационам', () => {
  const d = feastData();
  const c = makeCtx(NOW);
  const oat = put(d, 'foods', F.newFood({ name: 'Овсянка', nutrients: { kcal: 350 } }, c));
  const own = put(d, 'meals', F.newMeal({ name: 'Свой', order: F.orderAfter(F.mealsForDay(d, TODAY), 'breakfast'), date: TODAY }, c));
  const late = put(d, 'entries', F.newEntry({ date: TODAY, meal: 'breakfast', time: '09:30', items: [{ food: oat, amount: 100 }] }, c));
  const early = put(d, 'entries', F.newEntry({ date: TODAY, meal: 'breakfast', time: '07:00', items: [{ food: oat, amount: 50 }, { quick: { name: 'Кофе', nutrients: { kcal: 20 } } }] }, c));
  put(d, 'entries', F.newEntry({ date: TODAY, meal: own.id, time: '11:00', quick: { name: 'Яблоко', nutrients: { kcal: 50 } } }, c));
  put(d, 'entries', legacyEntry(c, { meal: 'dinner', kcal: 100, amount: 100 }));
  const t = F.dayTotals(d, TODAY);
  assert.deepEqual(t.entries.breakfast.map((e) => e.id), [early.id, late.id], 'по времени');
  assert.equal(Math.round(nv(t.meals[own.id], 'kcal')), 50);
  assert.equal(Math.round(nv(t.totals, 'kcal')), 695);
  assert.equal(t.count, 4);
  const usage = F.foodUsage(d);
  assert.equal(usage.get(oat.id).count, 2, 'продукт в составе записи тоже считается');
  const arch = F.archiveFor(TODAY, [...d.entries.values()], null, c);
  assert.equal(arch.count, 4);
  assert.equal(arch.meals[own.id], 50);
  assert.equal(arch.foods[oat.id].count, 2);
  assert.equal(arch.foods['quick:Кофе'].kcal, 20);
  const st = F.periodStats(d, TODAY, TODAY, 2000);
  assert.equal(st.topByCount[0].name, 'Овсянка');
  assert.equal(Math.round(nv(F.dailySeries(d, TODAY, TODAY)[0].totals, 'kcal')), 695);
});

test('Дневник: копия записи — снимок продуктов с foodId, время и заметка', () => {
  const c = makeCtx(NOW);
  const oat = F.newFood({ name: 'Овсянка', nutrients: { kcal: 350 } }, c);
  const e = F.newEntry({ date: TODAY, meal: 'breakfast', time: '08:00', note: 'н', items: [{ food: oat, amount: 80 }] }, c);
  const copy = F.newEntry({ date: '2026-10-09', meal: e.meal, time: e.time, note: e.note, items: F.entryItems(e).map((it) => ({ snapshot: it })) }, c);
  assert.equal(copy.items[0].foodId, oat.id);
  assert.equal(copy.items[0].amount, 80);
  assert.ok(copy.items[0].id !== e.items[0].id);
  assert.equal(nv(entryNutrients(copy), 'kcal'), nv(entryNutrients(e), 'kcal'));
  assert.equal(copy.time, '08:00');
  assert.equal(copy.note, 'н');
});

test('Заметки к рациону: одна запись на рацион дня, пустая — как нет', () => {
  const d = feastData();
  const c = makeCtx(NOW);
  assert.equal(F.mealNoteId(TODAY, 'lunch'), 'mn:2026-10-08:lunch');
  const n = put(d, 'mealNotes', F.newMealNote(TODAY, 'lunch', 'в кафе', c));
  assert.equal(F.mealNoteOf(d, TODAY, 'lunch').text, 'в кафе');
  assert.equal(F.mealNoteOf(d, '2026-10-09', 'lunch'), null);
  put(d, 'mealNotes', { ...n, text: '' });
  assert.equal(F.mealNoteOf(d, TODAY, 'lunch'), null);
  put(d, 'mealNotes', tombstone(n, c));
  assert.equal(F.mealNoteOf(d, TODAY, 'lunch'), null);
});

test('Формат схемы 2: рационы и заметки в базе, файл схемы 1 читается, items проверяются', () => {
  const c = makeCtx(NOW);
  assert.equal(FEAST_SCHEMA_VERSION, 2);
  assert.ok(F.FEAST_COLLECTIONS.includes('meals') && F.FEAST_COLLECTIONS.includes('mealNotes'));
  const e = F.newEntry({ date: TODAY, meal: 'lunch', quick: { name: 'Суп', nutrients: { kcal: 150 } } }, c);
  const db = buildFeastDb({ settings: [F.defaultFeastSettings()], meals: F.defaultMeals(), entries: [e] }, { deviceId: 'dev', now: new Date(NOW) });
  assert.equal(db.data.meals.length, 4);
  assert.deepEqual(db.data.mealNotes, []);
  assert.equal(checkFeastDb(JSON.parse(JSON.stringify(db))).data.entries[0].items.length, 1);
  const v1 = checkFeastDb({ format: 'crimson-feast-db', schemaVersion: 1, data: { entries: [legacyEntry(c)] } });
  assert.deepEqual(v1.data.meals, []);
  assert.equal(F.entryTitle(v1.data.entries[0]), 'Каша');
  let code = '';
  try {
    checkFeastDb({ format: 'crimson-feast-db', schemaVersion: 2, data: { entries: [{ ...e, items: {} }] } });
  } catch (err) {
    code = err.code;
  }
  assert.equal(code, 'E-DB-CORRUPT');
});

test('Награды за еду: по умолчанию мало, своё у продукта, снимок в записи, дробные копятся ровно', () => {
  const c = makeCtx(NOW);
  const d = feastData();
  assert.deepEqual(F.rewardDefaults(d.settings), { xp: 1, coins: 0.2, gems: 0.05 });
  assert.equal(F.cleanReward('0,05'), 0.05);
  assert.equal(F.cleanReward(''), null);
  assert.equal(F.cleanReward(-1), null);
  const apple = put(d, 'foods', F.newFood({ name: 'Яблоко', nutrients: { kcal: 47 }, rewards: { gems: '0,1', xp: '' } }, c));
  assert.deepEqual(apple.rewards, { gems: 0.1 });
  assert.deepEqual(F.rewardsOf(apple, d.settings), { xp: 1, coins: 0.2, gems: 0.1 });
  const s2 = { ...d.settings, rewardXp: 3 };
  assert.equal(F.rewardsOf(apple, s2).xp, 3, 'умолчание — из настроек');
  for (let i = 0; i < 20; i++) {
    put(d, 'entries', F.newEntry({ date: TODAY, meal: 'snack', items: [{ food: apple, amount: 100, rewards: F.rewardsOf(apple, d.settings) }] }, c));
  }
  const day = F.dayRewards(d, TODAY);
  assert.deepEqual(day, { xp: 20, coins: 4, gems: 2 }, '20 × 0,1 — ровно 2, без хвостов');
  // правка продукта прошлые записи не меняет
  put(d, 'foods', F.editFood(apple, { rewards: { gems: 5 } }, c));
  assert.equal(F.feastRewards(d).gems, 2);
  // лимит хранения: награды удалённых дней остаются в сводке
  const list = [...d.entries.values()];
  const arch = F.archiveFor(TODAY, list, null, c);
  for (const e of list) d.entries.set(e.id, tombstone(e, c));
  d.dayArchive.set(arch.id, arch);
  assert.deepEqual(F.feastRewards(d), { xp: 20, coins: 4, gems: 2 });
  // записи 0.11 наград не дают
  assert.deepEqual(F.entryRewards(legacyEntry(c)), { xp: 0, coins: 0, gems: 0 });
});

test('Награды за еду: целые части идут в баланс монет, опыт и 💎 игры', () => {
  const data = makeData();
  try {
    setExtraEarnings(() => ({ xp: 12.5, coins: 3.99, gems: 0.95 }));
    assert.equal(G.balance(data), 3, 'тратятся только целые монеты');
    assert.equal(G.experience(data), 12);
    assert.equal(gemBalance(data), 0);
    setExtraEarnings(() => ({ xp: 0, coins: 0, gems: 1.0000001 }));
    assert.equal(gemBalance(data), 1);
  } finally {
    setExtraEarnings(null);
  }
  assert.equal(G.balance(data), 0);
});

test('Рекомендация калорий: свой дефицит, профицит, минимум и своя рекомендация', () => {
  const p = { sex: 'male', weightKg: 80, heightCm: 180, age: 30, activity: 'moderate', goal: 'lose' };
  assert.equal(B.recommendedKcal(p), 2260, 'как раньше: −500');
  assert.equal(B.recommendedKcal(p, { lose: 300 }), 2460);
  assert.equal(B.recommendedKcal({ ...p, goal: 'gain' }, { gain: 500 }), 3260);
  assert.equal(B.recommendedKcal(p, { lose: 2000, floor: 1800 }), 1800);
  assert.deepEqual(B.recommendation(p, {}), { auto: 2260, own: null, value: 2260 });
  assert.deepEqual(B.recommendation(p, { recKcal: 2100, loseKcal: 400 }), { auto: 2360, own: 2100, value: 2100 });
  assert.equal(B.recommendation({ sex: 'female' }, { recKcal: 1700 }).value, 1700, 'своя — даже без расчёта');
  assert.equal(B.recommendation(p, { loseKcal: 0 }).value, 2760, 'дефицит 0 — тоже значение');
});

test('Цели БЖУ: доли → граммы вниз (не выше лимита), граммы — не больше лимита, доли — ровно 100 %', () => {
  assert.deepEqual(N.gramsFromPct(2000, { protein: 20, fat: 30, carbs: 50 }), { protein: 100, fat: 66, carbs: 250 });
  assert.ok(N.macrosKcal(N.gramsFromPct(1999, { protein: 33, fat: 33, carbs: 34 })) <= 1999, 'округление не выводит за лимит');
  assert.equal(N.macroMode({}), 'pct');
  assert.equal(N.macroMode({ proteinGoal: 140 }), 'grams', 'настройки 0.11 с граммами — режим граммов');
  assert.equal(N.macroMode({ proteinGoal: 140, macroMode: 'pct' }), 'pct');
  assert.deepEqual(N.dayGoals({ kcalGoal: 2500, macroMode: 'pct', proteinPct: 30, fatPct: 30, carbsPct: 40 }),
    { kcal: 2500, protein: 187, fat: 83, carbs: 250 }, 'граммы считаются от лимита сами');
  // как на снимке пользователя: 200 / 63 / 166 г при лимите 2000 — 2031 ккал, сохранить нельзя
  const bad = N.checkGoals({ kcal: 2000, mode: 'grams', grams: { protein: 200, fat: 63, carbs: 166 } });
  assert.ok(!bad.ok && bad.total === 2031 && bad.error.includes('2031'));
  assert.ok(N.checkGoals({ kcal: 2000, mode: 'grams', grams: { protein: 150, fat: 60, carbs: 200 } }).ok);
  assert.ok(!N.checkGoals({ kcal: 2000, mode: 'pct', pct: { protein: 30, fat: 30, carbs: 50 } }).ok, '110 % — нельзя');
  assert.ok(!N.checkGoals({ kcal: 2000, mode: 'pct', pct: { protein: 30, fat: 30, carbs: NaN } }).ok, 'пустое поле — нельзя');
  assert.ok(!N.checkGoals({ kcal: 500, mode: 'pct', pct: { protein: 20, fat: 30, carbs: 50 } }).ok, 'лимит вне границ');
  const ch = N.goalChanges({ kcal: 1800, mode: 'pct', pct: { protein: 25, fat: 25, carbs: 50 } });
  assert.deepEqual([ch.macroMode, ch.proteinPct, ch.proteinGoal, ch.fatGoal], ['pct', 25, 112, 50], 'граммы пишутся и для старых клиентов');
  // «Сделать лимитом»: доли — пересчёт, граммы — проверка
  const pctSet = N.kcalGoalChanges({ kcalGoal: 2000, macroMode: 'pct', proteinPct: 20, fatPct: 30, carbsPct: 50 }, 1600);
  assert.ok(pctSet.ok && pctSet.changes.carbsGoal === 200);
  const gramsSet = N.kcalGoalChanges({ kcalGoal: 2000, macroMode: 'grams', proteinGoal: 150, fatGoal: 60, carbsGoal: 200 }, 1500);
  assert.ok(!gramsSet.ok && gramsSet.error.includes('1940'));
});

test('Страница рациона: дни с записями, средние калории, частые продукты, сводки дней', () => {
  const d = feastData();
  const c = makeCtx(NOW);
  const oat = put(d, 'foods', F.newFood({ name: 'Овсянка', nutrients: { kcal: 350 } }, c));
  put(d, 'entries', F.newEntry({ date: TODAY, meal: 'breakfast', items: [{ food: oat, amount: 100 }] }, c));
  put(d, 'entries', F.newEntry({ date: '2026-10-07', meal: 'breakfast', items: [{ food: oat, amount: 50 }, { quick: { name: 'Кофе', nutrients: { kcal: 20 } } }] }, c));
  put(d, 'entries', F.newEntry({ date: TODAY, meal: 'lunch', quick: { name: 'Суп', nutrients: { kcal: 300 } } }, c));
  const arch = F.archiveFor('2026-09-20', [F.newEntry({ date: '2026-09-20', meal: 'breakfast', items: [{ food: oat, amount: 100 }] }, c)], null, c);
  d.dayArchive.set(arch.id, arch);
  const s = F.mealStats(d, 'breakfast', '2026-09-09', TODAY);
  assert.deepEqual(s.days.map((x) => x.date), [TODAY, '2026-10-07', '2026-09-20'], 'новые дни сверху, сводки — тоже');
  assert.equal(s.entries, 2);
  assert.equal(Math.round(s.avgKcal), Math.round((350 + 195 + 350) / 3));
  assert.equal(s.topFoods[0].name, 'Овсянка');
  assert.equal(s.topFoods[0].count, 2);
  assert.equal(F.mealStats(d, 'dinner', '2026-09-09', TODAY).days.length, 0);
});

test('Цели БЖУ: переход «в граммах» → «в процентах» даёт ровно 100 %', () => {
  const p = N.normalizedPct({ protein: 200, fat: 63, carbs: 150 });
  assert.equal(p.protein + p.fat + p.carbs, 100);
  assert.deepEqual(p, { protein: 41, fat: 29, carbs: 30 });
  assert.deepEqual(N.normalizedPct({ protein: 0, fat: 0, carbs: 0 }), { protein: 20, fat: 30, carbs: 50 });
});

test('Активности: калории в день у каждой, свои активности, расход', () => {
  const p = { sex: 'male', weightKg: 80, heightCm: 180, age: 30, activity: 'light', goal: 'keep' };
  const base = B.bmr(p);
  assert.equal(base, 1780);
  assert.equal(B.activityBurn(B.activityOf('sedentary'), base), 356);
  assert.equal(B.activityBurn(B.activityOf('light'), base), 668);
  assert.ok(B.activityLabel(B.activityOf('moderate'), base).endsWith('· +979 ккал в день'));
  assert.ok(B.activityLabel(B.activityOf('moderate'), null).endsWith('· обмен × 1,55'), 'без обмена — коэффициент');
  const custom = [{ id: 'c:1', name: 'Курьер', hint: 'весь день на ногах', kcal: 1200 }, { id: 'bad' }];
  assert.equal(B.activityList(custom).length, 6, 'битые записи отбрасываются');
  assert.equal(B.tdee({ ...p, activity: 'c:1', activities: custom }), 2980, 'своя — обмен + ккал');
  assert.equal(B.tdee({ ...p, activity: 'c:удалена', activities: custom }), B.tdee(p), 'удалённая своя — как лёгкая');
  assert.equal(B.tdee({ ...p, activity: 'moderate' }), 2759, 'как раньше');
});

test('«Рассчитать»: лимит по рекомендации, белок и жир по весу и цели, углеводы — остальное, не больше лимита', () => {
  const p = { sex: 'male', weightKg: 80, heightCm: 180, age: 30, activity: 'moderate', goal: 'lose' };
  const r = B.calcGoals(p, {});
  assert.equal(r.kcal, 2260);
  assert.deepEqual(r.grams, { protein: 160, fat: 72, carbs: 243 });
  assert.ok(N.macrosKcal(r.grams) <= r.kcal);
  assert.ok(r.why.includes('2 г на кг'));
  assert.equal(B.calcGoals({ ...p, goal: 'keep' }, {}).grams.protein, 128);
  const own = B.calcGoals(p, { recKcal: 1500 });
  assert.equal(own.kcal, 1500, 'своя рекомендация');
  assert.ok(N.macrosKcal(own.grams) <= 1500);
  assert.deepEqual(B.calcGoals({ sex: 'male' }, {}).missing, ['дата рождения', 'рост', 'вес']);
  const tiny = B.calcGoals({ ...p, weightKg: 150 }, { recKcal: 900 });
  assert.ok(N.macrosKcal(tiny.grams) <= 900 && tiny.grams.carbs >= 0, 'маленький лимит — всё равно в пределах');
});
