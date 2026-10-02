// Все действия пользователя над данными. Каждое действие:
// 1) вычисляет новые версии сущностей чистыми функциями core/model.js;
// 2) применяет их в памяти (UI обновляется сразу) и пишет в IndexedDB одной транзакцией;
// 3) при ошибке записи откатывает память и показывает ошибку;
// 4) сообщает другим вкладкам через BroadcastChannel.

import { store, bumpData, setUi, showSnackbar, ask, confirm, refreshNow } from './appState.js';
import { deleteLocalDatabase } from './localRepo.js';
import * as M from '../core/model.js';
import * as S from '../core/selectors.js';
import { keyBetween, keyForIndex } from '../core/order.js';
import { humanDate } from '../core/dates.js';
import { countLabel } from '../core/plural.js';
import { LIMITS } from '../config.js';
import { APP_VERSION } from '../version.js';

let repo = null;
let clock = null;
let deviceId = null;
let channel = null;

export function initActions(opts) {
  ({ repo, clock, deviceId } = opts);
  if ('BroadcastChannel' in self) {
    channel = new BroadcastChannel('lifetasks');
    channel.onmessage = (e) => onBroadcast(e.data);
  }
}

const ctx = () => ({ now: Date.now(), stamp: () => clock.stamp(), deviceId });
export const getTask = (id) => store.data.tasks.get(id);
export const getList = (id) => store.data.lists.get(id);

function getEntity(coll, id) {
  return coll === 'settings' ? store.data.settings : store.data[coll].get(id);
}

function setEntity(coll, e) {
  if (coll === 'settings') store.data.settings = e;
  else store.data[coll].set(e.id, e);
}

function change(coll, id, fn) {
  const prev = getEntity(coll, id);
  if (!prev) return null;
  return { coll, prev, next: fn(prev) };
}

async function commit(changes) {
  const list = changes.filter((c) => c && c.next && c.next !== c.prev);
  if (!list.length) return false;
  if (store.ui.readOnly) {
    showSnackbar('Только чтение: сначала обнови приложение');
    return false;
  }
  for (const c of list) setEntity(c.coll, c.next);
  bumpData();
  if (list.some((c) => c.coll === 'settings')) refreshNow();
  try {
    await repo.commit({
      puts: list.map((c) => [c.coll, c.next]),
      dirty: list.map((c) => `${c.coll}/${c.next.id}`),
      meta: { 'clock.lastStamp': clock.last },
    });
  } catch (e) {
    for (const c of list) {
      if (c.prev) setEntity(c.coll, c.prev);
      else if (c.coll !== 'settings') store.data[c.coll].delete(c.next.id);
    }
    bumpData();
    reportError(e);
    return false;
  }
  refreshDirty();
  channel?.postMessage({ type: 'changed', keys: list.map((c) => [c.coll, c.next.id]) });
  return true;
}

export async function refreshDirty() {
  try {
    setUi({ dirtyCount: await repo.dirtyCount() });
  } catch {
    // счётчик не критичен
  }
}

export function reportError(e) {
  console.error(e);
  const quota = e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message || ''));
  showSnackbar(quota
    ? 'На устройстве закончилось место для данных приложения. Правка не сохранена'
    : `Что-то пошло не так: ${e?.message || e}. Данные на устройстве не пострадали`);
  repo?.logError({ at: new Date().toISOString(), code: quota ? 'E-LOCAL-QUOTA' : 'E-INTERNAL', message: String(e?.message || e), stack: e?.stack || null });
}

function offerUndo(text, changes) {
  const done = changes.filter((c) => c && c.prev && c.next !== c.prev);
  if (!done.length) return showSnackbar(text);
  showSnackbar(text, 'Отменить', () => undo(done));
}

async function undo(changes) {
  const c0 = ctx();
  await commit(changes.map((c) => {
    const current = getEntity(c.coll, c.next.id);
    return current ? { coll: c.coll, prev: current, next: M.revert(current, c.prev, c0) } : null;
  }));
}

