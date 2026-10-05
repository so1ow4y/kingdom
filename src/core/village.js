// Деревня (обновление 0.7): постройки, жители, свет и небо, вторая валюта — изумруды (💎), настроение жителей.
// Чистые функции без браузера.
//
// Всё, что куплено, — события purchase в журнале coinEvents (синхронизируются, как и раньше). Изумруды не хранятся
// числом: баланс 💎 = добыча изумрудных шахт (считается по начислениям за задачи и времени покупки шахты)
// + изумруды за фокус-сессии (события type 'focus', поле gems) − траты (поле gems < 0 у покупок за изумруды).
// У покупок за изумруды amount = 0, поэтому старые версии приложения считают монеты по-прежнему верно.

import { localDateOf, addDays } from './dates.js';
import { doneEntries } from './retention.js';
import { PRIORITY_NONE_ID } from './priorities.js';

// ---------- Каталог ----------

/**
 * kind: building | light | sky | decor | char. coins / gems — цена (одно из двух). requires — что нужно купить раньше.
 * Жители со старыми id (pet:*) — это питомцы из 0.6: купленные раньше переезжают в деревню.
 */
export const VILLAGE_ITEMS = [
  // Постройки
  { id: 'v:house:2', kind: 'building', type: 'house', n: 2, name: 'Второй домик', emoji: '🏠', coins: 120, desc: 'Ещё одна крыша для жителей. Ночью в окнах горит свет.' },
  { id: 'v:house:3', kind: 'building', type: 'house', n: 3, name: 'Третий домик', emoji: '🏡', coins: 220, requires: 'v:house:2', desc: 'Деревня растёт — жители заселяются сами.' },
  { id: 'v:house:4', kind: 'building', type: 'house', n: 4, name: 'Дом с мансардой', emoji: '🏘️', gems: 6, requires: 'v:house:3', desc: 'Большой дом с флюгером.' },
  { id: 'v:mine-gold:1', kind: 'building', type: 'goldmine', n: 1, name: 'Золотая шахта', emoji: '⛏️', coins: 300, desc: '+10 % монет за каждую выполненную задачу.' },
  { id: 'v:mine-gold:2', kind: 'building', type: 'goldmine', n: 2, name: 'Золотая шахта · ур. 2', emoji: '⛏️', coins: 650, requires: 'v:mine-gold:1', desc: '+20 % монет за задачи.' },
  { id: 'v:mine-gold:3', kind: 'building', type: 'goldmine', n: 3, name: 'Золотая шахта · ур. 3', emoji: '⛏️', gems: 15, requires: 'v:mine-gold:2', desc: '+30 % монет за задачи.' },
  { id: 'v:mine-gem:1', kind: 'building', type: 'gemmine', n: 1, name: 'Изумрудная шахта', emoji: '💎', coins: 400, desc: '+1 💎 за каждую выполненную важную задачу (приоритет «Высокий» и выше), за критичную — вдвое.' },
  { id: 'v:mine-gem:2', kind: 'building', type: 'gemmine', n: 2, name: 'Изумрудная шахта · ур. 2', emoji: '💎', gems: 10, requires: 'v:mine-gem:1', desc: '+2 💎 за важную задачу и бонус к фокус-сессиям.' },
  { id: 'v:mine-gem:3', kind: 'building', type: 'gemmine', n: 3, name: 'Изумрудная шахта · ур. 3', emoji: '💎', gems: 25, requires: 'v:mine-gem:2', desc: '+3 💎 за важную задачу.' },
  { id: 'v:forge', kind: 'building', type: 'forge', name: 'Мастерская', emoji: '🔨', coins: 180, desc: 'Во время фокус-сессии строитель работает здесь.' },
  { id: 'v:windmill', kind: 'building', type: 'windmill', name: 'Мельница', emoji: '🌾', coins: 220, desc: 'Крутится, когда жители довольны.' },
  { id: 'v:tavern', kind: 'building', type: 'tavern', name: 'Таверна', emoji: '🍺', coins: 350, desc: 'Вечером жители собираются здесь поболтать.' },
  { id: 'v:tower', kind: 'building', type: 'tower', name: 'Сторожевая башня', emoji: '🏰', gems: 12, desc: 'Флаг цвета твоей иконки приложения.' },
  { id: 'v:fountain', kind: 'building', type: 'fountain', name: 'Фонтан', emoji: '⛲', gems: 5, desc: 'Площадь, где жители встречаются.' },
  // Свет и небо
  { id: 'v:lantern:1', kind: 'light', type: 'lantern', n: 1, name: 'Фонарь', emoji: '🏮', coins: 40, desc: 'Горит ночью. Нажми на него в деревне — погаснет или зажжётся.' },
  { id: 'v:lantern:2', kind: 'light', type: 'lantern', n: 2, name: 'Второй фонарь', emoji: '🏮', coins: 40, requires: 'v:lantern:1' },
  { id: 'v:lantern:3', kind: 'light', type: 'lantern', n: 3, name: 'Третий фонарь', emoji: '🏮', coins: 50, requires: 'v:lantern:2' },
  { id: 'v:lantern:4', kind: 'light', type: 'lantern', n: 4, name: 'Четвёртый фонарь', emoji: '🏮', coins: 60, requires: 'v:lantern:3' },
  { id: 'v:daynight', kind: 'sky', type: 'daynight', name: 'Смена дня и ночи', emoji: '🌗', gems: 3, desc: 'Солнце и луна: смена каждые 5 минут или по настоящим часам (настраивается).' },
  { id: 'v:fireflies', kind: 'sky', type: 'fireflies', name: 'Светлячки', emoji: '✨', coins: 70, desc: 'Летают над травой в сумерках.' },
  { id: 'v:aurora', kind: 'sky', type: 'aurora', name: 'Северное сияние', emoji: '🌌', gems: 20, desc: 'Переливается в ночном небе.' },
  // Декор
  { id: 'v:flowers', kind: 'decor', type: 'flowers', name: 'Клумбы', emoji: '🌷', coins: 30, desc: 'Цветы вдоль тропинки.' },
  { id: 'v:bonfire', kind: 'decor', type: 'bonfire', name: 'Костёр', emoji: '🔥', coins: 90, desc: 'Жители греются у огня ночью.' },
  { id: 'v:pumpkins', kind: 'decor', type: 'pumpkins', name: 'Тыквы со свечами', emoji: '🎃', coins: 60, desc: 'Особенно уместны в готической деревне.' },
  { id: 'v:benches', kind: 'decor', type: 'benches', name: 'Скамейки', emoji: '🪑', coins: 45, desc: 'Жителям есть где посидеть.' },
  // Жители (pet:* — питомцы из 0.6, переезжают в деревню)
  { id: 'pet:cat', kind: 'char', char: 'cat', name: 'Кот Баюн', emoji: '🐈', coins: 60, desc: 'Гуляет по траве, гоняет светлячков, ночью спит у фонаря.' },
  { id: 'pet:kitten', kind: 'char', char: 'kitten', name: 'Котёнок Пиксель', emoji: '🐱', coins: 140, desc: 'Носится, прыгает и пристаёт к другим жителям.' },
  { id: 'pet:fox', kind: 'char', char: 'fox', name: 'Лисичка Искра', emoji: '🦊', coins: 160, desc: 'Бегает по холмам и роет норки.' },
  { id: 'pet:spider', kind: 'char', char: 'spider', name: 'Паучок Ниточка', emoji: '🕷️', coins: 90, desc: 'Спускается на паутинке с крыш.' },
  { id: 'pet:neko', kind: 'char', char: 'neko', name: 'Нэко', emoji: '🐾', coins: 280, desc: 'Кошкодевочка, хранительница планов. Машет тебе из леса.' },
  { id: 'v:char:shroom', kind: 'char', char: 'shroom', name: 'Грибочек Пуф', emoji: '🍄', coins: 70, desc: 'Прыгает пружинкой, прячется в траве.' },
  { id: 'v:char:slime', kind: 'char', char: 'slime', name: 'Слизнюк Желейка', emoji: '🟢', coins: 90, desc: 'Плюхается и растекается от радости.' },
  { id: 'v:char:miner', kind: 'char', char: 'miner', name: 'Шахтёр Гоша', emoji: '⛏️', coins: 150, desc: 'Ходит в шахты и выносит добычу.' },
  { id: 'v:char:builder', kind: 'char', char: 'builder', name: 'Строитель Мира', emoji: '👷', coins: 150, desc: 'Строит в мастерской, пока ты в фокус-сессии.' },
  { id: 'v:char:archer', kind: 'char', char: 'archer', name: 'Лучница Ветка', emoji: '🏹', gems: 8, desc: 'Тренируется, стреляет по мишени и охраняет лес.' },
  { id: 'v:char:witch', kind: 'char', char: 'witch', name: 'Ведьма Полынь', emoji: '🧙‍♀️', gems: 10, desc: 'Ночью летает на метле.' },
  { id: 'v:char:knight', kind: 'char', char: 'knight', name: 'Рыцарь Тяж', emoji: '🛡️', gems: 12, big: true, desc: 'Большой и добрый. Патрулирует деревню.' },
  { id: 'v:char:ghost', kind: 'char', char: 'ghost', name: 'Призрак Шу', emoji: '👻', gems: 6, desc: 'Появляется только ночью, парит над крышами.' },
  { id: 'v:char:dragon', kind: 'char', char: 'dragon', name: 'Дракончик Уголёк', emoji: '🐉', gems: 30, big: true, desc: 'Гордость деревни. Взлетает, когда ты закрываешь важные задачи.' },
];

