// Горячие клавиши (обновление 0.10; 0.11 — действия Feast и переход между приложениями). В license-store настроек клавиш не нашлось (там только Esc закрывает
// шторку дока на телефоне), поэтому они сделаны здесь: реестр действий, сочетания по умолчанию,
// переназначение в «Настройки → Интерфейс → Горячие клавиши». Как и вид дока — настройка ЭТОГО устройства
// (ui/prefs.js), на Диск не попадает. Клавиши узнаются по физической кнопке (KeyboardEvent.code),
// поэтому работают при любой раскладке: «N» — это та же кнопка, что «Т».

import { getPrefs, setPrefs } from './prefs.js';
import { tr } from '../core/i18n.js';

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

/** Действия: id, группа, подпись, сочетание по умолчанию (null — не назначено). */
export const SHORTCUTS = [
  { id: 'newTask', group: tr('Задачи'), label: tr('Новая задача'), hint: tr('В Crimson Harvest — записать еду'), def: 'KeyN' },
  { id: 'search', group: tr('Задачи'), label: tr('Поиск задач'), hint: tr('На экранах с поиском — встать в строку поиска'), def: 'Slash' },
  { id: 'push', group: tr('Задачи'), label: tr('Пуш — отправить на Google Диск'), def: IS_MAC ? 'Meta+KeyS' : 'Ctrl+KeyS' },
  { id: 'pull', group: tr('Задачи'), label: tr('Обновить с Google Диска'), def: null },
  { id: 'prevDay', group: tr('Задачи'), label: tr('Предыдущий день'), hint: tr('На экране «Сегодня»'), def: 'ArrowLeft' },
  { id: 'nextDay', group: tr('Задачи'), label: tr('Следующий день'), hint: tr('На экране «Сегодня»'), def: 'ArrowRight' },

  { id: 'taskDone', group: tr('Открытая задача'), label: tr('Выполнить / вернуть'), def: IS_MAC ? 'Meta+Enter' : 'Ctrl+Enter' },
  { id: 'taskFocus', group: tr('Открытая задача'), label: tr('Взяться за задачу (фокус)'), def: 'KeyF' },
  { id: 'taskTrash', group: tr('Открытая задача'), label: tr('В корзину'), def: 'Delete' },

  { id: 'goToday', group: tr('Переходы'), label: tr('Сегодня'), def: 'Digit1' },
  { id: 'goInbox', group: tr('Переходы'), label: tr('Входящие'), def: 'Digit2' },
  { id: 'goLists', group: tr('Переходы'), label: tr('Списки'), def: 'Digit3' },
  { id: 'goTasks', group: tr('Переходы'), label: tr('Поиск задач (экран)'), def: 'Digit4' },
  { id: 'goVillage', group: tr('Переходы'), label: tr('Деревня'), def: 'Digit5' },
  { id: 'goAnalytics', group: tr('Переходы'), label: tr('Аналитика'), def: 'Digit6' },
  { id: 'goShop', group: tr('Переходы'), label: tr('Магазин'), def: 'Digit7' },
  { id: 'goArchive', group: tr('Переходы'), label: tr('Выполненные'), def: 'Digit8' },
  { id: 'goTrash', group: tr('Переходы'), label: tr('Корзина'), def: 'Digit9' },
  { id: 'goSettings', group: tr('Переходы'), label: tr('Настройки'), def: 'Digit0' },

  { id: 'goDiary', group: 'Crimson Harvest', label: tr('Дневник питания'), def: 'Shift+Digit1' },
  { id: 'goFoods', group: 'Crimson Harvest', label: tr('Продукты'), def: 'Shift+Digit2' },
  { id: 'goNutrition', group: 'Crimson Harvest', label: tr('Аналитика питания'), def: 'Shift+Digit3' },
  { id: 'goBody', group: 'Crimson Harvest', label: tr('Обо мне'), def: 'Shift+Digit4' },
  { id: 'goMeals', group: 'Crimson Harvest', label: tr('Рационы'), def: 'Shift+Digit5' },
  { id: 'scanBarcode', group: 'Crimson Harvest', label: tr('Сканировать штрихкод и записать'), def: 'KeyB' },

  { id: 'switchApp', group: tr('Панель и окна'), label: tr('Перейти в другое приложение'), hint: 'Chronicle ⇄ Crimson Harvest', def: 'Backslash' },
  { id: 'dockExpand', group: tr('Панель и окна'), label: tr('Свернуть или развернуть панель'), def: 'BracketLeft' },
  { id: 'dockHide', group: tr('Панель и окна'), label: tr('Спрятать или показать панель'), def: 'BracketRight' },
  { id: 'help', group: tr('Панель и окна'), label: tr('Список горячих клавиш'), def: 'Shift+Slash' },
];

