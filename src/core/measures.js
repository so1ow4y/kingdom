// Замеры (обновление 0.13): глюкоза, давление, пульс, температура, анализы — свои и «известные». Вид замера — запись
// каталога (`foods`, kind: 'measure') с единицей (свободный текст), частями значения (у давления — верхнее и нижнее)
// и нормой; показание — элемент записи дневника (kind: 'measure', values). Чистые функции.

import { num } from './nutrition.js';
import { tr, dec } from './i18n.js';

export const MEASURE_UNIT_MAX = 24;
export const MEASURE_PARTS_MAX = 3;
export const PART_NAME_MAX = 24;

/** Известные замеры: шаблоны для «Новый замер» (название, единица, части, норма). Нормы — справочные, для взрослых. */
export const MEASURE_PRESETS = [
  { key: 'glucose', icon: '🩸', name: tr('Глюкоза'), unit: tr('ммоль/л'), ranges: [{ min: 3.9, max: 7.8 }], hint: tr('глюкометр; натощак 3,9–5,5, после еды до 7,8') },
  { key: 'glucoseMg', icon: '🩸', name: tr('Глюкоза (мг/дл)'), unit: tr('мг/дл'), ranges: [{ min: 70, max: 140 }], hint: tr('глюкометр в мг/дл') },
  { key: 'pressure', icon: '❤️', name: tr('Давление'), unit: tr('мм рт. ст.'), parts: [tr('Верхнее'), tr('Нижнее')], ranges: [{ min: 90, max: 139 }, { min: 60, max: 89 }], hint: tr('тонометр: верхнее / нижнее') },
  { key: 'pulse', icon: '💓', name: tr('Пульс'), unit: tr('уд/мин'), ranges: [{ min: 60, max: 100 }], hint: tr('в покое') },
  { key: 'temp', icon: '🌡️', name: tr('Температура'), unit: '°C', ranges: [{ min: 36, max: 37 }], hint: '' },
  { key: 'spo2', icon: '🫁', name: tr('Сатурация (SpO₂)'), unit: '%', ranges: [{ min: 95, max: 100 }], hint: tr('пульсоксиметр') },
  { key: 'ketones', icon: '🧪', name: tr('Кетоны в крови'), unit: tr('ммоль/л'), ranges: [{ min: 0, max: 0.6 }], hint: '' },
  { key: 'hba1c', icon: '🧪', name: tr('Гликированный гемоглобин (HbA1c)'), unit: '%', ranges: [{ min: 4, max: 6 }], hint: tr('анализ раз в 3 месяца') },
  { key: 'cholesterol', icon: '🧪', name: tr('Холестерин общий'), unit: tr('ммоль/л'), ranges: [{ min: 0, max: 5.2 }], hint: '' },
  { key: 'urine', icon: '🧫', name: tr('Объём мочи'), unit: tr('мл'), ranges: [null], hint: tr('для анализов и учёта жидкости') },
  { key: 'stool', icon: '🧫', name: tr('Стул (Бристольская шкала)'), unit: tr('тип'), ranges: [{ min: 3, max: 5 }], hint: tr('тип 1–7') },
  { key: 'pain', icon: '🤕', name: tr('Боль'), unit: tr('балл'), ranges: [{ min: 0, max: 3 }], hint: tr('от 0 до 10') },
];

/** Единицы для подсказки при вводе своего замера. */
export const UNIT_SUGGESTIONS = [tr('ммоль/л'), tr('мг/дл'), tr('мм рт. ст.'), tr('уд/мин'), '°C', '%', tr('мл'), tr('г'), tr('кг'), tr('см'), tr('балл'), tr('ед.'), tr('раз'), tr('тип')];

export const isMeasure = (x) => x?.kind === 'measure';

export const cleanUnit = (u) => String(u ?? '').replace(/\s+/g, ' ').trim().slice(0, MEASURE_UNIT_MAX);

