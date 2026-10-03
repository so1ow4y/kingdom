// Поле времени, всегда в 24-часовом формате (обновление 0.5): стандартное <input type="time"> берёт формат
// из языка браузера и показывает «09:00 AM». Здесь — два списка: часы 00–23 и минуты 00–59. Значение — 'HH:MM' или null.

import { html } from '../html.js';

const pad = (n) => String(n).padStart(2, '0');
const HOURS = Array.from({ length: 24 }, (_, i) => pad(i));
const MINUTES = Array.from({ length: 60 }, (_, i) => pad(i));

export function TimeInput({ value, onChange, disabled = false, allowEmpty = true, label = 'Время', className = '' }) {
  const [h, m] = value && /^\d{2}:\d{2}$/.test(value) ? value.split(':') : ['', ''];
  const setH = (hh) => {
    if (!hh) return onChange(allowEmpty ? null : `00:${m || '00'}`);
    return onChange(`${hh}:${m || '00'}`);
  };
  const setM = (mm) => onChange(`${h || '00'}:${mm}`);
  return html`
    <span class=${'time-input ' + className} role="group" aria-label=${label}>
      <select value=${h} disabled=${disabled} aria-label=${label + ': часы'} onChange=${(e) => setH(e.target.value)}>
        ${allowEmpty ? html`<option value="">--</option>` : null}
        ${HOURS.map((x) => html`<option value=${x}>${x}</option>`)}
      </select>
      <span class="time-colon">:</span>
      <select value=${m} disabled=${disabled || (allowEmpty && !h)} aria-label=${label + ': минуты'} onChange=${(e) => setM(e.target.value)}>
        ${h ? null : html`<option value="">--</option>`}
        ${MINUTES.map((x) => html`<option value=${x}>${x}</option>`)}
      </select>
    </span>`;
}
