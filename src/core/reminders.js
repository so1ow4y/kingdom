// Напоминания (обновление 0.3, п. 2.5): когда срабатывает напоминание, подписи, напоминания по умолчанию.
// Чистые функции без браузера: те же правила должен повторять Telegram-бот (DATA_FORMAT §5.3.3).
// Показ уведомлений и «Пропущенные» — в ui/notifier.js.

import { zonedToEpoch, todayIn, humanDate } from './dates.js';
import { LIMITS } from '../config.js';

export const MAX_REMINDERS = LIMITS.remindersMax;
export const MAX_OFFSET_MINUTES = LIMITS.reminderOffsetMax; // неделя — ограничение формата
const DAY_END = '23:59';
const MIN = 60000;

const live = (task) => (task.reminders || []).filter((r) => !r.deletedAt);

/** День задачи для напоминаний «в день задачи»: дата начала, а если её нет — дедлайн. */
export const taskDay = (task) => task.scheduledDate || task.deadlineDate || null;

/** Можно ли получать напоминания по задаче (повторы пока не поддерживаются: у них нет даты). */
export const remindable = (task) => !task.deletedAt && !task.trashedAt && task.status === 'active' && !task.repeat;

/** Момент срабатывания (мс) или null, если напоминание сейчас недействительно (нет даты или времени). */
export function reminderMoment(task, r, tz) {
  if (!r || r.deletedAt) return null;
  if (r.kind === 'absolute') return r.at ? zonedToEpoch(r.at.slice(0, 10), r.at.slice(11, 16), tz) : null;
  if (r.kind === 'relative') {
    const off = Math.max(0, r.offsetMinutes | 0) * MIN;
    if (r.anchor === 'deadline') {
      return task.deadlineDate ? zonedToEpoch(task.deadlineDate, task.deadlineTime || DAY_END, tz) - off : null;
    }
    return task.scheduledDate && task.scheduledTime ? zonedToEpoch(task.scheduledDate, task.scheduledTime, tz) - off : null;
  }
  if (r.kind === 'timeOfDay') {
    const day = taskDay(task);
    return day && r.time ? zonedToEpoch(day, r.time, tz) : null;
  }
  return null;
}

/** Ключ срабатывания: меняется, если пользователь перенёс задачу, — и напоминание сработает снова. */
export const fireKey = (taskId, remId, at) => `${taskId}|${remId}|${at}`;

/**
 * Напоминания по умолчанию для новой задачи или задачи, которой только что поставили дату (п. 2.5):
 * есть время — за settings.defaultReminderMinutes до начала; только дата — в settings.dayReminderTime.
 */
export function defaultReminders(task, settings) {
  if (task.repeat || !taskDay(task)) return [];
  const d = settings.defaultReminderMinutes;
  if (task.scheduledDate && task.scheduledTime) {
    return d == null ? [] : [{ kind: 'relative', anchor: 'scheduled', offsetMinutes: d }];
  }
  return settings.dayReminderTime ? [{ kind: 'timeOfDay', time: settings.dayReminderTime }] : [];
}

/** Одинаковые ли напоминания (чтобы не добавлять дубль). */
export function sameReminder(a, b) {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'relative') return (a.anchor || 'scheduled') === (b.anchor || 'scheduled') && (a.offsetMinutes | 0) === (b.offsetMinutes | 0);
  if (a.kind === 'timeOfDay') return a.time === b.time;
  return a.at === b.at;
}

/** «5 мин», «1 ч», «1 ч 30 мин», «2 дн.» */
export function durationLabel(min) {
  if (min % 1440 === 0 && min) return `${min / 1440} дн.`;
  if (min % 60 === 0 && min) return `${min / 60} ч`;
  if (min > 60) return `${Math.floor(min / 60)} ч ${min % 60} мин`;
  return `${min} мин`;
}

/** Подпись напоминания в карточке: «за 5 мин до начала», «в день задачи в 09:00», «3 окт, 14:00». */
export function reminderLabel(r, today) {
  if (r.kind === 'relative') {
    const what = r.anchor === 'deadline' ? 'дедлайна' : 'начала';
    return r.offsetMinutes ? `за ${durationLabel(r.offsetMinutes)} до ${what}` : `в момент ${what}`;
  }
  if (r.kind === 'timeOfDay') return `в день задачи в ${r.time}`;
  if (r.kind === 'absolute' && r.at) return `${humanDate(r.at.slice(0, 10), today)}, ${r.at.slice(11, 16)}`;
  return 'напоминание';
}

/** Почему напоминание не сработает (для подсказки в карточке) или null. */
export function reminderProblem(task, r) {
  if (task.repeat) return 'у повторяющихся задач напоминания пока не работают';
  if (r.kind === 'relative' && r.anchor !== 'deadline' && !(task.scheduledDate && task.scheduledTime)) return 'нужно время начала';
  if (r.kind === 'relative' && r.anchor === 'deadline' && !task.deadlineDate) return 'нужен дедлайн';
  if (r.kind === 'timeOfDay' && !taskDay(task)) return 'нужна дата';
  return null;
}

/**
 * Что сработало в промежутке (from, to] мс: обычные напоминания и повторы «Напоминать, пока не отмечу».
 * Повтор (nag): после самого раннего сработавшего напоминания — каждые nag.intervalMinutes, пока задача не выполнена.
 * → [{ key, taskId, title, at, nag }] по времени.
 */
export function dueBetween(data, from, to) {
  const tz = data.settings.timeZone;
  const out = [];
  for (const t of data.tasks.values()) {
    if (!remindable(t)) continue;
    let first = null;
    for (const r of live(t)) {
      const at = reminderMoment(t, r, tz);
      if (at == null) continue;
      if (at <= to && (first == null || at < first)) first = at;
      if (at > from && at <= to) out.push({ key: fireKey(t.id, r.id, at), taskId: t.id, title: t.title, at, nag: false });
    }
    if (first != null && t.nag?.enabled) {
      const step = Math.max(LIMITS.nagMin, t.nag.intervalMinutes | 0) * MIN;
      const k = Math.floor((to - first) / step); // последний повтор не позже to
      const at = first + k * step;
      if (k >= 1 && at > from) out.push({ key: `${t.id}|nag|${first}|${k}`, taskId: t.id, title: t.title, at, nag: true });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Текст уведомления: «Сегодня в 14:00 · дедлайн 5 окт». */
export function notificationBody(task, tz, now = Date.now()) {
  const today = todayIn(tz, new Date(now));
  const parts = [];
  if (task.scheduledDate) parts.push(humanDate(task.scheduledDate, today) + (task.scheduledTime ? ' в ' + task.scheduledTime : ''));
  if (task.deadlineDate) parts.push('дедлайн ' + humanDate(task.deadlineDate, today).toLowerCase() + (task.deadlineTime ? ' ' + task.deadlineTime : ''));
  return parts.join(' · ') || 'Напоминание';
}
