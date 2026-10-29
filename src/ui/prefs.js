// Настройки внешнего вида — ТОЛЬКО на этом устройстве (обновление 0.3, п. 2.3): в базу и на Диск не попадают,
// поэтому на телефоне и компе они разные. Хранятся в localStorage 'lifetasks.ui'.
//
// С 0.11 (Crimson Harvest) приложений два — Chronicle (задачи) и Feast (калории), и оформление у каждого своё:
// положение и вид дока, ветки, цветовая схема, цвет квадрата с буквой (APP_SCOPED). Значения Chronicle лежат
// на верхнем уровне, как раньше (старые настройки не теряются), значения Feast — в apps.feast. Остальное
// (спрятан ли док, деревня, клавиши) — общее. getPrefs() отдаёт уже сведённый вид для открытого приложения.
//
// 0.16 — второй перенос из license-store (lib/ui/preferences.ts): как раскрываются подпункты веток, куда растёт
// док, его длина и ширина, сдвигает ли он страницу (у каждого приложения свои), и панель справа — сдвигает ли
// страницу, тянется ли мышью, ширина (общие). Значения из хранилища проверяются: там может лежать что угодно.
//
// 1.1 — из pdd-trainer: dockFill — занимать ли доку всё пространство вдоль края (во всю ширину или высоту, без
// отступа и скруглений); null — по устройству: телефон — да, компьютер — нет. Лента телефона: размер значков
// (barSize), сколько пунктов видно сразу (barCount — остальные листаются пальцем), подписи (barLabels). Свой порядок
// и видимость пунктов (ui/dockLayout.js) — у телефона (barOrder/barOff) и компьютера (dockOrder/dockOff) свои.

import { notify } from '../store/appState.js';
import { tr } from '../core/i18n.js';

const KEY = 'lifetasks.ui';
export const DOCK_POSITIONS = ['left', 'bottom', 'right', 'top'];
export const APP_IDS = ['chronicle', 'feast'];

/**
 * Как раскрываются пункты ветки в свёрнутом доке: side — отдельной колонкой квадратиков рядом с доком, вниз
 * от значка ветки; inline — прямо внутри дока под значком, как раскрывающаяся панель (удобно на маленьком экране).
 */
export const DOCK_SUB_MODES = ['side', 'inline'];
/**
 * Куда растёт док, когда внутри раскрывается ветка: down — только вниз (у горизонтального — вправо), верх стоит
 * на месте и пункт под мышью не уезжает; up — только вверх (влево); both — в обе стороны от центра.
 * Не влезает — док прокручивается внутри, а не растёт дальше.
 */
export const DOCK_GROW = ['down', 'up', 'both'];
/** Длина дока вдоль края и ширина поперёк: по содержимому или своя (лишнее прокручивается). */
export const DOCK_SIZE_MODES = ['auto', 'fixed'];
export const DOCK_SIZE_MIN = 200;
export const DOCK_SIZE_MAX = 1400;
export const DOCK_WIDTH_MIN = 48;
export const DOCK_WIDTH_MAX = 400;
/** Сдвигает ли док страницу: none — лежит поверх; dock — страница отступает на док; all — и на колонку подпунктов. */
export const DOCK_PUSH = ['none', 'dock', 'all'];
/** Лента телефона (1.1): размер значков и сколько пунктов видно сразу. */
export const BAR_SIZES = ['s', 'm', 'l', 'xl'];
export const BAR_COUNT_MIN = 3;
export const BAR_COUNT_MAX = 8;
/** Ширина панели справа (карточка задачи, продукта, записи): не уже PANEL_MIN и не шире 85 % окна. */
export const PANEL_MIN = 380;
export const PANEL_MAX = 1400;

/** Настройки, которые у каждого приложения свои. */
export const APP_SCOPED = ['dock', 'expanded', 'autoHide', 'scheme', 'letter',
  'dockSubMode', 'dockGrow', 'dockSizeMode', 'dockSize', 'dockWidthMode', 'dockWidth', 'dockPush',
  'dockFill', 'dockOrder', 'dockOff', 'barOrder', 'barOff', 'barSize', 'barCount', 'barLabels'];
/** Списки ключей раскладки дока (1.1). */
const KEY_LISTS = ['dockOrder', 'dockOff', 'barOrder', 'barOff'];

