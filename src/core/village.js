// Деревня (обновление 0.7): постройки, жители, свет и небо, вторая валюта — изумруды (💎), настроение жителей.
// Чистые функции без браузера.
//
// Всё, что куплено, — события purchase в журнале coinEvents (синхронизируются, как и раньше). Изумруды не хранятся
// числом: баланс 💎 = добыча изумрудных шахт (считается по начислениям за задачи и времени покупки шахты)
// + изумруды за фокус-сессии (события type 'focus', поле gems) − траты (поле gems < 0 у покупок за изумруды).
// У покупок за изумруды amount = 0, поэтому старые версии приложения считают монеты по-прежнему верно.
// 0.12.4 — прокачка построек «как в Clash of Clans»: уровни 1…5, у каждого уровня своя цена (растёт), постройка
// выглядит богаче, бонус больше. Улучшение — тоже покупка (itemId 'v:upgrade', target — id постройки, level — новый
// уровень); продаётся вместе с постройкой. Старые версии приложения улучшения не видят, но монеты считают верно.
// Замок (0.12.4) — большая тёмная крепость с багровыми знамёнами.

import { localDateOf, addDays } from './dates.js';
import { doneEntries } from './retention.js';
import { PRIORITY_NONE_ID } from './priorities.js';
import { extraEarnings } from './earnings.js';

// ---------- Каталог ----------

/**
 * kind: building | light | sky | decor | char. coins / gems — цена (одно из двух). requires — что нужно купить раньше.
 * place — тип объекта на карте (у того, что ставится в деревню); repeatable — можно купить сколько угодно,
 * цена растёт на step за каждый уже стоящий объект того же типа. legacy — больше не продаётся, но купленное работает.
 * Жители со старыми id (pet:*) — это питомцы из 0.6: купленные раньше переезжают в деревню.
 */
