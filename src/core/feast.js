// Crimson Harvest (счётчик калорий; 0.11 — «Feast»): модель данных. Чистые функции, как core/model.js у задач.
// Формат — DATA_FORMAT §19–20: отдельная база в отдельной папке Диска, те же правила слияния
// (last-write-wins по полю, надгробия), коллекции:
//   settings   — одна запись: цели (калории, БЖУ), лимит записей дневника, данные «Обо мне»;
//   foods      — продукты: название, бренд, единица, порция, значения на 100 г/мл, штрихкоды (словарь);
//   entries    — записи дневника: дата, рацион, время, заметка и продукты (items — снимки продуктов с количеством);
//   meals      — рационы (0.12): общие для всех дней (date = null) и только для одного дня; порядок — дробные ключи;
//   mealNotes  — заметки к рациону на конкретный день (0.12);
//   dayArchive — сводки дней, чьи записи удалены лимитом (статистика остаётся);
//   body       — замеры: вес, обхваты, процент жира.

import { uuidv7 } from './ids.js';
import { touch, touchNested, removeNested } from './model.js';
import { keyBetween, byOrder } from './order.js';
import {
  cleanNutrients, num, entryNutrients, itemNutrients, sumNutrients, addNutrients, nv, MEALS, NUTRIENT_KEYS, MED_UNIT,
} from './nutrition.js';
import { addDays, daysBetween, longDate, MONTH_NOM } from './dates.js';
import { normalizeBarcode } from './barcode.js';
import { DEFAULTS_CREATED_AT, DEFAULTS_DEVICE_ID, FEAST_RETENTION } from '../config.js';
import { tr } from './i18n.js';
import { isMeasure, cleanUnit, cleanParts, cleanRanges, cleanValues, partCount } from './measures.js';

export const FEAST_SETTINGS_ID = '00000000-0000-7000-8000-00000000f001';
export const FEAST_COLLECTIONS = ['settings', 'foods', 'entries', 'dayArchive', 'body', 'meals', 'mealNotes'];

// 0.12: награды за еду по умолчанию (rewardXp, rewardCoins, rewardGems) и настройка рекомендации калорий
// (loseKcal — дефицит для похудения, gainKcal — профицит для набора, minKcal — нижняя граница, recKcal — своя рекомендация).
export const FEAST_SETTINGS_FIELDS = ['kcalGoal', 'proteinGoal', 'fatGoal', 'carbsGoal', 'entryLimit',
  'rewardXp', 'rewardCoins', 'rewardGems', 'loseKcal', 'gainKcal', 'minKcal', 'recKcal',
  'macroMode', 'proteinPct', 'fatPct', 'carbsPct', 'activities',
  'sex', 'birthDate', 'heightCm', 'activity', 'goal', 'targetWeightKg', 'deletedAt'];
// rewards (0.12) — опыт, монеты и 💎 за каждую запись продукта; не задано — по умолчанию из настроек
// 0.12.5: каталог общий — продукты и лекарства (kind: 'food' | 'med'; нет поля — продукт). У лекарства: unit — форма
// (MED_UNITS), dose — обычная доза; у продукта meds — лекарства, которые записываются вместе с ним ({ medId, amount }).
// 0.13: третий вид — замер (kind: 'measure'): unit — свободный текст, parts — части значения, ranges — нормы;
// у всех — desc (скрытое описание) и measures — замеры, которые предлагаются при записи ({ measureId }).
// У лекарства могут быть КБЖУ, витамины и минералы — на 1 единицу формы (сироп, витамины).
export const FOOD_FIELDS = ['name', 'brand', 'unit', 'servingName', 'servingSize', 'nutrients', 'favorite', 'note', 'rewards',
  'kind', 'dose', 'meds', 'parts', 'ranges', 'desc', 'measures', 'icon', 'deletedAt'];
// Записи 0.11 хранили один продукт в своих полях (foodId, name, amount, unit, nutrients) — они читаются как есть;
// с 0.12 продукты — во вложенном массиве items (сливается поэлементно), у записи — время и заметка.
export const ENTRY_FIELDS = ['date', 'meal', 'time', 'note', 'deletedAt'];
export const LEGACY_ENTRY_FIELDS = ['foodId', 'name', 'amount', 'unit', 'nutrients'];
// order — порядок продуктов в записи (как добавляли), дробный ключ
// note (0.12.4) — заметка к продукту в записи (например, сколько единиц инсулина); kind (0.12.5) — 'med' у лекарства
// values (0.13) — значения замера по частям (у давления два), amount = первое значение (для старых версий)
export const ITEM_FIELDS = ['foodId', 'name', 'amount', 'unit', 'nutrients', 'rewards', 'order', 'note', 'kind', 'values', 'deletedAt'];
export const MEAL_FIELDS = ['name', 'icon', 'time', 'order', 'date', 'archived', 'deletedAt'];
export const MEAL_NOTE_FIELDS = ['date', 'meal', 'text', 'deletedAt'];
// 0.13: ещё обхваты — грудь, бицепс, бедро (для фигуры)
export const BODY_FIELDS = ['date', 'weightKg', 'waistCm', 'neckCm', 'hipCm', 'chestCm', 'armCm', 'thighCm', 'bodyFatPct', 'note', 'deletedAt'];
export const BODY_NUM_FIELDS = ['weightKg', 'waistCm', 'neckCm', 'hipCm', 'chestCm', 'armCm', 'thighCm', 'bodyFatPct'];
export const DAY_ARCHIVE_FIELDS = ['date', 'count', 'totals', 'meals', 'foods', 'meds', 'measures', 'rewards', 'deletedAt'];
export const DESC_MAX = 4000;

export const FOOD_NAME_MAX = 120;
export const MEAL_NAME_MAX = 40;
export const NOTE_MAX = 2000;
export const UNITS = [{ key: 'g', label: tr('граммы') }, { key: 'ml', label: tr('миллилитры') }];

/** Лекарство ли это (запись каталога или продукт записи). */
export const isMed = (x) => x?.kind === 'med';
const medUnit = (u) => (MED_UNIT[u] ? u : 'tab');
export { isMeasure };
const cleanMeasureLinks = (list) => (Array.isArray(list) ? list : [])
  .filter((m) => m && typeof m.measureId === 'string' && m.measureId)
  .map((m) => ({ measureId: m.measureId }))
  .filter((m, i, a) => a.findIndex((x) => x.measureId === m.measureId) === i)
  .slice(0, 20);
const cleanMedLinks = (list) => (Array.isArray(list) ? list : [])
  .filter((m) => m && typeof m.medId === 'string' && m.medId)
  .map((m) => ({ medId: m.medId, amount: num(m.amount) || 1 }))
  .filter((m, i, a) => a.findIndex((x) => x.medId === m.medId) === i)
  .slice(0, 20);

