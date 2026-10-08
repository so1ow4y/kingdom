// Меню приложения (обновление 0.10) — как buildMenu/visibleMenu в license-store (components/app-shell.tsx):
// группы с ветками. Ветка раскрывается на месте в развёрнутом доке и выпадающим списком в свёрнутом —
// так в доке видно меньше значков. Ветка из одного пункта становится просто ссылкой.
// Деревня, аналитика и магазин — одна ветка «Прогресс»; выполненные и корзина — ветка «Архив и корзина».
// У таких веток наверху экрана — вкладки (SectionTabs), как у «Безопасности» в license-store.

import * as S from '../core/selectors.js';
import { store } from '../store/appState.js';
import { activeApp } from './prefs.js';
import * as F from '../core/feast.js';

/** Разделы из нескольких экранов: пункт дока-ветка и вкладки вверху экрана. */
export const SECTIONS = {
  progress: { title: 'Прогресс', icon: 'village', routes: ['village', 'analytics', 'shop'] },
  archive: { title: 'Архив и корзина', icon: 'archive', routes: ['archive', 'trash'] },
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

/** «Прогресс»: деревня, аналитика задач, магазин. В Crimson Harvest (0.12) — деревня и магазин без аналитики задач. */
function progressItems(data, app = activeApp()) {
  return [
    data.settings.gameEnabled ? { title: 'Деревня', icon: 'village', to: '/village', match: ['village'], key: 'goVillage' } : null,
    app === 'feast' ? null : { title: 'Аналитика', icon: 'chart', to: '/analytics', match: ['analytics'], key: 'goAnalytics' },
    { title: 'Магазин', icon: 'shop', to: '/shop', match: ['shop'], key: 'goShop' },
  ].filter(Boolean);
}

function archiveItems(trash) {
  return [
    { title: 'Выполненные', icon: 'check', to: '/archive', match: ['archive'], key: 'goArchive' },
    { title: 'Корзина', icon: 'trash', to: '/trash', match: ['trash'], count: trash, key: 'goTrash' },
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
      title: 'Питание',
      items: [
        { title: 'Дневник', icon: 'diary', to: '/diary', match: ['diary'], key: 'goDiary' },
        // рационы — как «Списки» у задач: у каждого своя страница (её можно открыть в новой вкладке)
        {
          id: 'meals', title: 'Рационы', icon: 'lists',
          items: [
            { title: 'Все рационы', icon: 'lists', to: '/meals', match: ['meals'], key: 'goMeals' },
            ...F.globalMeals(store.feast).filter((m) => !m.archived)
              .map((m) => ({ title: m.name, emoji: m.icon, to: '/meal/' + m.id, match: ['meal', m.id] })),
          ],
        },
        { title: 'Продукты', icon: 'food', to: '/foods', match: ['foods'], key: 'goFoods' },
        { title: 'Аналитика', icon: 'chart', to: '/nutrition', match: ['nutrition'], key: 'goNutrition' },
        { title: 'Обо мне', icon: 'body', to: '/body', match: ['body'], key: 'goBody' },
      ],
    },
    {
      title: 'Обзор',
      items: [{ id: 'progress', title: 'Деревня', icon: SECTIONS.progress.icon, items: progressItems(store.data, 'feast') }],
    },
    {
      title: 'Приложение',
      items: [{ title: 'Настройки', icon: 'settings', to: '/settings', match: [['settings', 'journal']], key: 'goSettings' }],
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
      title: 'Задачи',
      items: [
        { title: 'Сегодня', icon: 'sun', to: '/today', match: ['today'], key: 'goToday' },
        { title: 'Входящие', icon: 'inbox', to: '/inbox', match: ['inbox'], count: counts.get('inbox'), key: 'goInbox' },
        {
          id: 'lists', title: 'Списки', icon: 'lists',
          items: [
            { title: 'Все списки', icon: 'lists', to: '/lists', match: ['lists'], key: 'goLists' },
            ...lists.map((l) => ({ title: l.name, emoji: l.emoji, color: l.color, to: '/list/' + l.id, match: ['list', l.id], count: counts.get(l.id) })),
          ],
        },
        { title: 'Поиск', icon: 'search', to: '/tasks', match: ['tasks'], key: 'goTasks' },
      ],
    },
    {
      title: 'Обзор',
      items: [
        { id: 'progress', title: SECTIONS.progress.title, icon: SECTIONS.progress.icon, items: progressItems(data) },
        { id: 'archive', title: SECTIONS.archive.title, icon: SECTIONS.archive.icon, count: trash, items: archiveItems(trash) },
      ],
    },
    {
      title: 'Приложение',
      items: [{ title: 'Настройки', icon: 'settings', to: '/settings', match: [['settings', 'journal']], key: 'goSettings' }],
    },
  ];
  return groups.map((g) => ({ ...g, items: g.items.map(flatten).filter(Boolean) })).filter((g) => g.items.length);
}
