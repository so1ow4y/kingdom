// Feast (обновление 0.11): «Аналитика» — вкладка «Питание»: калории по дням с лимитом, средние за день, дни
// сверх лимита, доли БЖУ, витамины и минералы от нормы, топ продуктов (учитываются и сводки дней, удалённых
// лимитом); вкладка «Тело»: процент жира во времени, фигура, вес. 0.12.5: вкладка «Лекарства» — приёмы по дням,
// по каждому лекарству (сколько раз, сколько всего, последний приём) и журнал приёмов. Вкладка — в адресе
// (#/nutrition, #/nutrition/meds, #/nutrition/body), в доке «Аналитика» — ветка из трёх пунктов.
// 0.13: у лекарств — группировка (дни, месяцы, часы суток, годы), приёмы или количество, все лекарства на одном графике
// (у количества — одной единицы); вкладка «Замеры» (#/nutrition/measures) — показания с нормой и журнал.

import { html, useState, useMemo } from '../html.js';
import { CalorieChart, LineChart, MacroSplitBar, StackedBars, ReadingsChart, ReadingBucketsChart, SERIES } from '../components/FeastCharts.js';
import { openAddFood } from '../components/AddFood.js';
import { TimeWindow, windowLabel, regroupAnchor } from '../components/TimeWindow.js';
import * as TW from '../../core/timeWindow.js';
import { MACRO_COLOR, Meter, feastGoals } from '../components/FeastParts.js';
import { FeastHistorySection } from '../components/FeastSettings.js';
import { bodyState, bodyFatSeries, CompositionCard, WeightCard } from './Body.js';
import { navigate } from '../router.js';
import { readLocal, writeLocal } from '../hooks.js';
import { store, openSheet } from '../../store/appState.js';
import * as F from '../../core/feast.js';
import { NUTRIENTS, NUTRIENT, MACROS, nv, fmt, rdiPct, amountLabel, MED_UNIT } from '../../core/nutrition.js';
import * as M from '../../core/measures.js';
import { addDays, longDate, humanDate, daysBetween } from '../../core/dates.js';
import { countLabel } from '../../core/plural.js';
import { tr, locale, dec } from '../../core/i18n.js';

const PERIODS = [['7', tr('7 дней')], ['30', tr('30 дней')], ['90', tr('3 месяца')], ['365', tr('Год')], ['all', tr('Всё время')]];
const num = (v) => Math.round(v).toLocaleString(locale());

function FoodTop({ title, list, value, kcal = false }) {
  if (!list.length) return null;
  const max = Math.max(1, ...list.map(value));
  return html`<div class="ex-card">
    <p class="ex-facet-title">${title}</p>
    <ul class="ex-facet-list">${list.map((f) => html`<li key=${f.key} class="ex-facet">
      <span class="ex-facet-bar" style=${{ width: (value(f) / max) * 100 + '%' }}></span>
      <span class="ex-facet-value static" title=${f.name}>${f.name}</span>
      <span class="ex-facet-count">${kcal ? num(f.kcal) + tr(' ккал') : countLabel(f.count, ['раз', 'раза', 'раз'])}</span>
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
        <${FoodTop} kcal title="Больше всего калорий дали" list=${st.topByKcal} value=${(f) => f.kcal}/>
        <${FoodTop} title="Чаще всего в дневнике" list=${st.topByCount} value=${(f) => f.count}/>
      </div>`}
    <${FeastHistorySection}/>`;
}

const timesLabel = (n) => countLabel(n, ['приём', 'приёма', 'приёмов']);
const whenLabel = (last, today) => {
  const [d, t] = last.split(' ');
  return d ? `${humanDate(d, today)}${t ? tr(' в ') + t : ''}` : '—';
};
const unitShort = (u) => MED_UNIT[u]?.short || u || '';
const GROUPS = [['hour', tr('По часам')], ['day', tr('По дням')], ['month', tr('По месяцам')], ['year', tr('По годам')]];
const METRICS = [['count', tr('Приёмы')], ['amount', tr('Количество')]];
const r2 = (v) => Math.round(v * 100) / 100;

/** Цвет лекарства — по его месту в списке всех лекарств по названию (не меняется при фильтрах и окне графика). */
function colorMap(meds) {
  const byKey = new Map(meds.map((m) => [m.key, m]));
  const keys = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru')).map((m) => m.key);
  return (key) => SERIES[Math.max(0, keys.indexOf(key)) % SERIES.length];
}
/** Значок лекарства в аналитике (0.14 — свой у каждого). */
const medIcon = (key) => F.kindIcon(store.feast.foods.get(key)) || '💊';

