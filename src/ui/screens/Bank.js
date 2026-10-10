// «Банк задач» (обновление 0.15) — четвёртая вкладка «Поиска»: заготовки частых дел без даты (название, списки,
// приоритет, время, напоминания, повтор, подзадачи, заметки). Задача из заготовки создаётся в одно касание —
// на сегодня, на завтра или без даты; заготовку можно поправить или удалить. То же ищется в «Новой задаче».

import { html, useState, useMemo } from '../html.js';
import { Icon } from '../icons.js';
import { store, openQuickAdd } from '../../store/appState.js';
import * as A from '../../store/actions.js';
import * as S from '../../core/selectors.js';
import * as BK from '../../core/bank.js';
import { addDays } from '../../core/dates.js';
import { plural } from '../../core/plural.js';
import { PRIORITY_NONE_ID, priorityLabel } from '../../core/priorities.js';
import { templateMeta } from '../components/QuickAdd.js';
import { openMenu } from '../components/Popup.js';
import { tr } from '../../core/i18n.js';

export function TaskBank() {
  const [q, setQ] = useState('');
  const [listId, setListId] = useState(null); // null — все, 'inbox' — без списка, иначе id списка
  const readOnly = !!store.ui.readOnly;
  const today = store.now.today;
  const all = useMemo(() => BK.templateList(store.data), [store.version]);
  const rows = useMemo(() => BK.searchTemplates(store.data, q, { listId }), [store.version, q, listId]);
  // фильтр по спискам — только те, что есть у заготовок
  const lists = useMemo(() => {
    const ids = new Set(all.flatMap((t) => t.listIds));
    return S.sortedLists(store.data).filter((l) => ids.has(l.id));
  }, [all]);
  const hasInbox = all.some((t) => !t.listIds.length);

  const more = (e, tpl) => openMenu({
    anchor: e.currentTarget, side: 'bottom', align: 'end', title: tpl.title, viaKeyboard: e.detail === 0,
    items: [
      { label: tr('Создать на завтра'), icon: 'calendar', disabled: readOnly, onSelect: () => A.taskFromTemplate(tpl.id, { date: addDays(today, 1) }) },
      { label: tr('Создать без даты'), icon: 'inbox', disabled: readOnly, onSelect: () => A.taskFromTemplate(tpl.id) },
      { separator: true },
      { label: tr('Изменить заготовку'), icon: 'edit', disabled: readOnly, onSelect: () => openQuickAdd({ template: tpl.id }) },
      { label: tr('Удалить из банка'), icon: 'trash', danger: true, disabled: readOnly, onSelect: () => A.deleteTemplates([tpl.id]) },
    ],
  });

  return html`
    <header class="page-header">
      <p class="page-desc">Банк задач — заготовки частых дел, чтобы не печатать их каждый раз: списки, приоритет, время, напоминания,
        повтор, подзадачи и заметки — всё, кроме даты. Задача создаётся в одно касание здесь или в «Новой задаче» — начни печатать название.
        В банк попадают из «Новой задачи» (кнопка «В банк») и из меню задачи.</p>
      <div class="page-actions">
        <button type="button" class="btn primary" disabled=${readOnly} onClick=${() => openQuickAdd({ template: 'new' })}>
          <${Icon} name="plus" size=${16}/> Новая заготовка</button>
      </div>
    </header>
    ${all.length ? html`
      <div class="bank-tools">
        <div class="search-field">
          <${Icon} name="search" size=${16}/>
          <input value=${q} data-search-input placeholder=${tr('Найти в банке задач')} title=${tr('Ищет в названиях, заметках, подзадачах и списках')} autocomplete="off"
            aria-label="Поиск по банку задач" onInput=${(e) => setQ(e.target.value)}/>
        </div>
        ${lists.length || hasInbox ? html`<div class="chip-row scroll" role="group" aria-label="Списки">
          <button type="button" class=${'chip' + (!listId ? ' selected' : '')} onClick=${() => setListId(null)}>Все · ${all.length}</button>
          ${hasInbox && lists.length ? html`<button type="button" class=${'chip' + (listId === 'inbox' ? ' selected' : '')}
            onClick=${() => setListId(listId === 'inbox' ? null : 'inbox')}><${Icon} name="inbox" size=${14}/> Входящие</button>` : null}
          ${lists.map((l) => html`<button type="button" key=${l.id} class=${'chip' + (listId === l.id ? ' selected' : '')}
            onClick=${() => setListId(listId === l.id ? null : l.id)}><i class="dot" style=${{ background: l.color }}></i>${l.emoji ? l.emoji + ' ' : ''}${l.name}</button>`)}
        </div>` : null}
      </div>
      ${rows.length ? html`<ul class="bank-list">
        ${rows.map((tpl) => {
          const prio = store.data.priorities.get(tpl.priorityId);
          return html`<li key=${tpl.id} class="bank-row">
            <button type="button" class="bank-main" disabled=${readOnly} onClick=${() => openQuickAdd({ template: tpl.id })} title=${tr('Изменить заготовку')}>
              <span class="bank-title">
                ${prio && tpl.priorityId !== PRIORITY_NONE_ID ? html`<i class="dot" style=${{ background: prio.color }} title=${priorityLabel(prio)}></i>` : null}
                ${tpl.title}</span>
              <small class="muted">${templateMeta(tpl)}${tpl.uses ? ' · ' + tr('создана {n} {times}', { n: tpl.uses, times: plural(tpl.uses, ['раз', 'раза', 'раз']) }) : ''}</small>
            </button>
            <div class="bank-actions">
              <button type="button" class="btn small" disabled=${readOnly} onClick=${() => A.taskFromTemplate(tpl.id, { date: today })}
                title=${tr('Создать задачу на сегодня')}><${Icon} name="plus" size=${16}/> Сегодня</button>
              <button type="button" class="icon-btn" disabled=${readOnly} aria-label=${tr('Ещё: «{title}»', { title: tpl.title })} title="Ещё"
                onClick=${(e) => more(e, tpl)}><${Icon} name="dots" size=${18}/></button>
            </div>
          </li>`;
        })}
      </ul>` : html`<p class="empty">Ничего не найдено.</p>`}`
    : html`<div class="empty-state bank-empty">
        <div class="empty-emoji" aria-hidden="true">🗂️</div>
        <p>Банк пуст. Добавь сюда дела, которые приходится вписывать снова и снова — «Сходить в аптеку», «Полить цветы», «Позвонить маме».</p>
        <p class="muted small">Ещё в банк можно сохранить задачу из её меню («В банк задач») или кнопкой «В банк» в «Новой задаче».</p>
      </div>`}`;
}
