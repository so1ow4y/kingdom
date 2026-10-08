// Crimson Harvest (обновление 0.12): рационы — основные (завтрак, обед, ужин, перекус) и свои, общие для всех
// дней или только для одного дня; вставляются между основными, у каждого — название, значок и время, если нужно.
// Здесь: лист рациона (создать и изменить), лист заметки к рациону на день, меню рациона в дневнике и раздел настроек.

import { html, useState } from '../html.js';
import { Icon } from '../icons.js';
import { Sheet } from './Sheet.js';
import { TimeInput } from './TimeInput.js';
import { openMenu } from './Popup.js';
import { store, closeSheet, openSheet } from '../../store/appState.js';
import { Link, navigate } from '../router.js';
import * as FA from '../../store/feastActions.js';
import * as F from '../../core/feast.js';
import { humanDate } from '../../core/dates.js';
import { tr } from '../../core/i18n.js';

const ICONS = ['🌅', '☕', '🍳', '🥪', '🍲', '🥗', '🍝', '🍵', '🍪', '🍎', '🥤', '🏋️', '🌙', '🍷', '🍽️'];
const readOnly = () => !!store.ui.feastReadOnly;
const focusOnce = (el) => {
  if (el && !el.dataset.focused) {
    el.dataset.focused = '1';
    setTimeout(() => el.focus({ preventScroll: true }), 40);
  }
};
const dayLabel = (date) => humanDate(date, store.now.today).toLowerCase();

/** Список рационов для выбора места: рационы дня или общие. */
const placeList = (date) => (date ? F.mealsForDay(store.feast, date).filter((m) => !m.missing) : F.globalMeals(store.feast));

/**
 * Поля рациона: название, значок, время; у нового — «где» (этот день или каждый) и место; у существующего — порядок,
 * «Сделать на каждый день», скрыть, удалить. inline — на странице рациона (без листа). onDone() — после сохранения.
 */
export function MealForm({ id = null, date = null, afterId, onDone = () => {}, inline = false }) {
  const meal = id ? store.feast.meals.get(id) : null;
  const list = placeList(date);
  const [name, setName] = useState(meal?.name || '');
  const [icon, setIcon] = useState(meal?.icon || '🍽️');
  const [time, setTime] = useState(meal?.time || null);
  const [onlyDay, setOnlyDay] = useState(!!date);
  const [after, setAfter] = useState(afterId !== undefined ? afterId : list.at(-1)?.id ?? null);
  if (id && (!meal || meal.deletedAt)) return null;
  const dirty = !meal || name !== meal.name || icon !== meal.icon || (time || null) !== (meal.time || null);
  const save = async (e) => {
    e?.preventDefault();
    if (!name.trim()) return;
    if (meal) await FA.updateMeal(id, { name, icon, time });
    else await FA.createMeal({ name, icon, time, date, onlyDay: !!date && onlyDay, afterId: after });
    onDone();
  };
  const idx = meal ? list.findIndex((m) => m.id === id) : -1;
  const moveDate = meal?.date || date;
  return html`
    <form class=${'meal-form' + (inline ? ' inline' : '')} onSubmit=${save}>
      <label class="field"><span>Название</span>
        <input value=${name} maxlength=${F.MEAL_NAME_MAX} ref=${inline ? null : focusOnce} required placeholder="Например, второй завтрак"
          onInput=${(ev) => setName(ev.target.value)}/></label>
      <div class="field"><span>Значок</span>
        <div class="chip-row wrap meal-icons" role="radiogroup" aria-label="Значок рациона">
          ${[...new Set([icon, ...ICONS])].map((x) => html`<button type="button" role="radio" aria-checked=${icon === x} key=${x}
            class=${'chip icon-chip' + (icon === x ? ' selected' : '')} onClick=${() => setIcon(x)}>${x}</button>`)}
        </div>
      </div>
      <div class="field"><span>Время</span>
        <${TimeInput} value=${time} onChange=${setTime} label="Время рациона"/>
        <small class="muted">Необязательно. Если у рационов есть время, «Записать еду» сама выберет нужный по часам.</small>
      </div>
      ${!meal && date ? html`
        <div class="field"><span>Где</span>
          <div class="chip-row wrap" role="radiogroup" aria-label="Для каких дней">
            <button type="button" role="radio" aria-checked=${onlyDay} class=${'chip' + (onlyDay ? ' selected' : '')} onClick=${() => setOnlyDay(true)}>
              Только ${dayLabel(date)}</button>
            <button type="button" role="radio" aria-checked=${!onlyDay} class=${'chip' + (!onlyDay ? ' selected' : '')} onClick=${() => setOnlyDay(false)}>
              Каждый день</button>
          </div>
        </div>` : null}
      ${!meal ? html`
        <label class="field"><span>Место</span>
          <select value=${after ?? ''} onChange=${(ev) => setAfter(ev.target.value || null)}>
            <option value="">В начале</option>
            ${list.map((m) => html`<option value=${m.id}>После «${m.name}»</option>`)}
          </select></label>` : html`
        <div class="field"><span>Порядок${meal.date ? tr(' · только {p0}', { p0: dayLabel(meal.date) }) : ''}</span>
          <div class="chip-row wrap">
            <button type="button" class="btn small" disabled=${idx <= 0 || readOnly()} onClick=${() => FA.moveMeal(id, -1, moveDate)}>
              <${Icon} name="up" size=${16}/> Выше</button>
            <button type="button" class="btn small" disabled=${idx < 0 || idx >= list.length - 1 || readOnly()} onClick=${() => FA.moveMeal(id, 1, moveDate)}>
              <${Icon} name="down" size=${16}/> Ниже</button>
            ${meal.date ? html`<button type="button" class="btn small" disabled=${readOnly()}
              onClick=${() => FA.updateMeal(id, { date: null })}>Сделать на каждый день</button>` : null}
          </div>
        </div>`}
      <div class=${inline ? 'form-actions' : 'sheet-actions'}>
        ${meal && !F.isDefaultMeal(meal) ? html`<button type="button" class="btn danger-outline" disabled=${readOnly()}
          onClick=${async () => { if (await FA.deleteMeal(id)) onDone(true); }}><${Icon} name="trash" size=${16}/> Удалить</button>` : null}
        ${meal && !meal.date ? html`<button type="button" class="btn" disabled=${readOnly()}
          onClick=${() => { if (!inline) onDone(); FA.setMealHidden(id, !meal.archived); }}>
          <${Icon} name="archive" size=${16}/> ${meal.archived ? tr('Показывать') : tr('Скрыть')}</button>` : null}
        <button type="submit" class="btn primary" disabled=${!name.trim() || readOnly() || (inline && !dirty)}>${meal ? tr('Сохранить') : tr('Добавить')}</button>
      </div>
    </form>`;
}

