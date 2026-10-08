// Feast (обновление 0.11): справочник пищевых веществ и арифметика дневника. Чистые функции, без браузерных API.
//
// Значения продукта хранятся на 100 г (или 100 мл) — разреженно: чего нет, то 0 (по умолчанию нули у всех).
// Нормы (rdi) — справочные суточные значения для взрослого (как NRV/RI на этикетках ЕС и России): по ним
// считаются проценты «от нормы» в дневнике и аналитике. Калории и БЖУ — из целей человека (feast settings).

/** Основные рационы по умолчанию (0.12 — это записи коллекции meals с этими id, их можно переименовать). */
export const MEALS = [
  { key: 'breakfast', label: 'Завтрак', icon: '🌅' },
  { key: 'lunch', label: 'Обед', icon: '🍲' },
  { key: 'dinner', label: 'Ужин', icon: '🌙' },
  { key: 'snack', label: 'Перекус', icon: '🍎' },
];
export const MEAL_KEYS = MEALS.map((m) => m.key);
export const mealLabel = (k) => MEALS.find((m) => m.key === k)?.label || 'Перекус';

/** group: main — КБЖУ, more — подробнее, vitamins, minerals. */
export const NUTRIENTS = [
  { key: 'kcal', label: 'Калории', short: 'ккал', unit: 'ккал', group: 'main', rdi: 2000 },
  { key: 'protein', label: 'Белки', short: 'Б', unit: 'г', group: 'main', rdi: 50 },
  { key: 'fat', label: 'Жиры', short: 'Ж', unit: 'г', group: 'main', rdi: 70 },
  { key: 'carbs', label: 'Углеводы', short: 'У', unit: 'г', group: 'main', rdi: 260 },

  { key: 'fiber', label: 'Клетчатка', unit: 'г', group: 'more', rdi: 25 },
  { key: 'sugar', label: 'Сахара', unit: 'г', group: 'more', rdi: 90 },
  { key: 'satFat', label: 'Насыщенные жиры', unit: 'г', group: 'more', rdi: 20 },
  { key: 'transFat', label: 'Трансжиры', unit: 'г', group: 'more', rdi: null },
  { key: 'cholesterol', label: 'Холестерин', unit: 'мг', group: 'more', rdi: 300 },
  { key: 'salt', label: 'Соль', unit: 'г', group: 'more', rdi: 6 },
  { key: 'water', label: 'Вода', unit: 'г', group: 'more', rdi: null },

  { key: 'vitA', label: 'Витамин A', unit: 'мкг', group: 'vitamins', rdi: 800 },
  { key: 'vitB1', label: 'Витамин B1 (тиамин)', unit: 'мг', group: 'vitamins', rdi: 1.1 },
  { key: 'vitB2', label: 'Витамин B2 (рибофлавин)', unit: 'мг', group: 'vitamins', rdi: 1.4 },
  { key: 'vitB3', label: 'Витамин B3 (PP, ниацин)', unit: 'мг', group: 'vitamins', rdi: 16 },
  { key: 'vitB5', label: 'Витамин B5', unit: 'мг', group: 'vitamins', rdi: 6 },
  { key: 'vitB6', label: 'Витамин B6', unit: 'мг', group: 'vitamins', rdi: 1.4 },
  { key: 'vitB7', label: 'Витамин B7 (биотин)', unit: 'мкг', group: 'vitamins', rdi: 50 },
  { key: 'vitB9', label: 'Витамин B9 (фолаты)', unit: 'мкг', group: 'vitamins', rdi: 200 },
  { key: 'vitB12', label: 'Витамин B12', unit: 'мкг', group: 'vitamins', rdi: 2.5 },
  { key: 'vitC', label: 'Витамин C', unit: 'мг', group: 'vitamins', rdi: 80 },
  { key: 'vitD', label: 'Витамин D', unit: 'мкг', group: 'vitamins', rdi: 5 },
  { key: 'vitE', label: 'Витамин E', unit: 'мг', group: 'vitamins', rdi: 12 },
  { key: 'vitK', label: 'Витамин K', unit: 'мкг', group: 'vitamins', rdi: 75 },

  { key: 'calcium', label: 'Кальций', unit: 'мг', group: 'minerals', rdi: 800 },
  { key: 'iron', label: 'Железо', unit: 'мг', group: 'minerals', rdi: 14 },
  { key: 'magnesium', label: 'Магний', unit: 'мг', group: 'minerals', rdi: 375 },
  { key: 'phosphorus', label: 'Фосфор', unit: 'мг', group: 'minerals', rdi: 700 },
  { key: 'potassium', label: 'Калий', unit: 'мг', group: 'minerals', rdi: 2000 },
  { key: 'sodium', label: 'Натрий', unit: 'мг', group: 'minerals', rdi: 2400 },
  { key: 'zinc', label: 'Цинк', unit: 'мг', group: 'minerals', rdi: 10 },
  { key: 'copper', label: 'Медь', unit: 'мг', group: 'minerals', rdi: 1 },
  { key: 'manganese', label: 'Марганец', unit: 'мг', group: 'minerals', rdi: 2 },
  { key: 'selenium', label: 'Селен', unit: 'мкг', group: 'minerals', rdi: 55 },
  { key: 'iodine', label: 'Йод', unit: 'мкг', group: 'minerals', rdi: 150 },
];
export const NUTRIENT = Object.fromEntries(NUTRIENTS.map((n) => [n.key, n]));
export const NUTRIENT_KEYS = NUTRIENTS.map((n) => n.key);
export const NUTRIENT_GROUPS = [
  { key: 'main', label: 'Калории и БЖУ' },
  { key: 'more', label: 'Подробнее' },
  { key: 'vitamins', label: 'Витамины' },
  { key: 'minerals', label: 'Минералы' },
];
export const MACROS = ['protein', 'fat', 'carbs'];
/** Ккал в грамме: белки и углеводы — 4, жиры — 9. */
export const KCAL_PER_G = { protein: 4, fat: 9, carbs: 4 };

