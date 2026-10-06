// Экран «Деревня» (обновление 0.7, полноэкранный вид — 0.7.1, стройка прямо в деревне — 0.7.2): деревня во весь
// экран без затемнения, сверху — компактная панель (настроение, монеты и изумруды, фокус, «Позвать», «Вид», магазин),
// под ней — «Вид» (приближение, время суток, свет), снизу — карточка того, на что нажали: переставить, продать,
// улучшить шахту, «Построить здесь» на пустой клетке. Магазин и настройки — во вкладке «🏡 Деревня» магазина.

import { html, useEffect, useState } from '../html.js';
import { Icon } from '../icons.js';
import { store, openSheet, notify } from '../../store/appState.js';
import * as A from '../../store/actions.js';
import * as G from '../../core/game.js';
import * as V from '../../core/village.js';
import {
  villageOn, villageSel, selectInVillage, villageMove, startMove, cancelMove, findObject, zoomRange, snapZoom, viewZoom,
} from '../components/VillageView.js';
import { FOOT, nearestPlace } from '../../village/map.js';
import { DecorationSettings } from '../components/Decorations.js';
import { world, env, setEnv } from '../../village/runtime.js';
import { getPrefs, setPrefs } from '../prefs.js';
import { readLocal, writeLocal } from '../hooks.js';
import { getFocus } from '../../store/focus.js';
import { navigate } from '../router.js';

const TABS = [['building', 'Постройки'], ['char', 'Жители'], ['light', 'Свет и небо'], ['decor', 'Декор']];
const BASE_INFO = {
  'base:house': { name: 'Дом старосты', emoji: '🏠', desc: 'С него началась деревня. Ночью в окнах горит свет — нажми на дом, чтобы выключить.' },
  'base:wanderer': { name: 'Странник', emoji: '🧑‍🌾', desc: 'Живёт в деревне с самого начала. Без строителя сам берётся за работу во время фокуса.' },
};

const infoOf = (id) => BASE_INFO[id] || V.villageItem(id);
const price = (it) => (it.gems ? `${it.gems} 💎` : `${it.coins} 🪙`);

export function openVillageShop() {
  writeLocal('shopTab', 'village');
  navigate('/shop');
}

function Mood({ mood, bal, gems, compact = false, onView = null, viewOpen = false }) {
  const f = getFocus();
  return html`
    <div class=${'village-head' + (compact ? ' hud' : ' card-block')}>
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
        ${onView ? html`<button class=${'btn small' + (viewOpen ? ' active' : '')} onClick=${onView} aria-pressed=${viewOpen} title="Приближение, время суток и свет">🔭 Вид</button>` : null}
        ${compact ? html`<button class="btn small" onClick=${openVillageShop} title="Магазин деревни"><${Icon} name="shop" size=${16}/> Магазин</button>`
          : html`<button class="btn small" onClick=${() => navigate('/village')}><${Icon} name="village" size=${16}/> Смотреть деревню</button>`}
      </div>
    </div>`;
}

/** Как называется объект деревни на карте (дом, шахта нужного уровня, мишень…). */
function objInfo(o) {
  if (!o) return { name: 'Объект', emoji: '🏠', desc: '' };
  if (o.id === 'base:house') return BASE_INFO['base:house'];
  if (o.virtual) return { name: 'Мишень', emoji: '🎯', desc: 'Здесь тренируется лучница. Ставится сама.' };
  if (o.place === 'goldmine' || o.place === 'gemmine') return V.villageItem(o.id) || V.villageItem(o.itemId);
  return V.shopItems().find((it) => it.place === o.place && !it.upgrade) || V.villageItem(o.itemId) || { name: o.place, emoji: '🏠', desc: '' };
}

const LIT = (b) => b.type.startsWith('house') || ['tavern', 'tower', 'windmill'].includes(b.type);

