// Feast (обновление 0.11): таблица «Продукты» — как обозреватель задач (core/explore.js): строка «поле:значение»,
// топ значений, массовые действия. Чистые функции.

import { parseQuery, evaluate, textMatch, textContains } from './query.js';
import { foodBarcodes, foodUsage, isMed, isMeasure } from './feast.js';
import { nv, NUTRIENTS, NUTRIENT } from './nutrition.js';
import { localDateOf } from './dates.js';
import { LANG, tr } from './i18n.js';

export const FOOD_FIELDS = {
  'название': ['name', 'title'],
  'тип': ['type', 'kind', 'вид'],
  'бренд': ['brand'],
  'штрихкод': ['barcode', 'code', 'ean'],
  'ккал': ['kcal', 'калории'],
  'белки': ['protein', 'б'],
  'жиры': ['fat', 'ж'],
  'углеводы': ['carbs', 'у'],
  'создан': ['created', 'дата', 'date'],
  'записей': ['uses', 'съеден'],
  'есть': ['has'],
  'доза': ['dose'],
};

// 0.12.5: тип записи каталога — продукт или лекарство
const KIND_WORDS = {
  med: ['лекарство', 'лекарства', 'лекарств', 'med', 'meds', 'medicine', 'таблетки', 'препарат'],
  food: ['продукт', 'продукты', 'еда', 'food', 'product', 'products'],
  measure: ['замер', 'замеры', 'measure', 'measures', 'measurement'],
};
export const kindWord = (f) => (isMed(f) ? tr('лекарство') : isMeasure(f) ? tr('замер') : tr('продукт'));
/** Поле запроса для показа: по-английски — английский синоним (запрос понимает оба). */
export const foodFieldLabel = (f) => (LANG === 'en' ? (FOOD_FIELDS[f] || []).find((x) => /^[a-z]+$/.test(x)) || f : f);

export const FOOD_PLACEHOLDER = LANG === 'en' ? 'kcal:<150 protein:>10 has:barcode yogurt' : 'ккал:<150 белки:>10 есть:штрихкод творог';

const HAS = {
  barcode: ['barcode', 'штрихкод', 'код'],
  serving: ['serving', 'порция'],
  vitamins: ['vitamins', 'витамины'],
  minerals: ['minerals', 'минералы'],
  note: ['note', 'заметка'],
  favorite: ['favorite', 'избранное', 'звезда'],
  brand: ['brand', 'бренд'],
};

/** Число против условия: «>200», «<=5», «100..300», «150» (±0,5). */
export function numMatch(v, value) {
  const s = String(value).replace(',', '.').trim();
  const range = /^(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)$/.exec(s);
  if (range) return v >= +range[1] && v <= +range[2];
  const cmp = /^(>=|<=|>|<|=)?(-?\d+(?:\.\d+)?)$/.exec(s);
  if (!cmp) return false;
  const x = +cmp[2];
  switch (cmp[1]) {
    case '>': return v > x;
    case '<': return v < x;
    case '>=': return v >= x;
    case '<=': return v <= x;
    default: return Math.abs(v - x) <= 0.5;
  }
}

function hasFlag(f, key) {
  switch (key) {
    case 'barcode': return foodBarcodes(f).length > 0;
    case 'serving': return !!f.servingSize;
    case 'vitamins': return NUTRIENTS.some((n) => n.group === 'vitamins' && nv(f.nutrients, n.key) > 0);
    case 'minerals': return NUTRIENTS.some((n) => n.group === 'minerals' && nv(f.nutrients, n.key) > 0);
    case 'note': return !!(f.note || '').trim();
    case 'favorite': return !!f.favorite;
    case 'brand': return !!f.brand;
    default: return false;
  }
}

export function makeFoodContext(data, tz) {
  return { data, tz, usage: foodUsage(data) };
}

