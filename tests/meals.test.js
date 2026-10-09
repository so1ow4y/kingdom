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
import { addDays } from '../src/core/dates.js';
import * as M from '../src/core/measures.js';

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
  assert.equal(B.activityList(custom).length, 7, 'битые записи отбрасываются (6 своих вариантов с «Без надбавки» и одна своя)');
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

test('Заметка к продукту в записи (0.12.4): при записи, правка поэлементно, копия, пустая — убрать', () => {
  const c = makeCtx(NOW);
  const oat = F.newFood({ name: 'Овсянка', nutrients: { kcal: 350 } }, c);
  let e = F.newEntry({ date: TODAY, meal: 'breakfast', items: [{ food: oat, amount: 60, note: '4 ед. инсулина' }, { quick: { name: 'Кофе', nutrients: { kcal: 5 } } }] }, c);
  const [oatItem, coffee] = F.entryItems(e);
  assert.equal(oatItem.note, '4 ед. инсулина');
  assert.equal(coffee.note, undefined, 'без заметки — поля нет');
  e = F.setItemNote(e, coffee.id, 'без сахара', c);
  assert.equal(F.entryItems(e)[1].note, 'без сахара');
  const other = { ...makeCtx(NOW + 5000), deviceId: '01926f3a-8c1e-7b2a-9f00-000000000002' };
  const a = F.setItemNote(e, oatItem.id, '5 ед.', c);
  const b = F.setItemAmount(e, coffee.id, 2, other);
  const m = mergeEntity(a, b);
  assert.equal(F.entryItems(m)[0].note, '5 ед.');
  assert.equal(F.entryItems(m)[1].amount, 2, 'заметка и количество с двух устройств — оба');
  const copy = F.newEntry({ date: '2026-10-09', meal: 'breakfast', items: F.entryItems(m).map((it) => ({ snapshot: it })) }, c);
  assert.equal(copy.items.find((x) => x.name === 'Овсянка').note, '5 ед.');
  assert.equal(F.entryItems(F.setItemNote(m, oatItem.id, '', c))[0].note, '');
});

test('Лекарства (0.12.5): в общем каталоге, доза и форма, без КБЖУ и наград, к продукту и отдельной записью', () => {
  const c = makeCtx(NOW);
  const d = feastData();
  const ins = put(d, 'foods', F.newFood({ name: 'Инсулин', kind: 'med', unit: 'iu', dose: 4 }, c));
  assert.ok(F.isMed(ins) && ins.unit === 'iu' && ins.dose === 4);
  assert.equal(F.newFood({ name: 'Капли', kind: 'med', unit: 'g' }, c).unit, 'tab', 'неизвестная форма — таблетки');
  assert.equal(F.editFood(ins, { unit: 'drop', dose: '2,5' }, c).dose, 2.5);
  const cake = put(d, 'foods', F.newFood({ name: 'Торт', nutrients: { kcal: 350 } }, c));
  const linked = F.editFood(cake, { meds: [{ medId: ins.id, amount: 6 }, { medId: ins.id, amount: 1 }, { medId: '' }] }, c);
  assert.deepEqual(linked.meds, [{ medId: ins.id, amount: 6 }], 'без повторов и пустых');
  const e = put(d, 'entries', F.newEntry({ date: TODAY, meal: 'dinner', items: [{ food: cake, amount: 100 }, { med: ins, amount: 6, note: 'перед едой' }] }, c));
  const [, med] = F.entryItems(e);
  assert.equal(med.kind, 'med');
  assert.equal(N.amountLabel(med), '6 ед.');
  assert.equal(nv(entryNutrients(e), 'kcal'), 350, 'лекарство без КБЖУ не добавляет калорий');
  assert.equal(med.note, 'перед едой');
  const only = put(d, 'entries', F.newEntry({ date: TODAY, meal: 'snack', items: [{ med: ins }] }, c));
  assert.equal(F.entryItems(only)[0].amount, 4, 'без дозы — обычная доза');
  assert.ok(F.hasFood(e) && !F.hasFood(only));
  assert.equal(F.dayTotals(d, TODAY).count, 2);
  const st = F.periodStats(d, TODAY, TODAY, 2000);
  assert.ok(!st.topByCount.some((x) => x.name === 'Инсулин'), 'в топе продуктов лекарств нет');
  const ms = F.medStats(d, addDays(TODAY, -6), TODAY);
  assert.equal(ms.intakes, 2);
  assert.equal(ms.meds[0].amount, 10);
  assert.equal(ms.days, 1);
  assert.equal(ms.log.length, 2);
  assert.deepEqual(ms.log.find((l) => l.entryId === e.id).foods, ['Торт']);
  const a = F.archiveFor(TODAY, [e, only], undefined, c);
  assert.equal(a.count, 1, 'в сводке дня «записей еды» — только с едой');
  assert.equal(Object.values(a.meds)[0].amount, 10);
  const d2 = feastData();
  put(d2, 'dayArchive', a);
  assert.equal(F.medStats(d2, TODAY, TODAY).meds[0].count, 2, 'старые дни — из сводки');
});

