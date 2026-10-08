// Полоса недели на экране «Сегодня» (обновление 0.7, вместо полей «← дата →» из 0.6): семь дней с точками
// запланированного, месяц с календарём, «‹ ›» — на неделю, свайп по полосе — тоже на неделю, стрелки клавиатуры — на день.
// Выбранный день живёт в адресе (#/today?date=…), как и раньше (core/planning.js).

import { html, useMemo, useRef } from '../html.js';
import { Icon } from '../icons.js';
import { store } from '../../store/appState.js';
import { addDays, mondayOf, weekDates, WEEKDAY_SHORT, localDateOf } from '../../core/dates.js';
import { planningDate } from '../../core/planning.js';
import { countLabel } from '../../core/plural.js';
import * as RP from '../../core/repeat.js';
import { tr } from '../../core/i18n.js';

const MONTHS = [tr('Январь'), tr('Февраль'), tr('Март'), tr('Апрель'), tr('Май'), tr('Июнь'), tr('Июль'), tr('Август'), tr('Сентябрь'), tr('Октябрь'), tr('Ноябрь'), tr('Декабрь')];

/** По дням недели: сколько активных задач запланировано (дата, дедлайн или «главное») и сколько выполнено. */
export function weekStats(data, tz, dates) {
  const set = new Set(dates);
  const out = new Map(dates.map((d) => [d, { planned: 0, done: 0 }]));
  for (const t of data.tasks.values()) {
    if (t.deletedAt || t.trashedAt) continue;
    if (t.status === 'active' && t.repeat) {
      // повтор (0.9): точка в те дни недели, где есть незакрытый экземпляр по правилу
      for (const d of dates) if (RP.matches(t.repeat, d) && !['done', 'skipped'].includes(t.occurrences?.[d]?.state)) out.get(d).planned++;
    } else if (t.status === 'active') {
      for (const d of new Set([t.scheduledDate, t.deadlineDate, t.focusDate])) if (set.has(d)) out.get(d).planned++;
    } else if (t.status === 'done' && t.completedAt) {
      const d = localDateOf(t.completedAt, tz);
      if (set.has(d)) out.get(d).done++;
    }
  }
  return out;
}

/** Точки дня для полосы задач: { dots, mark, title }. */
function taskMarks(days) {
  const stats = weekStats(store.data, store.data.settings.timeZone, days);
  return new Map(days.map((d) => {
    const s = stats.get(d);
    const title = [s.planned ? tr('запланировано ') + countLabel(s.planned, ['задача', 'задачи', 'задач']) : '', s.done ? tr('выполнено ') + s.done : ''].filter(Boolean).join(', ');
    return [d, { dots: Math.min(3, s.planned), mark: s.done && !s.planned ? '✓' : '', title: title || tr('Свободный день') }];
  }));
}

/**
 * Полоса недели. marksFn(days) → Map(дата → { dots, mark, title }) — свои точки (0.11: Feast показывает,
 * записан ли день и не превышен ли лимит калорий); по умолчанию — задачи.
 */
export function DayStrip({ date, onGo, marksFn = taskMarks }) {
  const today = store.now.today;
  const monday = mondayOf(date);
  const days = weekDates(monday);
  const stats = useMemo(() => marksFn(days), [store.version, monday, marksFn]);
  const picker = useRef(null);
  const touch = useRef(null);
  const [y, m] = date.split('-');
  const month = MONTHS[+m - 1] + (y !== today.slice(0, 4) ? ' ' + y : '');
  const thisWeek = mondayOf(today) === monday;
  const openPicker = () => {
    const el = picker.current;
    try {
      el.showPicker();
    } catch {
      el.focus();
      el.click();
    }
  };
  const onKey = (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      onGo(addDays(date, e.key === 'ArrowLeft' ? -1 : 1));
      requestAnimationFrame(() => document.querySelector('.ds-day.selected')?.focus());
    }
  };
  const start = (e) => {
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const end = (e) => {
    const s = touch.current;
    touch.current = null;
    if (!s) return;
    const dx = e.changedTouches[0].clientX - s.x;
    const dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) onGo(addDays(date, dx < 0 ? 7 : -7));
  };
  return html`
    <div class="day-strip card-block" onTouchStart=${start} onTouchEnd=${end}>
      <div class="ds-head">
        <button class="ds-month" onClick=${openPicker} title="Выбрать дату в календаре">
          <${Icon} name="calendar" size=${16}/> ${month} <${Icon} name="chevronDown" size=${14}/></button>
        <input ref=${picker} class="ds-picker" type="date" tabindex="-1" aria-hidden="true" value=${date}
          onChange=${(e) => e.target.value && onGo(planningDate(e.target.value, today))}/>
        <span class="ds-spacer"></span>
        ${date !== today ? html`<button class="chip ds-today" onClick=${() => onGo(today)}>↺ Сегодня</button>` : null}
        <button class="icon-btn small" aria-label="Предыдущая неделя" title="Предыдущая неделя" onClick=${() => onGo(addDays(date, -7))}><${Icon} name="back" size=${18}/></button>
        <button class="icon-btn small" aria-label="Следующая неделя" title="Следующая неделя" onClick=${() => onGo(addDays(date, 7))}><${Icon} name="chevron" size=${18}/></button>
      </div>
      <div class="ds-days" role="tablist" aria-label=${thisWeek ? tr('Эта неделя') : tr('Неделя')} onKeyDown=${onKey}>
        ${days.map((d, i) => {
          const s = stats.get(d) || { dots: 0, mark: '', title: '' };
          const cls = 'ds-day' + (d === date ? ' selected' : '') + (d === today ? ' is-today' : '') + (d < today ? ' past' : '') + (i > 4 ? ' weekend' : '');
          return html`<button role="tab" aria-selected=${d === date} tabindex=${d === date ? 0 : -1} class=${cls} key=${d}
            onClick=${() => onGo(d)} title=${s.title}>
            <small>${WEEKDAY_SHORT[i]}</small><b>${+d.slice(8)}</b>
            <span class="ds-dots" aria-hidden="true">${Array.from({ length: s.dots }, (_, k) => html`<i key=${k}></i>`)}${s.mark ? html`<em class=${s.markClass || ''}>${s.mark}</em>` : null}</span>
          </button>`;
        })}
      </div>
    </div>`;
}
