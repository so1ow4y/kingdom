// Экран «Аналитика» (обновление 0.3, п. 2.9): периоды, графики по дням, разбивки, серии, тепловая карта как на GitHub.
// Все графики — свой SVG, без библиотек. Считает core/analytics.js.

import { html, useState } from '../html.js';
import { store } from '../../store/appState.js';
import * as AN from '../../core/analytics.js';
import { addDays, daysBetween, dayLabel, longDate, WEEKDAY_SHORT } from '../../core/dates.js';
import { countLabel } from '../../core/plural.js';
import { readLocal, writeLocal } from '../hooks.js';

const TASKS = ['задача', 'задачи', 'задач'];
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const fmt1 = (x) => (Math.round(x * 10) / 10).toLocaleString('ru-RU');
const short = (d) => `${+d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1]}`;

function bucketLabel(b, unit) {
  if (unit === 'month') return `${MONTHS[+b.key.slice(5, 7) - 1]} ${b.key.slice(0, 4)}`;
  if (unit === 'week') return `${short(b.from)} – ${short(b.to)}`;
  return dayLabel(b.from);
}

/** Столбики по дням/неделям/месяцам. Подсказка — при наведении (title) и по тапу (строка под графиком). */
function BarChart({ map, from, to, color, unitName }) {
  const [sel, setSel] = useState(null);
  const { unit, items } = AN.buckets(map, from, to);
  const max = Math.max(1, ...items.map((b) => b.value));
  const W = 600;
  const H = 150;
  const top = 14;
  const bw = W / items.length;
  const gap = Math.min(4, bw * 0.25);
  const ticks = items.length <= 8 ? items.map((_, i) => i) : [0, Math.floor(items.length / 2), items.length - 1];
  const picked = sel != null ? items[sel] : null;
  const per = unit === 'day' ? '' : unit === 'week' ? ' (по неделям)' : ' (по месяцам)';
  return html`
    <figure class="chart">
      <svg viewBox=${`0 0 ${W} ${H + 22}`} class="chart-svg" role="img" aria-label=${'График' + per}>
        <line x1="0" x2=${W} y1=${H} y2=${H} class="chart-axis"/>
        <line x1="0" x2=${W} y1=${top} y2=${top} class="chart-grid"/>
        <text x="2" y="10" class="chart-max">${max}</text>
        ${items.map((b, i) => {
          const h = b.value ? Math.max(2, ((H - top) * b.value) / max) : 0;
          return html`<g key=${b.key} onClick=${() => setSel(sel === i ? null : i)} class=${'chart-bar' + (sel === i ? ' sel' : '')}>
            <rect x=${i * bw} y=${top} width=${bw} height=${H - top} fill="transparent"/>
            ${h ? html`<rect x=${i * bw + gap / 2} y=${H - h} width=${Math.max(1, bw - gap)} height=${h} rx=${Math.min(3, bw / 4)} fill=${color}/>` : null}
            <title>${bucketLabel(b, unit)}: ${b.value} ${unitName(b.value)}</title>
          </g>`;
        })}
        ${ticks.map((i) => html`<text key=${'t' + i} x=${Math.min(W - 2, Math.max(2, i * bw + bw / 2))} y=${H + 16}
          text-anchor=${i === 0 ? 'start' : i === items.length - 1 ? 'end' : 'middle'} class="chart-tick">${unit === 'month' ? MONTHS[+items[i].key.slice(5, 7) - 1] : short(items[i].from)}</text>`)}
      </svg>
      <figcaption class="chart-cap">${picked ? `${bucketLabel(picked, unit)}: ${picked.value} ${unitName(picked.value)}` : `Нажми на столбик, чтобы увидеть число${per}`}</figcaption>
    </figure>`;
}

