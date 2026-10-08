// Kingdom (0.11 — «Crimson Harvest»): два приложения в одном — Chronicle (задачи) и Crimson Harvest (еда и калории;
// в 0.11 — «Feast», внутренний id остался 'feast'). У каждого свои экраны, меню дока, оформление и папка на Google Диске
// (обе — внутри общей папки Kingdom); общие — вход Google, деревня и магазин, клавиши.
// Открытое приложение определяется экраном (#/diary — Crimson Harvest, #/today — Chronicle); общие экраны
// (настройки, журнал, деревня, магазин) остаются в том приложении, из которого их открыли.

import { activeApp, setActiveAppPref, getAppPrefs, SCHEMES } from './prefs.js';
import { applyTheme, getTheme } from './theme.js';
import { readLocal, writeLocal } from './hooks.js';
import { navigate } from './router.js';
import { notify } from '../store/appState.js';

export const SUITE_NAME = 'Kingdom';

export const APPS = {
  chronicle: {
    id: 'chronicle', name: 'Chronicle', letter: 'C', what: 'задачи', home: '/today',
    // деревня и магазин — общие (0.12): монеты и 💎 копятся и за задачи, и за еду
    routes: ['today', 'inbox', 'lists', 'list', 'task', 'tasks', 'analytics', 'archive', 'trash', 'quick'],
  },
  feast: {
    id: 'feast', name: 'Crimson Harvest', letter: 'CH', what: 'еда и калории', home: '/diary',
    routes: ['diary', 'meals', 'meal', 'foods', 'food', 'nutrition', 'body'],
  },
};

export const APP_IDS_ORDER = ['chronicle', 'feast'];

/** Приложение экрана; null — общий экран (настройки, журнал, «Ещё»). */
export function appOfRoute(name) {
  for (const a of Object.values(APPS)) if (a.routes.includes(name)) return a.id;
  return null;
}

export const otherApp = (id = activeApp()) => (id === 'chronicle' ? 'feast' : 'chronicle');

/** Сделать приложение открытым: оформление, тема и подписи переключаются сразу. */
export function activateApp(id) {
  if (!setActiveAppPref(id)) return false;
  applyTheme(getTheme(id));
  notify();
  return true;
}

/** Экран принадлежит другому приложению — переключиться тихо (вызывается при отрисовке, без notify). */
export function followRoute(id) {
  if (id && setActiveAppPref(id)) applyTheme(getTheme(id));
}

/** Запомнить экран приложения, чтобы вернуться на него при переключении. */
export function rememberRoute(id, path) {
  if (readLocal('lastRoute.' + id, null) !== path) writeLocal('lastRoute.' + id, path);
}

/** Перейти в другое приложение — на экран, где был в прошлый раз (оформление переключит сам экран, followRoute). */
export function switchApp(id = otherApp()) {
  navigate(readLocal('lastRoute.' + id, null) || APPS[id].home);
}

/**
 * Цвет квадрата с буквой приложения (даже не открытого): свой цвет буквы из косметики или акцент его схемы
 * в его теме.
 */
export function letterColors(id) {
  const p = getAppPrefs(id);
  if (p.letter) return { bg: p.letter, fg: '#fff' };
  const s = SCHEMES[p.scheme] || SCHEMES.indigo;
  const theme = getTheme(id);
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  return { bg: dark ? s.dark : s.light, fg: dark ? '#120d10' : '#fff' };
}
