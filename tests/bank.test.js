// Банк задач и «Поиск» на четыре вкладки (обновление 0.15).

import { test, assert } from './runner.js';
import { makeCtx, makeData, addTask } from './helpers.js';
import * as BK from '../src/core/bank.js';
import { addNote, completeTask, trashTask, tombstone, touch } from '../src/core/model.js';
import { mergeEntity, MERGE_COLLECTIONS } from '../src/core/merge.js';
import { makeRule, closeOccurrence, reopenOccurrence, currentKey } from '../src/core/repeat.js';
import { todayView } from '../src/core/selectors.js';
import { rowsOf, fieldChips, KINDS, PLACEHOLDER, LIVE_KINDS, makeContext, search } from '../src/core/explore.js';
import { COLLECTIONS } from '../src/data/envelope.js';
import { PRIORITY_NONE_ID } from '../src/core/priorities.js';

const NOW = Date.parse('2026-10-06T09:00:00.000Z'); // вторник, 12:00 в Москве
const TODAY = '2026-10-06';
const HOME = '00000000-0000-7000-8000-000000000105';
const PERESDACHA = '00000000-0000-7000-8000-000000000101';
const HIGH = '00000000-0000-7000-8000-000000000203';

const put = (d, t) => (d.templates.set(t.id, t), t);

test('заготовка: чистые поля — списки без повторов, время ЧЧ:ММ, напоминания без своей даты и дедлайна', () => {
  const f = BK.cleanTemplate({
    title: '  Сходить   в аптеку ', listIds: [HOME, HOME, '', 5], time: '25:00',
    reminderRules: [{ kind: 'relative', anchor: 'scheduled', offsetMinutes: 30 }, { kind: 'timeOfDay', time: '09:00' },
      { kind: 'absolute', at: '2026-10-01T10:00' }, { kind: 'relative', anchor: 'deadline', offsetMinutes: 60 }, { kind: 'timeOfDay', time: 'x' }],
    subtaskTitles: [' рецепт ', '', 'пакет'], noteTexts: ['a\r\nb'], focus: 1,
  });
  assert.equal(f.title, 'Сходить в аптеку');
  assert.deepEqual(f.listIds, [HOME]);
  assert.equal(f.time, null);
  assert.equal(f.priorityId, PRIORITY_NONE_ID);
  assert.deepEqual(f.reminderRules, [{ kind: 'relative', anchor: 'scheduled', offsetMinutes: 30 }, { kind: 'timeOfDay', time: '09:00' }]);
  assert.deepEqual([f.subtaskTitles, f.noteTexts, f.focus], [['рецепт', 'пакет'], ['a\nb'], true]);
  assert.equal(BK.cleanTemplate({ title: 'x' }).reminderRules, null, 'не задано — по умолчанию из настроек');
  assert.deepEqual(BK.cleanTemplate({ title: 'x', reminderRules: [] }).reminderRules, [], 'пустой — без напоминаний');
  assert.throws(() => BK.newTemplate({ title: '   ' }, makeCtx(NOW)));
  // имена полей не пересекаются с вложенными массивами задач (их слияние — по id элементов)
  for (const k of ['notes', 'subtasks', 'reminders', 'items', 'lists', 'occurrences']) assert.ok(!BK.TEMPLATE_FIELDS.includes(k), k);
  assert.ok(MERGE_COLLECTIONS.includes('templates') && COLLECTIONS.includes('templates'));
});