const iso = (ctx) => new Date(ctx.now).toISOString();
const timesFor = (names, t) => Object.fromEntries(names.map((k) => [k, t]));

function create(id, fields, names, ctx) {
  const at = iso(ctx);
  return { id, createdAt: at, updatedAt: at, updatedBy: ctx.deviceId, deletedAt: null, fieldTimes: timesFor(names, ctx.stamp()), ...fields };
}

export const normalizeName = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, FOOD_NAME_MAX);

/** Настройки по умолчанию: метки 1, как у настроек задач, — два устройства сливаются без конфликтов. */
export function defaultFeastSettings() {
  return {
    id: FEAST_SETTINGS_ID,
    createdAt: DEFAULTS_CREATED_AT,
    updatedAt: DEFAULTS_CREATED_AT,
    updatedBy: DEFAULTS_DEVICE_ID,
    deletedAt: null,
    fieldTimes: timesFor(FEAST_SETTINGS_FIELDS, 1),
    kcalGoal: 2000,
    proteinGoal: null,
    fatGoal: null,
    carbsGoal: null,
    entryLimit: FEAST_RETENTION.entryDefault,
    sex: null,
    birthDate: null,
    heightCm: null,
    activity: 'light',
    goal: 'keep',
    targetWeightKg: null,
    rewardXp: null,
    rewardCoins: null,
    rewardGems: null,
    loseKcal: null,
    gainKcal: null,
    minKcal: null,
    recKcal: null,
    macroMode: null, // 'pct' | 'grams'; null — как в 0.11 (по граммам, если заданы)
    proteinPct: null,
    fatPct: null,
    carbsPct: null,
    activities: [], // 0.12.2: свои активности { id: 'c:…', name, hint, kcal }
  };
}

// ---------- Награды за еду (0.12) ----------

export const REWARD_KEYS = ['xp', 'coins', 'gems'];
/** По умолчанию — мало: опыт 1, монеты 0,2, 💎 0,05 за каждую запись продукта (целые копятся из дробных). */
export const REWARD_DEFAULTS = { xp: 1, coins: 0.2, gems: 0.05 };
export const REWARD_LABELS = { xp: tr('Опыт'), coins: tr('Монеты'), gems: tr('Алмазы') };
export const REWARD_ICONS = { xp: '✨', coins: '🪙', gems: '💎' };
const REWARD_MAX = 1000;
const SETTING_OF = { xp: 'rewardXp', coins: 'rewardCoins', gems: 'rewardGems' };

/** Число награды: ≥ 0, до сотых (0,05), пусто и мусор — null (значит «по умолчанию»). */
export function cleanReward(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.').replace(/\s+/g, ''));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(Math.min(n, REWARD_MAX) * 100) / 100;
}

/** Награды по умолчанию из настроек (не заданы — REWARD_DEFAULTS). */
export function rewardDefaults(settings) {
  const out = {};
  for (const k of REWARD_KEYS) out[k] = cleanReward(settings?.[SETTING_OF[k]]) ?? REWARD_DEFAULTS[k];
  return out;
}

/** Чистый словарь наград продукта: только заданные ключи. */
export function cleanRewards(r = {}) {
  const out = {};
  for (const k of REWARD_KEYS) {
    const v = cleanReward(r?.[k]);
    if (v !== null) out[k] = v;
  }
  return out;
}

/** Награда за запись продукта: его значения, недостающие — по умолчанию. */
export function rewardsOf(food, settings) {
  const d = rewardDefaults(settings);
  const own = cleanRewards(food?.rewards);
  return { xp: own.xp ?? d.xp, coins: own.coins ?? d.coins, gems: own.gems ?? d.gems };
}

// суммы — в тысячных, чтобы 20 × 0,05 было ровно 1, а не 0,999…
const milli = (v) => (Number.isFinite(v) && v > 0 ? Math.round(v * 1000) : 0);
const fromMilli = (m) => Object.fromEntries(REWARD_KEYS.map((k) => [k, m[k] / 1000]));

function addRewardsMilli(acc, r) {
  for (const k of REWARD_KEYS) acc[k] += milli(r?.[k]);
  return acc;
}

const zeroMilli = () => ({ xp: 0, coins: 0, gems: 0 });

/** Награды за запись (сумма по её продуктам; у записей 0.11 наград нет). */
export function entryRewards(e) {
  const acc = zeroMilli();
  for (const it of entryItems(e)) addRewardsMilli(acc, it.rewards);
  return fromMilli(acc);
}

export const hasRewards = (r) => !!r && REWARD_KEYS.some((k) => (r[k] || 0) > 0);

/** Награды за день: живые записи + сводка дня, если записи удалены лимитом. */
export function dayRewards(data, date) {
  const acc = zeroMilli();
  for (const e of data.entries.values()) if (isLiveEntry(e) && e.date === date) for (const it of entryItems(e)) addRewardsMilli(acc, it.rewards);
  const arch = data.dayArchive.get(archiveId(date));
  if (arch && !arch.deletedAt) addRewardsMilli(acc, arch.rewards);
  return fromMilli(acc);
}

/** Всё заработанное едой за всё время (для баланса игры — core/earnings.js). */
export function feastRewards(data) {
  const acc = zeroMilli();
  for (const e of data.entries.values()) if (isLiveEntry(e)) for (const it of entryItems(e)) addRewardsMilli(acc, it.rewards);
  for (const a of data.dayArchive.values()) if (!a.deletedAt) addRewardsMilli(acc, a.rewards);
  return fromMilli(acc);
}

// ---------- Продукты ----------

export function newFood({ name, brand = '', unit = 'g', servingName = '', servingSize = null, nutrients = {}, note = '', barcodes = [], rewards = {}, kind = 'food', dose = null, parts = [], ranges = [], desc = '', icon = '' }, ctx) {
  const n = normalizeName(name);
  if (!n) throw new Error('newFood: пустое название');
  const med = kind === 'med';
  const measure = kind === 'measure';
  const ps = measure ? cleanParts(parts) : [];
  let f = create(uuidv7(ctx.now), {
    name: n,
    brand: normalizeName(brand),
    unit: med ? medUnit(unit) : measure ? cleanUnit(unit) : unit === 'ml' ? 'ml' : 'g',
    ...(med ? { kind: 'med', dose: num(dose) || 1 } : {}),
    ...(measure ? { kind: 'measure', parts: ps, ranges: cleanRanges(ranges, Math.max(1, ps.length)), icon: cleanIcon(icon) } : {}),
    ...(String(desc || '').trim() ? { desc: String(desc).slice(0, DESC_MAX) } : {}),
    servingName: normalizeName(servingName).slice(0, 40),
    servingSize: num(servingSize) || null,
    nutrients: cleanNutrients(nutrients),
    favorite: false,
    note: String(note || '').slice(0, 2000),
    rewards: cleanRewards(rewards),
    barcodes: {},
  }, FOOD_FIELDS, ctx);
  for (const b of barcodes) f = setBarcode(f, b, true, ctx);
  return f;
}

