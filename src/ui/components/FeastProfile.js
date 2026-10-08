// Crimson Harvest (обновление 0.12.2): параметры «Обо мне» и расчёт калорий — общие для экрана «Обо мне» и
// «Настройки → Цели и лимиты». Активности подписаны тем, сколько калорий в день они добавляют к обмену; можно
// создавать свои (название, описание, ккал в день).

import { html, useState } from '../html.js';
import { Icon } from '../icons.js';
import { NumField, OptNumField } from './FeastParts.js';
import { store } from '../../store/appState.js';
import * as FA from '../../store/feastActions.js';
import * as B from '../../core/body.js';

const parseNum = (v) => parseFloat(String(v).replace(',', '.')) || null;

/** Всё, что известно о теле на сегодня: параметры, последние замеры, оценки. */
export function bodyState(today = store.now.today) {
  const s = store.feast.settings || {};
  const logs = [...store.feast.body.values()];
  const last = (k) => B.latest(logs, k, today);
  const weight = last('weightKg');
  const age = B.ageOn(s.birthDate, today);
  const p = {
    sex: s.sex, age, heightCm: s.heightCm, weightKg: weight?.value ?? null, activity: s.activity, activities: s.activities, goal: s.goal,
    waistCm: last('waistCm')?.value ?? null, neckCm: last('neckCm')?.value ?? null, hipCm: last('hipCm')?.value ?? null,
    bodyFatPct: (() => {
      // замер процента жира действует, только если он не старше последнего взвешивания
      const bf = last('bodyFatPct');
      return bf && (!weight || bf.date >= weight.date) ? bf.value : null;
    })(),
  };
  const bmi = B.bmi(p.weightKg, p.heightCm);
  const est = B.estimateBodyFat(p);
  return { s, p, weight, bmi, est, logs };
}

/** Свои активности: список с удалением и форма новой. */
function CustomActivities({ s, ro, base }) {
  const list = B.customActivities(s.activities);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [hint, setHint] = useState('');
  const [kcal, setKcal] = useState('');
  const add = async (e) => {
    e.preventDefault();
    if (await FA.addActivity({ name, hint, kcal })) {
      setName('');
      setHint('');
      setKcal('');
      setOpen(false);
    }
  };
  return html`<div class="custom-activities">
    ${list.length ? html`<ul class="activity-list">${list.map((a) => html`<li key=${a.id}>
      <span><b>${a.name}</b>${a.hint ? html` <span class="muted">— ${a.hint}</span>` : null} <span class="muted">· +${a.kcal} ккал в день</span></span>
      <button type="button" class="icon-btn small" disabled=${ro} aria-label=${'Удалить активность ' + a.name} data-hint="Удалить"
        onClick=${() => FA.removeActivity(a.id)}><${Icon} name="close" size=${16}/></button></li>`)}</ul>` : null}
    ${open ? html`<form class="activity-form" onSubmit=${add}>
      <div class="field-row">
        <label class="field"><span>Название</span><input value=${name} maxlength=${B.ACTIVITY_NAME_MAX} required placeholder="Например, курьер на велосипеде"
          onInput=${(e) => setName(e.target.value)}/></label>
        <label class="field"><span>Ккал в день сверх обмена</span><input inputmode="numeric" value=${kcal} required placeholder=${base ? String(Math.round(base * 0.4)) : '500'}
          onInput=${(e) => setKcal(e.target.value)}/></label>
      </div>
      <label class="field"><span>Описание</span><input value=${hint} maxlength="80" placeholder="необязательно: что за нагрузка"
        onInput=${(e) => setHint(e.target.value)}/></label>
      <p class="muted small">Сколько калорий в день уходит на движение помимо базового обмена${base ? ` (${base} ккал в покое)` : ''}: например,
        «Лёгкая активность» сейчас — +${base ? B.activityBurn(B.ACTIVITY[1], base) : '…'} ккал. Значение — от 0 до ${B.ACTIVITY_KCAL_MAX}.</p>
      <div class="form-actions">
        <button type="button" class="btn ghost" onClick=${() => setOpen(false)}>Отмена</button>
        <button type="submit" class="btn primary" disabled=${ro || !name.trim() || !String(kcal).trim()}>Добавить и выбрать</button>
      </div>
    </form>` : html`<button type="button" class="btn small" disabled=${ro} onClick=${() => setOpen(true)}><${Icon} name="plus" size=${16}/> Своя активность</button>`}
  </div>`;
}