export const villageItem = (id) => VILLAGE_ITEMS.find((x) => x.id === id) || null;

/** Что есть в деревне с самого начала (покупать не нужно). */
export const BASE_VILLAGE = ['base:house', 'base:wanderer'];

// ---------- Покупки ----------

const liveEvents = (data) => [...data.coinEvents.values()].filter((e) => !e.deletedAt && e.active);

/** Купленные предметы деревни (активные покупки) + базовые. */
export function ownedVillage(data) {
  const out = new Set(BASE_VILLAGE);
  for (const e of liveEvents(data)) if (e.type === 'purchase' && e.itemId && villageItem(e.itemId)) out.add(e.itemId);
  return out;
}

/** Уровень постройки type (сколько уровней куплено) на момент atIso (или сейчас). */
export function levelAt(data, type, atIso = null) {
  let n = 0;
  for (const e of liveEvents(data)) {
    if (e.type !== 'purchase' || !e.itemId) continue;
    const it = villageItem(e.itemId);
    if (!it || it.type !== type) continue;
    if (atIso && (e.at || '') > atIso) continue;
    n = Math.max(n, it.n || 1);
  }
  return n;
}

/** Множитель монет за задачи от золотой шахты на момент atIso: ×1.1 / 1.2 / 1.3. */
export const coinMultiplierAt = (data, atIso = null) => 1 + 0.1 * levelAt(data, 'goldmine', atIso);

