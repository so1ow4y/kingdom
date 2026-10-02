// Каркас приложения: раскладка (нижняя навигация / боковая панель), роутинг, баннеры, оверлеи, клавиши.

import { html, useEffect, useRef, useMemo } from './html.js';
import { Icon } from './icons.js';
import { useStore, useRoute, useMedia, readLocal, writeLocal } from './hooks.js';
import { Link, navigate, goBack } from './router.js';
import { SheetHost } from './components/Sheets.js';
import { QuickAddHost } from './components/QuickAdd.js';
import { DialogHost, Snackbar, Banner } from './components/Overlays.js';
import { TodayScreen } from './screens/Today.js';
import { InboxScreen } from './screens/Inbox.js';
import { ListsScreen, ListScreen } from './screens/Lists.js';
import { TaskScreen } from './screens/Task.js';
import { ArchiveScreen, TrashScreen } from './screens/ArchiveTrash.js';
import { SettingsScreen, MoreScreen } from './screens/Settings.js';
import { JournalScreen } from './screens/Journal.js';
import { SyncIndicator, PushButton, StartScreen, RedirectingScreen } from './components/Sync.js';
import { pull } from '../sync/syncEngine.js';
import {
  store, openSheet, closeSheet, closeDialog, openQuickAdd, closeQuickAdd, setUi, setSync, flushAll,
} from '../store/appState.js';
import { updateSettings } from '../store/actions.js';
import * as S from '../core/selectors.js';
import { deviceTimeZone } from '../core/dates.js';
import { applyUpdate } from '../pwa/swClient.js';

function titleFor(route) {
  switch (route.name) {
    case 'today': return 'Сегодня';
    case 'inbox': return 'Входящие';
    case 'lists': return 'Списки';
    case 'list': {
      const l = S.liveList(store.data, route.param);
      return l ? `${l.emoji ? l.emoji + ' ' : ''}${l.name}` : 'Список';
    }
    case 'archive': return 'Архив';
    case 'trash': return 'Корзина';
    case 'settings': return 'Настройки';
    case 'more': return 'Ещё';
    case 'journal': return 'Журнал';
    default: return 'LifeTasks';
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
    case 'settings': return html`<${SettingsScreen} query=${route.query}/>`;
    case 'more': return html`<${MoreScreen}/>`;
    case 'journal': return html`<${JournalScreen}/>`;
    default: return html`<${TodayScreen}/>`;
  }
}

function TopBar({ route }) {
  const back = ['list', 'archive', 'trash', 'settings', 'journal'].includes(route.name);
  const fallback = route.name === 'list' ? '/lists' : route.name === 'journal' ? '/settings' : '/more';
  return html`
    <header class="topbar">
      ${back ? html`<button class="icon-btn back-btn" onClick=${() => goBack(fallback)} aria-label="Назад"><${Icon} name="back"/></button>` : null}
      <h1 class="topbar-title">${titleFor(route)}</h1>
      ${route.name === 'list' && S.liveList(store.data, route.param) && !store.ui.readOnly ? html`
        <button class="icon-btn" onClick=${() => openSheet('listEditor', { listId: route.param })} aria-label="Изменить список" title="Изменить список">
          <${Icon} name="edit" size=${20}/></button>` : null}
      <${SyncIndicator}/>
      <${PushButton}/>
    </header>`;
}

function NavItem({ to, icon, label, active, count, color, emoji }) {
  return html`
    <${Link} to=${to} className=${'nav-item' + (active ? ' active' : '')}>
      ${color ? html`<i class="dot" style=${{ background: color }}></i>` : html`<${Icon} name=${icon} size=${20}/>`}
      <span class="nav-label">${emoji ? emoji + ' ' : ''}${label}</span>
      ${count ? html`<span class="nav-count">${count}</span>` : null}
    <//>`;
}

function Sidebar({ route, counts, onAdd }) {
  const lists = S.sortedLists(store.data);
  const trash = S.trashView(store.data).length;
  const is = (name, param = null) => route.name === name && (param == null || route.param === param);
  return html`
    <aside class="sidebar">
      <div class="brand"><img src="icons/favicon-32.png" alt="" width="24" height="24"/> LifeTasks</div>
      <button class="btn primary wide" onClick=${onAdd} disabled=${!!store.ui.readOnly}><${Icon} name="plus" size=${18}/> Новая задача <kbd>N</kbd></button>
      <nav>
        <${NavItem} to="/today" icon="sun" label="Сегодня" active=${is('today')}/>
        <${NavItem} to="/inbox" icon="inbox" label="Входящие" active=${is('inbox')} count=${counts.get('inbox')}/>
        <div class="nav-group">
          <${Link} to="/lists" className=${'nav-group-title' + (is('lists') ? ' active' : '')}>Списки<//>
          ${lists.map((l) => html`<${NavItem} key=${l.id} to=${'/list/' + l.id} label=${l.name} emoji=${l.emoji}
            color=${l.color} active=${is('list', l.id)} count=${counts.get(l.id)}/>`)}
        </div>
        <${NavItem} to="/archive" icon="archive" label="Архив" active=${is('archive')}/>
        <${NavItem} to="/trash" icon="trash" label="Корзина" active=${is('trash')} count=${trash}/>
        <${NavItem} to="/settings" icon="settings" label="Настройки" active=${is('settings')}/>
      </nav>
    </aside>`;
}

