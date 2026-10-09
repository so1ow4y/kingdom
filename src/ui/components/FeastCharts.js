// Графики Feast (обновление 0.11) — SVG без библиотек, по правилам: тонкие столбики (≤ 24 px, скруглённый
// верх, зазор 2 px), линии 2 px, точки ≥ 8 px с кольцом цвета фона, волосяная сетка, подсказка при наведении,
// легенда для двух и более рядов, таблица вместо графика по кнопке. Цвета рядов — проверенная категориальная
// палитра (--series-1…3), «сверх лимита» — статусный цвет и значок ⚠ (не только цвет).

import { html, useState, useRef, useLayoutEffect } from '../html.js';
import { addDays, daysBetween, longDate } from '../../core/dates.js';
import { fmt } from '../../core/nutrition.js';
import { tr, locale } from '../../core/i18n.js';

const W = 640;
const PAD = { l: 44, r: 12, t: 12, b: 26 };

/** «Круглые» деления оси: 0, 500, 1 000… */
function ticks(max, count = 4, integer = false) {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  let step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  // счётчики (приёмы, задачи) — только целые деления (0.14)
  if (integer) step = Math.max(1, Math.ceil(step));
  // последнее деление — не ниже максимума, иначе столбик вылезает за график (0.13)
  const out = [0];
  while (out.at(-1) < max - 1e-9) out.push(Math.round((out.at(-1) + step) * 100) / 100);
  return out;
}
const num = (v) => Math.round(v).toLocaleString(locale());
const shortDate = (d) => `${+d.slice(8)}.${d.slice(5, 7)}`;

/** Столбик со скруглённым верхом и прямым низом. */
function barPath(x, y, w, h) {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** Подсказка над точкой; у краёв графика сдвигается внутрь, чтобы не обрезалась и не уезжала за карточку (0.13). */
function Tip({ tip }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !tip) return;
    const w = el.offsetWidth;
    const box = el.parentElement.clientWidth;
    el.style.left = Math.max(w / 2, Math.min(box - w / 2, tip.x)) + 'px';
  });
  if (!tip) return null;
  return html`<div class="fchart-tip" ref=${ref} style=${{ left: tip.x + 'px', top: tip.y + 'px' }} role="status">${tip.body}</div>`;
}

/**
 * Калории по дням: series — [{ date, totals, count }] (дни с записями), from..to — период, goal — лимит.
 * Больше 92 дней — по неделям (среднее за записанные дни недели).
 */