const MAX_VALUE = 1e6;

/** Привести ввод к числу ≥ 0 (запятая — как точка); пусто и мусор — 0. */
export function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.min(v, MAX_VALUE) : 0;
  const n = parseFloat(String(v ?? '').replace(',', '.').replace(/\s+/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_VALUE) : 0;
}

/** Только известные вещества, только больше нуля, округление до тысячных. */
export function cleanNutrients(n = {}) {
  const out = {};
  for (const k of NUTRIENT_KEYS) {
    const v = num(n[k]);
    if (v) out[k] = Math.round(v * 1000) / 1000;
  }
  return out;
}

export const nv = (n, k) => (n && Number.isFinite(n[k]) ? n[k] : 0);

/** Умножить значения на коэффициент. */
export function scaleNutrients(n, factor) {
  const out = {};
  for (const [k, v] of Object.entries(n || {})) if (NUTRIENT[k] && Number.isFinite(v)) out[k] = v * factor;
  return out;
}

export function addNutrients(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) if (Number.isFinite(v)) out[k] = (out[k] || 0) + v;
  return out;
}

export function sumNutrients(list) {
  return list.reduce((s, n) => addNutrients(s, n), {});
}

/** Калории по БЖУ (если на этикетке их не указали). */
export const kcalFromMacros = (n) => Math.round(nv(n, 'protein') * 4 + nv(n, 'fat') * 9 + nv(n, 'carbs') * 4);

/** Доли калорий от белков, жиров и углеводов (0…1; сумма 1, если есть хоть что-то). */
export function macroSplit(n) {
  const e = { protein: nv(n, 'protein') * 4, fat: nv(n, 'fat') * 9, carbs: nv(n, 'carbs') * 4 };
  const sum = e.protein + e.fat + e.carbs;
  if (!sum) return { protein: 0, fat: 0, carbs: 0 };
  return { protein: e.protein / sum, fat: e.fat / sum, carbs: e.carbs / sum };
}

/** Красиво для экрана: ккал — целые, остальное — до десятых (мелкое — до сотых), без хвостовых нулей. */
export function fmt(v, key = 'protein') {
  const x = Number.isFinite(v) ? v : 0;
  if (key === 'kcal') return String(Math.round(x));
  const d = Math.abs(x) >= 10 ? 1 : Math.abs(x) >= 0.1 || x === 0 ? 1 : 2;
  return String(Math.round(x * 10 ** d) / 10 ** d).replace('.', ',');
}

export const fmtWithUnit = (v, key) => `${fmt(v, key)} ${NUTRIENT[key]?.unit || ''}`.trim();