async function onBroadcast(msg) {
  if (!msg || msg.type !== 'changed' || !repo) return;
  for (const [coll, id] of msg.keys) {
    const e = await repo.get(coll, id);
    if (e) setEntity(coll, e);
  }
  bumpData();
  refreshNow();
  refreshDirty();
}

// ---------- Для синхронизации (sync/syncEngine.js) ----------

export const syncHooks = {
  getEntity,
  setEntity,
  deleteEntity: (coll, id) => store.data[coll].delete(id),
  observeStamp: (ms) => clock.observe(ms),
  clockLast: () => clock.last,
  broadcast: (keys) => channel?.postMessage({ type: 'changed', keys }),
  ctx,
};

/** Отметить время пуша в записи устройства (попадает в базу этим же пушем). */
export async function markDevicePushed(at) {
  return commit([change('devices', deviceId, (d) => M.touch(d, { lastPushAt: at }, ctx()))]);
}

export async function renameDevice(name) {
  const n = String(name || '').trim().slice(0, 40);
  if (!n) return;
  await commit([change('devices', deviceId, (d) => M.touch(d, { name: n }, ctx()))]);
  await repo.setMeta('deviceName', n);
}

/** Восстановить проигравшее значение из журнала конфликтов (новой правкой). */
export async function restoreConflict(row) {
  const [coll, id] = row.entityKey.split('/');
  let ok = false;
  if (row.kind === 'field') {
    const e = getEntity(coll, id);
    if (!e || e.deletedAt) {
      showSnackbar('Эта запись уже удалена');
    } else {
      ok = await commit([change(coll, id, (x) => M.touch(x, { [row.field]: row.loserValue }, ctx()))]);
      if (ok) showSnackbar('Вариант восстановлен');
    }
  } else if (row.kind === 'deleted' && row.loserValue) {
    const copy = M.cloneAsNew(row.loserValue, ctx());
    ok = await commit([{ coll, prev: undefined, next: copy }]);
    if (ok) showSnackbar('Восстановлено как новая запись');
  }
  if (ok) await repo.updateConflict({ ...row, resolved: true });
  return ok;
}

// ---------- Порядок ----------

function keyBeforeSafe(first) {
  try {
    return keyBetween(null, first ?? null);
  } catch {
    return 'a0';
  }
}

function keyAfterSafe(last) {
  try {
    return keyBetween(last ?? null, null);
  } catch {
    return 'a0';
  }
}

function listName(listId) {
  if (!listId) return '«Входящие»';
  const l = getList(listId);
  return l ? `«${l.name}»` : 'список';
}

// ---------- Задачи ----------

/** Создать задачу. Новые задачи встают в начало своего контейнера («Входящие» или список). */
export async function createTask({ title, note = '', listId = null, scheduledDate = null, focus = false }) {
  const today = store.now.today;
  const first = S.containerTasks(store.data, listId)[0];
  let focusDate = null;
  let focusOrder = null;
  let focusRejected = false;
  if (focus) {
    const ft = S.focusTasks(store.data, today);
    if (ft.length >= LIMITS.focusMax) focusRejected = true;
    else {
      focusDate = today;
      focusOrder = keyAfterSafe(ft.at(-1)?.focusOrder);
    }
  }
  const t = M.newTask({
    title, note, listId, scheduledDate, focusDate, focusOrder, order: keyBeforeSafe(first?.order),
  }, ctx());
  const ok = await commit([{ coll: 'tasks', prev: undefined, next: t }]);
  return ok ? { task: t, focusRejected } : null;
}

/** Правка полей задачи из карточки (без snackbar). */
export async function updateTask(id, changes) {
  return commit([change('tasks', id, (t) => M.touch(t, changes, ctx()))]);
}

export async function toggleComplete(id) {
  const t = getTask(id);
  if (!t) return;
  if (t.status === 'done') {
    await commit([change('tasks', id, (x) => M.reopenTask(x, ctx()))]);
    return;
  }
  const c = change('tasks', id, (x) => M.completeTask(x, ctx()));
  if (await commit([c])) offerUndo('Выполнено', [c]);
}

