// Настройки внешнего вида — ТОЛЬКО на этом устройстве (обновление 0.3, п. 2.3): в базу и на Диск не попадают,
// поэтому на телефоне и компе они разные. Хранятся в localStorage 'lifetasks.ui'.

import { notify } from '../store/appState.js';

const KEY = 'lifetasks.ui';
export const DOCK_POSITIONS = ['left', 'bottom', 'right', 'top'];
const DEFAULTS = {
  dock: null, // null — по устройству: телефон снизу, компьютер слева
  expanded: true, // развёрнутый вид (с подписями)
  autoHide: false, // уезжает за край и выезжает у края
  hidden: false, // спрятан целиком: у края только квадрат с буквой
  listsCollapsed: false,
  // деревня (0.7): полоса на фоне, масштаб, смена дня и ночи, гости у экрана, выключенный свет, строгий фокус
  villageBackdrop: true,
  villageScale: 'small', // 'small' | 'large'
  dayMode: 'theme', // 'theme' | 'cycle' (каждые 5 минут) | 'real' (по часам); cycle/real — после покупки «Смены дня и ночи»
  visitors: true,
  villageLightsOff: [],
  focusStrict: false,
  decorMotion: true,
  achievementNotifications: true,
  scheme: 'indigo', // цветовая схема (косметика из магазина, п. 2.6)
  letter: null, // цвет квадрата с буквой (косметика); null — цвет акцента
};

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

let prefs = load();

export function getPrefs() {
  return prefs;
}

export function setPrefs(patch) {
  prefs = { ...prefs, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // без localStorage настройка просто не запомнится
  }
  applyScheme();
  notify();
}

export const dockPosition = (phone) => prefs.dock || (phone ? 'bottom' : 'left');

/** Цветовые схемы: акцент для светлой и тёмной темы. indigo — по умолчанию и бесплатно. */
export const SCHEMES = {
  indigo: { name: 'Индиго', light: '#3949ab', dark: '#8c9eff' },
  lime: { name: 'Lime', light: '#5b8c00', dark: '#c6f432' },
  lavender: { name: 'Lavender', light: '#7b4fd6', dark: '#c7a6ff' },
  ocean: { name: 'Океан', light: '#00796b', dark: '#4dd0c4' },
  sunset: { name: 'Закат', light: '#d84315', dark: '#ffab76' },
};

export function applyScheme() {
  const root = document.documentElement;
  root.dataset.decorMotion = prefs.decorMotion === false ? 'off' : 'on';
  if (prefs.scheme && prefs.scheme !== 'indigo' && SCHEMES[prefs.scheme]) root.dataset.scheme = prefs.scheme;
  else delete root.dataset.scheme;
  for (const [k, v] of [['--letter-bg', prefs.letter], ['--letter-text', prefs.letter && '#fff']]) {
    if (v) root.style.setProperty(k, v);
    else root.style.removeProperty(k);
  }
}
