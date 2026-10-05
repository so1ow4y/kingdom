// Уведомления о задачах (обновление 0.3, п. 2.5).
//
// Честное ограничение: сервера нет, поэтому напоминания показывает само приложение — только пока оно открыто
// (вкладка или окно установленного PWA, можно свёрнутое). Раз в 15 секунд проверяем, что сработало;
// если приложение было закрыто, при следующем открытии показываем «Пропущенные напоминания».
// Гарантированную доставку позже сделает Telegram-бот.
//
// Всё здесь — состояние ЭТОГО устройства (localStorage 'lifetasks.notify'): включены ли уведомления,
// что уже показано, отложенные «на 10 минут», пропущенные. В базу и на Диск не попадает.
// Если открыто несколько вкладок, показывает одна (Web Locks), а tag уведомления не даёт дублей.

import { store, setUi, showSnackbar, notify } from '../store/appState.js';
import * as R from '../core/reminders.js';
import * as A from '../store/actions.js';
import { navigate } from './router.js';

const KEY = 'lifetasks.notify';
const TICK_MS = 15000;
const LATE_MS = 2 * 60000; // опоздали больше чем на 2 минуты — это уже «пропущено», а не «сейчас»
const MISSED_WINDOW_MS = 7 * 86400000;
const SNOOZE_MS = 10 * 60000;
const MAX_MISSED = 50;
const SENT_KEEP_MS = 8 * 86400000;

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { enabled: true, lastSeen: null, sent: {}, snoozes: [], missed: [], ...s };
  } catch {
    return { enabled: true, lastSeen: null, sent: {}, snoozes: [], missed: [] };
  }
}

let st = load();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(st));
  } catch {
    // без localStorage просто не запомним, что уже показали
  }
}

/** 'unsupported' | 'default' | 'granted' | 'denied' */
export function permission() {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

export const notifyEnabled = () => st.enabled;
export const missedReminders = () => st.missed;

export function setNotifyEnabled(v) {
  st = { ...load(), enabled: !!v };
  save();
  notify();
}

/** Системный запрос разрешения. Вызывать только из обработчика нажатия (жест пользователя). */
export async function requestPermission() {
  if (permission() === 'unsupported') return 'unsupported';
  try {
    const r = await Notification.requestPermission();
    if (r === 'granted') setNotifyEnabled(true);
    notify();
    return r;
  } catch {
    return permission();
  }
}

export function clearMissed() {
  st = { ...load(), missed: [] };
  save();
  setUi({ missedCount: 0 });
}

function active() {
  return st.enabled && permission() === 'granted';
}

/** Простое уведомление без кнопок (например, «Фокус завершён»), если уведомления включены. */
export async function notifyPlain(title, body, tag = 'lt-plain') {
  if (!active()) return;
  const opts = { body, tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: {} };
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (reg?.showNotification) {
      await reg.showNotification(title, opts);
      return;
    }
  } catch {
    // ниже — обычное Notification
  }
  try {
    new Notification(title, opts);
  } catch (e) {
    console.warn('notification', e);
  }
}

async function show(item) {
  const task = store.data.tasks.get(item.taskId);
  if (!task) return;
  const title = (item.nag ? '🔁 ' : item.snooze ? '⏰ ' : '🔔 ') + task.title;
  const opts = {
    body: R.notificationBody(task, store.data.settings.timeZone),
    tag: 'lt-' + item.taskId, // новое напоминание по той же задаче заменяет старое
    renotify: true,
    data: { taskId: item.taskId, key: item.key },
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    actions: [{ action: 'done', title: 'Готово' }, { action: 'snooze', title: 'Отложить на 10 мин' }],
  };
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (reg?.showNotification) {
      await reg.showNotification(title, opts);
      return;
    }
  } catch {
    // нет Service Worker — покажем обычным Notification (без кнопок)
  }
  try {
    const { actions, ...plain } = opts;
    const n = new Notification(title, plain);
    n.onclick = () => {
      window.focus();
      handleAction({ action: 'open', taskId: item.taskId });
      n.close();
    };
  } catch (e) {
    console.warn('notification', e);
  }
}

