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
  t.today = addTask(d, c, { title: 'Сегодня, Универ', listId: UNIVER, scheduledDate: TODAY });
  t.todayTimed = addTask(d, c, { title: 'Сегодня 09:00', listId: UNIVER, scheduledDate: TODAY, scheduledTime: '09:00' });
  t.yesterday = addTask(d, c, { title: 'Вчерашняя', listId: PERESDACHA, scheduledDate: '2026-10-01' });
  t.deadlinePassed = addTask(d, c, { title: 'Дедлайн сегодня 10:00', deadlineDate: TODAY, deadlineTime: '10:00' });
  t.deadlineLater = addTask(d, c, { title: 'Дедлайн сегодня 15:00', deadlineDate: TODAY, deadlineTime: '15:00' });
  t.choreToday = addTask(d, c, { title: 'Пропылесосить', listId: DOM, scheduledDate: TODAY });
  t.choreOverdue = addTask(d, c, { title: 'Вынести мусор', listId: DOM, scheduledDate: '2026-09-30' });
  t.choreNoDate = addTask(d, c, { title: 'Купить лампочку', listId: DOM });
  t.focus = addTask(d, c, { title: 'Главная', listId: PERESDACHA }, { focusDate: TODAY, focusOrder: 'a1' });
  t.focus2 = addTask(d, c, { title: 'Главная 2' }, { focusDate: TODAY, focusOrder: 'a0' });
  t.focusYesterday = addTask(d, c, { title: 'Вчерашняя главная' }, { focusDate: '2026-10-01', focusOrder: 'a0' });
  t.doneToday = addTask(d, c, { title: 'Сделано сегодня', listId: UNIVER }, { status: 'done', completedAt: '2026-10-02T07:00:00.000Z' });
  t.doneYesterday = addTask(d, c, { title: 'Сделано вчера', listId: UNIVER }, { status: 'done', completedAt: '2026-10-01T07:00:00.000Z' });
  t.soon = addTask(d, c, { title: 'Дедлайн через 2 дня', listId: UNIVER, deadlineDate: '2026-10-04' });
  t.far = addTask(d, c, { title: 'Дедлайн через 10 дней', listId: UNIVER, deadlineDate: '2026-10-12' });
  t.future = addTask(d, c, { title: 'Завтра', scheduledDate: '2026-10-03' });
  t.trashed = addTask(d, c, { title: 'В корзине', scheduledDate: TODAY }, { trashedAt: '2026-10-02T06:00:00.000Z' });
  const archived = touch(newList({ name: 'Старое', color: '#757575', emoji: null, order: 'a9' }, c), { archived: true }, c);
  d.lists.set(archived.id, archived);
  t.inArchivedList = addTask(d, c, { title: 'В архивном списке', listId: archived.id, scheduledDate: TODAY });
  t.missingList = addTask(d, c, { title: 'Список удалён', listId: '01926f00-0000-7000-8000-00000000dead' });
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