function Chips({ list, value, onChange, label }) {
  return html`<div class="chip-row wrap" role="tablist" aria-label=${label}>
    ${list.map(([k, l]) => html`<button type="button" role="tab" key=${k} aria-selected=${value === k} class=${'chip' + (value === k ? ' selected' : '')} onClick=${() => onChange(k)}>${l}</button>`)}
  </div>`;
}

/**
 * Вкладка «Лекарства» (0.12.5, графики — 0.13): приёмы или количество по дням, месяцам, часам суток или годам;
 * одно лекарство или все сразу (столбики рядом, у количества — только лекарства одной единицы), по каждому — сколько
 * всего, средняя доза, в среднем в день; журнал приёмов.
 */
function MedsTab() {
  const { period, setPeriod, from, today } = usePeriod();
  const [pick, setPick] = useState('all');
  // группировка всегда открывается «по дням»; что считать — запоминается; окно графика (0.14) — день, неделя, год
  const [group, setGroupState] = useState('day');
  const [anchor, setAnchor] = useState(null);
  const setGroup = (g) => {
    setAnchor(regroupAnchor(group, anchor, g, today));
    setGroupState(g);
  };
  const [metric, setMetricState] = useState(() => readLocal('feastMedMetric', 'count'));
  const [unitPick, setUnitPick] = useState(null);
  const setMetric = (m) => {
    setMetricState(m);
    writeLocal('feastMedMetric', m);
  };
  const st = useMemo(() => F.medStats(store.feast, from, today), [store.version, from, today]);
  const catalog = [...store.feast.foods.values()].filter((f) => !f.deletedAt && F.isMed(f));
  const span = daysBetween(from, today) + 1;
  const win = anchor ? TW.windowRange(group, anchor) : null;
  // график окна (конкретный день, неделя, год) считается отдельно; плитки, сравнение и журнал — за период
  const cs = useMemo(() => (win ? F.medStats(store.feast, win.from, win.to) : st), [st, win?.from, win?.to]);
  const sel = st.meds.find((m) => m.key === pick) || null;
  const color = colorMap([...catalog.map((f) => ({ key: f.id, name: f.name })), ...st.meds, ...cs.meds]);
  // единицы, которые есть на графике: у «Количества» по всем — только лекарства одной единицы
  const units = [...new Set(cs.meds.map((m) => m.unit))];
  const unit = sel ? sel.unit : unitPick && units.includes(unitPick) ? unitPick : (cs.meds.find((m) => m.amount) || cs.meds[0] || st.meds[0])?.unit;
  const selInWin = sel ? cs.meds.find((m) => m.key === sel.key) || { ...sel, count: 0, amount: 0 } : null;
  // порядок рядов — по названию, как и цвета: соседние части столбика — соседние цвета палитры
  let shown = (selInWin ? [selInWin] : metric === 'amount' ? cs.meds.filter((m) => m.unit === unit) : cs.meds).slice().sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  // больше 8 рядов — остальные в «Другое»
  let series = shown.map((m) => ({ key: m.key, label: m.name, color: color(m.key), unit: m.unit }));
  let fold = null;
  if (series.length > 8) {
    const keep = [...shown].sort((a, b) => (metric === 'amount' ? b.amount - a.amount : b.count - a.count)).slice(0, 7).map((m) => m.key);
    fold = shown.filter((m) => !keep.includes(m.key)).map((m) => m.key);
    series = [...series.filter((x) => keep.includes(x.key)), { key: 'other', label: tr('Другое'), color: 'var(--muted)', unit }];
  }
  const buckets = useMemo(() => {
    const keys = shown.map((m) => m.key);
    const raw = F.medBuckets({ log: cs.log, extra: cs.extra, from: win ? win.from : from, to: win ? win.to : today, group, metric, keys });
    const list = win ? raw : TW.trimLead(raw, group);
    if (!fold) return list;
    return list.map((b) => {
      const values = { ...b.values };
      for (const k of fold) {
        if (values[k]) values.other = r2((values.other || 0) + values[k]);
        delete values[k];
      }
      return { ...b, values };
    });
  }, [cs, from, today, group, metric, win?.from, shown.map((m) => m.key).join()]);
  const fmtValue = (v, s) => (metric === 'amount' ? `${dec(r2(v))} ${unitShort(s?.unit || unit)}` : timesLabel(v));
  const groupTitle = { day: tr('по дням'), month: tr('по месяцам'), hour: tr('по часам суток'), year: tr('по годам') }[group];
  const log = (sel ? st.log.filter((l) => l.key === sel.key) : st.log).slice(0, 60);
  const byDay = [];
  for (const l of log) {
    const last = byDay.at(-1);
    if (last?.date === l.date) last.items.push(l);
    else byDay.push({ date: l.date, items: [l] });
  }
  // сравнение: внутри одной единицы — по количеству, иначе по приёмам
  const byUnit = units.map((u) => ({ unit: u, meds: st.meds.filter((m) => m.unit === u).sort((a, b) => b.amount - a.amount) }));
  return html`
    <${PeriodChips} period=${period} setPeriod=${setPeriod}/>
    <div class="page-actions meds-actions">
      <button type="button" class="btn primary" disabled=${!!store.ui.feastReadOnly} onClick=${() => openAddFood({ kind: 'med' })}>💊 Записать приём</button>
      <button type="button" class="btn" onClick=${() => navigate('/foods/meds')}>Все лекарства${catalog.length ? ` (${catalog.length})` : ''}</button>
    </div>
    ${!st.intakes ? html`<div class="card-block"><p class="muted">${catalog.length
      ? tr('За этот период приёмов нет. Записывай лекарства в «Дневнике» — отдельно или вместе с едой, — и здесь появится статистика.')
      : tr('Лекарств пока нет. Создай лекарство в «Продуктах и лекарствах» или прямо при записи — и отмечай приёмы в «Дневнике».')}</p></div>` : html`
      <div class="stat-tiles">
        ${sel ? html`
          <div class="stat-tile"><span>Всего</span><b>${dec(r2(sel.amount))} ${unitShort(sel.unit)}</b><small>${timesLabel(sel.count)}</small></div>
          <div class="stat-tile"><span>Средняя доза</span><b>${dec(r2(sel.amount / Math.max(1, sel.count)))} ${unitShort(sel.unit)}</b><small>за приём</small></div>
          <div class="stat-tile"><span>В среднем в день</span><b>${dec(r2(sel.amount / Math.max(1, sel.days.length)))} ${unitShort(sel.unit)}</b>
            <small>${tr('в дни приёма; за весь период — {p0}', { p0: dec(r2(sel.amount / span)) })}</small></div>
          <div class="stat-tile"><span>Последний приём</span><b class="tile-text">${whenLabel(sel.last, today)}</b><small>${tr('дней с приёмом: {p0} из {span}', { p0: sel.days.length, span })}</small></div>` : html`
          <div class="stat-tile"><span>Приёмов</span><b>${num(st.intakes)}</b><small>за период</small></div>
          <div class="stat-tile"><span>Дней с приёмами</span><b>${st.days}</b><small>из ${span}</small></div>
          <div class="stat-tile"><span>Лекарств</span><b>${st.meds.length}</b><small>принимались</small></div>
          <div class="stat-tile"><span>Последний приём</span><b class="tile-text">${st.log[0] ? whenLabel(st.log[0].date + ' ' + (st.log[0].time || ''), today) : '—'}</b>
            <small>${st.log[0]?.name || ''}</small></div>`}
      </div>
      <section class="card-block">
        <h2 class="block-title">${metric === 'amount' ? tr('Количество') : tr('Приёмы')} ${groupTitle}${win ? ' · ' + windowLabel(group, anchor, today) : ''}</h2>
        ${st.meds.length > 1 ? html`<${Chips} label=${tr('Лекарство')} value=${sel ? sel.key : 'all'} onChange=${setPick}
          list=${[['all', tr('Все')], ...st.meds.map((m) => [m.key, medIcon(m.key) + ' ' + m.name])]}/>` : null}
        <div class="med-controls">
          <${Chips} label=${tr('Группировка')} value=${group} onChange=${setGroup} list=${GROUPS}/>
          <${Chips} label=${tr('Что считать')} value=${metric} onChange=${setMetric} list=${METRICS}/>
        </div>
        <${TimeWindow} group=${group} anchor=${anchor} setAnchor=${setAnchor} today=${today}/>
        ${!sel && metric === 'amount' && units.length > 1 ? html`<div class="med-units">
          <span class="muted small">${tr('В чём показывать:')}</span>
          <${Chips} label=${tr('Единица')} value=${unit} onChange=${setUnitPick} list=${units.map((u) => [u, unitShort(u)])}/>
        </div>` : null}
        <${StackedBars} buckets=${buckets} series=${series} fmtValue=${fmtValue} grouped=${series.length > 1} integer=${metric === 'count'}
          label=${(metric === 'amount' ? tr('Количество') : tr('Приёмы')) + ' ' + groupTitle}/>
        ${group === 'hour' ? html`<p class="muted small">${win ? tr('Приёмы этого дня по часу приёма; приёмы без времени не учитываются.')
          : tr('Сумма за период по часу приёма; приёмы без времени и старые дни из сводок не учитываются.')}</p>` : null}
        ${win && !cs.intakes ? html`<p class="muted small">${tr('В это время приёмов нет — листай стрелками.')}</p>` : null}
        ${!sel && metric === 'amount' ? html`<p class="muted small">${tr('На одном графике — лекарства в одной единице ({u}), чтобы их можно было сравнить.', { u: unitShort(unit) })}</p>` : null}
      </section>
      <section class="card-block">
        <h2 class="block-title">По лекарствам</h2>
        ${byUnit.map((g) => {
          const max = Math.max(1e-9, ...g.meds.map((m) => (metric === 'amount' ? m.amount : m.count)));
          return html`<div class="med-unit-group" key=${g.unit}>
            ${byUnit.length > 1 ? html`<p class="med-log-date">${tr('В единицах: {u}', { u: unitShort(g.unit) })}</p>` : null}
            <ul class="med-stats">${g.meds.map((m) => html`<li key=${m.key} class="ex-facet med-stat">
              <span class="ex-facet-bar" style=${{ width: ((metric === 'amount' ? m.amount : m.count) / max) * 100 + '%', background: `color-mix(in srgb, ${color(m.key)} 22%, transparent)` }}></span>
              <span class="ms-name"><i class="swatch" style=${{ background: color(m.key) }}></i> ${m.name}</span>
              <span class="ms-meta">${tr('всего {total} · {times} · средняя доза {dose} · в день приёма {perDay} · последний: {last}', {
                total: `${dec(r2(m.amount))} ${unitShort(m.unit)}`, times: timesLabel(m.count), dose: `${dec(r2(m.amount / Math.max(1, m.count)))} ${unitShort(m.unit)}`,
                perDay: `${dec(r2(m.amount / Math.max(1, m.days.length)))} ${unitShort(m.unit)}`, last: whenLabel(m.last, today).toLowerCase() })}</span>
            </li>`)}</ul>
          </div>`;
        })}
      </section>
      <section class="card-block">
        <h2 class="block-title">Журнал приёмов${sel ? ' · ' + sel.name : ''}</h2>
        ${byDay.length ? byDay.map((d) => html`<div class="med-log-day" key=${d.date}>
          <p class="med-log-date">${humanDate(d.date, today)}${d.date !== today && d.date !== addDays(today, -1) ? '' : ' · ' + longDate(d.date)}</p>
          ${d.items.map((l, i) => html`<button type="button" class="med-log-row" key=${l.entryId + i} onClick=${() => openSheet('entry', { id: l.entryId })}>
            <span class="er-time">${l.time || '—'}</span>
            <span class="er-main"><span class="er-name">${medIcon(l.key)} ${l.name} · ${amountLabel(l)}</span>
              ${l.foods.length ? html`<small class="muted">вместе с: ${l.foods.join(', ')}</small>` : null}
              ${l.note ? html`<small class="er-item-note">${l.note}</small>` : null}</span>
          </button>`)}
        </div>`) : html`<p class="muted small">В журнале — только дни, которые ещё хранятся в дневнике (старые сводятся в итоги дня).</p>`}
        ${(sel ? st.log.filter((l) => l.key === sel.key) : st.log).length > log.length ? html`<p class="muted small">Показаны последние ${log.length}.</p>` : null}
      </section>`}
    <${FeastHistorySection}/>`;
}