export function CalorieChart({ series, from, to, goal, height = 200 }) {
  const box = useRef(null);
  const [tip, setTip] = useState(null);
  const [table, setTable] = useState(false);
  const span = daysBetween(from, to) + 1;
  const weekly = span > 92;
  const byDate = new Map(series.map((d) => [d.date, d]));
  const buckets = [];
  if (!weekly) {
    for (let i = 0; i < span; i++) {
      const date = addDays(from, i);
      const d = byDate.get(date);
      buckets.push({ key: date, label: shortDate(date), title: longDate(date), kcal: d ? d.totals.kcal || 0 : 0, logged: !!d?.count, n: d ? 1 : 0 });
    }
  } else {
    for (let start = from; start <= to; start = addDays(start, 7)) {
      const days = Array.from({ length: 7 }, (_, k) => addDays(start, k)).filter((d) => d <= to);
      const logged = days.map((d) => byDate.get(d)).filter((d) => d?.count);
      const kcal = logged.length ? logged.reduce((s, d) => s + (d.totals.kcal || 0), 0) / logged.length : 0;
      buckets.push({ key: start, label: shortDate(start), title: tr('{p0} — {p1}, в среднем', { p0: longDate(start), p1: longDate(days.at(-1)) }), kcal, logged: logged.length > 0, n: logged.length });
    }
  }
  const max = Math.max(goal * 1.15, ...buckets.map((b) => b.kcal), 100);
  const tk = ticks(max);
  const top = tk.at(-1);
  const ih = height - PAD.t - PAD.b;
  const iw = W - PAD.l - PAD.r;
  const slot = iw / buckets.length;
  const bw = Math.max(1, Math.min(24, slot - 2));
  const y = (v) => PAD.t + ih - (v / top) * ih;
  const labelEvery = Math.ceil(buckets.length / 8);
  const show = (i, e) => {
    const b = buckets[i];
    const rect = box.current.getBoundingClientRect();
    const px = ((PAD.l + slot * i + slot / 2) / W) * rect.width;
    const over = b.kcal > goal;
    setTip({
      x: px, y: (y(b.kcal) / height) * rect.height,
      body: html`<b>${b.title}</b><span>${b.logged ? tr('{p0} ккал', { p0: num(b.kcal) }) : tr('нет записей')}</span>
        ${b.logged ? html`<span class="muted">${over ? tr('⚠ на {p0} больше лимита', { p0: num(b.kcal - goal) }) : tr('до лимита {p0}', { p0: num(goal - b.kcal) })}</span>` : null}`,
    });
    e?.stopPropagation?.();
  };
  return html`<div class="fchart">
    <div class="fchart-legend">
      <span><i class="swatch" style=${{ background: 'var(--series-1)' }}></i>в пределах лимита</span>
      <span><i class="swatch" style=${{ background: 'var(--danger)' }}></i>⚠ сверх лимита</span>
      <span><i class="line-key ref-key"></i>лимит ${num(goal)}</span>
      <button type="button" class="link-btn fchart-table-btn" onClick=${() => setTable(!table)}>${table ? tr('График') : tr('Таблицей')}</button>
    </div>
    ${table ? html`<div class="fchart-table"><table><thead><tr><th>${weekly ? tr('Неделя') : tr('День')}</th><th class="num">ккал</th><th></th></tr></thead><tbody>
      ${buckets.filter((b) => b.logged).reverse().map((b) => html`<tr key=${b.key}><td>${b.title}</td><td class="num">${num(b.kcal)}</td><td>${b.kcal > goal ? tr('⚠ сверх лимита') : ''}</td></tr>`)}
    </tbody></table></div>` : html`
    <div class="fchart-box" ref=${box} onPointerLeave=${() => setTip(null)}>
      <svg viewBox=${`0 0 ${W} ${height}`} preserveAspectRatio="none" class="fchart-svg" role="img"
        aria-label=${tr('Калории по {p0}, лимит {goal}', { p0: weekly ? tr('неделям') : tr('дням'), goal })}>
        ${tk.map((t) => html`<line key=${'g' + t} class="grid" x1=${PAD.l} x2=${W - PAD.r} y1=${y(t)} y2=${y(t)}/>`)}
        ${buckets.map((b, i) => (b.logged ? html`<path key=${b.key} class="bar" d=${barPath(PAD.l + slot * i + (slot - bw) / 2, y(b.kcal), bw, PAD.t + ih - y(b.kcal))}
          fill=${b.kcal > goal ? 'var(--danger)' : 'var(--series-1)'}/>` : null))}
        <line class="ref" x1=${PAD.l} x2=${W - PAD.r} y1=${y(goal)} y2=${y(goal)}/>
        ${buckets.map((b, i) => html`<rect key=${'h' + b.key} class="hit" x=${PAD.l + slot * i} y=${PAD.t} width=${slot} height=${ih}
          onPointerEnter=${(e) => show(i, e)} onPointerDown=${(e) => show(i, e)}/>`)}
      </svg>
      <div class="fchart-axis-y">${tk.map((t) => html`<span key=${t} style=${{ top: (y(t) / height) * 100 + '%' }}>${num(t)}</span>`)}</div>
      <div class="fchart-axis-x">${buckets.map((b, i) => (i % labelEvery === 0 ? html`<span key=${b.key} style=${{ left: ((PAD.l + slot * i + slot / 2) / W) * 100 + '%' }}>${b.label}</span>` : null))}</div>
      <${Tip} tip=${tip}/>
    </div>`}
  </div>`;
}

/**
 * Линейный график по датам: lines — [{ key, label, color, points: [{ date, y }], dots?: bool, line?: bool }],
 * refs — [{ y, label }] (цель), unit — подпись значений, digits — знаков после запятой.
 */