function Selected({ sel, bal }) {
  const [build, setBuild] = useState(false);
  useEffect(() => setBuild(false), [sel]);
  if (!sel) return null;
  const readOnly = !!store.ui.readOnly;
  const close = html`<button class="icon-btn small" onClick=${() => selectInVillage(null)} aria-label="Закрыть"><${Icon} name="close" size=${16}/></button>`;
  if (sel.type === 'actor') {
    const a = sel.actor;
    const it = infoOf(a.id) || BASE_INFO['base:wanderer'];
    return html`<div class="village-sel">
      <span class="vs-emoji">${it.emoji}</span>
      <div class="vs-main"><b>${it.name}</b><p class="muted small">${it.desc || ''}</p></div>
      <div class="vs-actions">
        <button class="btn small" onClick=${() => world.poke(a)}>Погладить</button>
        <button class="btn small" onClick=${() => world.sendVisitor(a)}>К экрану</button>
        ${close}
      </div></div>`;
  }
  if (sel.type === 'tile') {
    // пустая клетка: что здесь построить
    const owned = V.ownedVillage(store.data);
    const items = V.shopItems().filter((it) => it.place && !it.upgrade && (it.repeatable || !owned.has(it.id)));
    const buy = (it) => {
      const [w, h] = FOOT[it.place] || [1, 1];
      const at = nearestPlace(world.map, it.place, sel.tx - Math.floor(w / 2), sel.ty - Math.floor(h / 2)) || [sel.tx, sel.ty];
      selectInVillage(null);
      A.buyVillageItem(it.id, { x: at[0] - world.map.cx, y: at[1] - world.map.cy });
    };
    return html`<div class="village-sel village-build">
      <span class="vs-emoji">🌱</span>
      <div class="vs-main"><b>Свободное место</b><p class="muted small">${build ? 'Что поставить? Если не влезет ровно сюда — встанет на ближайшее свободное место.' : 'Здесь можно построить дом, шахту, огород или поставить декор.'}</p></div>
      <div class="vs-actions">
        ${build ? null : html`<button class="btn small primary" disabled=${readOnly} onClick=${() => setBuild(true)}><${Icon} name="plus" size=${16}/> Построить здесь</button>`}
        ${close}
      </div>
      ${build ? html`<div class="vb-grid">
        ${items.map((it) => {
          const check = V.canBuy(store.data, it, bal);
          return html`<button class="vb-item" key=${it.id} disabled=${!check.ok || readOnly} title=${check.reason || it.desc || ''} onClick=${() => buy(it)}>
            <span class="v-emoji">${it.emoji}</span><span class="vb-name">${it.name}</span><small>${price(V.priceOf(store.data, it))}</small></button>`;
        })}
      </div>` : null}
    </div>`;
  }
  const o = findObject(sel.obj?.key) || sel.obj;
  if (!o) return null;
  const it = objInfo(o);
  const own = !o.fixed && !o.virtual;
  const plan = own ? V.sellPlan(store.data, o.key) : null;
  const back = plan && !plan.error ? [plan.coins ? `+${plan.coins} 🪙` : '', plan.gems ? `+${plan.gems} 💎` : ''].filter(Boolean).join(' ') : '';
  const next = o.place === 'goldmine' || o.place === 'gemmine' ? V.VILLAGE_ITEMS.find((x) => x.requires === o.id) : null;
  const check = next ? V.canBuy(store.data, next, bal) : null;
  const lightId = sel.type === 'lantern' ? o.key : o.id;
  const lights = sel.type === 'lantern' || (sel.type === 'building' && LIT(o));
  const count = own ? V.villageObjects(store.data).filter((x) => x.place === o.place).length : 0;
  return html`<div class="village-sel">
    <span class="vs-emoji">${it.emoji}</span>
    <div class="vs-main"><b>${it.name}${count > 1 && !next ? html` <small class="muted">· таких ${count}</small>` : null}</b>
      <p class="muted small">${o.fixed ? 'С него началась деревня — он всегда на своём месте.' : it.desc || ''}</p>
      ${next ? html`<p class="small">Дальше: ${next.emoji} ${next.name} — ${next.desc || ''}</p>` : null}</div>
    <div class="vs-actions">
      ${lights ? html`<button class="btn small" onClick=${() => setPrefs({ villageLightsOff: world.toggleLight(lightId) })}>${world.lightOn(lightId) ? '💡 Погасить' : '💡 Зажечь'}</button>` : null}
      ${next ? html`<button class="btn small primary" disabled=${!check.ok || readOnly} title=${check.reason || 'Улучшить'} onClick=${() => A.buyVillageItem(next.id)}>⬆ ${price(V.priceOf(store.data, next))}</button>` : null}
      ${own ? html`<button class="btn small" disabled=${readOnly} onClick=${() => startMove(o.key)}><${Icon} name="move" size=${16}/> Переставить</button>` : null}
      ${own ? html`<button class="btn small" disabled=${!!plan.error || readOnly} title=${plan.error || 'Вернётся полная цена'}
        onClick=${async () => { if (await A.sellVillageObject(o.key)) selectInVillage(null); }}>Продать${back ? ` · ${back}` : ''}</button>` : null}
      ${close}
    </div></div>`;
}

