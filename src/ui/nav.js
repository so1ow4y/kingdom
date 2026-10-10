// Меню приложения (обновление 0.10) — как buildMenu/visibleMenu в license-store (components/app-shell.tsx):
// группы с ветками. Ветка раскрывается на месте в развёрнутом доке и выпадающим списком в свёрнутом —
// так в доке видно меньше значков. Ветка из одного пункта становится просто ссылкой.
// Деревня и магазин — одна ветка «Прогресс»; выполненные и корзина — ветка «Архив и корзина»; аналитика задач (0.14) —
// своя ветка (Обзор, По времени), как «Аналитика» в Crimson Harvest.
// У таких веток наверху экрана — вкладки (SectionTabs), как у «Безопасности» в license-store.

import * as S from '../core/selectors.js';
import { store } from '../store/appState.js';
import * as F from '../core/feast.js';
import { tr } from '../core/i18n.js';

/** Разделы из нескольких экранов: пункт дока-ветка и вкладки вверху экрана. */
export const SECTIONS = {
  progress: { title: tr('Прогресс'), icon: 'village', routes: ['village', 'shop'] },
  archive: { title: tr('Архив и корзина'), icon: 'archive', routes: ['archive', 'trash'] },
};

export function sectionOf(routeName) {
  for (const [key, s] of Object.entries(SECTIONS)) if (s.routes.includes(routeName)) return { key, ...s };
  return null;
}

/** Пункт активен на маршруте: match = [имя маршрута, параметр?]. */
export function isTargetActive(route, item) {
  if (!item.match) return false;
  const [name, param] = item.match;
  if (Array.isArray(name)) return name.includes(route.name);
  return route.name === name && (param === undefined || route.param === param);
}

/** Ветка подсвечена, если открыт любой её пункт. */
export const isBranchActive = (route, branch) => branch.items.some((sub) => isTargetActive(route, sub));

/** «Прогресс»: деревня и магазин — общие для обоих приложений (аналитика задач с 0.14 — своя ветка). */
function progressItems(data) {
  return [
    data.settings.gameEnabled ? { title: tr('Деревня'), icon: 'village', to: '/village', match: ['village'], key: 'goVillage' } : null,
    { title: tr('Магазин'), icon: 'shop', to: '/shop', match: ['shop'], key: 'goShop' },
  ].filter(Boolean);
}

/** Аналитика задач (0.14): обзор и «По времени» — как у лекарств в Crimson Harvest. */
function analyticsItems() {
  return [
    { title: tr('Обзор'), icon: 'chart', to: '/analytics', match: ['analytics', null], key: 'goAnalytics' },
    { title: tr('По времени'), icon: 'clock', to: '/analytics/time', match: ['analytics', 'time'] },
  ];
}

function archiveItems(trash) {
  return [
    { title: tr('Выполненные'), icon: 'check', to: '/archive', match: ['archive'], key: 'goArchive' },
    { title: tr('Корзина'), icon: 'trash', to: '/trash', match: ['trash'], count: trash, key: 'goTrash' },
  ];
}

/** Вкладки раздела для маршрута (или null). */
export function sectionTabs(routeName) {
  const s = sectionOf(routeName);
  if (!s) return null;
  const items = s.key === 'progress' ? progressItems(store.data) : archiveItems(S.trashView(store.data).length);
  return { ...s, items };
}

/** Ветка из одного пункта — просто ссылка: лишний клик ни к чему. */
function flatten(item) {
  if (!item.items) return item;
  if (item.items.length === 0) return null;
  if (item.items.length === 1) return { ...item.items[0], icon: item.icon || item.items[0].icon, title: item.items[0].title };
  return item;
}