export function LineChart({ lines, from, to, refs = [], unit = '', digits = 1, height = 200, label = tr('График') }) {
  const box = useRef(null);
  const [tip, setTip] = useState(null);
  const [table, setTable] = useState(false);
  const all = lines.flatMap((l) => l.points.map((p) => p.y)).concat(refs.map((r) => r.y));
  if (!lines.some((l) => l.points.length)) return html`<p class="muted fchart-empty">Пока нет данных для графика.</p>`;
  const span = Math.max(1, daysBetween(from, to));
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  const pad = Math.max(0.5, (hi - lo) * 0.15);
  lo = Math.floor((lo - pad) * 2) / 2;
  hi = Math.ceil((hi + pad) * 2) / 2;
  const ih = height - PAD.t - PAD.b;
  const iw = W - PAD.l - PAD.r;
  const x = (d) => PAD.l + (daysBetween(from, d) / span) * iw;
  const y = (v) => PAD.t + ih - ((v - lo) / (hi - lo || 1)) * ih;
  const tk = ticks(hi - lo).map((t) => lo + t).filter((t) => t <= hi + 1e-9);
  const f = (v) => v.toLocaleString(locale(), { maximumFractionDigits: digits, minimumFractionDigits: digits });
  const main = lines[0];
  const near = (px) => {
    let best = null;
    for (const p of main.points) {
      const d = Math.abs(x(p.date) - px);
      if (!best || d < best.d) best = { d, p };
    }
    return best?.p || null;
  };
  const move = (e) => {
    const rect = box.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const p = near(px);
    if (!p) return;
    const others = lines.slice(1).map((l) => ({ l, q: l.points.find((q) => q.date === p.date) })).filter((o) => o.q);
    setTip({
      x: (x(p.date) / W) * rect.width, y: (y(p.y) / height) * rect.height, date: p.date,
      body: html`<b>${longDate(p.date)} ${p.date.slice(0, 4)}</b><span>${main.label}: ${f(p.y)} ${unit}</span>
        ${others.map((o) => html`<span class="muted">${o.l.label}: ${f(o.q.y)} ${unit}</span>`)}`,
    });
  };
  const xLabels = [from, addDays(from, Math.round(span / 2)), to];
  return html`<div class="fchart">
    <div class="fchart-legend">
      ${lines.length > 1 ? lines.map((l) => html`<span key=${l.key}><i class=${l.line === false ? 'swatch dot' : 'line-key'} style=${{ background: l.color }}></i>${l.label}</span>`) : null}
      ${refs.map((r) => html`<span key=${'r' + r.y}><i class="line-key ref-key"></i>${r.label}</span>`)}
      <button type="button" class="link-btn fchart-table-btn" onClick=${() => setTable(!table)}>${table ? tr('График') : tr('Таблицей')}</button>
    </div>
    ${table ? html`<div class="fchart-table"><table><thead><tr><th>Дата</th>${lines.map((l) => html`<th class="num" key=${l.key}>${l.label}</th>`)}</tr></thead><tbody>
      ${[...main.points].reverse().map((p) => html`<tr key=${p.date}><td>${longDate(p.date)} ${p.date.slice(0, 4)}</td>
        ${lines.map((l) => { const q = l.points.find((z) => z.date === p.date); return html`<td class="num" key=${l.key}>${q ? f(q.y) : '—'}</td>`; })}</tr>`)}
    </tbody></table></div>` : html`
    <div class="fchart-box" ref=${box} onPointerMove=${move} onPointerDown=${move} onPointerLeave=${() => setTip(null)}>
      <svg viewBox=${`0 0 ${W} ${height}`} preserveAspectRatio="none" class="fchart-svg" role="img" aria-label=${label}>
        ${tk.map((t) => html`<line key=${'g' + t} class="grid" x1=${PAD.l} x2=${W - PAD.r} y1=${y(t)} y2=${y(t)}/>`)}
        ${refs.map((r) => html`<line key=${'r' + r.y} class="ref" x1=${PAD.l} x2=${W - PAD.r} y1=${y(r.y)} y2=${y(r.y)}/>`)}
        ${lines.map((l) => (l.line === false || l.points.length < 2 ? null : html`<polyline key=${l.key} class="series-line" stroke=${l.color}
          points=${l.points.map((p) => `${x(p.date)},${y(p.y)}`).join(' ')}/>`))}
        ${tip ? html`<line class="crosshair" x1=${x(tip.date)} x2=${x(tip.date)} y1=${PAD.t} y2=${PAD.t + ih}/>` : null}
      </svg>
      ${lines.filter((l) => l.dots !== false).map((l) => l.points.map((p) => html`<i key=${l.key + p.date} class="fchart-dot"
        style=${{ left: (x(p.date) / W) * 100 + '%', top: (y(p.y) / height) * 100 + '%', background: l.color }}></i>`))}
      <div class="fchart-axis-y">${tk.map((t) => html`<span key=${t} style=${{ top: (y(t) / height) * 100 + '%' }}>${f(t)}</span>`)}</div>
      <div class="fchart-axis-x">${xLabels.map((d, i) => html`<span key=${i} style=${{ left: (x(d) / W) * 100 + '%' }}>${shortDate(d)}</span>`)}</div>
      <${Tip} tip=${tip}/>
    </div>`}
  </div>`;
}