/** Горизонтальные полосы: разбивка по спискам или приоритетам. */
function Breakdown({ rows, total }) {
  if (!rows.length) return html`<p class="muted small">Нет выполненных задач за период.</p>`;
  const max = Math.max(...rows.map((r) => r.n));
  const rowH = 30;
  return html`
    <svg viewBox=${`0 0 600 ${rows.length * rowH}`} class="chart-svg breakdown" role="img">
      ${rows.map((r, i) => html`<g key=${r.id || 'none'} transform=${`translate(0 ${i * rowH})`}>
        <title>${r.name}: ${r.n} (${Math.round((r.n / total) * 100)}%)</title>
        <circle cx="7" cy="15" r="5" fill=${r.color}/>
        <text x="20" y="20" class="bd-name">${r.name.length > 22 ? r.name.slice(0, 21) + '…' : r.name}</text>
        <rect x="230" y="7" width="300" height="16" rx="4" class="bd-track"/>
        <rect x="230" y="7" width=${Math.max(3, (300 * r.n) / max)} height="16" rx="4" fill=${r.color}/>
        <text x="540" y="20" class="bd-num">${r.n} · ${Math.round((r.n / total) * 100)}%</text>
      </g>`)}
    </svg>`;
}

/** Тепловая карта как на GitHub: столбцы — недели, строки — Пн…Вс, ярче — больше задач. */
function Heatmap({ done, from, to }) {
  const [sel, setSel] = useState(null);
  const grid = AN.heatGrid(from, to);
  let max = 0;
  for (const [d, n] of done) if (d >= from && d <= to) max = Math.max(max, n);
  const C = 13;
  const G = 3;
  const left = 22;
  const topPad = 16;
  const W = left + grid.length * (C + G);
  const H = topPad + 7 * (C + G);
  const months = [];
  grid.forEach((week, i) => {
    // Подпись месяца — над неделей, где его 1-е число (и над первой неделей)
    const d = week.find((x) => x && x.endsWith('-01')) || (i === 0 ? week.find(Boolean) : null);
    if (d) {
      const m = MONTHS[+d.slice(5, 7) - 1];
      if (!months.length || (months.at(-1).m !== m && i - months.at(-1).i >= 3)) months.push({ i, m });
    }
  });
  const today = store.now.today;
  const n = sel ? done.get(sel) || 0 : 0;
  return html`
    <div class="heatmap-wrap" ref=${(el) => el && (el.scrollLeft = el.scrollWidth)}>
      <svg viewBox=${`0 0 ${W} ${H}`} width=${W} height=${H} class="heatmap" role="img" aria-label="Тепловая карта выполненных задач">
        ${months.map((x) => html`<text key=${'m' + x.i} x=${left + x.i * (C + G)} y="10" class="chart-tick">${x.m}</text>`)}
        ${[0, 2, 4].map((r) => html`<text key=${'w' + r} x="0" y=${topPad + r * (C + G) + 10} class="chart-tick">${WEEKDAY_SHORT[r]}</text>`)}
        ${grid.map((week, i) => week.map((d, r) => (d ? html`
          <rect key=${d} x=${left + i * (C + G)} y=${topPad + r * (C + G)} width=${C} height=${C} rx="3"
            class=${'hm hm-' + AN.heatLevel(done.get(d) || 0, max) + (sel === d ? ' sel' : '') + (d === today ? ' today' : '')}
            onClick=${() => setSel(sel === d ? null : d)}>
            <title>${longDate(d, today)}: ${countLabel(done.get(d) || 0, TASKS)}</title>
          </rect>` : null)))}
      </svg>
    </div>
    <div class="heatmap-foot">
      <span class="chart-cap">${sel ? `${dayLabel(sel)} ${sel.slice(0, 4)}: ${countLabel(n, TASKS)}` : 'Нажми на клетку, чтобы увидеть день'}</span>
      <span class="hm-legend">меньше ${[0, 1, 2, 3, 4].map((l) => html`<i class=${'hm-' + l}></i>`)} больше</span>
    </div>`;
}

