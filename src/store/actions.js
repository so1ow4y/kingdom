// Все действия пользователя над данными. Каждое действие:
// 1) вычисляет новые версии сущностей чистыми функциями core/model.js;
// 2) применяет их в памяти (UI обновляется сразу) и пишет в IndexedDB одной транзакцией;
// 3) при ошибке записи откатывает память и показывает ошибку;
// 4) сообщает другим вкладкам через BroadcastChannel.

import { store, bumpData, setUi, showSnackbar, ask, confirm, refreshNow } from './appState.js';
import { deleteLocalDatabase } from './localRepo.js';
import * as M from '../core/model.js';
import * as S from '../core/selectors.js';
import * as G from '../core/game.js';
import * as R from '../core/reminders.js';
import * as T from '../core/treeDrop.js';
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
  // Отменяются правки существующих сущностей и новые события монет (их отмена — active=false).
  const done = changes.filter((c) => c && c.next !== c.prev && (c.prev || c.coll === 'coinEvents'));
  if (!done.length) return showSnackbar(text);
  showSnackbar(text, 'Отменить', () => undo(done));
}

async function undo(changes) {
  const c0 = ctx();
  await commit(changes.map((c) => {
    const current = getEntity(c.coll, c.next.id);
    if (!current) return null;
    if (!c.prev) return current.active ? { coll: c.coll, prev: current, next: M.touch(current, { active: false }, c0) } : null;
    return { coll: c.coll, prev: current, next: M.revert(current, c.prev, c0) };
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

/** Изменения монет при смене статуса задачи (п. 2.6). Пустой массив — если игра выключена или менять нечего. */
function coinChanges(task, done, c0) {
  if (!store.data.settings.gameEnabled && done) return [];
  const e = done ? G.awardEvent(store.data, task, null, c0) : G.revokeEvent(store.data, task.id, null, c0);
  return e ? [{ coll: 'coinEvents', prev: store.data.coinEvents.get(e.id), next: e }] : [];
}

/**
 * Создать задачу. Новые задачи встают в начало своего контейнера («Входящие», список или родитель).
 * input: { title, listIds, parentId, priorityId, scheduledDate, scheduledTime, focus, notes: [строки],
 *          subtasks: [названия], reminders: [Reminder] }
 */
export async function createTask(input) {
  const { title, listIds = [], parentId = null, focus = false, subtasks = [] } = input;
  const today = store.now.today;
  const c0 = ctx();
  const first = S.containerTasks(store.data, listIds[0] || null, parentId)[0];
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
  const reminders = input.reminders ?? R.defaultReminders({ ...input, status: 'active' }, store.data.settings);
  const t = M.newTask({ ...input, reminders, listIds, parentId, focusDate, focusOrder, order: keyBeforeSafe(first?.order) }, c0);
  const changes = [{ coll: 'tasks', prev: undefined, next: t }];
  let order = null;
  for (const st of subtasks) {
    if (!M.normalizeTitle(st)) continue;
    order = keyAfterSafe(order);
    changes.push({ coll: 'tasks', prev: undefined, next: M.newTask({ title: st, parentId: t.id, order }, c0) });
  }
  const ok = await commit(changes);
  return ok ? { task: t, focusRejected } : null;
}

/** Подзадача: новая задача внутри родителя (в конец его подзадач). */
export async function addChild(parentId, title) {
  const err = S.nestError(store.data, '__new__', parentId);
  if (err) {
    showSnackbar(err);
    return null;
  }
  const last = S.containerTasks(store.data, null, parentId).at(-1);
  const t = M.newTask({ title, parentId, order: keyAfterSafe(last?.order) }, ctx());
  return (await commit([{ coll: 'tasks', prev: undefined, next: t }])) ? t : null;
}

/** Правка полей задачи из карточки (без snackbar). */
export async function updateTask(id, changes) {
  return commit([change('tasks', id, (t) => M.touch(t, changes, ctx()))]);
}

/**
 * Выполнить / вернуть. У родителя с невыполненными подзадачами спрашиваем «Выполнить и подзадачи?».
 * Монеты: начисление при выполнении, возврат при снятии отметки (п. 2.6).
 */
export async function toggleComplete(id) {
  const t = getTask(id);
  if (!t) return;
  const c0 = ctx();
  if (t.status === 'done') {
    await commit([change('tasks', id, (x) => M.reopenTask(x, c0)), ...coinChanges(t, false, c0)]);
    return;
  }
  const open = S.descendants(store.data, id).filter((d) => d.status === 'active');
  let withChildren = false;
  if (open.length) {
    const v = await ask({
      title: 'Выполнить и подзадачи?',
      text: `У задачи ${countLabel(open.length, ['невыполненная подзадача', 'невыполненные подзадачи', 'невыполненных подзадач'])}.`,
      buttons: [
        { label: 'Отмена', value: null },
        { label: 'Только задачу', value: 'one' },
        { label: 'Выполнить всё', value: 'all', kind: 'primary' },
      ],
    });
    if (!v) return;
    withChildren = v === 'all';
  }
  const targets = [t, ...(withChildren ? open : [])];
  const changes = [];
  for (const x of targets) {
    changes.push(change('tasks', x.id, (y) => M.completeTask(y, c0)));
    changes.push(...coinChanges(x, true, c0));
  }
  if (await commit(changes)) {
    const coins = changes.filter((c) => c.coll === 'coinEvents').reduce((s, c) => s + (c.next.amount | 0), 0);
    offerUndo(coins && store.data.settings.gameEnabled ? `Выполнено · +${coins} 🪙` : 'Выполнено', changes);
  }
}

export async function reopenTask(id) {
  const t = getTask(id);
  if (!t) return;
  const c0 = ctx();
  const changes = [change('tasks', id, (x) => M.reopenTask(x, c0)), ...coinChanges(t, false, c0)];
  if (await commit(changes)) offerUndo('Задача снова активна', changes);
}

/** В корзину — вместе с подзадачами (одинаковый trashedAt: по нему они восстановятся вместе). */
export async function trashTask(id) {
  const c0 = ctx();
  const at = new Date(c0.now).toISOString();
  const ids = [id, ...S.descendants(store.data, id).map((d) => d.id)];
  const changes = ids.map((x) => change('tasks', x, (y) => M.trashTask(y, c0, at)));
  if (await commit(changes)) offerUndo(ids.length > 1 ? `В корзине вместе с подзадачами (${ids.length - 1})` : 'Перемещено в корзину', changes);
}

export async function restoreTask(id) {
  const t = getTask(id);
  if (!t) return;
  const c0 = ctx();
  const kids = S.descendants(store.data, id, { includeTrash: true }).filter((d) => d.trashedAt && d.trashedAt === t.trashedAt);
  const changes = [t, ...kids].map((x) => change('tasks', x.id, (y) => M.restoreTask(y, c0)));
  if (await commit(changes)) offerUndo('Восстановлено', changes);
}

function withDescendantsForPurge(list) {
  const ids = new Set();
  for (const t of list) {
    ids.add(t.id);
    for (const d of S.descendants(store.data, t.id, { includeTrash: true })) ids.add(d.id);
  }
  return [...ids].map(getTask).filter((t) => t && !t.deletedAt);
}

export async function deleteForever(id) {
  const t = getTask(id);
  if (!t) return false;
  const all = withDescendantsForPurge([t]);
  const ok = await confirm({
    title: 'Удалить задачу навсегда?',
    text: `«${t.title}»${all.length > 1 ? ` и ${countLabel(all.length - 1, ['подзадача', 'подзадачи', 'подзадач'])}` : ''} будут удалены без возможности восстановления.`,
    confirmLabel: 'Удалить навсегда',
    danger: true,
  });
  if (!ok) return false;
  const c0 = ctx();
  await commit(all.map((x) => ({ coll: 'tasks', prev: x, next: M.tombstone(x, c0) })));
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
  await commit(withDescendantsForPurge(list).map((t) => ({ coll: 'tasks', prev: t, next: M.tombstone(t, c0) })));
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
/**
 * Напоминания по умолчанию следуют за датой (п. 2.5): если у задачи ровно те напоминания, что дали бы настройки
 * для старых даты и времени (или никаких, когда даты не было), — заменяем их на подходящие для новых.
 * Напоминания, которые пользователь менял или удалял, не трогаем.
 */
function withDefaultReminders(prev, next, c) {
  if (next === prev) return next;
  const s = store.data.settings;
  const cur = (prev.reminders || []).filter((r) => !r.deletedAt);
  const was = R.defaultReminders(prev, s);
  if (cur.length !== was.length || !cur.every((r, i) => R.sameReminder(r, was[i]))) return next;
  const want = R.defaultReminders(next, s);
  if (want.length === cur.length && want.every((r, i) => R.sameReminder(r, cur[i]))) return next;
  let out = next;
  for (const r of cur) out = M.removeNested(out, 'reminders', r.id, c);
  for (const r of want) out = M.addReminder(out, r, c);
  return out;
}

export async function setSchedule(id, date, time) {  const t = getTask(id);
  if (!t) return;
  const changes = {
    scheduledDate: date,
    scheduledTime: date ? (time === undefined ? t.scheduledTime : time) : null,
  };
  const c = change('tasks', id, (x) => withDefaultReminders(x, M.touch(x, changes, ctx()), ctx()));
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
  const c = change('tasks', id, (x) => withDefaultReminders(x, M.touch(x, changes, ctx()), ctx()));
  if (await commit([c])) {
    offerUndo(date ? `Дедлайн: ${humanDate(date, store.now.today)}${changes.deadlineTime ? ' ' + changes.deadlineTime : ''}` : 'Дедлайн убран', [c]);
  }
}

/** Галочка списка: добавить задачу в список или убрать из него (п. 2.4). */
export async function toggleListMembership(id, listId) {
  const t = getTask(id);
  if (!t) return;
  const now = S.inList(t, listId);
  const c = change('tasks', id, (x) => M.setListMembership(x, listId, !now, ctx()));
  if (await commit([c])) offerUndo(`${now ? 'Убрано из' : 'Добавлено в'} ${listName(listId)}`, [c]);
}

/** Убрать из всех списков — задача уходит во «Входящие». */
export async function clearLists(id) {
  const t = getTask(id);
  if (!t) return;
  const c0 = ctx();
  const c = change('tasks', id, (x) => M.taskListIds(x).reduce((y, l) => M.setListMembership(y, l, false, c0), x));
  if (await commit([c])) offerUndo('Перемещено в «Входящие»', [c]);
}

/** Совместимость: «перенести в список» = только этот список (меню строки, быстрые действия «Входящих»). */
export async function moveToList(id, listId) {
  const t = getTask(id);
  if (!t) return;
  const c0 = ctx();
  const c = change('tasks', id, (x) => {
    let y = x;
    for (const l of M.taskListIds(x)) if (l !== listId) y = M.setListMembership(y, l, false, c0);
    return listId ? M.setListMembership(y, listId, true, c0) : y;
  });
  if (await commit([c])) offerUndo(`Перемещено в ${listName(listId)}`, [c]);
}

/** Смена приоритета. У уже выполненной задачи с начислением — пересчитываем монеты по новому приоритету. */
export async function setPriority(id, priorityId) {
  const c0 = ctx();
  const c = change('tasks', id, (x) => M.touch(x, { priorityId }, c0));
  if (!c) return;
  const ev = store.data.coinEvents.get(G.awardId(id));
  const coins = c.next.status === 'done' && ev && !ev.deletedAt && ev.active ? coinChanges(c.next, true, c0) : [];
  await commit([c, ...coins]);
}

// ---------- Напоминания (п. 2.5) ----------

export async function addReminder(id, r) {
  const t = getTask(id);
  if (!t) return;
  const cur = (t.reminders || []).filter((x) => !x.deletedAt);
  if (cur.some((x) => R.sameReminder(x, r))) return showSnackbar('Такое напоминание уже есть');
  if (cur.length >= R.MAX_REMINDERS) return showSnackbar(`Не больше ${R.MAX_REMINDERS} напоминаний у задачи`);
  await commit([change('tasks', id, (x) => M.addReminder(x, r, ctx()))]);
}

export async function removeReminder(id, remId) {
  const c = change('tasks', id, (x) => M.removeNested(x, 'reminders', remId, ctx()));
  if (await commit([c])) offerUndo('Напоминание удалено', [c]);
}

/** «Напоминать, пока не отмечу»: { enabled, intervalMinutes }. */
export async function setNag(id, nag) {
  const t = getTask(id);
  if (!t) return;
  const next = { enabled: !!nag.enabled, intervalMinutes: Math.min(1440, Math.max(5, nag.intervalMinutes | 0 || 15)) };
  await commit([change('tasks', id, (x) => M.touch(x, { nag: next }, ctx()))]);
}

// ---------- Заметки (п. 2.2) ----------

export async function addNote(id, text = '') {
  const t = getTask(id);
  if (!t) return null;
  const last = M.liveNotes(t).at(-1);
  const c = change('tasks', id, (x) => M.addNote(x, text, keyAfterSafe(last?.order), ctx()));
  if (!(await commit([c]))) return null;
  return M.liveNotes(getTask(id)).at(-1)?.id ?? null;
}

export async function updateNote(id, noteId, text) {
  return commit([change('tasks', id, (x) => M.touchNested(x, 'notes', noteId, { text: M.normalizeNote(text) }, ctx()))]);
}

export async function deleteNote(id, noteId) {
  const c = change('tasks', id, (x) => M.removeNested(x, 'notes', noteId, ctx()));
  if (await commit([c])) offerUndo('Заметка удалена', [c]);
}

export async function reorderNote(id, noteId, index) {
  const notes = M.liveNotes(getTask(id)).filter((n) => n.id !== noteId);
  let key;
  try {
    key = keyForIndex(notes, Math.max(0, Math.min(index, notes.length)));
  } catch (e) {
    reportError(e);
    return;
  }
  await commit([change('tasks', id, (x) => M.touchNested(x, 'notes', noteId, { order: key }, ctx()))]);
}

// ---------- Вложенные задачи (п. 2.8) ----------

/**
 * Перемещение в дереве (обновление 0.4) — общий путь для перетаскивания, клавиш и меню: родитель, порядок,
 * списки (и у подзадач), правило ★ — одним действием с «Отменить». Расчёт — core/treeDrop.js.
 */
export async function moveTask(move, text = 'Перемещено') {
  if (!move || !getTask(move.id)) return false;
  if (move.parentId) {
    const err = S.nestError(store.data, move.id, move.parentId);
    if (err) {
      showSnackbar(err);
      return false;
    }
  }
  const changes = T.applyDrop(store.data, move, ctx(), { today: store.now.today });
  if (!changes.length) return false;
  const ok = await commit(changes);
  if (ok) offerUndo(text, changes);
  return ok;
}

/** Меню задачи: «Сделать подзадачей…» (в конец подзадач) и «Вынести на верхний уровень» (сразу после родителя). */
export async function setParent(id, parentId) {
  const move = T.menuMove(store.data, id, parentId);
  if (!move) return false;
  return moveTask(move, parentId ? `Теперь подзадача «${getTask(parentId)?.title ?? ''}»` : 'Вынесено на верхний уровень');
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
  // ★ — только у задач верхнего уровня (обновление 0.4): лимит «Главного» считается по ним
  const parent = S.parentOf(store.data, t);
  if (parent) {
    showSnackbar(`★ ставится задачам верхнего уровня — отметь «${parent.title}»`);
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

export async function duplicateTask(id) {
  const t = getTask(id);
  if (!t) return null;
  const siblings = S.containerTasks(store.data, M.taskListIds(t)[0] || null, t.parentId || null);
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

/** «+ Новый список» в выпадашке «Список»: создать и сразу добавить туда задачу (п. 2.4). */
export async function createListAndAdd(taskId, name) {
  const palette = ['#E53935', '#FB8C00', '#43A047', '#00897B', '#1E88E5', '#3949AB', '#8E24AA', '#D81B60'];
  const l = await createList({ name, color: palette[store.data.lists.size % palette.length], emoji: null });
  if (l && taskId) await commit([change('tasks', taskId, (x) => M.setListMembership(x, l.id, true, ctx()))]);
  return l;
}

// ---------- Приоритеты (п. 2.6, 2.9) ----------

export async function createPriority({ name, color, coins }) {
  const all = [...S.sortedPriorities(store.data), ...S.sortedPriorities(store.data, { archived: true })]
    .sort((a, b) => (a.order < b.order ? -1 : 1));
  const p = M.newPriority({ name, color, coins, order: keyAfterSafe(all.at(-1)?.order) }, ctx());
  return (await commit([{ coll: 'priorities', prev: undefined, next: p }])) ? p : null;
}

export async function updatePriority(id, changes) {
  return commit([change('priorities', id, (p) => M.touch(p, changes, ctx()))]);
}

export async function reorderPriority(id, siblings, index) {
  const rest = siblings.filter((x) => x.id !== id);
  let key;
  try {
    key = keyForIndex(rest, Math.max(0, Math.min(index, rest.length)));
  } catch (e) {
    reportError(e);
    return;
  }
  await commit([change('priorities', id, (x) => M.touch(x, { order: key }, ctx()))]);
}

/** Удалить можно только неиспользуемый приоритет; используемый — только в архив. */
export async function deletePriority(id) {
  if (S.priorityInUse(store.data, id)) {
    showSnackbar('Приоритет используется задачами — его можно только архивировать');
    return false;
  }
  const p = store.data.priorities.get(id);
  const ok = await confirm({ title: `Удалить приоритет «${p?.name}»?`, text: 'Он не используется ни одной задачей.', confirmLabel: 'Удалить', danger: true });
  if (!ok) return false;
  return commit([change('priorities', id, (x) => M.tombstone(x, ctx()))]);
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

// ---------- Игра: магазин (п. 2.6) ----------

const byOrder = (a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0);

export async function createReward({ name, emoji, price, repeatable }) {
  const all = [...store.data.rewards.values()].filter((r) => !r.deletedAt).sort(byOrder);
  const r = M.newReward({ name, emoji: emoji || null, price, repeatable, order: keyAfterSafe(all.at(-1)?.order) }, ctx());
  return (await commit([{ coll: 'rewards', prev: undefined, next: r }])) ? r : null;
}

export async function updateReward(id, changes) {
  return commit([change('rewards', id, (r) => M.touch(r, changes, ctx()))]);
}

/** Удалить награду. Если её уже покупали — только в архив (история покупок ссылается на неё). */
export async function deleteReward(id) {
  if (G.purchasedCount(store.data, id) > 0) return updateReward(id, { archived: true });
  const c = change('rewards', id, (r) => M.tombstone(r, ctx()));
  if (await commit([c])) offerUndo('Награда удалена', [c]);
  return true;
}

/** Покупка: спрашиваем подтверждение, в минус уйти нельзя. */
async function buy({ price, title, rewardId = null, itemId = null }) {
  const bal = G.balance(store.data);
  if (price > bal) {
    showSnackbar(`Не хватает ${price - bal} 🪙`);
    return false;
  }
  const ok = await confirm({ title: `Купить «${title}»?`, text: `Спишется ${price} 🪙. Останется ${bal - price} 🪙.`, confirmLabel: 'Купить' });
  if (!ok) return false;
  if (price > G.balance(store.data)) return false; // пока думали, баланс мог измениться (пулл)
  const e = G.purchaseEvent({ price, title, rewardId, itemId }, ctx());
  if (!(await commit([{ coll: 'coinEvents', prev: undefined, next: e }]))) return false;
  showSnackbar(`Куплено: ${title} · −${price} 🪙`);
  return true;
}

export async function buyReward(id) {
  const r = getEntity('rewards', id);
  if (!r || r.deletedAt || r.archived) return false;
  if (!r.repeatable && G.purchasedCount(store.data, id) > 0) {
    showSnackbar('Эта награда одноразовая и уже куплена');
    return false;
  }
  return buy({ price: r.price, title: (r.emoji ? r.emoji + ' ' : '') + r.name, rewardId: id });
}

export async function buyCosmetic(itemId) {
  const item = G.COSMETICS.find((x) => x.id === itemId);
  if (!item || G.ownsItem(store.data, itemId)) return false;
  return buy({ price: item.price, title: item.name, itemId });
}

/** Возврат покупки: событие становится неактивным, монеты возвращаются (косметика перестаёт быть купленной). */
export async function refundPurchase(eventId) {
  const e = store.data.coinEvents.get(eventId);
  if (!e || e.deletedAt || e.type !== 'purchase' || !e.active) return false;
  const ok = await confirm({ title: `Вернуть «${e.title}»?`, text: `Вернётся ${Math.abs(e.amount)} 🪙.`, confirmLabel: 'Вернуть' });
  if (!ok) return false;
  return commit([change('coinEvents', eventId, (x) => M.touch(x, { active: false, at: new Date(Date.now()).toISOString() }, ctx()))]);
}

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