/**
 * Вкладка «Замеры» (0.13): показания выбранного замера за период — график с нормой, последнее, среднее, разброс,
 * сколько вне нормы, журнал (с едой и лекарствами той же записи).
 */
const M_GROUPS = [['raw', tr('Показания')], ['hour', tr('По часам')], ['day', tr('По дням')], ['month', tr('По месяцам')], ['year', tr('По годам')]];
const M_GROUP_TITLE = { raw: '', hour: tr('по часам суток'), day: tr('по дням'), month: tr('по месяцам'), year: tr('по годам') };

function MeasuresTab() {
  const { period, setPeriod, from, today } = usePeriod();
  const [pick, setPick] = useState(null);
  // 0.14.1: как у лекарств — показания как есть или средние по часам, дням, месяцам, годам; за период или конкретную
  // неделю, день, год (показать врачу)
  const [group, setGroupState] = useState('raw');
  const [anchor, setAnchor] = useState(null);
  const setGroup = (g) => {
    setAnchor(regroupAnchor(group, anchor, g, today));
    setGroupState(g);
  };
  const win = anchor ? TW.windowRange(group, anchor) : null;
  const st = useMemo(() => F.measureStats(store.feast, from, today), [store.version, from, today]);
  const ws = useMemo(() => (win ? F.measureStats(store.feast, win.from, win.to) : st), [st, win?.from, win?.to]);
  const catalog = [...store.feast.foods.values()].filter((f) => !f.deletedAt && F.isMeasure(f));
  const types = [...st.types, ...ws.types.filter((t) => !st.types.some((x) => x.key === t.key))];
  const selKey = (types.find((t) => t.key === pick) || types[0])?.key;
  const sel = !selKey ? null : ws.types.find((t) => t.key === selKey)
    || { ...types.find((t) => t.key === selKey), readings: [], last: null, stat: [], count: 0 };
  const type = sel ? store.feast.foods.get(sel.key) : null;
  const parts = type?.parts?.length ? type.parts : [];
  const ranges = type?.ranges || [];
  const statusOf = (vs) => M.readingStatus(vs, ranges);
  const off = sel ? sel.readings.filter((r) => ['low', 'high'].includes(statusOf(r.values))).length : 0;
  const unit = sel?.unit ? tr(sel.unit) : '';
  const fv = (v) => (v == null ? '—' : dec(r2(v)));
  const log = sel ? [...sel.readings].reverse().slice(0, 80) : [];
  const nParts = Math.max(1, parts.length, ...(sel?.readings || []).map((r) => r.values.length));
  const buckets = useMemo(() => {
    if (!sel || group === 'raw') return null;
    const raw = M.readingBuckets({ readings: sel.readings, from: win ? win.from : from, to: win ? win.to : today, group, parts: nParts });
    return win ? raw : TW.trimLead(raw.map((b) => ({ ...b, values: { n: b.n } })), group);
  }, [sel, group, win?.from, from, today, nParts]);
  const wl = win ? ' · ' + windowLabel(group, anchor, today) : '';
  return html`
    <${PeriodChips} period=${period} setPeriod=${setPeriod}/>
    <div class="page-actions meds-actions">
      <button type="button" class="btn primary" disabled=${!!store.ui.feastReadOnly} onClick=${() => openAddFood({ kind: 'measure' })}>📏 Записать замер</button>
      <button type="button" class="btn" onClick=${() => navigate('/foods/measures')}>Все замеры${catalog.length ? ` (${catalog.length})` : ''}</button>
    </div>
    ${!sel ? html`<div class="card-block"><p class="muted">${catalog.length
      ? tr('За этот период замеров нет. Записывай их в «Дневнике» — отдельно или вместе с едой и лекарствами.')
      : tr('Замеров пока нет. Добавь известный (глюкоза, давление, пульс…) или свой в «Замерах» — и записывай показания в «Дневнике».')}</p></div>` : html`
      ${types.length > 1 ? html`<${Chips} label=${tr('Замер')} value=${sel.key} onChange=${setPick} list=${types.map((t) => [t.key, (store.feast.foods.get(t.key)?.icon || '📏') + ' ' + t.name])}/>` : null}
      <div class="med-controls">
        <${Chips} label=${tr('Группировка')} value=${group} onChange=${setGroup} list=${M_GROUPS}/>
      </div>
      <${TimeWindow} group=${group} anchor=${anchor} setAnchor=${setAnchor} today=${today}/>
      <div class="stat-tiles">
        <div class="stat-tile"><span>${win ? tr('Последнее · {w}', { w: windowLabel(group, anchor, today) }) : tr('Последнее')}</span><b>${sel.last ? sel.last.values.map(fv).join('/') : '—'} <small>${unit}</small></b>
          <small>${sel.last ? whenLabel(sel.last.date + ' ' + (sel.last.time || ''), today) : ''}</small></div>
        <div class="stat-tile"><span>Среднее</span><b>${sel.stat.map((s) => fv(s?.avg)).join('/')} <small>${unit}</small></b><small>${countLabel(sel.count, ['показание', 'показания', 'показаний'])}</small></div>
        <div class="stat-tile"><span>Разброс</span><b class="tile-text">${sel.stat.map((s) => (s ? `${fv(s.min)}–${fv(s.max)}` : '—')).join(' / ')}</b><small>мин–макс</small></div>
        <div class="stat-tile"><span>Вне нормы</span><b>${ranges.some(Boolean) ? (off ? '⚠ ' + off : '0') : '—'}</b><small>${ranges.some(Boolean) ? tr('норма {p0}', { p0: M.normText(type) }) : tr('норма не задана')}</small></div>
      </div>
      <section class="card-block">
        <h2 class="block-title">${sel.name}${unit ? ', ' + unit : ''}${group !== 'raw' ? ' · ' + tr('среднее') + ' ' + M_GROUP_TITLE[group] : ''}${wl}</h2>
        ${!sel.readings.length ? html`<p class="muted">${tr('В это время показаний нет — листай стрелками.')}</p>`
          : group === 'raw' ? html`<${ReadingsChart} readings=${sel.readings} parts=${parts} ranges=${ranges} unit=${unit} label=${sel.name}
          statusOf=${statusOf} statusLabel=${M.STATUS_LABEL}/>` : html`<${ReadingBucketsChart} buckets=${buckets} parts=${parts} ranges=${ranges} unit=${unit} label=${sel.name}
          statusOf=${statusOf} statusLabel=${M.STATUS_LABEL}/>`}
        ${group === 'hour' ? html`<p class="muted small">${win ? tr('Показания этого дня по часу замера.') : tr('Среднее за период по часу замера — видно, в какое время суток значения выше; показания без времени не учитываются.')}</p>` : null}
      </section>
      <section class="card-block">
        <h2 class="block-title">Журнал · ${sel.name}${wl}</h2>
        ${log.map((r, i) => {
          const s = statusOf(r.values);
          return html`<button type="button" class="med-log-row" key=${i} disabled=${!r.entryId} onClick=${() => r.entryId && openSheet('entry', { id: r.entryId })}>
            <span class="er-time">${humanDate(r.date, today)}${r.time ? ' ' + r.time : ''}</span>
            <span class="er-main"><span class="er-name">${r.values.map(fv).join('/')} ${unit}${s === 'low' || s === 'high' ? html` <span class="tone-danger">⚠ ${M.STATUS_LABEL[s]}</span>` : null}</span>
              ${r.foods?.length || r.meds?.length ? html`<small class="muted">вместе с: ${[...(r.foods || []), ...(r.meds || []).map((x) => '💊 ' + x)].join(', ')}</small>` : null}
              ${r.note ? html`<small class="er-item-note">${r.note}</small>` : null}</span>
          </button>`;
        })}
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

export const ANALYTICS_TABS = [['food', tr('Питание'), '/nutrition'], ['meds', tr('Лекарства'), '/nutrition/meds'], ['measures', tr('Замеры'), '/nutrition/measures'], ['body', tr('Тело'), '/nutrition/body']];

export function NutritionScreen({ tab: param = null }) {
  const tab = ['meds', 'measures', 'body'].includes(param) ? param : 'food';
  return html`
    <div class="screen nutrition">
      <div class="section-tabs" role="tablist" aria-label="Аналитика">
        ${ANALYTICS_TABS.map(([k, l, to]) => html`<button type="button" role="tab" key=${k} aria-selected=${tab === k}
          class=${'section-tab' + (tab === k ? ' active' : '')} onClick=${() => navigate(to, { replace: true })}>${l}</button>`)}
      </div>
      ${tab === 'food' ? html`<${FoodTab}/>` : tab === 'meds' ? html`<${MedsTab}/>` : tab === 'measures' ? html`<${MeasuresTab}/>` : html`<${BodyTab}/>`}
    </div>`;
}
