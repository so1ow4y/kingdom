// Feast (обновление 0.11): счётчик калорий — вещества, продукты и штрихкоды, дневник, лимит записей со сводками,
// тело (обмен, ИМТ, процент жира, тренд веса), декодер штрихкодов, таблица продуктов, формат базы, папка на Диске.

import { test, assert } from './runner.js';
import { makeCtx } from './helpers.js';
import { createFakeDrive } from './fakeDrive.js';
import {
  num, cleanNutrients, entryNutrients, dayGoals, remaining, signed, kcalFromMacros, macroSplit, fmt, nv, amountLabel,
} from '../src/core/nutrition.js';
import * as F from '../src/core/feast.js';
import * as B from '../src/core/body.js';
import { checkDigit, isValidEan, normalizeBarcode, barcodeWarning, encodeEan, decodeRow, decodeImage } from '../src/core/barcode.js';
import { numMatch, makeFoodContext, searchFoods, foodFacets, facetTerm } from '../src/core/foodQuery.js';
import { mergeEntity } from '../src/core/merge.js';
import { touch, tombstone } from '../src/core/model.js';
import { buildFeastDb, checkFeastDb, parseFeastBytes, FEAST_SCHEMA_VERSION } from '../src/data/feastEnvelope.js';
import { gzipJson } from '../src/data/serialize.js';
import { ensureLayout, ensureKingdom, renameLegacyRoot, SPACES } from '../src/google/layout.js';
import { addDays } from '../src/core/dates.js';

const NOW = Date.parse('2026-10-08T09:00:00.000Z');
const TODAY = '2026-10-08';

function feastData() {
  return {
    settings: F.defaultFeastSettings(), foods: new Map(), entries: new Map(), dayArchive: new Map(), body: new Map(),
    meals: new Map(F.defaultMeals().map((m) => [m.id, m])), mealNotes: new Map(),
  };
}
const put = (d, coll, e) => (d[coll].set(e.id, e), e);

test('Feast: числа и вещества — запятая, пусто и мусор — ноль, только известные вещества', () => {
  assert.equal(num('12,5'), 12.5);
  assert.equal(num(' 1 200 '), 1200);
  assert.equal(num('abc'), 0);
  assert.equal(num(-3), 0);
  assert.deepEqual(cleanNutrients({ kcal: '250', protein: '10,5', fat: '', carbs: 0, unknown: 5, vitC: '0,123456' }),
    { kcal: 250, protein: 10.5, vitC: 0.123 });
  assert.equal(kcalFromMacros({ protein: 10, fat: 5, carbs: 20 }), 165);
  const split = macroSplit({ protein: 25, fat: 0, carbs: 25 });
  assert.ok(Math.abs(split.protein - 0.5) < 1e-9 && split.fat === 0);
  assert.equal(fmt(1234.56, 'kcal'), '1235');
  assert.equal(fmt(3.456, 'protein'), '3,5');
  assert.equal(fmt(0.047, 'vitB12'), '0,05');
});

test('Feast: цели дня по умолчанию и «Осталось / −превышение» как в FatSecret', () => {
  assert.deepEqual(dayGoals({ kcalGoal: 2000 }), { kcal: 2000, protein: 100, fat: 66, carbs: 250 }, 'граммы по долям — вниз, чтобы не выйти за лимит');
  assert.deepEqual(dayGoals({ kcalGoal: 1800, proteinGoal: 140 }), { kcal: 1800, protein: 140, fat: 60, carbs: 225 });
  assert.equal(remaining(2000, 1753.4), 247);
  assert.equal(remaining(2000, 2247), -247);
  assert.equal(signed(-247), '−247');
  assert.equal(signed(247), '247');
});

