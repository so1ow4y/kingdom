// «Списки» и экран отдельного списка (docs/TZ.md §6.5).

import { html, useMemo, useState } from '../html.js';
import { Section, Empty } from '../components/Section.js';
import { TaskList, TaskTree } from '../components/TaskRow.js';
import { SortableList, DragHandle } from '../components/Sortable.js';
import { Icon } from '../icons.js';
import { Link, navigate } from '../router.js';
import { store, openSheet } from '../../store/appState.js';
import * as A from '../../store/actions.js';
import * as S from '../../core/selectors.js';

function ListRow({ list, count, handle = null, reorder = false, onUp, onDown }) {
  return html`
    <div class="list-row">
      <${Link} to=${'/list/' + list.id} className="list-link">
        <i class="list-color" style=${{ background: list.color }}></i>
        <span class="list-emoji">${list.emoji || '•'}</span>
        <span class="list-name">${list.name}</span>
        <span class="list-count">${count || ''}</span>
      <//>
      ${reorder ? html`
        <button class="icon-btn" onClick=${onUp} aria-label="Выше" disabled=${!onUp}><${Icon} name="up" size=${18}/></button>
        <button class="icon-btn" onClick=${onDown} aria-label="Ниже" disabled=${!onDown}><${Icon} name="down" size=${18}/></button>
        <${DragHandle} handle=${handle}/>` : null}
    </div>`;
}

export function ListsScreen() {
  const lists = useMemo(() => S.sortedLists(store.data), [store.version]);
  const archived = useMemo(() => S.sortedLists(store.data, { archived: true }), [store.version]);
  const counts = useMemo(() => S.activeCounts(store.data), [store.version]);
  const [reorder, setReorder] = useState(false);
  const readOnly = !!store.ui.readOnly;

  const move = (id, index) => A.reorderList(id, lists, index);

  return html`
    <div class="screen lists-screen">
      <div class="toolbar">
        <button class="btn primary" onClick=${() => openSheet('listEditor', { listId: null })} disabled=${readOnly}>
          <${Icon} name="plus" size=${18}/> Новый список</button>
        ${lists.length > 1 ? html`
          <button class=${'btn' + (reorder ? ' selected' : '')} onClick=${() => setReorder(!reorder)} disabled=${readOnly}>
            ${reorder ? 'Готово' : 'Изменить порядок'}</button>` : null}
      </div>
      <${Link} to="/inbox" className="list-row list-link inbox-link">
        <i class="list-color" style=${{ background: 'var(--muted)' }}></i>
        <span class="list-emoji">📥</span><span class="list-name">Входящие</span>
        <span class="list-count">${counts.get('inbox') || ''}</span>
      <//>
      <button class="new-list-card" onClick=${() => openSheet('listEditor', { listId: null })} disabled=${readOnly}>
        <${Icon} name="plus" size=${20}/> Создать список</button>
      ${lists.length ? html`
        <${SortableList} items=${lists} onMove=${move} disabled=${!reorder}
          render=${(l, handle) => {
            const i = lists.indexOf(l);
            return html`<${ListRow} list=${l} count=${counts.get(l.id)} reorder=${reorder} handle=${handle}
              onUp=${i > 0 ? () => move(l.id, i - 1) : null}
              onDown=${i < lists.length - 1 ? () => move(l.id, i + 1) : null}/>`;
          }}/>` : html`<${Empty}>Списков нет — создай первый.<//>`}
      ${archived.length ? html`
        <${Section} title="Архивные" count=${archived.length} collapsible defaultOpen=${false} storageKey="lists.archived">
          ${archived.map((l) => html`<${ListRow} key=${l.id} list=${l} count=${counts.get(l.id)}/>`)}
        <//>` : null}
    </div>`;
}

export function ListScreen({ listId }) {
  const list = S.liveList(store.data, listId);
  const v = useMemo(() => S.listView(store.data, listId), [store.version, listId]);
  if (!list) {
    return html`<div class="screen"><${Empty}>Список не найден — возможно, он удалён. <${Link} to="/lists">К спискам<//><//></div>`;
  }
  const readOnly = !!store.ui.readOnly;
  const empty = !v.scheduled.length && !v.noDate.length && !v.repeating.length;
  return html`
    <div class="screen list-screen" style=${{ '--list-color': list.color }}>
      ${list.archived ? html`<p class="hint warn">Список в архиве: его задачи не показываются в «Сегодня».</p>` : null}
      ${empty ? html`<${Empty}>В списке нет активных задач. Нажми «+», чтобы добавить.<//>` : null}
      ${v.scheduled.length ? html`
        <${Section} title="Запланировано" count=${v.scheduled.length}>
          <${TaskTree} roots=${v.scheduled} listId=${listId} showList=${false} sortable=${false}/>
        <//>` : null}
      ${v.noDate.length ? html`
        <${Section} title="Без даты" count=${v.noDate.length}>
          <${TaskTree} roots=${v.noDate} listId=${listId} showList=${false} sortable=${!readOnly}/>
        <//>` : null}
      ${v.repeating.length ? html`
        <${Section} title="Повторяющиеся" count=${v.repeating.length}>
          <${TaskTree} roots=${v.repeating} listId=${listId} showList=${false} sortable=${false}/>
        <//>` : null}
      ${v.doneCount ? html`
        <${Section} title="Выполнено" count=${v.doneCount} collapsible defaultOpen=${false} storageKey=${'list.done.' + listId}>
          <${TaskList} tasks=${v.done} showList=${false}/>
          ${v.doneCount > v.done.length ? html`<button class="link-btn" onClick=${() => navigate('/archive?list=' + listId)}>Все выполненные — в архиве</button>` : null}
        <//>` : null}
    </div>`;
}
