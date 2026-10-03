import { test, assert } from './runner.js';
import { makeCtx, DEVICE } from './helpers.js';
import {
  newTask, touch, revert, tombstone, completeTask, reopenTask, trashTask, restoreTask, normalizeTitle,
  normalizeListName, firstGrapheme, defaultLists, defaultSettings, TASK_FIELDS, newList, duplicateTask,
  taskListIds, liveNotes, setListMembership, addNote, touchNested, removeNested,
} from '../src/core/model.js';
import { DEFAULT_LISTS, SETTINGS_ID } from '../src/config.js';
import { UUID_RE } from '../src/core/ids.js';

test('newTask: все поля по DATA_FORMAT §5.3, у всех изменяемых полей одна метка', () => {
  const c = makeCtx();
  const t = newTask({ title: '  Смонтировать   0:00–3:00 ', order: 'a0' }, c);
  assert.ok(UUID_RE.test(t.id));
  assert.equal(t.title, 'Смонтировать 0:00–3:00');
  assert.equal(t.status, 'active');
  assert.deepEqual(t.lists, {});
  assert.equal(t.parentId, null);
  assert.equal(t.priorityId, '00000000-0000-7000-8000-000000000200');
  assert.equal(t.deletedAt, null);
  assert.equal(t.updatedBy, DEVICE);
  assert.deepEqual(Object.keys(t.fieldTimes).sort(), [...TASK_FIELDS].sort());
  const stamps = new Set(Object.values(t.fieldTimes));
  assert.equal(stamps.size, 1);
  assert.deepEqual([t.notes, t.attachments, t.reminders, t.occurrences], [[], [], [], {}]);
});

test('newTask: пустое название — исключение; время без даты не сохраняется', () => {
  const c = makeCtx();
  assert.throws(() => newTask({ title: '   ' }, c));
  const t = newTask({ title: 'x', scheduledTime: '10:00' }, c);
  assert.equal(t.scheduledTime, null);
});

test('touch: метка только у изменённых полей; без изменений — тот же объект', () => {
  const c = makeCtx();
  const t = newTask({ title: 'A', order: 'a0' }, c);
  const before = { ...t.fieldTimes };
  c.now += 1000;
  const t2 = touch(t, { title: 'B', scheduledDate: null }, c);
  assert.equal(t2.title, 'B');
  assert.ok(t2.fieldTimes.title > before.title);
  assert.equal(t2.fieldTimes.scheduledDate, before.scheduledDate, 'scheduledDate не менялась');
  assert.equal(t2.updatedAt, new Date(c.now).toISOString());
  assert.equal(touch(t2, { title: 'B' }, c), t2);
});

test('touch: служебные поля менять нельзя', () => {
  const c = makeCtx();
  const t = newTask({ title: 'A' }, c);
  assert.throws(() => touch(t, { id: 'x' }, c));
  assert.throws(() => touch(t, { subtasks: [] }, c));
});

test('неизвестные поля переживают правки (DATA_FORMAT §1)', () => {
  const c = makeCtx();
  const t = { ...newTask({ title: 'A' }, c), x_future: { a: 1 } };
  const t2 = completeTask(touch(t, { title: 'B' }, c), c);
  assert.deepEqual(t2.x_future, { a: 1 });
});

test('complete / reopen / trash / restore', () => {
  const c = makeCtx();
  let t = newTask({ title: 'A' }, c);
  t = completeTask(t, c);
  assert.equal(t.status, 'done');
  assert.ok(t.completedAt);
  t = reopenTask(t, c);
  assert.equal(t.status, 'active');
  assert.equal(t.completedAt, null);
  t = trashTask(t, c);
  assert.ok(t.trashedAt);
  assert.equal(t.status, 'active', 'корзина не меняет статус (D-10)');
  t = restoreTask(t, c);
  assert.equal(t.trashedAt, null);
});

test('revert: возвращает значения с НОВЫМИ метками (для «Отменить»)', () => {
  const c = makeCtx();
  const t0 = newTask({ title: 'A' }, c);
  const t1 = completeTask(t0, c);
  const t2 = revert(t1, t0, c);
  assert.equal(t2.status, 'active');
  assert.equal(t2.completedAt, null);
  assert.ok(t2.fieldTimes.status > t1.fieldTimes.status);
});

test('tombstone: только id, даты и метка deletedAt', () => {
  const c = makeCtx();
  const t = tombstone({ ...newTask({ title: 'A', notes: ['секрет'] }, c), x_future: 1 }, c);
  assert.deepEqual(Object.keys(t).sort(), ['createdAt', 'deletedAt', 'fieldTimes', 'id', 'updatedAt', 'updatedBy']);
  assert.deepEqual(Object.keys(t.fieldTimes), ['deletedAt']);
});

