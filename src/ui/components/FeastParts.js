// Общие кусочки экранов Feast (обновление 0.11): сводка дня, полоски БЖУ, ввод пищевой ценности, приёмы пищи.

import { html, useState } from '../html.js';
import { Icon } from '../icons.js';
import { store } from '../../store/appState.js';
import * as F from '../../core/feast.js';
import {
  NUTRIENTS, NUTRIENT, NUTRIENT_GROUPS, MACROS, nv, fmt, dayGoals, remaining, signed, rdiPct, kcalFromMacros, macroSplit,
} from '../../core/nutrition.js';

export const feastGoals = () => dayGoals(store.feast.settings);

/** Цвета БЖУ — первые три слота проверенной категориальной палитры (одинаковы на всех экранах). */
export const MACRO_COLOR = { protein: 'var(--series-1)', fat: 'var(--series-2)', carbs: 'var(--series-3)' };

/** Полоска «съедено из цели»: заливка — цвет вещества, сверх цели — предупреждение. */
export function Meter({ value, max, color = 'var(--accent)', label = null }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const over = max > 0 && value > max;
  return html`<span class=${'meter' + (over ? ' over' : '')} role="meter" aria-valuenow=${Math.round(value)} aria-valuemin="0"
    aria-valuemax=${Math.round(max)} aria-label=${label || undefined}>
    <i style=${{ width: pct + '%', background: over ? 'var(--danger)' : color }}></i></span>`;
}

/**
 * Сводка дня как в дневнике FatSecret: «Осталось 247» или «−247» (превысили лимит), съедено из лимита,
 * БЖУ с целями и долями калорий.
 */
export function DaySummary({ totals, compact = false }) {
  const goals = feastGoals();
  const eaten = nv(totals, 'kcal');
  const left = remaining(goals.kcal, eaten);
  const over = left < 0;
  const split = macroSplit(totals);
  return html`
    <section class=${'day-summary card-block' + (over ? ' over' : '')} aria-label="Итоги дня">
      <div class="sum-kcal">
        <div class="sum-left">
          <span class="sum-left-label">${over ? 'Сверх лимита' : 'Осталось'}</span>
          <b class="sum-left-value">${signed(left)}</b>
          <span class="sum-left-unit">ккал${over ? html` <span class="sum-warn">⚠ лимит превышен</span>` : ''}</span>
        </div>
        <div class="sum-eaten">
          <span><b>${fmt(eaten, 'kcal')}</b> съедено</span>
          <span class="muted">лимит ${fmt(goals.kcal, 'kcal')}</span>
        </div>
      </div>
      <${Meter} value=${eaten} max=${goals.kcal} label="Калории из лимита"/>
      ${compact ? null : html`
        <div class="sum-macros">
          ${MACROS.map((k) => html`
            <div class="sum-macro" key=${k}>
              <span class="sum-macro-head"><i class="swatch" style=${{ background: MACRO_COLOR[k] }}></i>${NUTRIENT[k].label}
                <small class="muted">${Math.round(split[k] * 100)} %</small></span>
              <b>${fmt(nv(totals, k), k)} <small class="muted">/ ${goals[k]} г</small></b>
              <${Meter} value=${nv(totals, k)} max=${goals[k]} color=${MACRO_COLOR[k]} label=${NUTRIENT[k].label}/>
            </div>`)}
        </div>`}
    </section>`;
}

/** Короткая строка БЖУ: «Б 12 · Ж 3,5 · У 40». */
export const macroLine = (n) => MACROS.map((k) => `${NUTRIENT[k].short} ${fmt(nv(n, k), k)}`).join(' · ');

/** Значения веществ с процентом нормы (итоги дня, продукт). */
export function NutrientTable({ values, groups = ['main', 'more', 'vitamins', 'minerals'], showZero = false, pct = true }) {
  const goals = feastGoals();
  return html`<div class="nutrient-table">
    ${NUTRIENT_GROUPS.filter((g) => groups.includes(g.key)).map((g) => {
      const rows = NUTRIENTS.filter((n) => n.group === g.key && (showZero || nv(values, n.key) > 0));
      if (!rows.length) return null;
      return html`<div class="nt-group" key=${g.key}>
        <h4>${g.label}</h4>
        ${rows.map((n) => {
          const v = nv(values, n.key);
          const p = pct ? rdiPct(v, n.key, goals) : null;
          return html`<div class="nt-row" key=${n.key}>
            <span>${n.label}</span>
            <b>${fmt(v, n.key)} <small>${n.unit}</small></b>
            ${p != null ? html`<span class="nt-pct">${Math.round(p)} %</span>` : html`<span class="nt-pct"></span>`}
          </div>`;
        })}
      </div>`;
    })}
  </div>`;
}

/** Числовое поле с запятой: значение уходит на onCommit по уходу из поля или Enter. */
export function NumField({ label, value, unit = '', onCommit, step = 'any', disabled = false, placeholder = '0', big = false }) {
  const [draft, setDraft] = useState(null);
  const shown = draft ?? (value ? String(value).replace('.', ',') : '');
  const commit = () => {
    if (draft === null) return;
    onCommit(draft);
    setDraft(null);
  };
  return html`<label class=${'num-field' + (big ? ' big' : '')}>
    <span class="nf-label">${label}</span>
    <span class="nf-box">
      <input inputmode="decimal" value=${shown} placeholder=${placeholder} disabled=${disabled} step=${step}
        onInput=${(e) => setDraft(e.target.value)} onBlur=${commit}
        onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }}/>
      ${unit ? html`<small>${unit}</small>` : null}
    </span>
  </label>`;
}

/**
 * Пищевая ценность на 100 г/мл: КБЖУ крупно, остальное — раскрывающимися группами (по умолчанию нули).
 * onChange(nextNutrients) — при каждом изменённом поле.
 */
