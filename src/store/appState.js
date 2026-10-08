// Состояние приложения в памяти + подписки. Данные (data) меняются только через store/actions.js.
// ui — состояние интерфейса: snackbar, диалог, нижняя панель, быстрый ввод, баннеры.

import { todayIn, nowTimeIn } from '../core/dates.js';
import { TIMINGS } from '../config.js';
import { tr } from '../core/i18n.js';

export const store = {
  data: {
    settings: null, lists: new Map(), tasks: new Map(), media: new Map(), devices: new Map(),
    priorities: new Map(), coinEvents: new Map(), rewards: new Map(), // формат v2
    doneArchive: new Map(), // формат v3: сводки удалённых выполненных задач
  },
  // Feast (0.11): данные счётчика калорий — своя база и своя папка на Диске (core/feast.js)
  feast: {
    settings: null, foods: new Map(), entries: new Map(), dayArchive: new Map(), body: new Map(),
    meals: new Map(), mealNotes: new Map(), // 0.12: рационы и заметки к ним
  },
  version: 0, // растёт при каждом изменении data — по нему мемоизируются выборки
  now: { today: '', time: '', ms: 0 },
  deviceId: null,
  auth: null, // { accessToken, expiresAt, scope, email } — google/auth.js
  sync: {
    phase: null, // 'pull' | 'push' | null
    step: null, // текущий шаг для панели синхронизации
    lastError: null, // { code, text, at } — ошибка последней синхронизации
    authError: null, // { code, text, at } — ошибка последнего входа Google
    offline: typeof navigator !== 'undefined' ? !navigator.onLine : false,
    remoteNewer: false,
    lastPullAt: null,
    lastPushAt: null,
    layout: null, // id файлов и папок на Диске
    kingdomId: null, // 0.12: общая папка Kingdom на Диске
    lastRevisionId: null,
    extraRoots: [],
    clockSkewMin: 0,
    everLoggedIn: false,
    feastLayout: null, // 0.11: id папки и файлов Feast на Диске
    feastRevisionId: null,
  },
  ui: {
    snackbar: null, // { id, text, actionLabel, onAction }
    dialog: null, // { title, text, buttons: [{ label, value, kind }], resolve }
    sheet: null, // { type, ...props }
    quickAdd: null, // { listId, scheduledDate } | null
    dirtyCount: 0,
    feastDirty: 0, // 0.11: непушнутые правки Feast (в индикаторе — сумма)
    feastReadOnly: null, // 0.11: база Feast на Диске новее приложения — текст причины
    readOnly: null, // null или текст причины
    update: null, // { version } — доступно обновление
    fatal: null,
    start: false, // стартовый экран «Войти через Google»
    redirecting: false, // уходим на страницу входа Google
  },
};

export function setSync(patch) {
  Object.assign(store.sync, patch);
  notify();
}

const listeners = new Set();
let scheduled = false;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Уведомить подписчиков (склеивается в одну перерисовку на микротаск). */
export function notify() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    for (const fn of listeners) fn();
  });
}

export function bumpData() {
  store.version++;
  notify();
}

/** Непушнутые правки обоих приложений (0.11: задачи + Feast). */
export const totalDirty = () => (store.ui.dirtyCount || 0) + (store.ui.feastDirty || 0);

export function setUi(patch) {
  Object.assign(store.ui, patch);
  notify();
}

// ---------- «Сейчас» ----------

let tickTimer = null;

export function refreshNow() {
  const tz = store.data.settings?.timeZone || 'UTC';
  const d = new Date();
  const today = todayIn(tz, d);
  const time = nowTimeIn(tz, d);
  if (today !== store.now.today || time !== store.now.time) {
    store.now = { today, time, ms: d.getTime() };
    notify();
  }
}

/** Пересчёт раз в минуту (на границе минуты) и при возврате на вкладку: смена дня, дедлайны со временем. */
export function startNowTicker() {
  refreshNow();
  const schedule = () => {
    clearTimeout(tickTimer);
    tickTimer = setTimeout(() => {
      refreshNow();
      schedule();
    }, 60000 - (Date.now() % 60000) + 50);
  };
  schedule();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshNow();
      schedule();
    }
  });
}

// ---------- Несохранённый ввод ----------
// Поля с отложенным сохранением (debounce) регистрируют здесь функцию «сохранить сейчас».
// Её вызывают перед обновлением приложения и при уходе со страницы.

const flushers = new Set();

export function registerFlusher(fn) {
  flushers.add(fn);
  return () => flushers.delete(fn);
}

export async function flushAll() {
  await Promise.all([...flushers].map((fn) => Promise.resolve().then(fn).catch(console.error)));
}

// ---------- Обратная связь ----------

let snackTimer = null;
let snackSeq = 0;

export function showSnackbar(text, actionLabel = null, onAction = null) {
  clearTimeout(snackTimer);
  const id = ++snackSeq;
  setUi({ snackbar: { id, text, actionLabel, onAction } });
  snackTimer = setTimeout(() => {
    if (store.ui.snackbar?.id === id) setUi({ snackbar: null });
  }, TIMINGS.snackbarMs);
}

export function hideSnackbar() {
  clearTimeout(snackTimer);
  setUi({ snackbar: null });
}

/**
 * Диалог с кнопками. Возвращает value нажатой кнопки или null (закрыли).
 * buttons: [{ label, value, kind: 'primary' | 'danger' | undefined }]
 */
export function ask({ title, text = '', buttons, items = null }) {
  return new Promise((resolve) => {
    if (store.ui.dialog) store.ui.dialog.resolve(null);
    setUi({ dialog: { title, text, buttons, items, resolve } });
  });
}

export function closeDialog(value = null) {
  const d = store.ui.dialog;
  if (!d) return;
  setUi({ dialog: null });
  d.resolve(value);
}

export async function confirm({ title, text = '', confirmLabel, danger = false }) {
  const v = await ask({
    title,
    text,
    buttons: [
      { label: tr('Отмена'), value: false },
      { label: confirmLabel, value: true, kind: danger ? 'danger' : 'primary' },
    ],
  });
  return v === true;
}

export function openSheet(type, props = {}) {
  setUi({ sheet: { type, ...props } });
}

export function closeSheet() {
  if (store.ui.sheet) setUi({ sheet: null });
}

export function openQuickAdd(ctx = {}) {
  setUi({ quickAdd: { listId: ctx.listId ?? null, scheduledDate: ctx.scheduledDate ?? null } });
}

export function closeQuickAdd() {
  setUi({ quickAdd: null });
}