/** Названия частей значения: [] — одно значение; ['Верхнее', 'Нижнее'] — два (давление). */
export function cleanParts(parts) {
  const list = (Array.isArray(parts) ? parts : []).map((p) => String(p ?? '').replace(/\s+/g, ' ').trim().slice(0, PART_NAME_MAX)).slice(0, MEASURE_PARTS_MAX);
  return list.length >= 2 ? list.map((p, i) => p || tr('Значение {n}', { n: i + 1 })) : [];
}

/** Число частей значения у вида замера (не меньше одной). */
export const partCount = (m) => Math.max(1, (m?.parts || []).length);

/** Нормы по частям: [{ min, max } | null]; min и max — числа или null. */
export function cleanRanges(ranges, count = 1) {
  const list = Array.isArray(ranges) ? ranges : [];
  return Array.from({ length: count }, (_, i) => {
    const r = list[i];
    if (!r) return null;
    const min = r.min === '' || r.min == null ? null : Number.isFinite(+String(r.min).replace(',', '.')) ? +String(r.min).replace(',', '.') : null;
    const max = r.max === '' || r.max == null ? null : Number.isFinite(+String(r.max).replace(',', '.')) ? +String(r.max).replace(',', '.') : null;
    if (min == null && max == null) return null;
    return min != null && max != null && min > max ? { min: max, max: min } : { min, max };
  });
}

/** Значения показания: числа по частям (пусто — нет значения). Хотя бы одно число — иначе null. */
export function cleanValues(values, count = 1) {
  const list = Array.from({ length: Math.max(1, count) }, (_, i) => {
    const raw = Array.isArray(values) ? values[i] : i === 0 ? values : null;
    if (raw === '' || raw == null) return null;
    const v = typeof raw === 'number' ? raw : +String(raw).replace(',', '.').trim();
    return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null;
  });
  return list.some((v) => v != null) ? list : null;
}

const fmtV = (v) => (v == null ? '—' : dec(Math.round(v * 100) / 100));

/** «5,6», «120/80». */
export const valuesText = (values) => (Array.isArray(values) ? values.map(fmtV).join('/') : fmtV(num(values)));

/** «5,6 ммоль/л», «120/80 мм рт. ст.». Единица — как ввёл человек (известные переводятся). */
export function readingText(it) {
  const unit = it?.unit ? tr(it.unit) : '';
  return `${valuesText(it?.values ?? it?.amount)}${unit ? ' ' + unit : ''}`;
}

/** «3,9–7,8», «≤ 5,2», «≥ 95». */
export function rangeText(r) {
  if (!r) return '';
  if (r.min != null && r.max != null) return `${fmtV(r.min)}–${fmtV(r.max)}`;
  if (r.max != null) return `≤ ${fmtV(r.max)}`;
  return `≥ ${fmtV(r.min)}`;
}

/** Норма вида целиком: «3,9–7,8 ммоль/л», «90–139 / 60–89». */
export function normText(m) {
  const rs = (m?.ranges || []).map(rangeText);
  if (!rs.some(Boolean)) return '';
  return rs.map((r) => r || '—').join(' / ') + (m.unit ? ' ' + tr(m.unit) : '');
}

/** Состояние показания относительно нормы: 'low' | 'high' | 'ok' | null (нормы нет). */
export function readingStatus(values, ranges) {
  const vs = Array.isArray(values) ? values : [values];
  let any = false;
  for (let i = 0; i < vs.length; i++) {
    const r = ranges?.[i];
    const v = vs[i];
    if (!r || v == null) continue;
    any = true;
    if (r.min != null && v < r.min) return 'low';
    if (r.max != null && v > r.max) return 'high';
  }
  return any ? 'ok' : null;
}

export const STATUS_LABEL = { low: tr('ниже нормы'), high: tr('выше нормы'), ok: tr('в норме') };

/** Шаблон по ключу известного замера. */
export const presetOf = (key) => MEASURE_PRESETS.find((p) => p.key === key) || null;
