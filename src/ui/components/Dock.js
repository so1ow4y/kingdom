// Панель навигации в духе дока Ubuntu (обновление 0.3, п. 2.3; с 0.10 — полный перенос дока license-store:
// components/layout/dock.tsx). Плавающая плашка по центру выбранного края; всё вокруг неё прозрачно и не
// перехватывает клики.
//
// Три вида: icon — свёрнута, только значки с подсказками от края внутрь; row — развёрнута у бокового края
// (значки с подписями, названия групп, ветки раскрываются на месте); tile — развёрнута сверху или снизу
// (подписи под значками). Квадрат с буквой прячет док целиком (остаётся одна буква), автоскрытие убирает его
// за край до наведения мыши. На телефоне развёрнутый док — временная шторка поверх страницы (app.js): место под
// неё не резервируется, выбор не запоминается.
//
// 0.11 (Crimson Harvest): док у каждого приложения свой — меню, буква (C — Chronicle, F — Feast) и оформление.
// Спрятанный док показывает букву открытого приложения и под ней (сбоку, если док сверху или снизу) — букву
// второго: нажатие на неё переключает приложение.
//
// 0.16 — второй перенос дока license-store. Ветка (например, «Списки» или «Поиск») в свёрнутом доке раскрывается
// подветкой из таких же квадратиков: отдельной колонкой рядом с доком, вниз от значка ветки (side), или прямо
// внутри дока под значком (inline); в развёрнутом сверху или снизу — колонкой плиток с подписями. Клик по ветке
// только раскрывает и сворачивает подветку — экран он не открывает. Раскрыта одна ветка; она следует за экраном
// (перешли в другую ветку — раскрыта она), переход на пункт вне веток её сворачивает.
//
// Куда растёт док при раскрытии ветки внутри него, задаёт настройка grow: по умолчанию только вниз — верх дока
// закреплён там, где стоял бы док без раскрытых веток, и пункт под мышью не уезжает. Не влезает — док не растёт
// дальше, а прокручивается внутри. Длина и ширина бывают по содержимому или свои. Сдвигать ли страницу под док
// (и под колонку подветки) — настройка push.
//
// С клавиатуры (клавиши настраиваются, по умолчанию Q/E и Enter/Пробел): вверх и вниз по пунктам, включая
// раскрытую подветку; Enter открывает пункт, у ветки — раскрывает или сворачивает её. Мышью пункт открывается сразу.
//
// 1.1 (из pdd-trainer): fill — «Занимать всё пространство»: док во всю длину края, без отступа и скруглений (по
// умолчанию — на телефоне). Телефон (свёрнутый док снизу или сверху) — лента: видно barCount пунктов, остальные
// листаются пальцем (прокрутка с прилипанием к пункту), размер значков и подписи — настройки; «Ещё» (шторка со всем)
// стоит отдельно справа. Какие пункты в доке и в каком порядке — ui/dockLayout.js, у телефона и компьютера свои;
// пункт «Перейти в …» переключает приложение прямо из дока.

import { html, useState, useRef, useEffect, useLayoutEffect } from '../html.js';
import { Icon } from '../icons.js';
import { navigate } from '../router.js';
import { store, openSheet, totalDirty, flushAll } from '../../store/appState.js';
import { indicator } from '../../sync/status.js';
import { push } from '../../sync/syncEngine.js';
import { syncState } from './Sync.js';
import { activeApp } from '../prefs.js';
import { buildMenu, isTargetActive, isBranchActive } from '../nav.js';
import { dockLayout, chunkByGroup } from '../dockLayout.js';
import { openMenu } from './Popup.js';
import { shortcutText } from '../keys.js';
import { tokenValid, startLogin } from '../../google/auth.js';
import { confirmLogout } from '../account.js';
import { APPS, otherApp, letterColors } from '../apps.js';
import { tr, LANG, LANGS, setLang } from '../../core/i18n.js';

/** Отступ плашки от края экрана — padding обёртки. */
export const DOCK_EDGE_GAP = 12;

/** Зазор между доком и колонкой подветки. */
const STRIP_GAP = 8;

/** Подсказки и меню раскрываются от края внутрь экрана. */
const INWARD = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
const SIDES = ['left', 'right', 'top', 'bottom'];

/** Задержка перед тем, как отпущенный мышью док уедет. */
const AUTO_HIDE_DELAY_MS = 400;

const ICON_SIZE = { icon: 22, row: 20, tile: 22 };
/** Лента телефона (1.1): значок и квадрат с буквой по размеру ленты. */
const BAR_ICON = { s: 20, m: 24, l: 30, xl: 38 };
const BAR_LETTER = { s: 28, m: 32, l: 40, xl: 50 };