test('Feast: продукт с несколькими штрихкодами, привязка с двух устройств сливается по коду', () => {
  const c = makeCtx(NOW);
  const f0 = F.newFood({ name: '  Творог   5% ', brand: 'Простоквашино', nutrients: { kcal: 121, protein: 17 }, barcodes: ['4 600605 012345'] }, c);
  assert.equal(f0.name, 'Творог 5%');
  assert.deepEqual(F.foodBarcodes(f0), ['4600605012345']);
  const a = F.setBarcode(f0, '4607012345674', true, makeCtx(NOW + 1000));
  const b = F.setBarcode(f0, '012345678905', true, makeCtx(NOW + 2000)); // UPC-A → EAN-13 с нулём
  const m = mergeEntity(a, b);
  assert.deepEqual(F.foodBarcodes(m), ['0012345678905', '4600605012345', '4607012345674']);
  const off = F.setBarcode(m, '4600605012345', false, makeCtx(NOW + 3000));
  assert.deepEqual(F.foodBarcodes(off), ['0012345678905', '4607012345674']);
  assert.equal(F.setBarcode(off, '4607012345674', true, makeCtx(NOW + 4000)), off, 'уже привязан — без изменений');
  const d = feastData();
  put(d, 'foods', off);
  assert.equal(F.findByBarcode(d, '012345678905')?.id, off.id);
  assert.equal(F.findByBarcode(d, '4600605012345'), null);
  const edited = F.editFood(off, { name: '', nutrients: { kcal: '130', fat: 'x' }, servingSize: '200', unit: 'kg' }, makeCtx(NOW + 5000));
  assert.equal(edited.name, 'Творог 5%', 'пустое название не стирает старое');
  assert.deepEqual(edited.nutrients, { kcal: 130 });
  assert.equal(edited.servingSize, 200);
  assert.equal(edited.unit, 'g');
});

test('Feast: запись — снимок продукта; правка продукта прошлое не меняет; быстрая запись — на порцию', () => {
  const c = makeCtx(NOW);
  const food = F.newFood({ name: 'Овсянка', brand: 'Геркулес', nutrients: { kcal: 352, protein: 12, fat: 6, carbs: 60 } }, c);
  const e = F.newEntry({ date: TODAY, meal: 'breakfast', food, amount: 60 }, c);
  assert.equal(F.entryTitle(e), 'Овсянка (Геркулес)');
  assert.equal(Math.round(nv(entryNutrients(e), 'kcal')), 211);
  assert.equal(amountLabel(F.entryItems(e)[0]), '60 г');
  const changed = F.editFood(food, { nutrients: { kcal: 400 } }, c);
  assert.ok(changed !== food && e.items[0].nutrients.kcal === 352, 'в записи — значения на момент записи');
  const q = F.newEntry({ date: TODAY, meal: '', quick: { name: '', nutrients: { kcal: 300, protein: 10 } }, amount: 2 }, c);
  assert.equal(q.meal, 'snack');
  assert.equal(F.entryTitle(q), 'Быстрая запись');
  assert.equal(nv(entryNutrients(q), 'kcal'), 600);
  assert.equal(nv(entryNutrients(tombstone(q, c)), 'kcal'), 0, 'удалённая запись не считается');
});

test('Feast: итоги дня и периода — приёмы пищи, дни сверх лимита, топ продуктов', () => {
  const d = feastData();
  const c = makeCtx(NOW);
  const oat = put(d, 'foods', F.newFood({ name: 'Овсянка', nutrients: { kcal: 350, protein: 12, fat: 6, carbs: 60 } }, c));
  const choc = put(d, 'foods', F.newFood({ name: 'Шоколад', nutrients: { kcal: 540, fat: 35 } }, c));
  for (let i = 0; i < 5; i++) {
    const date = addDays(TODAY, -i);
    put(d, 'entries', F.newEntry({ date, meal: 'breakfast', food: oat, amount: 100 }, c));
    if (i % 2 === 0) put(d, 'entries', F.newEntry({ date, meal: 'snack', food: choc, amount: 300 }, c));
  }
  const t = F.dayTotals(d, TODAY);
  assert.equal(t.count, 2);
  assert.equal(Math.round(nv(t.totals, 'kcal')), 1970);
  assert.equal(Math.round(nv(t.meals.breakfast, 'kcal')), 350);
  const st = F.periodStats(d, addDays(TODAY, -6), TODAY, 1500);
  assert.equal(st.days, 7);
  assert.equal(st.logged, 5);
  assert.equal(st.over, 3, 'с шоколадом — сверх лимита');
  assert.equal(st.topByKcal[0].name, 'Шоколад');
  assert.equal(st.topByCount[0].name, 'Овсянка');
  assert.equal(F.firstDay(d), addDays(TODAY, -4));
  const usage = F.foodUsage(d);
  assert.equal(usage.get(oat.id).count, 5);
});

