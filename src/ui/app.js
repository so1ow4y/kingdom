// Каркас приложения: раскладка (док-панель, карточка задачи справа или на весь экран), роутинг, баннеры, оверлеи, клавиши.
// С 0.10 — как AppShell license-store: на телефоне развёрнутый док — шторка поверх страницы с затемнением
// (Esc и переход закрывают её), у разделов из нескольких экранов — вкладки сверху, горячие клавиши — ui/keys.js.
// С 0.11 — Crimson Harvest: два приложения, Chronicle (задачи) и Feast (калории); открытое определяется экраном.

import { html, useEffect, useRef, useMemo, useState } from './html.js';
import { Icon } from './icons.js';
import { useStore, useRoute, useMedia, readLocal, writeLocal } from './hooks.js';
import { navigate, goBack, setBasePath, closeTask, currentTaskId, currentFoodId } from './router.js';
import { SheetHost } from './components/Sheets.js';
import { QuickAddHost } from './components/QuickAdd.js';
import { DialogHost, Snackbar, Banner } from './components/Overlays.js';
import { TodayScreen } from './screens/Today.js';
import { InboxScreen } from './screens/Inbox.js';
import { ListsScreen, ListScreen } from './screens/Lists.js';
import { TaskScreen } from './screens/Task.js';
import { ArchiveScreen, TrashScreen, TasksScreen } from './screens/ArchiveTrash.js';
import { SettingsScreen, MoreScreen } from './screens/Settings.js';
import { JournalScreen } from './screens/Journal.js';
import { AnalyticsScreen } from './screens/Analytics.js';
import { ShopScreen } from './screens/Shop.js';
import { StartScreen, RedirectingScreen } from './components/Sync.js';
import { Dock } from './components/Dock.js';
import { TooltipLayer, MenuLayer, closeMenu, isMenuOpen } from './components/Popup.js';
import { SectionTabs } from './components/SectionTabs.js';
import { AchievementToast } from './components/Decorations.js';
import { SkillToast, SkillBadge } from './components/Skills.js';
import { VillageHost, villageOn } from './components/VillageView.js';
import { FocusBar } from './components/Focus.js';
import { VillageScreen } from './screens/Village.js';
import { DiaryScreen } from './screens/Diary.js';
import { MealsScreen, MealScreen } from './screens/Meals.js';
import { FoodsScreen, FoodCard } from './screens/Foods.js';
import { NutritionScreen } from './screens/Nutrition.js';
import { BodyScreen } from './screens/Body.js';
import { openAddFood, currentDiaryDate } from './components/AddFood.js';
import { APPS, appOfRoute, followRoute, switchApp, rememberRoute, SUITE_NAME } from './apps.js';
import { dockPosition, getPrefs, setPrefs, activeApp } from './prefs.js';
import { actionFor } from './keys.js';
import { sectionOf } from './nav.js';
import { clearMissed } from './notifier.js';
import { pull, push } from '../sync/syncEngine.js';
import {
  store, openSheet, closeSheet, closeDialog, openQuickAdd, closeQuickAdd, setUi, setSync, flushAll,
} from '../store/appState.js';
import { updateSettings, toggleComplete, trashTask, getTask } from '../store/actions.js';
import * as S from '../core/selectors.js';
import * as F from '../core/feast.js';
import { planningDate } from '../core/planning.js';
import { humanDate, addDays, deviceTimeZone } from '../core/dates.js';
import { applyUpdate } from '../pwa/swClient.js';
import { tr } from '../core/i18n.js';

