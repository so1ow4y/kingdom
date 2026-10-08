// Feast (обновление 0.11): тело — возраст, обмен веществ, ИМТ, процент жира, тренд веса. Чистые функции.
//
// Обмен — формула Миффлина — Сан Жеора, расход — × коэффициент активности. Процент жира: замер человека,
// иначе метод ВМС США по обхватам (талия, шея, у женщин — бёдра), иначе оценка по ИМТ (Дойренберг, 1991).
// Это оценки для ориентира, а не диагноз — так и пишется в интерфейсе.

import { addDays, daysBetween } from './dates.js';
import { MACROS, KCAL_PER_G, DEFAULT_MACRO_PCT, gramsFromPct } from './nutrition.js';

export const SEXES = [
  { key: 'male', label: 'Мужской' },
  { key: 'female', label: 'Женский' },
];

export const ACTIVITY = [
  { key: 'sedentary', label: 'Сидячий образ жизни', hint: 'Почти без движения', factor: 1.2 },
  { key: 'light', label: 'Лёгкая активность', hint: 'Прогулки, 1–3 тренировки в неделю', factor: 1.375 },
  { key: 'moderate', label: 'Средняя', hint: '3–5 тренировок в неделю', factor: 1.55 },
  { key: 'active', label: 'Высокая', hint: '6–7 тренировок в неделю', factor: 1.725 },
  { key: 'very', label: 'Очень высокая', hint: 'Физическая работа и спорт', factor: 1.9 },
];

export const GOALS = [
  { key: 'lose', label: 'Похудеть', delta: -500 },
  { key: 'keep', label: 'Держать вес', delta: 0 },
  { key: 'gain', label: 'Набрать', delta: 300 },
];

const ok = (x) => Number.isFinite(x) && x > 0;

/** Полных лет на дату. */
export function ageOn(birthDate, today) {
  if (!birthDate || !today) return null;
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  let a = ty - by;
  if (tm < bm || (tm === bm && td < bd)) a--;
  return a >= 0 && a < 150 ? a : null;
}

/** Базовый обмен, ккал в сутки (Миффлин — Сан Жеор). */
export function bmr({ sex, weightKg, heightCm, age }) {
  if (!ok(weightKg) || !ok(heightCm) || !Number.isFinite(age) || !sex) return null;
  return Math.round(10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'male' ? 5 : -161));
}

// ---------- Активность (0.12.2: свои активности) ----------

/** Свои активности из настроек: { id: 'c:…', name, hint, kcal } — сколько ккал в день сверх базового обмена. */
export const ACTIVITY_NAME_MAX = 40;
export const ACTIVITY_KCAL_MAX = 3000;
export const CUSTOM_ACTIVITY_MAX = 20;

export function customActivities(list) {
  return (Array.isArray(list) ? list : []).filter((a) => a && typeof a.id === 'string' && a.name && Number.isFinite(a.kcal));
}

/** Все активности: встроенные (коэффициент к обмену) и свои (ккал в день). */
export function activityList(custom = []) {
  return [...ACTIVITY, ...customActivities(custom).map((a) => ({ key: a.id, label: a.name, hint: a.hint || '', kcal: a.kcal, custom: true }))];
}

/** Активность по ключу; неизвестная (удалённая своя) — «Лёгкая активность». */
export function activityOf(key, custom = []) {
  return activityList(custom).find((a) => a.key === key) || ACTIVITY[1];
}

/** Сколько ккал в день добавляет активность к базовому обмену (null — обмен неизвестен, а активность — коэффициентом). */
export function activityBurn(a, base) {
  if (Number.isFinite(a.kcal)) return Math.round(a.kcal);
  return base ? Math.round(base * (a.factor - 1)) : null;
}

/** Подпись активности для списка: «… · +620 ккал в день» (или коэффициент, пока обмен не посчитан). */
export function activityLabel(a, base) {
  const burn = activityBurn(a, base);
  const tail = burn != null ? `+${burn} ккал в день` : `обмен × ${String(a.factor).replace('.', ',')}`;
  return `${a.label}${a.hint ? ' — ' + a.hint : ''} · ${tail}`;
}

/** Расход за сутки с учётом активности (p.activities — свои активности из настроек). */
export function tdee(p) {
  const b = bmr(p);
  if (!b) return null;
  return b + activityBurn(activityOf(p.activity, p.activities), b);
}

/** Безопасный минимум калорий по умолчанию: 1500 у мужчин, 1200 у женщин. */
export const defaultFloor = (sex) => (sex === 'male' ? 1500 : 1200);

/**
 * Рекомендуемый лимит калорий под цель (не ниже минимума), до десятков. 0.12: дефицит, профицит и минимум
 * настраиваются (opts.lose — сколько отнять для похудения, opts.gain — сколько добавить для набора, opts.floor).
 */
