// Раздел настроек «Внешний вид» (обновление 0.3, п. 2.3; с 0.10 — как settings.appearance.tsx license-store:
// карточки выбора с превью и галочкой, флажки с подсказками). Положение и вид док-панели, тема, цветовая схема,
// цвета квадрата с буквой. Всё здесь — настройки ЭТОГО устройства (ui/prefs.js), кроме покупок схем: они в журнале монет.
// С 0.11 у Chronicle и Feast оформление своё: вверху выбирается, для какого приложения меняем (по умолчанию — открытое).
// 0.16 — второй перенос settings.appearance.tsx license-store: подпункты веток (колонкой сбоку или внутри панели),
// куда растёт панель, её длина и ширина, сдвигает ли она страницу; панель справа (ужимать страницу, тянуть
// мышью, ширина с живым предпросмотром); «Сбросить всё». Всё применяется сразу.

import { html, useState, useEffect } from '../html.js';
import { Icon } from '../icons.js';
import { store, showSnackbar } from '../../store/appState.js';
import * as G from '../../core/game.js';
import {
  getAppPrefs, setAppPrefs, activeApp, resetLook, DOCK_POSITIONS, SCHEMES, FREE_SCHEMES, DOCK_SUB_MODES, DOCK_GROW, DOCK_SIZE_MODES,
  DOCK_SIZE_MIN, DOCK_SIZE_MAX, DOCK_WIDTH_MIN, DOCK_WIDTH_MAX, DOCK_PUSH, PANEL_MIN, PANEL_MAX,
} from '../prefs.js';
import { getTheme, setTheme } from '../theme.js';
import { APPS, APP_IDS_ORDER } from '../apps.js';
import { AppLetter } from './Dock.js';
import { SidePanel } from './SidePanel.js';
import { Keys } from './Shortcuts.js';
import { bindingOf } from '../keys.js';
import { tr } from '../../core/i18n.js';

const POS_LABEL = { left: tr('Слева'), bottom: tr('Снизу'), right: tr('Справа'), top: tr('Сверху') };

const SUB_LABEL = {
  side: [tr('Колонкой сбоку'), tr('Отдельная колонка квадратиков рядом с панелью, вниз от значка ветки.')],
  inline: [tr('Внутри панели'), tr('Квадратики раскрываются прямо под значком ветки, как раскрывающаяся панель. Удобно на маленьком экране.')],
};
const GROW_LABEL = {
  down: [tr('Только вниз'), tr('Верх стоит на месте, пункт под мышью не уезжает. Что не влезло — прокручивается внутри панели (у горизонтальной — вправо).')],
  up: [tr('Только вверх'), tr('Низ стоит на месте, панель растёт вверх и прокручивается внутри, если не влезает (у горизонтальной — влево).')],
  both: [tr('В обе стороны'), tr('Панель остаётся по центру и растёт в обе стороны.')],
};
const SIZE_LABEL = { auto: tr('По содержимому'), fixed: tr('Своя') };
const LENGTH_HINT = {
  auto: tr('Такой длины, сколько пунктов, но не больше экрана.'),
  fixed: tr('Всегда выбранной длины, лишние пункты прокручиваются внутри. Панель меняется сразу.'),
};
const WIDTH_HINT = {
  auto: tr('По ширине значков. Раскрытая внутри ветка её не меняет.'),
  fixed: tr('Всегда выбранной ширины (у горизонтальной — высоты), значки по центру.'),
};
const PUSH_LABEL = {
  none: [tr('Не сдвигать'), tr('Панель лежит поверх страницы, страница не ужимается.')],
  dock: [tr('Под панель'), tr('Страница отодвигается на ширину панели.')],
  all: [tr('Под панель и подпункты'), tr('Страница отодвигается ещё и под открытую колонку подпунктов.')],
};

/** Переключатель из нескольких вариантов в одну строку (Choice license-store). */
function Choice({ value, options, onChange, label }) {
  return html`
    <div class="seg" role="radiogroup" aria-label=${label}>
      ${options.map(([v, text]) => html`<button type="button" key=${v} role="radio" aria-checked=${value === v}
        class=${'seg-btn' + (value === v ? ' selected' : '')} onClick=${() => onChange(v)}>${text}</button>`)}
    </div>`;
}

/** Подпись, переключатель и подсказка под ним (Field license-store). */
function Field({ label, hint, children }) {
  return html`<div class="set-field"><p class="set-field-label">${label}</p>${children}${hint ? html`<p class="check-hint">${hint}</p>` : null}</div>`;
}

