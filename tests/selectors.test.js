import { nestError, descendants, progressOf, depthOf, MAX_DEPTH, isRoot, taskLists } from '../src/core/selectors.js';
import { setListMembership } from '../src/core/model.js';
import { test, assert } from './runner.js';
import { makeCtx, makeData, addTask } from './helpers.js';
import { touch, tombstone, newList } from '../src/core/model.js';
import {
  todayView, inboxView, listView, archiveView, trashView, expiredTrash, activeCounts, isOverdue, focusTasks,
  listHasTasks,
} from '../src/core/selectors.js';
import { DEFAULT_LISTS } from '../src/config.js';

const [PERESDACHA, UNIVER, , , DOM] = DEFAULT_LISTS.map((l) => l.id);
const TODAY = '2026-10-02';
const TIME = '12:00';
const NOW = Date.parse('2026-10-02T09:00:00.000Z'); // 12:00 по Москве

function fixture() {
  const c = makeCtx(NOW);
  const d = makeData();
  const t = {};
  t.inbox = addTask(d, c, { title: 'Без даты во входящих' });
  t.today = addTask(d, c, { title: 'Сегодня, Универ', listIds: [UNIVER], scheduledDate: TODAY });
  t.todayTimed = addTask(d, c, { title: 'Сегодня 09:00', listIds: [UNIVER], scheduledDate: TODAY, scheduledTime: '09:00' });
  t.yesterday = addTask(d, c, { title: 'Вчерашняя', listIds: [PERESDACHA], scheduledDate: '2026-10-01' });
  t.deadlinePassed = addTask(d, c, { title: 'Дедлайн сегодня 10:00', deadlineDate: TODAY, deadlineTime: '10:00' });
  t.deadlineLater = addTask(d, c, { title: 'Дедлайн сегодня 15:00', deadlineDate: TODAY, deadlineTime: '15:00' });
  t.choreToday = addTask(d, c, { title: 'Пропылесосить', listIds: [DOM], scheduledDate: TODAY });
  t.choreOverdue = addTask(d, c, { title: 'Вынести мусор', listIds: [DOM], scheduledDate: '2026-09-30' });
  t.choreNoDate = addTask(d, c, { title: 'Купить лампочку', listIds: [DOM] });
  t.focus = addTask(d, c, { title: 'Главная', listIds: [PERESDACHA] }, { focusDate: TODAY, focusOrder: 'a1' });
  t.focus2 = addTask(d, c, { title: 'Главная 2' }, { focusDate: TODAY, focusOrder: 'a0' });
  t.focusYesterday = addTask(d, c, { title: 'Вчерашняя главная' }, { focusDate: '2026-10-01', focusOrder: 'a0' });
  t.doneToday = addTask(d, c, { title: 'Сделано сегодня', listIds: [UNIVER] }, { status: 'done', completedAt: '2026-10-02T07:00:00.000Z' });
  t.doneYesterday = addTask(d, c, { title: 'Сделано вчера', listIds: [UNIVER] }, { status: 'done', completedAt: '2026-10-01T07:00:00.000Z' });
  t.soon = addTask(d, c, { title: 'Дедлайн через 2 дня', listIds: [UNIVER], deadlineDate: '2026-10-04' });
  t.far = addTask(d, c, { title: 'Дедлайн через 10 дней', listIds: [UNIVER], deadlineDate: '2026-10-12' });
  t.future = addTask(d, c, { title: 'Завтра', scheduledDate: '2026-10-03' });
  t.trashed = addTask(d, c, { title: 'В корзине', scheduledDate: TODAY }, { trashedAt: '2026-10-02T06:00:00.000Z' });
  const archived = touch(newList({ name: 'Старое', color: '#757575', emoji: null, order: 'a9' }, c), { archived: true }, c);
  d.lists.set(archived.id, archived);
  t.inArchivedList = addTask(d, c, { title: 'В архивном списке', listIds: [archived.id], scheduledDate: TODAY });
  t.missingList = addTask(d, c, { title: 'Список удалён', listIds: ['01926f00-0000-7000-8000-00000000dead'] });
  const deleted = tombstone(addTask(d, c, { title: 'Удалённая навсегда', scheduledDate: TODAY }), c);
  d.tasks.set(deleted.id, deleted);
  return { d, t, archived };
}

const ids = (list) => list.map((x) => x.title);