/** Правка продукта, лекарства или замера: значения чистятся, название и бренд нормализуются. */
export function editFood(food, changes, ctx) {
  const c = { ...changes };
  if ('rewards' in c) c.rewards = cleanRewards(c.rewards);
  if ('meds' in c) c.meds = cleanMedLinks(c.meds);
  if ('measures' in c) c.measures = cleanMeasureLinks(c.measures);
  if ('dose' in c) c.dose = num(c.dose) || 1;
  if ('desc' in c) c.desc = String(c.desc ?? '').slice(0, DESC_MAX);
  if ('icon' in c) c.icon = cleanIcon(c.icon);
  if ('name' in c) c.name = normalizeName(c.name) || food.name;
  if ('brand' in c) c.brand = normalizeName(c.brand);
  if ('nutrients' in c) c.nutrients = cleanNutrients(c.nutrients);
  if ('servingSize' in c) c.servingSize = num(c.servingSize) || null;
  if ('servingName' in c) c.servingName = normalizeName(c.servingName).slice(0, 40);
  if ('unit' in c) c.unit = isMed(food) ? medUnit(c.unit) : isMeasure(food) ? cleanUnit(c.unit) : c.unit === 'ml' ? 'ml' : 'g';
  if ('parts' in c) {
    c.parts = cleanParts(c.parts);
    if (!('ranges' in c)) c.ranges = cleanRanges(food.ranges, Math.max(1, c.parts.length));
  }
  if ('ranges' in c) c.ranges = cleanRanges(c.ranges, Math.max(1, ('parts' in c ? c.parts : food.parts || []).length));
  return touch(food, c, ctx);
}

/** Привязать (on) или отвязать штрихкод: элемент словаря со своей меткой — сливается по коду. */
export function setBarcode(food, raw, on, ctx) {
  const code = normalizeBarcode(raw);
  if (!code) return food;
  const cur = food.barcodes?.[code];
  if (cur && !!cur.in === !!on) return food;
  return {
    ...food,
    barcodes: { ...(food.barcodes || {}), [code]: { in: !!on, t: ctx.stamp(), by: ctx.deviceId } },
    updatedAt: iso(ctx),
    updatedBy: ctx.deviceId,
  };
}

/** Привязанные штрихкоды продукта (по порядку). */
export const foodBarcodes = (food) => Object.entries(food?.barcodes || {}).filter(([, v]) => v && v.in).map(([k]) => k).sort();

/** Живой продукт по штрихкоду (любой из привязанных). */
export function findByBarcode(data, raw) {
  const code = normalizeBarcode(raw);
  if (!code) return null;
  for (const f of data.foods.values()) if (!f.deletedAt && f.barcodes?.[code]?.in) return f;
  return null;
}

/** Порция в граммах (или мл), если задана. */
export const servingOf = (food) => (num(food?.servingSize) ? food.servingSize : null);

// ---------- Рационы (0.12) ----------