/** Изумруды за одно начисление: шахта уровня L даёт L за важную задачу (монет ≥ 10), 2L за критичную (≥ 20). */
export function gemsForAward(amount, level) {
  if (!level) return 0;
  if (amount >= 20) return 2 * level;
  if (amount >= 10) return level;
  return 0;
}

/** Изумруды за фокус-сессию: 1 за каждые 25 минут (от 15 минут — уже 1), шахта ур. 2+ добавляет +1. */
export function gemsForFocus(minutes, gemLevel = 0) {
  if (minutes < 15) return 0;
  return Math.max(1, Math.round(minutes / 25)) + (gemLevel >= 2 ? 1 : 0);
}

/** Баланс изумрудов: добыча шахт по начислениям + фокус-сессии + траты (поле gems у событий). */
export function gemBalance(data) {
  let s = 0;
  for (const e of liveEvents(data)) {
    if (e.type === 'award') s += gemsForAward(e.amount | 0, levelAt(data, 'gemmine', e.at));
    if (Number.isFinite(e.gems)) s += e.gems | 0;
  }
  return s;
}

/** Сколько изумрудов добыто всего (без трат) — для статистики деревни. */
export function gemsEarned(data) {
  let s = 0;
  for (const e of liveEvents(data)) {
    if (e.type === 'award') s += gemsForAward(e.amount | 0, levelAt(data, 'gemmine', e.at));
    if ((e.gems | 0) > 0) s += e.gems | 0;
  }
  return s;
}

/** Можно ли купить: { ok, reason } (цена, требования, уже куплено). coinBalance — из core/game.js balance(). */
export function canBuy(data, item, coinBalance) {
  if (!item) return { ok: false, reason: 'Нет такого предмета' };
  const owned = ownedVillage(data);
  if (owned.has(item.id)) return { ok: false, reason: 'Уже есть' };
  if (item.requires && !owned.has(item.requires)) return { ok: false, reason: `Сначала: ${villageItem(item.requires)?.name}` };
  if (item.gems && gemBalance(data) < item.gems) return { ok: false, reason: `Не хватает ${item.gems - gemBalance(data)} 💎` };
  if (item.coins && coinBalance < item.coins) return { ok: false, reason: `Не хватает ${item.coins - coinBalance} 🪙` };
  return { ok: true, reason: '' };
}

// ---------- Фокус-сессии ----------

export const FOCUS_PRESETS = [15, 25, 45, 60, 90];

/** Поля события фокус-сессии для журнала coinEvents (amount = 0: монеты не меняются). */
export function focusFields({ minutes, taskId = null, title = '', gemLevel = 0 }) {
  return { type: 'focus', amount: 0, gems: gemsForFocus(minutes, gemLevel), minutes: Math.round(minutes), taskId, title };
}

/** Минуты фокуса за день (по событиям focus). */
export function focusMinutes(data, tz, day) {
  let m = 0;
  for (const e of liveEvents(data)) if (e.type === 'focus' && e.at && localDateOf(e.at, tz) === day) m += e.minutes | 0;
  return m;
}