export function NutrientEditor({ nutrients, unit = 'g', onChange, disabled = false, open = false }) {
  const [shown, setShown] = useState(open);
  const set = (key, raw) => onChange({ ...nutrients, [key]: raw });
  const auto = kcalFromMacros(nutrients);
  const base = unit === 'ml' ? '100 мл' : '100 г';
  return html`<div class="nutrient-editor">
    <div class="ne-main">
      ${['kcal', ...MACROS].map((k) => html`<${NumField} key=${k} big label=${NUTRIENT[k].label} unit=${NUTRIENT[k].unit}
        value=${nv(nutrients, k)} disabled=${disabled} onCommit=${(v) => set(k, v)}/>`)}
    </div>
    <p class="hint">Значения на ${base}.${!nv(nutrients, 'kcal') && auto ? html` По БЖУ выходит ${auto} ккал —
      <button type="button" class="link-btn" disabled=${disabled} onClick=${() => set('kcal', auto)}>подставить</button>` : null}</p>
    <button type="button" class="link-btn ne-more" onClick=${() => setShown(!shown)} aria-expanded=${shown}>
      <${Icon} name=${shown ? 'chevronDown' : 'chevron'} size=${16}/> Подробнее, витамины и минералы</button>
    ${shown ? NUTRIENT_GROUPS.filter((g) => g.key !== 'main').map((g) => html`
      <div class="ne-group" key=${g.key}>
        <h4>${g.label}</h4>
        <div class="ne-grid">
          ${NUTRIENTS.filter((n) => n.group === g.key).map((n) => html`<${NumField} key=${n.key} label=${n.label} unit=${n.unit}
            value=${nv(nutrients, n.key)} disabled=${disabled} onCommit=${(v) => set(n.key, v)}/>`)}
        </div>
      </div>`) : null}
  </div>`;
}

/** Выбор рациона (0.12 — рационы дня: основные, свои общие и рационы только этого дня). */
export function MealChips({ value, onChange, date = store.now.today }) {
  const list = F.mealsForDay(store.feast, date).filter((m) => !m.missing || m.id === value);
  return html`<div class="chip-row wrap meal-chips" role="radiogroup" aria-label="Рацион">
    ${list.map((m) => html`<button type="button" role="radio" aria-checked=${value === m.id} key=${m.id}
      class=${'chip' + (value === m.id ? ' selected' : '')} onClick=${() => onChange(m.id)}>${m.icon} ${m.name}${m.time ? html` <small>${m.time}</small>` : null}</button>`)}
  </div>`;
}

/** Поле награды: своё значение (и 0 — тоже значение) или пусто — по умолчанию (показано подсказкой). */
function RewardField({ k, value, def, disabled, onCommit }) {
  const [draft, setDraft] = useState(null);
  const shown = draft ?? (value === undefined || value === null ? '' : String(value).replace('.', ','));
  const commit = () => {
    if (draft === null) return;
    onCommit(draft);
    setDraft(null);
  };
  return html`<label class="num-field reward-field">
    <span class="nf-label">${F.REWARD_ICONS[k]} ${F.REWARD_LABELS[k]}</span>
    <span class="nf-box">
      <input inputmode="decimal" value=${shown} placeholder=${String(def).replace('.', ',')} disabled=${disabled}
        aria-label=${F.REWARD_LABELS[k] + ' за запись'} onInput=${(e) => setDraft(e.target.value)} onBlur=${commit}
        onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }}/>
    </span>
  </label>`;
}

/**
 * Награда за запись продукта (0.12): опыт, монеты и алмазы 💎. Пустое поле — значение по умолчанию (defaults).
 * onChange(nextRewards) — словарь только заданных значений.
 */
export function RewardEditor({ rewards = {}, defaults, onChange, disabled = false }) {
  const set = (k, raw) => {
    const next = { ...rewards };
    const v = F.cleanReward(raw);
    if (v === null) delete next[k];
    else next[k] = v;
    onChange(next);
  };
  return html`<div class="reward-editor">
    ${F.REWARD_KEYS.map((k) => html`<${RewardField} key=${k} k=${k} value=${rewards?.[k]} def=${defaults[k]} disabled=${disabled}
      onCommit=${(v) => set(k, v)}/>`)}
  </div>`;
}

/** «+1 ✨ опыт · +0,2 🪙 · +0,05 💎» — подпись награды. */
export const rewardLine = (r) => F.REWARD_KEYS.filter((k) => (r?.[k] || 0) > 0)
  .map((k) => `+${fmt(r[k], 'x')} ${F.REWARD_ICONS[k]}`).join(' · ');

/**
 * Число, которое может быть не задано (пусто — по умолчанию, показано подсказкой); 0 — тоже значение.
 * onCommit(число | null).
 */
export function OptNumField({ label, value, placeholder = '', unit = '', disabled = false, onCommit, min = 0, max = 100000 }) {
  const [draft, setDraft] = useState(null);
  const shown = draft ?? (Number.isFinite(value) ? String(value).replace('.', ',') : '');
  const commit = () => {
    if (draft === null) return;
    const raw = draft.trim();
    const n = parseFloat(raw.replace(',', '.').replace(/\s+/g, ''));
    onCommit(raw === '' || !Number.isFinite(n) ? null : Math.max(min, Math.min(max, Math.round(n))));
    setDraft(null);
  };
  return html`<label class="num-field">
    <span class="nf-label">${label}</span>
    <span class="nf-box">
      <input inputmode="numeric" value=${shown} placeholder=${placeholder} disabled=${disabled}
        onInput=${(e) => setDraft(e.target.value)} onBlur=${commit}
        onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }}/>
      ${unit ? html`<small>${unit}</small>` : null}
    </span>
  </label>`;
}
