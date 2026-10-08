// Панель навигации в духе дока Ubuntu (обновление 0.3, п. 2.3; с 0.10 — полный перенос дока license-store:
// components/layout/dock.tsx). Плавающая плашка по центру выбранного края; всё вокруг неё прозрачно и не
// перехватывает клики.
//
// Три вида: icon — свёрнута, только значки с подсказками от края внутрь; row — развёрнута у бокового края
// (значки с подписями, названия групп, ветки раскрываются на месте); tile — развёрнута сверху или снизу
// (подписи под значками, ветки — выпадающим меню). Квадрат с буквой прячет док целиком (остаётся одна буква),
// автоскрытие убирает его за край до наведения мыши. На телефоне развёрнутый док — временная шторка поверх
// страницы (app.js): место под неё не резервируется, выбор не запоминается.
//
// 0.11 (Crimson Harvest): док у каждого приложения свой — меню, буква (C — Chronicle, F — Feast) и оформление.
// Спрятанный док показывает букву открытого приложения и под ней (сбоку, если док сверху или снизу) — букву
// второго: нажатие на неё переключает приложение.

import { html, useState, useRef, useEffect, useLayoutEffect } from '../html.js';
import { Icon } from '../icons.js';
import { navigate } from '../router.js';
import { store, openSheet, totalDirty } from '../../store/appState.js';
import { indicator } from '../../sync/status.js';
import { push } from '../../sync/syncEngine.js';
import { syncState } from './Sync.js';
import { getPrefs, setPrefs, activeApp } from '../prefs.js';
import { buildMenu, isTargetActive, isBranchActive } from '../nav.js';
import { openMenu } from './Popup.js';
import { shortcutText } from '../keys.js';
import { tokenValid, startLogin } from '../../google/auth.js';
import { confirmLogout } from '../account.js';
import { APPS, otherApp, letterColors } from '../apps.js';

/** Отступ плашки от края экрана — padding обёртки. */
export const DOCK_EDGE_GAP = 12;

/** Подсказки и меню раскрываются от края внутрь экрана. */
const INWARD = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
const SIDES = ['left', 'right', 'top', 'bottom'];

/** Задержка перед тем, как отпущенный мышью док уедет. */
const AUTO_HIDE_DELAY_MS = 400;

const ICON_SIZE = { icon: 22, row: 20, tile: 22 };

/**
 * Квадрат-значок приложения: буква (C — Chronicle, F — Feast) цвета акцента, нарисован CSS.
 * other — значок не открытого приложения: цвета берутся из его собственного оформления.
 */
export function AppLetter({ size = 36, app = null, other = false }) {
  const id = app || activeApp();
  const letter = APPS[id]?.letter || 'C';
  // две буквы (CH) — мельче, чтобы влезли в квадрат
  const style = { width: size + 'px', height: size + 'px', fontSize: size * (letter.length > 1 ? 0.4 : 0.5) + 'px' };
  if (other) {
    const c = letterColors(id);
    style.background = c.bg;
    style.color = c.fg;
  }
  return html`<span class=${'app-letter' + (other ? ' other' : '') + (letter.length > 1 ? ' two' : '')} style=${style} aria-hidden="true">${letter}</span>`;
}

/** Подсказка нужна только свёрнутой панели: в развёрнутой подпись и так видна. */
const hintOf = (ctx, label, key = null) => (ctx.mode === 'icon'
  ? { 'data-hint': label, 'data-hint-side': ctx.side, 'data-hint-kbd': key ? shortcutText(key) : '' }
  : {});

const plainClick = (e) => !(e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1);

function Divider() {
  return html`<span class="dock-sep" aria-hidden="true"></span>`;
}

function Indicator() {
  return html`<i class="dock-indicator" aria-hidden="true"></i>`;
}

function Mark({ item, size }) {
  if (item.color) return html`<i class="dot dock-dot" style=${{ background: item.color }}></i>`;
  return item.icon ? html`<${Icon} name=${item.icon} size=${size}/>` : null;
}

