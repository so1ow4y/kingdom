// Корзина Crimson Harvest (0.14): удалённые записи дневника, продукты, лекарства, замеры, вес и обхваты, рационы.
// Снимки лежат в коллекции trash (синхронизируются); вернуть — со свежими метками, на всех устройствах. Через
// trashDays дней (настройка, 1…365) — навсегда.

import { html, useState, useEffect } from '../html.js';
import { Icon } from '../icons.js';
import { store } from '../../store/appState.js';
import * as FA from '../../store/feastActions.js';
import * as F from '../../core/feast.js';
import { entryNutrients, nv, fmt, amountLabel } from '../../core/nutrition.js';
import { humanDate, localDateOf, nowTimeIn, daysBetween } from '../../core/dates.js';
import { countLabel } from '../../core/plural.js';
import { NumField } from '../components/FeastParts.js';
import { FEAST_RETENTION } from '../../config.js';
import { tr } from '../../core/i18n.js';

const KINDS = [['all', tr('Всё')], ['entry', tr('Записи')], ['food', tr('Продукты')], ['med', tr('Лекарства')], ['measure', tr('Замеры')],
  ['body', tr('Вес и обхваты')], ['meal', tr('Рационы')]];

/** Что показать в строке: значок, название, подробности. */
function describe(r, today) {
  const s = r.snapshot;
  const k = F.trashKind(r);
  if (k === 'entry') {
    const kcal = nv(entryNutrients(s), 'kcal');
    const items = F.entryItems(s);
    const meal = F.mealInfo(store.feast, s.meal);
    return {
      icon: items.length ? meal.icon || '🍽️' : '📝',
      title: F.entryTitle(s),
      sub: [items.length ? tr('Запись') : tr('Заметка'), humanDate(s.date, today) + (s.time ? ' ' + s.time : ''), F.mealName(meal), kcal ? `${fmt(kcal, 'kcal')} ${tr('ккал')}` : null].filter(Boolean).join(' · '),
      hint: meal.missing && store.feast.meals.get(s.meal)?.deletedAt ? tr('Рацион тоже удалён — его можно вернуть отдельно.') : null,
    };
  }
  if (k === 'food') {
    return { icon: '🥫', title: s.name + (s.brand ? ` (${s.brand})` : ''), sub: `${tr('Продукт')} · ${fmt(nv(s.nutrients, 'kcal'), 'kcal')} ${tr('ккал')} ${s.unit === 'ml' ? tr('на 100 мл') : tr('на 100 г')}` };
  }
  if (k === 'med') return { icon: F.kindIcon(s), title: s.name, sub: `${tr('Лекарство')} · ${tr('доза')} ${amountLabel({ unit: s.unit, amount: s.dose || 1 })}` };
  if (k === 'measure') return { icon: F.kindIcon(s), title: s.name, sub: `${tr('Замер')}${s.unit ? ' · ' + tr(s.unit) : ''}` };
  if (k === 'body') {
    const parts = [s.weightKg ? `${fmt(s.weightKg, 'x')} ${tr('кг')}` : null, s.waistCm ? tr('талия {v} см', { v: fmt(s.waistCm, 'x') }) : null,
      s.bodyFatPct ? tr('жир {v} %', { v: fmt(s.bodyFatPct, 'x') }) : null].filter(Boolean);
    return { icon: '⚖️', title: tr('Вес и обхваты · {date}', { date: humanDate(s.date, today) }), sub: parts.join(' · ') || tr('Замер тела') };
  }
  if (k === 'meal') return { icon: s.icon || '🍽️', title: F.mealName(s), sub: s.date ? tr('Рацион на {date}', { date: humanDate(s.date, today) }) : tr('Рацион') };
  return { icon: '•', title: r.entityId, sub: '' };
}