export function matchFood(ctx, f, { field, value }) {
  switch (field) {
    case null: return textContains(f.name, value) || textContains(f.brand, value) || foodBarcodes(f).some((c) => c.startsWith(value));
    case 'название': return textContains(f.name, value);
    case 'тип': {
      const v = value.toLowerCase();
      if (KIND_WORDS.med.includes(v)) return isMed(f);
      if (KIND_WORDS.measure.includes(v)) return isMeasure(f);
      if (KIND_WORDS.food.includes(v)) return !isMed(f) && !isMeasure(f);
      return false;
    }
    case 'доза': return isMed(f) && numMatch(f.dose || 1, value);
    case 'бренд': return textMatch(f.brand || '', value) || textContains(f.brand || '', value);
    case 'штрихкод': return foodBarcodes(f).some((c) => (value.includes('*') ? textMatch(c, value) : c.startsWith(value)));
    case 'ккал': return !isMed(f) && !isMeasure(f) && numMatch(nv(f.nutrients, 'kcal'), value);
    case 'белки': return numMatch(nv(f.nutrients, 'protein'), value);
    case 'жиры': return numMatch(nv(f.nutrients, 'fat'), value);
    case 'углеводы': return numMatch(nv(f.nutrients, 'carbs'), value);
    case 'записей': return numMatch(ctx.usage.get(f.id)?.count || 0, value);
    case 'создан': {
      const d = localDateOf(f.createdAt, ctx.tz);
      const v = value.toLowerCase();
      const cmp = /^(>=|<=|>|<)(.+)$/.exec(v);
      if (cmp) {
        const [, op, x] = cmp;
        return op === '>' ? d > x && !d.startsWith(x) : op === '<' ? d < x : op === '>=' ? d >= x : d <= x || d.startsWith(x);
      }
      return d.startsWith(v);
    }
    case 'есть': {
      const v = value.toLowerCase();
      const key = Object.keys(HAS).find((k) => HAS[k].includes(v));
      return key ? hasFlag(f, key) : false;
    }
    default: return false;
  }
}

export const KCAL_BANDS = [
  { label: tr('до 100 ккал'), max: 100 },
  { label: tr('100–250 ккал'), max: 250 },
  { label: tr('250–400 ккал'), max: 400 },
  { label: tr('больше 400 ккал'), max: Infinity },
];
const bandOf = (k) => KCAL_BANDS.find((b) => k < b.max).label;

/** Поиск: { rows, error }; сортировка — по дате создания (новые сверху) или по полю sort. */
export function searchFoods(ctx, q, sort = 'created') {
  let node = null;
  try {
    node = parseQuery(q, FOOD_FIELDS);
  } catch (e) {
    return { rows: [], error: e.message };
  }
  const rows = [...ctx.data.foods.values()].filter((f) => !f.deletedAt && evaluate(node, (t) => matchFood(ctx, f, t)));
  const by = {
    created: (a, b) => (a.createdAt < b.createdAt ? 1 : -1),
    name: (a, b) => a.name.localeCompare(b.name, 'ru'),
    kcal: (a, b) => nv(b.nutrients, 'kcal') - nv(a.nutrients, 'kcal'),
    protein: (a, b) => nv(b.nutrients, 'protein') - nv(a.nutrients, 'protein'),
    fat: (a, b) => nv(b.nutrients, 'fat') - nv(a.nutrients, 'fat'),
    carbs: (a, b) => nv(b.nutrients, 'carbs') - nv(a.nutrients, 'carbs'),
    uses: (a, b) => (ctx.usage.get(b.id)?.count || 0) - (ctx.usage.get(a.id)?.count || 0),
  }[sort] || ((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return { rows: rows.sort(by), error: null };
}

/** Топ значений: бренд, калорийность, штрихкод (есть / нет), месяц создания. */
export function foodFacets(ctx, rows, limit = 8) {
  const count = (fn) => {
    const m = new Map();
    for (const f of rows) for (const v of [].concat(fn(f))) m.set(v, (m.get(v) || 0) + 1);
    return [...m].map(([value, n]) => ({ value, count: n })).sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : 1)).slice(0, limit);
  };
  return [
    { field: 'тип', values: count(kindWord) },
    { field: 'бренд', values: count((f) => f.brand || tr('без бренда')) },
    { field: 'ккал', label: tr('калорийность'), values: count((f) => (isMed(f) || isMeasure(f) ? [] : bandOf(nv(f.nutrients, 'kcal')))) },
    { field: 'есть', label: tr('штрихкод'), values: count((f) => (foodBarcodes(f).length ? tr('штрихкод') : tr('без штрихкода'))) },
    { field: 'создан', values: count((f) => localDateOf(f.createdAt, ctx.tz).slice(0, 7)) },
  ];
}

/** Условие для клика по значению топа (не все значения — прямо «поле:значение»). */
export function facetTerm(field, value) {
  const en = LANG === 'en';
  if (field === 'бренд') return value === tr('без бренда') ? ['есть', en ? 'brand' : 'бренд', true] : ['бренд', value, false];
  if (field === 'ккал') {
    const b = KCAL_BANDS.findIndex((x) => x.label === value);
    const lo = b > 0 ? KCAL_BANDS[b - 1].max : 0;
    const hi = KCAL_BANDS[b].max;
    return ['ккал', hi === Infinity ? '>=' + lo : `${lo}..${hi - 0.001}`, false];
  }
  if (field === 'есть') return value === tr('без штрихкода') ? ['есть', en ? 'barcode' : 'штрихкод', true] : ['есть', en ? 'barcode' : 'штрихкод', false];
  return [field, value, false];
}

export const nutrientLabel = (k) => NUTRIENT[k]?.label || k;