/** Ползунок с числом. onActivate — когда за него взялись (показать предпросмотр). */
function Range({ label, value, min, max, step, onChange, onActivate }) {
  return html`
    <label class="range-row">
      <span class="range-head"><span>${label}</span><span class="range-value">${value} px</span></span>
      <input type="range" min=${min} max=${max} step=${step} value=${value}
        onPointerDown=${onActivate} onFocus=${onActivate} onInput=${(e) => onChange(Number(e.target.value))}/>
    </label>`;
}

/** Схема дока: подветка колонкой сбоку (вниз от значка) или внутри дока под значком (SubModePreview license-store). */
function SubModePreview({ mode }) {
  const sq = (accent = false) => html`<span class=${'smp-sq' + (accent ? ' accent' : '')}></span>`;
  return html`
    <span class="sub-preview" aria-hidden="true">
      <span class="smp-dock">
        ${sq()}<span class="smp-ring">${sq(true)}</span>
        ${mode === 'inline' ? html`<span class="smp-inline">${sq()}${sq()}${sq()}</span>` : null}
        ${sq()}${sq()}
      </span>
      ${mode === 'side' ? html`<span class="smp-dock smp-strip">${sq(true)}${sq()}${sq()}${sq()}</span>` : null}
      <span class="smp-page"><span class="tp-line smp-l1"></span><span class="tp-line smp-l2"></span></span>
    </span>`;
}

/** Цвета превью тем (как --bg/--surface/--text/--muted/--border в styles/app.css). */
const PALETTE = {
  light: { bg: '#f5f6fa', card: '#ffffff', fg: '#1b1d27', muted: '#676b7e', border: '#e1e4ee' },
  dark: { bg: '#111218', card: '#1b1d26', fg: '#e8e9f0', muted: '#9a9eb3', border: '#2c2f3d' },
};

/** Карточка-вариант: превью, подпись, галочка у выбранного, подсказка (Option license-store). */
function Option({ selected, onSelect, label, hint = null, disabled = false, title = undefined, children }) {
  return html`
    <button type="button" role="radio" aria-checked=${selected} disabled=${disabled} title=${title}
      class=${'opt' + (selected ? ' selected' : '')} onClick=${onSelect}>
      ${children}
      <span class="opt-label"><span>${label}</span>${selected ? html`<${Icon} name="check" size=${16}/>` : null}</span>
      ${hint ? html`<span class="opt-hint">${hint}</span>` : null}
    </button>`;
}

function Check({ label, hint, checked, onChange, disabled = false }) {
  return html`
    <label class="check-row">
      <input type="checkbox" checked=${checked} disabled=${disabled} onChange=${(e) => onChange(e.target.checked)}/>
      <span><span class="check-label">${label}</span>${hint ? html`<span class="check-hint">${hint}</span>` : null}</span>
    </label>`;
}

function DockPreview({ position }) {
  return html`<span class="dock-preview" aria-hidden="true"><span class=${'dp-bar ' + position}></span></span>`;
}

/** Мини-окно приложения в цветах темы: док с буквой и карточка с кнопкой акцента. */
function ThemePreview({ mode, accent, letter = null, locked = false }) {
  const pane = (m) => {
    const c = PALETTE[m];
    return html`<span class="tp-pane" style=${{ background: c.bg, borderColor: c.border }}>
      <span class="tp-dock" style=${{ background: c.card, borderColor: c.border }}>
        <span class="tp-letter" style=${{ background: letter || accent[m], color: letter ? '#fff' : m === 'dark' ? '#0f1220' : '#fff' }}>${locked ? '🔒' : 'L'}</span>
        <span class="tp-dot" style=${{ background: accent[m], opacity: 0.45 }}></span>
        <span class="tp-dot" style=${{ background: c.muted, opacity: 0.4 }}></span>
        <span class="tp-dot" style=${{ background: c.muted, opacity: 0.4 }}></span>
      </span>
      <span class="tp-card" style=${{ background: c.card, borderColor: c.border }}>
        <span class="tp-line" style=${{ background: c.fg, opacity: 0.8, width: '66%' }}></span>
        <span class="tp-line" style=${{ background: c.muted, opacity: 0.5, width: '50%' }}></span>
        <span class="tp-btn" style=${{ background: accent[m] }}></span>
      </span>
    </span>`;
  };
  if (mode === 'system') return html`<span class="theme-preview split" aria-hidden="true">${pane('light')}${pane('dark')}</span>`;
  return html`<span class="theme-preview" aria-hidden="true">${pane(mode)}</span>`;
}