/** Доли калорий от БЖУ одной полосой (зазоры 2 px) с легендой: граммы и проценты. */
export function MacroSplitBar({ values, colors, labels }) {
  const e = { protein: (values.protein || 0) * 4, fat: (values.fat || 0) * 9, carbs: (values.carbs || 0) * 4 };
  const sum = e.protein + e.fat + e.carbs;
  const keys = ['protein', 'fat', 'carbs'];
  return html`<div class="macro-split">
    <div class="ms-bar" role="img" aria-label=${keys.map((k) => `${labels[k]} ${sum ? Math.round((e[k] / sum) * 100) : 0} %`).join(', ')}>
      ${sum ? keys.map((k) => (e[k] ? html`<i key=${k} style=${{ flexGrow: e[k], background: colors[k] }} title=${`${labels[k]}: ${Math.round((e[k] / sum) * 100)} %`}></i>` : null))
        : html`<i class="ms-empty"></i>`}
    </div>
    <div class="fchart-legend">
      ${keys.map((k) => html`<span key=${k}><i class="swatch" style=${{ background: colors[k] }}></i>${labels[k]} · ${fmt(values[k] || 0, k)} г · ${sum ? Math.round((e[k] / sum) * 100) : 0} %</span>`)}
    </div>
  </div>`;
}

/**
 * Столбики по дням (0.12.5, приёмы лекарств): points — [{ date, value }], from..to — период; больше 92 дней — по неделям
 * (сумма за неделю). unit — подпись в подсказке («приёма»), label — для чтения с экрана.
 */