function prune(now) {
  for (const [k, at] of Object.entries(st.sent)) if (now - at > SENT_KEEP_MS) delete st.sent[k];
}

async function tick() {
  if (!store.data?.settings) return;
  const now = Date.now();
  st = load();
  const from = st.lastSeen ?? now;
  st.lastSeen = now;
  if (!active()) {
    save();
    return;
  }
  const due = from < now ? R.dueBetween(store.data, Math.max(from, now - MISSED_WINDOW_MS), now) : [];
  // Отложенные «на 10 минут»
  const ready = st.snoozes.filter((s) => s.at <= now);
  st.snoozes = st.snoozes.filter((s) => s.at > now);
  for (const s of ready) due.push({ ...s, snooze: true });

  const toShow = [];
  let missedAdded = 0;
  for (const d of due) {
    if (st.sent[d.key]) continue;
    st.sent[d.key] = now;
    const t = store.data.tasks.get(d.taskId);
    if (!t || !R.remindable(t)) continue;
    if (now - d.at > LATE_MS && !d.snooze) {
      if (d.nag) continue; // пропущенные повторы не копим: хватит одного напоминания
      st.missed = [{ key: d.key, taskId: d.taskId, title: d.title, at: d.at }, ...st.missed.filter((m) => m.taskId !== d.taskId)].slice(0, MAX_MISSED);
      missedAdded++;
    } else toShow.push(d);
  }
  prune(now);
  save();
  if (missedAdded) setUi({ missedCount: st.missed.length });
  // Если сработало много сразу — показываем последние несколько, чтобы не засыпать уведомлениями
  for (const d of toShow.slice(-5)) await show(d);
}

async function guardedTick() {
  if (navigator.locks?.request) {
    await navigator.locks.request('lifetasks-notify', { ifAvailable: true }, async (lock) => {
      if (lock) await tick();
    });
  } else await tick();
}

/** Кнопки уведомления и нажатие на него (сообщение от Service Worker или ?act= в адресе). */
export async function handleAction({ action, taskId }) {
  const t = store.data.tasks.get(taskId);
  if (!t || t.deletedAt) return showSnackbar('Задача не найдена');
  if (action === 'done') {
    if (t.status === 'active') await A.toggleComplete(taskId);
    return;
  }
  if (action === 'snooze') {
    st = load();
    st.snoozes = [...st.snoozes.filter((s) => s.taskId !== taskId), { key: `${taskId}|snooze|${Date.now()}`, taskId, title: t.title, at: Date.now() + SNOOZE_MS }];
    save();
    showSnackbar('Напомню через 10 минут');
    return;
  }
  navigate('/task/' + encodeURIComponent(taskId));
}

let timer = null;

export function startNotifier() {
  if (timer) return;
  st = load();
  setUi({ missedCount: st.missed.length });
  navigator.serviceWorker?.addEventListener?.('message', (e) => {
    if (e.data?.type === 'lt-notify') handleAction(e.data);
  });
  // Приложение открыли из уведомления, когда оно было закрыто: #/task/<id>?act=done|snooze
  const m = location.hash.match(/^#\/task\/([^?]+)\?act=(done|snooze)$/);
  if (m) {
    const taskId = decodeURIComponent(m[1]);
    history.replaceState(history.state, '', '#/task/' + m[1]);
    setTimeout(() => handleAction({ action: m[2], taskId }), 0);
  }
  guardedTick();
  timer = setInterval(guardedTick, TICK_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') guardedTick();
  });
}

/** Проверочное уведомление из настроек. */
export async function testNotification() {
  const opts = { body: 'Так будут выглядеть напоминания о задачах.', tag: 'lt-test', icon: 'icons/icon-192.png' };
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (reg?.showNotification) return await reg.showNotification('🔔 LifeTasks', opts);
  } catch {
    // ниже — запасной путь
  }
  try {
    new Notification('🔔 LifeTasks', opts);
  } catch (e) {
    showSnackbar('Не получилось показать уведомление');
  }
}
