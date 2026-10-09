// Переключатель окна графика (0.14): «За период» или конкретный день (по часам), неделя (по дням), год (по месяцам)
// со стрелками «‹ ›». Границы окна — core/timeWindow.js; общий для аналитики лекарств и задач.

import { html } from '../html.js';
import * as TW from '../../core/timeWindow.js';
import { dayLabel, longDate } from '../../core/dates.js';
import { tr, isEn } from '../../core/i18n.js';

/** «Сегодня», «Пт, 9 окт», «5–11 октября», «28 сентября – 4 октября», «2026». */
export function windowLabel(group, anchor, today) {
  const u = TW.windowUnit(group);
  const r = TW.windowRange(group, anchor);
  if (!r) return '';
  const year = (d) => (d.slice(0, 4) !== today.slice(0, 4) ? ' ' + d.slice(0, 4) : '');
  if (u === 'day') return anchor === today ? tr('Сегодня') : dayLabel(anchor) + year(anchor);
  if (u === 'week') {
    if (r.from.slice(0, 7) === r.to.slice(0, 7)) {
      return (isEn() ? `${longDate(r.from)}–${+r.to.slice(8)}` : `${+r.from.slice(8)}–${longDate(r.to)}`) + year(r.to);
    }
    return `${longDate(r.from)}${year(r.from)} – ${longDate(r.to)}${year(r.to)}`;
  }
  return anchor.slice(0, 4);
}

/** Окно при смене группировки: то, где лежит конец прежнего окна (но не позже сегодня). */
export function regroupAnchor(oldGroup, anchor, newGroup, today) {
  if (!anchor || !TW.windowUnit(newGroup)) return null;
  const r = TW.windowRange(oldGroup, anchor);
  const ref = r && r.to < today ? r.to : today;
  return TW.anchorOf(newGroup, ref);
}

const ONE = { day: tr('Один день'), week: tr('Одна неделя'), year: tr('Один год') };

export function TimeWindow({ group, anchor, setAnchor, today, periodLabel = tr('За период') }) {
  const u = TW.windowUnit(group);
  if (!u) return null;
  const cur = TW.anchorOf(group, today);
  return html`<div class="time-window" role="group" aria-label=${tr('Что показать на графике')}>
    <button type="button" class=${'chip' + (!anchor ? ' selected' : '')} aria-pressed=${!anchor} onClick=${() => setAnchor(null)}>${periodLabel}</button>
    <span class="tw-step">
      <button type="button" class="chip tw-arrow" aria-label=${tr('Раньше')} title=${tr('Раньше')}
        onClick=${() => setAnchor(anchor ? TW.shiftWindow(group, anchor, -1) : cur)}>‹</button>
      <button type="button" class=${'chip tw-label' + (anchor ? ' selected' : '')} aria-pressed=${!!anchor}
        onClick=${() => setAnchor(anchor || cur)}>${anchor ? windowLabel(group, anchor, today) : ONE[u]}</button>
      <button type="button" class="chip tw-arrow" aria-label=${tr('Позже')} title=${tr('Позже')} disabled=${!TW.canGoNext(group, anchor, today)}
        onClick=${() => setAnchor(TW.shiftWindow(group, anchor, 1))}>›</button>
    </span>
  </div>`;
}