/**
 * Клавиши дока для app.js («Меню: пункт выше / ниже», «Меню: открыть пункт»). Пока док виден, он подставляет
 * сюда свои обработчики; false — нажатие не его (например, фокус не на пункте дока — Enter остаётся странице).
 */
export const dockKeys = { move: () => false, activate: () => false };

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

/** Подсказка нужна только свёрнутой панели: в развёрнутой подпись и так видна; на ленте телефона — не нужна. */
const hintOf = (ctx, label, key = null, show = ctx.mode === 'icon' && !ctx.compact) => (show
  ? { 'data-hint': label, 'data-hint-side': ctx.side, 'data-hint-kbd': key ? shortcutText(key) : '' }
  : {});

const plainClick = (e) => !(e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1);

/** Ключ пункта для навигации с клавиатуры (атрибут data-dock-key). */
const linkKey = (item) => 'l:' + item.to;
const branchKey = (item) => 'b:' + item.id;
const subKey = (branchId, sub) => 's:' + branchId + ':' + sub.to;

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

/** Значок квадратика подветки: эмодзи (список, рацион), иначе цветная точка, иначе иконка. */
function SquareMark({ item, size }) {
  if (item.emoji) return html`<span class="dock-emoji" aria-hidden="true">${item.emoji}</span>`;
  return html`<${Mark} item=${item} size=${size}/>`;
}

const Count = ({ n }) => (n ? html`<span class="dock-count">${n}</span>` : null);

/** Пункт основной ветки без подпунктов: переход на него сворачивает раскрытую подветку. */
function DockLink({ item, ctx }) {
  const active = isTargetActive(ctx.route, item);
  return html`
    <a href=${'#' + item.to} class="dock-item" data-dock-key=${linkKey(item)} data-active=${active ? 'true' : 'false'}
      aria-current=${active ? 'page' : undefined}
      onClick=${(e) => { if (!plainClick(e)) return; e.preventDefault(); ctx.setOpenBranch(null); ctx.onNavigate(); navigate(item.to); }}
      ...${hintOf(ctx, (item.emoji ? item.emoji + ' ' : '') + item.title, item.key)}>
      ${active ? html`<${Indicator}/>` : null}
      <${Mark} item=${item} size=${ctx.iconSize}/>
      <span class="dock-label">${item.emoji ? item.emoji + ' ' : ''}${item.title}</span>
      <${Count} n=${item.count}/>
    </a>`;
}

/**
 * Квадратик подветки — в колонке рядом с доком (у горизонтального развёрнутого — плитка с подписью) или внутри
 * дока под значком ветки (compact: на 4 px меньше значка, чтобы раскрытая ветка не распирала док вширь).
 */
function SubLink({ item, branch, ctx, compact = false }) {
  const active = isTargetActive(ctx.route, item);
  const tile = ctx.mode === 'tile' && !compact;
  const label = (item.emoji ? item.emoji + ' ' : '') + item.title;
  return html`
    <a href=${'#' + item.to} class=${'dock-item dock-sq' + (compact ? ' compact' : '')} data-dock-key=${subKey(branch, item)}
      data-active=${active ? 'true' : 'false'} aria-current=${active ? 'page' : undefined}
      onClick=${(e) => { if (!plainClick(e)) return; e.preventDefault(); ctx.onNavigate(); navigate(item.to); }}
      ...${hintOf(ctx, label, item.key, !tile)}>
      ${tile ? html`<${Mark} item=${item} size=${ICON_SIZE.tile}/>` : html`<${SquareMark} item=${item} size=${compact ? 18 : ICON_SIZE.icon}/>`}
      <span class="dock-label">${label}</span>
      <${Count} n=${item.count}/>
    </a>`;
}

/**
 * Ветка основной панели. Клик раскрывает или сворачивает её подветку — квадратиками в свёрнутом доке, плитками
 * в развёрнутом горизонтальном, списком с подписями в развёрнутом боковом. Сама ветка экран не открывает.
 */
