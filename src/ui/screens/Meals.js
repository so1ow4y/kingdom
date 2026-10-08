// Crimson Harvest (обновление 0.12): рационы — как списки у задач. «Рационы» (#/meals) — все общие рационы
// по порядку; страница рациона (#/meal/<id>[?date=…]) — записи этого рациона по дням (полоса недели), заметка,
// частые продукты, дни с записями за месяц и настройки рациона прямо на странице. Каждую можно открыть в новой вкладке.

import { html, useMemo } from '../html.js';
import { Icon } from '../icons.js';
import { DayStrip } from '../components/DayStrip.js';
import { Banner } from '../components/Overlays.js';
import { MealsSection, MealForm } from '../components/Meals.js';
import { MealBlock } from './Diary.js';
import { Link, navigate, openFood } from '../router.js';
import { store, openSheet } from '../../store/appState.js';
import * as F from '../../core/feast.js';
import { nv, fmt } from '../../core/nutrition.js';
import { addDays, humanDate } from '../../core/dates.js';
import { planningDate } from '../../core/planning.js';
import { countLabel } from '../../core/plural.js';

const ENTRIES = ['запись', 'записи', 'записей'];

export function MealsScreen() {
  const today = store.now.today;
  const dayOnly = F.mealsForDay(store.feast, today).filter((m) => m.date === today);
  return html`
    <div class="screen meals-screen">
      ${store.ui.feastReadOnly ? html`<${Banner} tone="danger">${store.ui.feastReadOnly}<//>` : null}
      <${MealsSection} page=${true}/>
      ${dayOnly.length ? html`<section class="set-section">
        <h2>Только сегодня</h2>
        <ul class="meal-set-list">${dayOnly.map((m) => html`<li class="meal-set-row" key=${m.id}>
          <span class="meal-icon" aria-hidden="true">${m.icon}</span>
          <${Link} to=${'/meal/' + m.id} className="msr-name">${m.name}<//>
          <span class="muted msr-time">${m.time || ''}</span>
        </li>`)}</ul>
      </section>` : null}
    </div>`;
}

export function MealScreen({ mealId, query = {} }) {
  const meal = store.feast.meals.get(mealId);
  const live = meal && !meal.deletedAt;
  const today = store.now.today;
  const date = live && meal.date ? meal.date : planningDate(query.date, today);
  const readOnly = !!store.ui.feastReadOnly;
  const go = (d) => navigate(`/meal/${encodeURIComponent(mealId)}${d === today ? '' : '?date=' + d}`, { replace: true });
  const day = useMemo(() => F.dayTotals(store.feast, date), [store.version, date]);
  const from = addDays(today, -29);
  const stats = useMemo(() => F.mealStats(store.feast, mealId, from, today), [store.version, mealId, from, today]);
  const marks = useMemo(() => (days) => {
    const s = F.mealStats(store.feast, mealId, days[0], days.at(-1));
    const by = new Map(s.days.map((d) => [d.date, d]));
    return new Map(days.map((d) => {
      const x = by.get(d);
      return [d, x ? { dots: 1, mark: '', title: `${Math.round(x.kcal)} ккал${x.count ? ' · ' + countLabel(x.count, ENTRIES) : ''}` } : { dots: 0, mark: '', title: 'Записей нет' }];
    }));
  }, [mealId]);
  if (!live) {
    return html`<div class="screen meal-screen"><p class="muted">Этого рациона больше нет — его удалили.
      <${Link} to="/meals">Все рационы<//></p></div>`;
  }
  return html`
    <div class="screen meal-screen">
      ${readOnly ? html`<${Banner} tone="danger">${store.ui.feastReadOnly}<//>` : null}
      ${meal.date ? html`<p class="hint">Этот рацион — только на ${humanDate(meal.date, today).toLowerCase()}.
          <${Link} to=${meal.date === today ? '/diary' : '/diary?date=' + meal.date}>Открыть день в дневнике<//></p>`
        : html`<${DayStrip} date=${date} onGo=${go} marksFn=${marks}/>`}
      ${meal.archived ? html`<p class="hint">Рацион скрыт: в новых днях его нет. Вернуть — кнопкой «Показывать» ниже.</p>` : null}
      <${MealBlock} meal=${meal} list=${day.entries[meal.id] || []} date=${date} readOnly=${readOnly} link=${false}/>
      ${date !== today && !meal.date ? html`<p class="muted small"><${Link} to=${'/diary?date=' + date}>Весь день в дневнике<//></p>` : null}

      <section class="card-block meal-stats">
        <h3>За 30 дней</h3>
        ${stats.days.length ? html`
          <div class="stat-tiles">
            <div class="stat-tile"><span>В среднем</span><b>${fmt(stats.avgKcal, 'kcal')}</b><small>ккал в день с записями</small></div>
            <div class="stat-tile"><span>Дней</span><b>${stats.days.length}</b><small>из 30</small></div>
            <div class="stat-tile"><span>Записей</span><b>${stats.entries}</b><small>в этом рационе</small></div>
          </div>
          ${stats.topFoods.length ? html`<h4 class="add-sub">Чаще всего</h4>
            <ul class="meal-top">${stats.topFoods.map((f) => html`<li key=${f.key}>
              ${f.foodId && store.feast.foods.get(f.foodId) && !store.feast.foods.get(f.foodId).deletedAt
                ? html`<button type="button" class="link-btn" onClick=${() => openFood(f.foodId)}>${f.name}</button>` : html`<span>${f.name}</span>`}
              <small class="muted">${countLabel(f.count, ['раз', 'раза', 'раз'])} · ${fmt(f.kcal, 'kcal')} ккал</small></li>`)}</ul>` : null}
          <h4 class="add-sub">Дни</h4>
          <ul class="meal-days">${stats.days.slice(0, 14).map((d) => html`<li key=${d.date}>
            <button type="button" class=${'link-btn' + (d.date === date ? ' current' : '')} onClick=${() => go(d.date)}>${humanDate(d.date, today)}</button>
            <small class="muted">${d.count ? countLabel(d.count, ENTRIES) + ' · ' : ''}${fmt(d.kcal, 'kcal')} ккал</small></li>`)}</ul>`
          : html`<p class="muted">За последние 30 дней в этом рационе записей нет.</p>`}
      </section>

      <section class="set-section">
        <h2>Настройки рациона</h2>
        <${MealForm} key=${meal.id + (meal.updatedAt || '')} id=${meal.id} date=${meal.date || date} inline=${true}
          onDone=${(deleted) => deleted && navigate('/meals', { replace: true })}/>
      </section>
    </div>`;
}