/** Полоса перестановки: тянуть объект или нажать на клетку; «Готово» — запомнить место (синхронизируется). */
function MoveBar() {
  const m = villageMove.current;
  if (!m) return null;
  const it = objInfo(findObject(m.key));
  const done = async () => {
    const cur = villageMove.current;
    if (!cur || !cur.ok) return;
    villageMove.current = null;
    notify();
    if (cur.tx !== cur.from[0] || cur.ty !== cur.from[1]) await A.moveVillageObject(cur.key, cur.tx - world.map.cx, cur.ty - world.map.cy);
  };
  return html`<div class="village-sel village-move" role="status">
    <span class="vs-emoji">${it.emoji}</span>
    <div class="vs-main"><b>Переставить: ${it.name}</b>
      <p class=${'small' + (m.ok ? ' muted' : ' vm-bad')}>${m.ok ? 'Тяни объект или нажми на клетку. Зелёная рамка — сюда можно.'
        : 'Здесь не встанет: нужна свободная трава, вокруг построек — клетка зазора и проход к двери.'}</p></div>
    <div class="vs-actions">
      <button class="btn small" onClick=${cancelMove}>Отмена</button>
      <button class="btn small primary" disabled=${!m.ok} onClick=${done}>Готово</button>
    </div></div>`;
}

/** Приближение: ползунок (влево — дальше) и «Авто» (чем больше деревня, тем дальше). */
export function ZoomControl() {
  const p = getPrefs();
  const { min, max } = zoomRange();
  const auto = !Number.isFinite(p.villageZoom);
  const z = auto ? viewZoom.auto : snapZoom(p.villageZoom);
  return html`<div class="vz-row">
    <label class="vl-slider"><span>🔭 Приближение: <b>${auto ? 'авто' : `×${z.toFixed(z < 1 ? 2 : 1)}`}</b></span>
      <input type="range" min=${min} max=${max} step="0.05" value=${z} onInput=${(e) => setPrefs({ villageZoom: +e.target.value })} aria-label="Приближение деревни"/></label>
    <button class=${'chip' + (auto ? ' selected' : '')} onClick=${() => setPrefs({ villageZoom: null })} title="Чем больше деревня, тем дальше">Авто</button>
  </div>`;
}

/** Панель «Вид»: приближение, время суток и свет. */
function ViewControls() {
  const [h, setH] = useState(null);
  useEffect(() => () => setEnv({ phaseOverride: null }), []);
  const cur = h ?? Math.round(env.phase * 24 * 4) / 4;
  const label = `${String(Math.floor(cur) % 24).padStart(2, '0')}:${String(Math.round((cur % 1) * 60)).padStart(2, '0')}`;
  const set = (v) => {
    setH(v);
    setEnv({ phaseOverride: v == null ? null : v / 24 });
  };
  const lightsOff = getPrefs().villageLightsOff || [];
  return html`<div class="village-time">
    <${ZoomControl}/>
    <label class="vl-slider"><span>☀️ <b>${h == null ? 'как сейчас' : label}</b></span>
      <input type="range" min="0" max="24" step="0.25" value=${cur} onInput=${(e) => set(+e.target.value)} aria-label="Время суток в деревне"/></label>
    <div class="chip-row">
      <button class="chip" onClick=${() => set(12)} title="День">🌞</button>
      <button class="chip" onClick=${() => set(18.25)} title="Закат">🌇</button>
      <button class="chip" onClick=${() => set(23)} title="Ночь">🌙</button>
      <button class=${'chip' + (h == null ? ' selected' : '')} onClick=${() => set(null)}>Сейчас</button>
      <button class="chip" title=${lightsOff.length ? 'Зажечь весь свет' : 'Погасить весь свет'}
        onClick=${() => setPrefs({ villageLightsOff: lightsOff.length ? [] : [...world.lanterns.map((l) => l.id), ...world.buildings.map((b) => b.id)] })}>💡</button>
    </div>
  </div>`;
}

function ShopGrid({ bal }) {
  const [tab, setTabState] = useState(() => readLocal('villageTab', 'building'));
  const setTab = (t) => {
    setTabState(t);
    writeLocal('villageTab', t);
  };
  const owned = V.ownedVillage(store.data);
  const objects = V.villageObjects(store.data);
  const readOnly = !!store.ui.readOnly;
  const items = V.shopItems().filter((it) => (tab === 'light' ? ['light', 'sky'].includes(it.kind) : it.kind === tab));
  return html`
    <div class="chip-row wrap" role="tablist">
      ${TABS.map(([k, label]) => html`<button role="tab" aria-selected=${tab === k} class=${'chip' + (tab === k ? ' selected' : '')} onClick=${() => setTab(k)}>${label}</button>`)}
    </div>
    <div class="village-items">
      ${items.map((it) => {
        const has = !it.repeatable && owned.has(it.id);
        const count = it.repeatable ? objects.filter((o) => o.place === it.place).length : 0;
        const check = has ? null : V.canBuy(store.data, it, bal);
        const locked = check && check.reason.startsWith('Сначала');
        return html`<div class=${'v-item' + (has || count ? ' owned' : '') + (locked ? ' locked' : '')} key=${it.id}>
          <span class="v-emoji">${it.emoji}</span>
          <div class="v-name">${it.name}${it.big ? html` <small class="v-tag">большой</small>` : null}${count ? html` <small class="v-tag">×${count}</small>` : null}</div>
          <p class="muted small">${it.desc || ''}</p>
          ${has ? html`<span class="v-owned">✓ Есть</span>`
            : locked ? html`<small class="muted">${check.reason}</small>`
            : html`<button class=${'btn small' + (check.ok ? ' primary' : '')} disabled=${!check.ok || readOnly} title=${check.reason || 'Купить'}
                onClick=${() => A.buyVillageItem(it.id)}>${count ? 'Ещё · ' : ''}${price(V.priceOf(store.data, it))}</button>`}
        </div>`;
      })}
    </div>`;
}

