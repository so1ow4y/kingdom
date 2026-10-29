// Автопуш (обновление 1.1): изменения уходят на Диск сами — при открытии (и обновлении) страницы, когда уходишь
// со страницы (вкладка спрятана, телефон заблокирован) и после N минут без новых изменений (настройка этого
// устройства, по умолчанию 5). Пока что-то вводится — открыт лист (запись еды, новая задача, рацион), фокус в поле
// ввода, тянут запись — отсчёт не идёт: недоделанная запись не уедет на Диск; отсчёт начинается, когда ввод закончен.
// Пуш тихий: без входа в Google, без сети или в режиме «только чтение» он просто ждёт; ошибки — в индикаторе.
//
// 1.1.1 — закрытие вкладки или браузера. Незаметно допушить при закрытии нельзя: браузер обрывает запросы
// закрывающейся страницы, а пуш — это несколько запросов подряд. Поэтому: (1) на компьютере пуш начинается заранее,
// когда курсор уходит из страницы вверх — к вкладкам и крестику; (2) если при закрытии не всё на Диске (или пуш ещё
// идёт), браузер спрашивает своё «Покинуть сайт?» (свой текст туда вписать нельзя). «Отмена» — приложение допушивает
// и показывает «Подожди…», потом «Можно закрывать». Свои перезагрузки (язык, обновление приложения, сброс данных)
// ставят globalThis.kingdomReloading и не спрашивают.

import { store, subscribe, totalDirty, setUi } from '../store/appState.js';
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

const canPush = () => navigator.onLine && tokenValid() && !store.ui.readOnly;
const ready = () => canPush() && !store.sync.phase;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Спросить ли при закрытии «Покинуть сайт?» (чистая функция): включено, это не своя перезагрузка, и либо пуш ещё
 * идёт, либо есть непушнутое и его можно отправить (вход в Google, сеть).
 */
export function shouldGuardClose({ guard = true, reloading = false, pushing = false, dirty = 0, canPush: can = true }) {
  if (!guard || reloading) return false;
  return pushing || (dirty > 0 && can);
}

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

/** Курсор ушёл из окна вверх — к вкладкам, адресу, крестику: пуш заранее (1.1.1). */
function onExitIntent(e) {
  if (e.relatedTarget || e.clientY > 0) return;
  onLeave();
}

function onBeforeUnload(e) {
  const s = settings();
  if (!shouldGuardClose({ guard: s.autoPushGuard !== false, reloading: !!globalThis.kingdomReloading,
    pushing: store.sync.phase === 'push', dirty: totalDirty(), canPush: canPush() })) return;
  e.preventDefault();
  e.returnValue = '';
  // Браузер показывает «Покинуть сайт?». Остались («Отмена») — этот таймер сработает: допушиваем.
  setTimeout(pushBeforeClose, 0);
}

/**
 * Допушить перед закрытием (1.1.1): дождаться идущего пуша, отправить остальное; store.ui.closePush — 'pushing',
 * 'done' (всё на Диске, можно закрывать) или 'failed' (не вышло — останется на устройстве и уйдёт при открытии).
 */
export async function pushBeforeClose() {
  if (store.ui.closePush === 'pushing') return;
  setUi({ closePush: 'pushing' });
  const until = Date.now() + 120000;
  const waitIdle = async () => {
    while (store.sync.phase && Date.now() < until) await sleep(300);
  };
  await waitIdle();
  if (totalDirty() > 0 && canPush()) {
    lastLeave = Date.now();
    await push({ silent: true, auto: 'close' }).catch((err) => console.warn('closePush', err));
    await waitIdle();
  }
  await sleep(200);
  setUi({ closePush: totalDirty() > 0 ? 'failed' : 'done' });
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
  window.addEventListener('beforeunload', onBeforeUnload);
  document.documentElement.addEventListener('mouseleave', onExitIntent);
  // при открытии и обновлении страницы — то, что не ушло в прошлый раз
  const s = settings();
  if (s.autoPush && s.autoPushOnOpen !== false && totalDirty() && ready() && !isEditing()) fire('open');
}
