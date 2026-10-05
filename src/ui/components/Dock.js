// Панель навигации в духе дока Ubuntu или браузера (обновление 0.3, п. 2.3).
// Плавающая плашка по центру выбранного края. Виды: icon — свёрнута (только значки, подсказки в title);
// row — развёрнута у бокового края (значок и подпись строкой, списки под «Списками»);
// tile — развёрнута сверху/снизу (подпись под значком). Квадрат с буквой прячет док целиком;
// автоскрытие убирает его за край до подхода мыши (на сенсорном экране — до тапа по полоске у края).

import { html, useState, useRef, useEffect, useLayoutEffect } from '../html.js';
import { Icon } from '../icons.js';
import { Link, navigate } from '../router.js';
import { store, openSheet } from '../../store/appState.js';
import * as S from '../../core/selectors.js';
import { indicator } from '../../sync/status.js';
import { push } from '../../sync/syncEngine.js';
import { syncState } from './Sync.js';
import { getPrefs, setPrefs, dockPosition } from '../prefs.js';

const HIDE_DELAY_MS = 400;
const TOUCH_SHOW_MS = 4000;
const GAP = 12;

/** Квадрат-значок приложения: буква L цвета акцента, нарисован CSS (иконки PWA в icons/ не трогаем). */
export function AppLetter({ size = 36 }) {
  return html`<span class="app-letter" style=${{ width: size + 'px', height: size + 'px', fontSize: size * 0.5 + 'px' }} aria-hidden="true">L</span>`;
}

function Item({ to, icon, label, active, count, mode, color, emoji, onClick = null, title = null, expanded }) {
  const body = html`
    ${active ? html`<i class="dock-indicator"></i>` : null}
    ${color ? html`<i class="dot big" style=${{ background: color }}></i>` : html`<${Icon} name=${icon} size=${mode === 'row' ? 20 : 22}/>`}
    <span class="dock-label">${emoji ? emoji + ' ' : ''}${label}</span>
    ${count ? html`<span class="dock-count">${count}</span>` : null}`;
  const cls = 'dock-item' + (active ? ' active' : '');
  if (onClick) return html`<button type="button" class=${cls} onClick=${onClick} title=${title || label} aria-label=${label} aria-expanded=${expanded}>${body}</button>`;
  return html`<${Link} to=${to} className=${cls} title=${title || label}>${body}<//>`;
}