export async function reopenTask(id) {
  const c = change('tasks', id, (x) => M.reopenTask(x, ctx()));
  if (await commit([c])) offerUndo('Задача снова активна', [c]);
}

export async function trashTask(id) {
  const c = change('tasks', id, (x) => M.trashTask(x, ctx()));
  if (await commit([c])) offerUndo('Перемещено в корзину', [c]);
}

export async function restoreTask(id) {
  const c = change('tasks', id, (x) => M.restoreTask(x, ctx()));
  if (await commit([c])) offerUndo('Восстановлено', [c]);
}

export async function deleteForever(id) {
  const t = getTask(id);
  if (!t) return false;
  const ok = await confirm({
    title: 'Удалить задачу навсегда?',
    text: `«${t.title}» будет удалена без возможности восстановления.`,
    confirmLabel: 'Удалить навсегда',
    danger: true,
  });
  if (!ok) return false;
  await commit([change('tasks', id, (x) => M.tombstone(x, ctx()))]);
  showSnackbar('Удалено навсегда');
  return true;
}

export async function emptyTrash() {
  const list = S.trashView(store.data);
  if (!list.length) return;
  const ok = await confirm({
    title: 'Очистить корзину?',
    text: `Удалить навсегда ${countLabel(list.length, ['задачу', 'задачи', 'задач'])}? Это нельзя отменить.`,
    confirmLabel: 'Удалить навсегда',
    danger: true,
  });
  if (!ok) return;
  const c0 = ctx();
  await commit(list.map((t) => ({ coll: 'tasks', prev: t, next: M.tombstone(t, c0) })));
  showSnackbar('Корзина очищена');
}

/** Автоочистка корзины при запуске (TZ §6.9). */
export async function purgeExpiredTrash() {
  const list = S.expiredTrash(store.data, Date.now());
  if (!list.length) return;
  const c0 = ctx();
  await commit(list.map((t) => ({ coll: 'tasks', prev: t, next: M.tombstone(t, c0) })));
}

/** Дата и время «Когда». time === undefined — оставить прежнее время. */
export async function setSchedule(id, date, time) {
  const t = getTask(id);
  if (!t) return;
  const changes = {
    scheduledDate: date,
    scheduledTime: date ? (time === undefined ? t.scheduledTime : time) : null,
  };
  const c = change('tasks', id, (x) => M.touch(x, changes, ctx()));
  if (await commit([c])) {
    offerUndo(date ? `Запланировано: ${humanDate(date, store.now.today)}${changes.scheduledTime ? ' ' + changes.scheduledTime : ''}` : 'Дата убрана', [c]);
  }
}

export async function setDeadline(id, date, time) {
  const t = getTask(id);
  if (!t) return;
  const changes = {
    deadlineDate: date,
    deadlineTime: date ? (time === undefined ? t.deadlineTime : time) : null,
  };
  const c = change('tasks', id, (x) => M.touch(x, changes, ctx()));
  if (await commit([c])) {
    offerUndo(date ? `Дедлайн: ${humanDate(date, store.now.today)}${changes.deadlineTime ? ' ' + changes.deadlineTime : ''}` : 'Дедлайн убран', [c]);
  }
}

export async function moveToList(id, listId) {
  const t = getTask(id);
  if (!t || (t.listId ?? null) === (listId ?? null)) return;
  const first = S.containerTasks(store.data, listId)[0];
  const c = change('tasks', id, (x) => M.touch(x, { listId: listId ?? null, order: keyBeforeSafe(first?.order) }, ctx()));
  if (await commit([c])) offerUndo(`Перемещено в ${listName(listId)}`, [c]);
}

export async function setPriority(id, priority) {
  await commit([change('tasks', id, (x) => M.touch(x, { priority }, ctx()))]);
}