export const SHORTCUT_GROUPS = [...new Set(SHORTCUTS.map((s) => s.group))];
const BY_ID = new Map(SHORTCUTS.map((s) => [s.id, s]));

/** Esc — не переназначается: закрывает верхнее окно, шторку дока, карточку задачи. */
export const FIXED = [{ combo: 'Escape', label: tr('Закрыть окно, шторку панели или карточку задачи') }];

/**
 * Сочетания, которые браузер или система не отдают странице (или без которых неудобно жить):
 * назначить их нельзя.
 */
const RESERVED = new Set([
  'Escape', 'Tab', 'Shift+Tab', 'Enter', 'Space', 'Shift+Space', 'Backspace', 'F5', 'Ctrl+F5', 'F11', 'F12',
  'Ctrl+KeyW', 'Ctrl+KeyT', 'Ctrl+KeyN', 'Ctrl+Shift+KeyT', 'Ctrl+Shift+KeyN', 'Ctrl+Shift+KeyW', 'Ctrl+Tab', 'Ctrl+Shift+Tab',
  'Ctrl+KeyR', 'Ctrl+Shift+KeyR', 'Ctrl+KeyL', 'Ctrl+KeyC', 'Ctrl+KeyV', 'Ctrl+KeyX', 'Ctrl+KeyZ', 'Ctrl+KeyY', 'Ctrl+KeyA',
  'Ctrl+Shift+KeyI', 'Ctrl+Shift+KeyJ', 'Ctrl+Shift+KeyC', 'Alt+F4', 'Alt+ArrowLeft', 'Alt+ArrowRight',
  'Meta+KeyW', 'Meta+KeyT', 'Meta+KeyN', 'Meta+KeyQ', 'Meta+KeyR', 'Meta+KeyL', 'Meta+KeyC', 'Meta+KeyV', 'Meta+KeyX',
  'Meta+KeyZ', 'Meta+KeyA', 'Meta+Shift+KeyZ', 'Meta+Tab', 'Meta+KeyH', 'Meta+KeyM',
]);

const MOD_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'];
const isModifierCode = (code) => /^(Shift|Control|Alt|Meta|OS)(Left|Right)?$/.test(code) || ['CapsLock', 'Fn', 'FnLock', 'AltGraph', 'ContextMenu'].includes(code);

/** Сочетание из события клавиатуры: 'Ctrl+Shift+KeyS'. null — нажат только модификатор (или кнопку не опознать). */
export function comboFromEvent(e) {
  const code = e.code;
  if (!code || code === 'Unidentified' || isModifierCode(code)) return null;
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Meta');
  return [...mods, code].join('+');
}

/** Нормализовать запись сочетания (порядок модификаторов), чтобы сравнивать строки. */
export function normalizeCombo(combo) {
  if (!combo) return null;
  const parts = combo.split('+').filter(Boolean);
  const code = parts.pop();
  const mods = MOD_ORDER.filter((m) => parts.includes(m));
  return [...mods, code].join('+');
}

const CODE_LABEL = {
  Slash: '/', Backslash: '\\', BracketLeft: '[', BracketRight: ']', Comma: ',', Period: '.', Semicolon: ';', Quote: "'",
  Backquote: '`', Minus: '−', Equal: '=', Space: tr('Пробел'), Enter: 'Enter', NumpadEnter: 'Enter', Escape: 'Esc',
  Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Tab: 'Tab', Home: 'Home', End: 'End', PageUp: 'PageUp',
  PageDown: 'PageDown', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', IntlBackslash: '\\',
  NumpadAdd: 'Num +', NumpadSubtract: 'Num −', NumpadMultiply: 'Num *', NumpadDivide: 'Num /', NumpadDecimal: 'Num .',
};
/** Та же кнопка в русской раскладке (ЙЦУКЕН) — подсказка рядом с латинской буквой. */
const RU = {
  KeyQ: tr('Й'), KeyW: tr('Ц'), KeyE: tr('У'), KeyR: tr('К'), KeyT: tr('Е'), KeyY: tr('Н'), KeyU: tr('Г'), KeyI: tr('Ш'), KeyO: tr('Щ'), KeyP: tr('З'),
  BracketLeft: tr('Х'), BracketRight: tr('Ъ'), KeyA: tr('Ф'), KeyS: tr('Ы'), KeyD: tr('В'), KeyF: tr('А'), KeyG: tr('П'), KeyH: tr('Р'), KeyJ: tr('О'),
  KeyK: tr('Л'), KeyL: tr('Д'), Semicolon: tr('Ж'), Quote: tr('Э'), KeyZ: tr('Я'), KeyX: tr('Ч'), KeyC: tr('С'), KeyV: tr('М'), KeyB: tr('И'), KeyN: tr('Т'),
  KeyM: tr('Ь'), Comma: tr('Б'), Period: tr('Ю'), Backquote: tr('Ё'),
};
const MOD_LABEL = IS_MAC ? { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' } : { Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Win' };