export function recommendedKcal(p, opts = {}) {
  const t = tdee(p);
  if (!t) return null;
  const lose = Number.isFinite(opts.lose) && opts.lose >= 0 ? opts.lose : 500;
  const gain = Number.isFinite(opts.gain) && opts.gain >= 0 ? opts.gain : 300;
  const delta = p.goal === 'lose' ? -lose : p.goal === 'gain' ? gain : 0;
  const floor = Number.isFinite(opts.floor) && opts.floor > 0 ? opts.floor : defaultFloor(p.sex);
  return Math.max(floor, Math.round((t + delta) / 10) * 10);
}

/**
 * Рекомендация с настройками человека (0.12): { auto — расчёт, value — что рекомендуем (своя, если задана), own }.
 * settings: loseKcal, gainKcal, minKcal, recKcal (null — по умолчанию).
 */
export function recommendation(p, settings = {}) {
  const n = (v) => (Number.isFinite(v) && v > 0 ? v : null);
  const auto = recommendedKcal(p, { lose: settings.loseKcal ?? undefined, gain: settings.gainKcal ?? undefined, floor: n(settings.minKcal) ?? undefined });
  const own = n(settings.recKcal);
  return { auto, own, value: own ?? auto };
}

/** Чего не хватает для расчёта обмена: ['пол', 'дата рождения', 'рост', 'вес']. */
export function missingForBmr(p) {
  const out = [];
  if (!p.sex) out.push('пол');
  if (!Number.isFinite(p.age)) out.push('дата рождения');
  if (!ok(p.heightCm)) out.push('рост');
  if (!ok(p.weightKg)) out.push('вес');
  return out;
}

/** Белок на кг веса под цель (г): похудеть — 2,0 (сохранить мышцы), держать — 1,6, набрать — 1,8. */
export const PROTEIN_PER_KG = { lose: 2, keep: 1.6, gain: 1.8 };
/** Жир на кг веса (г), но не меньше 20 % и не больше 35 % калорий. */
export const FAT_PER_KG = 0.9;

/**
 * «Рассчитать» (0.12.2): лимит калорий — рекомендация (своя или расчёт), БЖУ в граммах — белок и жир по весу и цели,
 * углеводы — остальное. Граммы округляются вниз: вместе они никогда не дают больше лимита.
 * → { kcal, grams, why } или { missing: [...] }.
 */
export function calcGoals(p, settings = {}) {
  const r = recommendation(p, settings);
  if (!r.value) return { missing: missingForBmr(p) };
  const kcal = r.value;
  const kg = ok(p.weightKg) ? p.weightKg : null;
  if (!kg) return { kcal, grams: gramsFromPct(kcal, DEFAULT_MACRO_PCT), why: 'вес не указан — БЖУ по умолчанию: 20 / 30 / 50 %' };
  const perKg = PROTEIN_PER_KG[p.goal] ?? PROTEIN_PER_KG.keep;
  let protein = Math.floor(perKg * kg);
  let fat = Math.floor(Math.min(Math.max(FAT_PER_KG * kg, (kcal * 0.2) / 9), (kcal * 0.35) / 9));
  // очень маленький лимит: белок и жир вместе не больше 80 % калорий (углеводам — хоть что-то)
  const pf = protein * KCAL_PER_G.protein + fat * KCAL_PER_G.fat;
  if (pf > kcal * 0.8) {
    const k = (kcal * 0.8) / pf;
    protein = Math.floor(protein * k);
    fat = Math.floor(fat * k);
  }
  const carbs = Math.max(0, Math.floor((kcal - protein * KCAL_PER_G.protein - fat * KCAL_PER_G.fat) / KCAL_PER_G.carbs));
  const grams = { protein, fat, carbs };
  for (const m of MACROS) grams[m] = Math.max(0, grams[m]);
  const n = (v) => String(v).replace('.', ',');
  return { kcal, grams, why: `белок ${n(perKg)} г на кг (${n(Math.round(kg * 10) / 10)} кг), жир ≈ ${n(FAT_PER_KG)} г на кг, углеводы — остальное` };
}

export function bmi(weightKg, heightCm) {
  if (!ok(weightKg) || !ok(heightCm)) return null;
  const m = heightCm / 100;
  return weightKg / (m * m);
}

export const BMI_CLASSES = [
  { max: 18.5, label: 'Недостаток веса', tone: 'warn' },
  { max: 25, label: 'Норма', tone: 'ok' },
  { max: 30, label: 'Избыточный вес', tone: 'warn' },
  { max: Infinity, label: 'Ожирение', tone: 'danger' },
];
export const bmiClass = (v) => (Number.isFinite(v) ? BMI_CLASSES.find((c) => v < c.max) : null);

const log10 = Math.log10;

/** Процент жира по обхватам (метод ВМС США), см. null — если не хватает замеров. */
export function bodyFatNavy({ sex, heightCm, waistCm, neckCm, hipCm }) {
  if (!ok(heightCm) || !ok(waistCm) || !ok(neckCm)) return null;
  let v;
  if (sex === 'male') {
    if (waistCm <= neckCm) return null;
    v = 495 / (1.0324 - 0.19077 * log10(waistCm - neckCm) + 0.15456 * log10(heightCm)) - 450;
  } else if (sex === 'female') {
    if (!ok(hipCm) || waistCm + hipCm <= neckCm) return null;
    v = 495 / (1.29579 - 0.35004 * log10(waistCm + hipCm - neckCm) + 0.221 * log10(heightCm)) - 450;
  } else return null;
  return Number.isFinite(v) ? Math.max(2, Math.min(70, v)) : null;
}