export function AppearanceSection({ phone }) {
  const [app, setApp] = useState(activeApp());
  const [, rerender] = useState(0);
  const p = getAppPrefs(app);
  const setPrefs = (patch) => setAppPrefs(app, patch);
  const theme = getTheme(app);
  const onTheme = (v) => {
    setTheme(v, app);
    rerender((n) => n + 1);
  };
  const pos = p.dock || (phone ? 'bottom' : 'left');
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  const mode = dark ? 'dark' : 'light';
  const schemeOk = (key) => FREE_SCHEMES.includes(key) || G.cosmeticAvailable(store.data, 'scheme:' + key);
  const letters = G.COSMETICS.filter((c) => c.kind === 'letter');
  const scheme = SCHEMES[p.scheme] || SCHEMES.indigo;
  const accent = { light: scheme.light, dark: scheme.dark };

  return html`
    <div class="app-pick" role="radiogroup" aria-label="Оформление приложения">
      <span class="muted">Оформление для</span>
      ${APP_IDS_ORDER.map((id) => html`<button type="button" role="radio" aria-checked=${app === id} key=${id}
        class=${'chip' + (app === id ? ' selected' : '')} onClick=${() => setApp(id)}>
        <${AppLetter} size=${20} app=${id} other=${id !== activeApp()}/> ${APPS[id].name}</button>`)}
      <button type="button" class="btn small app-pick-reset" title="Вид и поведение панели навигации и панели справа — как по умолчанию; тема и цвета не меняются"
        onClick=${() => { resetLook(app); showSnackbar(tr('Настройки панелей возвращены по умолчанию')); }}>
        <${Icon} name="restore" size=${16}/> Сбросить всё</button>
    </div>
    <section class="set-section" id="appearance">
      <h2>Панель навигации${app !== activeApp() ? ` — ${APPS[app].name}` : ''}</h2>
      <p class="muted small">Плавающая плашка по центру выбранного края.${phone ? tr(' На телефоне развёрнутая панель открывается шторкой поверх экрана — кнопкой ⠿.') : ''}</p>
      <div class="opt-grid four" role="radiogroup" aria-label="Положение панели">
        ${DOCK_POSITIONS.map((k) => html`
          <${Option} key=${k} selected=${pos === k} onSelect=${() => setPrefs({ dock: k })} label=${POS_LABEL[k]}
            hint=${(phone ? 'bottom' : 'left') === k ? tr('по умолчанию') : null}>
            <${DockPreview} position=${k}/>
          <//>`)}
      </div>
      <${Check} label="Развёрнутая" checked=${!!p.expanded} onChange=${(v) => setPrefs({ expanded: v })}
        hint=${phone ? tr('На компьютере — значки с подписями и названиями групп. На телефоне панель всегда свёрнута.') : tr('Значки с подписями и названиями групп; свёрнутая — только значки с подсказками.')}/>
      <${Check} label="Автоскрытие" checked=${!!p.autoHide} onChange=${(v) => setPrefs({ autoHide: v })}
        hint="Панель уезжает за край и выезжает, когда подводишь к нему мышь. Только с мышью: на телефоне не действует."/>
      <${Check} label="Спрятать целиком" checked=${!!p.hidden} onChange=${(v) => setPrefs({ hidden: v })}
        hint="У края остаются только буквы приложений: своя возвращает панель, вторая переключает в другое приложение. Общая для Chronicle и Crimson Harvest."/>
      <${Field} label="Освобождать место на странице под панель" hint=${PUSH_LABEL[p.dockPush]?.[1]}>
        <${Choice} label="Освобождать место на странице под панель" value=${p.dockPush} onChange=${(v) => setPrefs({ dockPush: v })}
          options=${DOCK_PUSH.map((k) => [k, PUSH_LABEL[k][0]])}/>
      <//>
    </section>

    <section class="set-section" id="dock-branches">
      <h2>Подпункты веток${app !== activeApp() ? ` — ${APPS[app].name}` : ''}</h2>
      <p class="muted small">Как раскрываются квадратики ветки в свёрнутой панели. Клик по ветке только раскрывает или сворачивает её, экран не меняется.</p>
      <p class="muted small keys-line">С клавиатуры: <${Keys} combo=${bindingOf('menuUp')} ru=${false} empty="—"/> <${Keys} combo=${bindingOf('menuDown')} ru=${false} empty="—"/>
        — по пунктам панели, <${Keys} combo=${bindingOf('menuActivate')} ru=${false} empty="—"/> — открыть пункт или раскрыть ветку.</p>
      <div class="opt-grid" role="radiogroup" aria-label="Подпункты веток">
        ${DOCK_SUB_MODES.map((k) => html`
          <${Option} key=${k} selected=${p.dockSubMode === k} onSelect=${() => setPrefs({ dockSubMode: k })} label=${SUB_LABEL[k][0]} hint=${SUB_LABEL[k][1]}>
            <${SubModePreview} mode=${k}/>
          <//>`)}
      </div>
      <${Field} label="Куда растёт панель, когда внутри раскрывается ветка" hint=${GROW_LABEL[p.dockGrow]?.[1]}>
        <${Choice} label="Куда растёт панель" value=${p.dockGrow} onChange=${(v) => setPrefs({ dockGrow: v })}
          options=${DOCK_GROW.map((k) => [k, GROW_LABEL[k][0]])}/>
      <//>
      <${Field} label="Длина панели" hint=${LENGTH_HINT[p.dockSizeMode]}>
        <${Choice} label="Длина панели" value=${p.dockSizeMode} onChange=${(v) => setPrefs({ dockSizeMode: v })}
          options=${DOCK_SIZE_MODES.map((k) => [k, SIZE_LABEL[k]])}/>
      <//>
      ${p.dockSizeMode === 'fixed' ? html`<${Range} label="Длина" value=${p.dockSize} min=${DOCK_SIZE_MIN} max=${DOCK_SIZE_MAX} step=${10}
        onChange=${(v) => setPrefs({ dockSize: v })}/>` : null}
      <${Field} label="Ширина панели" hint=${WIDTH_HINT[p.dockWidthMode]}>
        <${Choice} label="Ширина панели" value=${p.dockWidthMode} onChange=${(v) => setPrefs({ dockWidthMode: v })}
          options=${DOCK_SIZE_MODES.map((k) => [k, SIZE_LABEL[k]])}/>
      <//>
      ${p.dockWidthMode === 'fixed' ? html`<${Range} label="Ширина" value=${p.dockWidth} min=${DOCK_WIDTH_MIN} max=${DOCK_WIDTH_MAX} step=${2}
        onChange=${(v) => setPrefs({ dockWidth: v })}/>` : null}
    </section>

    <${SidePanelSettings} phone=${phone}/>

    <section class="set-section">
      <h2>Тема</h2>
      <p class="muted small">Светлая, тёмная или как в системе.</p>
      <div class="opt-grid three" role="radiogroup" aria-label="Тема">
        ${[['system', tr('Как в системе')], ['light', tr('Светлая')], ['dark', tr('Тёмная')]].map(([k, label]) => html`
          <${Option} key=${k} selected=${theme === k} onSelect=${() => onTheme(k)} label=${label}>
            <${ThemePreview} mode=${k} accent=${accent} letter=${p.letter}/>
          <//>`)}
      </div>
    </section>

    <section class="set-section">
      <h2>Цветовая схема</h2>
      <p class="muted small">${store.data.settings.gameEnabled ? tr('Закрытые схемы открываются в «Магазине».') : tr('Игра выключена — все схемы доступны.')}</p>
      <div class="opt-grid" role="radiogroup" aria-label="Цветовая схема">
        ${Object.entries(SCHEMES).map(([k, s]) => {
          const ok = schemeOk(k);
          return html`
            <${Option} key=${k} selected=${(p.scheme || 'indigo') === k} disabled=${!ok} onSelect=${() => setPrefs({ scheme: k })}
              label=${s.name} title=${ok ? s.name : tr('Можно купить в магазине')}>
              <${ThemePreview} mode=${mode} accent=${{ light: s.light, dark: s.dark }} locked=${!ok}/>
            <//>`;
        })}
      </div>
    </section>

    <section class="set-section">
      <h2>Квадрат с буквой</h2>
      <p class="muted small">Сейчас: <${AppLetter} size=${20} app=${app} other=${app !== activeApp()}/> — он же прячет и возвращает панель.</p>
      <div class="opt-grid" role="radiogroup" aria-label="Цвет квадрата">
        <${Option} selected=${!p.letter} onSelect=${() => setPrefs({ letter: null })} label="Цвет схемы">
          <span class="letter-preview"><span class="app-letter" style=${{ width: '32px', height: '32px', fontSize: '16px', background: dark ? SCHEMES[p.scheme || 'indigo']?.dark : SCHEMES[p.scheme || 'indigo']?.light, color: dark ? '#120d10' : '#fff' }}>${APPS[app].letter}</span></span>
        <//>
        ${letters.map((c) => {
          const ok = G.cosmeticAvailable(store.data, c.id);
          return html`
            <${Option} key=${c.id} selected=${p.letter === c.value} disabled=${!ok} onSelect=${() => setPrefs({ letter: c.value })}
              label=${c.name.replace(tr(' квадрат'), '')} title=${ok ? c.name : tr('Можно купить в магазине')}>
              <span class="letter-preview"><span class="app-letter" style=${{ width: '32px', height: '32px', fontSize: '16px', background: c.value, color: '#fff' }}>${ok ? APPS[app].letter : '🔒'}</span></span>
            <//>`;
        })}
      </div>
    </section>`;
}

/**
 * Панель справа (SidePanelSettings license-store): ужимать ли страницу, тянется ли мышью, ширина. Пока двигаешь
 * ширину, сама панель показывается рядом — видно, какой она будет. Общая для Chronicle и Crimson Harvest.
 */
function SidePanelSettings({ phone }) {
  const p = getAppPrefs();
  const set = (patch) => setAppPrefs(activeApp(), patch);
  const [preview, setPreview] = useState(false);
  // Потолок ширины — от текущего окна (панель шире 85 % экрана не бывает); окно меняют — потолок следует за ним.
  const [viewport, setViewport] = useState(() => innerWidth);
  useEffect(() => {
    const onResize = () => setViewport(innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const max = Math.max(PANEL_MIN + 100, Math.min(PANEL_MAX, Math.round(viewport * 0.85)));
  const yes = (v) => (v ? tr('да') : tr('нет'));

  return html`
    <section class="set-section" id="side-panel">
      <h2>Панель справа</h2>
      <p class="muted small">Карточка задачи или продукта, запись или заметка дневника, рацион — открываются справа по клику на строку.
        Список остаётся рядом: по строкам можно ходить клавишами, панель переключается на них. Общая для Chronicle и Crimson Harvest.
        ${phone ? tr(' На телефоне карточки открываются на весь экран.') : ''}</p>
      <${Check} label="Ужимать страницу, когда открыта панель" checked=${p.panelPush !== false} onChange=${(v) => set({ panelPush: v })}
        hint="Список сдвигается и остаётся виден целиком (на широком экране, от 1200 px). Выключено — панель открывается поверх списка, как в части SIEM."/>
      <${Check} label="Менять ширину мышью" checked=${p.panelResizable !== false} onChange=${(v) => set({ panelResizable: v })}
        hint="Потяните левый край панели — ширина запомнится. Выключено — всегда ширина, заданная ниже."/>
      <${Range} label="Ширина панели" value=${Math.min(p.panelWidth, max)} min=${PANEL_MIN} max=${max} step=${10}
        onChange=${(v) => set({ panelWidth: v })} onActivate=${() => !phone && setPreview(true)}/>
      ${phone ? null : html`<button type="button" class="btn small" onClick=${() => setPreview(!preview)}>
        <${Icon} name=${preview ? 'eyeOff' : 'eye'} size=${16}/> ${preview ? tr('Скрыть панель') : tr('Показать панель')}</button>`}
      ${preview && !phone ? html`
        <${SidePanel} label="Предпросмотр панели" onClose=${() => setPreview(false)} ownEscape className="task-panel panel-preview">
          <div class="task-header">
            <button type="button" class="icon-btn" onClick=${() => setPreview(false)} aria-label="Закрыть" title="Закрыть (Esc)"><${Icon} name="close"/></button>
            <span class="task-header-title">Предпросмотр панели</span>
          </div>
          <p class="muted">${tr('Такой ширины будут карточки и записи: {width} px', { width: Math.min(p.panelWidth, max) })}</p>
          <dl class="facts">
            <dt>Ширина панели</dt><dd>${Math.min(p.panelWidth, max)} px</dd>
            <dt>Ужимать страницу</dt><dd>${yes(p.panelPush !== false)}</dd>
            <dt>Менять ширину мышью</dt><dd>${yes(p.panelResizable !== false)}</dd>
          </dl>
          <p class="muted small">Двигайте ползунок ширины — панель меняется вместе с ним${p.panelResizable !== false ? tr(', или потяните её левый край') : ''}.
            Закрыть — крестиком, Esc или клавишей закрытия.</p>
        <//>` : null}
    </section>`;
}