function Stat({ label, value, sub = null }) {
  return html`<div class="stat"><div class="stat-value">${value}</div><div class="stat-label">${label}</div>${sub ? html`<div class="stat-sub">${sub}</div>` : null}</div>`;
}

export function AnalyticsScreen() {
  const today = store.now.today;
  const tz = store.data.settings.timeZone;
  const [period, setPeriodState] = useState(() => readLocal('analyticsPeriod', '30d'));
  const [custom, setCustom] = useState(() => readLocal('analyticsCustom', { from: addDays(today, -13), to: today }));
  const setPeriod = (p) => {
    setPeriodState(p);
    writeLocal('analyticsPeriod', p);
  };
  const changeCustom = (patch) => {
    const v = { ...custom, ...patch };
    setCustom(v);
    writeLocal('analyticsCustom', v);
  };
  const { from, to } = AN.periodRange(period, store.data, tz, today, custom);
  const a = AN.analyze(store.data, tz, today, from, to);
  // Тепловая карта — минимум за 3 месяца, чтобы было на что смотреть
  const hmFrom = daysBetween(from, to) < 90 ? addDays(to, -90) : from;
  const game = store.data.settings.gameEnabled;

  return html`
    <div class="screen analytics">
      <div class="chip-row wrap" role="tablist" aria-label="Период">
        ${AN.PERIODS.map((p) => html`<button type="button" role="tab" aria-selected=${period === p.id}
          class=${'chip' + (period === p.id ? ' selected' : '')} onClick=${() => setPeriod(p.id)}>${p.label}</button>`)}
      </div>
      ${period === 'custom' ? html`<div class="field-row">
        <label class="field"><span>С</span><input type="date" value=${custom.from} max=${today} onChange=${(e) => e.target.value && changeCustom({ from: e.target.value })}/></label>
        <label class="field"><span>По</span><input type="date" value=${custom.to} max=${today} onChange=${(e) => e.target.value && changeCustom({ to: e.target.value })}/></label>
      </div>` : null}
      <p class="muted small">${longDate(from)} ${from.slice(0, 4)} — ${longDate(to)} ${to.slice(0, 4)} · ${countLabel(a.days, ['день', 'дня', 'дней'])}</p>

      <div class="stats-grid">
        <${Stat} label="Выполнено" value=${a.total}/>
        <${Stat} label="Среднее в день" value=${fmt1(a.average)}/>
        <${Stat} label="Лучший день" value=${a.best ? a.best.n : '—'} sub=${a.best ? dayLabel(a.best.date) : null}/>
        <${Stat} label="Серия" value=${a.streak.current} sub=${'лучшая: ' + a.streak.best}/>
        ${game ? html`<${Stat} label="Монеты" value=${'+' + a.totalCoins + ' 🪙'} sub=${a.spent ? `потрачено ${a.spent}` : null}/>` : null}
      </div>

      <section class="card-block">
        <h2 class="block-title">Выполнено задач</h2>
        <${BarChart} map=${a.done} from=${from} to=${to} color="var(--accent)" unitName=${(n) => countLabel(n, TASKS).replace(/^\d+\s/, '')}/>
      </section>
      ${game ? html`<section class="card-block">
        <h2 class="block-title">Монеты</h2>
        <${BarChart} map=${a.coins} from=${from} to=${to} color="var(--star)" unitName=${() => '🪙'}/>
      </section>` : null}
      <section class="card-block">
        <h2 class="block-title">Тепловая карта</h2>
        <${Heatmap} done=${hmFrom === from ? a.done : AN.analyze(store.data, tz, today, hmFrom, to).done} from=${hmFrom} to=${to}/>
      </section>
      <section class="card-block">
        <h2 class="block-title">По спискам</h2>
        <${Breakdown} rows=${a.byList} total=${a.total}/>
      </section>
      <section class="card-block">
        <h2 class="block-title">По приоритетам</h2>
        <${Breakdown} rows=${a.byPriority} total=${a.total}/>
      </section>
    </div>`;
}