/** Вид и поведение дока по умолчанию (общие для обоих приложений; «Сбросить всё» возвращает их). */
const DOCK_DEFAULTS = {
  dock: null, // null — по устройству: телефон снизу, компьютер слева
  expanded: true, // развёрнутый вид (с подписями)
  autoHide: false, // уезжает за край и выезжает у края
  dockSubMode: 'side', // 0.16: подпункты веток — колонкой сбоку или внутри дока
  dockGrow: 'down', // 0.16: куда растёт док при раскрытой внутри ветке
  dockSizeMode: 'auto', // 0.16: длина — по содержимому или своя (dockSize)
  dockSize: 560,
  dockWidthMode: 'auto', // 0.16: ширина — по содержимому или своя (dockWidth)
  dockWidth: 64,
  // 0.16: в license-store по умолчанию «не сдвигать»; здесь — «под панель», как было до 0.16: верхняя полоса
  // и низ страницы не прячутся под доком
  dockPush: 'dock',
  dockFill: null, // 1.1: null — по устройству: телефон — во всю ширину, компьютер — плашкой
  dockOrder: null, // 1.1: свой порядок пунктов на компьютере (null — по умолчанию)
  dockOff: null, // 1.1: выключенные пункты на компьютере
  barOrder: null, // 1.1: свой порядок ленты телефона
  barOff: null, // 1.1: выключенные пункты ленты телефона (null — по умолчанию: поиск, настройки, язык…)
  barSize: 'm', // 1.1: размер значков ленты телефона
  barCount: 5, // 1.1: сколько пунктов видно сразу, остальные — листать
  barLabels: true, // 1.1: подписи под значками
};

/** Панель справа по умолчанию: как было до 0.16 — страница ужимается, 420 px; ширину можно тянуть. */
const PANEL_DEFAULTS = { panelPush: true, panelResizable: true, panelWidth: 420 };

const DEFAULTS = {
  activeApp: 'chronicle', // 0.11: открытое приложение (последнее, в котором был человек)
  apps: {}, // 0.11: { feast: { dock, expanded, … } } — оформление второго приложения
  ...DOCK_DEFAULTS,
  hidden: false, // спрятан целиком: у края только квадрат с буквой (общий для обоих приложений — им и переключаются)
  ...PANEL_DEFAULTS,
  shortcutsOn: true, // 0.10: горячие клавиши (ui/keys.js)
  shortcuts: {}, // 0.10: переназначения { действие: 'Ctrl+KeyS' | ['KeyS', 'ArrowDown'] (0.16) | '' (отключено) }; нет ключа — по умолчанию
  // деревня (0.7): полоса на фоне, масштаб, смена дня и ночи, гости у экрана, выключенный свет, строгий фокус
  villageBackdrop: true,
  villageZoom: null, // 0.7.2: приближение (CSS-пикселей на пиксель деревни); null — «Авто»: чем больше деревня, тем дальше
  dayMode: 'theme', // 'theme' | 'cycle' (каждые 5 минут) | 'real' (по часам); cycle/real — после покупки «Смены дня и ночи»
  visitors: true,
  villageLightsOff: [],
  focusStrict: false,
  decorMotion: true,
  achievementNotifications: true,
  // 1.1: автопуш на Диск (sync/autoPush.js) — после N минут без изменений, при открытии и уходе со страницы
  autoPush: true,
  autoPushMinutes: 5,
  autoPushOnOpen: true,
  scheme: 'indigo', // цветовая схема (косметика из магазина, п. 2.6)
  letter: null, // цвет квадрата с буквой (косметика); null — цвет акцента
};

/** Оформление Feast по умолчанию — багровое, в духе Crimson Harvest. */
const APP_DEFAULTS = {
  chronicle: {},
  feast: { ...DOCK_DEFAULTS, scheme: 'crimson', letter: null },
};

const CHOICES = {
  dock: [...DOCK_POSITIONS, null], dockSubMode: DOCK_SUB_MODES, dockGrow: DOCK_GROW, dockSizeMode: DOCK_SIZE_MODES,
  dockWidthMode: DOCK_SIZE_MODES, dockPush: DOCK_PUSH, dockFill: [true, false, null], barSize: BAR_SIZES,
};
const RANGES = { dockSize: [DOCK_SIZE_MIN, DOCK_SIZE_MAX], dockWidth: [DOCK_WIDTH_MIN, DOCK_WIDTH_MAX], panelWidth: [PANEL_MIN, PANEL_MAX],
  autoPushMinutes: [1, 120], barCount: [BAR_COUNT_MIN, BAR_COUNT_MAX] };
const FLAGS = ['expanded', 'autoHide', 'hidden', 'panelPush', 'panelResizable', 'autoPush', 'autoPushOnOpen', 'barLabels'];