function DockLink({ item, ctx }) {
  const active = isTargetActive(ctx.route, item);
  return html`
    <a href=${'#' + item.to} class="dock-item" data-active=${active ? 'true' : 'false'} aria-current=${active ? 'page' : undefined}
      onClick=${(e) => { if (!plainClick(e)) return; e.preventDefault(); ctx.onNavigate(); navigate(item.to); }}
      ...${hintOf(ctx, item.title, item.key)}>
      ${active ? html`<${Indicator}/>` : null}
      <${Mark} item=${item} size=${ICON_SIZE[ctx.mode]}/>
      <span class="dock-label">${item.emoji ? item.emoji + ' ' : ''}${item.title}</span>
      ${item.count ? html`<span class="dock-count">${item.count}</span>` : null}
    </a>`;
}

/**
 * Пункт с подменю. В боковой развёрнутой панели раскрывается на месте (открытость запоминается),
 * в остальных видах — выпадающим меню от края внутрь.
 */
function DockMenu({ item, ctx }) {
  const active = isBranchActive(ctx.route, item);
  const [open, setOpen] = useState(() => getPrefs().dockOpen?.[item.id] ?? active);
  const content = html`
    ${active ? html`<${Indicator}/>` : null}
    <${Icon} name=${item.icon} size=${ICON_SIZE[ctx.mode]}/>
    <span class="dock-label">${item.title}</span>`;

  if (ctx.mode === 'row') {
    const toggle = () => {
      setOpen(!open);
      setPrefs({ dockOpen: { ...(getPrefs().dockOpen || {}), [item.id]: !open } });
    };
    return html`
      <div class=${'dock-branch' + (open ? ' open' : '')}>
        <button type="button" class="dock-item" data-active=${active ? 'true' : 'false'} aria-expanded=${open} onClick=${toggle}>
          ${content}<${Icon} name="chevron" size=${16} className="dock-chevron"/>
        </button>
        <div class="dock-collapse" inert=${!open}><div class="dock-collapse-inner"><div class="dock-sub">
          ${item.items.map((sub) => {
            const subActive = isTargetActive(ctx.route, sub);
            return html`
              <a key=${sub.to} href=${'#' + sub.to} class="dock-item dock-subitem" data-active=${subActive ? 'true' : 'false'}
                aria-current=${subActive ? 'page' : undefined}
                onClick=${(e) => { if (!plainClick(e)) return; e.preventDefault(); ctx.onNavigate(); navigate(sub.to); }}>
                <${Mark} item=${sub} size=${16}/>
                <span class="dock-label">${sub.emoji ? sub.emoji + ' ' : ''}${sub.title}</span>
                ${sub.count ? html`<span class="dock-count">${sub.count}</span>` : null}
              </a>`;
          })}
        </div></div></div>
      </div>`;
  }

  const show = (e) => openMenu({
    anchor: e.currentTarget,
    side: ctx.side,
    align: 'center',
    title: item.title,
    className: 'dock-menu',
    viaKeyboard: e.detail === 0,
    items: item.items.map((sub) => ({
      label: sub.title, icon: sub.icon, emoji: sub.emoji, color: sub.color, count: sub.count,
      kbd: sub.key ? shortcutText(sub.key) : '', active: isTargetActive(ctx.route, sub),
      onSelect: () => { ctx.onNavigate(); navigate(sub.to); },
    })),
  });
  return html`
    <button type="button" class="dock-item" data-active=${active ? 'true' : 'false'} aria-haspopup="menu" aria-expanded="false"
      onClick=${show} ...${hintOf(ctx, item.title)}>
      ${content}
      ${item.count ? html`<span class="dock-count">${item.count}</span>` : null}
    </button>`;
}

