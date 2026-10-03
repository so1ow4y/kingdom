// Экран «Магазин» (обновление 0.3, п. 2.6): баланс, уровень и опыт, серия; свои награды, косметика,
// достижения, история покупок и журнал монет. Баланс считается из журнала (core/game.js), а не хранится числом.

import { html, useState } from '../html.js';
import { Icon } from '../icons.js';
import { store } from '../../store/appState.js';
import * as A from '../../store/actions.js';
import * as G from '../../core/game.js';
import { formatMoment } from '../../core/dates.js';
import { countLabel } from '../../core/plural.js';
import { getPrefs, setPrefs, SCHEMES } from '../prefs.js';
import { readLocal, writeLocal } from '../hooks.js';

const TABS = [['rewards', 'Награды'], ['cosmetics', 'Оформление'], ['achievements', 'Достижения'], ['history', 'История']];
const EMOJI = ['🎁', '🍕', '📺', '🎮', '☕', '🍰', '🛌', '🎬', '📚', '🛍', '🏖', '🎧'];

export function GameHeader({ st }) {
  const lv = st.levelInfo;
  return html`
    <div class="game-head">
      <div class="gh-balance"><span class="gh-coin">🪙</span><b>${st.balance}</b><small>монет</small></div>
      <div class="gh-level">
        <div class="gh-row"><b>Уровень ${lv.level}</b><small>${lv.xp} / ${lv.to} опыта</small></div>
        <div class="progress"><i style=${{ width: Math.round(lv.progress * 100) + '%' }}></i></div>
      </div>
      <div class="gh-streak" title=${'Лучшая серия: ' + countLabel(st.bestStreak, ['день', 'дня', 'дней'])}>
        🔥 <b>${st.currentStreak}</b><small>${countLabel(st.currentStreak, ['день', 'дня', 'дней']).replace(/^\d+\s/, '')} подряд</small>
      </div>
    </div>`;
}

function RewardForm({ reward = null, onDone }) {
  const [name, setName] = useState(reward?.name || '');
  const [emoji, setEmoji] = useState(reward?.emoji || '🎁');
  const [price, setPrice] = useState(String(reward?.price || 50));
  const [repeatable, setRepeatable] = useState(reward ? reward.repeatable : true);
  const submit = async (e) => {
    e.preventDefault();
    const p = Math.round(+price);
    if (!name.trim() || !(p >= 1)) return;
    if (reward) await A.updateReward(reward.id, { name: name.trim(), emoji, price: p, repeatable });
    else await A.createReward({ name, emoji, price: p, repeatable });
    onDone();
  };
  return html`
    <form class="reward-form card-block" onSubmit=${submit}>
      <div class="chip-row wrap emoji-pick">
        ${EMOJI.map((x) => html`<button type="button" class=${'chip' + (emoji === x ? ' selected' : '')} onClick=${() => setEmoji(x)}>${x}</button>`)}
        <input class="emoji-input" value=${emoji} maxLength="4" onInput=${(e) => setEmoji(e.target.value)} aria-label="Свой эмодзи"/>
      </div>
      <div class="field-row">
        <label class="field"><span>Название</span><input value=${name} maxLength="60" placeholder="Например, серия сериала" onInput=${(e) => setName(e.target.value)} required/></label>
        <label class="field narrow"><span>Цена, 🪙</span><input type="number" min="1" max="1000000" value=${price} onInput=${(e) => setPrice(e.target.value)} required/></label>
      </div>
      <label class="toggle-row compact"><input type="checkbox" checked=${repeatable} onChange=${(e) => setRepeatable(e.target.checked)}/>
        <span>Многоразовая <small class="muted">(одноразовую можно купить только один раз)</small></span></label>
      <div class="form-actions">
        <button type="button" class="btn" onClick=${onDone}>Отмена</button>
        <button type="submit" class="btn primary" disabled=${!name.trim()}>${reward ? 'Сохранить' : 'Добавить награду'}</button>
      </div>
    </form>`;
}