test('Feast: лимит записей — старые дни целиком в сводки, статистика та же, последние 30 дней не трогаются', () => {
  const d = feastData();
  const c = makeCtx(NOW);
  const food = put(d, 'foods', F.newFood({ name: 'Гречка', nutrients: { kcal: 110, protein: 4, iron: 0.8 } }, c));
  for (let i = 0; i < 60; i++) {
    for (let k = 0; k < 10; k++) put(d, 'entries', F.newEntry({ date: addDays(TODAY, -i), meal: k < 5 ? 'lunch' : 'dinner', food, amount: 100 + k }, c));
  }
  d.settings = touch(d.settings, { entryLimit: 520 }, c);
  const before = F.dailySeries(d, addDays(TODAY, -70), TODAY);
  const plan = F.purgePlan(d, TODAY);
  assert.equal(plan.total, 600);
  assert.equal(plan.over, 80);
  assert.equal(plan.dates.length, 8, 'восемь самых старых дней по 10 записей');
  assert.ok(plan.dates.every((x) => x < addDays(TODAY, -30)));
  const byDate = new Map();
  for (const e of plan.entries) byDate.set(e.date, [...(byDate.get(e.date) || []), e]);
  for (const [date, list] of byDate) {
    const prev = d.dayArchive.get(F.archiveId(date));
    const a = F.archiveFor(date, list, prev, c);
    d.dayArchive.set(a.id, a);
    for (const e of list) d.entries.set(e.id, tombstone(e, c));
  }
  assert.equal(F.entryCount(d), 520);
  const after = F.dailySeries(d, addDays(TODAY, -70), TODAY);
  assert.equal(after.length, before.length);
  for (let i = 0; i < before.length; i++) {
    assert.equal(after[i].count, before[i].count, before[i].date);
    assert.ok(Math.abs(nv(after[i].totals, 'kcal') - nv(before[i].totals, 'kcal')) < 0.01);
    assert.ok(Math.abs(nv(after[i].totals, 'iron') - nv(before[i].totals, 'iron')) < 0.01, 'и витамины с минералами');
  }
  const oldDay = plan.dates[0];
  const t = F.dayTotals(d, oldDay);
  assert.ok(t.archived && t.count === 10 && Math.abs(nv(t.totals, 'kcal') - 1149.5) < 0.01, 'итоги старого дня — из сводки');
  assert.equal(F.periodStats(d, addDays(TODAY, -70), TODAY, 2000).topByCount[0].count, 600, 'топ продуктов учитывает сводки');
  assert.equal(F.purgePlan(d, TODAY).entries.length, 0, 'больше нечего удалять');
  const again = F.archiveFor(oldDay, [F.newEntry({ date: oldDay, meal: 'snack', food, amount: 100 }, c)], d.dayArchive.get(F.archiveId(oldDay)), c);
  assert.equal(again.count, 11, 'дочистка дня дописывает сводку');
});

test('Тело: обмен веществ, расход, лимит под цель, ИМТ', () => {
  const m = { sex: 'male', weightKg: 80, heightCm: 180, age: 30, activity: 'moderate', goal: 'lose' };
  assert.equal(B.bmr(m), 1780);
  assert.equal(B.tdee(m), 2759);
  assert.equal(B.recommendedKcal(m), 2260);
  const w = { sex: 'female', weightKg: 50, heightCm: 160, age: 60, activity: 'sedentary', goal: 'lose' };
  assert.equal(B.bmr(w), 1039);
  assert.equal(B.recommendedKcal(w), 1200, 'не ниже безопасного минимума');
  assert.equal(B.bmr({ ...m, heightCm: null }), null);
  assert.ok(Math.abs(B.bmi(80, 180) - 24.69) < 0.01);
  assert.equal(B.bmiClass(24.7).label, 'Норма');
  assert.equal(B.bmiClass(31).label, 'Ожирение');
  assert.equal(B.ageOn('1998-10-09', '2026-10-08'), 27);
  assert.equal(B.ageOn('1998-10-08', '2026-10-08'), 28);
  assert.ok(Math.abs(B.weightForBmi(25, 180) - 81) < 0.01);
});