function BottomNav({ route, counts }) {
  const more = ['more', 'archive', 'trash', 'settings'].includes(route.name);
  return html`
    <nav class="bottom-nav">
      <${NavItem} to="/today" icon="sun" label="Сегодня" active=${route.name === 'today'}/>
      <${NavItem} to="/inbox" icon="inbox" label="Входящие" active=${route.name === 'inbox'} count=${counts.get('inbox')}/>
      <${NavItem} to="/lists" icon="lists" label="Списки" active=${route.name === 'lists' || route.name === 'list'}/>
      <${NavItem} to="/more" icon="more" label="Ещё" active=${more}/>
    </nav>`;
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
        Доступно обновление${u.version ? ` до версии ${u.version}` : ''}
      <//>` : null}
    ${store.sync.clockSkewMin ? html`
      <${Banner} tone="warn" onClose=${() => setSync({ clockSkewMin: 0 })}>
        Часы устройства ${store.sync.clockSkewMin > 0 ? 'спешат' : 'отстают'} на ${Math.abs(store.sync.clockSkewMin)} мин.
        Исправь время — иначе правки могут сливаться неправильно.
      <//>` : null}
    ${store.sync.extraRoots?.length ? html`
      <${Banner} tone="warn" onClose=${() => setSync({ extraRoots: [] })}>
        На Диске найдено несколько папок LifeTasks. Используется самая старая; остальные можно удалить вручную после проверки.
      <//>` : null}
    ${store.ui.conflictsNew ? html`
      <${Banner} tone="info" onClose=${() => setUi({ conflictsNew: 0 })} actions=${html`
        <button class="btn small primary" onClick=${() => navigate('/journal')}>Посмотреть</button>`}>
        Конфликты при слиянии: ${store.ui.conflictsNew}. Проигравшие значения сохранены в журнале.
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

export function App() {
  useStore();
  const route = useRoute();
  const desktop = useMedia('(min-width: 900px)');
  const wide = useMedia('(min-width: 1200px)');
  const lastBase = useRef({ name: 'today', param: null, query: {}, path: '/today' });
  if (route.name !== 'task' && route.name !== 'quick') lastBase.current = route;

  const panel = wide && route.name === 'task';
  const base = panel ? lastBase.current : route;
  const counts = useMemo(() => S.activeCounts(store.data), [store.version]);

  const quickCtx = () => {
    if (base.name === 'list' && S.liveList(store.data, base.param)) return { listId: base.param };
    if (base.name === 'today') return { scheduledDate: store.now.today };
    return {};
  };
  const add = () => !store.ui.readOnly && openQuickAdd(quickCtx());

  // Ярлык PWA «Быстрая задача» → #/quick
  useEffect(() => {
    if (route.name === 'quick') {
      navigate('/today', { replace: true });
      if (!store.ui.readOnly) openQuickAdd({});
    }
  }, [route.name]);

  useEffect(() => {
    document.title = route.name === 'task' ? 'Задача · LifeTasks' : `${titleFor(base)} · LifeTasks`;
  });

  // Клавиши: N — быстрый ввод, Esc — закрыть верхний слой.
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      const editing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable;
      if (e.key === 'Escape') {
        if (store.ui.dialog) closeDialog(null);
        else if (store.ui.sheet) closeSheet();
        else if (store.ui.quickAdd) closeQuickAdd();
        else if (location.hash.startsWith('#/task/') && !editing) goBack(lastBase.current.path);
        else return;
        e.preventDefault();
        return;
      }
      if (e.code === 'KeyN' && !e.ctrlKey && !e.metaKey && !e.altKey && !editing
        && !store.ui.dialog && !store.ui.sheet && !store.ui.quickAdd) {
        e.preventDefault();
        add();
      }
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

  const showFab = !desktop && !['task', 'settings'].includes(route.name) && !store.ui.readOnly;

  return html`
    <div class=${'app' + (panel ? ' with-panel' : '') + (desktop ? ' desktop' : ' mobile')}>
      ${desktop ? html`<${Sidebar} route=${base} counts=${counts} onAdd=${add}/>` : null}
      <div class="main-col">
        ${base.name !== 'task' ? html`<${TopBar} route=${base}/>` : null}
        <${Banners}/>
        <main class="content" id="main"><${Screen} route=${base}/></main>
      </div>
      ${panel ? html`
        <aside class="task-panel">
          <${TaskScreen} key=${route.param} taskId=${route.param} panel onClose=${() => goBack(lastBase.current.path)}/>
        </aside>` : null}
      ${!desktop ? html`<${BottomNav} route=${base} counts=${counts}/>` : null}
      ${showFab ? html`<button class="fab" onClick=${add} aria-label="Новая задача" title="Новая задача"><${Icon} name="plus" size=${28}/></button>` : null}
      <${QuickAddHost}/>
      <${SheetHost}/>
      <${StartScreen}/>
      <${RedirectingScreen}/>
      <${DialogHost}/>
      <${Snackbar}/>
    </div>`;
}