test('нормализация ввода', () => {
  assert.equal(normalizeTitle(' a \n b\t'), 'a b');
  assert.equal(normalizeTitle('x'.repeat(600)).length, 500);
  assert.equal(normalizeListName('  Спорт  и  зал '), 'Спорт и зал');
  assert.equal(firstGrapheme('👨‍👩‍👧 семья'), '👨‍👩‍👧');
  assert.equal(firstGrapheme('  '), null);
});

test('списки и настройки по умолчанию: фиксированные id, минимальные метки', () => {
  const lists = defaultLists();
  assert.deepEqual(lists.map((l) => l.id), DEFAULT_LISTS.map((l) => l.id));
  assert.deepEqual(lists.map((l) => l.name), ['Пересдача', 'Универ', 'YouTube', 'Игра', 'Дом']);
  assert.ok(lists.every((l) => Object.values(l.fieldTimes).every((t) => t === 1)));
  const s = defaultSettings('Europe/Moscow');
  assert.equal(s.id, SETTINGS_ID);
  assert.equal(s.choresListId, DEFAULT_LISTS[4].id);
  assert.equal(s.photoMaxSide, 1600);
});

test('newList и duplicateTask', () => {
  const c = makeCtx();
  const l = newList({ name: 'Спорт', color: '#43A047', emoji: '💪', order: 'a5' }, c);
  assert.equal(l.archived, false);
  const t = newTask({ title: 'Бег', listIds: [l.id], priorityId: '00000000-0000-7000-8000-000000000202', notes: ['утром'] }, c);
  const d = duplicateTask(t, 'a1', c);
  assert.ok(d.id !== t.id);
  assert.equal(d.title, 'Бег (копия)');
  assert.deepEqual(taskListIds(d), [l.id]);
  assert.equal(d.priorityId, '00000000-0000-7000-8000-000000000202');
  assert.deepEqual(liveNotes(d).map((n) => n.text), ['утром']);
});

test('v2: членство в списках — словарь с меткой на каждый список; снятие оставляет запись in=false', () => {
  const c = makeCtx();
  let t = newTask({ title: 'A', listIds: ['L1'] }, c);
  assert.deepEqual(taskListIds(t), ['L1']);
  const t1 = t.lists.L1.t;
  t = setListMembership(t, 'L2', true, c);
  assert.deepEqual(taskListIds(t).sort(), ['L1', 'L2']);
  assert.equal(t.lists.L1.t, t1, 'метка L1 не изменилась');
  t = setListMembership(t, 'L1', false, c);
  assert.deepEqual(taskListIds(t), ['L2']);
  assert.equal(t.lists.L1.in, false);
  assert.equal(setListMembership(t, 'L1', false, c), t, 'без изменений — тот же объект');
});

test('v2: заметки — отдельные элементы со своими id и метками; удаление — надгробие элемента', () => {
  const c = makeCtx();
  let t = newTask({ title: 'A', notes: ['первая', '', 'вторая'] }, c);
  assert.deepEqual(liveNotes(t).map((n) => n.text), ['первая', 'вторая'], 'пустые заметки не создаются');
  const [n1, n2] = liveNotes(t);
  assert.ok(n1.id !== n2.id && n1.updatedAt && n1.createdAt);
  t = addNote(t, 'третья', 'a9', c);
  const before = liveNotes(t).find((n) => n.id === n1.id).fieldTimes.text;
  t = touchNested(t, 'notes', n2.id, { text: 'вторая, правка' }, c);
  assert.equal(liveNotes(t).find((n) => n.id === n1.id).fieldTimes.text, before, 'другие заметки не тронуты');
  t = removeNested(t, 'notes', n1.id, c);
  assert.deepEqual(liveNotes(t).map((n) => n.text), ['вторая, правка', 'третья']);
  assert.ok(t.notes.find((n) => n.id === n1.id).deletedAt);
});

test('v2: revert возвращает членство в списках и заметки новыми метками', () => {
  const c = makeCtx();
  const t0 = newTask({ title: 'A', listIds: ['L1'], notes: ['x'] }, c);
  let t1 = setListMembership(setListMembership(t0, 'L1', false, c), 'L2', true, c);
  t1 = touchNested(t1, 'notes', liveNotes(t0)[0].id, { text: 'y' }, c);
  const r = revert(t1, t0, c);
  assert.deepEqual(taskListIds(r), ['L1']);
  assert.equal(r.lists.L2.in, false);
  assert.ok(r.lists.L1.t > t1.lists.L1.t, 'новая метка');
  assert.deepEqual(liveNotes(r).map((n) => n.text), ['x']);
});