/** Процент жира по ИМТ и возрасту (Дойренберг). */
export function bodyFatBmi({ sex, bmi: b, age }) {
  if (!Number.isFinite(b) || !Number.isFinite(age) || !sex) return null;
  const v = 1.2 * b + 0.23 * age - 10.8 * (sex === 'male' ? 1 : 0) - 5.4;
  return Math.max(2, Math.min(70, v));
}

/**
 * Лучшая доступная оценка: { pct, method: 'measured' | 'navy' | 'bmi' } или null.
 * p: { sex, age, heightCm, weightKg, waistCm, neckCm, hipCm, bodyFatPct }.
 */
export function estimateBodyFat(p) {
  if (ok(p.bodyFatPct)) return { pct: p.bodyFatPct, method: 'measured' };
  const navy = bodyFatNavy(p);
  if (navy != null) return { pct: navy, method: 'navy' };
  const b = bmi(p.weightKg, p.heightCm);
  const v = bodyFatBmi({ sex: p.sex, bmi: b, age: p.age });
  return v != null ? { pct: v, method: 'bmi' } : null;
}

export const BF_METHOD = { measured: 'по замеру', navy: 'по обхватам (метод ВМС США)', bmi: 'по росту, весу и возрасту' };

/** Ступени процента жира (ACE): у мужчин и женщин разные. */
export const BF_CLASSES = {
  male: [
    { key: 'essential', label: 'Жизненно необходимый', from: 2, to: 6 },
    { key: 'athlete', label: 'Спортсмен', from: 6, to: 14 },
    { key: 'fitness', label: 'Подтянутый', from: 14, to: 18 },
    { key: 'average', label: 'Средний', from: 18, to: 25 },
    { key: 'high', label: 'Высокий', from: 25, to: 45 },
  ],
  female: [
    { key: 'essential', label: 'Жизненно необходимый', from: 10, to: 14 },
    { key: 'athlete', label: 'Спортсменка', from: 14, to: 21 },
    { key: 'fitness', label: 'Подтянутая', from: 21, to: 25 },
    { key: 'average', label: 'Средний', from: 25, to: 32 },
    { key: 'high', label: 'Высокий', from: 32, to: 50 },
  ],
};

export function bfClass(sex, pct) {
  const list = BF_CLASSES[sex] || BF_CLASSES.male;
  if (!Number.isFinite(pct)) return null;
  return list.find((c) => pct < c.to) || list.at(-1);
}

/** Сколько килограммов жира и всего остального. */
export function composition(weightKg, pct) {
  if (!ok(weightKg) || !Number.isFinite(pct)) return null;
  const fat = (weightKg * pct) / 100;
  return { fatKg: fat, leanKg: weightKg - fat };
}

/** Вес, при котором ИМТ равен заданному. */
export const weightForBmi = (b, heightCm) => (ok(heightCm) ? b * (heightCm / 100) ** 2 : null);

// ---------- Замеры во времени ----------

/** Последнее известное значение поля на дату (замеры идут не каждый день). */
export function latest(logs, field, upTo = null) {
  let best = null;
  for (const l of logs) {
    if (l.deletedAt || !ok(l[field]) || (upTo && l.date > upTo)) continue;
    if (!best || l.date > best.date) best = l;
  }
  return best ? { value: best[field], date: best.date } : null;
}

/** Ряд веса по датам (по одному значению на день — последнему записанному). */
export function weightSeries(logs, from = null, to = null) {
  const byDate = new Map();
  for (const l of logs) {
    if (l.deletedAt || !ok(l.weightKg)) continue;
    if ((from && l.date < from) || (to && l.date > to)) continue;
    const prev = byDate.get(l.date);
    if (!prev || (l.updatedAt || '') > (prev.updatedAt || '')) byDate.set(l.date, l);
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).map((l) => ({ date: l.date, kg: l.weightKg }));
}

/** Скользящее среднее за window дней (по календарю, не по числу точек). */
export function movingAverage(series, window = 7) {
  return series.map((p) => {
    const from = addDays(p.date, -(window - 1));
    const pts = series.filter((q) => q.date >= from && q.date <= p.date);
    return { date: p.date, kg: pts.reduce((s, q) => s + q.kg, 0) / pts.length };
  });
}

/** Скорость изменения веса, кг в неделю — наклон прямой по точкам последних days дней (null — мало точек). */
export function weeklyRate(series, today, days = 28) {
  const from = addDays(today, -days);
  const pts = series.filter((p) => p.date >= from);
  if (pts.length < 2) return null;
  const xs = pts.map((p) => daysBetween(pts[0].date, p.date));
  const ys = pts.map((p) => p.kg);
  const mx = xs.reduce((s, x) => s + x, 0) / xs.length;
  const my = ys.reduce((s, y) => s + y, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  return sxx ? (sxy / sxx) * 7 : null;
}