/** Процент суточной нормы (null — нормы нет). */
export function rdiPct(v, key, goals = null) {
  const target = goals?.[key] ?? NUTRIENT[key]?.rdi;
  return target ? (v / target) * 100 : null;
}

// ---------- Записи дневника ----------

/** Значения продукта в записи: на 100 г/мл × количество, у «порции» (быстрая запись) — × число порций. */
export function itemNutrients(it) {
  if (!it || it.deletedAt) return {};
  const amount = Number.isFinite(it.amount) ? it.amount : 0;
  return scaleNutrients(it.nutrients || {}, it.unit === 'portion' ? amount : amount / 100);
}

/**
 * Значения записи: с 0.12 запись — приём пищи из нескольких продуктов (items); у записей 0.11 продукт
 * один и лежит в полях самой записи.
 */
export function entryNutrients(e) {
  if (!e || e.deletedAt) return {};
  if (Array.isArray(e.items)) return sumNutrients(e.items.filter((x) => x && !x.deletedAt).map(itemNutrients));
  return itemNutrients(e);
}

export const entryKcal = (e) => nv(entryNutrients(e), 'kcal');

/** Подпись количества: «150 г», «200 мл», «2 порции». */
export function amountLabel(e) {
  const a = Number.isFinite(e?.amount) ? e.amount : 0;
  if (e?.unit === 'portion') return a === 1 ? '1 порция' : `${fmt(a, 'x')} порц.`;
  return `${fmt(a, 'x')} ${e?.unit === 'ml' ? 'мл' : 'г'}`;
}

// ---------- Цели: калории и БЖУ (0.12) ----------

/** Допустимый дневной лимит калорий. */
export const KCAL_RANGE = [800, 10000];
export const MACRO_GRAMS_MAX = 1000;
/** Доли калорий по умолчанию: белки 20 %, жиры 30 %, углеводы 50 %. */
export const DEFAULT_MACRO_PCT = { protein: 20, fat: 30, carbs: 50 };

const int = (v) => (Number.isFinite(v) ? Math.round(v) : Math.round(num(v)));

/**
 * Как заданы БЖУ: 'pct' — долями калорий (граммы считаются от лимита сами), 'grams' — граммами.
 * У настроек до 0.12 режима нет: заданы граммы — 'grams', иначе 'pct'.
 */
export function macroMode(settings) {
  if (settings?.macroMode === 'pct' || settings?.macroMode === 'grams') return settings.macroMode;
  return MACROS.some((k) => num(settings?.[k + 'Goal'])) ? 'grams' : 'pct';
}

/** Доли БЖУ из настроек (не заданы — по умолчанию). */
export function macroPcts(settings) {
  const out = {};
  for (const k of MACROS) {
    const v = settings?.[k + 'Pct'];
    out[k] = Number.isFinite(v) ? v : DEFAULT_MACRO_PCT[k];
  }
  return out;
}

/** Граммы по долям: вниз до целого, чтобы сумма калорий БЖУ никогда не превышала лимит. */
export function gramsFromPct(kcal, pct) {
  const out = {};
  for (const k of MACROS) out[k] = Math.max(0, Math.floor((kcal * (pct[k] || 0)) / 100 / KCAL_PER_G[k] + 1e-9));
  return out;
}

/** Доли калорий от граммов (до целых процентов). */
export function pctFromGrams(kcal, grams) {
  const out = {};
  for (const k of MACROS) out[k] = kcal > 0 ? Math.round(((grams[k] || 0) * KCAL_PER_G[k] * 100) / kcal) : 0;
  return out;
}

/**
 * Доли по граммам так, чтобы в сумме было ровно 100 % (для перехода «в граммах» → «в процентах»): доля каждого
 * в калориях БЖУ, округление методом наибольших остатков. Граммов нет — доли по умолчанию.
 */