test('задача из заготовки: дата — выбранный день, повтор — от него, «до» из прошлого не переносится, ★ — только с днём', () => {
  const c = makeCtx(NOW);
  const tpl = BK.newTemplate({ title: 'Полить цветы', listIds: [HOME], priorityId: HIGH, time: '19:00', focus: true,
    subtaskTitles: ['фикус'], noteTexts: ['по 200 мл'], reminderRules: [{ kind: 'timeOfDay', time: '18:00' }] }, c);
  assert.deepEqual([tpl.uses, tpl.lastUsedAt], [0, null]);
  let x = BK.taskInput(tpl, { date: '2026-10-07', today: TODAY });
  assert.deepEqual([x.scheduledDate, x.scheduledTime, x.focus, x.focusDate, x.repeat], ['2026-10-07', '19:00', true, '2026-10-07', null]);
  assert.deepEqual([x.listIds, x.priorityId, x.subtasks, x.notes], [[HOME], HIGH, ['фикус'], ['по 200 мл']]);
  assert.deepEqual(x.reminders, [{ kind: 'timeOfDay', time: '18:00' }]);
  x = BK.taskInput(tpl, { date: null, today: TODAY });
  assert.deepEqual([x.scheduledDate, x.scheduledTime, x.focus], [null, null, false], 'без даты — во «Входящие», без времени и ★');
  assert.equal(BK.taskInput({ ...tpl, reminderRules: null }, { date: TODAY, today: TODAY }).reminders, undefined, 'по умолчанию — из настроек');
  const rule = { ...makeRule({ kind: 'weekly', weekdays: [1] }, '2026-01-05'), until: '2026-03-01' };
  const rep = BK.newTemplate({ title: 'Отчёт', repeat: rule, time: '10:00' }, c);
  x = BK.taskInput(rep, { date: null, today: TODAY });
  assert.deepEqual([x.scheduledDate, x.scheduledTime, x.repeat.startDate, x.repeat.until], [null, '10:00', TODAY, null]);
  assert.equal(BK.taskInput({ ...rep, repeat: { ...rule, until: '2027-01-01' } }, { date: '2026-10-12', today: TODAY }).repeat.until, '2027-01-01');
  // использована — счётчик и время
  const used = BK.markUsed(tpl, makeCtx(NOW + 60000));
  assert.deepEqual([used.uses, used.lastUsedAt], [1, '2026-10-06T09:01:00.000Z']);
  assert.ok(used.fieldTimes.uses > tpl.fieldTimes.uses);
  const ed = BK.editTemplate(used, { title: '  ', time: '07:30', subtaskTitles: ['a', ' '] }, c);
  assert.deepEqual([ed.title, ed.time, ed.subtaskTitles], ['Полить цветы', '07:30', ['a']], 'пустое название не стирает');
});

test('заготовка из задачи: списки, приоритет, время, повтор, живые подзадачи и заметки — без даты', () => {
  const d = makeData();
  const c = makeCtx(NOW);
  let t = addTask(d, c, { title: 'Купить продукты', listIds: [HOME], priorityId: HIGH, scheduledDate: TODAY, scheduledTime: '18:00',
    reminders: [{ kind: 'relative', anchor: 'scheduled', offsetMinutes: 15 }] });
  t = addNote(t, 'список в заметках', 'a0', c);
  d.tasks.set(t.id, t);
  addTask(d, c, { title: 'молоко', parentId: t.id });
  const gone = addTask(d, c, { title: 'хлеб', parentId: t.id });
  d.tasks.set(gone.id, trashTask(gone, c));
  const f = BK.templateFromTask(d, d.tasks.get(t.id));
  assert.deepEqual([f.title, f.listIds, f.priorityId, f.time, f.repeat], ['Купить продукты', [HOME], HIGH, '18:00', null]);
  assert.deepEqual([f.subtaskTitles, f.noteTexts], [['молоко'], ['список в заметках']]);
  assert.deepEqual(f.reminderRules, [{ kind: 'relative', anchor: 'scheduled', offsetMinutes: 15 }]);
});

test('банк: частые сверху, поиск — ё = е, по заметкам, подзадачам и спискам; начало названия выше; фильтр списка', () => {
  const d = makeData();
  const c = makeCtx(NOW);
  const a = put(d, BK.newTemplate({ title: 'Ёлку нарядить', listIds: [HOME] }, c));
  const b = put(d, { ...BK.newTemplate({ title: 'Позвонить маме', noteTexts: ['про ёлку'] }, c), uses: 5 });
  const m = put(d, BK.newTemplate({ title: 'Конспект', listIds: [PERESDACHA], subtaskTitles: ['формулы'] }, c));
  put(d, tombstone(BK.newTemplate({ title: 'Удалённая ёлка' }, c), c));
  assert.deepEqual(BK.templateList(d).map((t) => t.title), ['Позвонить маме', 'Ёлку нарядить', 'Конспект']);
  assert.deepEqual(BK.searchTemplates(d, 'елк').map((t) => t.id), [a.id, b.id], 'название с этого слова — выше частой');
  assert.deepEqual(BK.searchTemplates(d, 'формул').map((t) => t.id), [m.id]);
  assert.deepEqual(BK.searchTemplates(d, 'дом').map((t) => t.id), [a.id], 'по названию списка');
  assert.deepEqual(BK.searchTemplates(d, '', { listId: 'inbox' }).map((t) => t.id), [b.id]);
  assert.deepEqual(BK.searchTemplates(d, '', { listId: PERESDACHA }).map((t) => t.id), [m.id]);
  assert.equal(BK.searchTemplates(d, '', { limit: 2 }).length, 2);
  assert.equal(BK.findByTitle(d, 'ПОЗВОНИТЬ  маме').id, b.id);
  assert.equal(BK.findByTitle(d, 'удаленная елка'), null, 'удалённые не в счёт');
});

