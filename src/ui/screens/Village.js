// Экран «Деревня» (обновление 0.7): вся деревня крупно, настроение жителей, монеты и изумруды, магазин построек,
// жителей, света и декора, настройки (фон, масштаб, смена дня и ночи, гости у экрана, строгий фокус).
// Тот же вид — во вкладке «Деревня» магазина.

import { html, useEffect, useState } from '../html.js';
import { Icon } from '../icons.js';
import { store, openSheet } from '../../store/appState.js';
import * as A from '../../store/actions.js';
import * as G from '../../core/game.js';
import * as V from '../../core/village.js';
import { VillageCanvas, villageOn } from '../components/VillageView.js';
import { DecorationSettings } from '../components/Decorations.js';
import { world, env, setEnv } from '../../village/runtime.js';
import { getPrefs, setPrefs } from '../prefs.js';
import { readLocal, writeLocal } from '../hooks.js';
import { getFocus } from '../../store/focus.js';

const TABS = [['building', 'Постройки'], ['char', 'Жители'], ['light', 'Свет и небо'], ['decor', 'Декор']];
const BASE_INFO = {
  'base:house': { name: 'Дом старосты', emoji: '🏠', desc: 'С него началась деревня. Ночью в окнах горит свет — нажми на дом, чтобы выключить.' },
  'base:wanderer': { name: 'Странник', emoji: '🧑‍🌾', desc: 'Живёт в деревне с самого начала. Без строителя сам берётся за работу во время фокуса.' },
};

const infoOf = (id) => BASE_INFO[id] || V.villageItem(id);
const price = (it) => (it.gems ? `${it.gems} 💎` : `${it.coins} 🪙`);

function Mood({ mood, bal, gems }) {
  const f = getFocus();
  return html`
    <div class="village-head card-block">
      <div class="vh-mood" title=${`Выполнено за 3 дня: ${mood.parts.done} · фокус сегодня: ${mood.parts.focus} · просрочено: ${mood.parts.overdue}`}>
        <span class="vh-emoji">${mood.emoji}</span>
        <div><b>Жители: ${mood.label.toLowerCase()}</b>
          <div class="progress mood"><i style=${{ width: mood.value + '%' }}></i></div>
          <small class="muted">${mood.parts.overdue ? `Просрочено задач: ${mood.parts.overdue} — жители грустят` : 'Выполняй задачи — деревня радуется'}</small></div>
      </div>
      <div class="vh-wallet"><span>🪙 <b>${bal}</b></span><span>💎 <b>${gems}</b></span></div>
      <div class="vh-actions">
        <button class="btn small primary" onClick=${() => openSheet('focus', {})} disabled=${!!f}><${Icon} name="focus" size=${16}/> ${f ? 'Фокус идёт' : 'Фокус'}</button>
        <button class="btn small" onClick=${() => world.sendVisitor()} title="Кто-нибудь подойдёт к экрану">👋 Позвать</button>
      </div>
    </div>`;
}

function Selected({ sel, onClose, bal }) {
  if (!sel) return null;
  const readOnly = !!store.ui.readOnly;
  if (sel.type === 'actor') {
    const a = sel.actor;
    const it = infoOf(a.id) || BASE_INFO['base:wanderer'];
    return html`<div class="village-sel card-block">
      <span class="vs-emoji">${it.emoji}</span>
      <div class="vs-main"><b>${it.name}</b><p class="muted small">${it.desc || ''}</p></div>
      <div class="vs-actions">
        <button class="btn small" onClick=${() => world.poke(a)}>Погладить</button>
        <button class="btn small" onClick=${() => world.sendVisitor(a)}>К экрану</button>
        <button class="icon-btn small" onClick=${onClose} aria-label="Закрыть"><${Icon} name="close" size=${16}/></button>
      </div></div>`;
  }
  if (sel.type === 'lantern') {
    const on = world.lightOn(sel.lantern.id);
    return html`<div class="village-sel card-block">
      <span class="vs-emoji">🏮</span>
      <div class="vs-main"><b>Фонарь</b><p class="muted small">${on ? 'Горит в темноте' : 'Выключен'}</p></div>
      <div class="vs-actions"><button class="icon-btn small" onClick=${onClose} aria-label="Закрыть"><${Icon} name="close" size=${16}/></button></div></div>`;
  }
  const b = sel.building;
  const it = infoOf(b.id) || { name: b.type, emoji: '🏠', desc: '' };
  const next = V.VILLAGE_ITEMS.find((x) => x.requires === b.id);
  const check = next ? V.canBuy(store.data, next, bal) : null;
  const lights = b.type.startsWith('house') || ['tavern', 'tower', 'windmill'].includes(b.type);
  return html`<div class="village-sel card-block">
    <span class="vs-emoji">${it.emoji}</span>
    <div class="vs-main"><b>${it.name}</b><p class="muted small">${it.desc || ''}</p>
      ${next ? html`<p class="small">Дальше: ${next.emoji} ${next.name} — ${next.desc || ''}</p>` : null}</div>
    <div class="vs-actions">
      ${lights ? html`<button class="btn small" onClick=${() => setPrefs({ villageLightsOff: world.toggleLight(b.id) })}>${world.lightOn(b.id) ? 'Погасить свет' : 'Зажечь свет'}</button>` : null}
      ${next ? html`<button class="btn small primary" disabled=${!check.ok || readOnly} title=${check.reason} onClick=${() => A.buyVillageItem(next.id)}>${price(next)}</button>` : null}
      <button class="icon-btn small" onClick=${onClose} aria-label="Закрыть"><${Icon} name="close" size=${16}/></button>
    </div></div>`;
}