export function normalizedPct(grams) {
  const kcal = MACROS.map((k) => (grams[k] || 0) * KCAL_PER_G[k]);
  const total = kcal.reduce((s, v) => s + v, 0);
  if (!(total > 0)) return { ...DEFAULT_MACRO_PCT };
  const raw = kcal.map((v) => (v * 100) / total);
  const out = raw.map(Math.floor);
  let left = 100 - out.reduce((s, v) => s + v, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
  for (let j = 0; left > 0; j = (j + 1) % order.length, left--) out[order[j][1]]++;
  return Object.fromEntries(MACROS.map((k, i) => [k, out[i]]));
}

export const macrosKcal = (grams) => MACROS.reduce((s, k) => s + (grams[k] || 0) * KCAL_PER_G[k], 0);

/**
 * Цели на день: калории — из настроек; БЖУ — по долям калорий (граммы считаются от лимита) или заданными граммами.
 * Остальное — справочные нормы.
 */
export function dayGoals(settings) {
  const kcal = num(settings?.kcalGoal) || 2000;
  if (macroMode(settings) === 'grams') {
    const def = gramsFromPct(kcal, DEFAULT_MACRO_PCT);
    const g = (k) => num(settings?.[k + 'Goal']) || def[k];
    return { kcal, protein: g('protein'), fat: g('fat'), carbs: g('carbs') };
  }
  return { kcal, ...gramsFromPct(kcal, macroPcts(settings)) };
}

/**
 * Проверка целей перед сохранением: { ok, error, total, kcal }.
 * Лимит — в KCAL_RANGE; доли — от 0 до 100 и в сумме ровно 100 %; граммы — не больше лимита калорий вместе.
 */
export function checkGoals({ kcal, mode, pct = {}, grams = {} }) {
  const k = int(kcal);
  const res = (error, total = 0) => ({ ok: !error, error, total, kcal: k });
  if (!k || k < KCAL_RANGE[0] || k > KCAL_RANGE[1]) return res(`Лимит калорий — от ${KCAL_RANGE[0]} до ${KCAL_RANGE[1]} ккал`);
  if (mode === 'pct') {
    const vals = MACROS.map((m) => pct[m]);
    if (vals.some((v) => !Number.isFinite(v) || v < 0 || v > 100)) return res('Каждая доля — от 0 до 100 %');
    const total = vals.reduce((s, v) => s + v, 0);
    if (Math.abs(total - 100) > 0.001) return res(`Доли БЖУ в сумме должны быть 100 % — сейчас ${total} %`, total);
    return res(null, total);
  }
  const vals = MACROS.map((m) => grams[m]);
  if (vals.some((v) => !Number.isFinite(v) || v < 0 || v > MACRO_GRAMS_MAX)) return res(`Граммы — от 0 до ${MACRO_GRAMS_MAX}`);
  const total = macrosKcal(grams);
  if (total > k) return res(`Белки, жиры и углеводы дают ${total} ккал — больше лимита ${k} на ${total - k}`, total);
  return res(null, total);
}

/**
 * Изменения настроек для сохранения целей (после checkGoals). В режиме долей граммы тоже записываются
 * (рассчитанные) — их видят клиенты 0.11–0.12.0, не знающие долей.
 */
export function goalChanges({ kcal, mode, pct = {}, grams = {} }) {
  const k = int(kcal);
  if (mode === 'pct') {
    const g = gramsFromPct(k, pct);
    return { kcalGoal: k, macroMode: 'pct', proteinPct: pct.protein, fatPct: pct.fat, carbsPct: pct.carbs,
      proteinGoal: g.protein, fatGoal: g.fat, carbsGoal: g.carbs };
  }
  return { kcalGoal: k, macroMode: 'grams', proteinGoal: int(grams.protein), fatGoal: int(grams.fat), carbsGoal: int(grams.carbs) };
}

/** Только лимит калорий (кнопки «Сделать лимитом» / «Подставить»): доли пересчитывают граммы, граммы — проверяются. */
export function kcalGoalChanges(settings, kcal) {
  const mode = macroMode(settings);
  const goals = dayGoals(settings);
  const input = { kcal, mode, pct: macroPcts(settings), grams: { protein: goals.protein, fat: goals.fat, carbs: goals.carbs } };
  const check = checkGoals(input);
  return check.ok ? { ok: true, changes: goalChanges(input) } : { ok: false, error: check.error };
}

/**
 * «Осталось» как в дневнике FatSecret: цель − съедено. Отрицательное — превышение лимита (−247).
 */
export function remaining(goal, eaten) {
  return Math.round(goal) - Math.round(eaten);
}

export const signed = (n) => (n < 0 ? '−' + Math.abs(n) : String(n));
