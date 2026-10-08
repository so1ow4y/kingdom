// Feast (обновление 0.11): «Аналитика» — вкладка «Питание»: калории по дням с лимитом, средние за день, дни
// сверх лимита, доли БЖУ, витамины и минералы от нормы, топ продуктов (учитываются и сводки дней, удалённых
// лимитом); вкладка «Тело»: процент жира во времени, фигура, вес.

import { html, useState, useMemo } from '../html.js';
import { CalorieChart, LineChart, MacroSplitBar } from '../components/FeastCharts.js';
import { MACRO_COLOR, Meter, feastGoals } from '../components/FeastParts.js';
import { bodyState, bodyFatSeries, CompositionCard, WeightCard } from './Body.js';
import { navigate } from '../router.js';
import { readLocal, writeLocal } from '../hooks.js';
import { store } from '../../store/appState.js';
import * as F from '../../core/feast.js';
import { NUTRIENTS, NUTRIENT, MACROS, nv, fmt, rdiPct } from '../../core/nutrition.js';
import { addDays } from '../../core/dates.js';
import { countLabel } from '../../core/plural.js';

const PERIODS = [['7', '7 дней'], ['30', '30 дней'], ['90', '3 месяца'], ['365', 'Год'], ['all', 'Всё время']];
const num = (v) => Math.round(v).toLocaleString('ru-RU');

function FoodTop({ title, list, value }) {
  if (!list.length) return null;
  const max = Math.max(1, ...list.map(value));
  return html`<div class="ex-card">
    <p class="ex-facet-title">${title}</p>
    <ul class="ex-facet-list">${list.map((f) => html`<li key=${f.key} class="ex-facet">
      <span class="ex-facet-bar" style=${{ width: (value(f) / max) * 100 + '%' }}></span>
      <span class="ex-facet-value static" title=${f.name}>${f.name}</span>
      <span class="ex-facet-count">${title.includes('калор') ? num(f.kcal) + ' ккал' : countLabel(f.count, ['раз', 'раза', 'раз'])}</span>
    </li>`)}</ul>
  </div>`;
}

