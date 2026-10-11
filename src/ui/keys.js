// Горячие клавиши (обновление 0.10; 0.11 — действия Feast и переход между приложениями). В license-store настроек клавиш не нашлось (там только Esc закрывает
// шторку дока на телефоне), поэтому они сделаны здесь: реестр действий, сочетания по умолчанию,
// переназначение в «Настройки → Интерфейс → Горячие клавиши». Как и вид дока — настройка ЭТОГО устройства
// (ui/prefs.js), на Диск не попадает. Клавиши узнаются по физической кнопке (KeyboardEvent.code),
// поэтому работают при любой раскладке: «N» — это та же кнопка, что «Т».
//
// 0.16 — второй перенос из license-store (lib/ui/preferences.ts, hooks/use-list-hotkeys.ts): на действие можно
// повесить сколько угодно сочетаний (одно сочетание — одно действие); клавиши списков с панелью справа
// (S/W — следующая и предыдущая строка, D — открыть справа, A — закрыть, ui/listKeys.js) и пунктов дока
// (Q/E — выше и ниже, Enter/Пробел — открыть пункт, components/Dock.js).

import { getPrefs, setPrefs } from './prefs.js';
import { tr, LANG } from '../core/i18n.js';

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

/**
 * Действия: id, группа, подпись, сочетание по умолчанию (null — не назначено; список — несколько сочетаний).
 * allow — сочетания, которые обычно заняты (RESERVED), но этому действию разрешены: Enter и Пробел открывают пункт
 * дока, только когда на нём фокус, — в остальное время нажатие остаётся браузеру.
 */
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
  { id: 'goBank', group: tr('Переходы'), label: tr('Банк задач'), def: null },
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

  // 0.16: списки, у которых запись открывается справа (задачи, записи и заметки дневника, продукты), — как в license-store
  { id: 'listDown', group: tr('Списки с панелью справа'), label: tr('Следующая строка'), hint: tr('Если панель справа открыта — она переключается на эту строку'), def: 'KeyS' },
  { id: 'listUp', group: tr('Списки с панелью справа'), label: tr('Предыдущая строка'), hint: tr('Если панель справа открыта — она переключается на эту строку'), def: 'KeyW' },
  { id: 'listOpen', group: tr('Списки с панелью справа'), label: tr('Открыть в панели'), hint: tr('Открывает справа строку под курсором'), def: 'KeyD' },
  { id: 'listClose', group: tr('Списки с панелью справа'), label: tr('Закрыть панель'), hint: tr('Esc тоже закрывает'), def: 'KeyA' },

  { id: 'menuUp', group: tr('Панель навигации'), label: tr('Меню: пункт выше'), hint: tr('Ходит по пунктам панели, включая раскрытую ветку'), def: 'KeyQ' },
  { id: 'menuDown', group: tr('Панель навигации'), label: tr('Меню: пункт ниже'), hint: tr('Ходит по пунктам панели, включая раскрытую ветку'), def: 'KeyE' },
  { id: 'menuActivate', group: tr('Панель навигации'), label: tr('Меню: открыть пункт'),
    hint: tr('Открывает экран, у ветки — раскрывает или сворачивает её. Работает, когда выбран пункт панели'),
    def: ['Enter', 'Space'], allow: ['Enter', 'NumpadEnter', 'Space'] },
  { id: 'dockExpand', group: tr('Панель навигации'), label: tr('Свернуть или развернуть панель'), def: 'BracketLeft' },
  { id: 'dockHide', group: tr('Панель навигации'), label: tr('Спрятать или показать панель'), def: 'BracketRight' },

  { id: 'switchApp', group: tr('Приложения и справка'), label: tr('Перейти в другое приложение'), hint: 'Chronicle ⇄ Crimson Harvest', def: 'Backslash' },
  { id: 'help', group: tr('Приложения и справка'), label: tr('Список горячих клавиш'), def: 'Shift+Slash' },
];

export const SHORTCUT_GROUPS = [...new Set(SHORTCUTS.map((s) => s.group))];
const BY_ID = new Map(SHORTCUTS.map((s) => [s.id, s]));

/** Сочетания действия по умолчанию — всегда списком. */
export const defaultsOf = (id) => {
  const def = BY_ID.get(id)?.def;
  return def == null ? [] : (Array.isArray(def) ? def : [def]).map(normalizeCombo);
};