/** Меню Feast (0.11): дневник, продукты, аналитика, «Обо мне»; настройки — общие. */
function feastMenu() {
  return [
    {
      title: tr('Питание'),
      items: [
        { title: tr('Дневник'), icon: 'diary', to: '/diary', match: ['diary'], key: 'goDiary' },
        // рационы — как «Списки» у задач: у каждого своя страница (её можно открыть в новой вкладке)
        {
          id: 'meals', title: tr('Рационы'), icon: 'lists',
          items: [
            { title: tr('Все рационы'), icon: 'lists', to: '/meals', match: ['meals'], key: 'goMeals' },
            ...F.globalMeals(store.feast).filter((m) => !m.archived)
              .map((m) => ({ title: F.mealName(m), emoji: m.icon, to: '/meal/' + m.id, match: ['meal', m.id] })),
          ],
        },
        // 0.13: продукты, лекарства и замеры — ветка, как «Аналитика»
        {
          id: 'catalog', title: tr('Продукты и лекарства'), icon: 'food',
          items: [
            { title: tr('Продукты'), icon: 'food', to: '/foods', match: ['foods', null], key: 'goFoods' },
            { title: tr('Лекарства'), icon: 'pill', to: '/foods/meds', match: ['foods', 'meds'] },
            { title: tr('Замеры'), icon: 'gauge', to: '/foods/measures', match: ['foods', 'measures'] },
          ],
        },
        // аналитика (0.12.5) — ветка, как «Рационы»: питание, лекарства, тело
        {
          id: 'nutrition', title: tr('Аналитика'), icon: 'chart',
          items: [
            { title: tr('Питание'), icon: 'chart', to: '/nutrition', match: ['nutrition', null], key: 'goNutrition' },
            { title: tr('Лекарства'), icon: 'pill', to: '/nutrition/meds', match: ['nutrition', 'meds'] },
            { title: tr('Замеры'), icon: 'gauge', to: '/nutrition/measures', match: ['nutrition', 'measures'] },
            { title: tr('Тело'), icon: 'body', to: '/nutrition/body', match: ['nutrition', 'body'] },
          ],
        },
        { title: tr('Обо мне'), icon: 'body', to: '/body', match: ['body'], key: 'goBody' },
      ],
    },
    {
      title: tr('Обзор'),
      items: [
        { id: 'progress', title: tr('Деревня'), icon: SECTIONS.progress.icon, items: progressItems(store.data) },
        // корзина (0.14): удалённые записи, продукты, лекарства, замеры и рационы — можно вернуть
        { title: tr('Корзина'), icon: 'trash', to: '/bin', match: ['bin'], count: F.trashList(store.feast).length || null },
      ],
    },
    {
      title: tr('Приложение'),
      items: [{ title: tr('Настройки'), icon: 'settings', to: '/settings', match: [['settings', 'journal']], key: 'goSettings' }],
    },
  ].map((g) => ({ ...g, items: g.items.map(flatten).filter(Boolean) })).filter((g) => g.items.length);
}

/** Группы дока. counts — активные задачи по спискам (S.activeCounts); app — открытое приложение. */
export function buildMenu(counts, app = 'chronicle') {
  if (app === 'feast') return feastMenu();
  const data = store.data;
  const lists = S.sortedLists(data);
  const trash = S.trashView(data).length;
  const groups = [
    {
      title: tr('Задачи'),
      items: [
        { title: tr('Сегодня'), icon: 'sun', to: '/today', match: ['today'], key: 'goToday' },
        { title: tr('Входящие'), icon: 'inbox', to: '/inbox', match: ['inbox'], count: counts.get('inbox'), key: 'goInbox' },
        {
          id: 'lists', title: tr('Списки'), icon: 'lists',
          items: [
            { title: tr('Все списки'), icon: 'lists', to: '/lists', match: ['lists'], key: 'goLists' },
            ...lists.map((l) => ({ title: l.name, emoji: l.emoji, color: l.color, to: '/list/' + l.id, match: ['list', l.id], count: counts.get(l.id) })),
          ],
        },
        // 0.15: поиск — ветка, как «Продукты и лекарства»: все задачи, активные, повторяющиеся и банк задач
        {
          id: 'search', title: tr('Поиск'), icon: 'search',
          items: [
            { title: tr('Все задачи'), icon: 'search', to: '/tasks', match: ['tasks', null], key: 'goTasks' },
            { title: tr('Активные'), icon: 'circle', to: '/tasks/active', match: ['tasks', 'active'] },
            { title: tr('Повторяющиеся'), icon: 'repeat', to: '/tasks/repeat', match: ['tasks', 'repeat'] },
            { title: tr('Банк задач'), icon: 'bank', to: '/tasks/bank', match: ['tasks', 'bank'], key: 'goBank' },
          ],
        },
      ],
    },
    {
      title: tr('Обзор'),
      items: [
        { id: 'analytics', title: tr('Аналитика'), icon: 'chart', items: analyticsItems() },
        { id: 'progress', title: SECTIONS.progress.title, icon: SECTIONS.progress.icon, items: progressItems(data) },
        { id: 'archive', title: SECTIONS.archive.title, icon: SECTIONS.archive.icon, count: trash, items: archiveItems(trash) },
      ],
    },
    {
      title: tr('Приложение'),
      items: [{ title: tr('Настройки'), icon: 'settings', to: '/settings', match: [['settings', 'journal']], key: 'goSettings' }],
    },
  ];
  return groups.map((g) => ({ ...g, items: g.items.map(flatten).filter(Boolean) })).filter((g) => g.items.length);
}