function DockBranch({ item, ctx }) {
  // Ветка подсвечена, если открыт любой её экран.
  const active = isBranchActive(ctx.route, item);
  const open = ctx.openBranch === item.id;
  const content = html`
    ${active ? html`<${Indicator}/>` : null}
    <${Icon} name=${item.icon} size=${ctx.iconSize}/>
    <span class="dock-label">${item.title}</span>`;

  if (ctx.mode === 'row') {
    // Раскрытая на месте ветка — тоже «раскрытая внутри дока» (data-dock-inline): док растёт в сторону grow.
    return html`
      <div class=${'dock-branch' + (open ? ' open' : '')}>
        <button type="button" class="dock-item" data-dock-key=${branchKey(item)} data-active=${active ? 'true' : 'false'}
          aria-expanded=${open} onClick=${() => ctx.toggleBranch(item.id)}>
          ${content}<${Count} n=${item.count}/><${Icon} name="chevron" size=${16} className="dock-chevron"/>
        </button>
        <div class="dock-collapse" inert=${!open} data-dock-inline><div class="dock-collapse-inner"><div class="dock-sub">
          ${item.items.map((sub) => {
            const subActive = isTargetActive(ctx.route, sub);
            return html`
              <a key=${sub.to} href=${'#' + sub.to} class="dock-item dock-subitem" data-dock-key=${subKey(item.id, sub)}
                data-active=${subActive ? 'true' : 'false'} aria-current=${subActive ? 'page' : undefined}
                onClick=${(e) => { if (!plainClick(e)) return; e.preventDefault(); ctx.onNavigate(); navigate(sub.to); }}>
                <${Mark} item=${sub} size=${16}/>
                <span class="dock-label">${sub.emoji ? sub.emoji + ' ' : ''}${sub.title}</span>
                <${Count} n=${sub.count}/>
              </a>`;
          })}
        </div></div></div>
      </div>`;
  }

  // В шторке на телефоне подветка тоже внутри: колонка рядом со шторкой ушла бы за экран. На ленте телефона —
  // всегда колонкой над лентой: внутри ленты квадратики сжались бы до ширины одного пункта.
  const inline = open && !ctx.compact && ((ctx.mode === 'icon' && ctx.subMode === 'inline') || ctx.overlay);
  const button = html`
    <button type="button" ref=${(el) => ctx.registerBranch(item.id, el)} class="dock-item" data-dock-key=${branchKey(item)}
      data-active=${active || open ? 'true' : 'false'} aria-expanded=${open} onClick=${() => ctx.toggleBranch(item.id)}
      ...${hintOf(ctx, item.title)}>
      ${content}<${Count} n=${item.count}/>
    </button>`;
  if (!inline) return button;

  // Раскрывающаяся панель: подпункты прямо в доке, под значком ветки.
  return html`
    ${button}
    <div class="dock-inline" role="group" aria-label=${item.title} data-dock-inline>
      ${item.items.map((sub) => html`<${SubLink} key=${sub.to} item=${sub} branch=${item.id} ctx=${ctx} compact=${ctx.mode === 'icon'}/>`)}
    </div>`;
}

/**
 * Язык виден на любом экране (как в доке license-store): тот, кто не читает текущий язык интерфейса, должен
 * найти выход без меню и настроек. Смена языка перезагружает страницу — недописанное сначала сохраняется.
 */
function LocaleItem({ ctx }) {
  const next = LANGS[(LANGS.findIndex((l) => l.key === LANG) + 1) % LANGS.length];
  const label = 'Язык · Language: ' + next.label;
  const go = async () => {
    try {
      await flushAll();
    } finally {
      setLang(next.key);
    }
  };
  return html`
    <button type="button" class="dock-item dock-lang" onClick=${go} aria-label=${label} lang=${next.key} ...${hintOf(ctx, label)}>
      <span class="dock-lang-badge" lang=${LANG}>${LANG.toUpperCase()}</span>
      <span class="dock-label">${ctx.mode === 'row' ? label : next.label}</span>
    </button>`;
}

/** Аккаунт Google: инициалы почты, меню «Настройки», «Внешний вид», «Горячие клавиши», переход в другое приложение, вход/выход. */
function UserMenu({ ctx, app, onSwitch }) {
  const email = store.auth?.email || '';
  const valid = tokenValid();
  const name = email || tr('Аккаунт');
  const go = (to) => () => { ctx.onNavigate(); navigate(to); };
  const show = (e) => openMenu({
    anchor: e.currentTarget,
    side: ctx.side,
    align: 'center',
    title: email || tr('Вход не выполнен'),
    className: 'dock-menu user-menu',
    viaKeyboard: e.detail === 0,
    items: [
      { label: tr('Настройки'), icon: 'settings', onSelect: go('/settings'), kbd: shortcutText('goSettings') },
      { label: tr('Внешний вид'), icon: 'palette', onSelect: go('/settings?section=appearance') },
      { label: tr('Горячие клавиши'), icon: 'keyboard', onSelect: go('/settings?section=shortcuts'), kbd: shortcutText('help') },
      { label: tr('Синхронизация'), icon: 'sync', onSelect: () => { ctx.onNavigate(); openSheet('sync'); } },
      { label: tr('Перейти в {p0}', { p0: APPS[otherApp(app)].name }), icon: 'swap', onSelect: () => { ctx.onNavigate(); onSwitch(); }, kbd: shortcutText('switchApp') },
      { separator: true },
      email || valid
        ? { label: tr('Выйти из Google'), icon: 'logout', danger: true, onSelect: () => { ctx.onNavigate(); confirmLogout(); } }
        : { label: tr('Войти через Google'), icon: 'user', disabled: store.sync.offline, onSelect: () => startLogin({ action: 'pull' }) },
    ],
  });
  return html`
    <button type="button" class="dock-item dock-user" aria-haspopup="menu" aria-expanded="false" onClick=${show} ...${hintOf(ctx, name)}>
      <span class="dock-avatar" aria-hidden="true">${email ? email.slice(0, 2).toUpperCase() : html`<${Icon} name="user" size=${16}/>`}</span>
      <span class="dock-label">${name}</span>
    </button>`;
}

