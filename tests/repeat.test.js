// Повторяющиеся задачи (обновление 0.9; алгоритм — DATA_FORMAT §5.4).

import { test, assert } from './runner.js';
import { makeCtx, makeData } from './helpers.js';
import {
  matches, currentKey, dueDate, upcoming, closeOccurrence, reopenOccurrence, makeRule, ruleKind, describeRule, lastClosedKey,
} from '../src/core/repeat.js';
import { newTask, revert } from '../src/core/model.js';
import { mergeEntity } from '../src/core/merge.js';
import { todayView, isOverdue, inboxView, repeatingView, plannedDate } from '../src/core/selectors.js';
import { doneEntries } from '../src/core/retention.js';
import { listTotals } from '../src/core/skills.js';

const NOW = Date.parse('2026-10-06T09:00:00.000Z'); // вторник
const TODAY = '2026-10-06';
const task = (rule, extra = {}) => newTask({ title: 'Повтор', repeat: rule, order: 'a0', ...extra }, makeCtx(NOW));

test('правила: каждый день, каждые N дней, по дням недели (раз в N недель), раз в месяц (последний день, если меньше)', () => {
  const daily = makeRule({ kind: 'daily' }, '2026-10-01');
  assert.ok(matches(daily, '2026-10-01') && matches(daily, '2026-10-06'));
  assert.ok(!matches(daily, '2026-09-30'), 'не раньше начала');
  const every3 = makeRule({ kind: 'every', interval: 3 }, '2026-10-01');
  assert.deepEqual(['2026-10-01', '2026-10-02', '2026-10-04', '2026-10-07'].map((d) => matches(every3, d)), [true, false, true, true]);
  const wk = makeRule({ kind: 'weekly', weekdays: [3, 1] }, '2026-09-28');
  assert.deepEqual(wk.byWeekday, [1, 3], 'по порядку');
  assert.deepEqual(['2026-10-05', '2026-10-06', '2026-10-07'].map((d) => matches(wk, d)), [true, false, true]);
  const bi = { ...wk, interval: 2 };
  assert.ok(matches(bi, '2026-09-28') && !matches(bi, '2026-10-05') && matches(bi, '2026-10-12'), 'раз в две недели');
  const m31 = makeRule({ kind: 'monthly', monthDay: 31 }, '2026-01-31');
  assert.ok(matches(m31, '2026-02-28') && !matches(m31, '2026-02-27') && matches(m31, '2026-04-30'), 'в коротком месяце — последний день');
  assert.deepEqual(ruleKind(m31), { kind: 'monthly', weekdays: [], monthDay: 31, interval: 1 });
  assert.equal(describeRule(wk), 'по Пн, Ср');
  assert.equal(describeRule(makeRule({ kind: 'weekly', weekdays: [1, 2, 3, 4, 5] }, TODAY)), 'по будням');
  assert.equal(describeRule(every3), 'каждые 3 дня');
  assert.equal(describeRule(makeRule({ kind: 'every', interval: 5 }, TODAY)), 'каждые 5 дней');
  assert.equal(describeRule(m31), 'каждый месяц 31-го');
});

test('текущий экземпляр: пропущенные не копятся, просрочка по неделе, закрыть / отменить / пропустить', () => {
  const c = makeCtx(NOW);
  // «каждый день», не открывали неделю — текущий сегодня, не просрочен
  let t = task(makeRule({ kind: 'daily' }, '2026-09-28'));
  assert.equal(currentKey(t, TODAY), TODAY);
  assert.ok(!isOverdue(t, TODAY, '10:00'));
  // закрыли сегодня — следующий завтра
  t = closeOccurrence(t, TODAY, c);
  assert.equal(lastClosedKey(t), TODAY);
  assert.equal(currentKey(t, TODAY), '2026-10-07');
  assert.deepEqual(upcoming(t, TODAY, 3), ['2026-10-07', '2026-10-08', '2026-10-09']);
  // отменили — снова сегодня
  const back = reopenOccurrence(t, TODAY, c);
  assert.equal(currentKey(back, TODAY), TODAY);
  // «по Пн», сегодня вторник — текущий понедельник, он просрочен
  const mon = task(makeRule({ kind: 'weekly', weekdays: [1] }, '2026-09-21'));
  assert.equal(currentKey(mon, TODAY), '2026-10-05');
  assert.ok(isOverdue(mon, TODAY, '10:00'));
  // пропустили — следующий понедельник
  const skipped = closeOccurrence(mon, '2026-10-05', c, 'skipped');
  assert.equal(currentKey(skipped, TODAY), '2026-10-12');
  assert.ok(!isOverdue(skipped, TODAY, '10:00'));
  // с концом серии
  const until = { ...makeRule({ kind: 'daily' }, '2026-10-05'), until: TODAY };
  const fin = closeOccurrence(closeOccurrence(task(until), '2026-10-05', c), TODAY, c);
  assert.equal(currentKey(fin, TODAY), null);
  // «от даты выполнения»
  const ac = task({ ...makeRule({ kind: 'every', interval: 3 }, '2026-10-01'), mode: 'afterCompletion' });
  assert.equal(currentKey(ac, TODAY), '2026-10-01');
  const acDone = closeOccurrence(ac, '2026-10-01', c);
  assert.equal(currentKey(acDone, TODAY, 'UTC'), '2026-10-09', 'три дня от даты выполнения (06.10)');
});