test('синхронизация заготовок: поля — по своим меткам, правка после удаления возвращает', () => {
  const c1 = makeCtx(NOW);
  const base = BK.newTemplate({ title: 'Стирка', time: '20:00' }, c1);
  const c2 = makeCtx(NOW + 1000);
  const left = BK.editTemplate(base, { time: '21:00' }, c2);
  const right = BK.markUsed({ ...base, fieldTimes: { ...base.fieldTimes } }, makeCtx(NOW + 2000));
  const m = mergeEntity(left, right);
  assert.deepEqual([m.time, m.uses, m.title], ['21:00', 1, 'Стирка']);
  const dead = tombstone(base, makeCtx(NOW + 3000));
  const later = touch(base, { noteTexts: ['новое'] }, makeCtx(NOW + 9000));
  const r = mergeEntity(dead, later);
  assert.ok(!r.deletedAt && r.noteTexts[0] === 'новое');
});

test('«Выполнено в этот день»: выполненные сегодня повторы — тоже, вчерашние и возвращённые — нет', () => {
  const d = makeData();
  const c = makeCtx(NOW);
  const daily = addTask(d, c, { title: 'Зарядка', repeat: makeRule({ kind: 'daily' }, '2026-10-01') });
  const key = currentKey(daily, TODAY, 'Europe/Moscow');
  const done = closeOccurrence(daily, key, makeCtx(NOW + 3600000));
  d.tasks.set(done.id, done);
  const y = addTask(d, c, { title: 'Вчерашний повтор', repeat: makeRule({ kind: 'daily' }, '2026-10-01') });
  d.tasks.set(y.id, closeOccurrence(y, '2026-10-05', makeCtx(Date.parse('2026-10-05T10:00:00.000Z'))));
  const plain = addTask(d, c, { title: 'Обычная' });
  d.tasks.set(plain.id, completeTask(plain, c));
  let v = todayView(d, TODAY, '12:00', NOW + 7200000);
  assert.deepEqual(v.doneRepeats.map((x) => [x.task.title, x.key]), [['Зарядка', key]]);
  assert.deepEqual(v.doneToday.map((t) => t.title), ['Обычная']);
  assert.ok(!v.today.some((t) => t.id === daily.id), 'сегодняшний экземпляр закрыт');
  d.tasks.set(done.id, reopenOccurrence(done, key, makeCtx(NOW + 7300000)));
  v = todayView(d, TODAY, '12:00', NOW + 7400000);
  assert.equal(v.doneRepeats.length, 0);
  assert.ok(v.today.some((t) => t.id === daily.id), 'снова на сегодня');
});

test('«Поиск»: вкладки «Активные» и «Повторяющиеся»', () => {
  const d = makeData();
  const c = makeCtx(NOW);
  addTask(d, c, { title: 'Купить молоко', listIds: [HOME] });
  const done = addTask(d, c, { title: 'Пробежка' });
  d.tasks.set(done.id, completeTask(done, c));
  const tr0 = addTask(d, c, { title: 'Старый план' });
  d.tasks.set(tr0.id, trashTask(tr0, c));
  addTask(d, c, { title: 'Зарядка', repeat: makeRule({ kind: 'daily' }, TODAY) });
  const ended = addTask(d, c, { title: 'Курс таблеток', repeat: makeRule({ kind: 'daily' }, TODAY) });
  d.tasks.set(ended.id, completeTask(ended, c));
  const trRep = addTask(d, c, { title: 'Удалённый повтор', repeat: makeRule({ kind: 'weekly' }, TODAY) });
  d.tasks.set(trRep.id, trashTask(trRep, c));
  const names = (kind) => rowsOf(d, kind).map((t) => t.title).sort();
  assert.deepEqual(names('active'), ['Зарядка', 'Купить молоко']);
  assert.deepEqual(names('repeat'), ['Зарядка', 'Курс таблеток']);
  assert.equal(rowsOf(d, 'all').length, 6);
  assert.ok(fieldChips('repeat').includes('статус') && !fieldChips('active').includes('статус'));
  for (const k of ['active', 'repeat']) assert.ok(KINDS[k] && PLACEHOLDER[k] && LIVE_KINDS.includes(k));
  const ctx = makeContext(d, 'Europe/Moscow', TODAY);
  assert.deepEqual(search(ctx, 'repeat', { q: '-статус:выполнена' }).rows.map((t) => t.title), ['Зарядка']);
  assert.deepEqual(search(ctx, 'active', { q: 'список:Дом' }).rows.map((t) => t.title), ['Купить молоко']);
});
