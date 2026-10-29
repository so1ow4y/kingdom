// Раскладка дока (обновление 1.1): какие пункты в нём и в каком порядке — у телефона и компьютера своя (prefs:
// dockOrder/dockOff — компьютер, barOrder/barOff — телефон, у каждого приложения свои). Пункты: буква (спрятать
// панель), «Перейти в другое приложение», «Новая задача» / «Записать еду», пункты и ветки меню (nav.js),
// синхронизация, пуш, язык, аккаунт. «Свернуть / Ещё» — всегда в конце, его не убрать (через него — всё остальное).
//
// Свой порядок хранится списком ключей; пункт, которого в списке нет (появился новый — например, ветка из-за
// включённой игры), встаёт туда, где стоял бы по умолчанию, — после ближайшего соседа. Чистые функции.

/** Ключ пункта меню: ветка — 'b:<id>', ссылка — 'l:<адрес>'. */
export const menuKey = (it) => (it.items ? 'b:' + it.id : 'l:' + it.to);

/** Служебные пункты (не из меню). */
export const SPECIAL = ['letter', 'switch', 'add', 'sync', 'push', 'lang', 'user'];

/**
 * Самое частое — в начале ленты телефона: переключение приложения, добавление, главный экран, «Обо мне»,
 * продукты и лекарства (для Chronicle — «Сегодня», «Входящие», «Списки»).
 */
const PHONE_FIRST = {
  feast: ['switch', 'add', 'l:/diary', 'l:/body', 'b:catalog'],
  chronicle: ['switch', 'add', 'l:/today', 'l:/inbox', 'b:lists'],
};
/** На телефоне по умолчанию скрыты (есть в «Ещё»): поиск задач, настройки, синхронизация, язык, аккаунт. */
const PHONE_OFF = ['b:search', 'l:/tasks', 'l:/settings', 'sync', 'lang', 'user'];

/** Все пункты меню по порядку групп: [{ key, item, group }]. */
export function menuEntries(groups) {
  return groups.flatMap((g) => g.items.map((it) => ({ key: menuKey(it), item: it, group: g.title })));
}

/** Порядок по умолчанию: компьютер — буква, переход, добавить, меню, синхронизация…; телефон — частое в начале. */
export function defaultOrder(groups, { phone = false, app = 'chronicle' } = {}) {
  const menu = menuEntries(groups).map((e) => e.key);
  if (!phone) return ['letter', 'switch', 'add', ...menu, 'sync', 'push', 'lang', 'user'];
  const all = ['switch', 'add', ...menu, 'push', 'letter', 'sync', 'lang', 'user'];
  const first = (PHONE_FIRST[app] || PHONE_FIRST.chronicle).filter((k) => all.includes(k));
  return [...first, ...all.filter((k) => !first.includes(k))];
}

export const defaultOff = ({ phone = false } = {}) => (phone ? [...PHONE_OFF] : []);

/** Свой порядок поверх умолчания: неизвестное выбрасывается, новое встаёт после соседа по умолчанию. */
export function mergeOrder(defaults, saved) {
  if (!Array.isArray(saved)) return [...defaults];
  const out = [...new Set(saved.filter((k) => defaults.includes(k)))];
  defaults.forEach((k, i) => {
    if (out.includes(k)) return;
    const prev = defaults.slice(0, i).reverse().find((p) => out.includes(p));
    out.splice(prev ? out.indexOf(prev) + 1 : 0, 0, k);
  });
  return out;
}

/** Ключи раскладки для prefs: { order, off } (у телефона — bar*, у компьютера — dock*). */
export const layoutKeys = (phone) => (phone ? { order: 'barOrder', off: 'barOff' } : { order: 'dockOrder', off: 'dockOff' });

/**
 * Пункты дока по порядку: [{ key, item?, group, on }] — group: название группы меню, 'top' (буква, переход,
 * добавить) или 'bottom' (синхронизация, пуш, язык, аккаунт). on = false — пункт выключен (в доке не виден).
 */
export function dockLayout(groups, prefs = {}, { phone = false, app = 'chronicle' } = {}) {
  const k = layoutKeys(phone);
  const byKey = new Map(menuEntries(groups).map((e) => [e.key, e]));
  const order = mergeOrder(defaultOrder(groups, { phone, app }), prefs[k.order]);
  const off = new Set(Array.isArray(prefs[k.off]) ? prefs[k.off] : defaultOff({ phone }));
  return order.map((key) => {
    const m = byKey.get(key);
    const group = m ? m.group : ['letter', 'switch', 'add'].includes(key) ? 'top' : 'bottom';
    return { key, item: m?.item || null, group, on: !off.has(key) };
  });
}

/** Подряд идущие пункты одной группы — вместе (для заголовков групп и разделителей в доке). */
export function chunkByGroup(list) {
  const out = [];
  for (const e of list) {
    const last = out.at(-1);
    if (last && last.group === e.group) last.entries.push(e);
    else out.push({ group: e.group, entries: [e] });
  }
  return out;
}

/** Переставить пункт: на позицию to среди всех (включая выключенные). → новый список ключей. */
export function moveKey(order, key, to) {
  const rest = order.filter((k) => k !== key);
  const at = Math.max(0, Math.min(rest.length, to));
  return [...rest.slice(0, at), key, ...rest.slice(at)];
}
