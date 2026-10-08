// Crimson Harvest (0.11, «Feast»): «Дневник» питания в духе FatSecret — день недели, сводка «Осталось 247 / −247»,
// рационы с записями, итоги дня по всем веществам. 0.12: свои рационы (на каждый день или только на этот),
// время и заметка у рациона и записи, записи из нескольких продуктов.

import { html, useMemo, useState } from '../html.js';
import { Icon } from '../icons.js';
import { DayStrip } from '../components/DayStrip.js';
import { Banner } from '../components/Overlays.js';
import { DaySummary, NutrientTable, macroLine, feastGoals, rewardLine } from '../components/FeastParts.js';
import { openAddFood } from '../components/AddFood.js';
import { openMealMenu } from '../components/Meals.js';
import { navigate, Link } from '../router.js';
import { store, openSheet } from '../../store/appState.js';
import * as FA from '../../store/feastActions.js';
import * as F from '../../core/feast.js';
import { entryNutrients, itemNutrients, sumNutrients, nv, fmt, amountLabel } from '../../core/nutrition.js';
import { addDays, humanDate } from '../../core/dates.js';
import { planningDate } from '../../core/planning.js';
import { countLabel } from '../../core/plural.js';
import { getPrefs } from '../prefs.js';
import { tr } from '../../core/i18n.js';

/** Точки полосы недели для Feast: день записан — точка, сверх лимита — «!». */
function feastMarks(days) {
  const goal = feastGoals().kcal;
  const series = new Map(F.dailySeries(store.feast, days[0], days.at(-1)).map((d) => [d.date, d]));
  return new Map(days.map((d) => {
    const s = series.get(d);
    if (!s || !s.count) return [d, { dots: 0, mark: '', title: tr('Записей нет') }];
    const kcal = Math.round(nv(s.totals, 'kcal'));
    const over = kcal > goal;
    return [d, { dots: over ? 0 : 1, mark: over ? '!' : '', markClass: 'over', title: tr('{kcal} ккал{p1}', { kcal, p1: over ? tr(' — сверх лимита') : '' }) }];
  }));
}

/** Запись дневника: время, продукт (или несколько — списком), заметка; нажатие — изменить. */
/** Какие заметки показывать (0.12.5, Настройки → Дневник и хранение): заметки к продуктам записи и из карточек. */
export function noteDisplay(where = 'diary') {
  const p = getPrefs().feastNotes || {};
  const on = (k, def) => (typeof p[k] === 'boolean' ? p[k] : def);
  return where === 'meals'
    ? { item: on('itemMeals', true), food: on('foodMeals', false) }
    : { item: on('itemDiary', true), food: on('foodDiary', false) };
}

/** Запись дневника: время, продукты и лекарства (несколько — списком), заметки; нажатие — изменить. */
function EntryRow({ e, where = 'diary' }) {
  const n = entryNutrients(e);
  const items = F.entryItems(e);
  const multi = items.length > 1;
  const show = noteDisplay(where);
  const onlyMeds = !F.hasFood(e);
  const notesOf = (it) => {
    const out = [];
    if (show.item && it.note) out.push(html`<small class="er-item-note" key="i">${it.note}</small>`);
    const f = show.food && it.foodId ? store.feast.foods.get(it.foodId) : null;
    if (f && !f.deletedAt && f.note) out.push(html`<small class="er-food-note" key="f">📝 ${f.note}</small>`);
    return out;
  };
  const line = (it) => (F.isMed(it) ? html`<small class="muted">${amountLabel(it)}</small>`
    : html`<small class="muted">${amountLabel(it)} · ${fmt(nv(itemNutrients(it), 'kcal'), 'kcal')}</small>`);
  return html`<button type="button" class=${'entry-row' + (multi ? ' multi' : '') + (onlyMeds ? ' meds-only' : '')} onClick=${() => openSheet('entry', { id: e.id })}>
    ${e.time ? html`<span class="er-time">${e.time}</span>` : null}
    <span class="er-main">
      ${multi ? html`
        <span class="er-items">${items.map((it) => html`<span class="er-item-wrap" key=${it.id}><span class="er-item">
          <span class="er-name">${F.isMed(it) ? '💊 ' : ''}${it.name}</span>${line(it)}</span>
          ${notesOf(it)}</span>`)}</span>
        ${onlyMeds ? null : html`<small class="muted">${macroLine(n)}</small>`}` : html`
        <span class="er-name">${items[0] && F.isMed(items[0]) ? '💊 ' : ''}${items[0]?.name || tr('Запись')}</span>
        <small class="muted">${items[0] ? amountLabel(items[0]) : ''}${onlyMeds ? '' : (items[0] ? ' · ' : '') + macroLine(n)}</small>
        ${items[0] ? notesOf(items[0]) : null}`}
      ${F.entryNoteList(e).map((note) => html`<small class="er-note" key=${note.id}>${note.text}</small>`)}
    </span>
    <b class="er-kcal">${onlyMeds ? '💊' : fmt(nv(n, 'kcal'), 'kcal')}</b>
  </button>`;
}