test('повтор в «Сегодня», во «Входящих» (отдельная вкладка), выполнения — в статистике и навыках; слияние экземпляров', () => {
  const c = makeCtx(NOW);
  const d = makeData();
  const UNI = '00000000-0000-7000-8000-000000000102';
  const daily = newTask({ title: 'Зарядка', repeat: makeRule({ kind: 'daily' }, '2026-10-01'), scheduledTime: '08:00', order: 'a0' }, c);
  const mon = newTask({ title: 'Отчёт', listIds: [UNI], repeat: makeRule({ kind: 'weekly', weekdays: [1] }, '2026-09-21'), order: 'a1' }, c);
  const plain = newTask({ title: 'Просто', order: 'a2' }, c);
  for (const t of [daily, mon, plain]) d.tasks.set(t.id, t);
  assert.equal(daily.scheduledDate, null, 'у повтора своей даты нет');
  assert.equal(daily.scheduledTime, '08:00', 'время — общее');
  const v = todayView(d, TODAY, '10:00', NOW);
  assert.ok(v.today.includes(daily), 'сегодняшний экземпляр — в «На сегодня»');
  assert.ok(v.overdue.includes(mon), 'вчерашний недельный — в просроченных');
  assert.equal(plannedDate(daily, TODAY), TODAY);
  assert.deepEqual(inboxView(d).map((t) => t.title), ['Просто'], 'на основной вкладке «Входящих» повторов нет');
  assert.deepEqual(repeatingView(d, TODAY).map((t) => t.title), ['Отчёт', 'Зарядка'], 'вкладка «Повторяющиеся» — по ближайшей дате');
  // другой день недели в «плане на день»: экземпляр по правилу
  const wed = todayView(d, '2026-10-07', '10:00', NOW, true);
  assert.ok(wed.today.includes(daily) && !wed.today.includes(mon));
  // выполнили экземпляр — он в статистике и опыте навыка
  const done = closeOccurrence(mon, '2026-10-05', c);
  d.tasks.set(done.id, done);
  assert.equal(doneEntries(d, 'UTC').length, 1);
  assert.equal(listTotals(d).get(UNI).done, 1);
  // два устройства закрыли разные дни офлайн — после слияния закрыты оба
  const a = closeOccurrence(daily, '2026-10-05', makeCtx(NOW));
  const b = closeOccurrence(daily, TODAY, { ...makeCtx(NOW + 5), deviceId: 'devB' });
  const m = mergeEntity(a, b);
  assert.deepEqual(Object.keys(m.occurrences).sort(), ['2026-10-05', TODAY]);
  assert.equal(currentKey(m, TODAY), '2026-10-07');
  // «Отменить» после отметки открывает экземпляр снова (а не превращает его в «не в списке»)
  const undone = revert(closeOccurrence(daily, TODAY, c), daily, c);
  assert.equal(undone.occurrences[TODAY].state, 'open');
  assert.equal(currentKey(undone, TODAY), TODAY);
});

test('ежегодные (0.12.3): месяц и число, 29 февраля в невисокосный год — 28-го, раз в N лет, текущий и ближайшие', () => {
  const bday = makeRule({ kind: 'yearly', month: 3, monthDay: 8 }, '2026-01-10');
  assert.deepEqual([bday.freq, bday.byMonth, bday.byMonthDay], ['yearly', 3, 8]);
  assert.ok(matches(bday, '2026-03-08') && matches(bday, '2027-03-08'));
  assert.ok(!matches(bday, '2026-03-09') && !matches(bday, '2026-04-08'), 'только 8 марта');
  assert.ok(!matches(bday, '2025-03-08'), 'не раньше начала');
  assert.equal(describeRule(bday), 'каждый год 8 марта');
  assert.deepEqual(ruleKind(bday), { kind: 'yearly', weekdays: [], month: 3, monthDay: 8, interval: 1 });
  const leap = makeRule({ kind: 'yearly', month: 2, monthDay: 29 }, '2026-01-01');
  assert.equal(leap.byMonthDay, 29);
  assert.ok(matches(leap, '2026-02-28') && matches(leap, '2028-02-29') && !matches(leap, '2028-02-28'), 'в невисокосный год — 28-го');
  assert.equal(makeRule({ kind: 'yearly', month: 4, monthDay: 31 }, '2026-01-01').byMonthDay, 30, 'в апреле 30 дней');
  assert.equal(currentKey(task(bday), TODAY), '2026-03-08', 'начат в январе — мартовский раз пропущен и остаётся текущим');
  assert.equal(currentKey(task(makeRule({ kind: 'yearly', month: 3, monthDay: 8 }, TODAY)), TODAY), '2027-03-08', 'новый — ближайший 8 марта');
  assert.equal(describeRule(makeRule({ kind: 'yearly', mode: 'afterCompletion' }, TODAY)), 'раз в год от выполнения');
  const two = task({ ...makeRule({ kind: 'yearly', month: 12, monthDay: 31 }, '2026-01-01'), interval: 3 });
  assert.equal(describeRule(two.repeat), 'раз в 3 года 31 декабря');
  assert.deepEqual(upcoming(two, TODAY, 3), ['2026-12-31', '2029-12-31', '2032-12-31'], 'раз в 3 года');
  const after = task(makeRule({ kind: 'yearly', mode: 'afterCompletion' }, '2026-10-06'));
  assert.equal(after.repeat.byMonth, null);
  const closed = closeOccurrence(after, '2026-10-06', makeCtx(NOW));
  assert.equal(currentKey(closed, TODAY, 'UTC'), '2027-10-06', 'от выполнения — через год');
});