/** Аккаунт Google: инициалы почты, меню «Настройки», «Внешний вид», «Горячие клавиши», переход в другое приложение, вход/выход. */
function UserMenu({ ctx, app, onSwitch }) {
  const email = store.auth?.email || '';
  const valid = tokenValid();
  const name = email || 'Аккаунт';
  const go = (to) => () => { ctx.onNavigate(); navigate(to); };
  const show = (e) => openMenu({
    anchor: e.currentTarget,
    side: ctx.side,
    align: 'center',
    title: email || 'Вход не выполнен',
    className: 'dock-menu user-menu',
    viaKeyboard: e.detail === 0,
    items: [
      { label: 'Настройки', icon: 'settings', onSelect: go('/settings'), kbd: shortcutText('goSettings') },
      { label: 'Внешний вид', icon: 'palette', onSelect: go('/settings?section=appearance') },
      { label: 'Горячие клавиши', icon: 'keyboard', onSelect: go('/settings?section=shortcuts'), kbd: shortcutText('help') },
      { label: 'Синхронизация', icon: 'sync', onSelect: () => { ctx.onNavigate(); openSheet('sync'); } },
      { label: `Перейти в ${APPS[otherApp(app)].name}`, icon: 'swap', onSelect: () => { ctx.onNavigate(); onSwitch(); }, kbd: shortcutText('switchApp') },
      { separator: true },
      email || valid
        ? { label: 'Выйти из Google', icon: 'logout', danger: true, onSelect: () => { ctx.onNavigate(); confirmLogout(); } }
        : { label: 'Войти через Google', icon: 'user', disabled: store.sync.offline, onSelect: () => startLogin({ action: 'pull' }) },
    ],
  });
  return html`
    <button type="button" class="dock-item dock-user" aria-haspopup="menu" aria-expanded="false" onClick=${show} ...${hintOf(ctx, name)}>
      <span class="dock-avatar" aria-hidden="true">${email ? email.slice(0, 2).toUpperCase() : html`<${Icon} name="user" size=${16}/>`}</span>
      <span class="dock-label">${name}</span>
    </button>`;
}

