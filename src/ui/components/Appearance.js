// Раздел настроек «Внешний вид» (обновление 0.3, п. 2.3): положение и вид док-панели, тема, цветовая схема.
// Всё здесь — настройки ЭТОГО устройства (ui/prefs.js), кроме покупок схем: они в журнале монет.

import { html } from '../html.js';
import { store } from '../../store/appState.js';
import * as G from '../../core/game.js';
import { getPrefs, setPrefs, dockPosition, SCHEMES } from '../prefs.js';
import { AppLetter } from './Dock.js';
import { VillageSettings } from '../screens/Village.js';

const POS_LABEL = { left: 'Слева', bottom: 'Снизу', right: 'Справа', top: 'Сверху' };

function MiniScreen({ pos }) {
  return html`<span class="mini-screen" aria-hidden="true"><i class=${'bar ' + pos}></i><i class="lines"></i></span>`;
}

function Toggle({ label, hint, checked, onChange }) {
  return html`<label class="toggle-row">
    <input type="checkbox" checked=${checked} onChange=${(e) => onChange(e.target.checked)}/>
    <span>${label}${hint ? html`<small>${hint}</small>` : null}</span>
  </label>`;
}

export function AppearanceSection({ theme, onTheme, phone }) {
  const p = getPrefs();
  const pos = dockPosition(phone);
  const dark = document.documentElement.dataset.theme === 'dark'
    || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  const schemeOk = (key) => key === 'indigo' || G.cosmeticAvailable(store.data, 'scheme:' + key);
  const letters = G.COSMETICS.filter((c) => c.kind === 'letter');

  return html`
    <section class="set-section" id="appearance">
      <h2>Внешний вид</h2>
      <p class="muted small">Эти настройки хранятся только на этом устройстве.</p>
      ${store.data.settings.gameEnabled ? html`
        <h3 class="set-sub">Деревня</h3>
        <${VillageSettings}/>
        <a class="link-btn" href="#/village">Открыть деревню</a>` : null}

      <h3 class="set-sub">Панель навигации</h3>
      <div class="pick-grid" role="radiogroup" aria-label="Положение панели">
        ${['left', 'bottom', 'right', 'top'].map((k) => html`
          <button type="button" role="radio" aria-checked=${pos === k} class=${'pick-card' + (pos === k ? ' selected' : '')}
            onClick=${() => setPrefs({ dock: k })}>
            <${MiniScreen} pos=${k}/>
            <span class="pick-title">${POS_LABEL[k]}${(phone ? 'bottom' : 'left') === k ? html`<small class="muted">по умолч.</small>` : null}</span>
          </button>`)}
      </div>
      <${Toggle} label="Развёрнутая" hint="Значки с подписями; свёрнутая — только значки"
        checked=${p.expanded} onChange=${(v) => setPrefs({ expanded: v })}/>
      <${Toggle} label="Автоскрытие" hint=${phone ? 'Панель прячется за край; тапни по полоске у края, чтобы показать' : 'Панель прячется за край и выезжает, когда подводишь мышь'}
        checked=${p.autoHide} onChange=${(v) => setPrefs({ autoHide: v })}/>
      <${Toggle} label="Спрятать целиком" hint="У края остаётся только квадрат с буквой — нажми его, чтобы вернуть панель"
        checked=${p.hidden} onChange=${(v) => setPrefs({ hidden: v })}/>

      <h3 class="set-sub">Тема</h3>
      <div class="pick-grid" role="radiogroup" aria-label="Тема">
        ${[['system', 'Как в системе'], ['light', 'Светлая'], ['dark', 'Тёмная']].map(([k, label]) => html`
          <button type="button" role="radio" aria-checked=${theme === k} class=${'pick-card' + (theme === k ? ' selected' : '')} onClick=${() => onTheme(k)}>
            <span class="swatch-screen" style=${{ background: k === 'dark' ? '#1b1d26' : k === 'light' ? '#f5f6fa' : 'linear-gradient(135deg, #f5f6fa 50%, #1b1d26 50%)', border: '1px solid var(--border)' }}></span>
            <span class="pick-title">${label}</span>
          </button>`)}
      </div>

      <h3 class="set-sub">Цветовая схема</h3>
      <div class="pick-grid" role="radiogroup" aria-label="Цветовая схема">
        ${Object.entries(SCHEMES).map(([k, s]) => {
          const ok = schemeOk(k);
          const on = (p.scheme || 'indigo') === k;
          return html`
            <button type="button" role="radio" aria-checked=${on} disabled=${!ok} class=${'pick-card' + (on ? ' selected' : '')}
              onClick=${() => setPrefs({ scheme: k })} title=${ok ? s.name : 'Можно купить в магазине'}>
              <span class="swatch-screen" style=${{ background: dark ? s.dark : s.light }}>${ok ? '' : '🔒'}</span>
              <span class="pick-title">${s.name}</span>
            </button>`;
        })}
      </div>

      <h3 class="set-sub">Квадрат с буквой</h3>
      <div class="pick-grid" role="radiogroup" aria-label="Цвет квадрата">
        <button type="button" role="radio" aria-checked=${!p.letter} class=${'pick-card' + (!p.letter ? ' selected' : '')} onClick=${() => setPrefs({ letter: null })}>
          <span class="swatch-screen"><span class="app-letter" style=${{ width: '32px', height: '32px', fontSize: '16px', background: 'var(--accent)', color: 'var(--accent-text)' }}>L</span></span>
          <span class="pick-title">Цвет схемы</span>
        </button>
        ${letters.map((c) => {
          const ok = G.cosmeticAvailable(store.data, c.id);
          const on = p.letter === c.value;
          return html`
            <button type="button" role="radio" aria-checked=${on} disabled=${!ok} class=${'pick-card' + (on ? ' selected' : '')}
              onClick=${() => setPrefs({ letter: c.value })} title=${ok ? c.name : 'Можно купить в магазине'}>
              <span class="swatch-screen"><span class="app-letter" style=${{ width: '32px', height: '32px', fontSize: '16px', background: c.value, color: '#fff' }}>${ok ? 'L' : '🔒'}</span></span>
              <span class="pick-title">${c.name.replace(' квадрат', '')}</span>
            </button>`;
        })}
      </div>
      <p class="muted small">Сейчас: <${AppLetter} size=${20}/> ${store.data.settings.gameEnabled ? 'закрытые варианты открываются в «Магазине».' : 'игра выключена — все варианты доступны.'}</p>
    </section>`;
}
