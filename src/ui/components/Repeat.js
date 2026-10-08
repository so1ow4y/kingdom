// Повторяющиеся задачи (обновление 0.9): редактор правила «Каждый день / По дням недели / Раз в месяц / Раз в год
// (0.12.3) / Каждые N дней» и лист «Повтор» из карточки задачи. Правило — core/repeat.js, формат — DATA_FORMAT §5.3.4.

import { html, useState } from '../html.js';
import { Sheet } from './Sheet.js';
import { TimeInput } from './TimeInput.js';
import { store, closeSheet } from '../../store/appState.js';
import * as A from '../../store/actions.js';
import * as RP from '../../core/repeat.js';
import { isoWeekday, WEEKDAY_SHORT, MONTH_NOM, humanDate } from '../../core/dates.js';
import { tr } from '../../core/i18n.js';

const KINDS = [['daily', tr('Каждый день')], ['weekly', tr('По дням недели')], ['monthly', tr('Раз в месяц')], ['yearly', tr('Раз в год')], ['every', tr('Каждые N дней')]];
/** Сколько дней в месяце (февраль — 29: в невисокосный год повтор сработает 28-го). */
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Редактор правила. value — правило или null; onChange(rule | null). startDate — с какого дня считать. */
export function RepeatEditor({ value, onChange, startDate }) {
  const today = store.now.today;
  const start = value?.startDate || startDate || today;
  const k = RP.ruleKind(value);
  const set = (patch) => {
    const next = { ...k, ...patch };
    if (next.kind === 'none') return onChange(null);
    onChange(RP.makeRule(next, start));
  };
  const days = k.weekdays.length ? k.weekdays : [isoWeekday(start)];
  const preview = value ? RP.upcoming({ repeat: value, occurrences: {} }, today, 4, store.data.settings.timeZone) : [];
  return html`<div class="repeat-editor">
    <div class="chip-row wrap">
      <button type="button" class=${'chip' + (!value ? ' selected' : '')} onClick=${() => set({ kind: 'none' })}>Не повторять</button>
      ${KINDS.map(([kind, label]) => html`<button type="button" class=${'chip' + (k.kind === kind ? ' selected' : '')}
        onClick=${() => set({ kind, weekdays: days, monthDay: k.monthDay || Number(start.slice(8, 10)), month: k.month || Number(start.slice(5, 7)), interval: k.interval > 1 ? k.interval : 2 })}>${label}</button>`)}
    </div>
    ${k.kind === 'weekly' ? html`<div class="chip-row wrap weekday-chips" role="group" aria-label="Дни недели">
      ${WEEKDAY_SHORT.map((w, i) => {
        const on = days.includes(i + 1);
        return html`<button type="button" class=${'chip day-chip' + (on ? ' selected' : '')} aria-pressed=${on}
          onClick=${() => {
            const next = on ? days.filter((d) => d !== i + 1) : [...days, i + 1];
            if (next.length) set({ weekdays: next });
          }}>${w}</button>`;
      })}
      <button type="button" class="chip" onClick=${() => set({ weekdays: [1, 2, 3, 4, 5] })}>Будни</button>
    </div>` : null}
    ${k.kind === 'monthly' ? html`<label class="field inline-field"><span>Число месяца</span>
      <input type="number" min="1" max="31" value=${k.monthDay} onInput=${(e) => { const v = Math.round(+e.target.value); if (v >= 1 && v <= 31) set({ monthDay: v }); }}/>
      <small class="muted">Если в месяце меньше дней — в последний день</small></label>` : null}
    ${k.kind === 'yearly' ? html`<div class="yearly-fields">
      <label class="field"><span>Месяц</span>
        <select value=${k.month} onChange=${(e) => {
          const m = Number(e.target.value);
          set({ month: m, monthDay: Math.min(k.monthDay, MONTH_DAYS[m - 1]) });
        }}>${MONTH_NOM.map((name, i) => html`<option value=${i + 1}>${name}</option>`)}</select></label>
      <label class="field"><span>Число</span>
        <input type="number" min="1" max=${MONTH_DAYS[k.month - 1]} value=${k.monthDay}
          onInput=${(e) => { const v = Math.round(+e.target.value); if (v >= 1 && v <= MONTH_DAYS[k.month - 1]) set({ monthDay: v }); }}/></label>
      ${k.month === 2 && k.monthDay === 29 ? html`<small class="muted">В невисокосный год — 28 февраля</small>` : null}
    </div>` : null}
    ${k.kind === 'every' ? html`<label class="field inline-field"><span>Каждые … дней</span>
      <input type="number" min="2" max="365" value=${k.interval} onInput=${(e) => { const v = Math.round(+e.target.value); if (v >= 1 && v <= 365) set({ interval: v }); }}/></label>` : null}
    ${value ? html`<p class="muted small repeat-preview">↻ ${RP.describeRule(value)}. Ближайшие: ${preview.map((d) => humanDate(d, today).toLowerCase()).join(', ') || '—'}</p>` : null}
  </div>`;
}

/** Лист «Повтор» из карточки задачи. */
export function RepeatSheet({ taskId }) {
  const t = A.getTask(taskId);
  const [rule, setRule] = useState(t?.repeat || null);
  const [time, setTime] = useState(t?.scheduledTime || null);
  if (!t) return null;
  const save = async () => {
    closeSheet();
    const same = JSON.stringify(rule) === JSON.stringify(t.repeat) && time === t.scheduledTime;
    if (!same) await A.setRepeat(taskId, rule, rule ? time : undefined);
  };
  return html`<${Sheet} title="Повтор" onClose=${closeSheet} className="repeat-sheet">
    <${RepeatEditor} value=${rule} onChange=${setRule} startDate=${t.scheduledDate || store.now.today}/>
    ${rule ? html`<div class="chip-row wrap"><span class=${'chip chip-timebox' + (time ? ' selected' : '')}>Время
      <${TimeInput} value=${time} onChange=${setTime} label="Время"/></span></div>` : null}
    <p class="muted small">Повторяющаяся задача живёт во «Входящих» на вкладке «Повторяющиеся» и в своих списках. Отметка
      «выполнено» закрывает только сегодняшний раз — завтра (по правилу) задача снова появится в «Сегодня».</p>
    <div class="sheet-actions">
      <button class="btn" onClick=${closeSheet}>Отмена</button>
      <button class="btn primary" onClick=${save}>Готово</button>
    </div>
  <//>`;
}