test('Заметки записи (0.12.5): сколько угодно, первая — в note, правка и удаление поэлементно, слияние', () => {
  const c = makeCtx(NOW);
  const oat = F.newFood({ name: 'Овсянка', nutrients: { kcal: 350 } }, c);
  let e = F.newEntry({ date: TODAY, meal: 'breakfast', notes: ['раз', '', 'два', 'три'], items: [{ food: oat, amount: 60 }] }, c);
  assert.equal(e.note, 'раз');
  assert.deepEqual(F.entryNoteList(e).map((n) => n.text), ['раз', 'два', 'три']);
  const [, two] = F.entryNoteList(e);
  const other = { ...makeCtx(NOW + 5000), deviceId: OTHER };
  const a = F.editEntryNote(e, two.id, 'два!', c);
  const b = F.addEntryNote(e, 'четыре', other);
  const m = mergeEntity(a, b);
  assert.deepEqual(F.entryNoteList(m).map((n) => n.text), ['раз', 'два!', 'три', 'четыре'], 'правка и новая заметка с двух устройств');
  let x = F.editEntryNote(m, F.MAIN_NOTE, '', c);
  x = F.editEntryNote(x, two.id, '', c);
  assert.deepEqual(F.entryNoteList(x).map((n) => n.text), ['три', 'четыре']);
  x = F.addEntryNote(x, 'пять', c);
  assert.deepEqual(F.entryNoteList(x).map((n) => n.text), ['три', 'четыре', 'пять'], 'новая — в конец, даже если первую убрали');
  const legacy = { ...F.newEntry({ date: TODAY, meal: 'lunch', note: 'старая', items: [{ food: oat, amount: 1 }] }, c) };
  delete legacy.notes;
  assert.deepEqual(F.entryNoteList(legacy).map((n) => n.text), ['старая'], 'запись без массива заметок');
});

// ---------- 0.13: замеры, заметка без продуктов, КБЖУ лекарств, графики лекарств ----------

test('Замеры (0.13): части значения, нормы с запятой, значения, статус и подписи', () => {
  assert.deepEqual(M.cleanParts(['Верхнее']), [], 'одна часть — одно значение');
  assert.deepEqual(M.cleanParts(['Верхнее', '']), ['Верхнее', 'Значение 2']);
  assert.equal(M.cleanParts(['a', 'b', 'c', 'd']).length, 3, 'не больше трёх частей');
  assert.deepEqual(M.cleanRanges([{ min: '3,9', max: '7,8' }], 1), [{ min: 3.9, max: 7.8 }]);
  assert.deepEqual(M.cleanRanges([{ min: 9, max: 5 }, { min: '', max: '' }], 2), [{ min: 5, max: 9 }, null], 'перепутанные — меняются местами, пустая — нет нормы');
  assert.deepEqual(M.cleanValues(['120', '80,5'], 2), [120, 80.5]);
  assert.deepEqual(M.cleanValues(['', '80'], 2), [null, 80]);
  assert.equal(M.cleanValues(['', ''], 2), null, 'ни одного числа — нет показания');
  assert.deepEqual(M.cleanValues('5,6'), [5.6], 'одно значение — не массивом');
  const bp = [{ min: 90, max: 139 }, { min: 60, max: 89 }];
  assert.equal(M.readingStatus([145, 80], bp), 'high');
  assert.equal(M.readingStatus([120, 55], bp), 'low');
  assert.equal(M.readingStatus([120, 80], bp), 'ok');
  assert.equal(M.readingStatus([120, 80], [null, null]), null, 'без нормы — без статуса');
  assert.equal(M.readingStatus([null, 95], bp), 'high', 'пустая часть не мешает');
  assert.equal(M.valuesText([120, 80]), '120/80');
  assert.equal(M.normText({ unit: 'ммоль/л', ranges: [{ min: 3.9, max: 7.8 }] }), '3,9–7,8 ммоль/л');
  assert.equal(M.rangeText({ min: null, max: 5.2 }), '≤ 5,2');
  assert.ok(M.MEASURE_PRESETS.every((p) => p.name && p.unit && (p.parts || [null]).length === (p.ranges || [null]).length), 'у известных замеров норма на каждую часть');
});

