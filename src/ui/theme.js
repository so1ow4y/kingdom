// Тема хранится локально на устройстве: 'system' | 'light' | 'dark'.
// С 0.11 у каждого приложения своя: Chronicle — 'lifetasks.theme' (как раньше), Feast — 'lifetasks.theme.feast'
// (по умолчанию тёмная — Crimson Harvest).

import { activeApp } from './prefs.js';

const KEY = { chronicle: 'lifetasks.theme', feast: 'lifetasks.theme.feast' };
const DEFAULT = { chronicle: 'system', feast: 'dark' };

export function getTheme(app = activeApp()) {
  try {
    return localStorage.getItem(KEY[app] || KEY.chronicle) || DEFAULT[app] || 'system';
  } catch {
    return DEFAULT[app] || 'system';
  }
}

export function applyTheme(theme = getTheme()) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
}

export function setTheme(theme, app = activeApp()) {
  try {
    if (theme === DEFAULT[app]) localStorage.removeItem(KEY[app]);
    else localStorage.setItem(KEY[app], theme);
  } catch {
    // без localStorage тема просто не запомнится
  }
  if (app === activeApp()) applyTheme(theme);
}