test('Сегодня: состав блоков (TZ §6.2)', () => {
  const { d } = fixture();
  const v = todayView(d, TODAY, TIME, NOW);
  assert.deepEqual(ids(v.focus), ['Главная 2', 'Главная'], 'главные по focusOrder');
  assert.deepEqual(ids(v.overdue), ['Вчерашняя', 'Дедлайн сегодня 10:00']);
  assert.deepEqual(ids(v.today), ['Сегодня 09:00', 'Дедлайн сегодня 15:00', 'Сегодня, Универ'], 'со временем — первыми');
  assert.deepEqual(ids(v.soon), ['Дедлайн через 2 дня']);
  assert.deepEqual(ids(v.chores), ['Вынести мусор', 'Пропылесосить'], 'в «Быте» просроченные первыми');
  assert.deepEqual(ids(v.doneToday), ['Сделано сегодня']);
  assert.deepEqual(ids(v.yesterdayFocus), ['Вчерашняя главная']);
});

test('AC-6.2.1: задача без даты и без ★ не попадает в «Сегодня»', () => {
  const { d } = fixture();
  const v = todayView(d, TODAY, TIME, NOW);
  const all = [...v.focus, ...v.overdue, ...v.today, ...v.soon, ...v.chores, ...v.doneToday].map((x) => x.title);
  for (const name of ['Без даты во входящих', 'Купить лампочку', 'Завтра', 'Дедлайн через 10 дней', 'В корзине',
    'В архивном списке', 'Удалённая навсегда', 'Список удалён']) {
    assert.ok(!all.includes(name), name);
  }
});

test('AC-6.2.2: задача из «Дома» на сегодня — только в «Быте»', () => {
  const { d } = fixture();
  const v = todayView(d, TODAY, TIME, NOW);
  assert.ok(!ids(v.today).includes('Пропылесосить'));
  assert.ok(!ids(v.overdue).includes('Вынести мусор'));
  d.settings = touch(d.settings, { choresListId: null }, makeCtx());
  const v2 = todayView(d, TODAY, TIME, NOW);
  assert.ok(ids(v2.today).includes('Пропылесосить'), 'без «Быта» — обычная задача');
});

test('Просрочка: дедлайн со временем, дата в прошлом, время сегодня не просрочка', () => {
  const { t } = fixture();
  assert.ok(isOverdue(t.deadlinePassed, TODAY, '10:00'), 'в 10:00 уже просрочена');
  assert.ok(!isOverdue(t.deadlinePassed, TODAY, '09:59'));
  assert.ok(isOverdue(t.yesterday, TODAY, '00:00'));
  assert.ok(!isOverdue(t.todayTimed, TODAY, '23:00'), 'время сегодня прошло — это не просрочка');
  assert.ok(!isOverdue(t.doneToday, TODAY, TIME));
});

test('Входящие: без списка и с удалённым списком, без выполненных и корзины', () => {
  const { d } = fixture();
  const names = ids(inboxView(d));
  for (const n of ['Без даты во входящих', 'Дедлайн сегодня 10:00', 'Главная 2', 'Завтра', 'Список удалён']) assert.ok(names.includes(n), n);
  assert.ok(!names.includes('В корзине'));
  assert.ok(!names.includes('Сегодня, Универ'));
});

test('Экран списка: секции', () => {
  const { d } = fixture();
  const v = listView(d, UNIVER);
  assert.deepEqual(ids(v.scheduled), ['Сегодня 09:00', 'Сегодня, Универ', 'Дедлайн через 2 дня', 'Дедлайн через 10 дней']);
  assert.deepEqual(ids(v.done), ['Сделано сегодня', 'Сделано вчера']);
  assert.equal(v.doneCount, 2);
});

test('Архив, корзина, автоочистка корзины', () => {
  const { d } = fixture();
  assert.deepEqual(ids(archiveView(d)), ['Сделано сегодня', 'Сделано вчера']);
  assert.deepEqual(ids(archiveView(d, 'inbox')), []);
  assert.deepEqual(ids(trashView(d)), ['В корзине']);
  assert.deepEqual(expiredTrash(d, NOW), []);
  assert.deepEqual(ids(expiredTrash(d, NOW + 31 * 86400000)), ['В корзине']);
});

test('Счётчики, главные, удаление списка', () => {
  const { d, archived } = fixture();
  const m = activeCounts(d);
  assert.equal(m.get(UNIVER), 4, 'выполненные не считаются');
  assert.equal(m.get(DOM), 3);
  assert.ok(m.get('inbox') >= 6);
  assert.equal(focusTasks(d, TODAY).length, 2);
  assert.ok(listHasTasks(d, archived.id));
  assert.ok(!listHasTasks(d, DEFAULT_LISTS[2].id), 'YouTube пустой');
});

// ---------- v2: несколько списков и дерево подзадач ----------