export function FeastTrashScreen() {
  const today = store.now.today;
  const tz = store.data.settings?.timeZone;
  const ro = !!store.ui.feastReadOnly;
  const [kind, setKind] = useState('all');
  const [q, setQ] = useState('');
  useEffect(() => {
    FA.purgeFeastTrash();
  }, []);
  const days = F.trashDaysOf(store.feast.settings);
  const all = F.trashList(store.feast);
  const counts = {};
  for (const r of all) counts[F.trashKind(r)] = (counts[F.trashKind(r)] || 0) + 1;
  const needle = q.trim().toLowerCase();
  const rows = all.map((r) => ({ r, d: describe(r, today) }))
    .filter(({ r, d }) => (kind === 'all' || F.trashKind(r) === kind) && (!needle || (d.title + ' ' + d.sub).toLowerCase().includes(needle)));
  const left = (r) => Math.max(0, days - daysBetween(localDateOf(r.trashedAt, tz), today));
  return html`
    <div class="screen feast-trash">
      <header class="page-header">
        <p class="page-desc">${tr('Удалённые записи, продукты, лекарства, замеры и рационы хранятся здесь {p0}, потом удаляются навсегда. Вернуть можно с любого устройства.', { p0: countLabel(days, ['день', 'дня', 'дней']) })}</p>
        <div class="page-actions">
          ${rows.length > 1 ? html`<button type="button" class="btn" disabled=${ro} onClick=${() => FA.restoreTrash(rows.map((x) => x.r.id))}>
            <${Icon} name="restore" size=${16}/> ${tr('Вернуть показанные')}</button>` : null}
          ${all.length ? html`<button type="button" class="btn danger-outline" disabled=${ro} onClick=${FA.emptyFeastTrash}>
            <${Icon} name="trash" size=${16}/> ${tr('Очистить корзину')}</button>` : null}
        </div>
      </header>
      <div class="trash-keep">
        <${NumField} label=${tr('Хранить в корзине, дней')} value=${days} disabled=${ro} placeholder=${String(FEAST_RETENTION.trashDefault)} onCommit=${FA.setTrashDays}/>
        <p class="muted small">${tr('От {min} до {max}. Записи, удалённые лимитом или сроком хранения истории, сюда не попадают — их итоги остаются в аналитике.', { min: FEAST_RETENTION.trashMin, max: FEAST_RETENTION.trashMax })}</p>
      </div>
      ${all.length ? html`
        <div class="chip-row wrap" role="tablist" aria-label=${tr('Что показать')}>
          ${KINDS.filter(([k]) => k === 'all' || counts[k]).map(([k, l]) => html`<button type="button" role="tab" key=${k} aria-selected=${kind === k}
            class=${'chip' + (kind === k ? ' selected' : '')} onClick=${() => setKind(k)}>${l} <small>${k === 'all' ? all.length : counts[k]}</small></button>`)}
        </div>
        <input class="trash-search" type="search" value=${q} placeholder=${tr('Найти в корзине')} aria-label=${tr('Найти в корзине')} onInput=${(e) => setQ(e.target.value)}/>
        <ul class="trash-list">
          ${rows.map(({ r, d }) => html`<li key=${r.id} class="trash-row">
            <span class="tr-icon" aria-hidden="true">${d.icon}</span>
            <span class="tr-main">
              <b>${d.title}</b>
              ${d.sub ? html`<small class="muted">${d.sub}</small>` : null}
              <small class="muted">${tr('Удалено {when} в {time} · навсегда через {left}', {
                when: humanDate(localDateOf(r.trashedAt, tz), today).toLowerCase(), time: nowTimeIn(tz, new Date(r.trashedAt)), left: countLabel(left(r), ['день', 'дня', 'дней']) })}</small>
              ${d.hint ? html`<small class="hint">${d.hint}</small>` : null}
            </span>
            <span class="tr-actions">
              <button type="button" class="btn small" disabled=${ro} onClick=${() => FA.restoreTrash([r.id])}><${Icon} name="restore" size=${14}/> ${tr('Вернуть')}</button>
              <button type="button" class="icon-btn small danger" disabled=${ro} title=${tr('Удалить навсегда')} aria-label=${tr('Удалить навсегда: {p0}', { p0: d.title })}
                onClick=${() => FA.deleteTrashForever([r.id])}><${Icon} name="close" size=${16}/></button>
            </span>
          </li>`)}
        </ul>
        ${!rows.length ? html`<p class="muted">${tr('Ничего не найдено.')}</p>` : null}` : html`<div class="card-block"><p class="muted">${tr('Корзина пуста. Удалённые записи, продукты, лекарства, замеры и рационы появятся здесь — их можно будет вернуть.')}</p></div>`}
    </div>`;
}