/** Esc — не переназначается: закрывает верхнее окно, шторку дока, карточку задачи. */
export const FIXED = [{ combo: 'Escape', label: tr('Закрыть окно, шторку панели, карточку или панель справа') }];

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
  return LANG === 'en' ? '' : RU[code] || ''; // подсказка русской раскладки — только в русском интерфейсе
}

// ---------- Назначения ----------

/** Включены ли клавиши вообще. */
export const shortcutsOn = () => getPrefs().shortcutsOn !== false;

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * Все сочетания действия (с учётом переназначений) — списком, возможно пустым. В настройках хранится
 * '' (отключено), строка (одно сочетание, как до 0.16) или список.
 */
export function bindingsOf(id, prefs = getPrefs()) {
  const own = prefs.shortcuts || {};
  if (!hasOwn(own, id)) return defaultsOf(id);
  const v = own[id];
  const list = Array.isArray(v) ? v : v ? [v] : [];
  return [...new Set(list.filter((c) => typeof c === 'string' && c).map(normalizeCombo))];
}

/** Первое сочетание действия (для подсказок) или null. */
export const bindingOf = (id, prefs = getPrefs()) => bindingsOf(id, prefs)[0] ?? null;

/** Все назначения: Map сочетание → id. */
export function bindingMap(prefs = getPrefs()) {
  const m = new Map();
  for (const s of SHORTCUTS) {
    for (const c of bindingsOf(s.id, prefs)) if (!m.has(c)) m.set(c, s.id);
  }
  return m;
}

/** Каким действием уже занято сочетание (кроме exceptId). */
export function conflictOf(combo, exceptId = null, prefs = getPrefs()) {
  const c = normalizeCombo(combo);
  for (const s of SHORTCUTS) if (s.id !== exceptId && bindingsOf(s.id, prefs).includes(c)) return s;
  return null;
}

/** Занято браузером или системой — кроме сочетаний, разрешённых действию id (Enter и Пробел у «Меню: открыть пункт»). */
export const isReserved = (combo, id = null) => {
  const c = normalizeCombo(combo);
  return RESERVED.has(c) && !(BY_ID.get(id)?.allow || []).includes(c);
};

const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Записать сочетания действия: совпали с умолчанием — переназначение не нужно, ни одного — '' (отключено). */
function put(own, id, list) {
  if (sameList(list, defaultsOf(id))) delete own[id];
  else own[id] = list.length === 0 ? '' : list.length === 1 ? list[0] : list;
}

/** Одно сочетание — одно действие: у остальных действий оно снимается. */
function takeFrom(own, combo, id, prefs) {
  for (const s of SHORTCUTS) {
    if (s.id === id) continue;
    const list = bindingsOf(s.id, { ...prefs, shortcuts: own });
    if (list.includes(combo)) put(own, s.id, list.filter((c) => c !== combo));
  }
}

/** Изменения настроек: все сочетания действия заменить одним; combo=null — отключить. Занятое другим — снимается там. */
export function assignPatch(id, combo, prefs = getPrefs()) {
  const own = { ...(prefs.shortcuts || {}) };
  const c = combo ? normalizeCombo(combo) : null;
  if (c) takeFrom(own, c, id, prefs);
  put(own, id, c ? [c] : []);
  return { shortcuts: own };
}

/** Изменения настроек: добавить действию ещё одно сочетание (0.16). Занятое другим — переходит к этому. */
export function addPatch(id, combo, prefs = getPrefs()) {
  const own = { ...(prefs.shortcuts || {}) };
  const c = normalizeCombo(combo);
  takeFrom(own, c, id, prefs);
  const cur = bindingsOf(id, { ...prefs, shortcuts: own });
  if (!cur.includes(c)) put(own, id, [...cur, c]);
  return { shortcuts: own };
}

/** Изменения настроек: убрать у действия одно сочетание (0.16). */
export function removePatch(id, combo, prefs = getPrefs()) {
  const own = { ...(prefs.shortcuts || {}) };
  const c = normalizeCombo(combo);
  put(own, id, bindingsOf(id, prefs).filter((x) => x !== c));
  return { shortcuts: own };
}

export function assign(id, combo) {
  setPrefs(assignPatch(id, combo));
}

export const addShortcut = (id, combo) => setPrefs(addPatch(id, combo));
export const removeShortcut = (id, combo) => setPrefs(removePatch(id, combo));

export const resetShortcut = (id) => {
  const prefs = getPrefs();
  const own = { ...(prefs.shortcuts || {}) };
  delete own[id];
  // если умолчание занято другим действием — то действие теряет сочетание
  for (const c of defaultsOf(id)) takeFrom(own, c, id, prefs);
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