test('v2: задача в нескольких списках; в «Доме» — значит в «Быте», даже если ещё и в «Универе»', () => {
  const c = makeCtx(NOW);
  const d = makeData();
  const t = addTask(d, c, { title: 'Купить тетради', listIds: [UNIVER, DOM], scheduledDate: TODAY });
  assert.deepEqual(taskLists(d, t).map((l) => l.name), ['Универ', 'Дом']);
  const v = todayView(d, TODAY, TIME, NOW);
  assert.deepEqual(ids(v.chores), ['Купить тетради']);
  assert.deepEqual(ids(v.today), []);
  const m = activeCounts(d);
  assert.equal(m.get(UNIVER), 1);
  assert.equal(m.get(DOM), 1);
  const out = setListMembership(setListMembership(t, UNIVER, false, c), DOM, false, c);
  d.tasks.set(out.id, out);
  assert.deepEqual(ids(inboxView(d)), ['Купить тетради'], 'без списков — во «Входящих»');
});

test('v2: подзадачи — дерево, прогресс, «Входящие» показывают только корни', () => {
  const c = makeCtx(NOW);
  const d = makeData();
  const p = addTask(d, c, { title: 'Видео' });
  const a = addTask(d, c, { title: 'Сценарий', parentId: p.id }, { status: 'done' });
  const b = addTask(d, c, { title: 'Монтаж', parentId: p.id, scheduledDate: TODAY });
  addTask(d, c, { title: 'Цветокор', parentId: b.id });
  assert.deepEqual(ids(inboxView(d)), ['Видео']);
  assert.deepEqual(progressOf(d, p.id), { done: 1, total: 2 });
  assert.equal(descendants(d, p.id).length, 3);
  assert.equal(depthOf(d, d.tasks.get(b.id)), 2);
  assert.ok(!isRoot(d, a));
  assert.deepEqual(ids(todayView(d, TODAY, TIME, NOW).today), ['Монтаж'], 'подзадача с датой — на «Сегодня»');
});

test('v2: вложение — без циклов, не в саму себя, глубина не больше MAX_DEPTH', () => {
  const c = makeCtx(NOW);
  const d = makeData();
  const chain = [addTask(d, c, { title: 'L1' })];
  for (let i = 2; i <= MAX_DEPTH; i++) chain.push(addTask(d, c, { title: 'L' + i, parentId: chain.at(-1).id }));
  const free = addTask(d, c, { title: 'Свободная' });
  assert.equal(nestError(d, chain[0].id, chain[0].id), 'Задачу нельзя вложить саму в себя');
  assert.ok(/её же подзадачу/.test(nestError(d, chain[0].id, chain[2].id)), 'цикл');
  assert.ok(/не больше/.test(nestError(d, free.id, chain.at(-1).id)), 'пятый уровень');
  assert.equal(nestError(d, free.id, chain[1].id), null);
  assert.equal(nestError(d, chain[1].id, free.id), null, 'поддерево из 3 уровней под корень = 4 уровня — можно');
  assert.ok(/не больше/.test(nestError(d, chain[0].id, free.id)), 'поддерево из 4 уровней под корень = 5 — нельзя');
});

test('v2: корзина — подзадачи, ушедшие вместе с родителем, не показываются отдельно', () => {
  const c = makeCtx(NOW);
  const d = makeData();
  const at = '2026-10-02T06:00:00.000Z';
  const p = addTask(d, c, { title: 'Родитель' }, { trashedAt: at });
  addTask(d, c, { title: 'Ребёнок', parentId: p.id }, { trashedAt: at });
  addTask(d, c, { title: 'Отдельно', parentId: p.id }, { trashedAt: '2026-10-01T06:00:00.000Z' });
  assert.deepEqual(ids(trashView(d)).sort(), ['Отдельно', 'Родитель']);
});

test('v2: цикл после слияния (A под B и B под A) — обе задачи на верхнем уровне, обход не зацикливается', () => {
  const c = makeCtx();
  const d = makeData();
  const a = addTask(d, c, { title: 'A' });
  const b = addTask(d, c, { title: 'B' });
  d.tasks.set(a.id, { ...a, parentId: b.id });
  d.tasks.set(b.id, { ...b, parentId: a.id });
  assert.ok(isRoot(d, d.tasks.get(a.id)));
  assert.ok(isRoot(d, d.tasks.get(b.id)));
  assert.equal(descendants(d, a.id).length, 0);
  assert.equal(depthOf(d, d.tasks.get(a.id)), 1);
  assert.equal(inboxView(d).filter((t) => t.id === a.id || t.id === b.id).length, 2);
});