function titleFor(route) {
  switch (route.name) {
    case 'today': return humanDate(planningDate(route.query.date, store.now.today), store.now.today);
    case 'inbox': return tr('Входящие');
    case 'lists': return tr('Списки');
    case 'list': {
      const l = S.liveList(store.data, route.param);
      return l ? `${l.emoji ? l.emoji + ' ' : ''}${l.name}` : tr('Список');
    }
    case 'archive': return tr('Выполненные');
    case 'trash': return tr('Корзина');
    case 'tasks': return tr('Поиск задач');
    case 'settings': return tr('Настройки');
    case 'more': return tr('Ещё');
    case 'journal': return tr('Журнал');
    case 'analytics': return tr('Аналитика');
    case 'shop': return tr('Магазин');
    case 'village': return tr('Деревня');
    case 'diary': return tr('Дневник · ') + humanDate(planningDate(route.query.date, store.now.today), store.now.today).toLowerCase();
    case 'foods': return tr('Продукты и лекарства');
    case 'nutrition': return route.param === 'meds' ? tr('Аналитика · лекарства') : route.param === 'body' ? tr('Аналитика · тело') : tr('Аналитика · питание');
    case 'body': return tr('Обо мне');
    case 'food': return F.isMed(store.feast.foods.get(route.param)) ? tr('Лекарство') : tr('Продукт');
    case 'meals': return tr('Рационы');
    case 'meal': {
      const m = store.feast.meals.get(route.param);
      return m && !m.deletedAt ? `${m.icon} ${F.mealName(m)}` : tr('Рацион');
    }
    default: return SUITE_NAME;
  }
}

function Screen({ route }) {
  switch (route.name) {
    case 'inbox': return html`<${InboxScreen}/>`;
    case 'lists': return html`<${ListsScreen}/>`;
    case 'list': return html`<${ListScreen} key=${route.param} listId=${route.param}/>`;
    case 'task': return html`<${TaskScreen} key=${route.param} taskId=${route.param}/>`;
    case 'archive': return html`<${ArchiveScreen} key=${route.query.list || ''} query=${route.query}/>`;
    case 'trash': return html`<${TrashScreen}/>`;
    case 'tasks': return html`<${TasksScreen} key=${route.query.q || ''} query=${route.query}/>`;
    case 'settings': return html`<${SettingsScreen} query=${route.query}/>`;
    case 'more': return html`<${MoreScreen}/>`;
    case 'journal': return html`<${JournalScreen}/>`;
    case 'analytics': return html`<${AnalyticsScreen}/>`;
    case 'shop': return html`<${ShopScreen}/>`;
    case 'village': return html`<${VillageScreen}/>`;
    case 'diary': return html`<${DiaryScreen} query=${route.query}/>`;
    case 'foods': return html`<${FoodsScreen} query=${route.query}/>`;
    case 'food': return html`<${FoodCard} key=${route.param} id=${route.param} onClose=${closeTask}/>`;
    case 'nutrition': return html`<${NutritionScreen} tab=${route.param}/>`;
    case 'body': return html`<${BodyScreen}/>`;
    case 'meals': return html`<${MealsScreen}/>`;
    case 'meal': return html`<${MealScreen} key=${route.param} mealId=${route.param} query=${route.query}/>`;
    default: return html`<${TodayScreen} query=${route.query}/>`;
  }
}

function TopBar({ route }) {
  // Разделы — в доке, «назад» нужен только вложенным экранам (список, журнал)
  const back = ['list', 'journal', 'meal'].includes(route.name);
  const fallback = route.name === 'list' ? '/lists' : route.name === 'meal' ? '/meals' : '/settings';
  const section = sectionOf(route.name);
  return html`
    <header class="topbar">
      ${back ? html`<button class="icon-btn back-btn" onClick=${() => goBack(fallback)} aria-label="Назад"><${Icon} name="back"/></button>` : null}
      <h1 class="topbar-title">${section ? section.title : titleFor(route)}${route.name === 'list' ? html` <${SkillBadge} listId=${route.param} className="in-title"/>` : null}</h1>
      ${route.name === 'list' && S.liveList(store.data, route.param) && !store.ui.readOnly ? html`
        <button class="icon-btn" onClick=${() => openSheet('listEditor', { listId: route.param })} aria-label="Изменить список" title="Изменить список">
          <${Icon} name="edit" size=${20}/></button>` : null}
      ${route.name === 'meal' && store.feast.meals.get(route.param) && !store.feast.meals.get(route.param).deletedAt && !store.ui.feastReadOnly ? html`
        <button class="icon-btn" onClick=${() => openSheet('meal', { id: route.param })} aria-label="Изменить рацион" title="Изменить рацион">
          <${Icon} name="edit" size=${20}/></button>` : null}
    </header>`;
}

