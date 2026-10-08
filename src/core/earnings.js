// Доходы игры из других приложений Kingdom (обновление 0.12): опыт, монеты и 💎 за еду в Crimson Harvest.
// Их не пишут событиями в журнал монет задач: они считаются из записей дневника (удалил запись — награды нет),
// а сюда приложение подставляет итог. Дробные награды копятся: тратить можно только целые монеты и 💎.

const ZERO = Object.freeze({ xp: 0, coins: 0, gems: 0 });
let provider = null;

/** fn() → { xp, coins, gems } — уже накопленные дробные суммы. null — убрать (тесты, другой профиль). */
export function setExtraEarnings(fn) {
  provider = fn;
}

/** Целые части внешних доходов (что уже можно потратить и что идёт в опыт). */
export function extraEarnings() {
  const e = provider ? provider() : null;
  if (!e) return ZERO;
  const whole = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v + 1e-9) : 0);
  return { xp: whole(e.xp), coins: whole(e.coins), gems: whole(e.gems) };
}