export const VILLAGE_ITEMS = [
  // Постройки
  { id: 'v:house', kind: 'building', place: 'house', repeatable: true, name: 'Домик', emoji: '🏠', coins: 120, step: 40, desc: 'Крыша для жителей, ночью в окнах свет. Можно ставить сколько угодно — деревня сама расширится.' },
  { id: 'v:manor', kind: 'building', place: 'manor', repeatable: true, name: 'Дом с мансардой', emoji: '🏘️', gems: 6, step: 2, desc: 'Большой двухэтажный дом со слуховыми окнами и флюгером.' },
  { id: 'v:house:2', kind: 'building', place: 'house', legacy: true, name: 'Второй домик', emoji: '🏠', coins: 120 },
  { id: 'v:house:3', kind: 'building', place: 'house', legacy: true, name: 'Третий домик', emoji: '🏡', coins: 220 },
  { id: 'v:house:4', kind: 'building', place: 'manor', legacy: true, name: 'Дом с мансардой', emoji: '🏘️', gems: 6 },
  { id: 'v:mine-gold:1', kind: 'building', place: 'goldmine', type: 'goldmine', n: 1, name: 'Золотая шахта', emoji: '⛏️', coins: 300, desc: '+10 % монет за каждую выполненную задачу.' },
  { id: 'v:mine-gold:2', kind: 'building', place: 'goldmine', type: 'goldmine', n: 2, upgrade: true, name: 'Золотая шахта · ур. 2', emoji: '⛏️', coins: 650, requires: 'v:mine-gold:1', desc: '+20 % монет за задачи.' },
  { id: 'v:mine-gold:3', kind: 'building', place: 'goldmine', type: 'goldmine', n: 3, upgrade: true, name: 'Золотая шахта · ур. 3', emoji: '⛏️', gems: 15, requires: 'v:mine-gold:2', desc: '+30 % монет за задачи.' },
  { id: 'v:mine-gem:1', kind: 'building', place: 'gemmine', type: 'gemmine', n: 1, name: 'Изумрудная шахта', emoji: '💎', coins: 400, desc: '+1 💎 за каждую выполненную важную задачу (приоритет «Высокий» и выше), за критичную — вдвое.' },
  { id: 'v:mine-gem:2', kind: 'building', place: 'gemmine', type: 'gemmine', n: 2, upgrade: true, name: 'Изумрудная шахта · ур. 2', emoji: '💎', gems: 10, requires: 'v:mine-gem:1', desc: '+2 💎 за важную задачу и бонус к фокус-сессиям.' },
  { id: 'v:mine-gem:3', kind: 'building', place: 'gemmine', type: 'gemmine', n: 3, upgrade: true, name: 'Изумрудная шахта · ур. 3', emoji: '💎', gems: 25, requires: 'v:mine-gem:2', desc: '+3 💎 за важную задачу.' },
  { id: 'v:forge', kind: 'building', place: 'forge', name: 'Мастерская', emoji: '🔨', coins: 180, desc: 'Во время фокус-сессии строитель работает здесь.' },
  { id: 'v:windmill', kind: 'building', place: 'windmill', name: 'Мельница', emoji: '🌾', coins: 220, desc: 'Крутится, когда жители довольны.' },
  { id: 'v:tavern', kind: 'building', place: 'tavern', name: 'Таверна', emoji: '🍺', coins: 350, desc: 'Вечером жители собираются здесь поболтать.' },
  { id: 'v:tower', kind: 'building', place: 'tower', name: 'Сторожевая башня', emoji: '🚩', gems: 12, desc: 'Флаг цвета твоей иконки приложения.' },
  { id: 'v:castle', kind: 'building', place: 'castle', name: 'Чёрный замок', emoji: '🏰', coins: 2500, big: true,
    desc: 'Тёмная крепость с багровыми знамёнами и огнём в бойницах. +5 % монет и наград за еду за каждый уровень, жители спокойнее.' },
  { id: 'v:fountain', kind: 'building', place: 'fountain', name: 'Фонтан', emoji: '⛲', gems: 5, desc: 'Сначала встаёт посреди площади, но его можно переставить.' },
  { id: 'v:field', kind: 'building', place: 'field', repeatable: true, name: 'Огород', emoji: '🥕', coins: 60, step: 20, desc: 'Грядки за заборчиком. Урожай зависит от стиля деревни.' },
  // Свет и небо
  { id: 'v:lantern', kind: 'light', place: 'lantern', repeatable: true, name: 'Фонарь', emoji: '🏮', coins: 40, step: 5, desc: 'Горит ночью. Нажми на него в деревне — погаснет или зажжётся.' },
  { id: 'v:lantern:1', kind: 'light', place: 'lantern', legacy: true, name: 'Фонарь', emoji: '🏮', coins: 40 },
  { id: 'v:lantern:2', kind: 'light', place: 'lantern', legacy: true, name: 'Второй фонарь', emoji: '🏮', coins: 40 },
  { id: 'v:lantern:3', kind: 'light', place: 'lantern', legacy: true, name: 'Третий фонарь', emoji: '🏮', coins: 50 },
  { id: 'v:lantern:4', kind: 'light', place: 'lantern', legacy: true, name: 'Четвёртый фонарь', emoji: '🏮', coins: 60 },
  { id: 'v:daynight', kind: 'sky', type: 'daynight', name: 'Смена дня и ночи', emoji: '🌗', gems: 3, desc: 'Смена каждые 5 минут или по настоящим часам (настраивается).' },
  { id: 'v:fireflies', kind: 'sky', type: 'fireflies', name: 'Светлячки', emoji: '✨', coins: 70, desc: 'Летают над травой в сумерках.' },
  { id: 'v:aurora', kind: 'sky', type: 'aurora', name: 'Северное сияние', emoji: '🌌', gems: 20, desc: 'Ночью по деревне переливаются отсветы.' },
  // Декор
  { id: 'v:flowers', kind: 'decor', type: 'flowers', name: 'Цветы по всей деревне', emoji: '🌼', coins: 30, desc: 'Цветы в траве и ящики с цветами на окнах.' },
  { id: 'v:flowerbed', kind: 'decor', place: 'flowerbed', repeatable: true, name: 'Клумба', emoji: '🌷', coins: 25, step: 0, desc: 'Деревянная клумба с цветами.' },
  { id: 'v:tree', kind: 'decor', place: 'tree', repeatable: true, name: 'Дерево', emoji: '🌳', coins: 20, step: 0, desc: 'Посади где хочешь.' },
  { id: 'v:bench', kind: 'decor', place: 'bench', repeatable: true, name: 'Скамейка', emoji: '🪑', coins: 30, step: 0, desc: 'Жители на ней сидят.' },
  { id: 'v:pumpkin', kind: 'decor', place: 'pumpkin', repeatable: true, name: 'Тыквы со свечами', emoji: '🎃', coins: 35, step: 0, desc: 'Ночью светятся.' },
  { id: 'v:bonfire', kind: 'decor', place: 'bonfire', name: 'Костёр', emoji: '🔥', coins: 90, desc: 'Жители греются у огня вечером и ночью.' },
  { id: 'v:benches', kind: 'decor', place: 'bench', legacy: true, name: 'Скамейки', emoji: '🪑', coins: 45 },
  { id: 'v:pumpkins', kind: 'decor', place: 'pumpkin', legacy: true, name: 'Тыквы со свечами', emoji: '🎃', coins: 60 },
  // Жители (pet:* — питомцы из 0.6, переезжают в деревню)
  { id: 'pet:cat', kind: 'char', char: 'cat', name: 'Кот Баюн', emoji: '🐈', coins: 60, desc: 'Гуляет по траве, гоняет светлячков, ночью спит у фонаря.' },
  { id: 'pet:kitten', kind: 'char', char: 'kitten', name: 'Котёнок Пиксель', emoji: '🐱', coins: 140, desc: 'Носится, прыгает и пристаёт к другим жителям.' },
  { id: 'pet:fox', kind: 'char', char: 'fox', name: 'Лисичка Искра', emoji: '🦊', coins: 160, desc: 'Бегает по холмам и роет норки.' },
  { id: 'pet:spider', kind: 'char', char: 'spider', name: 'Паучок Ниточка', emoji: '🕷️', coins: 90, desc: 'Спускается на паутинке с деревьев.' },
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

// ---------- Прокачка построек (0.12.4) ----------

export const UPGRADE_ITEM = 'v:upgrade';
export const MAX_LEVEL = 5;

/**
 * Цена перехода на уровень 2…5 ({ coins } или { gems }; у шахт уровни 2–3 — прежние покупки «· ур. 2/3») и бонус.
 * bonus: coins — % монет за задачи, food — % наград за еду (Crimson Harvest), mood — к настроению жителей,
 * focus — 💎 за фокус-сессию. per — сколько даёт каждый уровень выше первого (у замка и шахт — каждый уровень).
 */
export const UPGRADES = {
  house: { cost: [{ coins: 180 }, { coins: 300 }, { coins: 480 }, { coins: 720 }], bonus: 'coins', per: 1 },
  manor: { cost: [{ gems: 8 }, { gems: 12 }, { gems: 18 }, { gems: 26 }], bonus: 'coins', per: 2 },
  goldmine: { cost: [null, null, { gems: 30 }, { gems: 50 }], bonus: 'coins', per: 10, fromOne: true },
  gemmine: { cost: [null, null, { gems: 40 }, { gems: 60 }], bonus: 'gems', per: 1, fromOne: true },
  forge: { cost: [{ coins: 260 }, { coins: 400 }, { coins: 600 }, { coins: 900 }], bonus: 'focus', per: 0.5 },
  windmill: { cost: [{ coins: 300 }, { coins: 450 }, { coins: 700 }, { coins: 1000 }], bonus: 'food', per: 5 },
  tavern: { cost: [{ coins: 500 }, { coins: 750 }, { coins: 1100 }, { coins: 1600 }], bonus: 'mood', per: 4 },
  tower: { cost: [{ gems: 16 }, { gems: 22 }, { gems: 30 }, { gems: 40 }], bonus: 'coins', per: 2 },
  fountain: { cost: [{ gems: 7 }, { gems: 10 }, { gems: 14 }, { gems: 20 }], bonus: 'mood', per: 3 },
  field: { cost: [{ coins: 90 }, { coins: 130 }, { coins: 190 }, { coins: 270 }], bonus: 'food', per: 3 },
  castle: { cost: [{ coins: 3500 }, { coins: 5000 }, { gems: 60 }, { gems: 90 }], bonus: 'castle', per: 5, fromOne: true },
};

/** Предел суммы бонусов деревни. */
export const BONUS_CAP = { coins: 200, food: 100, mood: 30 };

export const isUpgradable = (place) => !!UPGRADES[place];

/** Сколько бонуса у постройки уровня level: { coins, food, mood, focus } (только ненулевые). */
export function bonusOf(place, level) {
  const u = UPGRADES[place];
  if (!u || !level) return {};
  const steps = u.fromOne ? level : level - 1;
  if (u.bonus === 'castle') return { coins: 5 * level, food: 5 * level, mood: 2 * level };
  if (u.bonus === 'gems') return {};
  if (u.bonus === 'focus') return { focus: Math.floor(steps * u.per) };
  return { [u.bonus]: steps * u.per };
}

/** «+3 % монет за задачи», «+2 💎 за важную задачу» — подпись бонуса постройки уровня level. */
export function bonusText(place, level) {
  const u = UPGRADES[place];
  if (!u) return '';
  if (u.bonus === 'gems') return `+${level} 💎 за важную задачу${level >= 2 ? ', +1 💎 за фокус' : ''}`;
  const b = bonusOf(place, level);
  const parts = [];
  if (b.coins) parts.push(`+${b.coins} % монет за задачи`);
  if (b.food) parts.push(`+${b.food} % наград за еду`);
  if (b.mood) parts.push(`настроение +${b.mood}`);
  if (b.focus) parts.push(`+${b.focus} 💎 за фокус`);
  return parts.join(', ') || 'бонус — со 2-го уровня';
}

/** Что есть в деревне с самого начала (покупать не нужно). */
export const BASE_VILLAGE = ['base:house', 'base:wanderer'];

/** Что показывать в магазине: без старых (legacy) и без уровней шахт, кроме следующего. */
export const shopItems = () => VILLAGE_ITEMS.filter((it) => !it.legacy);

// ---------- Покупки ----------

const liveEvents = (data) => [...data.coinEvents.values()].filter((e) => !e.deletedAt && e.active);
const byAt = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const num = (v) => (Number.isInteger(v) ? v : null);

/** Купленные предметы деревни (активные покупки) + базовые. Для повторяемых — просто «есть хотя бы один». */
export function ownedVillage(data) {
  const out = new Set(BASE_VILLAGE);
  for (const e of liveEvents(data)) if (e.type === 'purchase' && e.itemId && villageItem(e.itemId)) out.add(e.itemId);
  return out;
}

/**
 * Объекты на карте деревни — по одному на каждую покупку того, что ставится (place). Шахта — один объект на тип,
 * уровень — по купленным уровням, позицию хранит самая ранняя её покупка. x, y — клетка левого верхнего угла
 * относительно центра площади (null — ещё не ставили вручную, место выберется само).
 * 0.12.4: улучшения (UPGRADE_ITEM) поднимают уровень своей постройки (target) и продаются вместе с ней.
 * atIso — какой деревня была на этот момент (для бонусов: награда считается по деревне на момент выполнения).
 * → [{ key, itemId, place, level, x, y, events: [id], at }]
 */
export function villageObjects(data, atIso = null) {
  const out = [];
  const mines = new Map();
  const events = liveEvents(data).filter((e) => e.type === 'purchase' && e.itemId && (!atIso || (e.at || '') <= atIso)).sort(byAt);
  const ups = [];
  for (const e of events) {
    if (e.itemId === UPGRADE_ITEM) {
      ups.push(e);
      continue;
    }
    const it = villageItem(e.itemId);
    if (!it?.place) continue;
    if (it.type === 'goldmine' || it.type === 'gemmine') {
      const m = mines.get(it.type);
      if (m) {
        m.level = Math.max(m.level, it.n);
        m.events.push(e.id);
        continue;
      }
      const o = { key: e.id, itemId: e.itemId, place: it.place, level: it.n, x: num(e.x), y: num(e.y), events: [e.id], at: e.at };
      mines.set(it.type, o);
      out.push(o);
      continue;
    }
    out.push({ key: e.id, itemId: e.itemId, place: it.place, level: 1, x: num(e.x), y: num(e.y), events: [e.id], at: e.at });
  }
  if (ups.length) {
    const byKey = new Map(out.map((o) => [o.key, o]));
    for (const e of ups) {
      const o = byKey.get(e.target);
      if (!o || !isUpgradable(o.place) || !Number.isInteger(e.level)) continue;
      o.level = Math.max(o.level, Math.min(MAX_LEVEL, e.level));
      o.events.push(e.id);
    }
  }
  return out;
}

/**
 * Следующий уровень постройки: { level, price: { coins } | { gems }, itemId? } или null (уже 5-й или не прокачивается).
 * У шахт уровни 2–3 — прежние покупки «· ур. 2/3» (itemId), дальше — улучшения.
 */
export function nextUpgrade(obj) {
  const u = obj && UPGRADES[obj.place];
  if (!u || obj.level >= MAX_LEVEL) return null;
  const level = obj.level + 1;
  if ((obj.place === 'goldmine' || obj.place === 'gemmine') && level <= 3) {
    const it = VILLAGE_ITEMS.find((x) => x.type === obj.place && x.n === level);
    return it ? { level, price: it.gems ? { gems: it.gems } : { coins: it.coins }, itemId: it.id } : null;
  }
  const price = u.cost[level - 2];
  return price ? { level, price } : null;
}

/** Можно ли улучшить: { ok, reason }. */
export function canUpgrade(data, obj, coinBalance) {
  const nu = nextUpgrade(obj);
  if (!nu) return { ok: false, reason: obj && isUpgradable(obj.place) ? 'Максимальный уровень' : 'Не улучшается' };
  if (nu.price.gems && gemBalance(data) < nu.price.gems) return { ok: false, reason: `Не хватает ${nu.price.gems - gemBalance(data)} 💎` };
  if (nu.price.coins && coinBalance < nu.price.coins) return { ok: false, reason: `Не хватает ${nu.price.coins - coinBalance} 🪙` };
  return { ok: true, reason: '' };
}

/**
 * Бонусы деревни на момент atIso (или сейчас): { coins: %, food: %, mood, focus: 💎 } — сумма по постройкам
 * (у каждого дома и огорода — свой уровень), с пределами BONUS_CAP.
 */
export function villageBonuses(data, atIso = null) {
  const sum = { coins: 0, food: 0, mood: 0, focus: 0 };
  for (const o of villageObjects(data, atIso)) {
    const b = bonusOf(o.place, o.level);
    for (const k of Object.keys(sum)) sum[k] += b[k] || 0;
  }
  return {
    coins: Math.min(BONUS_CAP.coins, sum.coins),
    food: Math.min(BONUS_CAP.food, sum.food),
    mood: Math.min(BONUS_CAP.mood, sum.mood),
    focus: sum.focus,
  };
}

/** Цена с учётом повторов: { coins } или { gems }. */
export function priceOf(data, item) {
  if (!item) return { coins: 0 };
  let extra = 0;
  if (item.repeatable && item.step) {
    const n = villageObjects(data).filter((o) => o.place === item.place).length;
    extra = item.step * n;
  }
  return item.gems ? { gems: item.gems + extra } : { coins: (item.coins || 0) + extra };
}

/** Уровень шахты type на момент atIso (или сейчас); 0 — шахты нет. С 0.12.4 — и с улучшениями до 4–5. */
export function levelAt(data, type, atIso = null) {
  return levelLookup(data, type)(atIso);
}

/**
 * Быстрый поиск уровня шахты по времени (для баланса 💎 по тысячам начислений): моменты, когда уровень менялся.
 * → (atIso | null) => уровень.
 */
export function levelLookup(data, type) {
  const events = liveEvents(data).filter((e) => e.type === 'purchase' && e.itemId).sort(byAt);
  let key = null;
  let level = 0;
  const steps = [];
  for (const e of events) {
    const it = villageItem(e.itemId);
    if (it && it.type === type) {
      if (!key) key = e.id;
      if ((it.n || 1) > level) {
        level = it.n || 1;
        steps.push([e.at || '', level]);
      }
    } else if (e.itemId === UPGRADE_ITEM && key && e.target === key && Number.isInteger(e.level) && e.level > level) {
      level = Math.min(MAX_LEVEL, e.level);
      steps.push([e.at || '', level]);
    }
  }
  return (atIso = null) => {
    if (!atIso) return level;
    let lv = 0;
    for (const [at, l] of steps) {
      if (at > atIso) break;
      lv = l;
    }
    return lv;
  };
}

/**
 * Множитель монет за задачи на момент atIso: золотая шахта (+10 % за уровень), замок, дома, башня (0.12.4).
 */
export const coinMultiplierAt = (data, atIso = null) => 1 + villageBonuses(data, atIso).coins / 100;

/** Изумруды за одно начисление: шахта уровня L даёт L за важную задачу (монет ≥ 10), 2L за критичную (≥ 20). */
export function gemsForAward(amount, level) {
  if (!level) return 0;
  if (amount >= 20) return 2 * level;
  if (amount >= 10) return level;
  return 0;
}

/** Изумруды за фокус-сессию: 1 за каждые 25 минут (от 15 минут — уже 1), шахта ур. 2+ добавляет +1, мастерская — свои. */
export function gemsForFocus(minutes, gemLevel = 0, forge = 0) {
  if (minutes < 15) return 0;
  return Math.max(1, Math.round(minutes / 25)) + (gemLevel >= 2 ? 1 : 0) + (forge | 0);
}

/** Баланс изумрудов: добыча шахт по начислениям + фокус-сессии + 💎 за еду (0.12) + траты (поле gems у событий). */
export function gemBalance(data) {
  let s = extraEarnings().gems;
  const lv = levelLookup(data, 'gemmine');
  for (const e of liveEvents(data)) {
    if (e.type === 'award') s += gemsForAward(e.amount | 0, lv(e.at));
    if (Number.isFinite(e.gems)) s += e.gems | 0;
  }
  return s;
}

/** Сколько изумрудов добыто всего (без трат) — для статистики деревни. */
export function gemsEarned(data) {
  let s = extraEarnings().gems;
  const lv = levelLookup(data, 'gemmine');
  for (const e of liveEvents(data)) {
    if (e.type === 'award') s += gemsForAward(e.amount | 0, lv(e.at));
    if ((e.gems | 0) > 0) s += e.gems | 0;
  }
  return s;
}

/** Можно ли купить: { ok, reason } (цена, требования, уже куплено). coinBalance — из core/game.js balance(). */
export function canBuy(data, item, coinBalance) {
  if (!item) return { ok: false, reason: 'Нет такого предмета' };
  if (item.legacy) return { ok: false, reason: 'Больше не продаётся' };
  const owned = ownedVillage(data);
  if (!item.repeatable && owned.has(item.id)) return { ok: false, reason: 'Уже есть' };
  if (item.requires && !owned.has(item.requires)) return { ok: false, reason: `Сначала: ${villageItem(item.requires)?.name}` };
  const p = priceOf(data, item);
  if (p.gems && gemBalance(data) < p.gems) return { ok: false, reason: `Не хватает ${p.gems - gemBalance(data)} 💎` };
  if (p.coins && coinBalance < p.coins) return { ok: false, reason: `Не хватает ${p.coins - coinBalance} 🪙` };
  return { ok: true, reason: '' };
}

/**
 * Продажа объекта деревни: какие покупки вернуть и сколько вернётся. Продать нельзя, если изумруды этой шахты уже
 * потрачены (баланс 💎 ушёл бы в минус). → { events: [id], coins, gems, error }
 */
export function sellPlan(data, key) {
  const obj = villageObjects(data).find((o) => o.key === key);
  if (!obj) return { events: [], coins: 0, gems: 0, error: 'Этого уже нет в деревне' };
  let coins = 0;
  let gems = 0;
  for (const id of obj.events) {
    const e = data.coinEvents.get(id);
    coins += Math.abs(e.amount | 0);
    gems += Math.abs(e.gems | 0);
  }
  const test = { ...data, coinEvents: new Map(data.coinEvents) };
  for (const id of obj.events) test.coinEvents.set(id, { ...data.coinEvents.get(id), active: false });
  const error = gemBalance(test) < 0 ? 'Нельзя продать: изумруды из этой шахты уже потрачены' : null;
  return { events: obj.events, coins, gems, error, obj };
}

// ---------- Фокус-сессии ----------

export const FOCUS_PRESETS = [15, 25, 45, 60, 90];

/** Поля события фокус-сессии для журнала coinEvents (amount = 0: монеты не меняются). */
export function focusFields({ minutes, taskId = null, title = '', gemLevel = 0, forge = 0 }) {
  return { type: 'focus', amount: 0, gems: gemsForFocus(minutes, gemLevel, forge), minutes: Math.round(minutes), taskId, title };
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
  // таверна, фонтан и замок (0.12.4) — жителям уютнее
  const cozy = villageBonuses(data).mood;
  const value = Math.max(0, Math.min(100, Math.round(35 + done * 1.2 + focus + cozy - penalty)));
  const [, label, emoji] = MOODS.find(([min]) => value >= min);
  return { value, label, emoji, parts: { done: Math.round(done), focus: Math.round(focus), overdue, cozy } };
}

// ---------- Стиль деревни ----------

/** Стиль по цветовой схеме приложения: фиолетовая — готика, лаймовая — сказочный луг и т. д. */
// Палитры (0.7.1): тёмная насыщенная зелень, оранжевые черепичные крыши, голубая вода — в духе пиксельных RPG.
export const VILLAGE_STYLES = {
  indigo: {
    name: 'Классическая деревня', roof: '#cf6432', wall: '#efdfbd', wood: '#6b4a2b', grass: '#3b7436', grass2: '#2e6130', hill: '#447e3c',
    far: '#6c8fb8', accent: '#3949ab', path: '#a9865a', stone: '#8c8a84', water: '#3a7db5', cliff: '#7b6a58',
  },
  lavender: {
    name: 'Готическая деревня', roof: '#4b3768', wall: '#9c93ad', wood: '#3a2a3f', grass: '#35473a', grass2: '#2a3a30', hill: '#3c5040',
    far: '#5c4b7a', accent: '#9a6cf0', path: '#6e6676', stone: '#625e6e', water: '#3b4f78', cliff: '#5a5266', gothic: true,
  },
  lime: {
    name: 'Сказочный луг', roof: '#e07a3b', wall: '#fff2cf', wood: '#8a5a2b', grass: '#45863a', grass2: '#36702f', hill: '#57984a',
    far: '#86b8d8', accent: '#5b8c00', path: '#b8925e', stone: '#9a978e', water: '#3f8fc8', cliff: '#86735c', meadow: true,
  },
  ocean: {
    name: 'Приморская деревня', roof: '#2f7d9c', wall: '#f1ead8', wood: '#6b4e33', grass: '#3d7752', grass2: '#2f6346', hill: '#4a8a60',
    far: '#5aa0c0', accent: '#00796b', path: '#c2a678', stone: '#9a9a94', water: '#2f86b8', cliff: '#7d7468', sand: '#d8c48e', sea: true,
  },
  sunset: {
    name: 'Осенняя деревня', roof: '#9c3b23', wall: '#f0d2a8', wood: '#6e3f22', grass: '#66702f', grass2: '#535c28', hill: '#7a7a3a',
    far: '#c97a5c', accent: '#d84315', path: '#a8865a', stone: '#958a7c', water: '#3a73a0', cliff: '#82705a', autumn: true,
  },
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
