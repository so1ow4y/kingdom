// Feast (обновление 0.11): «Аналитика» — вкладка «Питание»: калории по дням с лимитом, средние за день, дни
// сверх лимита, доли БЖУ, витамины и минералы от нормы, топ продуктов (учитываются и сводки дней, удалённых
// лимитом); вкладка «Тело»: процент жира во времени, фигура, вес. 0.12.5: вкладка «Лекарства» — приёмы по дням,
// по каждому лекарству (сколько раз, сколько всего, последний приём) и журнал приёмов. Вкладка — в адресе
// (#/nutrition, #/nutrition/meds, #/nutrition/body), в доке «Аналитика» — ветка из трёх пунктов.

import { html, useState, useMemo } from '../html.js';
import { CalorieChart, LineChart, MacroSplitBar, DayBars } from '../components/FeastCharts.js';
import { openAddFood } from '../components/AddFood.js';
import { MACRO_COLOR, Meter, feastGoals } from '../components/FeastParts.js';
import { bodyState, bodyFatSeries, CompositionCard, WeightCard } from './Body.js';
import { navigate } from '../router.js';
import { readLocal, writeLocal } from '../hooks.js';
import { store, openSheet } from '../../store/appState.js';
import * as F from '../../core/feast.js';
import { NUTRIENTS, NUTRIENT, MACROS, nv, fmt, rdiPct, amountLabel } from '../../core/nutrition.js';
import { addDays, longDate, humanDate, daysBetween } from '../../core/dates.js';
import { countLabel } from '../../core/plural.js';
import { tr } from '../../core/i18n.js';

const PERIODS = [['7', tr('7 дней')], ['30', tr('30 дней')], ['90', tr('3 месяца')], ['365', tr('Год')], ['all', tr('Всё время')]];
const num = (v) => Math.round(v).toLocaleString('ru-RU');

function FoodTop({ title, list, value }) {
  if (!list.length) return null;
  const max = Math.max(1, ...list.map(value));
  return html`<div class="ex-card">
    <p class="ex-facet-title">${title}</p>
    <ul class="ex-facet-list">${list.map((f) => html`<li key=${f.key} class="ex-facet">
      <span class="ex-facet-bar" style=${{ width: (value(f) / max) * 100 + '%' }}></span>
      <span class="ex-facet-value static" title=${f.name}>${f.name}</span>
      <span class="ex-facet-count">${title.includes('калор') ? num(f.kcal) + tr(' ккал') : countLabel(f.count, ['раз', 'раза', 'раз'])}</span>
    </li>`)}</ul>
  </div>`;
}

/** Период аналитики (общий для «Питания» и «Лекарств», запоминается на устройстве). */
function usePeriod() {
  const today = store.now.today;
  const [period, setPeriodState] = useState(() => readLocal('feastPeriod', '30'));
  const setPeriod = (p) => {
    setPeriodState(p);
    writeLocal('feastPeriod', p);
  };
  const first = F.firstDay(store.feast);
  const from = period === 'all' ? first || addDays(today, -6) : addDays(today, -(Number(period) - 1));
  return { period, setPeriod, from, today };
}

function PeriodChips({ period, setPeriod }) {
  return html`<div class="chip-row wrap" role="tablist" aria-label="Период">
    ${PERIODS.map(([k, l]) => html`<button type="button" role="tab" aria-selected=${period === k} key=${k} class=${'chip' + (period === k ? ' selected' : '')} onClick=${() => setPeriod(k)}>${l}</button>`)}
  </div>`;
}