// ---------- Настроение жителей ----------

const MOODS = [
  [85, 'Ликуют', '🤩'], [65, 'Довольны', '😊'], [45, 'Спокойны', '🙂'], [25, 'Грустят', '😕'], [0, 'Унывают', '😢'],
];

/**
 * Настроение 0…100: выполненные за 3 дня (вес — важность задачи: монеты её приоритета), фокус сегодня,
 * минус просроченные. → { value, label, emoji, parts }
 */
export function happiness(data, tz, today) {
  const weight = new Map([[today, 1], [addDays(today, -1), 0.6], [addDays(today, -2), 0.35]]);
  const prio = (id) => {
    const p = data.priorities.get(id) || data.priorities.get(PRIORITY_NONE_ID);
    return Math.max(0, p?.coins | 0);
  };
  let done = 0;
  for (const e of doneEntries(data, tz)) {
    const w = weight.get(e.date);
    if (w) done += w * (2 + Math.min(20, prio(e.priorityId)));
  }
  let overdue = 0;
  for (const t of data.tasks.values()) {
    if (t.deletedAt || t.trashedAt || t.status !== 'active') continue;
    if ((t.scheduledDate && t.scheduledDate < today) || (t.deadlineDate && t.deadlineDate < today)) overdue++;
  }
  const focus = Math.min(20, focusMinutes(data, tz, today) / 5);
  const penalty = Math.min(40, overdue * 6);
  const value = Math.max(0, Math.min(100, Math.round(35 + done * 1.2 + focus - penalty)));
  const [, label, emoji] = MOODS.find(([min]) => value >= min);
  return { value, label, emoji, parts: { done: Math.round(done), focus: Math.round(focus), overdue } };
}

// ---------- Стиль деревни ----------

/** Стиль по цветовой схеме приложения: фиолетовая — готика, лаймовая — сказочный луг и т. д. */
export const VILLAGE_STYLES = {
  indigo: { name: 'Классическая деревня', roof: '#b0473b', wall: '#e8d5b0', wood: '#7a4f2c', grass: '#4f9a4a', grass2: '#3c7d3a', hill: '#5aa654', far: '#6c8fb8', accent: '#3949ab' },
  lavender: { name: 'Готическая деревня', roof: '#3b2d52', wall: '#8f86a3', wood: '#3a2a3f', grass: '#4b5d4a', grass2: '#394737', hill: '#55634f', far: '#5c4b7a', accent: '#9a6cf0', gothic: true },
  lime: { name: 'Сказочный луг', roof: '#e07a3b', wall: '#fff2cf', wood: '#8a5a2b', grass: '#7cc44a', grass2: '#5fa83a', hill: '#8fd05a', far: '#86b8d8', accent: '#5b8c00', meadow: true },
  ocean: { name: 'Приморская деревня', roof: '#2f7d9c', wall: '#f1ead8', wood: '#6b4e33', grass: '#5aa77a', grass2: '#468c63', hill: '#68b58a', far: '#5aa0c0', accent: '#00796b', sea: true },
  sunset: { name: 'Осенняя деревня', roof: '#9c3b23', wall: '#f0d2a8', wood: '#6e3f22', grass: '#b8913e', grass2: '#9c7531', hill: '#c79d47', far: '#c97a5c', accent: '#d84315', autumn: true },
};

export const villageStyle = (scheme) => VILLAGE_STYLES[scheme] || VILLAGE_STYLES.indigo;

// ---------- Время суток ----------

/**
 * Фаза суток 0…1 (0 и 1 — полночь, 0.5 — полдень).
 * mode: 'theme' (светлая тема — день, тёмная — вечер), 'cycle' (5 минут день + 5 минут ночь), 'real' (по часам устройства).
 */
export function dayPhase(mode, nowMs, { dark = false, hour = null } = {}) {
  if (mode === 'cycle') {
    const period = 10 * 60000; // 5 минут день + 5 минут ночь
    const p = (nowMs % period) / period; // 0…1
    return (p + 0.25) % 1; // начинаем с утра
  }
  if (mode === 'real') {
    const h = hour ?? new Date(nowMs).getHours() + new Date(nowMs).getMinutes() / 60;
    return h / 24;
  }
  return dark ? 0.77 : 0.5; // тёмная тема — тёплый вечер: горят фонари и окна, но жители ещё гуляют
}

/** Насколько темно (0 — день, 1 — глубокая ночь) по фазе суток. */
export function nightness(phase) {
  const d = Math.cos(phase * Math.PI * 2); // 1 — полночь, −1 — полдень
  return Math.max(0, Math.min(1, (d + 0.25) / 0.9));
}
