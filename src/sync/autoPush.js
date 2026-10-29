// Автопуш (обновление 1.1): изменения уходят на Диск сами — при открытии (и обновлении) страницы, когда уходишь
// со страницы (вкладка спрятана, телефон заблокирован) и после N минут без новых изменений (настройка этого
// устройства, по умолчанию 5). Пока что-то вводится — открыт лист (запись еды, новая задача, рацион), фокус в поле
// ввода, тянут запись — отсчёт не идёт: недоделанная запись не уедет на Диск; отсчёт начинается, когда ввод закончен.
// Пуш тихий: без входа в Google, без сети или в режиме «только чтение» он просто ждёт; ошибки — в индикаторе.

import { store, subscribe, totalDirty } from '../store/appState.js';
import { tokenValid } from '../google/auth.js';
import { push } from './syncEngine.js';

const TICK_MS = 10000;
/** Уход со страницы пушит не чаще раза в минуту (переключение вкладок туда-сюда). */
const LEAVE_GAP_MS = 60000;
export const AUTO_PUSH_MIN = 1;
export const AUTO_PUSH_MAX = 120;

let started = false;
let settings = () => ({ autoPush: false });
let lastVersion = -1;
let lastDirty = 0;
let lastChange = Date.now();
let lastLeave = 0;
let wasEditing = false;

/** Идёт ли ввод: открыт лист или «Новая задача», фокус в поле ввода, тянут запись дневника. */
export function isEditing(ui = store.ui, doc = globalThis.document) {
  if (ui?.sheet || ui?.quickAdd) return true;
  const a = doc?.activeElement;
  if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName || ''))) return true;
  return !!doc?.body?.classList.contains('entry-dragging');
}

/** Пора ли пушить: включено, есть что, ввод не идёт и N минут без изменений (чистая функция). */
export function autoPushDue({ enabled, minutes, now, lastChange: since, dirty, editing, ready = true }) {
  if (!enabled || !ready || editing || !(dirty > 0)) return false;
  const m = Math.max(AUTO_PUSH_MIN, Math.min(AUTO_PUSH_MAX, Math.round(+minutes || 5)));
  return now - since >= m * 60000;
}

const ready = () => navigator.onLine && tokenValid() && !store.sync.phase && !store.ui.readOnly;

/** Для настроек и индикатора: включено ли, на паузе ли, когда пуш (мс). */
export function autoPushState() {
  const s = settings();
  const minutes = Math.max(AUTO_PUSH_MIN, Math.min(AUTO_PUSH_MAX, Math.round(+s.autoPushMinutes || 5)));
  return { on: !!s.autoPush, minutes, dirty: totalDirty(), editing: isEditing(), at: lastChange + minutes * 60000, ready: started && ready() };
}

function fire(reason) {
  lastChange = Date.now(); // и после неудачи — следующая попытка не раньше чем через N минут
  return push({ silent: true, auto: reason }).catch((e) => console.warn('autoPush', e));
}

function tick() {
  const editing = isEditing();
  // отсчёт начинается, когда ввод закончен
  if (editing || wasEditing) lastChange = Date.now();
  wasEditing = editing;
  const s = settings();
  if (autoPushDue({ enabled: s.autoPush, minutes: s.autoPushMinutes, now: Date.now(), lastChange, dirty: totalDirty(), editing, ready: ready() })) fire('idle');
}

function onLeave() {
  const s = settings();
  if (!s.autoPush || s.autoPushOnOpen === false || !totalDirty() || isEditing() || !ready()) return;
  if (Date.now() - lastLeave < LEAVE_GAP_MS) return;
  lastLeave = Date.now();
  fire('leave');
}

/**
 * Запуск после первой синхронизации (main.js). getSettings — настройки устройства: autoPush, autoPushMinutes,
 * autoPushOnOpen (при открытии и уходе со страницы).
 */
export function startAutoPush(getSettings) {
  if (started) return;
  started = true;
  settings = getSettings;
  lastVersion = store.version;
  lastDirty = totalDirty();
  // новое изменение — отсчёт заново
  subscribe(() => {
    const d = totalDirty();
    if (store.version !== lastVersion || d > lastDirty) lastChange = Date.now();
    lastVersion = store.version;
    lastDirty = d;
  });
  setInterval(tick, TICK_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onLeave();
  });
  window.addEventListener('pagehide', onLeave);
  // при открытии и обновлении страницы — то, что не ушло в прошлый раз
  const s = settings();
  if (s.autoPush && s.autoPushOnOpen !== false && totalDirty() && ready() && !isEditing()) fire('open');
}