function LightControls() {
  const [h, setH] = useState(null);
  useEffect(() => () => setEnv({ phaseOverride: null }), []);
  const cur = h ?? Math.round(env.phase * 24 * 4) / 4;
  const label = `${String(Math.floor(cur) % 24).padStart(2, '0')}:${String(Math.round((cur % 1) * 60)).padStart(2, '0')}`;
  const set = (v) => {
    setH(v);
    setEnv({ phaseOverride: v == null ? null : v / 24 });
  };
  const lightsOff = getPrefs().villageLightsOff || [];
  return html`<div class="village-light card-block">
    <label class="vl-slider"><span>☀️ Время в деревне: <b>${h == null ? 'как сейчас' : label}</b></span>
      <input type="range" min="0" max="24" step="0.25" value=${cur} onInput=${(e) => set(+e.target.value)} aria-label="Время суток в деревне"/></label>
    <div class="chip-row wrap">
      <button class="chip" onClick=${() => set(12)}>🌞 День</button>
      <button class="chip" onClick=${() => set(18.25)}>🌇 Закат</button>
      <button class="chip" onClick=${() => set(23)}>🌙 Ночь</button>
      <button class=${'chip' + (h == null ? ' selected' : '')} onClick=${() => set(null)}>Как сейчас</button>
      <button class="chip" onClick=${() => setPrefs({ villageLightsOff: lightsOff.length ? [] : [...world.lanterns.map((l) => l.id), ...world.buildings.map((b) => b.id)] })}>
        💡 ${lightsOff.length ? 'Зажечь всё' : 'Погасить всё'}</button>
    </div>
    <p class="muted small">Это просто поиграть со светом — после выхода с экрана время вернётся. Нажми на дом или фонарь, чтобы погасить или зажечь его.</p>
  </div>`;
}

function ShopGrid({ bal }) {
  const [tab, setTabState] = useState(() => readLocal('villageTab', 'building'));
  const setTab = (t) => {
    setTabState(t);
    writeLocal('villageTab', t);
  };
  const owned = V.ownedVillage(store.data);
  const readOnly = !!store.ui.readOnly;
  const items = V.VILLAGE_ITEMS.filter((it) => (tab === 'light' ? ['light', 'sky'].includes(it.kind) : it.kind === tab));
  return html`
    <div class="chip-row wrap" role="tablist">
      ${TABS.map(([k, label]) => html`<button role="tab" aria-selected=${tab === k} class=${'chip' + (tab === k ? ' selected' : '')} onClick=${() => setTab(k)}>${label}</button>`)}
    </div>
    <div class="village-items">
      ${items.map((it) => {
        const has = owned.has(it.id);
        const check = has ? null : V.canBuy(store.data, it, bal);
        const locked = check && check.reason.startsWith('Сначала');
        return html`<div class=${'v-item' + (has ? ' owned' : '') + (locked ? ' locked' : '')} key=${it.id}>
          <span class="v-emoji">${it.emoji}</span>
          <div class="v-name">${it.name}${it.big ? html` <small class="v-tag">большой</small>` : null}</div>
          <p class="muted small">${it.desc || ''}</p>
          ${has ? html`<span class="v-owned">✓ Есть</span>`
            : locked ? html`<small class="muted">${check.reason}</small>`
            : html`<button class=${'btn small' + (check.ok ? ' primary' : '')} disabled=${!check.ok || readOnly} title=${check.reason || 'Купить'}
                onClick=${() => A.buyVillageItem(it.id)}>${price(it)}</button>`}
        </div>`;
      })}
    </div>`;
}

