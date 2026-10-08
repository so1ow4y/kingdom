// Графики Feast (обновление 0.11) — SVG без библиотек, по правилам: тонкие столбики (≤ 24 px, скруглённый
// верх, зазор 2 px), линии 2 px, точки ≥ 8 px с кольцом цвета фона, волосяная сетка, подсказка при наведении,
// легенда для двух и более рядов, таблица вместо графика по кнопке. Цвета рядов — проверенная категориальная
// палитра (--series-1…3), «сверх лимита» — статусный цвет и значок ⚠ (не только цвет).

import { html, useState, useRef } from '../html.js';
import { addDays, daysBetween, longDate } from '../../core/dates.js';
import { fmt } from '../../core/nutrition.js';

const W = 640;
const PAD = { l: 44, r: 12, t: 12, b: 26 };

/** «Круглые» деления оси: 0, 500, 1 000… */
function ticks(max, count = 4) {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const out = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}
const num = (v) => Math.round(v).toLocaleString('ru-RU');
const shortDate = (d) => `${+d.slice(8)}.${d.slice(5, 7)}`;

/** Столбик со скруглённым верхом и прямым низом. */
function barPath(x, y, w, h) {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function Tip({ tip }) {
  if (!tip) return null;
  return html`<div class="fchart-tip" style=${{ left: tip.x + 'px', top: tip.y + 'px' }} role="status">${tip.body}</div>`;
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
      buckets.push({ key: start, label: shortDate(start), title: `${longDate(start)} — ${longDate(days.at(-1))}, в среднем`, kcal, logged: logged.length > 0, n: logged.length });
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
      body: html`<b>${b.title}</b><span>${b.logged ? `${num(b.kcal)} ккал` : 'нет записей'}</span>
        ${b.logged ? html`<span class="muted">${over ? `⚠ на ${num(b.kcal - goal)} больше лимита` : `до лимита ${num(goal - b.kcal)}`}</span>` : null}`,
    });
    e?.stopPropagation?.();
  };
  return html`<div class="fchart">
    <div class="fchart-legend">
      <span><i class="swatch" style=${{ background: 'var(--series-1)' }}></i>в пределах лимита</span>
      <span><i class="swatch" style=${{ background: 'var(--danger)' }}></i>⚠ сверх лимита</span>
      <span><i class="line-key ref-key"></i>лимит ${num(goal)}</span>
      <button type="button" class="link-btn fchart-table-btn" onClick=${() => setTable(!table)}>${table ? 'График' : 'Таблицей'}</button>
    </div>
    ${table ? html`<div class="fchart-table"><table><thead><tr><th>${weekly ? 'Неделя' : 'День'}</th><th class="num">ккал</th><th></th></tr></thead><tbody>
      ${buckets.filter((b) => b.logged).reverse().map((b) => html`<tr key=${b.key}><td>${b.title}</td><td class="num">${num(b.kcal)}</td><td>${b.kcal > goal ? '⚠ сверх лимита' : ''}</td></tr>`)}
    </tbody></table></div>` : html`
    <div class="fchart-box" ref=${box} onPointerLeave=${() => setTip(null)}>
      <svg viewBox=${`0 0 ${W} ${height}`} preserveAspectRatio="none" class="fchart-svg" role="img"
        aria-label=${`Калории по ${weekly ? 'неделям' : 'дням'}, лимит ${goal}`}>
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
export function LineChart({ lines, from, to, refs = [], unit = '', digits = 1, height = 200, label = 'График' }) {
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
  const f = (v) => v.toLocaleString('ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: digits });
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
      <button type="button" class="link-btn fchart-table-btn" onClick=${() => setTable(!table)}>${table ? 'График' : 'Таблицей'}</button>
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