/** Рацион дня: заголовок (значок, название, время, калории, «+», ⋮), заметка к рациону, записи. */
export function MealBlock({ meal, list, date, readOnly, link = true }) {
  const kcal = nv(sumNutrients(list.map(entryNutrients)), 'kcal');
  const note = F.mealNoteOf(store.feast, date, meal.id);
  const label = F.mealName(meal).toLowerCase();
  const tomorrow = addDays(date, 1);
  return html`
    <section class=${'meal card-block' + (meal.date ? ' day-only' : '')} aria-label=${F.mealName(meal)}>
      <header class="meal-head">
        <span class="meal-icon" aria-hidden="true">${meal.icon}</span>
        <span class="meal-title">
          ${link && !meal.missing ? html`<${Link} to=${`/meal/${meal.id}${date === store.now.today || meal.date ? '' : '?date=' + date}`}
            className="meal-name" title="Открыть рацион (Ctrl+клик — в новой вкладке)">${F.mealName(meal)}<//>` : html`<b class="meal-name">${F.mealName(meal)}</b>`}
          ${meal.time || meal.date ? html`<small class="meal-meta">
            ${meal.time ? html`<span class="meal-time" title="Время рациона">${meal.time}</span>` : null}
            ${meal.date ? html`<span class="meal-tag" title="Этот рацион — только на этот день">только этот день</span>` : null}
          </small>` : null}
        </span>
        <span class="meal-kcal">${list.length ? tr('{p0} ккал', { p0: fmt(kcal, 'kcal') }) : ''}</span>
        <button type="button" class="icon-btn small" disabled=${readOnly} aria-label=${tr('Записать: ') + label}
          data-hint=${tr('Записать: ') + label} onClick=${() => openAddFood({ date, meal: meal.id })}><${Icon} name="plus" size=${20}/></button>
        <button type="button" class="icon-btn small" aria-label=${tr('Ещё: ') + label} aria-haspopup="menu" data-hint="Рацион: заметка, изменить, новый"
          onClick=${(ev) => openMealMenu(ev, meal, date, { onCopy: list.length ? () => FA.copyEntries(date, tomorrow, meal.id) : null })}>
          <${Icon} name="dots" size=${18}/></button>
      </header>
      ${note ? html`<button type="button" class="meal-note" disabled=${readOnly} onClick=${() => openSheet('mealNote', { date, meal: meal.id })}
        aria-label=${tr('Заметка к рациону: ') + note.text}><${Icon} name="edit" size=${14}/><span>${note.text}</span></button>` : null}
      ${list.length ? list.map((e) => html`<${EntryRow} key=${e.id} e=${e} where=${link ? 'diary' : 'meals'}/>`)
        : html`<button type="button" class="meal-empty" disabled=${readOnly} onClick=${() => openAddFood({ date, meal: meal.id })}>+ Записать</button>`}
    </section>`;
}

export function DiaryScreen({ query = {} }) {
  const date = planningDate(query.date, store.now.today);
  const go = (d) => navigate(d === store.now.today ? '/diary' : '/diary?date=' + d);
  const day = useMemo(() => F.dayTotals(store.feast, date), [store.version, date]);
  const meals = useMemo(() => F.mealsForDay(store.feast, date, new Set(Object.keys(day.entries))), [day]);
  const [details, setDetails] = useState(false);
  const yesterday = addDays(date, -1);
  const prevCount = useMemo(() => Object.values(F.dayEntries(store.feast, yesterday)).flat().length, [store.version, yesterday]);
  const readOnly = !!store.ui.feastReadOnly;
  const dayReward = useMemo(() => F.dayRewards(store.feast, date), [store.version, date]);

  return html`
    <div class="screen diary">
      ${store.ui.feastReadOnly ? html`<${Banner} tone="danger">${store.ui.feastReadOnly}<//>` : null}
      <${DayStrip} date=${date} onGo=${go} marksFn=${feastMarks}/>
      <${DaySummary} totals=${day.totals}/>
      ${store.data.settings?.gameEnabled && F.hasRewards(dayReward) ? html`<p class="day-rewards" title="Награды за еду этого дня — в общий баланс игры">
        За еду: ${rewardLine(dayReward)}</p>` : null}
      ${day.archived ? html`<p class="hint">Записи этого дня удалены лимитом хранения — итоги остались в аналитике.</p>` : null}

      ${meals.map((m) => html`<${MealBlock} key=${m.id} meal=${m} list=${day.entries[m.id] || []} date=${date} readOnly=${readOnly}/>`)}

      <div class="form-actions wrap">
        ${!day.count && prevCount ? html`<button type="button" class="btn" disabled=${readOnly}
          onClick=${() => FA.copyEntries(yesterday, date)}><${Icon} name="copy2" size=${16}/> Как ${humanDate(yesterday, store.now.today).toLowerCase()}: ${countLabel(prevCount, ['запись', 'записи', 'записей'])}</button>` : null}
        <button type="button" class="btn" disabled=${readOnly} onClick=${() => openAddFood({ date, scan: true })}><${Icon} name="barcode" size=${16}/> Сканировать</button>
        <button type="button" class="btn" disabled=${readOnly} onClick=${() => openAddFood({ date, kind: 'med' })}>💊 Лекарство</button>
        <button type="button" class="btn" disabled=${readOnly} onClick=${() => openSheet('meal', { date })}><${Icon} name="plus" size=${16}/> Рацион</button>
        ${day.count ? html`<button type="button" class="btn ghost" onClick=${() => setDetails(!details)} aria-expanded=${details}>
          <${Icon} name=${details ? 'chevronDown' : 'chevron'} size=${16}/> Витамины и минералы за день</button>` : null}
      </div>
      ${details ? html`<section class="card-block"><${NutrientTable} values=${day.totals} groups=${['more', 'vitamins', 'minerals']}/>
        ${!Object.keys(day.totals).some((k) => !['kcal', 'protein', 'fat', 'carbs'].includes(k) && day.totals[k] > 0)
          ? html`<p class="muted small">У записанных продуктов витамины и минералы не указаны — их можно заполнить в карточке продукта.</p>` : null}</section>` : null}
    </div>`;
}