export function DayBars({ points, from, to, unitLabel = (v) => String(v), label = tr('По дням'), height = 160 }) {
  const box = useRef(null);
  const [tip, setTip] = useState(null);
  const [table, setTable] = useState(false);
  const span = daysBetween(from, to) + 1;
  const weekly = span > 92;
  const byDate = new Map(points.map((p) => [p.date, p.value]));
  const buckets = [];
  if (!weekly) {
    for (let i = 0; i < span; i++) {
      const date = addDays(from, i);
      buckets.push({ key: date, label: shortDate(date), title: longDate(date), value: byDate.get(date) || 0 });
    }
  } else {
    for (let start = from; start <= to; start = addDays(start, 7)) {
      const days = Array.from({ length: 7 }, (_, k) => addDays(start, k)).filter((d) => d <= to);
      buckets.push({ key: start, label: shortDate(start), title: `${longDate(start)} — ${longDate(days.at(-1))}`, value: days.reduce((s, d) => s + (byDate.get(d) || 0), 0) });
    }
  }
  const tk = ticks(Math.max(1, ...buckets.map((b) => b.value)), 3);
  const top = tk.at(-1) || 1;
  const ih = height - PAD.t - PAD.b;
  const iw = W - PAD.l - PAD.r;
  const slot = iw / buckets.length;
  const bw = Math.max(1, Math.min(24, slot - 2));
  const y = (v) => PAD.t + ih - (v / top) * ih;
  const labelEvery = Math.ceil(buckets.length / 8);
  const show = (i, e) => {
    const b = buckets[i];
    const rect = box.current.getBoundingClientRect();
    setTip({ x: ((PAD.l + slot * i + slot / 2) / W) * rect.width, y: (y(b.value) / height) * rect.height,
      body: html`<b>${b.title}</b><span>${b.value ? unitLabel(b.value) : tr('нет приёмов')}</span>` });
    e?.stopPropagation?.();
  };
  return html`<div class="fchart">
    <div class="fchart-legend">
      <button type="button" class="link-btn fchart-table-btn" onClick=${() => setTable(!table)}>${table ? tr('График') : tr('Таблицей')}</button>
    </div>
    ${table ? html`<div class="fchart-table"><table><thead><tr><th>${weekly ? tr('Неделя') : tr('День')}</th><th class="num">Сколько</th></tr></thead><tbody>
      ${buckets.filter((b) => b.value).reverse().map((b) => html`<tr key=${b.key}><td>${b.title}</td><td class="num">${unitLabel(b.value)}</td></tr>`)}
    </tbody></table></div>` : html`
    <div class="fchart-box" ref=${box} onPointerLeave=${() => setTip(null)}>
      <svg viewBox=${`0 0 ${W} ${height}`} preserveAspectRatio="none" class="fchart-svg" style=${{ height: height + 'px' }} role="img" aria-label=${label}>
        ${tk.map((t) => html`<line key=${'g' + t} class="grid" x1=${PAD.l} x2=${W - PAD.r} y1=${y(t)} y2=${y(t)}/>`)}
        ${buckets.map((b, i) => (b.value ? html`<path key=${b.key} class="bar" d=${barPath(PAD.l + slot * i + (slot - bw) / 2, y(b.value), bw, PAD.t + ih - y(b.value))}
          fill="var(--series-2)"/>` : null))}
        ${buckets.map((b, i) => html`<rect key=${'h' + b.key} class="hit" x=${PAD.l + slot * i} y=${PAD.t} width=${slot} height=${ih}
          onPointerEnter=${(e) => show(i, e)} onPointerDown=${(e) => show(i, e)}/>`)}
      </svg>
      <div class="fchart-axis-y">${tk.map((t) => html`<span key=${t} style=${{ top: (y(t) / height) * 100 + '%' }}>${t.toLocaleString(locale())}</span>`)}</div>
      <div class="fchart-axis-x">${buckets.map((b, i) => (i % labelEvery === 0 ? html`<span key=${b.key} style=${{ left: ((PAD.l + slot * i + slot / 2) / W) * 100 + '%' }}>${b.label}</span>` : null))}</div>
      <${Tip} tip=${tip}/>
    </div>`}
  </div>`;
}

/** Цвета рядов по порядку (проверенная палитра, 8 слотов); цвет следует за сущностью, а не за местом в рейтинге. */
export const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)'];

/**
 * Столбики рядов (0.13, лекарства): друг на друге или рядом (grouped — у каждого ряда своё место в периоде).
 * buckets — [{ key, label, title, values: { ключ ряда: число } }], series — [{ key, label, color }].
 * Зазор 2 px между частями, скруглён верх столбика, подсказка — по каждому ряду и
 * сумма, легенда для двух и более рядов, «Таблицей». fmtValue(v, ряд) — подпись значения («3 ед.»).
 */