export function VillageSettings() {
  const p = getPrefs();
  const daynight = V.ownedVillage(store.data).has('v:daynight');
  const mode = daynight ? p.dayMode || 'theme' : 'theme';
  return html`<div class="village-settings">
    <label class="toggle-row compact"><input type="checkbox" checked=${p.villageBackdrop !== false} onChange=${(e) => setPrefs({ villageBackdrop: e.target.checked })}/>
      <span>Деревня на фоне<small>Полоса деревни внизу экрана, за карточками. Жителей можно нажимать в пустых местах</small></span></label>
    <label class="toggle-row compact"><input type="checkbox" checked=${p.visitors !== false} onChange=${(e) => setPrefs({ visitors: e.target.checked })}/>
      <span>Жители подходят к экрану<small>Иногда кто-нибудь выходит из леса и стучит по «стеклу»</small></span></label>
    <${DecorationSettings}/>
    <div class="field-label">Размер</div>
    <div class="chip-row wrap">
      ${[['small', 'Мелкая деревня'], ['large', 'Крупная']].map(([k, l]) => html`<button class=${'chip' + ((p.villageScale || 'small') === k ? ' selected' : '')} onClick=${() => setPrefs({ villageScale: k })}>${l}</button>`)}
    </div>
    <div class="field-label">Смена дня и ночи</div>
    <div class="chip-row wrap">
      ${[['theme', 'Как тема приложения'], ['cycle', 'Каждые 5 минут'], ['real', 'Как в жизни']].map(([k, l]) => html`
        <button class=${'chip' + (mode === k ? ' selected' : '')} disabled=${k !== 'theme' && !daynight} onClick=${() => setPrefs({ dayMode: k })}>${l}</button>`)}
    </div>
    ${daynight ? null : html`<p class="muted small">«Каждые 5 минут» и «Как в жизни» открываются покупкой «Смена дня и ночи» (3 💎) во вкладке «Свет и небо».</p>`}
    <label class="toggle-row compact"><input type="checkbox" checked=${!!p.focusStrict} onChange=${(e) => setPrefs({ focusStrict: e.target.checked })}/>
      <span>Строгий фокус<small>Если уйти из приложения дольше 15 секунд, фокус-сессия прервётся (как дерево в Forest)</small></span></label>
    <p class="muted small">Эти настройки — только для этого устройства. Покупки общие и синхронизируются.</p>
  </div>`;
}

export function VillagePanel() {
  const tz = store.data.settings.timeZone;
  const [sel, setSel] = useState(null);
  const bal = G.balance(store.data);
  const gems = V.gemBalance(store.data);
  const mood = V.happiness(store.data, tz, store.now.today);
  const style = env.style;
  return html`
    <div class="village-panel">
      <${Mood} mood=${mood} bal=${bal} gems=${gems}/>
      <div class="village-stage">
        <${VillageCanvas} mode="full" onPick=${(h) => setSel(h && h.type ? h : null)}/>
        <span class="village-style">${style.name}</span>
      </div>
      <${Selected} sel=${sel} bal=${bal} onClose=${() => setSel(null)}/>
      <${LightControls}/>
      <h2 class="block-title">Магазин деревни</h2>
      <${ShopGrid} bal=${bal}/>
      <details class="card-block village-more">
        <summary>Настройки деревни</summary>
        <${VillageSettings}/>
      </details>
      <details class="rules card-block">
        <summary>Как это работает</summary>
        <ul>
          <li>За выполненные задачи — монеты 🪙 (по приоритету). На них строишь деревню и заселяешь жителей.</li>
          <li>Изумруды 💎 — вторая валюта. Их добывает изумрудная шахта (за важные и критичные задачи) и дают фокус-сессии от 15 минут.</li>
          <li>Золотая шахта увеличивает монеты за каждую задачу: +10 / 20 / 30 % по уровню.</li>
          <li>Настроение жителей зависит от выполненных задач за 3 дня (чем важнее, тем больше радости), фокуса сегодня и просроченных задач.</li>
          <li>«Взяться за задачу» — фокус-сессия: таймер, строитель трудится в мастерской, в конце — фейерверк и изумруды.</li>
          <li>Стиль деревни следует цветовой схеме (Lavender — готика, Lime — сказочный луг, «Океан» — море с маяком, «Закат» — осень), флаги — цвету квадрата с буквой.</li>
          <li>Покупку можно вернуть в «Магазине → История», если на ней не держится следующий уровень и её изумруды не потрачены.</li>
        </ul>
      </details>
    </div>`;
}

export function VillageScreen() {
  if (!villageOn()) {
    return html`<div class="screen">
      <div class="card-block">
        <h2 class="block-title">Деревня спит</h2>
        <p class="muted">Деревня — часть игрового режима: монеты за задачи, постройки, жители и изумруды. Включается для всех устройств.</p>
        <button class="btn primary" onClick=${() => A.updateSettings({ gameEnabled: true })} disabled=${!!store.ui.readOnly}>Включить игру</button>
      </div>
    </div>`;
  }
  return html`<div class="screen village"><${VillagePanel}/></div>`;
}
