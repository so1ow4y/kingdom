// Навыки (обновление 0.8): каждый список — навык со своим уровнем, как ремесло персонажа в играх. Чистые функции.
//
// Опыт навыка не хранится: это сумма опыта за все выполнения задач этого списка (живые выполненные задачи,
// выполненные экземпляры повторов и сводки удалённых лимитом хранения — core/retention.js doneEntries). Сколько
// опыта даёт выполнение — поле xp приоритета (настраивается, как монеты); у задачи в двух списках опыт получают оба.
// Уровни 1…100, каждому следующему нужно всё больше опыта. На 100-м уровне можно «повысить престиж» (как в Payday 2):
// уровень снова 1, престиж +1 (показывается римскими цифрами). Хранится только это: у списка поля prestige (сколько
// раз) и prestigeXp (сколько опыта «потрачено» на престижи) — синхронизируются как обычные поля списка.

import { doneEntries } from './retention.js';
import { PRIORITY_NONE_ID } from './priorities.js';
import { tr } from './i18n.js';

export const MAX_LEVEL = 100;

/** Опыт по умолчанию для базовых приоритетов (если в приоритете нет поля xp). */
export const DEFAULT_XP = {
  [PRIORITY_NONE_ID]: 5,
  '00000000-0000-7000-8000-000000000201': 10,
  '00000000-0000-7000-8000-000000000202': 20,
  '00000000-0000-7000-8000-000000000203': 35,
  '00000000-0000-7000-8000-000000000204': 60,
};

/** Сколько опыта даёт выполнение задачи с этим приоритетом. */
export function xpOfPriority(p) {
  if (!p) return DEFAULT_XP[PRIORITY_NONE_ID];
  if (Number.isFinite(p.xp)) return Math.max(0, Math.round(p.xp));
  return DEFAULT_XP[p.id] ?? Math.max(5, Math.round((p.coins | 0) * 3));
}

/** Опыт, нужный, чтобы с уровня L перейти на L + 1 (растёт с уровнем). */
export const needForLevel = (L) => (L >= MAX_LEVEL ? 0 : Math.round(20 + 1.2 * (L - 1) + 0.01 * (L - 1) ** 2));

// CUM[L] — сколько опыта нужно от 1-го уровня до L-го
const CUM = [0, 0];
for (let L = 1; L < MAX_LEVEL; L++) CUM[L + 1] = CUM[L] + needForLevel(L);
export const xpToLevel = (L) => CUM[Math.max(1, Math.min(MAX_LEVEL, L))];

/** Уровень по опыту: { level, into (опыт внутри уровня), need (до следующего), progress 0…1, max }. */
export function levelOf(xp) {
  const v = Math.max(0, Math.floor(xp) || 0);
  let lo = 1;
  let hi = MAX_LEVEL;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (CUM[mid] <= v) lo = mid;
    else hi = mid - 1;
  }
  const need = needForLevel(lo);
  const into = lo >= MAX_LEVEL ? 0 : v - CUM[lo];
  return { level: lo, into, need, progress: need ? into / need : 1, max: lo >= MAX_LEVEL };
}

/** Римские цифры (престиж «как в Payday 2»): 1 → I, 4 → IV, 25 → XXV. 0 → ''. */
export function roman(n) {
  let v = Math.max(0, Math.min(3999, Math.floor(n) || 0));
  let out = '';
  for (const [k, s] of [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]) {
    while (v >= k) {
      out += s;
      v -= k;
    }
  }
  return out;
}

/** Опыт и число выполнений по спискам: Map<listId, { xp, done }>. */
export function listTotals(data) {
  const out = new Map();
  const xpCache = new Map();
  const xpFor = (pid) => {
    if (!xpCache.has(pid)) xpCache.set(pid, xpOfPriority(data.priorities.get(pid) || data.priorities.get(PRIORITY_NONE_ID)));
    return xpCache.get(pid);
  };
  for (const e of doneEntries(data, 'UTC')) {
    const xp = xpFor(e.priorityId || PRIORITY_NONE_ID);
    for (const id of e.listIds || []) {
      const s = out.get(id) || { xp: 0, done: 0 };
      s.xp += xp;
      s.done += 1;
      out.set(id, s);
    }
  }
  return out;
}

/** Ступень «возраста» хранителя навыка: 0 ученик … 4 магистр. */
export function stageOf(prestige, level) {
  if (prestige >= 3) return 4;
  if (prestige >= 1) return 3;
  if (level >= 60) return 2;
  if (level >= 20) return 1;
  return 0;
}

export const STAGES = [
  { f: tr('Ученица'), m: tr('Ученик') },
  { f: tr('Подмастерье'), m: tr('Подмастерье') },
  { f: tr('Знаток'), m: tr('Знаток') },
  { f: tr('Мастер'), m: tr('Мастер') },
  { f: tr('Магистр'), m: tr('Магистр') },
];

/** Симпатия по числу выполненных задач списка: 0…5 сердечек. */
const AFFINITY = [0, 3, 10, 30, 70, 150];
export const AFFINITY_NAMES = [tr('Незнакомы'), tr('Знакомы'), tr('Приятели'), tr('Друзья'), tr('Близкие друзья'), tr('Лучшие друзья')];
export function affinityOf(done) {
  let tier = 0;
  while (tier < AFFINITY.length - 1 && done >= AFFINITY[tier + 1]) tier++;
  const next = AFFINITY[tier + 1] ?? null;
  return { tier, name: AFFINITY_NAMES[tier], next, toNext: next == null ? 0 : next - done };
}

/** Навык списка: опыт всего, потрачено на престижи, текущий уровень и престиж. totals — из listTotals (для скорости). */
export function skillOf(data, list, totals = null) {
  const t = (totals || listTotals(data)).get(list.id) || { xp: 0, done: 0 };
  const prestige = Math.max(0, list.prestige | 0);
  const spent = Math.max(0, list.prestigeXp | 0);
  const xp = Math.max(0, t.xp - spent);
  const lv = levelOf(xp);
  return {
    listId: list.id, total: t.xp, done: t.done, spent, xp, prestige, roman: roman(prestige),
    ...lv, stage: stageOf(prestige, lv.level), affinity: affinityOf(t.done),
  };
}

/** Навыки всех живых списков: Map<listId, skill>. */
export function allSkills(data) {
  const totals = listTotals(data);
  const out = new Map();
  for (const l of data.lists.values()) if (!l.deletedAt) out.set(l.id, skillOf(data, l, totals));
  return out;
}

/** Подпись навыка: «II · 37» (или «37», пока престижа нет). */
export const skillLabel = (s) => (s.prestige ? `${s.roman} · ${s.level}` : String(s.level));