function FoodTab() {
  const today = store.now.today;
  const [period, setPeriodState] = useState(() => readLocal('feastPeriod', '30'));
  const setPeriod = (p) => {
    setPeriodState(p);
    writeLocal('feastPeriod', p);
  };
  const goals = feastGoals();
  const first = F.firstDay(store.feast);
  const from = period === 'all' ? first || addDays(today, -6) : addDays(today, -(Number(period) - 1));
  const st = useMemo(() => F.periodStats(store.feast, from, today, goals.kcal), [store.version, from, today, goals.kcal]);
  const micro = NUTRIENTS.filter((n) => ['vitamins', 'minerals', 'more'].includes(n.group) && n.rdi);
  const anyMicro = micro.some((n) => nv(st.avg, n.key) > 0);
  return html`
    <div class="chip-row wrap" role="tablist" aria-label="Период">
      ${PERIODS.map(([k, l]) => html`<button type="button" role="tab" aria-selected=${period === k} key=${k} class=${'chip' + (period === k ? ' selected' : '')} onClick=${() => setPeriod(k)}>${l}</button>`)}
    </div>
    ${!st.logged ? html`<div class="card-block"><p class="muted">За этот период записей нет. Записывай еду в «Дневнике» — здесь появятся графики.</p>
      <button type="button" class="btn primary" onClick=${() => navigate('/diary')}>Открыть дневник</button></div>` : html`
      <div class="stat-tiles">
        <div class="stat-tile"><span>В среднем за день</span><b>${num(st.avg.kcal)}</b><small>ккал при лимите ${num(goals.kcal)}</small></div>
        <div class="stat-tile"><span>Дней с записями</span><b>${st.logged}</b><small>из ${st.days}</small></div>
        <div class="stat-tile"><span>Сверх лимита</span><b>${st.over ? '⚠ ' + st.over : '0'}</b><small>${countLabel(st.over, ['день', 'дня', 'дней'])}</small></div>
        <div class="stat-tile"><span>Записей</span><b>${num(st.entries)}</b><small>за период</small></div>
      </div>
      <section class="card-block">
        <h2 class="block-title">Калории по ${st.days > 92 ? 'неделям' : 'дням'}</h2>
        <${CalorieChart} series=${st.series} from=${from} to=${today} goal=${goals.kcal}/>
      </section>
      <section class="card-block">
        <h2 class="block-title">Белки, жиры, углеводы — в среднем за день</h2>
        <${MacroSplitBar} values=${st.avg} colors=${MACRO_COLOR} labels=${Object.fromEntries(MACROS.map((k) => [k, NUTRIENT[k].label]))}/>
        <div class="macro-goals">${MACROS.map((k) => html`<div key=${k} class="nt-row">
          <span>${NUTRIENT[k].label}</span><b>${fmt(nv(st.avg, k), k)} <small>из ${goals[k]} г</small></b>
          <${Meter} value=${nv(st.avg, k)} max=${goals[k]} color=${MACRO_COLOR[k]} label=${NUTRIENT[k].label}/></div>`)}</div>
      </section>
      <section class="card-block">
        <h2 class="block-title">Витамины и минералы — в среднем за день, от нормы</h2>
        ${anyMicro ? html`<div class="micro-list">${micro.map((n) => {
          const v = nv(st.avg, n.key);
          const p = rdiPct(v, n.key) || 0;
          return html`<div class="nt-row" key=${n.key}><span>${n.label}</span>
            <b>${fmt(v, n.key)} <small>${n.unit}</small></b>
            <span class="micro-meter"><${Meter} value=${p} max=${100} color="var(--series-1)" label=${n.label}/><small>${Math.round(p)} %</small></span></div>`;
        })}</div>` : html`<p class="muted small">У продуктов пока не указаны витамины и минералы — заполни их в карточках, и здесь появятся проценты от нормы.</p>`}
      </section>
      <div class="foods-tops">
        <${FoodTop} title="Больше всего калорий дали" list=${st.topByKcal} value=${(f) => f.kcal}/>
        <${FoodTop} title="Чаще всего в дневнике" list=${st.topByCount} value=${(f) => f.count}/>
      </div>`}`;
}

function BodyTab() {
  const st = useMemo(() => bodyState(), [store.version, store.now.today]);
  const bf = bodyFatSeries(st);
  const today = store.now.today;
  return html`
    <${CompositionCard} st=${st}/>
    <section class="set-section">
      <h2>Процент жира во времени</h2>
      ${bf.length ? html`<${LineChart} label="Процент жира по дням" unit="%" from=${bf[0].date < addDays(today, -7) ? bf[0].date : addDays(today, -7)} to=${today}
        lines=${[{ key: 'bf', label: 'Процент жира', color: 'var(--series-1)', points: bf }]}/>`
        : html`<p class="muted">Для графика нужны пол, дата рождения, рост и хотя бы одно взвешивание в «Обо мне».</p>`}
      <p class="muted small">Считается на каждый день со взвешиванием: по замеру, по обхватам (если они есть) или по росту, весу и возрасту.</p>
      <button type="button" class="link-btn" onClick=${() => navigate('/body')}>Открыть «Обо мне»</button>
    </section>
    <${WeightCard} st=${st}/>`;
}

export function NutritionScreen() {
  const [tab, setTabState] = useState(() => readLocal('feastAnalyticsTab', 'food'));
  const setTab = (t) => {
    setTabState(t);
    writeLocal('feastAnalyticsTab', t);
  };
  return html`
    <div class="screen nutrition">
      <div class="section-tabs" role="tablist" aria-label="Аналитика">
        ${[['food', 'Питание', 'food'], ['body', 'Тело', 'body']].map(([k, l]) => html`<button type="button" role="tab" key=${k} aria-selected=${tab === k}
          class=${'section-tab' + (tab === k ? ' active' : '')} onClick=${() => setTab(k)}>${l}</button>`)}
      </div>
      ${tab === 'food' ? html`<${FoodTab}/>` : html`<${BodyTab}/>`}
    </div>`;
}
