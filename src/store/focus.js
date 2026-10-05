// Фокус-сессия «взялся за задачу» (обновление 0.7, как в приложении Forest). Идёт на ЭТОМ устройстве:
// состояние — в localStorage, чтобы пережить перезагрузку и быть видным в других вкладках.
// В общий журнал (coinEvents) попадает только завершённая сессия — событие type 'focus' (core/game.js focusEvent).

import { notify } from './appState.js';

const KEY = 'lifetasks.focus';

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    return s && Number.isFinite(s.endsAt) && Number.isFinite(s.startedAt) ? s : null;
  } catch {
    return null;
  }
}

let state = load();

/** { taskId, title, minutes, startedAt, endsAt, hiddenAt? } или null. */
export const getFocus = () => state;

let persisted = true;

export function setFocus(next) {
  state = next;
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
    persisted = true;
  } catch {
    persisted = false; // без localStorage сессия живёт до перезагрузки
  }
  notify();
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      state = load();
      notify();
    }
  });
}

/**
 * Забрать сессию для завершения: перечитываем localStorage, чтобы две открытые вкладки не засчитали её дважды.
 * Возвращает сессию (и очищает её) или null, если её уже завершили в другой вкладке.
 */
export function claimFocus() {
  const mine = state;
  if (!persisted) {
    if (mine) setFocus(null);
    return mine;
  }
  const fresh = load();
  if (!mine || !fresh || fresh.startedAt !== mine.startedAt) {
    if (state !== fresh) {
      state = fresh;
      notify();
    }
    return null;
  }
  setFocus(null);
  return mine;
}

/** Сколько осталось, мс (не меньше 0). */
export const focusLeft = (f, now = Date.now()) => Math.max(0, f.endsAt - now);