export function Dock({ route, counts, onAdd, phone }) {
  const p = getPrefs();
  const pos = dockPosition(phone);
  const vertical = pos === 'left' || pos === 'right';
  const hidden = p.hidden;
  const mode = hidden || !p.expanded ? 'icon' : vertical ? 'row' : 'tile';
  const [revealed, setRevealed] = useState(false);
  const timer = useRef(null);
  const panel = useRef(null);
  const slidOut = p.autoHide && !hidden && !revealed;

  // Сколько места резервирует страница: толщина плашки + отступ (0 — если плашка поверх: автоскрытие или спрятана).
  useLayoutEffect(() => {
    const root = document.documentElement.style;
    const report = () => {
      for (const s of ['left', 'right', 'top', 'bottom']) root.setProperty(`--dock-${s}`, '0px');
      if (p.autoHide || hidden || !panel.current) return;
      const size = (vertical ? panel.current.offsetWidth : panel.current.offsetHeight) + GAP;
      root.setProperty(`--dock-${pos}`, size + 'px');
    };
    report();
    if (!panel.current || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(report);
    ro.observe(panel.current);
    return () => ro.disconnect();
  }, [pos, hidden, p.autoHide, mode]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const reveal = (ms = 0) => {
    clearTimeout(timer.current);
    setRevealed(true);
    if (ms) timer.current = setTimeout(() => setRevealed(false), ms);
  };
  const scheduleHide = () => {
    if (!p.autoHide) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setRevealed(false), HIDE_DELAY_MS);
  };

  const is = (...names) => names.includes(route.name);
  const letter = html`
    <button type="button" class="dock-item dock-brand" onClick=${() => setPrefs({ hidden: !hidden })}
      title=${hidden ? 'Показать панель' : 'Спрятать панель'} aria-label=${hidden ? 'Показать панель' : 'Спрятать панель'} aria-pressed=${hidden}>
      <${AppLetter} size=${mode === 'row' ? 32 : 36}/><span class="dock-label brand-label">LifeTasks</span>
    </button>`;

  if (hidden) {
    return html`<div class=${'dock-wrap pos-' + pos}><nav class="dock mode-icon" ref=${panel} aria-label="Навигация">${letter}</nav></div>`;
  }

  const lists = mode === 'row' ? S.sortedLists(store.data) : [];
  const trash = S.trashView(store.data).length;
  const ind = indicator(syncState());
  const n = store.ui.dirtyCount;
  // На телефоне снизу/сверху места мало: редкие разделы — под «Ещё».
  const compact = phone && !vertical;
  const sep = html`<span class="dock-sep" aria-hidden="true"></span>`;

  return html`
    ${p.autoHide ? html`<div class=${'dock-hot pos-' + pos} aria-hidden="true"
      onMouseEnter=${() => reveal()} onClick=${() => reveal(TOUCH_SHOW_MS)}></div>` : null}
    <div class=${'dock-wrap pos-' + pos + (slidOut ? ' slid' : '')}>
      <nav class=${'dock mode-' + mode + (compact ? ' compact' : '')} ref=${panel} aria-label="Навигация"
        onMouseEnter=${p.autoHide ? () => reveal() : undefined} onMouseLeave=${p.autoHide ? scheduleHide : undefined}
        onFocusIn=${p.autoHide ? () => reveal() : undefined} onFocusOut=${p.autoHide ? scheduleHide : undefined}>
        ${letter}
        <button type="button" class="dock-item dock-add" onClick=${onAdd} disabled=${!!store.ui.readOnly} title="Новая задача (N)" aria-label="Новая задача">
          <${Icon} name="plus" size=${22}/><span class="dock-label">${compact ? 'Задача' : 'Новая задача'}</span></button>
        ${compact ? null : sep}
        <${Item} to="/today" icon="sun" label="Сегодня" active=${is('today')} mode=${mode}/>
        <${Item} to="/inbox" icon="inbox" label="Входящие" active=${is('inbox')} count=${counts.get('inbox')} mode=${mode}/>
        <${Item} icon="lists" label=${'Списки ' + (p.listsCollapsed ? '▸' : '▾')} expanded=${!p.listsCollapsed} active=${is('lists') || (is('list') && mode !== 'row')} mode=${mode}
          onClick=${() => { setPrefs({ listsCollapsed: !p.listsCollapsed }); navigate('/lists'); }}/>
        ${lists.length && !p.listsCollapsed ? html`<div class="dock-sub">${lists.map((l) => html`<${Item} key=${l.id} to=${'/list/' + l.id}
          label=${l.name} emoji=${l.emoji} color=${l.color} active=${is('list') && route.param === l.id} count=${counts.get(l.id)} mode=${mode}/>`)}</div>` : null}
        ${compact ? html`<${Item} to="/more" icon="more" label="Ещё" active=${is('more', 'archive', 'trash', 'settings', 'analytics', 'shop', 'journal', 'village')} mode=${mode}/>` : html`
          <${Item} to="/analytics" icon="chart" label="Аналитика" active=${is('analytics')} mode=${mode}/>
          ${store.data.settings.gameEnabled ? html`<${Item} to="/village" icon="village" label="Деревня" active=${is('village')} mode=${mode}/>` : null}
          <${Item} to="/shop" icon="shop" label="Магазин" active=${is('shop')} mode=${mode}/>
          <${Item} to="/archive" icon="archive" label="Архив" active=${is('archive')} mode=${mode}/>
          <${Item} to="/trash" icon="trash" label="Корзина" active=${is('trash')} count=${trash} mode=${mode}/>
          <${Item} to="/settings" icon="settings" label="Настройки" active=${is('settings', 'journal')} mode=${mode}/>`}
        ${compact ? null : html`${sep}
        <button type="button" class=${'dock-item dock-sync tone-' + ind.tone} onClick=${() => openSheet('sync')} title=${ind.text} aria-label=${'Синхронизация: ' + ind.text}>
          <${Icon} name=${ind.icon} size=${20} className=${ind.key === 'busy' ? 'spin' : ''}/>
          <span class="dock-label">${mode === 'row' ? ind.text : ind.short}</span></button>`}
        <button type="button" class=${'dock-item dock-push' + (compact ? ' tone-' + ind.tone : '')} onClick=${() => push()} disabled=${!!store.sync.phase || !!store.ui.readOnly}
          title=${compact ? 'Пуш · ' + ind.text : 'Пуш — отправить изменения на Google Диск'} aria-label="Пуш">
          <${Icon} name=${compact && ind.key === 'busy' ? ind.icon : 'upload'} size=${20} className=${compact && ind.key === 'busy' ? 'spin' : ''}/>
          <span class="dock-label">Пуш</span>${n ? html`<span class="dock-count">${n}</span>` : null}</button>
        ${compact ? null : html`<button type="button" class="dock-item dock-toggle" onClick=${() => setPrefs({ expanded: !p.expanded })}
          title=${p.expanded ? 'Свернуть панель' : 'Развернуть панель'} aria-label=${p.expanded ? 'Свернуть панель' : 'Развернуть панель'} aria-expanded=${p.expanded}>
          <${Icon} name="grip" size=${20}/><span class="dock-label">${p.expanded ? 'Свернуть' : 'Развернуть'}</span></button>`}
      </nav>
    </div>`;
}