test('Тело: процент жира — замер, обхваты (метод ВМС США), по ИМТ; ступени для пола', () => {
  const navyM = B.bodyFatNavy({ sex: 'male', heightCm: 178, waistCm: 85, neckCm: 38 });
  assert.ok(Math.abs(navyM - 16.43) < 0.1, String(navyM));
  const navyF = B.bodyFatNavy({ sex: 'female', heightCm: 165, waistCm: 72, hipCm: 98, neckCm: 33 });
  assert.ok(Math.abs(navyF - 26.9) < 0.1, String(navyF));
  assert.equal(B.bodyFatNavy({ sex: 'female', heightCm: 165, waistCm: 72, neckCm: 33 }), null, 'женщинам нужны бёдра');
  assert.ok(Math.abs(B.bodyFatBmi({ sex: 'male', bmi: 24.7, age: 28 }) - 19.88) < 0.01);
  const base = { sex: 'male', age: 28, heightCm: 178, weightKg: 80 };
  assert.equal(B.estimateBodyFat({ ...base, bodyFatPct: 18 }).method, 'measured');
  assert.equal(B.estimateBodyFat({ ...base, waistCm: 85, neckCm: 38 }).method, 'navy');
  assert.equal(B.estimateBodyFat(base).method, 'bmi');
  assert.equal(B.estimateBodyFat({ heightCm: 178, weightKg: 80 }), null);
  assert.equal(B.bfClass('male', 16).label, 'Подтянутый');
  assert.equal(B.bfClass('female', 16).label, 'Спортсменка');
  assert.equal(B.bfClass('male', 60).key, 'high');
  const comp = B.composition(80, 20);
  assert.deepEqual([comp.fatKg, comp.leanKg], [16, 64]);
});

test('Тело: ряд веса — один на день, среднее за 7 дней, темп в неделю', () => {
  const c = makeCtx(NOW);
  const logs = [];
  for (let i = 0; i <= 28; i += 2) logs.push(F.newBodyLog({ date: addDays(TODAY, -i), weightKg: 80 - i * 0.05 }, c));
  logs.push(touch(F.newBodyLog({ date: TODAY, weightKg: 70 }, makeCtx(NOW - 5000)), { note: 'старое' }, makeCtx(NOW - 4000)));
  const s = B.weightSeries(logs);
  assert.equal(s.length, 15, 'по одному значению на день');
  assert.equal(s.at(-1).kg, 80, 'из двух замеров дня — последний изменённый');
  const avg = B.movingAverage(s, 7);
  assert.ok(Math.abs(avg.at(-1).kg - (80 + 79.9 + 79.8 + 79.7) / 4) < 1e-9);
  assert.ok(Math.abs(B.weeklyRate(s, TODAY) - 0.35) < 1e-9, 'по 0,05 кг в день — 0,35 кг в неделю');
  assert.equal(B.latest(logs, 'weightKg', addDays(TODAY, -1))?.date, addDays(TODAY, -2));
});

// ---------- Штрихкоды ----------

function row(code, { module = 3, quiet = 12, blur = false, reverse = false, lead = 7 } = {}) {
  const mods = encodeEan(code);
  const n = Math.round((mods.length + quiet * 2) * module) + lead;
  const px = [];
  for (let x = 0; x < n; x++) {
    const m = Math.floor((x - lead) / module) - quiet;
    const bar = m >= 0 && m < mods.length && mods[m];
    px.push(bar ? 30 + ((x * 37) % 23) : 225 - ((x * 53) % 19));
  }
  const out = blur ? px.map((v, i) => (px[Math.max(0, i - 1)] + 2 * v + px[Math.min(px.length - 1, i + 1)]) / 4) : px;
  return reverse ? out.reverse() : out;
}

