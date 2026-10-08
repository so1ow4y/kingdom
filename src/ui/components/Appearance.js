// Раздел настроек «Внешний вид» (обновление 0.3, п. 2.3; с 0.10 — как settings.appearance.tsx license-store:
// карточки выбора с превью и галочкой, флажки с подсказками). Положение и вид док-панели, тема, цветовая схема,
// цвета квадрата с буквой. Всё здесь — настройки ЭТОГО устройства (ui/prefs.js), кроме покупок схем: они в журнале монет.
// С 0.11 у Chronicle и Feast оформление своё: вверху выбирается, для какого приложения меняем (по умолчанию — открытое).

import { html, useState } from '../html.js';
import { Icon } from '../icons.js';
import { store } from '../../store/appState.js';
import * as G from '../../core/game.js';
import { getAppPrefs, setAppPrefs, activeApp, DOCK_POSITIONS, SCHEMES, FREE_SCHEMES } from '../prefs.js';
import { getTheme, setTheme } from '../theme.js';
import { APPS, APP_IDS_ORDER } from '../apps.js';
import { AppLetter } from './Dock.js';
import { tr } from '../../core/i18n.js';

const POS_LABEL = { left: tr('Слева'), bottom: tr('Снизу'), right: tr('Справа'), top: tr('Сверху') };

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
    </section>

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