export function keyLabel(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return 'Num ' + code.slice(6);
  return CODE_LABEL[code] || code;
}

/** Части сочетания для показа: ['Ctrl', 'S']. «Shift + /» показываем как «?». */
export function comboParts(combo) {
  if (!combo) return [];
  if (combo === 'Shift+Slash') return ['?'];
  const parts = combo.split('+');
  const code = parts.pop();
  return [...parts.map((m) => MOD_LABEL[m] || m), keyLabel(code)];
}

export const formatCombo = (combo) => comboParts(combo).join(IS_MAC ? '' : ' + ');

/** Русская буква на той же кнопке (для подсказки), если это буквенная клавиша. */
export function ruLetter(combo) {
  if (!combo) return '';
  const code = combo.split('+').pop();
  return RU[code] || '';
}

// ---------- Назначения ----------

/** Включены ли клавиши вообще. */
export const shortcutsOn = () => getPrefs().shortcutsOn !== false;

/** Текущее сочетание действия (с учётом переназначений) или null. */
export function bindingOf(id, prefs = getPrefs()) {
  const own = prefs.shortcuts || {};
  if (Object.prototype.hasOwnProperty.call(own, id)) return own[id] ? normalizeCombo(own[id]) : null;
  return BY_ID.get(id)?.def ?? null;
}

/** Все назначения: Map сочетание → id. */
export function bindingMap(prefs = getPrefs()) {
  const m = new Map();
  for (const s of SHORTCUTS) {
    const c = bindingOf(s.id, prefs);
    if (c && !m.has(c)) m.set(c, s.id);
  }
  return m;
}

/** Каким действием уже занято сочетание (кроме exceptId). */
export function conflictOf(combo, exceptId = null, prefs = getPrefs()) {
  const c = normalizeCombo(combo);
  for (const s of SHORTCUTS) if (s.id !== exceptId && bindingOf(s.id, prefs) === c) return s;
  return null;
}

export const isReserved = (combo) => RESERVED.has(normalizeCombo(combo));

/** Изменения настроек для назначения: combo=null — отключить; занятое другим действием — снимается там. */
export function assignPatch(id, combo, prefs = getPrefs()) {
  const own = { ...(prefs.shortcuts || {}) };
  const c = combo ? normalizeCombo(combo) : '';
  if (c) {
    const other = conflictOf(c, id, prefs);
    if (other) own[other.id] = '';
  }
  own[id] = c;
  // совпало с умолчанием — переназначение не нужно
  for (const s of SHORTCUTS) if (Object.prototype.hasOwnProperty.call(own, s.id) && (own[s.id] || null) === s.def) delete own[s.id];
  return { shortcuts: own };
}

export function assign(id, combo) {
  setPrefs(assignPatch(id, combo));
}

export const resetShortcut = (id) => {
  const own = { ...(getPrefs().shortcuts || {}) };
  delete own[id];
  // если умолчание занято другим действием — то действие теряет сочетание
  const def = BY_ID.get(id)?.def;
  const other = def ? conflictOf(def, id) : null;
  if (other) own[other.id] = '';
  setPrefs({ shortcuts: own });
};

export const resetAllShortcuts = () => setPrefs({ shortcuts: {} });

/** Сочетание действия для подсказок (например, в доке): '1', 'Ctrl + S' или ''. */
export const shortcutText = (id) => {
  if (!shortcutsOn()) return '';
  return formatCombo(bindingOf(id));
};

// ---------- Обработка нажатий ----------

/** Пока в настройках записывают сочетание, общий обработчик молчит. */
export const recorder = { active: false };

const isEditing = (el) => {
  const tag = el?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el?.isContentEditable;
};

/**
 * Какое действие вызвать по событию (или null). overlay — открыто окно поверх (диалог, панель, быстрый ввод):
 * тогда, как и при вводе текста, работают только сочетания с Ctrl / Alt / ⌘.
 */
export function actionFor(e, { overlay = false, prefs = getPrefs() } = {}) {
  if (recorder.active || prefs.shortcutsOn === false || e.defaultPrevented || e.isComposing) return null;
  const combo = comboFromEvent(e);
  if (!combo) return null;
  const strong = e.ctrlKey || e.metaKey || e.altKey;
  if ((overlay || isEditing(e.target)) && !strong) return null;
  return bindingMap(prefs).get(combo) || null;
}