test('Замеры (0.13): вид замера в каталоге, правка частей, показание в записи, правка значений', () => {
  const c = makeCtx(NOW);
  const p = M.presetOf('pressure');
  const bp = F.newFood({ kind: 'measure', name: p.name, unit: p.unit, parts: p.parts, ranges: p.ranges, icon: '❤️ лишнее' }, c);
  assert.ok(F.isMeasure(bp) && bp.unit === 'мм рт. ст.');
  assert.deepEqual(bp.parts, ['Верхнее', 'Нижнее']);
  assert.equal(bp.ranges.length, 2);
  assert.ok([...bp.icon].length <= 4, 'значок — коротко');
  const one = F.editFood(bp, { parts: [] }, c);
  assert.deepEqual(one.parts, []);
  assert.deepEqual(one.ranges, [{ min: 90, max: 139 }], 'норма — по числу частей');
  const glu = F.newFood({ kind: 'measure', name: 'Глюкоза', unit: '  ммоль/л ', ranges: [{ min: 3.9, max: 7.8 }] }, c);
  assert.equal(glu.unit, 'ммоль/л');
  const e = F.newEntry({ date: TODAY, meal: 'breakfast', time: '08:00', items: [{ measure: bp, values: ['145', '92'], note: 'после кофе' }, { food: glu, values: '5,4' }] }, c);
  const [a, b] = F.entryItems(e);
  assert.equal(a.kind, 'measure');
  assert.deepEqual(a.values, [145, 92]);
  assert.equal(a.amount, 145, 'amount — первое значение (для старых версий)');
  assert.equal(a.note, 'после кофе');
  assert.equal(N.amountLabel(a), '145/92 мм рт. ст.');
  assert.deepEqual(b.values, [5.4]);
  assert.deepEqual(entryNutrients(e), {}, 'у замера нет калорий');
  assert.ok(!F.hasFood(e), 'замер — не еда');
  const x = F.setItemValues(e, a.id, ['128', '84'], c);
  assert.deepEqual(F.entryItems(x)[0].values, [128, 84]);
  assert.equal(F.entryItems(x)[0].amount, 128);
  assert.equal(F.setItemValues(e, a.id, ['', ''], c), e, 'пустые значения — без изменений');
  const copy = F.newEntry({ date: '2026-10-09', meal: 'breakfast', items: F.entryItems(x).map((it) => ({ snapshot: it })) }, c);
  assert.deepEqual(F.entryItems(copy)[0].values, [128, 84], 'копия записи — с показанием');
});

test('Заметка без продуктов (0.13): запись только с заметкой, название, не еда', () => {
  const c = makeCtx(NOW);
  const d = feastData();
  const e = put(d, 'entries', F.newEntry({ date: TODAY, meal: 'snack', time: '09:00', items: [], notes: ['Голова болит с утра'] }, c));
  assert.equal(F.entryItems(e).length, 0);
  assert.equal(F.entryTitle(e), 'Заметка');
  assert.ok(!F.hasFood(e));
  assert.deepEqual(entryNutrients(e), {});
  assert.equal(F.entryTitle(F.newEntry({ date: TODAY, meal: 'snack', items: [] }, c)), 'Пустая запись');
  assert.equal(F.dailySeries(d, TODAY, TODAY).length, 0, 'в калориях дня заметки нет');
});

test('Лекарства с КБЖУ (0.13): сироп — калории и витамины на 1 единицу, складываются с едой', () => {
  const c = makeCtx(NOW);
  const d = feastData();
  const syrup = put(d, 'foods', F.newFood({ kind: 'med', name: 'Сироп', unit: 'mlm', dose: 5, nutrients: { kcal: 3, carbs: 0.7, vitC: 2 } }, c));
  const oat = put(d, 'foods', F.newFood({ name: 'Овсянка', nutrients: { kcal: 350 } }, c));
  const e = put(d, 'entries', F.newEntry({ date: TODAY, meal: 'breakfast', items: [{ med: syrup }] }, c));
  const it = F.entryItems(e)[0];
  assert.equal(it.amount, 5, 'обычная доза');
  assert.equal(nv(N.itemNutrients(it), 'kcal'), 15);
  assert.equal(nv(N.itemNutrients(it), 'vitC'), 10);
  assert.ok(!F.hasFood(e));
  const day = F.dailySeries(d, TODAY, TODAY);
  assert.equal(day.length, 1, 'сироп виден в калориях дня');
  assert.equal(nv(day[0].totals, 'kcal'), 15);
  assert.equal(day[0].count, 0, 'но записью еды не считается');
  put(d, 'entries', F.newEntry({ date: TODAY, meal: 'breakfast', items: [{ food: oat, amount: 100 }, { med: syrup, amount: 10 }] }, c));
  assert.equal(nv(F.dailySeries(d, TODAY, TODAY)[0].totals, 'kcal'), 15 + 350 + 30);
  const desc = F.editFood(syrup, { desc: 'Детский, 3 раза в день', measures: [{ measureId: 'm1' }, { measureId: 'm1' }, { measureId: '' }] }, c);
  assert.equal(desc.desc, 'Детский, 3 раза в день');
  assert.equal(desc.measures.length, 1, 'привязанные замеры — без повторов и пустых');
});