/** ★ — главное на сегодня, с проверкой лимита и даты (TZ §7.6). */
export async function toggleFocus(id) {
  const t = getTask(id);
  if (!t) return;
  const today = store.now.today;
  if (t.focusDate === today) {
    await commit([change('tasks', id, (x) => M.touch(x, { focusDate: null, focusOrder: null }, ctx()))]);
    return;
  }
  const others = S.focusTasks(store.data, today).filter((x) => x.id !== id);
  let replaced = null;
  if (others.length >= LIMITS.focusMax) {
    const v = await ask({
      title: `Уже ${LIMITS.focusMax} главных`,
      text: 'Заменить:',
      items: others.map((x) => ({ label: x.title, value: x.id })),
      buttons: [{ label: 'Отмена', value: null }],
    });
    if (!v) return;
    replaced = others.find((x) => x.id === v);
  }
  let scheduleToday = false;
  if (t.scheduledDate && t.scheduledDate > today) {
    const v = await ask({
      title: `Задача запланирована на ${humanDate(t.scheduledDate, today)}`,
      text: 'Сделать её сегодня?',
      buttons: [
        { label: 'Только отметить главной', value: 'focus' },
        { label: 'Да, на сегодня', value: 'today', kind: 'primary' },
      ],
    });
    if (!v) return;
    scheduleToday = v === 'today';
  }
  const c0 = ctx();
  const remaining = others.filter((x) => x !== replaced);
  const focusOrder = replaced ? replaced.focusOrder : keyAfterSafe(remaining.at(-1)?.focusOrder);
  const changes = [];
  if (replaced) changes.push(change('tasks', replaced.id, (x) => M.touch(x, { focusDate: null, focusOrder: null }, c0)));
  changes.push(change('tasks', id, (x) => M.touch(x, {
    focusDate: today, focusOrder, ...(scheduleToday ? { scheduledDate: today } : {}),
  }, c0)));
  await commit(changes);
}

/** Плашка «Вчера не сделано главное»: перенести на сегодня, сколько влезает. */
export async function carryYesterdayFocus(ids) {
  const today = store.now.today;
  const current = S.focusTasks(store.data, today);
  let free = LIMITS.focusMax - current.length;
  let last = current.at(-1)?.focusOrder;
  const c0 = ctx();
  const changes = [];
  for (const id of ids) {
    if (free > 0) {
      last = keyAfterSafe(last);
      changes.push(change('tasks', id, (x) => M.touch(x, { focusDate: today, focusOrder: last }, c0)));
      free--;
    } else {
      changes.push(change('tasks', id, (x) => M.touch(x, { focusDate: null, focusOrder: null }, c0)));
    }
  }
  if (await commit(changes)) offerUndo('Главные перенесены на сегодня', changes);
}

export async function clearFocus(ids) {
  const c0 = ctx();
  const changes = ids.map((id) => change('tasks', id, (x) => M.touch(x, { focusDate: null, focusOrder: null }, c0)));
  if (await commit(changes)) offerUndo('Убрано из главного', changes);
}

export async function moveOverdueToToday(ids) {
  if (!ids.length) return;
  const ok = await confirm({
    title: 'Перенести на сегодня?',
    text: `${countLabel(ids.length, ['просроченная задача', 'просроченные задачи', 'просроченных задач'])} получат дату «сегодня».`,
    confirmLabel: 'Перенести',
  });
  if (!ok) return;
  const today = store.now.today;
  const c0 = ctx();
  const changes = ids.map((id) => change('tasks', id, (x) => M.touch(x, { scheduledDate: today }, c0)));
  if (await commit(changes)) offerUndo('Перенесено на сегодня', changes);
}

/**
 * Ручной порядок. siblings — видимый отсортированный список задач (с перемещаемой или без),
 * index — новая позиция в списке без перемещаемой задачи.
 */
export async function reorderTask(id, siblings, index, field = 'order') {
  const rest = siblings.filter((x) => x.id !== id);
  let key;
  try {
    key = keyForIndex(rest, Math.max(0, Math.min(index, rest.length)), field);
  } catch (e) {
    reportError(e);
    return;
  }
  await commit([change('tasks', id, (x) => M.touch(x, { [field]: key }, ctx()))]);
}