/**
 * subMode, grow, sizeMode/size (длина вдоль края), thickness (своя ширина поперёк края или null), pagePush —
 * настройки из ui/prefs.js (у каждого приложения свои). Толщину дока (и открытой колонки подветки) док сам
 * пишет в CSS-переменные: --dock-<край> — сколько места отдать на странице (по pagePush), --dock-size-<край> —
 * сколько он занимает на самом деле (от него отступают всплывающие окна и панель справа).
 */
export function Dock({ route, counts, onAdd, phone, position, expanded, hidden, autoHide, overlay, onToggle, onToggleHidden, onNavigate,
  app = 'chronicle', onSwitch, subMode = 'side', grow = 'down', sizeMode = 'auto', size = 560, thickness = null, pagePush = 'dock',
  fill = false, layoutPrefs = {}, bar = { size: 'm', count: 5, labels: true } }) {
  const panel = useRef(null);
  const scroller = useRef(null);
  const [page, setPage] = useState({ at: 0, of: 1 });
  const inner = useRef(null);
  const strip = useRef(null);
  const branchEls = useRef(new Map());
  const hideTimer = useRef(null);
  const [revealed, setRevealed] = useState(false);
  const [stripOffset, setStripOffset] = useState(0);
  /** Отступ закреплённого края дока от края экрана вдоль оси (для grow = down/up). */
  const [anchorOffset, setAnchorOffset] = useState(0);
  const vertical = position === 'left' || position === 'right';
  const mode = hidden || !expanded ? 'icon' : vertical ? 'row' : 'tile';
  // Телефон, свёрнутый док снизу/сверху: пункты делят ширину поровну, редкое — в шторке (кнопка ⠿)
  const compact = phone && !vertical && mode === 'icon';
  // Шторка на телефоне, лента и док во всё пространство стоят по центру — закреплять край там незачем.
  const growMode = overlay || compact || fill ? 'both' : grow;
  const slidOut = autoHide && !hidden && !revealed;
  // 1.1: док во всё пространство — без отступа от края
  const gap = fill && !overlay ? 0 : DOCK_EDGE_GAP;

  const groups = buildMenu(counts, app);
  // 1.1: пункты по своему порядку (у телефона и компьютера свой); в шторке «Ещё» — всё
  const layout = dockLayout(groups, layoutPrefs, { phone, app });
  const visible = overlay ? dockLayout(groups, {}, { phone: false, app }) : layout.filter((e) => e.on);
  const branches = visible.filter((e) => e.item?.items).map((e) => e.item);
  /** Состав дока строкой: меню пересобирается на каждую отрисовку, а меняется редко. */
  const menuKey = visible.map((e) => e.key).join(',');

  // Ветка открытого экрана и пункт в ней.
  let routeTarget = null;
  for (const b of branches) {
    const sub = b.items.find((s) => isTargetActive(route, s));
    if (sub) {
      routeTarget = { branch: b.id, sub };
      break;
    }
  }
  const [openBranch, setOpenBranch] = useState(routeTarget?.branch ?? null);

  // Подветка следует за экраном: перешли в другую ветку — она и раскрыта. Зависимости — строки, а не объект:
  // меню пересобирается на каждую отрисовку, и эффект иначе отменял бы ручное сворачивание ветки.
  const routeBranch = routeTarget?.branch ?? null;
  const routeKey = routeTarget ? routeTarget.branch + '/' + routeTarget.sub.to : null;
  useEffect(() => {
    if (routeBranch) setOpenBranch(routeBranch);
  }, [routeBranch, routeKey]);

  const openItem = branches.find((b) => b.id === openBranch) || null;
  const showStrip = !hidden && !overlay && !!openItem && (mode === 'tile' || (mode === 'icon' && (subMode === 'side' || compact)));

  /** Клик по ветке: раскрыть её подветку или свернуть уже раскрытую. Экран не меняется. */
  const toggleBranch = (id) => setOpenBranch((cur) => (cur === id ? null : id));

  const ctx = {
    mode, side: INWARD[position], position, vertical, route, subMode, overlay, compact, openBranch, onNavigate, toggleBranch, setOpenBranch,
    iconSize: compact ? BAR_ICON[bar.size] || BAR_ICON.m : ICON_SIZE[mode],
    registerBranch: (id, el) => {
      if (el) branchEls.current.set(id, el);
      else branchEls.current.delete(id);
    },
  };

  // Толщина дока и колонки подветки — сколько места отдаёт страница (--dock-<край>) и сколько он занимает
  // (--dock-size-<край>). 0 — если док поверх страницы (автоскрытие, спрятан); пока открыта шторка — как было.
  useLayoutEffect(() => {
    const root = document.documentElement.style;
    const report = () => {
      if (overlay) return;
      for (const s of SIDES) {
        root.setProperty(`--dock-${s}`, '0px');
        root.setProperty(`--dock-size-${s}`, '0px');
      }
      if (autoHide || hidden || !panel.current) return;
      const own = (vertical ? panel.current.offsetWidth : panel.current.offsetHeight) + gap;
      const st = showStrip && strip.current ? (vertical ? strip.current.offsetWidth : strip.current.offsetHeight) + STRIP_GAP : 0;
      root.setProperty(`--dock-size-${position}`, own + 'px');
      root.setProperty(`--dock-${position}`, (pagePush === 'none' ? 0 : own + (pagePush === 'all' ? st : 0)) + 'px');
    };
    report();
    if (!panel.current || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(report);
    ro.observe(panel.current);
    if (showStrip && strip.current) ro.observe(strip.current);
    return () => ro.disconnect();
  }, [position, hidden, autoHide, mode, overlay, compact, pagePush, showStrip, openBranch, fill, bar.size, bar.labels]);

  // Закреплённый край. Док «по содержимому» ставится так, будто ни одна ветка внутри не раскрыта и он стоит
  // по центру; раскрытая ветка добавляет длину только в сторону роста, а то, что не влезло, прокручивается внутри.
  useLayoutEffect(() => {
    if (growMode === 'both' || hidden) {
      setAnchorOffset(0);
      return undefined;
    }
    const compute = () => {
      const nav = panel.current;
      if (!nav) return;
      const available = (vertical ? innerHeight : innerWidth) - 2 * DOCK_EDGE_GAP;
      let base;
      if (sizeMode === 'fixed') base = Math.min(size, available);
      else {
        const full = (vertical ? nav.scrollHeight : nav.scrollWidth) + 2;
        let extra = 0;
        // квадратики внутри дока отделены от соседей зазором 2 px; раскрытая на месте ветка — нет
        for (const el of nav.querySelectorAll('[data-dock-inline]')) {
          extra += (vertical ? el.offsetHeight : el.offsetWidth) + (el.classList.contains('dock-inline') ? 2 : 0);
        }
        base = Math.min(full - extra, available);
      }
      setAnchorOffset(Math.max(0, Math.round((available - base) / 2)));
    };
    compute();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(compute) : null;
    if (panel.current) ro?.observe(panel.current);
    window.addEventListener('resize', compute);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', compute);
    };
  }, [growMode, hidden, vertical, sizeMode, size, mode, subMode, openBranch, menuKey]);

  // Колонка подветки начинается вровень со значком ветки и уходит вниз (у горизонтального дока — вправо),
  // не вылезая за экран.
  useLayoutEffect(() => {
    if (!showStrip || !openBranch) return undefined;
    const place = () => {
      const box = inner.current?.getBoundingClientRect();
      const st = strip.current;
      const anchor = branchEls.current.get(openBranch);
      if (!box || !st || !anchor) return;
      const at = anchor.getBoundingClientRect();
      // 6 px — внутренний отступ колонки: первый квадратик встаёт ровно напротив значка.
      if (vertical) {
        const max = innerHeight - DOCK_EDGE_GAP - box.top - st.offsetHeight;
        setStripOffset(Math.max(DOCK_EDGE_GAP - box.top, Math.min(at.top - box.top - 6, max)));
      } else {
        const max = innerWidth - DOCK_EDGE_GAP - box.left - st.offsetWidth;
        setStripOffset(Math.max(DOCK_EDGE_GAP - box.left, Math.min(at.left - box.left - 6, max)));
      }
    };
    place();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
    if (strip.current) ro?.observe(strip.current);
    if (inner.current) ro?.observe(inner.current);
    const nav = panel.current;
    const sc = scroller.current;
    window.addEventListener('resize', place);
    nav?.addEventListener('scroll', place);
    sc?.addEventListener('scroll', place);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', place);
      nav?.removeEventListener('scroll', place);
      sc?.removeEventListener('scroll', place);
    };
  }, [showStrip, openBranch, vertical, position, mode]);

  // Лента телефона: точки страниц и прокрутка колесом мыши (если телефонный вид открыт на компьютере).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!compact || !el) return undefined;
    const update = () => {
      const of = Math.max(1, Math.round(el.scrollWidth / Math.max(1, el.clientWidth)));
      const at = Math.min(of - 1, Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
      setPage((p) => (p.at === at && p.of === of ? p : { at, of }));
    };
    const wheel = (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    el.addEventListener('wheel', wheel, { passive: false });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      el.removeEventListener('wheel', wheel);
      ro?.disconnect();
    };
  }, [compact, menuKey, bar.count, bar.size]);

  useEffect(() => () => clearTimeout(hideTimer.current), []);

  const reveal = () => {
    clearTimeout(hideTimer.current);
    setRevealed(true);
  };
  /** Уезжаем, только если не открыто меню аккаунта. */
  const scheduleHide = () => {
    if (!autoHide) return;
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (panel.current?.querySelector('[data-state="open"]')) scheduleHide();
      else setRevealed(false);
    }, AUTO_HIDE_DELAY_MS);
  };

  // Пункты в порядке показа: ветка, за ней её раскрытые подпункты.
  const entries = [];
  for (const { item: it } of visible) {
    if (!it) continue;
    if (it.items) {
      entries.push({ key: branchKey(it), kind: 'branch', id: it.id, active: isBranchActive(route, it) });
      if (openBranch === it.id) {
        for (const sub of it.items) entries.push({ key: subKey(it.id, sub), kind: 'link', to: sub.to, sub: true, active: isTargetActive(route, sub) });
      }
    } else entries.push({ key: linkKey(it), kind: 'link', to: it.to, active: isTargetActive(route, it) });
  }
  const live = useRef({});
  live.current = { entries, autoHide, onNavigate };

  // Клавиатура (app.js): вверх/вниз по пунктам, открыть пункт (ветку — раскрыть). «Открыть» работает только когда
  // фокус на пункте дока — иначе Enter и Пробел остаются за страницей.
  useEffect(() => {
    if (hidden) return undefined;
    const focusEntry = (key) => {
      const apply = () => {
        const el = document.querySelector(`[data-dock-key="${CSS.escape(key)}"]`);
        if (!el) return false;
        el.focus({ preventScroll: true });
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        return true;
      };
      // Пункт подветки мог ещё не отрисоваться — тогда со следующего такта.
      if (!apply()) setTimeout(apply, 0);
    };
    const focusedKey = () => document.activeElement?.closest?.('[data-dock-key]')?.dataset.dockKey ?? null;
    dockKeys.move = (delta) => {
      const list = live.current.entries;
      if (!list.length) return false;
      if (live.current.autoHide) reveal();
      const cur = focusedKey();
      const i = cur ? list.findIndex((e) => e.key === cur) : -1;
      let next;
      if (i < 0) {
        // Первое нажатие встаёт на пункт открытого экрана.
        const a = list.findIndex((e) => e.kind === 'link' && e.active);
        next = a >= 0 ? a : delta > 0 ? 0 : list.length - 1;
      } else next = Math.max(0, Math.min(list.length - 1, i + delta));
      focusEntry(list[next].key);
      return true;
    };
    dockKeys.activate = () => {
      const entry = live.current.entries.find((e) => e.key === focusedKey());
      if (!entry) return false;
      if (entry.kind === 'branch') {
        toggleBranch(entry.id);
        focusEntry(entry.key);
      } else {
        if (!entry.sub) setOpenBranch(null);
        live.current.onNavigate();
        navigate(entry.to);
      }
      return true;
    };
    return () => {
      dockKeys.move = () => false;
      dockKeys.activate = () => false;
    };
  }, [hidden]);

  const letterLabel = hidden ? tr('Показать панель') : tr('Спрятать панель');
  const letter = html`
    <button type="button" class="dock-item dock-brand" onClick=${onToggleHidden} aria-label=${letterLabel} aria-pressed=${hidden}
      ...${hintOf(ctx, letterLabel, 'dockHide')}>
      <${AppLetter} size=${36} app=${app}/><span class="dock-label brand-label">${APPS[app].name}</span>
    </button>`;

  if (hidden) {
    const other = otherApp(app);
    const switchLabel = `${APPS[other].name} — ${APPS[other].what}`;
    return html`<div class=${'dock-wrap pos-' + position + ' grow-both'}>
      <nav ref=${panel} class="dock dock-hidden mode-icon" aria-label="Навигация">
        ${letter}
        <button type="button" class="dock-item dock-brand dock-switch" key=${other} onClick=${onSwitch}
          aria-label=${tr('Перейти в ') + switchLabel} ...${hintOf(ctx, tr('Перейти в ') + switchLabel, 'switchApp')}>
          <${AppLetter} size=${36} app=${other} other/>
        </button>
      </nav></div>`;
  }

  const addLabel = app === 'feast' ? tr('Записать еду') : tr('Новая задача');
  const ind = indicator(syncState());
  const dirty = totalDirty();
  const toggleLabel = compact ? tr('Ещё') : expanded ? tr('Свернуть панель') : tr('Развернуть панель');
  const busy = ind.key === 'busy';
  const hover = autoHide
    ? { onMouseEnter: reveal, onMouseLeave: scheduleHide, onFocusIn: reveal, onFocusOut: scheduleHide }
    : {};
  const iconS = compact ? ctx.iconSize : ICON_SIZE[mode];
  const letterS = compact ? BAR_LETTER[bar.size] || BAR_LETTER.m : 36;
  const other = otherApp(app);
  const switchLabel = tr('Перейти в {p0}', { p0: APPS[other].name });

  // Закреплённый край: отступ с нужной стороны и потолок длины на остаток экрана.
  const anchorStyle = growMode === 'both' ? {} : vertical
    ? { [growMode === 'down' ? 'marginTop' : 'marginBottom']: anchorOffset + 'px', maxHeight: `calc(100% - ${anchorOffset}px)` }
    : { [growMode === 'down' ? 'marginLeft' : 'marginRight']: anchorOffset + 'px', maxWidth: `calc(100% - ${anchorOffset}px)` };
  // Своя длина: плашка не короче и не длиннее заданного, лишнее прокручивается. Своя ширина: не меняется ни от
  // раскрытых веток, ни от подписей. Шторке на телефоне, ленте и доку во всё пространство они не нужны.
  const sizeStyle = {
    ...(sizeMode === 'fixed' && !compact && !overlay && !fill ? (vertical ? { height: size + 'px' } : { width: size + 'px' }) : {}),
    ...(thickness != null && !overlay && !compact ? (vertical ? { width: thickness + 'px' } : { height: thickness + 'px' }) : {}),
  };

  const special = {
    letter: () => html`
      <button type="button" class="dock-item dock-brand" key="letter" onClick=${onToggleHidden} aria-label=${letterLabel} aria-pressed=${hidden}
        ...${hintOf(ctx, letterLabel, 'dockHide')}>
        <${AppLetter} size=${letterS} app=${app}/><span class="dock-label brand-label">${APPS[app].name}</span>
      </button>`,
    // 1.1: переход в другое приложение — прямо из дока (на телефоне — первым пунктом ленты)
    switch: () => html`
      <button type="button" class="dock-item dock-brand dock-go" key="switch" onClick=${() => { onNavigate(); onSwitch(); }}
        aria-label=${switchLabel} ...${hintOf(ctx, switchLabel, 'switchApp')}>
        <${AppLetter} size=${compact ? letterS : mode === 'row' ? 28 : 32} app=${other} other/><span class="dock-label">${compact ? APPS[other].name : switchLabel}</span>
      </button>`,
    add: () => html`
      <button type="button" class="dock-item dock-add" key="add" onClick=${() => { onNavigate(); onAdd(); }} disabled=${!!store.ui.readOnly}
        aria-label=${addLabel} ...${hintOf(ctx, addLabel, 'newTask')}>
        <${Icon} name="plus" size=${iconS}/><span class="dock-label">${compact ? (app === 'feast' ? tr('Еда') : tr('Задача')) : addLabel}</span>
      </button>`,
    sync: () => html`
      <button type="button" key="sync" class=${'dock-item dock-sync tone-' + ind.tone} onClick=${() => { onNavigate(); openSheet('sync'); }}
        aria-label=${tr('Синхронизация: ') + ind.text} ...${hintOf(ctx, ind.text)}>
        <${Icon} name=${ind.icon} size=${iconS - 2} className=${busy ? 'spin' : ''}/>
        <span class="dock-label">${mode === 'row' ? ind.text : ind.short}</span>
      </button>`,
    push: () => html`
      <button type="button" key="push" class=${'dock-item dock-push' + (compact ? ' tone-' + ind.tone : '')} onClick=${() => push()}
        disabled=${!!store.sync.phase || !!store.ui.readOnly} aria-label="Пуш"
        ...${hintOf(ctx, compact ? tr('Пуш · ') + ind.text : tr('Пуш — отправить изменения на Google Диск'), 'push')}>
        <${Icon} name=${compact && busy ? ind.icon : 'upload'} size=${iconS - 2} className=${compact && busy ? 'spin' : ''}/>
        <span class="dock-label">Пуш</span>${dirty ? html`<span class="dock-count">${dirty}</span>` : null}
      </button>`,
    lang: () => html`<${LocaleItem} key="lang" ctx=${ctx}/>`,
    user: () => html`<${UserMenu} key="user" ctx=${ctx} app=${app} onSwitch=${onSwitch}/>`,
  };
  const renderEntry = (e) => (special[e.key] ? special[e.key]()
    : e.item.items ? html`<${DockBranch} key=${e.key} item=${e.item} ctx=${ctx}/>` : html`<${DockLink} key=${e.key} item=${e.item} ctx=${ctx}/>`);
  const toggleBtn = html`
    <button type="button" class=${'dock-item dock-toggle' + (compact ? ' bar-more' : '')} onClick=${onToggle} aria-expanded=${expanded}
      aria-label=${compact ? tr('Ещё: все разделы') : toggleLabel} ...${hintOf(ctx, toggleLabel, 'dockExpand')}>
      <${Icon} name="grip" size=${iconS - 2}/><span class="dock-label">${toggleLabel}</span>
    </button>`;
  // Группы меню — с названием (в развёрнутом боковом) или разделителем; буква, переход и «добавить» — сверху без заголовка.
  const isMenuGroup = (g) => g !== 'top' && g !== 'bottom';
  const body = compact
    ? html`
      <div ref=${scroller} class="bar-scroll" role="group" aria-label="Пункты панели">${visible.map(renderEntry)}</div>
      ${toggleBtn}
      ${page.of > 1 ? html`<span class="bar-dots" aria-hidden="true">${Array.from({ length: page.of }, (_, i) => html`<i key=${i} class=${i === page.at ? 'on' : ''}></i>`)}</span>` : null}`
    : html`
      ${chunkByGroup(visible).map((c, i) => {
        const menu = isMenuGroup(c.group);
        if (!menu) return html`${i ? html`<${Divider} key=${'d' + i}/>` : null}${c.entries.map(renderEntry)}`;
        return html`
          <div class="dock-group" key=${'g' + i + c.group} role="group" aria-label=${c.group}>
            ${mode === 'row' ? html`<div class="dock-group-title">${c.group}</div>` : html`<${Divider}/>`}
            ${c.entries.map(renderEntry)}
          </div>`;
      })}
      ${toggleBtn}`;

  return html`
    ${autoHide ? html`<div class=${'dock-hot pos-' + position} aria-hidden="true" onMouseEnter=${reveal}></div>` : null}
    <div class=${'dock-wrap pos-' + position + ' grow-' + growMode + (fill && !overlay ? ' fill' : '') + (slidOut ? ' slid' : '') + (overlay ? ' is-overlay' : '')}>
      <div ref=${inner} class=${'dock-inner' + (compact ? ' compact' : '')} style=${anchorStyle}>
        <nav ref=${panel} aria-label="Навигация" style=${compact ? { ...sizeStyle, '--bar-n': bar.count } : sizeStyle}
          class=${'dock mode-' + mode + (compact ? ` compact bar-${bar.size}${bar.labels ? ' bar-labels' : ''}` : '') + (overlay ? ' is-overlay' : '') + (thickness != null && !compact ? ' own-width' : '')}
          ...${hover}>
          ${body}
        </nav>

        ${showStrip && openItem ? html`
          <div ref=${strip} class=${'dock-strip strip-' + position + ' mode-' + (mode === 'tile' ? 'tile' : 'icon')} role="group"
            aria-label=${openItem.title} style=${vertical ? { top: stripOffset + 'px' } : { left: stripOffset + 'px' }} ...${hover}>
            ${openItem.items.map((sub) => html`<${SubLink} key=${sub.to} item=${sub} branch=${openItem.id} ctx=${ctx}/>`)}
          </div>` : null}
      </div>
    </div>`;
}