/** Лист рациона: id — изменить; без id — новый (date — день из дневника, null — из настроек; afterId — после какого). */
export function MealSheet({ id = null, date = null, afterId }) {
  const meal = id ? store.feast.meals.get(id) : null;
  if (id && (!meal || meal.deletedAt)) return null;
  return html`
    <${Sheet} title=${meal ? tr('Рацион') : tr('Новый рацион')} onClose=${closeSheet} className="meal-sheet">
      <${MealForm} id=${id} date=${date} afterId=${afterId} onDone=${closeSheet}/>
    <//>`;
}

/** Заметка к рациону на день: что-то общее для всего приёма пищи. */
export function MealNoteSheet({ date, meal }) {
  const cur = F.mealNoteOf(store.feast, date, meal);
  const info = F.mealInfo(store.feast, meal);
  const [text, setText] = useState(cur?.text || '');
  const save = async () => {
    await FA.setMealNote(date, meal, text);
    closeSheet();
  };
  return html`
    <${Sheet} title=${tr('Заметка · {name}', { name: info.name })} onClose=${closeSheet}>
      <p class="muted small">${humanDate(date, store.now.today)}: что-то о рационе целиком — где ели, самочувствие, что запомнить.</p>
      <textarea class="note-area" rows="5" maxlength=${F.NOTE_MAX} value=${text} ref=${focusOnce}
        placeholder="Например: ел(а) в кафе, порции на глаз" onInput=${(e) => setText(e.target.value)}
        onKeyDown=${(e) => (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) && save()}></textarea>
      <div class="sheet-actions">
        ${cur ? html`<button type="button" class="btn danger-outline" disabled=${readOnly()}
          onClick=${async () => { await FA.setMealNote(date, meal, ''); closeSheet(); }}>Убрать заметку</button>` : null}
        <button type="button" class="btn primary" disabled=${readOnly()} onClick=${save}>Сохранить</button>
      </div>
    <//>`;
}