test('Замеры за период (0.13): показания по времени, среднее и разброс по частям, сводки старых дней', () => {
  const c = makeCtx(NOW);
  const d = feastData();
  const bp = put(d, 'foods', F.newFood({ kind: 'measure', name: 'Давление', unit: 'мм рт. ст.', parts: ['Верхнее', 'Нижнее'] }, c));
  const ins = put(d, 'foods', F.newFood({ kind: 'med', name: 'Инсулин', unit: 'iu', dose: 4 }, c));
  put(d, 'entries', F.newEntry({ date: TODAY, meal: 'breakfast', time: '08:00', items: [{ measure: bp, values: [130, 85] }, { med: ins }] }, c));
  put(d, 'entries', F.newEntry({ date: TODAY, meal: 'dinner', time: '20:00', items: [{ measure: bp, values: [120, 75], note: 'вечером' }] }, c));
  const old = F.newEntry({ date: '2026-09-01', meal: 'lunch', time: '13:00', items: [{ measure: bp, values: [140, 90] }] }, c);
  put(d, 'dayArchive', F.archiveFor('2026-09-01', [old], null, c));
  const st = F.measureStats(d, '2026-09-01', TODAY);
  assert.equal(st.count, 3);
  const t = st.types[0];
  assert.equal(t.name, 'Давление');
  assert.deepEqual(t.readings.map((r) => r.values), [[140, 90], [130, 85], [120, 75]], 'по времени, старые — из сводки');
  assert.ok(t.readings[0].archived);
  assert.deepEqual(t.readings[1].meds, ['Инсулин'], 'с лекарствами той же записи');
  assert.equal(t.readings[2].note, 'вечером');
  assert.deepEqual(t.last.values, [120, 75]);
  assert.equal(t.stat[0].avg, 130);
  assert.deepEqual([t.stat[1].min, t.stat[1].max], [75, 90]);
  assert.equal(F.measureStats(d, TODAY, TODAY).count, 2, 'только период');
});

