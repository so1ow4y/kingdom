// Игра (обновление 0.3, п. 2.6): журнал монет, баланс, опыт, уровни, серии, достижения.
//
// Баланс не хранится числом: это сумма живых активных событий коллекции coinEvents (DATA_FORMAT §12).
// Начисление за задачу имеет детерминированный id 'a:<taskId>' (или 'a:<taskId>:<дата экземпляра>' у повторов):
// два устройства, отметившие одну задачу офлайн, создают ОДНО событие; снятие отметки делает его active=false,
// повторная отметка — снова active=true. Поэтому «фармить» переключением нельзя, а слияние не теряет монет.

import { uuidv7 } from './ids.js';
import { touch } from './model.js';
import { addDays } from './dates.js';
import { doneEntries } from './retention.js';
import { PRIORITY_NONE_ID } from './priorities.js';

export const COIN_EVENT_FIELDS = ['type', 'amount', 'active', 'taskId', 'occKey', 'rewardId', 'itemId', 'title', 'at', 'deletedAt'];

export const awardId = (taskId, occKey = null) => (occKey ? `a:${taskId}:${occKey}` : `a:${taskId}`);

const iso = (ctx) => new Date(ctx.now).toISOString();

function newEvent(id, fields, ctx) {
  const t = ctx.stamp();
  const at = iso(ctx);
  const fieldTimes = {};
  for (const k of COIN_EVENT_FIELDS) fieldTimes[k] = t;
  return {
    id, createdAt: at, updatedAt: at, updatedBy: ctx.deviceId, deletedAt: null, fieldTimes,
    type: 'award', amount: 0, active: true, taskId: null, occKey: null, rewardId: null, itemId: null, title: '', at,
    ...fields,
  };
}

/** Сколько монет даёт задача (по её приоритету; архивный приоритет тоже даёт). */
export function coinsForTask(data, task) {
  const p = data.priorities.get(task.priorityId) || data.priorities.get(PRIORITY_NONE_ID);
  return p && !p.deletedAt ? Math.max(0, p.coins | 0) : 0;
}

/** Событие начисления за выполнение (новое или снова активное). Возвращает null, если менять нечего. */
export function awardEvent(data, task, occKey, ctx) {
  const id = awardId(task.id, occKey);
  const amount = coinsForTask(data, task);
  const cur = data.coinEvents.get(id);
  if (!cur || cur.deletedAt) return newEvent(id, { type: 'award', amount, taskId: task.id, occKey, title: task.title }, ctx);
  if (cur.active && cur.amount === amount) return null;
  return touch(cur, { active: true, amount, title: task.title, at: iso(ctx) }, ctx);
}

/** Возврат монет при снятии отметки «выполнено». */
export function revokeEvent(data, taskId, occKey, ctx) {
  const cur = data.coinEvents.get(awardId(taskId, occKey));
  if (!cur || cur.deletedAt || !cur.active) return null;
  return touch(cur, { active: false, at: iso(ctx) }, ctx);
}

/** Покупка: награда пользователя (rewardId) или встроенный предмет магазина (itemId). */
export function purchaseEvent({ price, title, rewardId = null, itemId = null }, ctx) {
  return newEvent(uuidv7(ctx.now), { type: 'purchase', amount: -Math.abs(price | 0), rewardId, itemId, title }, ctx);
}

const live = (data) => [...data.coinEvents.values()].filter((e) => !e.deletedAt && e.active);

export function balance(data) {
  let s = 0;
  for (const e of live(data)) s += e.amount | 0;
  return s;
}

/** Опыт — всё заработанное за всё время: активные начисления (траты не уменьшают, возвраты — уменьшают). */
export function experience(data) {
  let s = 0;
  for (const e of live(data)) if (e.type === 'award') s += Math.max(0, e.amount | 0);
  return s;
}

/** Порог опыта для уровня L: 25·(L−1)·L → 0, 50, 150, 300, 500, 750, … */
export const xpForLevel = (level) => 25 * (level - 1) * level;

export function levelInfo(xp) {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  const from = xpForLevel(level);
  const to = xpForLevel(level + 1);
  return { level, xp, from, to, progress: to > from ? (xp - from) / (to - from) : 0 };
}

export function ownsItem(data, itemId) {
  return live(data).some((e) => e.type === 'purchase' && e.itemId === itemId);
}

/**
 * Встроенная косметика магазина. Покупка — событие purchase с itemId (синхронизируется);
 * что сейчас включено — настройка устройства (ui/prefs.js). Пока игра выключена, всё доступно бесплатно.
 */
