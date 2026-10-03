// Напоминания: момент срабатывания, напоминания по умолчанию, что сработало за промежуток, повтор «пока не отмечу» (п. 2.5).

import { test, assert } from './runner.js';
import { makeCtx, makeData, addTask } from './helpers.js';
import { zonedToEpoch } from '../src/core/dates.js';
import {
  reminderMoment, defaultReminders, dueBetween, reminderLabel, reminderProblem, durationLabel, sameReminder,
} from '../src/core/reminders.js';

const MSK = 'Europe/Moscow';
const MIN = 60000;

test('zonedToEpoch: Москва UTC+3, Нью-Йорк в летнее и зимнее время', () => {
  assert.equal(zonedToEpoch('2026-10-02', '12:00', MSK), Date.parse('2026-10-02T09:00:00Z'));
  assert.equal(zonedToEpoch('2026-07-01', '12:00', 'America/New_York'), Date.parse('2026-07-01T16:00:00Z'));
  assert.equal(zonedToEpoch('2026-12-01', '12:00', 'America/New_York'), Date.parse('2026-12-01T17:00:00Z'));
  assert.equal(zonedToEpoch('2026-10-02', '00:00', 'UTC'), Date.parse('2026-10-02T00:00:00Z'));
});

test('момент: относительно начала, дедлайна, в день задачи, точное время; без времени — null', () => {
  const c = makeCtx();
  const d = makeData();
  const t = addTask(d, c, { title: 'A', scheduledDate: '2026-10-05', scheduledTime: '14:00', deadlineDate: '2026-10-07' });
  const at = (r) => reminderMoment(t, r, MSK);
  assert.equal(at({ kind: 'relative', anchor: 'scheduled', offsetMinutes: 5 }), Date.parse('2026-10-05T10:55:00Z'));
  assert.equal(at({ kind: 'relative', anchor: 'deadline', offsetMinutes: 60 }), Date.parse('2026-10-07T19:59:00Z'));
  assert.equal(at({ kind: 'timeOfDay', time: '09:00' }), Date.parse('2026-10-05T06:00:00Z'));
  assert.equal(at({ kind: 'absolute', at: '2026-10-04T20:30' }), Date.parse('2026-10-04T17:30:00Z'));
  const noTime = { ...t, scheduledTime: null };
  assert.equal(reminderMoment(noTime, { kind: 'relative', anchor: 'scheduled', offsetMinutes: 5 }, MSK), null);
  assert.equal(reminderProblem(noTime, { kind: 'relative', anchor: 'scheduled', offsetMinutes: 5 }), 'нужно время начала');
  const onlyDeadline = { ...t, scheduledDate: null, scheduledTime: null };
  assert.equal(reminderMoment(onlyDeadline, { kind: 'timeOfDay', time: '09:00' }, MSK), Date.parse('2026-10-07T06:00:00Z'));
});

test('по умолчанию: со временем — за 5 мин; только дата — в 09:00; без даты — ничего; настройки учитываются', () => {
  const s = makeData().settings;
  assert.deepEqual(defaultReminders({ scheduledDate: '2026-10-05', scheduledTime: '14:00' }, s), [{ kind: 'relative', anchor: 'scheduled', offsetMinutes: 5 }]);
  assert.deepEqual(defaultReminders({ scheduledDate: '2026-10-05', scheduledTime: null }, s), [{ kind: 'timeOfDay', time: '09:00' }]);
  assert.deepEqual(defaultReminders({ deadlineDate: '2026-10-05' }, s), [{ kind: 'timeOfDay', time: '09:00' }]);
  assert.deepEqual(defaultReminders({}, s), []);
  assert.deepEqual(defaultReminders({ scheduledDate: '2026-10-05', scheduledTime: '14:00' }, { ...s, defaultReminderMinutes: null }), []);
  assert.deepEqual(defaultReminders({ scheduledDate: '2026-10-05' }, { ...s, dayReminderTime: null }), []);
});

test('dueBetween: только сработавшие в промежутке, без выполненных и удалённых', () => {
  const c = makeCtx();
  const d = makeData();
  const a = addTask(d, c, { title: 'A', scheduledDate: '2026-10-05', scheduledTime: '14:00', reminders: [{ kind: 'relative', anchor: 'scheduled', offsetMinutes: 5 }] });
  addTask(d, c, { title: 'B', scheduledDate: '2026-10-05', scheduledTime: '14:00', reminders: [{ kind: 'relative', anchor: 'scheduled', offsetMinutes: 5 }] }, { status: 'done' });
  addTask(d, c, { title: 'C', scheduledDate: '2026-10-05', scheduledTime: '14:00', reminders: [{ kind: 'relative', anchor: 'scheduled', offsetMinutes: 5 }] }, { trashedAt: '2026-10-02T00:00:00.000Z' });
  const at = Date.parse('2026-10-05T10:55:00Z');
  const due = dueBetween(d, at - MIN, at);
  assert.equal(due.length, 1);
  assert.equal(due[0].taskId, a.id);
  assert.equal(due[0].at, at);
  assert.equal(dueBetween(d, at, at + MIN).length, 0, 'граница from не включается — не покажем дважды');
  // Перенос задачи меняет ключ — напоминание сработает снова
  const moved = { ...a, scheduledTime: '15:00' };
  d.tasks.set(a.id, moved);
  const due2 = dueBetween(d, at, at + 3600000);
  assert.equal(due2.length, 1);
  assert.ok(due2[0].key !== due[0].key);
});