test('Графики лекарств (0.13): по часам, дням, месяцам и годам; приёмы и количество; сводки дней', () => {
  const c = makeCtx(NOW);
  const d = feastData();
  const a = put(d, 'foods', F.newFood({ kind: 'med', name: 'Лантус', unit: 'iu', dose: 20 }, c));
  const b = put(d, 'foods', F.newFood({ kind: 'med', name: 'Фиасп', unit: 'iu', dose: 6 }, c));
  put(d, 'entries', F.newEntry({ date: TODAY, meal: 'snack', time: '22:00', items: [{ med: a, amount: 18 }] }, c));
  put(d, 'entries', F.newEntry({ date: TODAY, meal: 'breakfast', time: '08:10', items: [{ med: b, amount: 5 }] }, c));
  put(d, 'entries', F.newEntry({ date: '2026-10-07', meal: 'breakfast', time: '08:40', items: [{ med: b, amount: 7 }] }, c));
  const old = F.newEntry({ date: '2025-12-31', meal: 'snack', time: '22:00', items: [{ med: a, amount: 20 }] }, c);
  put(d, 'dayArchive', F.archiveFor('2025-12-31', [old], null, c));
  const st = F.medStats(d, '2025-12-01', TODAY);
  const args = { log: st.log, extra: st.extra, from: '2025-12-01', to: TODAY };
  const hours = F.medBuckets({ ...args, group: 'hour' });
  assert.equal(hours.length, 24);
  assert.deepEqual(hours[8].values, { [b.id]: 2 }, 'по часу суток — за весь период');
  assert.equal(hours[22].values[a.id], 1, 'сводки старых дней без времени — не по часам');
  const days = F.medBuckets({ ...args, group: 'day', metric: 'amount' });
  assert.equal(days.at(-1).key, TODAY);
  assert.deepEqual(days.at(-1).values, { [a.id]: 18, [b.id]: 5 });
  assert.equal(days.find((x) => x.key === '2025-12-31').values[a.id], 20, 'старый день — из сводки');
  assert.equal(days.at(-1).title, '8 октября 2026');
  const months = F.medBuckets({ ...args, group: 'month', metric: 'amount', keys: [b.id] });
  assert.deepEqual(months.map((x) => x.key), ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  assert.deepEqual(months.at(-1).values, { [b.id]: 12 }, 'только выбранные лекарства');
  assert.equal(months.at(-1).title, 'Октябрь 2026');
  const years = F.medBuckets({ ...args, group: 'year' });
  assert.deepEqual(years.map((x) => [x.key, x.values[a.id] || 0]), [['2025', 1], ['2026', 1]]);
  assert.deepEqual(F.MED_GROUPS, ['hour', 'day', 'month', 'year']);
});

test('Активность «Без надбавки» (0.13): расход — только базовый обмен', () => {
  const p = { sex: 'male', weightKg: 80, heightCm: 180, age: 30, activity: 'none', goal: 'keep' };
  assert.equal(B.ACTIVITY[0].key, 'none');
  assert.equal(B.activityBurn(B.activityOf('none'), 1780), 0);
  assert.equal(B.tdee(p), B.bmr(p));
  assert.equal(B.activityOf('нет такой').key, 'light', 'неизвестная — по-прежнему лёгкая');
});

// ---------- 0.14: проверка КБЖУ, порции, значки, корзина, срок хранения истории ----------

test('Калории и БЖУ (0.14): сходятся, не сходятся, нет БЖУ, нет калорий; клетчатка и допуск', () => {
  assert.equal(N.kcalCheck({ kcal: 75, protein: 1.7, fat: 6.1, carbs: 3.3 }).state, 'ok', 'молоко с упаковки');
  assert.equal(N.kcalCheck({ kcal: 120, protein: 6, fat: 20, carbs: 60 }).state, 'low');
  assert.equal(N.kcalCheck({ kcal: 120, protein: 6, fat: 20, carbs: 60 }).auto, 444);
  assert.equal(N.kcalCheck({ kcal: 43, carbs: 3.6 }).state, 'high', 'пиво: калории от алкоголя');
  assert.equal(N.kcalCheck({ kcal: 250, protein: 9, fat: 3, carbs: 45, fiber: 7 }).state, 'ok', 'клетчатка — до 2 ккал/г');
  assert.equal(N.kcalCheck({ kcal: 100 }).state, 'noMacros');
  assert.equal(N.kcalCheck({ protein: 10 }).state, 'noKcal');
  assert.equal(N.kcalCheck({}).state, 'empty');
  assert.equal(N.kcalCheck({ kcal: 1, carbs: 0.2 }).state, 'ok', 'мелкие числа — в допуске');
});

test('Порции (0.14): сколько угодно своих, первая — в старых полях; продукт 0.13 — одна порция', () => {
  const c = makeCtx(NOW);
  const milk = F.newFood({ name: 'Молоко', unit: 'ml', servings: [{ name: 'Стакан', size: '250' }, { name: '', size: 0 }, { name: 'Чашка', size: '180,5' }] }, c);
  assert.deepEqual(F.servingsOf(milk).map((s) => [s.name, s.size]), [['Стакан', 250], ['Чашка', 180.5]], 'пустые и нулевые — отбрасываются');
  assert.equal(milk.servingName, 'Стакан');
  assert.equal(milk.servingSize, 250, 'первую видят старые версии');
  assert.ok(F.servingsOf(milk).every((s) => s.id && s.id !== 'legacy'));
  const ids = F.servingsOf(milk).map((s) => s.id);
  const edited = F.editFood(milk, { servings: [F.servingsOf(milk)[1], { name: 'Ложка', size: 15 }] }, c);
  assert.equal(edited.servingName, 'Чашка');
  assert.equal(F.servingsOf(edited)[0].id, ids[1], 'id порции сохраняется');
  assert.equal(F.servingOf(edited), 180.5);
  const none = F.editFood(edited, { servings: [] }, c);
  assert.deepEqual([none.servingName, none.servingSize, F.servingsOf(none).length], ['', null, 0]);
  const old = F.newFood({ name: 'Йогурт', servingName: 'Баночка', servingSize: 125 }, c);
  assert.deepEqual(F.servingsOf(old).map((s) => [s.name, s.size]), [['Баночка', 125]], 'порция 0.13 читается');
  const legacy = { ...old };
  delete legacy.servings;
  assert.equal(F.servingsOf(legacy)[0].id, 'legacy');
  assert.equal(F.cleanServings(Array.from({ length: 30 }, (_, i) => ({ size: i + 1 })), c).length, F.SERVINGS_MAX);
});

test('Значок лекарства (0.14): свой или 💊; у замера — 📏', () => {
  const c = makeCtx(NOW);
  const pen = F.newFood({ kind: 'med', name: 'Ручка', unit: 'iu', icon: '🔵' }, c);
  assert.equal(pen.icon, '🔵');
  assert.equal(F.kindIcon(pen), '🔵');
  assert.equal(F.kindIcon(F.editFood(pen, { icon: '' }, c)), '💊');
  assert.equal(F.kindIcon(F.newFood({ kind: 'measure', name: 'Пульс', unit: 'уд/мин' }, c)), '📏');
  assert.equal(F.kindIcon(F.newFood({ name: 'Хлеб' }, c)), '');
});

test('Корзина (0.14): снимок удалённого, вернуть со свежими метками — побеждает надгробие на других устройствах', () => {
  const c = makeCtx(NOW);
  const other = { ...makeCtx(NOW + 1000), deviceId: OTHER };
  const d = feastData();
  d.trash = new Map();
  const oat = put(d, 'foods', F.newFood({ name: 'Овсянка', nutrients: { kcal: 350 } }, c));
  const e = F.newEntry({ date: TODAY, meal: 'breakfast', time: '08:00', notes: ['раз', 'два'], items: [{ food: oat, amount: 60, note: 'с мёдом' }] }, c);
  const rec = F.newTrashRecord('entries', e, c);
  const tomb = tombstone(e, c);
  put(d, 'entries', tomb);
  put(d, 'trash', rec);
  assert.equal(rec.id, F.trashId('entries', e.id));
  assert.equal(F.trashKind(rec), 'entry');
  assert.equal(F.trashKind(F.newTrashRecord('foods', F.newFood({ kind: 'med', name: 'Т' }, c), c)), 'med');
  assert.deepEqual(F.trashList(d).map((r) => r.id), [rec.id]);
  const back = F.restoreEntity(tomb, rec.snapshot, other);
  assert.ok(!back.deletedAt);
  assert.deepEqual(F.entryItems(back).map((it) => [it.name, it.amount, it.note]), [['Овсянка', 60, 'с мёдом']]);
  assert.deepEqual(F.entryNoteList(back).map((n) => n.text), ['раз', 'два']);
  const merged = mergeEntity(tomb, back);
  assert.ok(!merged.deletedAt, 'возврат новее удаления — запись жива и после слияния');
  assert.equal(nv(entryNutrients(mergeEntity(back, tomb)), 'kcal'), 210);
  const fresh = F.restoreEntity(undefined, rec.snapshot, other);
  assert.ok(!fresh.deletedAt && F.entryItems(fresh).length === 1, 'надгробия уже нет — тоже возвращается');
  assert.equal(F.trashExpired(d, Date.parse(rec.trashedAt) + 29 * 86400000).length, 0);
  assert.equal(F.trashExpired(d, Date.parse(rec.trashedAt) + 31 * 86400000).length, 1, 'по умолчанию — 30 дней');
  d.settings = { ...d.settings, trashDays: 2 };
  assert.equal(F.trashExpired(d, Date.parse(rec.trashedAt) + 3 * 86400000).length, 1);
  assert.equal(F.trashDaysOf({ trashDays: 9999 }), 365);
});

test('Срок хранения истории (0.14): старые записи и статистика уходят, награды за еду остаются', () => {
  const c = makeCtx(NOW);
  const d = feastData();
  const apple = put(d, 'foods', F.newFood({ name: 'Яблоко', nutrients: { kcal: 50 }, rewards: { xp: 2, coins: 1 } }, c));
  const old = put(d, 'entries', F.newEntry({ date: '2026-08-01', meal: 'snack', items: [{ food: apple, amount: 100, rewards: F.rewardsOf(apple, d.settings) }] }, c));
  put(d, 'entries', F.newEntry({ date: TODAY, meal: 'snack', items: [{ food: apple, amount: 100, rewards: F.rewardsOf(apple, d.settings) }] }, c));
  const arch = put(d, 'dayArchive', F.archiveFor('2026-07-01', [F.newEntry({ date: '2026-07-01', meal: 'lunch', items: [{ food: apple, amount: 200, rewards: F.rewardsOf(apple, d.settings) }] }, c)], null, c));
  const before = F.feastRewards(d);
  assert.equal(F.historyDaysOf({ historyDays: 5 }), 30, 'не меньше 30 дней');
  assert.equal(F.historyDaysOf({ historyDays: null }), null);
  assert.equal(F.historyPlan(d, TODAY, null).entries.length, 0, 'без срока — ничего');
  const plan = F.historyPlan(d, TODAY, 30);
  assert.equal(plan.cutoff, addDays(TODAY, -29));
  assert.deepEqual(plan.entries.map((e) => e.id), [old.id]);
  assert.deepEqual(plan.archives.map((a) => a.id), [arch.id]);
  // как purgeHistory: день — «заглушка» с наградами, записи — надгробия
  const s1 = F.strippedArchive('2026-08-01', [old], null, c);
  const s2 = F.strippedArchive('2026-07-01', [], arch, c);
  put(d, 'entries', tombstone(old, c));
  put(d, 'dayArchive', s1);
  put(d, 'dayArchive', s2);
  assert.ok(s1.stripped && s2.stripped);
  assert.deepEqual([s2.totals, s2.foods, s2.count], [{}, {}, 0], 'статистики нет');
  assert.deepEqual(F.feastRewards(d), before, 'монеты, опыт и 💎 за еду не пропали');
  assert.equal(F.dailySeries(d, '2026-06-01', TODAY).length, 1, 'в аналитике — только живой день');
  assert.equal(F.firstDay(d), TODAY, '«Всё время» начинается с живых данных');
  assert.ok(!F.dayTotals(d, '2026-07-01').archived);
  const plain = F.newFood({ name: 'Вода' }, c);
  assert.equal(F.strippedArchive(TODAY, [F.newEntry({ date: TODAY, meal: 'snack', items: [{ food: plain, amount: 100 }] }, c)], null, c), null, 'без наград сводка не нужна');
});

test('Перенос продукта между записями (0.14.1): один продукт, время и рацион — у целевой, пустая запись — удаляется', () => {
  const c = makeCtx(NOW);
  const d = feastData();
  const cut = put(d, 'foods', F.newFood({ name: 'Котлеты', nutrients: { kcal: 240 }, rewards: { coins: 1 } }, c));
  const rice = put(d, 'foods', F.newFood({ name: 'Рис', nutrients: { kcal: 101 }, rewards: { coins: 1 } }, c));
  const a = put(d, 'entries', F.newEntry({ date: TODAY, meal: 'lunch', time: '15:32', items: [{ food: cut, amount: 200, rewards: F.rewardsOf(cut, d.settings) }] }, c));
  const b = put(d, 'entries', F.newEntry({ date: TODAY, meal: 'dinner', time: '15:48', items: [{ food: rice, amount: 260, note: 'с маслом', rewards: F.rewardsOf(rice, d.settings) }] }, c));
  const before = F.feastRewards(d);
  const [riceItem] = F.entryItems(b);
  const res = F.moveItem(b, riceItem.id, a, c);
  assert.deepEqual(F.entryItems(res.to).map((it) => [it.name, it.amount]), [['Котлеты', 200], ['Рис', 260]], 'рис — в конце записи с котлетами');
  assert.equal(F.entryItems(res.to)[1].note, 'с маслом', 'заметка к продукту переезжает с ним');
  assert.equal(res.to.time, '15:32');
  assert.equal(res.to.meal, 'lunch');
  assert.ok(F.isEmptyEntry(res.from), 'в записи риса ничего не осталось');
  put(d, 'entries', res.to);
  put(d, 'entries', tombstone(res.from, c));
  assert.deepEqual(F.feastRewards(d), before, 'награды не задваиваются и не теряются');
  assert.equal(Math.round(nv(F.dayTotals(d, TODAY).totals, 'kcal')), 743);
  // обратно отдельной записью — в другой рацион, со временем исходной записи
  const [, back] = F.entryItems(res.to);
  const out = F.moveItem(res.to, back.id, null, c, { meal: 'snack' });
  assert.deepEqual([out.to.meal, out.to.time, F.entryItems(out.to).length], ['snack', '15:32', 1]);
  assert.ok(!F.isEmptyEntry(out.from), 'котлеты остались');
  assert.equal(F.moveItem(res.to, back.id, res.to, c), null, 'в ту же запись — нельзя');
  assert.equal(F.moveItem(res.to, 'нет такого', a, c), null);
  // запись с заметкой без продуктов — остаётся
  const noted = F.newEntry({ date: TODAY, meal: 'lunch', notes: ['после тренировки'], items: [{ food: rice, amount: 100 }] }, c);
  const left = F.moveItem(noted, F.entryItems(noted)[0].id, a, c);
  assert.ok(!F.isEmptyEntry(left.from), 'заметка держит запись');
  // запись 0.11 (продукт в полях самой записи)
  const legacy = { ...F.newEntry({ date: TODAY, meal: 'lunch', items: [{ food: rice, amount: 50 }] }, c) };
  delete legacy.items;
  Object.assign(legacy, { foodId: rice.id, name: 'Рис', amount: 50, unit: 'g', nutrients: { kcal: 101 } });
  const up = F.upgradeEntry(legacy, c);
  const moved = F.moveItem(up, legacy.id, a, c);
  assert.equal(F.entryItems(moved.to).at(-1).amount, 50);
  assert.ok(F.isEmptyEntry(moved.from));
});

test('Замеры по периодам (0.14.1): среднее, минимум и максимум по часам, дням, месяцам; части давления', () => {
  const readings = [
    { date: '2026-10-07', time: '07:30', values: [5] },
    { date: '2026-10-07', time: '13:10', values: [9] },
    { date: '2026-10-08', time: '07:40', values: [6] },
    { date: '2026-10-08', time: null, values: [7] },
  ];
  const days = M.readingBuckets({ readings, from: '2026-10-06', to: '2026-10-08', group: 'day' });
  assert.deepEqual(days.map((b) => [b.key, b.n, b.avg[0], b.min[0], b.max[0]]), [['2026-10-06', 0, null, null, null], ['2026-10-07', 2, 7, 5, 9], ['2026-10-08', 2, 6.5, 6, 7]]);
  const hours = M.readingBuckets({ readings, from: '2026-10-06', to: '2026-10-08', group: 'hour' });
  assert.equal(hours.length, 24);
  assert.deepEqual([hours[7].n, hours[7].avg[0], hours[13].avg[0]], [2, 5.5, 9], 'по часам — без показаний без времени');
  const months = M.readingBuckets({ readings, from: '2026-09-15', to: '2026-10-08', group: 'month' });
  assert.deepEqual(months.map((b) => [b.key, b.n]), [['2026-09', 0], ['2026-10', 4]]);
  const bp = M.readingBuckets({ readings: [{ date: TODAY, time: '08:00', values: [120, 80] }, { date: TODAY, time: '20:00', values: [140, null] }], from: TODAY, to: TODAY, group: 'day', parts: 2 });
  assert.deepEqual([bp[0].avg, bp[0].min, bp[0].max], [[130, 80], [120, 80], [140, 80]], 'пустая часть не мешает');
});

test('Время рациона (0.14.1): с какого до какого времени «Записать еду» кладёт записи сюда', () => {
  const d = feastData();
  assert.deepEqual(F.mealTimeInfo(d, TODAY, 'breakfast', null), { kind: 'hours' }, 'ни у кого нет времени — по часам');
  assert.deepEqual(F.mealTimeInfo(d, TODAY, 'breakfast', '08:00'), { kind: 'all' }, 'время только у этого — все записи сюда');
  d.meals.set('lunch', { ...d.meals.get('lunch'), time: '12:00' });
  d.meals.set('dinner', { ...d.meals.get('dinner'), time: '18:00' });
  assert.deepEqual(F.mealTimeInfo(d, TODAY, 'breakfast', null), { kind: 'manual' }, 'у других есть, у этого нет');
  const b = F.mealTimeInfo(d, TODAY, 'breakfast', '08:00');
  assert.deepEqual([b.kind, b.from, b.to, b.next, b.overnight], ['range', '08:00', '12:00', 'Обед', false]);
  const din = F.mealTimeInfo(d, TODAY, 'dinner', '18:00');
  assert.deepEqual([din.to, din.next, din.overnight], ['12:00', 'Обед', true], 'последний — до полуночи и ночью до первого');
  assert.equal(F.mealByTime(d, TODAY, '02:00'), 'dinner', 'ночью — последний рацион');
  assert.equal(F.mealByTime(d, TODAY, '12:30'), 'lunch');
  const fresh = F.mealTimeInfo(d, TODAY, null, '15:00');
  assert.deepEqual([fresh.from, fresh.to, fresh.next], ['15:00', '18:00', 'Ужин'], 'новый рацион — тоже');
});

test('Окно показаний (0.14.1): «Показания» листаются по неделям', async () => {
  const TW = await import('../src/core/timeWindow.js');
  assert.equal(TW.windowUnit('raw'), 'week');
  assert.equal(TW.anchorOf('raw', '2026-10-09'), '2026-10-05');
  assert.deepEqual(TW.windowRange('raw', '2026-10-05'), { from: '2026-10-05', to: '2026-10-11' });
  assert.deepEqual(TW.bucketSkeleton('2026-10-01', '2026-10-02', 'day').map((b) => b.key), ['2026-10-01', '2026-10-02']);
  assert.equal(TW.bucketKey('hour', '2026-10-01', null), null);
});

test('Порядок продуктов в записи (0.14.2): замеры сверху, лекарства снизу; перестановка; место при переносе', () => {
  const c = makeCtx(NOW);
  const other = { ...makeCtx(NOW + 5000), deviceId: OTHER };
  const tea = F.newFood({ name: 'Чай', unit: 'ml', nutrients: { kcal: 19 } }, c);
  const cut = F.newFood({ name: 'Котлеты', nutrients: { kcal: 240 } }, c);
  const rice = F.newFood({ name: 'Рис', nutrients: { kcal: 101 } }, c);
  const ins = F.newFood({ kind: 'med', name: 'Фиасп', unit: 'iu', dose: 4 }, c);
  const glu = F.newFood({ kind: 'measure', name: 'Глюкоза', unit: 'ммоль/л' }, c);
  let e = F.newEntry({ date: TODAY, meal: 'lunch', items: [{ food: tea, amount: 1000 }, { med: ins, amount: 10 }, { measure: glu, values: [3] }, { food: cut, amount: 200 }, { food: rice, amount: 260 }] }, c);
  const names = (list) => list.map((it) => it.name).join(', ');
  assert.equal(names(F.entryItems(e)), 'Чай, Фиасп, Глюкоза, Котлеты, Рис', 'как добавляли');
  assert.equal(names(F.displayItems(e)), 'Глюкоза, Чай, Котлеты, Рис, Фиасп', 'замеры, еда, лекарства');
  assert.equal(names(F.displayItems(e, false)), 'Чай, Фиасп, Глюкоза, Котлеты, Рис', 'без группировки — свой порядок');
  const id = (n) => F.entryItems(e).find((it) => it.name === n).id;
  e = F.reorderItem(e, id('Рис'), id('Чай'), c);
  assert.equal(names(F.entryItems(e)), 'Рис, Чай, Фиасп, Глюкоза, Котлеты');
  assert.equal(names(F.displayItems(e)), 'Глюкоза, Рис, Чай, Котлеты, Фиасп');
  e = F.reorderItem(e, id('Чай'), null, c);
  assert.equal(names(F.entryItems(e)).split(', ').at(-1), 'Чай', 'null — в конец');
  assert.equal(F.reorderItem(e, id('Чай'), null, c), e, 'уже на месте — без изменений');
  // слияние: перестановки с двух устройств сходятся поэлементно
  const a = F.reorderItem(e, id('Котлеты'), id('Рис'), c);
  const b = F.reorderItem(e, id('Фиасп'), null, other);
  const m = mergeEntity(a, b);
  assert.equal(names(F.entryItems(m)), 'Котлеты, Рис, Глюкоза, Чай, Фиасп', 'котлеты — первыми (одно устройство), Фиасп — последним (другое)');
  // старая запись без ключей порядка
  const legacy = { ...e, items: e.items.map((it) => ({ ...it, order: undefined })) };
  const fixed = F.reorderItem(legacy, legacy.items[0].id, null, c);
  assert.ok(F.entryItems(fixed).every((it) => it.order), 'ключи порядка появились у всех');
  // перенос в другую запись — на место
  const dest = F.newEntry({ date: TODAY, meal: 'lunch', items: [{ food: cut, amount: 100 }, { food: rice, amount: 100 }] }, c);
  const src = F.newEntry({ date: TODAY, meal: 'lunch', items: [{ food: tea, amount: 250 }] }, c);
  const res = F.moveItem(src, F.entryItems(src)[0].id, dest, c, { beforeId: F.entryItems(dest)[1].id });
  assert.equal(names(F.entryItems(res.to)), 'Котлеты, Чай, Рис', 'перед рисом');
  assert.equal(F.itemRank(F.entryItems(e).find((it) => it.name === 'Глюкоза')), 0);
});