/** Время «ЧЧ:ММ» или null. */
export function cleanTime(v) {
  const m = String(v ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

const cleanNote = (v) => String(v ?? '').replace(/\r\n?/g, '\n').slice(0, NOTE_MAX);
const cleanMealName = (v) => normalizeName(v).slice(0, MEAL_NAME_MAX);
const cleanIcon = (v) => [...String(v ?? '').trim()].slice(0, 4).join('');

/** Основные рационы — фиксированные id и метки 1: на всех устройствах одинаковые, сливаются без конфликтов. */
export const DEFAULT_MEAL_IDS = MEALS.map((m) => m.key);

export function defaultMeals() {
  let order = null;
  return MEALS.map((m) => {
    order = keyBetween(order, null);
    return {
      id: m.key,
      createdAt: DEFAULTS_CREATED_AT,
      updatedAt: DEFAULTS_CREATED_AT,
      updatedBy: DEFAULTS_DEVICE_ID,
      deletedAt: null,
      fieldTimes: timesFor(MEAL_FIELDS, 1),
      name: m.label,
      icon: m.icon,
      time: null,
      order,
      date: null,
      archived: false,
    };
  });
}

export const isDefaultMeal = (m) => DEFAULT_MEAL_IDS.includes(m?.id ?? m);

/** Новый рацион: date = null — общий для всех дней, иначе — только для этого дня. */
export function newMeal({ name, icon = '🍽️', time = null, order, date = null }, ctx) {
  const n = cleanMealName(name);
  if (!n) throw new Error('newMeal: пустое название');
  return create(uuidv7(ctx.now), {
    name: n, icon: cleanIcon(icon) || '🍽️', time: cleanTime(time), order, date: date || null, archived: false,
  }, MEAL_FIELDS, ctx);
}

export function editMeal(meal, changes, ctx) {
  const c = { ...changes };
  if ('name' in c) c.name = cleanMealName(c.name) || meal.name;
  if ('icon' in c) c.icon = cleanIcon(c.icon) || meal.icon;
  if ('time' in c) c.time = cleanTime(c.time);
  if ('date' in c) c.date = c.date || null;
  if ('archived' in c) c.archived = !!c.archived;
  return touch(meal, c, ctx);
}

// 0.12.5: стандартные рационы, которые не переименовывали, показываются на языке интерфейса
const DEFAULT_MEAL_RU = { breakfast: 'Завтрак', lunch: 'Обед', dinner: 'Ужин', snack: 'Перекус' };
/** Название рациона для показа. */
export const mealName = (m) => (m && DEFAULT_MEAL_RU[m.id] === m.name ? tr(m.name) : m?.name || '');

/** Все живые общие рационы по порядку (и скрытые — для настроек). */
export const globalMeals = (data) => [...data.meals.values()].filter((m) => !m.deletedAt && !m.date).sort(byOrder);

/** Рацион по id; если его нет (удалён на другом устройстве) — запасной с понятным названием. */
export function mealInfo(data, id) {
  const m = data.meals.get(id);
  if (m && !m.deletedAt) return m;
  const d = MEALS.find((x) => x.key === id);
  return { id, name: d ? d.label : tr('Другое'), icon: d ? d.icon : '🍽️', time: null, order: m?.order || '~', date: null, archived: false, missing: true };
}

/**
 * Рационы дня по порядку: общие (кроме скрытых) и рационы этого дня; скрытые и удалённые — только если в них
 * есть записи этого дня (запись не пропадает из дневника).
 */
export function mealsForDay(data, date, used = null) {
  const ids = used || new Set([...data.entries.values()].filter((e) => isLiveEntry(e) && e.date === date).map((e) => e.meal || 'snack'));
  const out = new Map();
  for (const m of data.meals.values()) {
    if (m.deletedAt) continue;
    if (m.date ? m.date === date : !m.archived || ids.has(m.id)) out.set(m.id, m);
  }
  for (const id of ids) if (!out.has(id)) out.set(id, mealInfo(data, id));
  return [...out.values()].sort(byOrder);
}

/** Ключ порядка для нового рациона сразу после afterId (null — в начало) среди рационов дня. */
export function orderAfter(list, afterId) {
  const i = afterId ? list.findIndex((m) => m.id === afterId) : -1;
  const prev = i >= 0 ? list[i].order : null;
  let j = i + 1;
  while (prev != null && j < list.length && list[j].order <= prev) j++;
  const next = j < list.length ? list[j].order : null;
  try {
    return keyBetween(prev, next);
  } catch {
    return keyBetween(prev, null);
  }
}

/**
 * Рацион по времени (для «Записать еду»): последний из рационов дня, у кого время уже наступило.
 * Если времени ни у кого нет — по часам, как раньше (завтрак до 11, обед до 16, ужин до 21, иначе перекус).
 */
export function mealByTime(data, date, time) {
  const list = mealsForDay(data, date).filter((m) => !m.missing);
  const timed = list.filter((m) => m.time).sort((a, b) => (a.time < b.time ? -1 : 1));
  if (timed.length) {
    const past = timed.filter((m) => m.time <= time);
    return (past.at(-1) || timed.at(-1)).id;
  }
  const h = parseInt(time, 10);
  const key = h >= 4 && h < 11 ? 'breakfast' : h >= 11 && h < 16 ? 'lunch' : h >= 16 && h < 21 ? 'dinner' : 'snack';
  return list.some((m) => m.id === key) ? key : list[0]?.id || 'snack';
}

/**
 * Рацион за период [from, to] (страница рациона): дни с записями (ккал и число записей, сводки дней — тоже),
 * средние калории за день с записями, частые продукты.
 */
export function mealStats(data, mealId, from, to) {
  const days = new Map();
  const day = (date) => days.get(date) || days.set(date, { date, count: 0, kcal: 0 }).get(date);
  const foods = new Map();
  for (const e of data.entries.values()) {
    if (!isLiveEntry(e) || (e.meal || 'snack') !== mealId || e.date < from || e.date > to) continue;
    const d = day(e.date);
    d.count++;
    d.kcal += nv(entryNutrients(e), 'kcal');
    for (const it of entryItems(e)) {
      const key = it.foodId || 'quick:' + it.name;
      const f = foods.get(key) || { key, foodId: it.foodId || null, name: it.name, count: 0, kcal: 0 };
      f.count++;
      f.kcal += nv(itemNutrients(it), 'kcal');
      foods.set(key, f);
    }
  }
  for (const a of data.dayArchive.values()) {
    if (a.deletedAt || a.date < from || a.date > to || !a.meals?.[mealId]) continue;
    day(a.date).kcal += a.meals[mealId];
  }
  const list = [...days.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  const total = list.reduce((s, d) => s + d.kcal, 0);
  return {
    days: list,
    avgKcal: list.length ? total / list.length : 0,
    entries: list.reduce((s, d) => s + d.count, 0),
    topFoods: [...foods.values()].sort((a, b) => b.count - a.count || b.kcal - a.kcal).slice(0, 8),
  };
}

// ---------- Заметки к рациону на день (0.12) ----------

/** id детерминированный: два устройства, написавшие заметку к одному рациону дня, правят одну запись. */
export const mealNoteId = (date, meal) => `mn:${date}:${meal}`;

export function mealNoteOf(data, date, meal) {
  const n = data.mealNotes.get(mealNoteId(date, meal));
  return n && !n.deletedAt && n.text ? n : null;
}

export function newMealNote(date, meal, text, ctx) {
  return create(mealNoteId(date, meal), { date, meal, text: cleanNote(text) }, MEAL_NOTE_FIELDS, ctx);
}

// ---------- Записи дневника ----------

function nestedItem(fields, ctx) {
  const at = iso(ctx);
  return { id: uuidv7(ctx.now), createdAt: at, updatedAt: at, deletedAt: null, fieldTimes: timesFor(ITEM_FIELDS, ctx.stamp()), ...fields };
}

/**
 * Продукт записи. Из продукта — снимок его названия и значений (правка продукта прошлые дни не меняет),
 * amount в граммах/мл. Быстрая запись без продукта — unit 'portion', amount — число порций, значения — на порцию.
 * snapshot — копия продукта другой записи («как вчера»).
 */
export function itemFields({ food = null, amount, quick = null, snapshot = null, rewards = null, note = null, med = null, measure = null, values = null }) {
  // награда — снимок на момент записи (правка продукта или настроек прошлые записи не меняет); заметка — если есть
  const text = cleanNote(note ?? snapshot?.note ?? '').trim() ? cleanNote(note ?? snapshot?.note) : '';
  const withRewards = (f, r) => {
    const out = hasRewards(r) ? { ...f, rewards: cleanRewards(r) } : f;
    return text ? { ...out, note: text } : out;
  };
  const withNote = (out) => (text ? { ...out, note: text } : out);
  // замер (0.13): значения по частям, без пищевой ценности и наград
  const asMeasure = measure || (food && isMeasure(food)) ? (measure || food) : null;
  if (asMeasure) {
    const vs = cleanValues(values ?? amount, partCount(asMeasure)) || Array.from({ length: partCount(asMeasure) }, () => null);
    return withNote({ foodId: asMeasure.id, kind: 'measure', name: asMeasure.name, amount: vs.find((v) => v != null) ?? 0, values: vs, unit: cleanUnit(asMeasure.unit), nutrients: {} });
  }
  // лекарство (0.12.5): без наград; 0.13 — может нести КБЖУ и витамины на 1 единицу формы
  const asMed = med || (food && isMed(food)) ? (med || food) : null;
  if (asMed) {
    return withNote({ foodId: asMed.id, kind: 'med', name: asMed.name + (asMed.brand ? ` (${asMed.brand})` : ''), amount: num(amount) || num(asMed.dose) || 1, unit: medUnit(asMed.unit), nutrients: cleanNutrients(asMed.nutrients || {}) });
  }
  if (snapshot) {
    if (isMeasure(snapshot)) {
      const vs = cleanValues(snapshot.values ?? snapshot.amount, Math.max(1, (snapshot.values || []).length)) || [null];
      return withNote({ foodId: snapshot.foodId ?? null, kind: 'measure', name: normalizeName(snapshot.name) || tr('Замер'), amount: vs.find((v) => v != null) ?? 0, values: vs, unit: cleanUnit(snapshot.unit), nutrients: {} });
    }
    if (isMed(snapshot)) {
      return withNote({ foodId: snapshot.foodId ?? null, kind: 'med', name: normalizeName(snapshot.name) || tr('Лекарство'), amount: num(snapshot.amount) || 1, unit: medUnit(snapshot.unit), nutrients: cleanNutrients(snapshot.nutrients || {}) });
    }
    return withRewards({
      foodId: snapshot.foodId ?? null, name: normalizeName(snapshot.name) || tr('Запись'),
      amount: num(snapshot.amount), unit: ['g', 'ml', 'portion'].includes(snapshot.unit) ? snapshot.unit : 'g',
      nutrients: cleanNutrients(snapshot.nutrients || {}),
    }, rewards ?? snapshot.rewards);
  }
  if (food) {
    return withRewards({
      foodId: food.id, name: food.name + (food.brand ? ` (${food.brand})` : ''),
      amount: num(amount) || 100, unit: food.unit === 'ml' ? 'ml' : 'g', nutrients: cleanNutrients(food.nutrients),
    }, rewards);
  }
  return withRewards({
    foodId: null, name: normalizeName(quick?.name) || tr('Быстрая запись'),
    amount: num(amount) || 1, unit: quick?.unit === 'g' || quick?.unit === 'ml' ? quick.unit : 'portion',
    nutrients: cleanNutrients(quick?.nutrients || {}),
  }, rewards);
}

export const newItem = (spec, ctx, order = null) => nestedItem({ ...itemFields(spec), ...(order ? { order } : {}) }, ctx);

/** Ключи порядка для count новых продуктов после last. */
function nextOrders(last, count) {
  const out = [];
  let k = last || null;
  for (let i = 0; i < count; i++) out.push((k = keyBetween(k, null)));
  return out;
}

/** Порядок продуктов: по ключу (без ключа — раньше), затем по созданию и id. */
function byItemOrder(a, b) {
  const x = a.order || '';
  const y = b.order || '';
  if (x !== y) return x < y ? -1 : 1;
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1;
}

const cleanMealId = (m) => (typeof m === 'string' && m && m.length <= 64 ? m : 'snack');

/**
 * Запись дневника (0.12): рацион, время (по умолчанию — переданное «сейчас»), заметка и продукты.
 * items — [{ food, amount } | { quick, amount }]; для краткости можно передать один продукт: { food, amount }.
 */
export function newEntry({ date, meal, time = null, note = '', notes = null, items = null, food = null, amount, quick = null }, ctx) {
  const specs = items || [{ food, amount, quick }];
  const orders = nextOrders(null, specs.length);
  const list = specs.map((x, i) => newItem(x, ctx, orders[i])).sort((a, b) => (a.id < b.id ? -1 : 1));
  const texts = (notes || [note]).map(cleanNote).filter((t) => t.trim());
  let e = create(uuidv7(ctx.now), {
    date, meal: cleanMealId(meal), time: cleanTime(time), note: texts[0] || '', items: list,
  }, ENTRY_FIELDS, ctx);
  for (const t of texts.slice(1)) e = addEntryNote(e, t, ctx);
  return e;
}

export const isLiveEntry = (e) => !!e && !e.deletedAt;

/**
 * Продукты записи по порядку добавления. У записи 0.11 продукт один и лежит в её полях — отдаём его как
 * элемент с id записи (legacy: true).
 */
export function entryItems(e) {
  if (!e || e.deletedAt) return [];
  if (Array.isArray(e.items)) return e.items.filter((x) => x && !x.deletedAt).sort(byItemOrder);
  return [{ id: e.id, createdAt: e.createdAt, foodId: e.foodId ?? null, name: e.name || tr('Запись'), amount: e.amount, unit: e.unit, nutrients: e.nutrients || {}, legacy: true }];
}

/** Название записи: продукт или «Творог, банан и ещё 2»; без продуктов (0.13) — «Заметка». */
export function entryTitle(e) {
  const items = entryItems(e);
  if (!items.length) return entryNoteList(e).length ? tr('Заметка') : tr('Пустая запись');
  if (items.length === 1) return items[0].name;
  if (items.length <= 3) return items.map((x) => x.name).join(', ');
  return tr('{p0} и ещё {p1}', { p0: items.slice(0, 2).map((x) => x.name).join(', '), p1: items.length - 2 });
}

/**
 * Перевести запись 0.11 на продукты-элементы (перед правкой состава). id элемента = id записи: два устройства,
 * сделавшие это одновременно, получат один и тот же продукт, а не два.
 */
export function upgradeEntry(e, ctx) {
  if (!e || Array.isArray(e.items)) return e;
  const at = iso(ctx);
  const item = {
    id: e.id, createdAt: e.createdAt || at, updatedAt: at, deletedAt: null, fieldTimes: timesFor(ITEM_FIELDS, 1),
    foodId: e.foodId ?? null, name: e.name || tr('Запись'), amount: Number.isFinite(e.amount) ? e.amount : 0,
    unit: e.unit || 'g', nutrients: e.nutrients || {},
  };
  return { ...e, items: [item], updatedAt: at, updatedBy: ctx.deviceId };
}

/** Добавить продукты в запись. */
export function addItems(e, specs, ctx) {
  const base = upgradeEntry(e, ctx);
  const last = (base.items || []).map((x) => x.order).filter(Boolean).sort().at(-1) || null;
  const orders = nextOrders(last, specs.length);
  const added = specs.map((x, i) => newItem(x, ctx, orders[i]));
  return { ...base, items: [...base.items, ...added].sort((a, b) => (a.id < b.id ? -1 : 1)), updatedAt: iso(ctx), updatedBy: ctx.deviceId };
}

/** Заметка к продукту в записи (0.12.4); пустая — убрать. */
export function setItemNote(e, itemId, note, ctx) {
  const base = upgradeEntry(e, ctx);
  return touchNested(base, 'items', itemId, { note: cleanNote(note) }, ctx);
}

/** Значения замера в записи (0.13); amount — первое значение (для старых версий). */
export function setItemValues(e, itemId, values, ctx) {
  const base = upgradeEntry(e, ctx);
  const it = (base.items || []).find((x) => x.id === itemId);
  if (!it) return e;
  const vs = cleanValues(values, Math.max(1, (it.values || []).length));
  if (!vs) return e;
  return touchNested(base, 'items', itemId, { values: vs, amount: vs.find((v) => v != null) ?? 0 }, ctx);
}

/** Изменить количество продукта в записи. */
export function setItemAmount(e, itemId, amount, ctx) {
  const base = upgradeEntry(e, ctx);
  return touchNested(base, 'items', itemId, { amount: num(amount) || 0 }, ctx);
}

export function removeItem(e, itemId, ctx) {
  return removeNested(upgradeEntry(e, ctx), 'items', itemId, ctx);
}

// ---------- Заметки записи (0.12.5): первая — поле note, дальше — вложенный массив notes (сколько угодно) ----------

export const MAIN_NOTE = 'main';

/** Все заметки записи по порядку: [{ id, text }] (первая — note, её id — MAIN_NOTE). Пустые не попадают. */
export function entryNoteList(e) {
  if (!e) return [];
  const out = [];
  if ((e.note || '').trim()) out.push({ id: MAIN_NOTE, text: e.note });
  const extra = (e.notes || []).filter((n) => n && !n.deletedAt && (n.text || '').trim())
    .sort((a, b) => ((a.order || '') === (b.order || '') ? (a.id < b.id ? -1 : 1) : (a.order || '') < (b.order || '') ? -1 : 1));
  for (const n of extra) out.push({ id: n.id, text: n.text });
  return out;
}

/** Добавить заметку к записи (в конец). */
export function addEntryNote(e, text, ctx) {
  const t = cleanNote(text);
  if (!t.trim()) return e;
  const live = (e.notes || []).filter((n) => !n.deletedAt && (n.text || '').trim());
  // первая заметка — в поле note (его видят и старые версии); если первую убрали, а другие есть — новая в конец
  if (!(e.note || '').trim() && !live.length) return touch(e, { note: t }, ctx);
  const last = (e.notes || []).filter((n) => !n.deletedAt).map((n) => n.order || '').sort().at(-1) || null;
  const at = iso(ctx);
  const note = { id: uuidv7(ctx.now), createdAt: at, updatedAt: at, deletedAt: null, fieldTimes: timesFor(['text', 'order', 'deletedAt'], ctx.stamp()), text: t, order: keyBetween(last, null) };
  return { ...e, notes: [...(e.notes || []), note].sort((a, b) => (a.id < b.id ? -1 : 1)), updatedAt: at, updatedBy: ctx.deviceId };
}

/** Изменить заметку записи; пустой текст — убрать её. */
export function editEntryNote(e, id, text, ctx) {
  const t = cleanNote(text);
  if (id === MAIN_NOTE) return touch(e, { note: t.trim() ? t : '' }, ctx);
  if (!t.trim()) return removeNested(e, 'notes', id, ctx);
  return touchNested(e, 'notes', id, { text: t }, ctx);
}

/** Правка полей записи: время, заметка, рацион, дата. */
export function editEntry(e, changes, ctx) {
  const c = {};
  if ('time' in changes) c.time = cleanTime(changes.time);
  if ('note' in changes) c.note = cleanNote(changes.note);
  if ('meal' in changes) c.meal = cleanMealId(changes.meal);
  if ('date' in changes) c.date = changes.date;
  return touch(e, c, ctx);
}

/** Порядок записей в рационе: по времени (без времени — раньше), затем по созданию. */
export function byEntryTime(a, b) {
  const x = a.time || '';
  const y = b.time || '';
  if (x !== y) return x < y ? -1 : 1;
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1;
}

/** Живые записи дня по рационам: { [id рациона]: [...] } — только рационы, где записи есть. */
export function dayEntries(data, date) {
  const out = {};
  for (const e of data.entries.values()) if (isLiveEntry(e) && e.date === date) (out[e.meal || 'snack'] ||= []).push(e);
  for (const k of Object.keys(out)) out[k].sort(byEntryTime);
  return out;
}

/** Итоги дня: всего и по рационам; учитывает сводку дня, если его записи удалены лимитом. */
export function dayTotals(data, date) {
  const byMeal = dayEntries(data, date);
  const meals = {};
  let count = 0;
  for (const [k, list] of Object.entries(byMeal)) {
    meals[k] = sumNutrients(list.map(entryNutrients));
    count += list.length;
  }
  let totals = sumNutrients(Object.values(meals));
  const arch = data.dayArchive.get(archiveId(date));
  if (arch && !arch.deletedAt) {
    totals = addNutrients(totals, arch.totals || {});
    for (const [k, kcal] of Object.entries(arch.meals || {})) meals[k] = addNutrients(meals[k] || {}, { kcal: kcal || 0 });
    count += arch.count || 0;
  }
  return { totals, meals, count, entries: byMeal, archived: !!arch && !arch.deletedAt };
}

/** Как часто ели продукт (для «Недавних» и «Частых»): foodId → { count, last, amount }. */
export function foodUsage(data) {
  const out = new Map();
  for (const e of data.entries.values()) {
    if (!isLiveEntry(e)) continue;
    for (const it of entryItems(e)) {
      if (!it.foodId) continue;
      const u = out.get(it.foodId) || { count: 0, last: '', amount: 0 };
      u.count++;
      const when = e.date + (e.time || '') + e.createdAt;
      if (when > u.last) {
        u.last = when;
        u.amount = it.amount;
      }
      out.set(it.foodId, u);
    }
  }
  return out;
}

// ---------- Замеры ----------

export function newBodyLog({ date, note = '', ...values }, ctx) {
  return create(uuidv7(ctx.now), {
    date, ...Object.fromEntries(BODY_NUM_FIELDS.map((k) => [k, num(values[k]) || null])), note: String(note || '').slice(0, 500),
  }, BODY_FIELDS, ctx);
}

/** Живой замер на дату (последний изменённый, если вдруг их два — с двух устройств). */
export function bodyLogOn(data, date) {
  let best = null;
  for (const b of data.body.values()) {
    if (b.deletedAt || b.date !== date) continue;
    if (!best || (b.updatedAt || '') > (best.updatedAt || '')) best = b;
  }
  return best;
}

export const liveBodyLogs = (data) => [...data.body.values()].filter((b) => !b.deletedAt).sort((a, b) => (a.date < b.date ? 1 : -1));

// ---------- Лимит записей дневника ----------

export const archiveId = (date) => 'd:' + date;

/** Сколько живых записей хранится. */
export function entryCount(data) {
  let n = 0;
  for (const e of data.entries.values()) if (isLiveEntry(e)) n++;
  return n;
}

/**
 * Что удалить, чтобы живых записей стало не больше limit: самые старые дни целиком, кроме последних
 * keepRecentDays. → { dates, entries, over, total }. Сводки дней — archiveFor.
 */
export function purgePlan(data, today, limit = data.settings?.entryLimit || FEAST_RETENTION.entryDefault) {
  const byDate = new Map();
  let total = 0;
  for (const e of data.entries.values()) {
    if (!isLiveEntry(e)) continue;
    total++;
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }
  const lim = Math.max(FEAST_RETENTION.entryMin, limit || 0);
  const over = total - lim;
  const plan = { dates: [], entries: [], over: Math.max(0, over), total };
  if (over <= 0) return plan;
  const keepFrom = addDays(today, -FEAST_RETENTION.keepRecentDays);
  let removed = 0;
  for (const date of [...byDate.keys()].sort()) {
    if (removed >= over || date >= keepFrom) break;
    plan.dates.push(date);
    plan.entries.push(...byDate.get(date));
    removed += byDate.get(date).length;
  }
  return plan;
}

/**
 * Сводка дня из удаляемых записей (с уже существующей сводкой, если день чистили раньше).
 * id = 'd:<дата>': два устройства, удалившие один и тот же день, пишут одну и ту же запись.
 */
export function archiveFor(date, entries, prev, ctx) {
  const totals = sumNutrients(entries.map(entryNutrients));
  const meals = {};
  for (const e of entries) {
    const k = e.meal || 'snack';
    meals[k] = (meals[k] || 0) + nv(entryNutrients(e), 'kcal');
  }
  for (const k of Object.keys(meals)) meals[k] = Math.round(meals[k]);
  const foods = {};
  const meds = {};
  const measures = {};
  for (const e of entries) {
    for (const it of entryItems(e)) {
      if (isMeasure(it)) {
        // показания замеров остаются в сводке целиком (до 30 в день на замер) — это история здоровья
        const key = it.foodId || 'measure:' + it.name;
        const m = measures[key] || (measures[key] = { name: it.name, unit: it.unit, readings: [] });
        if (m.readings.length < 30) m.readings.push({ time: e.time || null, values: it.values || [it.amount], ...(it.note ? { note: it.note } : {}) });
        continue;
      }
      if (isMed(it)) {
        const key = it.foodId || 'med:' + it.name;
        const m = meds[key] || (meds[key] = { name: it.name, unit: it.unit, count: 0, amount: 0 });
        m.count++;
        m.amount = Math.round((m.amount + (it.amount || 0)) * 1000) / 1000;
        continue;
      }
      const key = it.foodId || 'quick:' + it.name;
      const f = foods[key] || (foods[key] = { name: it.name, count: 0, kcal: 0 });
      f.count++;
      f.kcal = Math.round(f.kcal + nv(itemNutrients(it), 'kcal'));
    }
  }
  const round = (n) => Object.fromEntries(Object.entries(n).map(([k, v]) => [k, Math.round(v * 1000) / 1000]));
  const rw = zeroMilli();
  for (const e of entries) for (const it of entryItems(e)) addRewardsMilli(rw, it.rewards);
  if (prev && !prev.deletedAt) addRewardsMilli(rw, prev.rewards);
  const rewards = fromMilli(rw);
  if (prev && !prev.deletedAt) {
    const pm = { ...(prev.meals || {}) };
    for (const [k, v] of Object.entries(meals)) pm[k] = (pm[k] || 0) + v;
    const pf = { ...(prev.foods || {}) };
    for (const [k, v] of Object.entries(foods)) pf[k] = pf[k] ? { ...pf[k], count: pf[k].count + v.count, kcal: pf[k].kcal + v.kcal } : v;
    const pmed = { ...(prev.meds || {}) };
    for (const [k, v] of Object.entries(meds)) pmed[k] = pmed[k] ? { ...pmed[k], count: pmed[k].count + v.count, amount: pmed[k].amount + v.amount } : v;
    const pms = { ...(prev.measures || {}) };
    for (const [k, v] of Object.entries(measures)) pms[k] = pms[k] ? { ...pms[k], readings: [...pms[k].readings, ...v.readings].slice(0, 60) } : v;
    return touch(prev, {
      count: (prev.count || 0) + entries.filter(hasFood).length,
      totals: round(addNutrients(prev.totals || {}, totals)),
      meals: pm,
      foods: pf,
      meds: pmed,
      measures: pms,
      rewards,
    }, ctx);
  }
  return create(archiveId(date), { date, count: entries.filter(hasFood).length, totals: round(totals), meals, foods, meds, measures, rewards }, DAY_ARCHIVE_FIELDS, ctx);
}

// ---------- Статистика за период ----------

/** Итоги по дням [from, to]: живые записи + сводки. Пустые дни — без записей. */
export function dailySeries(data, from, to) {
  const days = new Map();
  const get = (date) => {
    if (!days.has(date)) days.set(date, { date, totals: {}, count: 0, meals: {} });
    return days.get(date);
  };
  for (const e of data.entries.values()) {
    if (!isLiveEntry(e) || e.date < from || e.date > to || !hasNutrition(e)) continue;
    const d = get(e.date);
    const n = entryNutrients(e);
    d.totals = addNutrients(d.totals, n);
    if (hasFood(e)) d.count++;
    const m = e.meal || 'snack';
    d.meals[m] = (d.meals[m] || 0) + nv(n, 'kcal');
  }
  for (const a of data.dayArchive.values()) {
    if (a.deletedAt || a.date < from || a.date > to) continue;
    const d = get(a.date);
    d.totals = addNutrients(d.totals, a.totals || {});
    d.count += a.count || 0;
    for (const [k, kcal] of Object.entries(a.meals || {})) d.meals[k] = (d.meals[k] || 0) + (kcal || 0);
  }
  return [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Есть ли в записи еда (а не только лекарства, замеры или заметки). */
export const hasFood = (e) => entryItems(e).some((it) => !isMed(it) && !isMeasure(it));
/** Даёт ли запись калории или вещества (еда или лекарство с КБЖУ — сироп, витамины). */
const hasNutrition = (e) => hasFood(e) || Object.keys(entryNutrients(e)).length > 0;

/**
 * Лекарства за период [from, to] (0.12.5): по каждому — приёмы, сумма, дни, последний приём, ряд по дням; журнал приёмов.
 * Учитываются и сводки дней, удалённых лимитом хранения (без журнала).
 */
export function medStats(data, from, to) {
  const meds = new Map();
  const log = [];
  const extra = []; // приёмы из сводок дней (без времени) — для графиков по дням, месяцам и годам
  const get = (key, name, unit) => meds.get(key) || meds.set(key, { key, name, unit, count: 0, amount: 0, days: new Map(), last: '' }).get(key);
  for (const e of data.entries.values()) {
    if (!isLiveEntry(e) || e.date < from || e.date > to) continue;
    const foods = entryItems(e).filter((it) => !isMed(it) && !isMeasure(it)).map((it) => it.name);
    for (const it of entryItems(e)) {
      if (!isMed(it)) continue;
      const m = get(it.foodId || 'med:' + it.name, it.name, it.unit);
      m.count++;
      m.amount += it.amount || 0;
      const d = m.days.get(e.date) || { date: e.date, count: 0, amount: 0 };
      d.count++;
      d.amount += it.amount || 0;
      m.days.set(e.date, d);
      const when = e.date + ' ' + (e.time || '');
      if (when > m.last) m.last = when;
      log.push({ date: e.date, time: e.time || null, key: m.key, name: it.name, amount: it.amount, unit: it.unit, note: it.note || '', foods, entryId: e.id, meal: e.meal });
    }
  }
  for (const a of data.dayArchive.values()) {
    if (a.deletedAt || a.date < from || a.date > to) continue;
    for (const [key, v] of Object.entries(a.meds || {})) {
      const m = get(key, v.name, v.unit);
      m.count += v.count || 0;
      m.amount += v.amount || 0;
      extra.push({ date: a.date, key, count: v.count || 0, amount: v.amount || 0 });
      const d = m.days.get(a.date) || { date: a.date, count: 0, amount: 0 };
      d.count += v.count || 0;
      d.amount += v.amount || 0;
      m.days.set(a.date, d);
      if (a.date + ' ' > m.last) m.last = a.date + ' ';
    }
  }
  const list = [...meds.values()].map((m) => ({ ...m, amount: Math.round(m.amount * 1000) / 1000, days: [...m.days.values()].sort((x, y) => (x.date < y.date ? -1 : 1)) }))
    .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1));
  log.sort((a, b) => (a.date + (a.time || '') < b.date + (b.time || '') ? 1 : -1));
  return { meds: list, log, extra, intakes: list.reduce((s, m) => s + m.count, 0), days: new Set(list.flatMap((m) => m.days.map((d) => d.date))).size };
}

/**
 * Показания замеров за период [from, to] (0.13): по каждому виду — показания по времени (с заметкой и едой записи),
 * последнее, среднее, минимум и максимум по частям. Учитываются и сводки дней, удалённых лимитом хранения.
 */
export function measureStats(data, from, to) {
  const types = new Map();
  const get = (key, name, unit) => types.get(key) || types.set(key, { key, name, unit, readings: [] }).get(key);
  for (const e of data.entries.values()) {
    if (!isLiveEntry(e) || e.date < from || e.date > to) continue;
    const items = entryItems(e);
    const foods = items.filter((it) => !isMed(it) && !isMeasure(it)).map((it) => it.name);
    const meds = items.filter(isMed).map((it) => it.name);
    for (const it of items) {
      if (!isMeasure(it)) continue;
      const t = get(it.foodId || 'measure:' + it.name, it.name, it.unit);
      t.readings.push({ date: e.date, time: e.time || null, values: it.values || [it.amount], note: it.note || '', foods, meds, entryId: e.id, itemId: it.id, meal: e.meal });
    }
  }
  for (const a of data.dayArchive.values()) {
    if (a.deletedAt || a.date < from || a.date > to) continue;
    for (const [key, v] of Object.entries(a.measures || {})) {
      const t = get(key, v.name, v.unit);
      for (const r of v.readings || []) t.readings.push({ date: a.date, time: r.time || null, values: r.values || [], note: r.note || '', foods: [], meds: [], entryId: null, archived: true });
    }
  }
  const at = (r) => r.date + ' ' + (r.time || '');
  const list = [...types.values()].map((t) => {
    const readings = t.readings.sort((x, y) => (at(x) < at(y) ? -1 : at(x) > at(y) ? 1 : 0));
    const parts = Math.max(1, ...readings.map((r) => r.values.length));
    const stat = Array.from({ length: parts }, (_, i) => {
      const vs = readings.map((r) => r.values[i]).filter((v) => Number.isFinite(v));
      return vs.length ? { avg: vs.reduce((s, v) => s + v, 0) / vs.length, min: Math.min(...vs), max: Math.max(...vs) } : null;
    });
    return { ...t, readings, last: readings.at(-1) || null, stat, count: readings.length };
  }).sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1));
  return { types: list, count: list.reduce((s, t) => s + t.count, 0) };
}

/** Группировки графиков лекарств (0.13): по часам — суммарно за период по часу суток; по дням, месяцам и годам — по времени. */
export const MED_GROUPS = ['hour', 'day', 'month', 'year'];

/**
 * Корзины графика лекарств: [{ key, label, title, values: { ключ лекарства: число } }].
 * log — журнал приёмов (medStats().log, с временем), extra — приёмы из сводок дней ({ date, key, count, amount });
 * metric — 'count' (приёмы) или 'amount' (количество в единицах лекарства).
 */
export function medBuckets({ log = [], extra = [], from, to, group = 'day', metric = 'count', keys = null }) {
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

/** Самый ранний день с записями (или сводкой). */
export function firstDay(data) {
  let first = null;
  for (const e of data.entries.values()) if (isLiveEntry(e) && (!first || e.date < first)) first = e.date;
  for (const a of data.dayArchive.values()) if (!a.deletedAt && (!first || a.date < first)) first = a.date;
  return first;
}

/**
 * Сводка периода: дни с записями, средние за день (по дням с записями), дни сверх лимита,
 * средние значения всех веществ, топ продуктов по калориям и по числу записей.
 */
export function periodStats(data, from, to, goal) {
  const series = dailySeries(data, from, to);
  const logged = series.filter((d) => d.count > 0);
  const n = logged.length || 1;
  const sum = sumNutrients(logged.map((d) => d.totals));
  const avg = Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, nv(sum, k) / n]));
  const over = logged.filter((d) => nv(d.totals, 'kcal') > goal).length;
  const foods = new Map();
  const add = (key, name, kcal, count) => {
    const f = foods.get(key) || { key, name, kcal: 0, count: 0 };
    f.kcal += kcal;
    f.count += count;
    foods.set(key, f);
  };
  for (const e of data.entries.values()) {
    if (!isLiveEntry(e) || e.date < from || e.date > to) continue;
    for (const it of entryItems(e)) if (!isMed(it)) add(it.foodId || 'quick:' + it.name, it.name, nv(itemNutrients(it), 'kcal'), 1);
  }
  for (const a of data.dayArchive.values()) {
    if (a.deletedAt || a.date < from || a.date > to) continue;
    for (const [key, f] of Object.entries(a.foods || {})) add(key, f.name, f.kcal || 0, f.count || 0);
  }
  const top = [...foods.values()];
  return {
    series,
    days: daysBetween(from, to) + 1,
    logged: logged.length,
    over,
    avg,
    total: sum,
    entries: logged.reduce((s, d) => s + d.count, 0),
    topByKcal: [...top].sort((a, b) => b.kcal - a.kcal).slice(0, 10),
    topByCount: [...top].sort((a, b) => b.count - a.count || b.kcal - a.kcal).slice(0, 10),
  };
}