function Rewards({ bal }) {
  const [editing, setEditing] = useState(null); // null | 'new' | id
  const [showArchived, setShowArchived] = useState(false);
  const all = [...store.data.rewards.values()].filter((r) => !r.deletedAt).sort((a, b) => (a.order < b.order ? -1 : 1));
  const list = all.filter((r) => !r.archived);
  const archived = all.filter((r) => r.archived);
  const readOnly = !!store.ui.readOnly;
  const row = (r) => {
    const bought = G.purchasedCount(store.data, r.id);
    const soldOut = !r.repeatable && bought > 0;
    if (editing === r.id) return html`<${RewardForm} key=${r.id} reward=${r} onDone=${() => setEditing(null)}/>`;
    return html`
      <div class=${'reward-row' + (r.archived ? ' archived' : '')} key=${r.id}>
        <span class="reward-emoji">${r.emoji || '🎁'}</span>
        <div class="reward-main">
          <div class="reward-name">${r.name}</div>
          <small class="muted">${r.repeatable ? 'многоразовая' : 'одноразовая'}${bought ? ` · куплено ${bought}` : ''}</small>
        </div>
        ${r.archived ? html`<button class="btn small" onClick=${() => A.updateReward(r.id, { archived: false })} disabled=${readOnly}>Вернуть</button>` : html`
          <button class="icon-btn small" title="Изменить" aria-label="Изменить" onClick=${() => setEditing(r.id)} disabled=${readOnly}><${Icon} name="edit" size=${16}/></button>
          <button class="icon-btn small" title=${bought ? 'В архив' : 'Удалить'} aria-label="Удалить" onClick=${() => A.deleteReward(r.id)} disabled=${readOnly}><${Icon} name=${bought ? 'archive' : 'trash'} size=${16}/></button>
          <button class=${'btn small ' + (soldOut ? '' : 'primary')} disabled=${soldOut || r.price > bal || readOnly} onClick=${() => A.buyReward(r.id)}
            title=${soldOut ? 'Уже куплена' : r.price > bal ? `Не хватает ${r.price - bal} 🪙` : 'Купить'}>
            ${soldOut ? 'Куплено' : html`${r.price} 🪙`}</button>`}
      </div>`;
  };
  return html`
    <div class="reward-list">
      ${list.length ? list.map(row) : html`<p class="muted">Придумай награды, на которые хочется копить: «Серия сериала — 50», «Пицца — 300».</p>`}
    </div>
    ${editing === 'new' ? html`<${RewardForm} onDone=${() => setEditing(null)}/>`
      : html`<button class="btn" onClick=${() => setEditing('new')} disabled=${readOnly}><${Icon} name="plus" size=${16}/> Новая награда</button>`}
    ${archived.length ? html`
      <button class="link-btn" onClick=${() => setShowArchived(!showArchived)}>${showArchived ? 'Скрыть архив' : `Архив наград (${archived.length})`}</button>
      ${showArchived ? html`<div class="reward-list">${archived.map(row)}</div>` : null}` : null}`;
}

function Cosmetics({ bal }) {
  const p = getPrefs();
  const readOnly = !!store.ui.readOnly;
  const applied = (c) => (c.kind === 'scheme' ? (p.scheme || 'indigo') === c.value : p.letter === c.value);
  const apply = (c) => setPrefs(c.kind === 'scheme' ? { scheme: applied(c) ? 'indigo' : c.value } : { letter: applied(c) ? null : c.value });
  return html`
    <p class="muted small">Купленное оформление включается на каждом устройстве отдельно (здесь или в «Настройки → Внешний вид»).</p>
    <div class="cosmetic-grid">
      ${G.COSMETICS.map((c) => {
        const owned = G.ownsItem(store.data, c.id);
        const swatch = c.kind === 'scheme' ? (document.documentElement.dataset.theme === 'dark' ? SCHEMES[c.value].dark : SCHEMES[c.value].light) : c.value;
        return html`
          <div class=${'cosmetic' + (applied(c) ? ' selected' : '')} key=${c.id}>
            <span class="cosmetic-swatch" style=${{ background: swatch }}>${c.kind === 'letter' ? 'L' : ''}</span>
            <div class="cosmetic-name">${c.name}</div>
            ${owned ? html`<button class="btn small" onClick=${() => apply(c)}>${applied(c) ? 'Снять' : 'Включить'}</button>`
              : html`<button class="btn small primary" disabled=${c.price > bal || readOnly} onClick=${() => A.buyCosmetic(c.id)}
                  title=${c.price > bal ? `Не хватает ${c.price - bal} 🪙` : 'Купить'}>${c.price} 🪙</button>`}
          </div>`;
      })}
    </div>`;
}

function Achievements({ st }) {
  return html`
    <div class="achievements">
      ${st.achievements.map((a) => html`<div class=${'badge' + (a.unlocked ? ' on' : '')} key=${a.id} title=${a.unlocked ? 'Получено' : 'Ещё не получено'}>
        <span class="badge-emoji">${a.unlocked ? a.emoji : '🔒'}</span><span class="badge-name">${a.name}</span></div>`)}
    </div>
    <p class="muted small">Получено ${st.achievements.filter((a) => a.unlocked).length} из ${st.achievements.length}. Выполнено задач за всё время: ${st.done}, лучшая серия: ${countLabel(st.bestStreak, ['день', 'дня', 'дней'])}.</p>`;
}