/** Меню рациона в дневнике (кнопка ⋮ в заголовке). */
export function openMealMenu(e, meal, date, { onCopy = null } = {}) {
  const ro = readOnly();
  const hasNote = !!F.mealNoteOf(store.feast, date, meal.id);
  openMenu({
    anchor: e.currentTarget,
    side: 'bottom',
    align: 'end',
    title: meal.name,
    viaKeyboard: e.detail === 0,
    items: [
      { label: hasNote ? tr('Изменить заметку') : tr('Заметка к рациону'), icon: 'edit', disabled: ro, onSelect: () => openSheet('mealNote', { date, meal: meal.id }) },
      ...(meal.missing ? [] : [
        { label: tr('Открыть рацион'), icon: 'lists', onSelect: () => navigate(`/meal/${meal.id}${date === store.now.today || meal.date ? '' : '?date=' + date}`) },
        { label: tr('Изменить рацион'), icon: 'settings', disabled: ro, onSelect: () => openSheet('meal', { id: meal.id, date }) },
      ]),
      { label: tr('Новый рацион после'), icon: 'plus', disabled: ro, onSelect: () => openSheet('meal', { date, afterId: meal.missing ? undefined : meal.id }) },
      ...(onCopy ? [{ label: tr('Скопировать на завтра'), icon: 'copy2', disabled: ro, onSelect: onCopy }] : []),
      { separator: true },
      ...(meal.missing ? [] : meal.date
        ? [{ label: tr('Удалить рацион этого дня'), icon: 'trash', danger: true, disabled: ro, onSelect: () => FA.deleteMeal(meal.id) }]
        : [{ label: tr('Скрыть с новых дней'), icon: 'archive', disabled: ro, onSelect: () => FA.setMealHidden(meal.id, true) },
          ...(F.isDefaultMeal(meal) ? [] : [{ label: tr('Удалить рацион'), icon: 'trash', danger: true, disabled: ro, onSelect: () => FA.deleteMeal(meal.id) }])]),
    ],
  });
}

/** Общие рационы по порядку (страница «Рационы» и настройки): ссылки на страницы, порядок, изменить, скрытые. */
export function MealsSection({ page = false }) {
  const list = F.globalMeals(store.feast);
  const shown = list.filter((m) => !m.archived);
  const hidden = list.filter((m) => m.archived);
  const ro = readOnly();
  const row = (m) => {
    const i = shown.indexOf(m);
    return html`<li class="meal-set-row" key=${m.id}>
      <span class="meal-icon" aria-hidden="true">${m.icon}</span>
      <${Link} to=${'/meal/' + m.id} className="msr-name" title="Открыть рацион (Ctrl+клик — в новой вкладке)">${m.name}<//>
      <span class="muted msr-time">${m.time || ''}</span>
      ${m.archived ? html`<button type="button" class="btn small" disabled=${ro} onClick=${() => FA.setMealHidden(m.id, false)}>Показывать</button>` : html`
        <button type="button" class="icon-btn small" disabled=${ro || i <= 0} aria-label=${tr('Выше: ') + m.name} data-hint="Выше"
          onClick=${() => FA.moveMeal(m.id, -1)}><${Icon} name="up" size=${16}/></button>
        <button type="button" class="icon-btn small" disabled=${ro || i >= shown.length - 1} aria-label=${tr('Ниже: ') + m.name} data-hint="Ниже"
          onClick=${() => FA.moveMeal(m.id, 1)}><${Icon} name="down" size=${16}/></button>`}
      <button type="button" class="icon-btn small" disabled=${ro} aria-label=${tr('Изменить: ') + m.name} data-hint="Изменить"
        onClick=${() => openSheet('meal', { id: m.id })}><${Icon} name="edit" size=${16}/></button>
    </li>`;
  };
  return html`
    <section class="set-section" id="feast-meals">
      ${page ? null : html`<h2>Рационы</h2>`}
      <p class="muted">Общие рационы — на каждый день, в этом порядке. Свои можно вставлять между основными; рацион только для
        одного дня, заметку к рациону и время приёма пищи добавляют прямо в дневнике (кнопка ⋮ у рациона).
        У каждого рациона своя страница — как у списка задач: записи по дням, частые продукты, настройки.</p>
      <ul class="meal-set-list">${shown.map(row)}</ul>
      <button type="button" class="btn" disabled=${ro} onClick=${() => openSheet('meal', {})}><${Icon} name="plus" size=${16}/> Новый рацион</button>
      ${hidden.length ? html`<h3>Скрытые</h3>
        <p class="muted small">Их нет в новых днях; дни, где в них есть записи, показывают их как раньше.</p>
        <ul class="meal-set-list">${hidden.map(row)}</ul>` : null}
    </section>`;
}