test('«Напоминать, пока не отмечу»: повтор каждые N минут после первого напоминания', () => {
  const c = makeCtx();
  const d = makeData();
  const t = addTask(d, c, { title: 'A', scheduledDate: '2026-10-05', scheduledTime: '14:00', reminders: [{ kind: 'relative', anchor: 'scheduled', offsetMinutes: 0 }] },
    { nag: { enabled: true, intervalMinutes: 15 } });
  const first = Date.parse('2026-10-05T11:00:00Z');
  assert.equal(dueBetween(d, first + MIN, first + 14 * MIN).length, 0);
  const n1 = dueBetween(d, first + 14 * MIN, first + 15 * MIN);
  assert.equal(n1.length, 1);
  assert.equal(n1[0].nag, true);
  assert.equal(n1[0].at, first + 15 * MIN);
  const n2 = dueBetween(d, first + 15 * MIN, first + 31 * MIN);
  assert.equal(n2.length, 1);
  assert.equal(n2[0].at, first + 30 * MIN);
  assert.ok(n1[0].key !== n2[0].key);
  d.tasks.set(t.id, { ...t, status: 'done' });
  assert.equal(dueBetween(d, first + 30 * MIN, first + 60 * MIN).length, 0, 'выполнена — повторы прекращаются');
});

test('подписи и сравнение напоминаний', () => {
  assert.equal(durationLabel(5), '5 мин');
  assert.equal(durationLabel(60), '1 ч');
  assert.equal(durationLabel(90), '1 ч 30 мин');
  assert.equal(durationLabel(1440), '1 дн.');
  assert.equal(reminderLabel({ kind: 'relative', anchor: 'scheduled', offsetMinutes: 15 }, '2026-10-02'), 'за 15 мин до начала');
  assert.equal(reminderLabel({ kind: 'relative', anchor: 'deadline', offsetMinutes: 0 }, '2026-10-02'), 'в момент дедлайна');
  assert.equal(reminderLabel({ kind: 'timeOfDay', time: '09:00' }, '2026-10-02'), 'в день задачи в 09:00');
  assert.ok(sameReminder({ kind: 'relative', anchor: 'scheduled', offsetMinutes: 5, id: 'x' }, { kind: 'relative', anchor: 'scheduled', offsetMinutes: 5 }));
  assert.ok(!sameReminder({ kind: 'relative', anchor: 'scheduled', offsetMinutes: 5 }, { kind: 'relative', anchor: 'deadline', offsetMinutes: 5 }));
});

test('«за 1 мин» и своё значение (за 7 мин): момент срабатывания и попадание в промежуток', () => {
  const c = makeCtx();
  const d = makeData();
  const t = addTask(d, c, { title: 'A', scheduledDate: '2026-10-05', scheduledTime: '14:00', reminders: [
    { kind: 'relative', anchor: 'scheduled', offsetMinutes: 1 },
    { kind: 'relative', anchor: 'scheduled', offsetMinutes: 7 },
  ] });
  const start = Date.parse('2026-10-05T11:00:00Z'); // 14:00 по Москве
  assert.equal(reminderMoment(t, t.reminders.find((r) => r.offsetMinutes === 1), MSK), start - MIN);
  assert.equal(reminderMoment(t, t.reminders.find((r) => r.offsetMinutes === 7), MSK), start - 7 * MIN);
  assert.deepEqual(dueBetween(d, start - 8 * MIN, start).map((x) => x.at), [start - 7 * MIN, start - MIN]);
  assert.equal(reminderLabel({ kind: 'relative', anchor: 'scheduled', offsetMinutes: 1 }, '2026-10-02'), 'за 1 мин до начала');
});

test('«Повторять, пока не отмечу»: каждую минуту и своё значение (каждые 3 мин)', () => {
  const c = makeCtx();
  const d = makeData();
  const t = addTask(d, c, { title: 'A', scheduledDate: '2026-10-05', scheduledTime: '14:00', reminders: [{ kind: 'relative', anchor: 'scheduled', offsetMinutes: 0 }] },
    { nag: { enabled: true, intervalMinutes: 1 } });
  const first = Date.parse('2026-10-05T11:00:00Z');
  const n1 = dueBetween(d, first, first + MIN);
  assert.equal(n1.length, 1);
  assert.equal(n1[0].at, first + MIN, 'через минуту');
  assert.equal(dueBetween(d, first + MIN, first + 2 * MIN)[0].at, first + 2 * MIN);
  d.tasks.set(t.id, { ...t, nag: { enabled: true, intervalMinutes: 3 } });
  assert.equal(dueBetween(d, first, first + 2 * MIN).length, 0);
  assert.equal(dueBetween(d, first + 2 * MIN, first + 3 * MIN)[0].at, first + 3 * MIN);
  d.tasks.set(t.id, { ...t, nag: { enabled: true, intervalMinutes: 0 } });
  assert.equal(dueBetween(d, first, first + MIN)[0].at, first + MIN, 'меньше минуты не бывает');
});