export const COSMETICS = [
  { id: 'scheme:lime', kind: 'scheme', value: 'lime', name: 'Схема Lime', emoji: '🍋', price: 150 },
  { id: 'scheme:lavender', kind: 'scheme', value: 'lavender', name: 'Схема Lavender', emoji: '💜', price: 150 },
  { id: 'scheme:ocean', kind: 'scheme', value: 'ocean', name: 'Схема «Океан»', emoji: '🌊', price: 250 },
  { id: 'scheme:sunset', kind: 'scheme', value: 'sunset', name: 'Схема «Закат»', emoji: '🌇', price: 250 },
  { id: 'letter:gold', kind: 'letter', value: '#f2a900', name: 'Золотой квадрат', emoji: '🟨', price: 100 },
  { id: 'letter:mint', kind: 'letter', value: '#26a69a', name: 'Мятный квадрат', emoji: '🟩', price: 100 },
  { id: 'letter:coral', kind: 'letter', value: '#ff7043', name: 'Коралловый квадрат', emoji: '🟧', price: 100 },
  { id: 'letter:graphite', kind: 'letter', value: '#455a64', name: 'Графитовый квадрат', emoji: '⬛', price: 100 },
];

export const cosmeticAvailable = (data, id) => !data.settings.gameEnabled || ownsItem(data, id);

export function purchasedCount(data, rewardId) {
  return live(data).filter((e) => e.type === 'purchase' && e.rewardId === rewardId).length;
}

// ---------- Выполненные по дням, серии ----------

/**
 * Map<'YYYY-MM-DD', число выполненных> по задачам, экземплярам повторов и сводкам удалённых выполненных
 * (лимит хранения, core/retention.js) — без корзины и без двойного счёта.
 */
export function doneByDay(data, tz) {
  const m = new Map();
  for (const e of doneEntries(data, tz)) m.set(e.date, (m.get(e.date) || 0) + 1);
  return m;
}

/** Текущая серия (дни подряд до сегодня; если сегодня ещё пусто — до вчера) и лучшая серия. */
export function streaks(byDay, today) {
  let current = 0;
  let d = byDay.get(today) ? today : addDays(today, -1);
  while (byDay.get(d)) {
    current++;
    d = addDays(d, -1);
  }
  let best = 0;
  let run = 0;
  let prev = null;
  for (const day of [...byDay.keys()].filter((k) => byDay.get(k) > 0).sort()) {
    run = prev && addDays(prev, 1) === day ? run + 1 : 1;
    best = Math.max(best, run);
    prev = day;
  }
  return { current, best: Math.max(best, current) };
}

// ---------- Достижения (вычисляются, не хранятся) ----------

export const ACHIEVEMENTS = [
  { id: 'first', emoji: '🌱', name: 'Первая задача', test: (s) => s.done >= 1 },
  { id: 'ten', emoji: '🔟', name: '10 задач', test: (s) => s.done >= 10 },
  { id: 'hundred', emoji: '💯', name: '100 задач', test: (s) => s.done >= 100 },
  { id: 'fivehundred', emoji: '🏆', name: '500 задач', test: (s) => s.done >= 500 },
  { id: 'streak3', emoji: '🔥', name: 'Серия 3 дня', test: (s) => s.bestStreak >= 3 },
  { id: 'streak7', emoji: '⚡', name: 'Серия 7 дней', test: (s) => s.bestStreak >= 7 },
  { id: 'streak30', emoji: '🌟', name: 'Серия 30 дней', test: (s) => s.bestStreak >= 30 },
  { id: 'level5', emoji: '🎖', name: 'Уровень 5', test: (s) => s.level >= 5 },
  { id: 'level10', emoji: '👑', name: 'Уровень 10', test: (s) => s.level >= 10 },
  { id: 'shopper', emoji: '🛍', name: 'Первая покупка', test: (s) => s.purchases >= 1 },
  { id: 'rich', emoji: '💰', name: '1000 монет заработано', test: (s) => s.xp >= 1000 },
];

export function gameStats(data, tz, today) {
  const byDay = doneByDay(data, tz);
  let done = 0;
  for (const n of byDay.values()) done += n;
  const st = streaks(byDay, today);
  const xp = experience(data);
  const lv = levelInfo(xp);
  const purchases = live(data).filter((e) => e.type === 'purchase').length;
  const stats = { done, xp, level: lv.level, bestStreak: st.best, currentStreak: st.current, purchases, balance: balance(data) };
  return { ...stats, levelInfo: lv, achievements: ACHIEVEMENTS.map((a) => ({ ...a, unlocked: a.test(stats) })) };
}