export function StackedBars({ buckets, series, fmtValue = (v) => String(v), label = tr('График'), height = 180, empty = tr('нет приёмов'), grouped = false, integer = false }) {
  const box = useRef(null);
  const [tip, setTip] = useState(null);
  const [table, setTable] = useState(false);
  const sum = (b) => series.reduce((s, x) => s + (b.values[x.key] || 0), 0);
  const peak = (b) => (grouped ? Math.max(0, ...series.map((x) => b.values[x.key] || 0)) : sum(b));
  const tk = ticks(Math.max(1, ...buckets.map(peak)), 3, integer);
  const top = tk.at(-1) || 1;
  const ih = height - PAD.t - PAD.b;
  const iw = W - PAD.l - PAD.r;
  const slot = iw / Math.max(1, buckets.length);
  const bw = Math.max(1, Math.min(24, slot - 2));
  // рядом: у каждого ряда своё место в группе, между столбиками группы — 2 px, между группами — просвет
  const n = Math.max(1, series.length);
  const gw = Math.min(slot * 0.8, n * 16 + (n - 1) * 2);
  const one = Math.max(1, (gw - (n - 1) * 2) / n);
  const y = (v) => PAD.t + ih - (v / top) * ih;
  const labelEvery = Math.ceil(buckets.length / 8);
  const show = (i, e) => {
    const b = buckets[i];
    const rect = box.current.getBoundingClientRect();
    const total = sum(b);
    const parts = series.filter((x) => b.values[x.key]);
    setTip({
      x: ((PAD.l + slot * i + slot / 2) / W) * rect.width, y: (y(peak(b)) / height) * rect.height,
      body: html`<b>${b.title}</b>${!total ? html`<span>${empty}</span>` : parts.map((x) => html`<span key=${x.key}><i class="swatch" style=${{ background: x.color }}></i> ${x.label}: ${fmtValue(b.values[x.key], x)}</span>`)}
        ${parts.length > 1 ? html`<span class="muted">${tr('Всего')}: ${fmtValue(total, series[0])}</span>` : null}`,
    });
    e?.stopPropagation?.();
  };
  return html`<div class="fchart">
    <div class="fchart-legend">
      ${series.length > 1 ? series.map((x) => html`<span key=${x.key}><i class="swatch" style=${{ background: x.color }}></i>${x.label}</span>`) : null}
      <button type="button" class="link-btn fchart-table-btn" onClick=${() => setTable(!table)}>${table ? tr('График') : tr('Таблицей')}</button>
    </div>
    ${table ? html`<div class="fchart-table"><table><thead><tr><th></th>${series.map((x) => html`<th class="num" key=${x.key}>${x.label}</th>`)}</tr></thead><tbody>
      ${buckets.filter((b) => sum(b)).reverse().map((b) => html`<tr key=${b.key}><td>${b.title}</td>${series.map((x) => html`<td class="num" key=${x.key}>${b.values[x.key] ? fmtValue(b.values[x.key], x) : '—'}</td>`)}</tr>`)}
    </tbody></table></div>` : html`
    <div class="fchart-box" ref=${box} onPointerLeave=${() => setTip(null)}>
      <svg viewBox=${`0 0 ${W} ${height}`} preserveAspectRatio="none" class="fchart-svg" style=${{ height: height + 'px' }} role="img" aria-label=${label}>
        ${tk.map((t) => html`<line key=${'g' + t} class="grid" x1=${PAD.l} x2=${W - PAD.r} y1=${y(t)} y2=${y(t)}/>`)}
        ${grouped ? buckets.map((b, i) => series.map((x, j) => {
          const v = b.values[x.key] || 0;
          if (!v) return null;
          const xx = PAD.l + slot * i + (slot - gw) / 2 + j * (one + 2);
          return html`<path key=${b.key + x.key} class="bar" d=${barPath(xx, y(v), one, PAD.t + ih - y(v))} fill=${x.color}/>`;
        })) : buckets.map((b, i) => {
          let acc = 0;
          const present = series.filter((x) => b.values[x.key] > 0);
          return present.map((x, j) => {
            const v = b.values[x.key];
            const y0 = y(acc);
            acc += v;
            const y1 = y(acc);
            const xx = PAD.l + slot * i + (slot - bw) / 2;
            const last = j === present.length - 1;
            // зазор 2 px цвета фона между частями столбика
            const h = Math.max(0, y0 - y1 - (j > 0 ? 2 : 0));
            return last
              ? html`<path key=${b.key + x.key} class="bar" d=${barPath(xx, y1, bw, h)} fill=${x.color}/>`
              : html`<rect key=${b.key + x.key} class="bar" x=${xx} y=${y1} width=${bw} height=${h} fill=${x.color}/>`;
          });
        })}
        ${buckets.map((b, i) => html`<rect key=${'h' + b.key} class="hit" x=${PAD.l + slot * i} y=${PAD.t} width=${slot} height=${ih}
          onPointerEnter=${(e) => show(i, e)} onPointerDown=${(e) => show(i, e)}/>`)}
      </svg>
      <div class="fchart-axis-y">${tk.map((t) => html`<span key=${t} style=${{ top: (y(t) / height) * 100 + '%' }}>${t.toLocaleString(locale())}</span>`)}</div>
      <div class="fchart-axis-x">${buckets.map((b, i) => (i % labelEvery === 0 ? html`<span key=${b.key} style=${{ left: ((PAD.l + slot * i + slot / 2) / W) * 100 + '%' }}>${b.label}</span>` : null))}</div>
      <${Tip} tip=${tip}/>
    </div>`}
  </div>`;
}