function History() {
  const tz = store.data.settings.timeZone;
  const [all, setAll] = useState(false);
  const events = [...store.data.coinEvents.values()].filter((e) => !e.deletedAt && e.at && (all || e.type === 'purchase'))
    .sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 200);
  const label = (e) => {
    if (e.type === 'purchase') return e.active ? 'Покупка' : 'Возврат покупки';
    return e.active ? 'За задачу' : 'Отметка снята — монеты возвращены';
  };
  return html`
    <div class="chip-row">
      <button class=${'chip' + (!all ? ' selected' : '')} onClick=${() => setAll(false)}>Покупки</button>
      <button class=${'chip' + (all ? ' selected' : '')} onClick=${() => setAll(true)}>Все события</button>
    </div>
    ${events.length ? html`<div class="coin-log">
      ${events.map((e) => html`<div class=${'coin-row' + (e.active ? '' : ' inactive')} key=${e.id}>
        <div class="coin-main"><div>${e.title || '—'}</div><small class="muted">${label(e)} · ${formatMoment(e.at, tz)}</small></div>
        <b class=${e.amount < 0 ? 'neg' : 'pos'}>${e.amount > 0 ? '+' : ''}${e.amount}</b>
        ${e.type === 'purchase' && e.active ? html`<button class="btn small ghost" onClick=${() => A.refundPurchase(e.id)} disabled=${!!store.ui.readOnly}>Вернуть</button>` : null}
      </div>`)}
    </div>` : html`<p class="muted">${all ? 'Событий пока нет — выполни задачу.' : 'Покупок пока не было.'}</p>`}`;
}

export function ShopScreen() {
  const tz = store.data.settings.timeZone;
  const st = G.gameStats(store.data, tz, store.now.today);
  const [tab, setTabState] = useState(() => readLocal('shopTab', 'rewards'));
  const setTab = (t) => {
    setTabState(t);
    writeLocal('shopTab', t);
  };
  if (!store.data.settings.gameEnabled) {
    return html`<div class="screen">
      <div class="card-block">
        <h2 class="block-title">Игровой режим выключен</h2>
        <p class="muted">Монеты за задачи, магазин наград, уровни и достижения. Включается для всех устройств.</p>
        <button class="btn primary" onClick=${() => A.updateSettings({ gameEnabled: true })} disabled=${!!store.ui.readOnly}>Включить игру</button>
      </div>
    </div>`;
  }
  return html`
    <div class="screen shop">
      <${GameHeader} st=${st}/>
      ${st.balance < 0 ? html`<p class="hint warn">Баланс ниже нуля: монеты за задачу вернулись, когда сняли отметку, а покупка уже была. Новые покупки — когда баланс снова станет положительным.</p>` : null}
      <div class="chip-row wrap" role="tablist">
        ${TABS.map(([k, label]) => html`<button role="tab" aria-selected=${tab === k} class=${'chip' + (tab === k ? ' selected' : '')} onClick=${() => setTab(k)}>${label}</button>`)}
      </div>
      ${tab === 'rewards' ? html`<${Rewards} bal=${st.balance}/>` : tab === 'cosmetics' ? html`<${Cosmetics} bal=${st.balance}/>`
        : tab === 'achievements' ? html`<${Achievements} st=${st}/>` : html`<${History}/>`}
    </div>`;
}

/** Раздел «Игра» в настройках: выключатель, монеты за приоритеты (ссылка), правила. */
export function GameSettingsSection() {
  const s = store.data.settings;
  const readOnly = !!store.ui.readOnly;
  const prios = [...store.data.priorities.values()].filter((p) => !p.deletedAt && !p.archived).sort((a, b) => (a.order < b.order ? -1 : 1));
  return html`
    <section class="set-section" id="game">
      <h2>Игра</h2>
      <label class="toggle-row">
        <input type="checkbox" checked=${!!s.gameEnabled} disabled=${readOnly} onChange=${(e) => A.updateSettings({ gameEnabled: e.target.checked })}/>
        <span>Игровой режим<small>Монеты за задачи, магазин, уровни, серии и достижения. Настройка общая для всех устройств.</small></span>
      </label>
      ${s.gameEnabled ? html`
        <div class="field-label">Монеты за приоритеты</div>
        <div class="chip-row wrap">${prios.map((p) => html`<span class="chip"><i class="dot" style=${{ background: p.color }}></i>${p.name} · ${p.coins} 🪙</span>`)}</div>
        <a class="link-btn" href="#/settings?section=priorities">Изменить в «Приоритетах»</a>
        <details class="rules">
          <summary>Правила</summary>
          <ul>
            <li>Выполнил задачу — монеты по её приоритету. Сняли отметку — монеты забираются обратно, поэтому «нафармить» переключением нельзя.</li>
            <li>Подзадача — это обычная задача: за неё свои монеты по её приоритету. Родитель приносит свои монеты отдельно.</li>
            <li>Повторяющаяся задача — монеты за каждый выполненный экземпляр (за каждую дату).</li>
            <li>Смена приоритета у уже выполненной задачи пересчитывает её монеты.</li>
            <li>Покупка списывает монеты; купить дороже баланса нельзя. Покупку можно вернуть в «Истории».</li>
            <li>Опыт — все заработанные монеты за всё время, траты его не уменьшают. Уровень L требует 25·(L−1)·L опыта: 50, 150, 300, 500…</li>
            <li>Серия — дни подряд, в которые выполнена хотя бы одна задача.</li>
            <li>Пока игра выключена, монеты не начисляются, а всё оформление доступно бесплатно. Журнал монет при этом сохраняется.</li>
          </ul>
        </details>` : null}
    </section>`;
}