export function VillageSettings() {
  const p = getPrefs();
  const daynight = V.ownedVillage(store.data).has('v:daynight');
  const mode = daynight ? p.dayMode || 'theme' : 'theme';
  const dim = Number.isFinite(p.villageDim) ? p.villageDim : 0.55;
  return html`<div class="village-settings">
    <label class="toggle-row compact"><input type="checkbox" checked=${p.villageBackdrop !== false} onChange=${(e) => setPrefs({ villageBackdrop: e.target.checked })}/>
      <span>Деревня на фоне вкладок<small>Во весь экран за карточками, приглушённая. На экране «Деревня» видна всегда</small></span></label>
    <label class="field village-dim-field"><span>Затемнение на вкладках: ${Math.round(dim * 100)} %</span>
      <input type="range" min="0" max="0.9" step="0.05" value=${dim} onInput=${(e) => setPrefs({ villageDim: +e.target.value })} aria-label="Затемнение деревни на вкладках"/></label>
    <label class="toggle-row compact"><input type="checkbox" checked=${p.visitors !== false} onChange=${(e) => setPrefs({ visitors: e.target.checked })}/>
      <span>Жители подходят к экрану<small>Иногда кто-нибудь выходит из леса и стучит по «стеклу»</small></span></label>
    <${DecorationSettings}/>
    <${ZoomControl}/>
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

function useVillageNumbers() {
  const tz = store.data.settings.timeZone;
  return {
    bal: G.balance(store.data),
    gems: V.gemBalance(store.data),
    mood: V.happiness(store.data, tz, store.now.today),
  };
}

/** Вкладка «🏡 Деревня» в магазине: покупки и настройки (деревня видна за карточками, затемнение слабее). */
export function VillageShopPanel() {
  const { bal, gems, mood } = useVillageNumbers();
  return html`
    <div class="village-panel">
      <${Mood} mood=${mood} bal=${bal} gems=${gems}/>
      <h2 class="block-title">Магазин деревни</h2>
      <${ShopGrid} bal=${bal}/>
      <details class="card-block village-more" open>
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
          <li>«Взяться за задачу» — фокус-сессия: таймер, строитель трудится в мастерской, в конце — фейерверк и изумруды. Время по задаче сохраняется в ней самой.</li>
          <li>Стиль деревни следует цветовой схеме (Lavender — готика, Lime — сказочный луг, «Океан» — море с маяком, «Закат» — осень), флаги — цвету квадрата с буквой.</li>
          <li>Дома, огороды, фонари и декор можно покупать сколько угодно — земля деревни сама расширяется, а вид отдаляется.</li>
          <li>На экране «Деревня» нажми на постройку — её можно переставить или продать (вернётся полная цена), на пустую клетку — построить там что-нибудь.</li>
          <li>Продать или вернуть шахту нельзя, если её изумруды уже потрачены; уровень шахты продаётся вместе с ней.</li>
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
  const { bal, gems, mood } = useVillageNumbers();
  const [view, setView] = useState(() => readLocal('villageViewOpen', false));
  const toggle = () => {
    writeLocal('villageViewOpen', !view);
    setView(!view);
  };
  const moving = !!villageMove.current;
  return html`<div class="screen village-screen">
    <${Mood} mood=${mood} bal=${bal} gems=${gems} compact onView=${toggle} viewOpen=${view}/>
    ${view ? html`<${ViewControls}/>` : null}
    <div class="village-bottom">
      ${moving ? html`<${MoveBar}/>` : html`<${Selected} sel=${villageSel.current} bal=${bal}/>`}
      ${moving || villageSel.current ? null : html`<p class="village-hint">Нажми на жителя, постройку или пустую клетку. Потяни — прокрутка, щипок или Ctrl + колесо — приближение.</p>`}
    </div>
  </div>`;
}
