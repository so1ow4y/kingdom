// Настройки внешнего вида — ТОЛЬКО на этом устройстве (обновление 0.3, п. 2.3): в базу и на Диск не попадают,
// поэтому на телефоне и компе они разные. Хранятся в localStorage 'lifetasks.ui'.
//
// С 0.11 (Crimson Harvest) приложений два — Chronicle (задачи) и Feast (калории), и оформление у каждого своё:
// положение и вид дока, ветки, цветовая схема, цвет квадрата с буквой (APP_SCOPED). Значения Chronicle лежат
// на верхнем уровне, как раньше (старые настройки не теряются), значения Feast — в apps.feast. Остальное
// (спрятан ли док, деревня, клавиши) — общее. getPrefs() отдаёт уже сведённый вид для открытого приложения.

import { notify } from '../store/appState.js';

const KEY = 'lifetasks.ui';
export const DOCK_POSITIONS = ['left', 'bottom', 'right', 'top'];
export const APP_IDS = ['chronicle', 'feast'];
/** Настройки, которые у каждого приложения свои. */
export const APP_SCOPED = ['dock', 'expanded', 'autoHide', 'dockOpen', 'scheme', 'letter'];

const DEFAULTS = {
  activeApp: 'chronicle', // 0.11: открытое приложение (последнее, в котором был человек)
  apps: {}, // 0.11: { feast: { dock, expanded, … } } — оформление второго приложения
  dock: null, // null — по устройству: телефон снизу, компьютер слева
  expanded: true, // развёрнутый вид (с подписями)
  autoHide: false, // уезжает за край и выезжает у края
  hidden: false, // спрятан целиком: у края только квадрат с буквой (общий для обоих приложений — им и переключаются)
  dockOpen: {}, // 0.10: какие ветки дока раскрыты в развёрнутом боковом виде ({ lists: true, … }); нет ключа — раскрыта, если активна
  shortcutsOn: true, // 0.10: горячие клавиши (ui/keys.js)
  shortcuts: {}, // 0.10: переназначения { действие: 'Ctrl+KeyS' | '' (отключено) }; нет ключа — по умолчанию
  // деревня (0.7): полоса на фоне, масштаб, смена дня и ночи, гости у экрана, выключенный свет, строгий фокус
  villageBackdrop: true,
  villageZoom: null, // 0.7.2: приближение (CSS-пикселей на пиксель деревни); null — «Авто»: чем больше деревня, тем дальше
  dayMode: 'theme', // 'theme' | 'cycle' (каждые 5 минут) | 'real' (по часам); cycle/real — после покупки «Смены дня и ночи»
  visitors: true,
  villageLightsOff: [],
  focusStrict: false,
  decorMotion: true,
  achievementNotifications: true,
  scheme: 'indigo', // цветовая схема (косметика из магазина, п. 2.6)
  letter: null, // цвет квадрата с буквой (косметика); null — цвет акцента
};

/** Оформление Feast по умолчанию — багровое, в духе Crimson Harvest. */
const APP_DEFAULTS = {
  chronicle: {},
  feast: { dock: null, expanded: true, autoHide: false, dockOpen: {}, scheme: 'crimson', letter: null },
};

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
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

/** Цветовые схемы: акцент для светлой и тёмной темы. indigo и crimson — бесплатно. */
export const SCHEMES = {
  indigo: { name: 'Индиго', light: '#3949ab', dark: '#8c9eff' },
  crimson: { name: 'Багрянец', light: '#a3122a', dark: '#ef5b6b' },
  lime: { name: 'Lime', light: '#5b8c00', dark: '#c6f432' },
  lavender: { name: 'Lavender', light: '#7b4fd6', dark: '#c7a6ff' },
  ocean: { name: 'Океан', light: '#00796b', dark: '#4dd0c4' },
  sunset: { name: 'Закат', light: '#d84315', dark: '#ffab76' },
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
