// Crimson Harvest (0.11, «Feast»): «Обо мне» — параметры (пол, дата рождения, рост, активность, цель, желаемый вес),
// замеры (вес, обхваты, процент жира), состав тела с пиксельной фигурой «сейчас» и «при цели», расход калорий
// и рекомендуемый лимит, график веса. 0.12.2: параметры и расчёт — общие с «Настройки → Цели и лимиты»
// (components/FeastProfile.js), здесь же — лимит калорий и БЖУ с кнопкой «Рассчитать».

import { html, useState, useMemo } from '../html.js';
import { Icon } from '../icons.js';
import { LineChart } from '../components/FeastCharts.js';
import { BodyFigure } from '../components/BodyFigure.js';
import { NumField } from '../components/FeastParts.js';
import { bodyState, ProfileCard, EnergyCard } from '../components/FeastProfile.js';
import { FeastGoalsSection } from '../components/FeastSettings.js';
import { Banner } from '../components/Overlays.js';
import { store, confirm } from '../../store/appState.js';
import * as FA from '../../store/feastActions.js';
import * as F from '../../core/feast.js';
import * as B from '../../core/body.js';
import { addDays, longDate } from '../../core/dates.js';
import { SCHEMES, getAppPrefs } from '../prefs.js';

export { bodyState };

const f1 = (v) => (Number.isFinite(v) ? v.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) : '—');


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
      <${ProfileCard} st=${st} ro=${ro}/>
      <${MeasureCard} st=${st} ro=${ro}/>
      <${CompositionCard} st=${st}/>
      <${EnergyCard} st=${st} ro=${ro} limitButton=${false}/>
      <${FeastGoalsSection} st=${st}/>
      <${WeightCard} st=${st}/>
      <${HistoryCard} st=${st} ro=${ro}/>
    </div>`;
}
