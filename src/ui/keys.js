// Горячие клавиши (обновление 0.10; 0.11 — действия Feast и переход между приложениями). В license-store настроек клавиш не нашлось (там только Esc закрывает
// шторку дока на телефоне), поэтому они сделаны здесь: реестр действий, сочетания по умолчанию,
// переназначение в «Настройки → Интерфейс → Горячие клавиши». Как и вид дока — настройка ЭТОГО устройства
// (ui/prefs.js), на Диск не попадает. Клавиши узнаются по физической кнопке (KeyboardEvent.code),
// поэтому работают при любой раскладке: «N» — это та же кнопка, что «Т».

import { getPrefs, setPrefs } from './prefs.js';

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

/** Действия: id, группа, подпись, сочетание по умолчанию (null — не назначено). */
export const SHORTCUTS = [
  { id: 'newTask', group: 'Задачи', label: 'Новая задача', hint: 'В Crimson Harvest — записать еду', def: 'KeyN' },
  { id: 'search', group: 'Задачи', label: 'Поиск задач', hint: 'На экранах с поиском — встать в строку поиска', def: 'Slash' },
  { id: 'push', group: 'Задачи', label: 'Пуш — отправить на Google Диск', def: IS_MAC ? 'Meta+KeyS' : 'Ctrl+KeyS' },
  { id: 'pull', group: 'Задачи', label: 'Обновить с Google Диска', def: null },
  { id: 'prevDay', group: 'Задачи', label: 'Предыдущий день', hint: 'На экране «Сегодня»', def: 'ArrowLeft' },
  { id: 'nextDay', group: 'Задачи', label: 'Следующий день', hint: 'На экране «Сегодня»', def: 'ArrowRight' },

  { id: 'taskDone', group: 'Открытая задача', label: 'Выполнить / вернуть', def: IS_MAC ? 'Meta+Enter' : 'Ctrl+Enter' },
  { id: 'taskFocus', group: 'Открытая задача', label: 'Взяться за задачу (фокус)', def: 'KeyF' },
  { id: 'taskTrash', group: 'Открытая задача', label: 'В корзину', def: 'Delete' },

  { id: 'goToday', group: 'Переходы', label: 'Сегодня', def: 'Digit1' },
  { id: 'goInbox', group: 'Переходы', label: 'Входящие', def: 'Digit2' },
  { id: 'goLists', group: 'Переходы', label: 'Списки', def: 'Digit3' },
  { id: 'goTasks', group: 'Переходы', label: 'Поиск задач (экран)', def: 'Digit4' },
  { id: 'goVillage', group: 'Переходы', label: 'Деревня', def: 'Digit5' },
  { id: 'goAnalytics', group: 'Переходы', label: 'Аналитика', def: 'Digit6' },
  { id: 'goShop', group: 'Переходы', label: 'Магазин', def: 'Digit7' },
  { id: 'goArchive', group: 'Переходы', label: 'Выполненные', def: 'Digit8' },
  { id: 'goTrash', group: 'Переходы', label: 'Корзина', def: 'Digit9' },
  { id: 'goSettings', group: 'Переходы', label: 'Настройки', def: 'Digit0' },

  { id: 'goDiary', group: 'Crimson Harvest', label: 'Дневник питания', def: 'Shift+Digit1' },
  { id: 'goFoods', group: 'Crimson Harvest', label: 'Продукты', def: 'Shift+Digit2' },
  { id: 'goNutrition', group: 'Crimson Harvest', label: 'Аналитика питания', def: 'Shift+Digit3' },
  { id: 'goBody', group: 'Crimson Harvest', label: 'Обо мне', def: 'Shift+Digit4' },
  { id: 'goMeals', group: 'Crimson Harvest', label: 'Рационы', def: 'Shift+Digit5' },
  { id: 'scanBarcode', group: 'Crimson Harvest', label: 'Сканировать штрихкод и записать', def: 'KeyB' },

  { id: 'switchApp', group: 'Панель и окна', label: 'Перейти в другое приложение', hint: 'Chronicle ⇄ Crimson Harvest', def: 'Backslash' },
  { id: 'dockExpand', group: 'Панель и окна', label: 'Свернуть или развернуть панель', def: 'BracketLeft' },
  { id: 'dockHide', group: 'Панель и окна', label: 'Спрятать или показать панель', def: 'BracketRight' },
  { id: 'help', group: 'Панель и окна', label: 'Список горячих клавиш', def: 'Shift+Slash' },
];

export const SHORTCUT_GROUPS = [...new Set(SHORTCUTS.map((s) => s.group))];
const BY_ID = new Map(SHORTCUTS.map((s) => [s.id, s]));

/** Esc — не переназначается: закрывает верхнее окно, шторку дока, карточку задачи. */
export const FIXED = [{ combo: 'Escape', label: 'Закрыть окно, шторку панели или карточку задачи' }];

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
  Backquote: '`', Minus: '−', Equal: '=', Space: 'Пробел', Enter: 'Enter', NumpadEnter: 'Enter', Escape: 'Esc',
  Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Tab: 'Tab', Home: 'Home', End: 'End', PageUp: 'PageUp',
  PageDown: 'PageDown', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', IntlBackslash: '\\',
  NumpadAdd: 'Num +', NumpadSubtract: 'Num −', NumpadMultiply: 'Num *', NumpadDivide: 'Num /', NumpadDecimal: 'Num .',
};
/** Та же кнопка в русской раскладке (ЙЦУКЕН) — подсказка рядом с латинской буквой. */
const RU = {
  KeyQ: 'Й', KeyW: 'Ц', KeyE: 'У', KeyR: 'К', KeyT: 'Е', KeyY: 'Н', KeyU: 'Г', KeyI: 'Ш', KeyO: 'Щ', KeyP: 'З',
  BracketLeft: 'Х', BracketRight: 'Ъ', KeyA: 'Ф', KeyS: 'Ы', KeyD: 'В', KeyF: 'А', KeyG: 'П', KeyH: 'Р', KeyJ: 'О',
  KeyK: 'Л', KeyL: 'Д', Semicolon: 'Ж', Quote: 'Э', KeyZ: 'Я', KeyX: 'Ч', KeyC: 'С', KeyV: 'М', KeyB: 'И', KeyN: 'Т',
  KeyM: 'Ь', Comma: 'Б', Period: 'Ю', Backquote: 'Ё',
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
