// Язык интерфейса (обновление 0.12.5): русский (исходный — русские строки и есть ключи словаря) или английский.
// Выбор хранится на устройстве (localStorage), смена — с перезагрузкой. Переводятся только строки приложения:
// названия задач, продуктов, заметки и другие данные пользователя не трогаются.
//
// tr('Записать еду') → 'Log food'; tr('Удалить «{name}»?', { name }) → 'Delete “…”?'. Статичный текст
// html-шаблонов переводится сам (ui/html.js → translateTemplate). Формы числа — core/plural.js.

import EN, { PLURALS } from './i18n.en.js';

const KEY = 'kingdom.lang';
export const LANGS = [
  { key: 'ru', label: 'Русский' },
  { key: 'en', label: 'English' },
];

function detect() {
  if (globalThis.__KINGDOM_LANG) return globalThis.__KINGDOM_LANG; // тесты — всегда по-русски
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'ru' || v === 'en') return v;
  } catch {
    // нет localStorage — русский
  }
  return 'ru';
}

export const LANG = detect();
export const isEn = () => LANG === 'en';
/** Локаль для чисел и дат: 'ru-RU' или 'en-US'. */
export const locale = () => (LANG === 'en' ? 'en-US' : 'ru-RU');

/** Сменить язык (страница перезагрузится). */
export function setLang(lang) {
  try {
    localStorage.setItem(KEY, lang === 'en' ? 'en' : 'ru');
  } catch {
    return;
  }
  location.reload();
}

/** Ключи без перевода (видно в консоли разработчика: __i18nMissing). */
const missing = new Set();
if (typeof window !== 'undefined') window.__i18nMissing = missing;

const norm = (s) => s.replace(/\s+/g, ' ').trim();

/** Перевод строки приложения; {name} — подстановки. Без перевода — исходная строка. */
export function tr(key, params) {
  let s = key;
  if (LANG === 'en') {
    const v = EN[key];
    if (v != null) s = v;
    else if (EN[norm(key)] != null) s = key.match(/^\s*/)[0] + EN[norm(key)] + key.match(/\s*$/)[0];
    else if (/[А-Яа-яЁё]/.test(key)) missing.add(key);
  }
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k] ?? '') : m));
  return s;
}

/** Перевод куска текста из html-шаблона: пробелы по краям сохраняются, внутри — сравниваются без переносов. */
export function tText(raw) {
  if (LANG !== 'en' || !/[А-Яа-яЁё]/.test(raw)) return raw;
  const k = norm(raw);
  const v = EN[k];
  if (v == null) {
    missing.add(k);
    return raw;
  }
  const lead = raw.match(/^\s*/)[0];
  const trail = raw.match(/\s*$/)[0];
  return lead + v + trail;
}

/** Английские формы числа [одна, много] по русским формам (ключ — первая форма). */
export function pluralForms(forms) {
  const en = PLURALS[forms[0]];
  if (!en) missing.add('#plural ' + forms.join(' | '));
  return en || null;
}

/** Есть ли перевод (для проверок). */
export const hasTr = (key) => EN[norm(key)] != null;
export const dictionary = () => EN;