test('Штрихкоды: контрольная цифра, нормализация, предупреждения', () => {
  assert.equal(checkDigit('400638133393'), 1);
  assert.ok(isValidEan('4006381333931'));
  assert.ok(!isValidEan('4006381333932'));
  assert.ok(isValidEan('96385074'));
  assert.equal(normalizeBarcode(' 0 12345 67890 5 '), '0012345678905');
  assert.equal(normalizeBarcode('abc-12'), 'ABC12');
  assert.equal(normalizeBarcode('   '), null);
  assert.equal(barcodeWarning('4006381333931'), '');
  assert.ok(barcodeWarning('4006381333932').includes('Контрольная'));
  assert.ok(barcodeWarning('12345').includes('8 или 13'));
  assert.equal(encodeEan('4006381333931').length, 95);
  assert.equal(encodeEan('96385074').length, 67);
  assert.equal(encodeEan('4006381333932'), null);
});

test('Штрихкоды: свой декодер читает EAN-13 и EAN-8 — разный масштаб, размытие, вверх ногами', () => {
  for (const code of ['4006381333931', '4600605012345', '0012345678905', '9780201379624']) {
    if (!isValidEan(code)) continue;
    assert.equal(decodeRow(row(code)), code, code);
    assert.equal(decodeRow(row(code, { module: 2.6, blur: true })), code, code + ' дробный модуль и размытие');
    assert.equal(decodeRow(row(code, { module: 4, reverse: true })), code, code + ' перевёрнутый');
  }
  assert.equal(decodeRow(row('96385074', { module: 3.3 })), '96385074');
  assert.equal(decodeRow(new Array(400).fill(200)), null, 'пустая строка');
  assert.equal(decodeRow(row('4006381333931').map((v, i) => (i % 7 === 0 ? 255 - v : v))), null, 'испорченная строка не даёт ложный код');
});

test('Штрихкоды: картинка — голосование по строкам, повёрнутый на 90°', () => {
  const r = row('4600605012345', { module: 3 });
  const w = r.length;
  const h = 60;
  const img = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = (y * w + x) * 4;
    img.data[p] = img.data[p + 1] = img.data[p + 2] = r[x];
    img.data[p + 3] = 255;
  }
  const res = decodeImage(img);
  assert.equal(res.code, '4600605012345');
  assert.ok(res.votes >= 2);
  const rot = { width: h, height: w, data: new Uint8ClampedArray(w * h * 4) };
  for (let y = 0; y < w; y++) for (let x = 0; x < h; x++) {
    const p = (y * h + x) * 4;
    rot.data[p] = rot.data[p + 1] = rot.data[p + 2] = r[y];
    rot.data[p + 3] = 255;
  }
  assert.equal(decodeImage(rot)?.code, '4600605012345', 'вертикальный штрихкод');
});

// ---------- Таблица продуктов ----------