/**
 * Параметры: пол, дата рождения, рост, вес (в настройках — поле «Вес сейчас», пишет замер на сегодня), желаемый вес,
 * активность (с калориями) и свои активности, цель.
 */
export function ProfileCard({ st, ro, withWeight = false }) {
  const s = st.s;
  const set = (c) => FA.updateFeastSettings(c);
  const base = B.bmr(st.p);
  const acts = B.activityList(s.activities);
  const cur = B.activityOf(s.activity, s.activities);
  return html`<section class="set-section profile-card">
    <h2>Параметры</h2>
    <div class="chip-row wrap" role="radiogroup" aria-label="Пол">
      ${B.SEXES.map((x) => html`<button type="button" role="radio" aria-checked=${s.sex === x.key} key=${x.key} disabled=${ro}
        class=${'chip' + (s.sex === x.key ? ' selected' : '')} onClick=${() => set({ sex: x.key })}>${x.label}</button>`)}
    </div>
    <div class="field-row">
      <label class="field"><span>Дата рождения</span><input type="date" value=${s.birthDate || ''} max=${store.now.today} disabled=${ro}
        onChange=${(e) => set({ birthDate: e.target.value || null })}/></label>
      <${NumField} label="Рост" unit="см" value=${s.heightCm} disabled=${ro} onCommit=${(v) => set({ heightCm: parseNum(v) })}/>
      ${withWeight ? html`<${NumField} label="Вес сейчас" unit="кг" value=${st.weight?.value} disabled=${ro}
        onCommit=${(v) => FA.saveBodyLog(store.now.today, { weightKg: v })}/>` : null}
      <${NumField} label="Желаемый вес" unit="кг" value=${s.targetWeightKg} disabled=${ro} onCommit=${(v) => set({ targetWeightKg: parseNum(v) })}/>
    </div>
    ${withWeight && st.weight && st.weight.date !== store.now.today ? html`<p class="muted small">Последнее взвешивание — ${st.weight.date}. Новый вес запишется замером на сегодня.</p>` : null}
    <label class="field"><span>Активность</span>
      <select value=${cur.key} disabled=${ro} onChange=${(e) => set({ activity: e.target.value })}>
        ${acts.map((a) => html`<option key=${a.key} value=${a.key}>${B.activityLabel(a, base)}</option>`)}
      </select></label>
    <p class="muted small">${base
      ? `Базовый обмен — ${base} ккал в покое; активность добавляет к нему столько, сколько указано в пункте. Сейчас: ${base} + ${B.activityBurn(cur, base)} = ${base + B.activityBurn(cur, base)} ккал в день.`
      : 'Калории у активностей появятся, когда будут известны пол, дата рождения, рост и вес (базовый обмен).'}</p>
    <${CustomActivities} s=${s} ro=${ro} base=${base}/>
    <div class="chip-row wrap" role="radiogroup" aria-label="Цель">
      ${B.GOALS.map((g) => html`<button type="button" role="radio" aria-checked=${s.goal === g.key} key=${g.key} disabled=${ro}
        class=${'chip' + (s.goal === g.key ? ' selected' : '')} onClick=${() => set({ goal: g.key })}>${g.label}</button>`)}
    </div>
  </section>`;
}

/**
 * Калории: обмен, расход, рекомендуемый лимит под цель. 0.12: рекомендацию можно настроить — дефицит для
 * похудения, профицит для набора, нижнюю границу — или задать свою целиком.
 */