/**
 * Показания замера во времени (0.13): по линии на часть значения (у давления — верхнее и нижнее), точки, полосы нормы.
 * readings — [{ date, time, values, note }], parts — названия частей, ranges — нормы частей.
 * Вне нормы — точка с обводкой статусного цвета и «⚠» в подсказке и таблице (не только цвет).
 */
export function ReadingsChart({ readings, parts = [], ranges = [], unit = '', label = tr('Показания'), height = 200, statusOf = () => null, statusLabel = {} }) {
  const box = useRef(null);
  const [tip, setTip] = useState(null);
  const [table, setTable] = useState(false);
  if (!readings.length) return html`<p class="muted fchart-empty">${tr('Пока нет показаний.')}</p>`;
  const n = Math.max(1, parts.length, ...readings.map((r) => r.values.length));
  const names = Array.from({ length: n }, (_, i) => parts[i] || (n > 1 ? tr('Значение {n}', { n: i + 1 }) : label));
  const t = (r) => Date.parse(r.date + 'T' + (r.time || '12:00') + ':00Z');
  const t0 = Math.min(...readings.map(t));
  const t1 = Math.max(...readings.map(t));
  const span = Math.max(3600000, t1 - t0);
  const all = readings.flatMap((r) => r.values.filter((v) => Number.isFinite(v)));
  for (const r of ranges) if (r) all.push(...[r.min, r.max].filter((v) => v != null));
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  const pad = Math.max(0.5, (hi - lo) * 0.12);
  lo = Math.floor((lo - pad) * 2) / 2;
  hi = Math.ceil((hi + pad) * 2) / 2;
  const ih = height - PAD.t - PAD.b;
  const iw = W - PAD.l - PAD.r;
  const x = (ms) => PAD.l + 6 + ((ms - t0) / span) * (iw - 12);
  const y = (v) => PAD.t + ih - ((v - lo) / (hi - lo || 1)) * ih;
  const tk = ticks(hi - lo).map((v) => Math.round((lo + v) * 100) / 100).filter((v) => v <= hi + 1e-9);
  const f = (v) => (v == null ? '—' : v.toLocaleString(locale(), { maximumFractionDigits: 2 }));
  const when = (r) => `${longDate(r.date)} ${r.date.slice(0, 4)}${r.time ? ', ' + r.time : ''}`;
  const near = (px) => {
    let best = null;
    for (const r of readings) {
      const d = Math.abs(x(t(r)) - px);
      if (!best || d < best.d) best = { d, r };
    }
    return best?.r || null;
  };
  const move = (e) => {
    const rect = box.current.getBoundingClientRect();
    const r = near(((e.clientX - rect.left) / rect.width) * W);
    if (!r) return;
    const st = statusOf(r.values);
    setTip({
      x: (x(t(r)) / W) * rect.width, y: (y(r.values.find((v) => Number.isFinite(v)) ?? lo) / height) * rect.height, ms: t(r),
      body: html`<b>${when(r)}</b><span>${r.values.map(f).join(' / ')} ${unit}</span>
        ${st && st !== 'ok' ? html`<span class="tone-danger">⚠ ${statusLabel[st] || ''}</span>` : null}
        ${r.note ? html`<span class="muted">${r.note}</span>` : null}`,
    });
  };
  const xLabels = [t0, t0 + span / 2, t1].map((ms) => new Date(ms).toISOString().slice(0, 10));
  const off = (r) => {
    const st = statusOf(r.values);
    return st && st !== 'ok';
  };
  return html`<div class="fchart">
    <div class="fchart-legend">
      ${n > 1 ? names.map((nm, i) => html`<span key=${i}><i class="line-key" style=${{ background: SERIES[i] }}></i>${nm}</span>`) : null}
      ${ranges.some(Boolean) ? html`<span><i class="swatch norm-key"></i>${tr('норма')}</span>` : null}
      <button type="button" class="link-btn fchart-table-btn" onClick=${() => setTable(!table)}>${table ? tr('График') : tr('Таблицей')}</button>
    </div>
    ${table ? html`<div class="fchart-table"><table><thead><tr><th>${tr('Когда')}</th>${names.map((nm, i) => html`<th class="num" key=${i}>${nm}</th>`)}<th></th></tr></thead><tbody>
      ${[...readings].reverse().map((r, k) => html`<tr key=${k}><td>${when(r)}</td>${names.map((_, i) => html`<td class="num" key=${i}>${f(r.values[i])}</td>`)}
        <td>${off(r) ? '⚠ ' + (statusLabel[statusOf(r.values)] || '') : ''}</td></tr>`)}
    </tbody></table></div>` : html`
    <div class="fchart-box" ref=${box} onPointerMove=${move} onPointerDown=${move} onPointerLeave=${() => setTip(null)}>
      <svg viewBox=${`0 0 ${W} ${height}`} preserveAspectRatio="none" class="fchart-svg" style=${{ height: height + 'px' }} role="img" aria-label=${label}>
        ${ranges.map((r, i) => (r ? html`<rect key=${'n' + i} class="norm-band" x=${PAD.l} width=${iw} y=${y(r.max ?? hi)} height=${Math.max(0, y(r.min ?? lo) - y(r.max ?? hi))}/>` : null))}
        ${tk.map((v) => html`<line key=${'g' + v} class="grid" x1=${PAD.l} x2=${W - PAD.r} y1=${y(v)} y2=${y(v)}/>`)}
        ${names.map((_, i) => {
          const pts = readings.filter((r) => Number.isFinite(r.values[i]));
          return pts.length > 1 ? html`<polyline key=${'l' + i} class="series-line" stroke=${SERIES[i]} points=${pts.map((r) => `${x(t(r))},${y(r.values[i])}`).join(' ')}/>` : null;
        })}
        ${tip ? html`<line class="crosshair" x1=${x(tip.ms)} x2=${x(tip.ms)} y1=${PAD.t} y2=${PAD.t + ih}/>` : null}
      </svg>
      ${readings.flatMap((r, k) => r.values.map((v, i) => (Number.isFinite(v) ? html`<i key=${k + ':' + i} class=${'fchart-dot' + (off(r) ? ' off-norm' : '')}
        style=${{ left: (x(t(r)) / W) * 100 + '%', top: (y(v) / height) * 100 + '%', background: SERIES[i] }}></i>` : null)))}
      <div class="fchart-axis-y">${tk.map((v) => html`<span key=${v} style=${{ top: (y(v) / height) * 100 + '%' }}>${f(v)}</span>`)}</div>
      <div class="fchart-axis-x">${xLabels.map((d, i) => html`<span key=${i} style=${{ left: ((i === 0 ? PAD.l + 6 : i === 2 ? W - PAD.r - 6 : W / 2) / W) * 100 + '%' }}>${shortDate(d)}</span>`)}</div>
      <${Tip} tip=${tip}/>
    </div>`}
  </div>`;
}