/** Проверить значения: чужое — убрать (возьмётся умолчание), числа — в допустимые пределы. */
export function cleanPrefs(p) {
  const out = { ...p };
  for (const [k, list] of Object.entries(CHOICES)) if (k in out && !list.includes(out[k])) delete out[k];
  for (const [k, [lo, hi]] of Object.entries(RANGES)) {
    if (!(k in out)) continue;
    const v = out[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(Math.min(hi, Math.max(lo, v)));
    else delete out[k];
  }
  for (const k of FLAGS) if (k in out && typeof out[k] !== 'boolean') delete out[k];
  for (const k of KEY_LISTS) {
    if (!(k in out) || out[k] === null) continue;
    if (Array.isArray(out[k])) out[k] = [...new Set(out[k].filter((x) => typeof x === 'string' && x.length <= 200))].slice(0, 100);
    else delete out[k];
  }
  return out;
}

function load() {
  try {
    const stored = cleanPrefs(JSON.parse(localStorage.getItem(KEY) || '{}'));
    if (stored.apps && typeof stored.apps === 'object') {
      stored.apps = Object.fromEntries(Object.entries(stored.apps).map(([k, v]) => [k, cleanPrefs(v && typeof v === 'object' ? v : {})]));
    } else delete stored.apps;
    return { ...DEFAULTS, ...stored };
  } catch {
    return { ...DEFAULTS };
  }
}

let raw = load();
if (!APP_IDS.includes(raw.activeApp)) raw.activeApp = 'chronicle';

/** Сведённые настройки для приложения app: общие + его собственные. */
export function getAppPrefs(app = raw.activeApp) {
  if (app === 'chronicle') return raw;
  return { ...raw, ...APP_DEFAULTS[app], ...(raw.apps?.[app] || {}) };
}

let view = getAppPrefs();

export function getPrefs() {
  return view;
}

export const activeApp = () => raw.activeApp;

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(raw));
  } catch {
    // без localStorage настройка просто не запомнится
  }
}

/** Изменить настройки приложения app: его собственные ключи — в его раздел, общие — наверх. */
export function setAppPrefs(app, patch) {
  const top = {};
  const own = {};
  for (const [k, v] of Object.entries(patch)) {
    if (APP_SCOPED.includes(k) && app !== 'chronicle') own[k] = v;
    else top[k] = v;
  }
  raw = { ...raw, ...top };
  if (Object.keys(own).length) raw.apps = { ...(raw.apps || {}), [app]: { ...(raw.apps?.[app] || {}), ...own } };
  save();
  view = getAppPrefs();
  applyScheme();
  notify();
}

export function setPrefs(patch) {
  setAppPrefs(raw.activeApp, patch);
}

/** Сделать приложение открытым (оформление переключается сразу). */
export function setActiveAppPref(app) {
  if (!APP_IDS.includes(app) || app === raw.activeApp) return false;
  raw = { ...raw, activeApp: app };
  save();
  view = getAppPrefs();
  applyScheme();
  return true;
}

export const dockPosition = (phone) => view.dock || (phone ? 'bottom' : 'left');
/** 1.1: док во всё пространство вдоль края — по настройке, иначе по устройству (телефон — да). */
export const dockFill = (phone) => (view.dockFill === null || view.dockFill === undefined ? phone : view.dockFill);

/**
 * «Сбросить всё» (resetUiPreferences license-store): вид и поведение дока приложения app, «спрятан целиком»
 * и панель справа — как по умолчанию. Тема, цвета, деревня и клавиши не трогаются (у клавиш свой сброс).
 */
export function resetLook(app = raw.activeApp) {
  setAppPrefs(app, { ...DOCK_DEFAULTS, hidden: false, ...PANEL_DEFAULTS });
}

/** Цветовые схемы: акцент для светлой и тёмной темы. indigo и crimson — бесплатно. */
export const SCHEMES = {
  indigo: { name: tr('Индиго'), light: '#3949ab', dark: '#8c9eff' },
  crimson: { name: tr('Багрянец'), light: '#a3122a', dark: '#ef5b6b' },
  lime: { name: 'Lime', light: '#5b8c00', dark: '#c6f432' },
  lavender: { name: 'Lavender', light: '#7b4fd6', dark: '#c7a6ff' },
  ocean: { name: tr('Океан'), light: '#00796b', dark: '#4dd0c4' },
  sunset: { name: tr('Закат'), light: '#d84315', dark: '#ffab76' },
};
export const FREE_SCHEMES = ['indigo', 'crimson'];

export function applyScheme() {
  const root = document.documentElement;
  const p = view;
  root.dataset.decorMotion = p.decorMotion === false ? 'off' : 'on';
  root.dataset.app = raw.activeApp;
  if (p.scheme && p.scheme !== 'indigo' && SCHEMES[p.scheme]) root.dataset.scheme = p.scheme;
  else delete root.dataset.scheme;
  for (const [k, v] of [['--letter-bg', p.letter], ['--letter-text', p.letter && '#fff']]) {
    if (v) root.style.setProperty(k, v);
    else root.style.removeProperty(k);
  }
}