function Banners() {
  const u = store.ui.update;
  const tz = store.data.settings?.timeZone;
  const dtz = deviceTimeZone();
  const tzKey = `${dtz}|${tz}`;
  const tzDismissed = readLocal('tzDismissed', null) === tzKey;
  return html`
    ${store.ui.readOnly ? html`<${Banner} tone="danger">${store.ui.readOnly}<//>` : null}
    ${u ? html`
      <${Banner} tone="info" onClose=${() => setUi({ update: null })} actions=${html`
        <button class="btn small primary" onClick=${applyUpdate}>Обновить</button>`}>
        Доступно обновление${u.version ? tr(' до версии {version}', { version: u.version }) : ''}
      <//>` : null}
    ${store.sync.clockSkewMin ? html`
      <${Banner} tone="warn" onClose=${() => setSync({ clockSkewMin: 0 })}>
        Часы устройства ${store.sync.clockSkewMin > 0 ? tr('спешат') : tr('отстают')} на ${Math.abs(store.sync.clockSkewMin)} мин.
        Исправь время — иначе правки могут сливаться неправильно.
      <//>` : null}
    ${store.sync.extraRoots?.length ? html`
      <${Banner} tone="warn" onClose=${() => setSync({ extraRoots: [] })}>
        На Диске найдено несколько папок задач (Chronicle / LifeTasks). Используется самая старая; остальные можно удалить вручную после проверки.
      <//>` : null}
    ${store.ui.conflictsNew ? html`
      <${Banner} tone="info" onClose=${() => setUi({ conflictsNew: 0 })} actions=${html`
        <button class="btn small primary" onClick=${() => navigate('/journal')}>Посмотреть</button>`}>
        Конфликты при слиянии: ${store.ui.conflictsNew}. Проигравшие значения сохранены в журнале.
      <//>` : null}
    ${store.ui.missedCount ? html`
      <${Banner} tone="info" onClose=${clearMissed} actions=${html`
        <button class="btn small primary" onClick=${() => openSheet('missed')}>Показать</button>`}>
        🔔 Пропущенные напоминания: ${store.ui.missedCount}. Пока приложение было закрыто, уведомления не приходили.
      <//>` : null}
    ${store.sync.remoteNewer && !store.sync.phase ? html`
      <${Banner} tone="info" actions=${html`<button class="btn small primary" onClick=${() => pull()}>Обновить</button>`}>
        На Диске есть версия новее.
      <//>` : null}
    ${tz && tz !== dtz && !tzDismissed && !store.ui.readOnly ? html`
      <${Banner} tone="warn" onClose=${() => { writeLocal('tzDismissed', tzKey); setUi({}); }} actions=${html`
        <button class="btn small primary" onClick=${() => updateSettings({ timeZone: dtz })}>Сменить</button>`}>
        Часовой пояс устройства (${dtz}) отличается от пояса в настройках (${tz}). «Сегодня» считается по настройкам.
      <//>` : null}`;
}

/** «Поиск» (/ по умолчанию): встать в строку поиска на экране, а если её нет — открыть «Поиск задач». */
function focusSearch() {
  const field = () => document.querySelector('[data-search-input]');
  if (field()) {
    field().focus();
    field().select?.();
    return;
  }
  navigate('/tasks');
  setTimeout(() => field()?.focus(), 60);
}

export function App() {
  useStore();
  const route = useRoute();
  const desktop = useMedia('(min-width: 900px)');
  const wide = useMedia('(min-width: 1200px)');
  const lastBase = useRef({ name: 'today', param: null, query: {}, path: '/today' });
  const isCard = route.name === 'task' || route.name === 'food';
  if (!isCard && route.name !== 'quick') lastBase.current = route;
  setBasePath(lastBase.current.path + (Object.keys(lastBase.current.query || {}).length
    ? '?' + new URLSearchParams(lastBase.current.query) : ''));

  const panel = wide && isCard;
  const base = panel ? lastBase.current : route;
  // Открытое приложение следует за экраном (общие экраны — настройки, журнал — остаются в текущем)
  followRoute(appOfRoute(route.name === 'food' ? 'food' : base.name));
  const app = activeApp();
  const counts = useMemo(() => S.activeCounts(store.data), [store.version]);

  // Док (AppShell license-store): на телефоне «развёрнут» = временная шторка, выбор не запоминается.
  const prefs = getPrefs();
  const phone = !desktop;
  const position = dockPosition(phone);
  const [mobileOpen, setMobileOpen] = useState(false);
  const expanded = phone ? mobileOpen : prefs.expanded;
  const overlayOpen = phone && mobileOpen && !prefs.hidden;
  // Спрятанный или выезжающий док места на странице не занимает; автоскрытие — только с мышью.
  const autoHide = prefs.autoHide && !phone;
  useEffect(() => {
    if (!phone) setMobileOpen(false);
  }, [phone]);
  const toggleDock = () => {
    if (phone) setMobileOpen(!mobileOpen);
    else setPrefs({ expanded: !prefs.expanded });
  };
  const toggleHidden = () => {
    setMobileOpen(false);
    setPrefs({ hidden: !prefs.hidden });
  };

  const quickCtx = () => {
    if (base.name === 'list' && S.liveList(store.data, base.param)) return { listId: base.param };
    if (base.name === 'today') return { scheduledDate: planningDate(base.query.date, store.now.today) };
    return {};
  };
  const add = () => {
    if (app === 'feast') return openAddFood({ date: base.name === 'diary' ? currentDiaryDate() : store.now.today });
    return !store.ui.readOnly && openQuickAdd(quickCtx());
  };
  /** Переход в другое приложение (буква в спрятанном доке, меню аккаунта, клавиша): док нового — видно. */
  const onSwitch = () => {
    setMobileOpen(false);
    if (getPrefs().hidden) setPrefs({ hidden: false });
    switchApp();
  };

  // Запомнить экран приложения: при переключении вернёмся туда же
  useEffect(() => {
    const own = appOfRoute(base.name);
    if (own) rememberRoute(own, base.path + (Object.keys(base.query || {}).length ? '?' + new URLSearchParams(base.query) : ''));
  });

  // Ярлык PWA «Быстрая задача» → #/quick; «Записать еду» (0.11) → #/diary?add=1
  useEffect(() => {
    if (route.name === 'quick') {
      navigate('/today', { replace: true });
      if (!store.ui.readOnly) openQuickAdd({});
    }
    if (route.name === 'diary' && route.query.add) {
      navigate('/diary', { replace: true });
      openAddFood({ scan: route.query.add === 'scan' });
    }
  }, [route.name, route.query.add]);

  useEffect(() => {
    const section = sectionOf(base.name);
    const name = APPS[app]?.name || SUITE_NAME;
    document.title = route.name === 'task' ? tr('Задача · {name}', { name }) : route.name === 'food' && !panel ? tr('Продукт · {name}', { name })
      : `${titleFor(base)}${section ? ' · ' + section.title : ''} · ${name}`;
  });

  // Горячие клавиши (ui/keys.js): Esc закрывает верхний слой, остальное — по назначениям из настроек.
  // Обработчик действия возвращает false, если сейчас оно неуместно: тогда нажатие отдаётся браузеру.
  const runShortcut = (id) => {
    const taskId = currentTaskId();
    const day = planningDate(base.query.date, store.now.today);
    const dayRoute = base.name === 'diary' ? '/diary' : '/today';
    const goDay = (d) => navigate(d === store.now.today ? dayRoute : dayRoute + '?date=' + d, { replace: true });
    const onDays = (base.name === 'today' || base.name === 'diary') && !taskId && !currentFoodId();
    const go = (to) => () => {
      setMobileOpen(false);
      navigate(to);
    };
    const open = taskId ? getTask(taskId) : null;
    const editable = !!open && !store.ui.readOnly;
    const table = {
      newTask: () => add(),
      search: () => focusSearch(),
      push: () => {
        if (!store.sync.phase && !store.ui.readOnly) push();
      },
      pull: () => {
        if (!store.sync.phase) pull();
      },
      prevDay: () => (onDays ? goDay(addDays(day, -1)) : false),
      nextDay: () => (onDays ? goDay(addDays(day, 1)) : false),
      taskDone: () => (editable && !open.trashedAt ? toggleComplete(taskId) : false),
      taskFocus: () => (editable && open.status === 'active' && !open.trashedAt ? openSheet('focus', { taskId }) : false),
      taskTrash: () => (editable && !open.trashedAt ? trashTask(taskId) : false),
      goToday: go('/today'),
      goInbox: go('/inbox'),
      goLists: go('/lists'),
      goTasks: go('/tasks'),
      goVillage: go('/village'),
      goAnalytics: go('/analytics'),
      goShop: go('/shop'),
      goArchive: go('/archive'),
      goTrash: go('/trash'),
      goSettings: go('/settings'),
      goDiary: go('/diary'),
      goFoods: go('/foods'),
      goNutrition: go('/nutrition'),
      goBody: go('/body'),
      goMeals: go('/meals'),
      switchApp: onSwitch,
      scanBarcode: () => openAddFood({ date: base.name === 'diary' ? currentDiaryDate() : store.now.today, scan: true }),
      dockExpand: toggleDock,
      dockHide: toggleHidden,
      help: () => openSheet('shortcuts'),
    };
    const fn = table[id];
    return !!fn && fn() !== false;
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (store.ui.dialog) closeDialog(null);
        else if (isMenuOpen()) closeMenu({ restoreFocus: true });
        else if (store.ui.sheet) closeSheet();
        else if (store.ui.quickAdd) closeQuickAdd();
        else if (overlayOpen) setMobileOpen(false);
        else if (currentTaskId() || currentFoodId()) closeTask(); // отложенный ввод сохранится при размонтировании карточки
        else return;
        e.preventDefault();
        return;
      }
      const overlay = !!(store.ui.dialog || store.ui.sheet || store.ui.quickAdd || isMenuOpen());
      const id = actionFor(e, { overlay });
      if (id && runShortcut(id)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Сохранить отложенный ввод, когда вкладку сворачивают или закрывают.
  useEffect(() => {
    const f = () => {
      if (document.visibilityState === 'hidden') flushAll();
    };
    document.addEventListener('visibilitychange', f);
    window.addEventListener('pagehide', flushAll);
    // Вернулись «Назад» со страницы Google — страница восстановлена из кэша браузера.
    const onShow = (e) => {
      if (e.persisted) setUi({ redirecting: false });
    };
    window.addEventListener('pageshow', onShow);
    return () => {
      document.removeEventListener('visibilitychange', f);
      window.removeEventListener('pagehide', flushAll);
      window.removeEventListener('pageshow', onShow);
    };
  }, []);

  const wideContent = ['tasks', 'archive', 'trash', 'settings', 'foods'].includes(base.name);

  return html`
    <div class=${'app' + (panel ? ' with-panel' : '') + (desktop ? ' desktop' : ' mobile') + ' dock-' + position
      + (base.name === 'village' && villageOn() ? ' village-mode' : '')
      + (villageOn() && (base.name === 'village' || getPrefs().villageBackdrop !== false) ? ' village-bg-on' : '')}>
      <${VillageHost} route=${base}/><${AchievementToast}/><${SkillToast}/>
      <${Dock} route=${base} counts=${counts} onAdd=${add} phone=${phone} position=${position} expanded=${expanded}
        hidden=${!!prefs.hidden} autoHide=${autoHide} overlay=${overlayOpen}
        onToggle=${toggleDock} onToggleHidden=${toggleHidden} onNavigate=${() => phone && setMobileOpen(false)}
        app=${app} onSwitch=${onSwitch}/>
      ${overlayOpen ? html`<div class="dock-shade" aria-hidden="true" onClick=${() => setMobileOpen(false)}></div>` : null}
      <div class="main-col">
        ${base.name !== 'task' ? html`<${TopBar} route=${base}/>` : null}
        <${FocusBar} sticky=${base.name !== 'task'}/>
        <${Banners}/>
        <main class=${'content' + (wideContent ? ' wide' : '')} id="main">
          <${SectionTabs} route=${base}/>
          <${Screen} route=${base}/>
        </main>
      </div>
      ${panel ? html`
        <aside class="task-panel">
          ${route.name === 'food' ? html`<${FoodCard} key=${route.param} id=${route.param} panel onClose=${closeTask}/>`
            : html`<${TaskScreen} key=${route.param} taskId=${route.param} panel onClose=${closeTask}/>`}
        </aside>` : null}
      <${QuickAddHost}/>
      <${SheetHost}/>
      <${StartScreen}/>
      <${RedirectingScreen}/>
      <${DialogHost}/>
      <${MenuLayer}/>
      <${TooltipLayer}/>
      <${Snackbar}/>
      ${store.ui.busyText ? html`<div class="busy-toast" role="status">⏳ ${store.ui.busyText}</div>` : null}
    </div>`;
}