export async function duplicateTask(id) {
  const t = getTask(id);
  if (!t) return null;
  const siblings = S.containerTasks(store.data, t.listId ?? null);
  const idx = siblings.findIndex((x) => x.id === id);
  let order;
  try {
    order = keyForIndex(siblings, idx + 1);
  } catch {
    order = keyBeforeSafe(siblings[0]?.order);
  }
  const copy = M.duplicateTask(t, order, ctx());
  if (await commit([{ coll: 'tasks', prev: undefined, next: copy }])) {
    showSnackbar('Создана копия');
    return copy;
  }
  return null;
}

// ---------- Списки ----------

export async function createList({ name, color, emoji }) {
  const all = [...S.sortedLists(store.data), ...S.sortedLists(store.data, { archived: true })]
    .sort((a, b) => (a.order < b.order ? -1 : 1));
  const l = M.newList({ name, color, emoji, order: keyAfterSafe(all.at(-1)?.order) }, ctx());
  return (await commit([{ coll: 'lists', prev: undefined, next: l }])) ? l : null;
}

export async function updateList(id, changes) {
  return commit([change('lists', id, (l) => M.touch(l, changes, ctx()))]);
}

export async function archiveList(id) {
  const l = getList(id);
  if (!l) return false;
  const active = S.activeCounts(store.data).get(id) || 0;
  if (active > 0) {
    const ok = await confirm({
      title: `Архивировать «${l.name}»?`,
      text: `В списке ${countLabel(active, ['активная задача', 'активные задачи', 'активных задач'])}. Они пропадут из «Сегодня», пока список в архиве.`,
      confirmLabel: 'Архивировать',
    });
    if (!ok) return false;
  }
  const c = change('lists', id, (x) => M.touch(x, { archived: true }, ctx()));
  if (await commit([c])) offerUndo(`Список «${l.name}» в архиве`, [c]);
  return true;
}

export async function unarchiveList(id) {
  const c = change('lists', id, (x) => M.touch(x, { archived: false }, ctx()));
  if (await commit([c])) showSnackbar('Список возвращён из архива');
}

export async function deleteList(id) {
  const l = getList(id);
  if (!l) return false;
  if (S.listHasTasks(store.data, id)) {
    showSnackbar('Сначала перенеси или удали задачи этого списка');
    return false;
  }
  const ok = await confirm({ title: `Удалить список «${l.name}»?`, text: 'Список пустой. Это нельзя отменить.', confirmLabel: 'Удалить', danger: true });
  if (!ok) return false;
  await commit([change('lists', id, (x) => M.tombstone(x, ctx()))]);
  showSnackbar('Список удалён');
  return true;
}

export async function reorderList(id, siblings, index) {
  const rest = siblings.filter((x) => x.id !== id);
  let key;
  try {
    key = keyForIndex(rest, Math.max(0, Math.min(index, rest.length)));
  } catch (e) {
    reportError(e);
    return;
  }
  await commit([change('lists', id, (x) => M.touch(x, { order: key }, ctx()))]);
}

// ---------- Настройки и устройство ----------

export async function updateSettings(changes) {
  return commit([change('settings', null, (s) => M.touch(s, changes, ctx()))]);
}

export async function syncDeviceInfo() {
  const d = store.data.devices.get(deviceId);
  if (d && d.appVersion !== APP_VERSION) {
    await commit([change('devices', deviceId, (x) => M.touch(x, { appVersion: APP_VERSION }, ctx()))]);
  }
}

/** «Очистить локальный кэш» (TZ §6.10): IndexedDB, кэши SW, наши ключи localStorage, затем перезагрузка. */
export async function clearLocalData() {
  repo?.close();
  await deleteLocalDatabase();
  if ('caches' in self) {
    for (const k of await caches.keys()) if (k.startsWith('lifetasks-')) await caches.delete(k);
  }
  for (const k of Object.keys(localStorage)) if (k.startsWith('lifetasks.')) localStorage.removeItem(k);
  location.reload();
}