test('Продукты: числа в запросе, поиск по полям, топ значений', () => {
  assert.ok(numMatch(150, '>100') && !numMatch(100, '>100') && numMatch(100, '>=100'));
  assert.ok(numMatch(150, '100..200') && !numMatch(250, '100..200'));
  assert.ok(numMatch(10.3, '10') && !numMatch(11, '10'));
  assert.ok(numMatch(5, '<5,5'));
  const d = feastData();
  const c = makeCtx(NOW);
  put(d, 'foods', F.newFood({ name: 'Творог 5%', brand: 'Простоквашино', nutrients: { kcal: 121, protein: 17 }, barcodes: ['4600605012345'] }, c));
  put(d, 'foods', F.newFood({ name: 'Шоколад тёмный', brand: 'Бабаевский', nutrients: { kcal: 540, fat: 35, iron: 11 } }, c));
  put(d, 'foods', F.newFood({ name: 'Яблоко', nutrients: { kcal: 47, vitC: 10 } }, c));
  put(d, 'foods', tombstone(F.newFood({ name: 'Удалённый', nutrients: { kcal: 1 } }, c), c));
  const ctx = makeFoodContext(d, 'Europe/Moscow');
  const names = (q, sort) => searchFoods(ctx, q, sort).rows.map((f) => f.name);
  assert.deepEqual(names('', 'name'), ['Шоколад тёмный', 'Творог 5%', 'Яблоко'].sort((a, b) => a.localeCompare(b, 'ru')));
  assert.deepEqual(names('ккал:<150 белки:>10'), ['Творог 5%']);
  assert.deepEqual(names('штрихкод:4600605'), ['Творог 5%']);
  assert.deepEqual(names('есть:минералы'), ['Шоколад тёмный']);
  assert.deepEqual(names('есть:витамины -есть:бренд'), ['Яблоко']);
  assert.deepEqual(names('бренд:баб*'), ['Шоколад тёмный']);
  assert.deepEqual(names('4600605'), ['Творог 5%'], 'цифры без поля — начало штрихкода');
  assert.deepEqual(names('ккал:100..600', 'kcal'), ['Шоколад тёмный', 'Творог 5%']);
  assert.ok(searchFoods(ctx, 'вес:1').error.includes('Неизвестное поле'));
  const fx = foodFacets(ctx, searchFoods(ctx, '').rows);
  assert.deepEqual(fx.find((f) => f.field === 'есть').values, [{ value: 'без штрихкода', count: 2 }, { value: 'штрихкод', count: 1 }]);
  assert.deepEqual(facetTerm('бренд', 'без бренда'), ['есть', 'бренд', true]);
  assert.deepEqual(facetTerm('ккал', 'до 100 ккал'), ['ккал', '0..99.999', false]);
  assert.deepEqual(facetTerm('ккал', 'больше 400 ккал'), ['ккал', '>=400', false]);
});

// ---------- Формат и Диск ----------

test('Формат Feast: сборка и проверка базы, новее приложения — только чтение, пропущенные коллекции', async () => {
  const c = makeCtx(NOW);
  const food = F.newFood({ name: 'Банан', nutrients: { kcal: 96 }, barcodes: ['4006381333931'] }, c);
  const db = buildFeastDb({ settings: [F.defaultFeastSettings()], foods: [food], entries: [] }, { deviceId: 'dev', now: new Date(NOW) });
  assert.equal(db.format, 'crimson-feast-db');
  assert.equal(db.schemaVersion, FEAST_SCHEMA_VERSION);
  assert.deepEqual(db.data.body, []);
  const back = await parseFeastBytes(await gzipJson(db));
  assert.equal(back.data.foods[0].barcodes['4006381333931'].in, true);
  let code = '';
  try {
    checkFeastDb({ ...db, schemaVersion: FEAST_SCHEMA_VERSION + 1 });
  } catch (e) {
    code = e.code;
  }
  assert.equal(code, 'E-READONLY');
  try {
    checkFeastDb({ ...db, format: 'lifetasks-db' });
  } catch (e) {
    code = e.code;
  }
  assert.equal(code, 'E-DB-CORRUPT');
  const partial = checkFeastDb({ format: 'crimson-feast-db', schemaVersion: 1, data: { foods: [{ id: 'x', name: 'Без значений' }] } });
  assert.deepEqual(partial.data.foods[0].barcodes, {});
  assert.deepEqual(partial.data.entries, []);
});