export function EnergyCard({ st, ro, limitButton = true }) {
  const { s, p } = st;
  const r = B.recommendation(p, s);
  const rec = r.value;
  const base = B.bmr(p);
  const t = B.tdee(p);
  const tuned = r.own != null || s.loseKcal != null || s.gainKcal != null || s.minKcal != null;
  const [open, setOpen] = useState(false);
  const set = (k) => (v) => FA.updateFeastSettings({ [k]: v });
  const goal = B.GOALS.find((g) => g.key === s.goal)?.label.toLowerCase() || 'держать вес';
  return html`<section class="set-section">
    <h2>Калории</h2>
    ${base || r.own ? html`<div class="stat-tiles">
      ${base ? html`<div class="stat-tile"><span>Базовый обмен</span><b>${base}</b><small>ккал в покое</small></div>
      <div class="stat-tile"><span>Расход с активностью</span><b>${t}</b><small>обмен + ${t - base} ккал на движение</small></div>` : null}
      <div class="stat-tile"><span>${r.own ? 'Своя рекомендация' : `Под цель «${goal}»`}</span><b>${rec ?? '—'}</b>
        <small>${r.own && r.auto ? `по расчёту — ${r.auto}` : 'ккал в день'}</small></div>
    </div>
    <div class="form-actions wrap">
      <span class="muted">Сейчас лимит: <b>${s.kcalGoal}</b> ккал</span>
      ${limitButton && rec && rec !== s.kcalGoal ? html`<button type="button" class="btn primary" disabled=${ro} onClick=${() => FA.setKcalGoal(rec)}>Сделать лимитом ${rec}</button>` : null}
      <button type="button" class="btn ghost" aria-expanded=${open} onClick=${() => setOpen(!open)}>
        <${Icon} name=${open ? 'chevronDown' : 'chevron'} size=${16}/> Настроить рекомендацию${tuned ? ' · изменена' : ''}</button>
    </div>` : html`<p class="muted">Укажи пол, дату рождения, рост и вес — посчитаю обмен веществ и лимит калорий под цель.
      Или задай свою рекомендацию: <button type="button" class="link-btn" onClick=${() => setOpen(!open)}>настроить</button>.</p>`}
    ${open ? html`<div class="rec-tune">
      <div class="ne-main">
        <${OptNumField} label="Дефицит для «Похудеть»" unit="ккал" placeholder="500" value=${s.loseKcal} disabled=${ro} max=${2000} onCommit=${set('loseKcal')}/>
        <${OptNumField} label="Профицит для «Набрать»" unit="ккал" placeholder="300" value=${s.gainKcal} disabled=${ro} max=${2000} onCommit=${set('gainKcal')}/>
        <${OptNumField} label="Не ниже" unit="ккал" placeholder=${String(B.defaultFloor(s.sex))} value=${s.minKcal} disabled=${ro} max=${10000} onCommit=${(v) => set('minKcal')(v || null)}/>
        <${OptNumField} label="Своя рекомендация" unit="ккал" placeholder=${r.auto ? String(r.auto) : 'нет расчёта'} value=${s.recKcal} disabled=${ro} max=${10000} onCommit=${(v) => set('recKcal')(v || null)}/>
      </div>
      <p class="muted small">Пустое поле — по умолчанию (−500 для похудения, +300 для набора, не ниже 1500 у мужчин и 1200 у женщин).
        «Своя рекомендация» заменяет расчёт целиком — например, по совету врача или тренера. Лимит в дневнике меняется только кнопкой
        «Сделать лимитом» или в настройках.</p>
      ${tuned ? html`<button type="button" class="btn small" disabled=${ro}
        onClick=${() => FA.updateFeastSettings({ loseKcal: null, gainKcal: null, minKcal: null, recKcal: null })}>Сбросить к расчёту</button>` : null}
    </div>` : null}
  </section>`;
}