function FoodTab() {
  const { period, setPeriod, from, today } = usePeriod();
  const goals = feastGoals();
  const st = useMemo(() => F.periodStats(store.feast, from, today, goals.kcal), [store.version, from, today, goals.kcal]);
  const micro = NUTRIENTS.filter((n) => ['vitamins', 'minerals', 'more'].includes(n.group) && n.rdi);
  const anyMicro = micro.some((n) => nv(st.avg, n.key) > 0);
  return html`
    <${PeriodChips} period=${period} setPeriod=${setPeriod}/>
    ${!st.logged ? html`<div class="card-block"><p class="muted">За этот период записей нет. Записывай еду в «Дневнике» — здесь появятся графики.</p>
      <button type="button" class="btn primary" onClick=${() => navigate('/diary')}>Открыть дневник</button></div>` : html`
      <div class="stat-tiles">
        <div class="stat-tile"><span>В среднем за день</span><b>${num(st.avg.kcal)}</b><small>ккал при лимите ${num(goals.kcal)}</small></div>
        <div class="stat-tile"><span>Дней с записями</span><b>${st.logged}</b><small>из ${st.days}</small></div>
        <div class="stat-tile"><span>Сверх лимита</span><b>${st.over ? '⚠ ' + st.over : '0'}</b><small>${countLabel(st.over, ['день', 'дня', 'дней'])}</small></div>
        <div class="stat-tile"><span>Записей</span><b>${num(st.entries)}</b><small>за период</small></div>
      </div>
      <section class="card-block">
        <h2 class="block-title">Калории по ${st.days > 92 ? tr('неделям') : tr('дням')}</h2>
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

const timesLabel = (n) => countLabel(n, ['приём', 'приёма', 'приёмов']);
const whenLabel = (last, today) => {
  const [d, t] = last.split(' ');
  return d ? `${humanDate(d, today)}${t ? tr(' в ') + t : ''}` : '—';
};

/** Вкладка «Лекарства»: приёмы за период — всего, по каждому лекарству, по дням и журналом. */
function MedsTab() {
  const { period, setPeriod, from, today } = usePeriod();
  const [pick, setPick] = useState('all');
  const st = useMemo(() => F.medStats(store.feast, from, today), [store.version, from, today]);
  const catalog = [...store.feast.foods.values()].filter((f) => !f.deletedAt && F.isMed(f));
  const span = daysBetween(from, today) + 1;
  const sel = st.meds.find((m) => m.key === pick) || null;
  const points = sel ? sel.days.map((d) => ({ date: d.date, value: d.count }))
    : [...st.meds.flatMap((m) => m.days).reduce((acc, d) => acc.set(d.date, (acc.get(d.date) || 0) + d.count), new Map())].map(([date, value]) => ({ date, value }));
  const log = (sel ? st.log.filter((l) => l.key === sel.key) : st.log).slice(0, 60);
  const byDay = [];
  for (const l of log) {
    const last = byDay.at(-1);
    if (last?.date === l.date) last.items.push(l);
    else byDay.push({ date: l.date, items: [l] });
  }
  const max = Math.max(1, ...st.meds.map((m) => m.count));
  return html`
    <${PeriodChips} period=${period} setPeriod=${setPeriod}/>
    <div class="page-actions meds-actions">
      <button type="button" class="btn primary" disabled=${!!store.ui.feastReadOnly} onClick=${() => openAddFood({ kind: 'med' })}>💊 Записать приём</button>
      <button type="button" class="btn" onClick=${() => navigate('/foods?kind=med')}>Все лекарства${catalog.length ? ` (${catalog.length})` : ''}</button>
    </div>
    ${!st.intakes ? html`<div class="card-block"><p class="muted">${catalog.length
      ? tr('За этот период приёмов нет. Записывай лекарства в «Дневнике» — отдельно или вместе с едой, — и здесь появится статистика.')
      : tr('Лекарств пока нет. Создай лекарство в «Продуктах и лекарствах» или прямо при записи — и отмечай приёмы в «Дневнике».')}</p></div>` : html`
      <div class="stat-tiles">
        <div class="stat-tile"><span>Приёмов</span><b>${num(st.intakes)}</b><small>за период</small></div>
        <div class="stat-tile"><span>Дней с приёмами</span><b>${st.days}</b><small>из ${span}</small></div>
        <div class="stat-tile"><span>Лекарств</span><b>${st.meds.length}</b><small>принимались</small></div>
        <div class="stat-tile"><span>Последний приём</span><b class="tile-text">${st.log[0] ? whenLabel(st.log[0].date + ' ' + (st.log[0].time || ''), today) : '—'}</b>
          <small>${st.log[0]?.name || ''}</small></div>
      </div>
      <section class="card-block">
        <h2 class="block-title">Приёмы по ${span > 92 ? tr('неделям') : tr('дням')}</h2>
        ${st.meds.length > 1 ? html`<div class="chip-row wrap" role="tablist" aria-label="Лекарство">
          <button type="button" role="tab" aria-selected=${!sel} class=${'chip' + (!sel ? ' selected' : '')} onClick=${() => setPick('all')}>Все</button>
          ${st.meds.map((m) => html`<button type="button" role="tab" key=${m.key} aria-selected=${sel?.key === m.key} class=${'chip' + (sel?.key === m.key ? ' selected' : '')}
            onClick=${() => setPick(m.key)}>💊 ${m.name}</button>`)}
        </div>` : null}
        <${DayBars} points=${points} from=${from} to=${today} label=${tr('Приёмы ') + (sel ? sel.name : tr('лекарств')) + tr(' по дням')} unitLabel=${timesLabel}/>
      </section>
      <section class="card-block">
        <h2 class="block-title">По лекарствам</h2>
        <ul class="med-stats">${st.meds.map((m) => html`<li key=${m.key} class="ex-facet med-stat">
          <span class="ex-facet-bar" style=${{ width: (m.count / max) * 100 + '%' }}></span>
          <span class="ms-name">💊 ${m.name}</span>
          <span class="ms-meta">${timesLabel(m.count)} · всего ${amountLabel({ amount: m.amount, unit: m.unit })} · дней ${m.days.length} из ${span}
            · в среднем ${amountLabel({ amount: Math.round((m.amount / Math.max(1, m.days.length)) * 100) / 100, unit: m.unit })} в день приёма
            · последний: ${whenLabel(m.last, today).toLowerCase()}</span>
        </li>`)}</ul>
      </section>
      <section class="card-block">
        <h2 class="block-title">Журнал приёмов${sel ? ' · ' + sel.name : ''}</h2>
        ${byDay.length ? byDay.map((d) => html`<div class="med-log-day" key=${d.date}>
          <p class="med-log-date">${humanDate(d.date, today)}${d.date !== today && d.date !== addDays(today, -1) ? '' : ' · ' + longDate(d.date)}</p>
          ${d.items.map((l, i) => html`<button type="button" class="med-log-row" key=${l.entryId + i} onClick=${() => openSheet('entry', { id: l.entryId })}>
            <span class="er-time">${l.time || '—'}</span>
            <span class="er-main"><span class="er-name">💊 ${l.name} · ${amountLabel(l)}</span>
              ${l.foods.length ? html`<small class="muted">вместе с: ${l.foods.join(', ')}</small>` : null}
              ${l.note ? html`<small class="er-item-note">${l.note}</small>` : null}</span>
          </button>`)}
        </div>`) : html`<p class="muted small">В журнале — только дни, которые ещё хранятся в дневнике (старые сводятся в итоги дня).</p>`}
        ${(sel ? st.log.filter((l) => l.key === sel.key) : st.log).length > log.length ? html`<p class="muted small">Показаны последние ${log.length}.</p>` : null}
      </section>`}`;
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
        lines=${[{ key: 'bf', label: tr('Процент жира'), color: 'var(--series-1)', points: bf }]}/>`
        : html`<p class="muted">Для графика нужны пол, дата рождения, рост и хотя бы одно взвешивание в «Обо мне».</p>`}
      <p class="muted small">Считается на каждый день со взвешиванием: по замеру, по обхватам (если они есть) или по росту, весу и возрасту.</p>
      <button type="button" class="link-btn" onClick=${() => navigate('/body')}>Открыть «Обо мне»</button>
    </section>
    <${WeightCard} st=${st}/>`;
}

export const ANALYTICS_TABS = [['food', tr('Питание'), '/nutrition'], ['meds', tr('Лекарства'), '/nutrition/meds'], ['body', tr('Тело'), '/nutrition/body']];

export function NutritionScreen({ tab: param = null }) {
  const tab = ['meds', 'body'].includes(param) ? param : 'food';
  return html`
    <div class="screen nutrition">
      <div class="section-tabs" role="tablist" aria-label="Аналитика">
        ${ANALYTICS_TABS.map(([k, l, to]) => html`<button type="button" role="tab" key=${k} aria-selected=${tab === k}
          class=${'section-tab' + (tab === k ? ' active' : '')} onClick=${() => navigate(to, { replace: true })}>${l}</button>`)}
      </div>
      ${tab === 'food' ? html`<${FoodTab}/>` : tab === 'meds' ? html`<${MedsTab}/>` : html`<${BodyTab}/>`}
    </div>`;
}