test('Диск: папки приложений внутри общей Kingdom, папки не путаются, медиа у Crimson Harvest нет', async () => {
  const drive = createFakeDrive();
  const make = (name) => async () => new TextEncoder().encode(name);
  const tasks = await ensureLayout(drive, { cached: null, makeDbBytes: make('tasks'), makeManifest: () => '{}' });
  const feast = await ensureLayout(drive, { cached: null, makeDbBytes: make('feast'), makeManifest: () => '{}', space: SPACES.feast });
  assert.ok(tasks.created && feast.created);
  assert.ok(tasks.layout.rootId !== feast.layout.rootId);
  const root = (id) => drive.files.get(id);
  assert.equal(root(tasks.layout.rootId).name, 'Chronicle');
  assert.equal(root(feast.layout.rootId).name, 'Crimson Harvest');
  assert.equal(root(feast.layout.rootId).appProperties.feast, 'root');
  const kingdoms = [...drive.files.values()].filter((f) => f.appProperties?.kingdom === 'root');
  assert.equal(kingdoms.length, 1, 'одна общая папка на оба приложения');
  assert.equal(kingdoms[0].name, 'Kingdom');
  assert.deepEqual(root(tasks.layout.rootId).parents, [kingdoms[0].id]);
  assert.deepEqual(root(feast.layout.rootId).parents, [kingdoms[0].id]);
  assert.equal(feast.layout.mediaFolderId, null);
  assert.ok(tasks.layout.mediaFolderId);
  assert.equal(new TextDecoder().decode(await drive.download(feast.layout.dbId)), 'feast');
  // повторный поиск без кэша находит свои папки
  const t2 = await ensureLayout(drive, { cached: null, makeDbBytes: make('x'), makeManifest: () => '{}' });
  const f2 = await ensureLayout(drive, { cached: null, makeDbBytes: make('x'), makeManifest: () => '{}', space: SPACES.feast });
  assert.equal(t2.layout.dbId, tasks.layout.dbId);
  assert.equal(f2.layout.dbId, feast.layout.dbId);
  assert.ok(!t2.created && !f2.created);
});

test('Диск 0.12: старые папки находятся где угодно, «LifeTasks» → «Chronicle», «Feast» → «Crimson Harvest»', async () => {
  const drive = createFakeDrive();
  // как было в 0.11: две папки в корне «Моего диска»
  const oldTasks = await drive.createFolder('LifeTasks', null, { lifetasks: 'root' });
  const oldFeast = await drive.createFolder('Feast', null, { feast: 'root' });
  await drive.createFile({ name: 'db.json.gz', parentId: oldFeast.id, mimeType: 'application/gzip', appProperties: { feast: 'db' } }, 'x');
  await drive.createFile({ name: 'manifest.json', parentId: oldFeast.id, mimeType: 'application/json', appProperties: { feast: 'manifest' } }, '{}');
  const kingdomId = await ensureKingdom(drive);
  assert.equal(await ensureKingdom(drive), kingdomId, 'вторая папка Kingdom не создаётся');
  assert.equal(await ensureKingdom(drive, kingdomId), kingdomId);
  const f = await ensureLayout(drive, { cached: null, makeDbBytes: async () => 'y', makeManifest: () => '{}', space: SPACES.feast, parentId: kingdomId });
  assert.equal(f.layout.rootId, oldFeast.id, 'существующая папка остаётся, где лежит');
  assert.ok(!f.created);
  assert.ok(await renameLegacyRoot(drive, oldFeast.id, SPACES.feast));
  assert.equal(drive.files.get(oldFeast.id).name, 'Crimson Harvest');
  assert.ok(!(await renameLegacyRoot(drive, oldFeast.id, SPACES.feast)), 'второй раз нечего');
  assert.ok(await renameLegacyRoot(drive, oldTasks.id, SPACES.tasks));
  assert.equal(drive.files.get(oldTasks.id).name, 'Chronicle');
  // человек перенёс папку руками в Kingdom и дал своё имя — находится, имя не трогаем
  await drive.updateMeta(oldTasks.id, { name: 'Мои задачи' }, { addParents: kingdomId, removeParents: 'root' });
  assert.ok(!(await renameLegacyRoot(drive, oldTasks.id, SPACES.tasks)), 'своё имя не трогаем');
  const t = await ensureLayout(drive, { cached: null, makeDbBytes: async () => 'z', makeManifest: () => '{}', parentId: kingdomId });
  assert.equal(t.layout.rootId, oldTasks.id);
  assert.deepEqual(drive.files.get(oldTasks.id).parents, [kingdomId]);
  drive.files.get(kingdomId).trashed = true;
  const fresh = await ensureKingdom(drive, kingdomId);
  assert.ok(fresh !== kingdomId, 'Kingdom в корзине — создаётся новая');
});
