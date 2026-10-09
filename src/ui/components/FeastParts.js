// Общие кусочки экранов Feast (обновление 0.11): сводка дня, полоски БЖУ, ввод пищевой ценности, приёмы пищи.

import { html, useState } from '../html.js';
import { Icon } from '../icons.js';
import { store } from '../../store/appState.js';
import { getPrefs } from '../prefs.js';
import * as F from '../../core/feast.js';
import {
  NUTRIENTS, NUTRIENT, NUTRIENT_GROUPS, MACROS, nv, fmt, dayGoals, remaining, signed, rdiPct, kcalFromMacros, macroSplit, kcalCheck, num,
} from '../../core/nutrition.js';
import { tr, dec } from '../../core/i18n.js';

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
          <span class="sum-left-label">${over ? tr('Сверх лимита') : tr('Осталось')}</span>
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
  const shown = draft ?? (value ? dec(value) : '');
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
export function NutrientEditor({ nutrients, unit = 'g', onChange, disabled = false, open = false, per = null }) {
  const [shown, setShown] = useState(open);
  // 0.14: калории не указаны (или уже посчитаны по БЖУ) — пересчитываются сами при вводе белков, жиров, углеводов
  const macrosOf = (n) => Object.fromEntries(MACROS.map((k) => [k, num(n[k])]));
  const set = (key, raw) => {
    const next = { ...nutrients, [key]: raw };
    const auto = !num(nutrients.kcal) || num(nutrients.kcal) === kcalFromMacros(macrosOf(nutrients));
    if (MACROS.includes(key) && auto) next.kcal = kcalFromMacros(macrosOf(next)) || nutrients.kcal || 0;
    onChange(next);
  };
  const check = kcalCheck(Object.fromEntries(['kcal', 'fiber', ...MACROS].map((k) => [k, num(nutrients[k])])));
  const base = per || (unit === 'ml' ? tr('100 мл') : tr('100 г'));
  return html`<div class="nutrient-editor">
    <div class="ne-main">
      ${['kcal', ...MACROS].map((k) => html`<${NumField} key=${k} big label=${NUTRIENT[k].label} unit=${NUTRIENT[k].unit}
        value=${nv(nutrients, k)} disabled=${disabled} onCommit=${(v) => set(k, v)}/>`)}
    </div>
    <p class="hint">Значения на ${base}.</p>
    <${KcalCheck} check=${check} disabled=${disabled} onFix=${() => onChange({ ...nutrients, kcal: check.auto })}/>
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
      class=${'chip' + (value === m.id ? ' selected' : '')} onClick=${() => onChange(m.id)}>${m.icon} ${F.mealName(m)}${m.time ? html` <small>${m.time}</small>` : null}</button>`)}
  </div>`;
}

/** Поле награды: своё значение (и 0 — тоже значение) или пусто — по умолчанию (показано подсказкой). */
function RewardField({ k, value, def, disabled, onCommit }) {
  const [draft, setDraft] = useState(null);
  const shown = draft ?? (value === undefined || value === null ? '' : dec(value));
  const commit = () => {
    if (draft === null) return;
    onCommit(draft);
    setDraft(null);
  };
  return html`<label class="num-field reward-field">
    <span class="nf-label">${F.REWARD_ICONS[k]} ${F.REWARD_LABELS[k]}</span>
    <span class="nf-box">
      <input inputmode="decimal" value=${shown} placeholder=${dec(def)} disabled=${disabled}
        aria-label=${F.REWARD_LABELS[k] + tr(' за запись')} onInput=${(e) => setDraft(e.target.value)} onBlur=${commit}
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
  const shown = draft ?? (Number.isFinite(value) ? dec(value) : '');
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

/**
 * Проверка калорий по БЖУ (0.14): сходится — ✓; не сходится — ⚠ и «Посчитать по БЖУ»; есть только калории — просьба
 * указать белки, жиры и углеводы. Статус — словами и значком, не только цветом.
 */
export function KcalCheck({ check, onFix, disabled = false }) {
  const { state, kcal, auto } = check;
  if (state === 'empty') return null;
  if (state === 'ok') return html`<p class="kcal-check ok" role="status">✓ ${tr('Калории сходятся с БЖУ (по БЖУ — {auto} ккал).', { auto })}</p>`;
  if (state === 'noMacros') return html`<p class="kcal-check warn" role="status">⚠ ${tr('Укажи белки, жиры и углеводы — по ним проверяются калории.')}</p>`;
  if (state === 'noKcal') {
    return html`<p class="kcal-check warn" role="status">⚠ ${tr('Калории не указаны, по БЖУ выходит {auto} ккал.', { auto })}
      <button type="button" class="link-btn" disabled=${disabled} onClick=${onFix}>${tr('Подставить')}</button></p>`;
  }
  return html`<p class="kcal-check warn" role="status">⚠ ${state === 'low'
    ? tr('Калорий указано {kcal}, а по БЖУ выходит {auto} — проверь цифры на упаковке.', { kcal: fmt(kcal, 'kcal'), auto })
    : tr('Калорий указано {kcal}, а по БЖУ выходит {auto} — проверь цифры (больше бывает у продуктов с алкоголем).', { kcal: fmt(kcal, 'kcal'), auto })}
    <button type="button" class="link-btn" disabled=${disabled} onClick=${onFix}>${tr('Посчитать калории по БЖУ')}</button></p>`;
}

/** Значки для лекарств и замеров (0.14): разные шприцы, таблетки и витамины различаются с одного взгляда. */
export const ICON_CHOICES = ['💊', '💉', '🩸', '🧴', '🍯', '🧪', '💧', '🌿', '🍋', '🐟', '☀️', '🌙', '🩹', '🫀', '🫁', '🦴',
  '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '🟤', '⚫', '⚪', '❤️', '💛', '💚', '💙', '💜', '🌡️', '📏'];

/** Выбор значка: свой (любой эмодзи) или из готовых; пусто — по умолчанию (fallback). */
export function IconPicker({ value = '', onChange, disabled = false, fallback = '💊', label = tr('Значок') }) {
  const [draft, setDraft] = useState(null);
  const shown = draft ?? value ?? '';
  const commit = () => {
    if (draft === null) return;
    onChange(draft.trim());
    setDraft(null);
  };
  const first = [...String(value || '')][0] || '';
  return html`<div class="field icon-picker">
    <span>${label}</span>
    <div class="emoji-row">
      <span class="ip-current" aria-hidden="true">${value || fallback}</span>
      <input class="emoji-input" value=${shown} maxLength="8" placeholder=${fallback} aria-label=${label} disabled=${disabled}
        onInput=${(e) => setDraft(e.target.value)} onBlur=${commit} onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }}/>
      ${value ? html`<button type="button" class="link-btn" disabled=${disabled} onClick=${() => onChange('')}>${tr('По умолчанию')}</button>` : null}
    </div>
    <div class="emoji-grid">
      ${ICON_CHOICES.map((x) => html`<button type="button" key=${x} class=${'emoji-btn' + (first === [...x][0] && value === x ? ' selected' : '')} disabled=${disabled}
        aria-label=${x} onClick=${() => onChange(x)}>${x}</button>`)}
    </div>
  </div>`;
}

/**
 * Как показывать продукты в записи (0.14.2, Настройки → Дневник и хранение, только это устройство): grouped — замеры
 * сверху, еда посередине, лекарства снизу (по умолчанию да); names — длинные названия «clip» (сколько помещается) или
 * «wrap» (с переносом).
 */
export function itemDisplay() {
  const p = getPrefs().feastItems || {};
  return { grouped: p.grouped !== false, wrap: p.names === 'wrap' };
}