export function Dock({ route, counts, onAdd, phone, position, expanded, hidden, autoHide, overlay, onToggle, onToggleHidden, onNavigate, app = 'chronicle', onSwitch }) {
  const panel = useRef(null);
  const hideTimer = useRef(null);
  const [revealed, setRevealed] = useState(false);
  const vertical = position === 'left' || position === 'right';
  const mode = hidden || !expanded ? 'icon' : vertical ? 'row' : 'tile';
  // Телефон, свёрнутый док снизу/сверху: пункты делят ширину поровну, редкое — в шторке (кнопка ⠿)
  const compact = phone && !vertical && mode === 'icon';
  const ctx = { mode, side: INWARD[position], position, route, onNavigate };
  const slidOut = autoHide && !hidden && !revealed;

  // Толщина дока вместе с отступом от края: столько места резервирует страница (--dock-<край>).
  // 0 — если док поверх страницы (автоскрытие, спрятан); пока открыта шторка — место под свёрнутый.
  useLayoutEffect(() => {
    const root = document.documentElement.style;
    const report = () => {
      if (overlay) return;
      for (const s of SIDES) root.setProperty(`--dock-${s}`, '0px');
      if (autoHide || hidden || !panel.current) return;
      const size = (vertical ? panel.current.offsetWidth : panel.current.offsetHeight) + DOCK_EDGE_GAP;
      root.setProperty(`--dock-${position}`, size + 'px');
    };
    report();
    if (!panel.current || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(report);
    ro.observe(panel.current);
    return () => ro.disconnect();
  }, [position, hidden, autoHide, mode, overlay, compact]);

  useEffect(() => () => clearTimeout(hideTimer.current), []);

  const reveal = () => {
    clearTimeout(hideTimer.current);
    setRevealed(true);
  };
  /** Уезжаем, только если не открыто меню аккаунта или подменю. */
  const scheduleHide = () => {
    if (!autoHide) return;
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (panel.current?.querySelector('[data-state="open"]')) scheduleHide();
      else setRevealed(false);
    }, AUTO_HIDE_DELAY_MS);
  };

  const letterLabel = hidden ? 'Показать панель' : 'Спрятать панель';
  const letter = html`
    <button type="button" class="dock-item dock-brand" onClick=${onToggleHidden} aria-label=${letterLabel} aria-pressed=${hidden}
      ...${hintOf(ctx, letterLabel, 'dockHide')}>
      <${AppLetter} size=${36} app=${app}/><span class="dock-label brand-label">${APPS[app].name}</span>
    </button>`;

  if (hidden) {
    const other = otherApp(app);
    const switchLabel = `${APPS[other].name} — ${APPS[other].what}`;
    return html`<div class=${'dock-wrap pos-' + position}>
      <nav ref=${panel} class="dock dock-hidden mode-icon" aria-label="Навигация">
        ${letter}
        <button type="button" class="dock-item dock-brand dock-switch" key=${other} onClick=${onSwitch}
          aria-label=${'Перейти в ' + switchLabel} ...${hintOf(ctx, 'Перейти в ' + switchLabel, 'switchApp')}>
          <${AppLetter} size=${36} app=${other} other/>
        </button>
      </nav></div>`;
  }

  const groups = buildMenu(counts, app);
  const addLabel = app === 'feast' ? 'Записать еду' : 'Новая задача';
  const ind = indicator(syncState());
  const dirty = totalDirty();
  const toggleLabel = expanded ? 'Свернуть панель' : 'Развернуть панель';
  const busy = ind.key === 'busy';
  const items = (g) => g.items.filter((it) => !compact || (it.to !== '/tasks' && it.to !== '/settings'));

  return html`
    ${autoHide ? html`<div class=${'dock-hot pos-' + position} aria-hidden="true" onMouseEnter=${reveal}></div>` : null}
    <div class=${'dock-wrap pos-' + position + (slidOut ? ' slid' : '') + (overlay ? ' is-overlay' : '')}>
      <nav ref=${panel} aria-label="Навигация"
        class=${'dock mode-' + mode + (compact ? ' compact' : '') + (overlay ? ' is-overlay' : '')}
        onMouseEnter=${autoHide ? reveal : undefined} onMouseLeave=${autoHide ? scheduleHide : undefined}
        onFocusIn=${autoHide ? reveal : undefined} onFocusOut=${autoHide ? scheduleHide : undefined}>
        ${letter}
        <button type="button" class="dock-item dock-add" onClick=${() => { onNavigate(); onAdd(); }} disabled=${!!store.ui.readOnly}
          aria-label=${addLabel} ...${hintOf(ctx, addLabel, 'newTask')}>
          <${Icon} name="plus" size=${ICON_SIZE[mode]}/><span class="dock-label">${compact ? (app === 'feast' ? 'Еда' : 'Задача') : addLabel}</span>
        </button>

        ${groups.map((g) => html`
          <div class="dock-group" key=${g.title} role="group" aria-label=${g.title}>
            ${mode === 'row' ? html`<div class="dock-group-title">${g.title}</div>` : compact ? null : html`<${Divider}/>`}
            ${items(g).map((it) => (it.items
              ? html`<${DockMenu} key=${it.id} item=${it} ctx=${ctx}/>`
              : html`<${DockLink} key=${it.to} item=${it} ctx=${ctx}/>`))}
          </div>`)}

        ${compact ? null : html`<${Divider}/>
        <button type="button" class=${'dock-item dock-sync tone-' + ind.tone} onClick=${() => { onNavigate(); openSheet('sync'); }}
          aria-label=${'Синхронизация: ' + ind.text} ...${hintOf(ctx, ind.text)}>
          <${Icon} name=${ind.icon} size=${ICON_SIZE[mode] - 2} className=${busy ? 'spin' : ''}/>
          <span class="dock-label">${mode === 'row' ? ind.text : ind.short}</span>
        </button>`}
        <button type="button" class=${'dock-item dock-push' + (compact ? ' tone-' + ind.tone : '')} onClick=${() => push()}
          disabled=${!!store.sync.phase || !!store.ui.readOnly} aria-label="Пуш"
          ...${hintOf(ctx, compact ? 'Пуш · ' + ind.text : 'Пуш — отправить изменения на Google Диск', 'push')}>
          <${Icon} name=${compact && busy ? ind.icon : 'upload'} size=${ICON_SIZE[mode] - 2} className=${compact && busy ? 'spin' : ''}/>
          <span class="dock-label">Пуш</span>${dirty ? html`<span class="dock-count">${dirty}</span>` : null}
        </button>
        ${compact ? null : html`<${UserMenu} ctx=${ctx} app=${app} onSwitch=${onSwitch}/>`}
        <button type="button" class="dock-item dock-toggle" onClick=${onToggle} aria-expanded=${expanded}
          aria-label=${toggleLabel} ...${hintOf(ctx, toggleLabel, 'dockExpand')}>
          <${Icon} name="grip" size=${ICON_SIZE[mode] - 2}/><span class="dock-label">${toggleLabel}</span>
        </button>
      </nav>
    </div>`;
}
