// Feast (обновление 0.11): «Обо мне» — параметры (пол, дата рождения, рост, активность, цель, желаемый вес),
// замеры (вес, обхваты, процент жира), состав тела с пиксельной фигурой «сейчас» и «при цели», расход калорий
// и рекомендуемый лимит, график веса. Всё хранится в базе Feast и синхронизируется (DATA_FORMAT §19).

import { html, useState, useMemo } from '../html.js';
import { Icon } from '../icons.js';
import { LineChart } from '../components/FeastCharts.js';
import { BodyFigure } from '../components/BodyFigure.js';
import { NumField, OptNumField } from '../components/FeastParts.js';
import { Banner } from '../components/Overlays.js';
import { store, confirm } from '../../store/appState.js';
import * as FA from '../../store/feastActions.js';
import * as F from '../../core/feast.js';
import * as B from '../../core/body.js';
import { addDays, longDate } from '../../core/dates.js';
import { SCHEMES, getAppPrefs } from '../prefs.js';

const f1 = (v) => (Number.isFinite(v) ? v.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) : '—');

/** Всё, что известно о теле на сегодня: параметры, последние замеры, оценки. */
export function bodyState(today = store.now.today) {
  const s = store.feast.settings || {};
  const logs = [...store.feast.body.values()];
  const last = (k) => B.latest(logs, k, today);
  const weight = last('weightKg');
  const age = B.ageOn(s.birthDate, today);
  const p = {
    sex: s.sex, age, heightCm: s.heightCm, weightKg: weight?.value ?? null, activity: s.activity, goal: s.goal,
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

/** Процент жира на каждый день со взвешиванием (для графика). */
export function bodyFatSeries(st) {
  const { s, logs } = st;
  return B.weightSeries(logs).map(({ date, kg }) => {
    const at = (k) => B.latest(logs, k, date)?.value ?? null;
    const e = B.estimateBodyFat({
      sex: s.sex, age: B.ageOn(s.birthDate, date), heightCm: s.heightCm, weightKg: kg,
      waistCm: at('waistCm'), neckCm: at('neckCm'), hipCm: at('hipCm'),
      bodyFatPct: logs.find((l) => !l.deletedAt && l.date === date && l.bodyFatPct)?.bodyFatPct ?? null,
    });
    return e ? { date, y: Math.round(e.pct * 10) / 10 } : null;
  }).filter(Boolean);
}

function figureColor() {
  const p = getAppPrefs('feast');
  return (SCHEMES[p.scheme] || SCHEMES.crimson).light;
}

/** Шкала процента жира: ступени для пола и отметка. */
export function BodyFatScale({ sex, pct }) {
  const list = B.BF_CLASSES[sex] || B.BF_CLASSES.male;
  const lo = list[0].from;
  const hi = list.at(-1).to;
  const pos = (v) => ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * 100;
  const cur = B.bfClass(sex, pct);
  return html`<div class="bf-scale">
    <div class="bf-track">
      ${list.map((c) => html`<span key=${c.key} class=${'bf-seg bf-' + c.key + (cur?.key === c.key ? ' on' : '')} style=${{ left: pos(c.from) + '%', width: pos(c.to) - pos(c.from) + '%' }}
        title=${`${c.label}: ${c.from}–${c.to} %`}></span>`)}
      ${Number.isFinite(pct) ? html`<i class="bf-mark" style=${{ left: pos(pct) + '%' }} aria-hidden="true"></i>` : null}
    </div>
    <div class="bf-labels">${list.map((c) => html`<span key=${c.key} class=${cur?.key === c.key ? 'on' : ''} style=${{ left: pos((c.from + c.to) / 2) + '%' }}>${c.label}</span>`)}</div>
  </div>`;
}

/** Состав тела: ИМТ, процент жира, фигуры «сейчас» и «при цели». */
export function CompositionCard({ st }) {
  const { s, p, bmi, est } = st;
  const sex = s.sex || 'male';
  const cls = B.bmiClass(bmi);
  const comp = est && p.weightKg ? B.composition(p.weightKg, est.pct) : null;
  let target = null;
  if (s.targetWeightKg && p.heightCm && est) {
    const tb = B.bmi(s.targetWeightKg, p.heightCm);
    // при цели — та же поправка, что и сейчас (замер или обхваты точнее формулы по ИМТ)
    const base = B.bodyFatBmi({ sex, bmi, age: p.age });
    const shift = base != null ? est.pct - base : 0;
    const v = B.bodyFatBmi({ sex, bmi: tb, age: p.age });
    if (v != null) target = Math.max(3, v + shift);
  }
  if (!p.weightKg || !p.heightCm) {
    return html`<section class="set-section"><h2>Состав тела</h2>
      <p class="muted">Укажи рост в параметрах и запиши вес в замерах — здесь появятся ИМТ, процент жира и фигура.</p></section>`;
  }
  return html`<section class="set-section body-comp">
    <h2>Состав тела</h2>
    <div class="stat-tiles">
      <div class="stat-tile"><span>ИМТ</span><b>${f1(bmi)}</b><small class=${'tone-' + (cls?.tone || 'ok')}>${cls?.label || ''}</small></div>
      <div class="stat-tile"><span>Процент жира</span><b>${est ? f1(est.pct) + ' %' : '—'}</b><small>${est ? B.BF_METHOD[est.method] : 'нужны пол и возраст'}</small></div>
      ${comp ? html`<div class="stat-tile"><span>Жир / остальное</span><b>${f1(comp.fatKg)} / ${f1(comp.leanKg)} кг</b><small>при весе ${f1(p.weightKg)} кг</small></div>` : null}
    </div>
    ${est ? html`<${BodyFatScale} sex=${sex} pct=${est.pct}/>` : null}
    ${est ? html`<div class="figures">
      <${BodyFigure} sex=${sex} bf=${est.pct} heightCm=${p.heightCm} accent=${figureColor()} label=${`Сейчас · ${f1(est.pct)} %`}/>
      ${target != null ? html`<${BodyFigure} sex=${sex} bf=${target} heightCm=${p.heightCm} accent=${figureColor()} label=${`При ${f1(s.targetWeightKg)} кг · ≈${f1(target)} %`}/>` : null}
    </div>` : null}
    <p class="muted small">Это оценка для ориентира, а не диагноз. Точнее всего — по обхватам талии и шеи (у женщин и бёдер) или по замеру на весах с анализатором.</p>
  </section>`;
}

function ProfileCard({ s, ro }) {
  const set = (c) => FA.updateFeastSettings(c);
  return html`<section class="set-section">
    <h2>Параметры</h2>
    <div class="chip-row wrap" role="radiogroup" aria-label="Пол">
      ${B.SEXES.map((x) => html`<button type="button" role="radio" aria-checked=${s.sex === x.key} key=${x.key} disabled=${ro}
        class=${'chip' + (s.sex === x.key ? ' selected' : '')} onClick=${() => set({ sex: x.key })}>${x.label}</button>`)}
    </div>
    <div class="field-row">
      <label class="field"><span>Дата рождения</span><input type="date" value=${s.birthDate || ''} max=${store.now.today} disabled=${ro}
        onChange=${(e) => set({ birthDate: e.target.value || null })}/></label>
      <${NumField} label="Рост" unit="см" value=${s.heightCm} disabled=${ro} onCommit=${(v) => set({ heightCm: parseFloat(String(v).replace(',', '.')) || null })}/>
      <${NumField} label="Желаемый вес" unit="кг" value=${s.targetWeightKg} disabled=${ro} onCommit=${(v) => set({ targetWeightKg: parseFloat(String(v).replace(',', '.')) || null })}/>
    </div>
    <label class="field"><span>Активность</span>
      <select value=${s.activity || 'light'} disabled=${ro} onChange=${(e) => set({ activity: e.target.value })}>
        ${B.ACTIVITY.map((a) => html`<option value=${a.key}>${a.label} — ${a.hint}</option>`)}
      </select></label>
    <div class="chip-row wrap" role="radiogroup" aria-label="Цель">
      ${B.GOALS.map((g) => html`<button type="button" role="radio" aria-checked=${s.goal === g.key} key=${g.key} disabled=${ro}
        class=${'chip' + (s.goal === g.key ? ' selected' : '')} onClick=${() => set({ goal: g.key })}>${g.label}</button>`)}
    </div>
  </section>`;
}

function MeasureCard({ st, ro }) {
  const today = store.now.today;
  const [date, setDate] = useState(today);
  const cur = F.bodyLogOn(store.feast, date);
  const female = st.s.sex === 'female';
  const save = (k) => (v) => FA.saveBodyLog(date, { [k]: v });
  return html`<section class="set-section">
    <h2>Замеры</h2>
    <label class="field inline"><span>Дата</span><input type="date" value=${date} max=${today} onChange=${(e) => e.target.value && setDate(e.target.value)}/></label>
    <div class="ne-main measure-grid" key=${date}>
      <${NumField} big label="Вес" unit="кг" value=${cur?.weightKg} disabled=${ro} onCommit=${save('weightKg')}/>
      <${NumField} big label="Талия" unit="см" value=${cur?.waistCm} disabled=${ro} onCommit=${save('waistCm')}/>
      <${NumField} big label="Шея" unit="см" value=${cur?.neckCm} disabled=${ro} onCommit=${save('neckCm')}/>
      ${female || cur?.hipCm ? html`<${NumField} big label="Бёдра" unit="см" value=${cur?.hipCm} disabled=${ro} onCommit=${save('hipCm')}/>` : null}
      <${NumField} big label="Жир (замер)" unit="%" value=${cur?.bodyFatPct} disabled=${ro} onCommit=${save('bodyFatPct')}/>
    </div>
    <p class="muted small">Сохраняется сразу. Талию меряют на уровне пупка, шею — под кадыком${female ? ', бёдра — по самой широкой части' : ''}. «Жир (замер)» — если есть весы с анализатором.</p>
  </section>`;
}

/**
 * Калории: обмен, расход, рекомендуемый лимит под цель. 0.12: рекомендацию можно настроить — дефицит для
 * похудения, профицит для набора, нижнюю границу — или задать свою целиком.
 */
function EnergyCard({ st, ro }) {
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
      <div class="stat-tile"><span>Расход с активностью</span><b>${t}</b><small>держать вес</small></div>` : null}
      <div class="stat-tile"><span>${r.own ? 'Своя рекомендация' : `Под цель «${goal}»`}</span><b>${rec ?? '—'}</b>
        <small>${r.own && r.auto ? `по расчёту — ${r.auto}` : 'ккал в день'}</small></div>
    </div>
    <div class="form-actions wrap">
      <span class="muted">Сейчас лимит: <b>${s.kcalGoal}</b> ккал</span>
      ${rec && rec !== s.kcalGoal ? html`<button type="button" class="btn primary" disabled=${ro} onClick=${() => FA.setKcalGoal(rec)}>Сделать лимитом ${rec}</button>` : null}
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

const PERIODS = [['30', '30 дней'], ['90', '3 месяца'], ['365', 'Год'], ['all', 'Всё время']];

export function WeightCard({ st }) {
  const today = store.now.today;
  const [period, setPeriod] = useState('90');
  const all = B.weightSeries(st.logs);
  const from0 = period === 'all' ? (all[0]?.date || addDays(today, -30)) : addDays(today, -Number(period));
  const pts = all.filter((p) => p.date >= from0);
  // ось — от первого взвешивания периода, без пустого хвоста слева
  const from = pts.length > 1 && pts[0].date > from0 ? pts[0].date : from0;
  const avg = B.movingAverage(all, 7).filter((p) => p.date >= from);
  const rate = B.weeklyRate(all, today);
  const target = st.s.targetWeightKg;
  return html`<section class="set-section">
    <h2>Вес</h2>
    <div class="chip-row wrap">${PERIODS.map(([k, l]) => html`<button type="button" key=${k} class=${'chip' + (period === k ? ' selected' : '')} onClick=${() => setPeriod(k)}>${l}</button>`)}</div>
    ${pts.length ? html`<div class="stat-tiles">
      <div class="stat-tile"><span>Сейчас</span><b>${f1(pts.at(-1).kg)} кг</b><small>${longDate(pts.at(-1).date, today)}</small></div>
      <div class="stat-tile"><span>За период</span><b>${pts.length > 1 ? (pts.at(-1).kg - pts[0].kg >= 0 ? '+' : '−') + f1(Math.abs(pts.at(-1).kg - pts[0].kg)) + ' кг' : '—'}</b><small>с ${f1(pts[0].kg)} кг</small></div>
      <div class="stat-tile"><span>Темп</span><b>${rate != null ? (rate >= 0 ? '+' : '−') + f1(Math.abs(rate)) + ' кг' : '—'}</b><small>в неделю, за 4 недели</small></div>
      ${target ? html`<div class="stat-tile"><span>До цели</span><b>${f1(Math.abs(pts.at(-1).kg - target))} кг</b><small>цель ${f1(target)} кг</small></div>` : null}
    </div>` : null}
    <${LineChart} label="Вес по дням" unit="кг" from=${from} to=${today}
      lines=${[
        { key: 'w', label: 'Взвешивания', color: 'var(--series-1)', points: pts.map((p) => ({ date: p.date, y: p.kg })), line: pts.length > 1 && avg.length < 2 },
        ...(avg.length > 1 ? [{ key: 'a', label: 'Среднее за 7 дней', color: 'var(--series-2)', points: avg.map((p) => ({ date: p.date, y: Math.round(p.kg * 10) / 10 })), dots: false }] : []),
      ]}
      refs=${target ? [{ y: target, label: `цель ${f1(target)} кг` }] : []}/>
  </section>`;
}

function HistoryCard({ st, ro }) {
  const logs = F.liveBodyLogs(store.feast).slice(0, 60);
  if (!logs.length) return null;
  return html`<section class="set-section">
    <h2>История замеров</h2>
    <div class="fchart-table"><table>
      <thead><tr><th>Дата</th><th class="num">Вес</th><th class="num">Талия</th><th class="num">Шея</th><th class="num">Бёдра</th><th class="num">Жир</th><th></th></tr></thead>
      <tbody>${logs.map((l) => html`<tr key=${l.id}>
        <td>${longDate(l.date, store.now.today)} ${l.date.slice(0, 4)}</td>
        <td class="num">${l.weightKg ? f1(l.weightKg) : '—'}</td><td class="num">${l.waistCm ? f1(l.waistCm) : '—'}</td>
        <td class="num">${l.neckCm ? f1(l.neckCm) : '—'}</td><td class="num">${l.hipCm ? f1(l.hipCm) : '—'}</td>
        <td class="num">${l.bodyFatPct ? f1(l.bodyFatPct) + ' %' : '—'}</td>
        <td><button type="button" class="icon-btn small danger" disabled=${ro} aria-label="Удалить замер" title="Удалить замер"
          onClick=${async () => { if (await confirm({ title: 'Удалить замер?', text: longDate(l.date) + ' ' + l.date.slice(0, 4), confirmLabel: 'Удалить', danger: true })) FA.deleteBodyLog(l.id); }}>
          <${Icon} name="trash" size=${16}/></button></td>
      </tr>`)}</tbody>
    </table></div>
  </section>`;
}

export function BodyScreen() {
  const st = useMemo(() => bodyState(), [store.version, store.now.today]);
  const ro = !!store.ui.feastReadOnly;
  return html`
    <div class="screen body-screen">
      ${store.ui.feastReadOnly ? html`<${Banner} tone="danger">${store.ui.feastReadOnly}<//>` : null}
      <${ProfileCard} s=${st.s} ro=${ro}/>
      <${MeasureCard} st=${st} ro=${ro}/>
      <${CompositionCard} st=${st}/>
      <${EnergyCard} st=${st} ro=${ro}/>
      <${WeightCard} st=${st}/>
      <${HistoryCard} st=${st} ro=${ro}/>
    </div>`;
}
