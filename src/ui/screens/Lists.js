// «Списки» и экран отдельного списка (docs/TZ.md §6.5; обновление 0.4).
// На «Списках» список раскрывается прямо на месте (кнопка ▸ справа): задачи тем же деревом, что везде,
// «+ Задача в „…“», «Открыть список →». Между раскрытыми списками задачи переносят перетаскиванием.

import { html, useMemo, useState } from '../html.js';
import { Section, Empty } from '../components/Section.js';
import { TaskTree, DragScope, EmptyDrop } from '../components/TaskTree.js';
import { SortableList, DragHandle } from '../components/Sortable.js';
import { AddLine } from '../components/ItemLists.js';
import { INBOX_ZONE } from './Inbox.js';
import { Icon } from '../icons.js';
import { Link, navigate } from '../router.js';
import { useLocal } from '../hooks.js';
import { store, openSheet } from '../../store/appState.js';
import * as A from '../../store/actions.js';
import * as S from '../../core/selectors.js';

const SECTIONS = [
  ['scheduled', 'Запланировано', 'Порядок здесь по дате — можно вложить или вынести'],
  ['noDate', 'Без даты', null],
  ['repeating', 'Повторяющиеся', 'Порядок здесь по названию — можно вложить или вынести'],
  ['done', 'Выполнено', 'Порядок здесь по времени выполнения'],
];
const EXPANDED_LIMIT = 10;

/** Блок раздела списка: корень здесь — член списка из этого раздела (с другого раздела — только вложить). */
function sectionZone(listId, section, autoReason, crossList = false) {
  return {
    manual: !autoReason,
    listId,
    crossList,
    accepts: (t) => S.listSection(t) === section,
    rejectReason: 'Задача из другого раздела — сюда её можно только вложить',
    autoReason,
  };
}

function ListRow({ list, count, handle = null, reorder = false, onUp, onDown, open = null, onExpand = null }) {
  return html`
    <div class=${'list-row' + (open ? ' open' : '')}>
      <${Link} to=${list ? '/list/' + list.id : '/inbox'} className="list-link">
        <i class="list-color" style=${{ background: list ? list.color : 'var(--muted)' }}></i>
        <span class="list-emoji">${list ? list.emoji || '•' : '📥'}</span>
        <span class="list-name">${list ? list.name : 'Входящие'}</span>
        <span class="list-count">${count || ''}</span>
      <//>
      ${list && !reorder ? html`<button class="icon-btn" title="Изменить список" aria-label=${'Изменить список ' + list.name}
        disabled=${!!store.ui.readOnly} onClick=${() => openSheet('listEditor', { listId: list.id })}><${Icon} name="edit" size=${18}/></button>` : null}
      ${reorder ? html`
        <button class="icon-btn" onClick=${onUp} aria-label="Выше" disabled=${!onUp}><${Icon} name="up" size=${18}/></button>
        <button class="icon-btn" onClick=${onDown} aria-label="Ниже" disabled=${!onDown}><${Icon} name="down" size=${18}/></button>
        <${DragHandle} handle=${handle}/>`
        : onExpand ? html`<button class="list-expand" onClick=${onExpand} aria-expanded=${!!open}
            aria-label=${(open ? 'Свернуть ' : 'Раскрыть ') + (list ? list.name : 'Входящие')} title=${open ? 'Свернуть' : 'Показать задачи здесь'}>
            <${Icon} name=${open ? 'chevronDown' : 'chevron'} size=${20}/></button>` : null}
    </div>`;
}

/** Раскрытый список на экране «Списки»: разделы компактно, первые 10 задач, быстрое добавление. */
function ExpandedList({ listId }) {
  const [all, setAll] = useState(false);
  const inbox = listId === 'inbox';
  const list = inbox ? null : S.liveList(store.data, listId);
  const v = useMemo(() => (inbox ? { noDate: S.inboxView(store.data) } : S.listView(store.data, listId)), [store.version, listId]);
  const readOnly = !!store.ui.readOnly;
  let left = all ? Infinity : EXPANDED_LIMIT;
  const parts = [];
  let total = 0;
  for (const [key, title, autoReason] of SECTIONS) {
    if (key === 'done') continue;
    const roots = v[key] || [];
    total += roots.length;
    if (!roots.length || left <= 0) continue;
    const zone = `exp:${listId}:${key}`;
    const cfg = inbox ? { ...INBOX_ZONE, crossList: true } : sectionZone(listId, key, autoReason, true);
    parts.push(html`
      ${inbox ? null : html`<div class="exp-sub">${title} · ${roots.length}</div>`}
      <${TaskTree} key=${zone} zone=${zone} roots=${roots} cfg=${cfg} showList=${false} limit=${left} className="compact"/>`);
    left -= roots.length;
  }
  const name = inbox ? 'Входящие' : list?.name || '';
  return html`
    <div class="list-expanded">
      ${total ? parts : html`<${EmptyDrop} zone=${'exp:' + listId + ':empty'}
        cfg=${inbox ? { ...INBOX_ZONE, crossList: true, manual: false } : { manual: false, listId, crossList: true, accepts: () => false }}
        text=${inbox ? 'Входящие пусты — перетащи сюда задачу из списка' : 'Задач нет — перетащи сюда задачу из другого списка'}/>`}
      ${total > EXPANDED_LIMIT && !all ? html`<button class="link-btn" onClick=${() => setAll(true)}>Показать ещё ${total - EXPANDED_LIMIT}</button>` : null}
      ${readOnly ? null : html`<${AddLine} placeholder=${`Задача в «${name}»`}
        onAdd=${(title) => A.createTask({ title, listIds: inbox ? [] : [listId] })}/>`}
      <${Link} to=${inbox ? '/inbox' : '/list/' + listId} className="link-btn exp-open">Открыть ${inbox ? '«Входящие»' : 'список'} →<//>
    </div>`;
}

export function ListsScreen() {
  const lists = useMemo(() => S.sortedLists(store.data), [store.version]);
  const archived = useMemo(() => S.sortedLists(store.data, { archived: true }), [store.version]);
  const counts = useMemo(() => S.activeCounts(store.data), [store.version]);
  const [reorder, setReorder] = useState(false);
  const [openIds, setOpenIds] = useLocal('listsOpen', []);
  const readOnly = !!store.ui.readOnly;
  const opened = new Set(openIds);
  const allIds = ['inbox', ...lists.map((l) => l.id)];
  const anyOpen = allIds.some((id) => opened.has(id));
  const flip = (id) => setOpenIds(opened.has(id) ? openIds.filter((x) => x !== id) : [...openIds, id]);
  const isOpen = (id) => !reorder && opened.has(id);

  const move = (id, index) => A.reorderList(id, lists, index);

  return html`
    <${DragScope} className="screen lists-screen">
      <div class="toolbar">
        ${lists.length > 1 ? html`
          <button class=${'btn' + (reorder ? ' selected' : '')} onClick=${() => setReorder(!reorder)} disabled=${readOnly}>
            ${reorder ? 'Готово' : 'Изменить порядок'}</button>` : null}
        ${reorder ? null : html`<button class="btn" onClick=${() => setOpenIds(anyOpen ? [] : allIds)}>
          <${Icon} name=${anyOpen ? 'up' : 'down'} size=${18}/> ${anyOpen ? 'Свернуть все' : 'Развернуть все'}</button>`}
      </div>
      <button class="new-list-card" onClick=${() => openSheet('listEditor', { listId: null })} disabled=${readOnly}>
        <${Icon} name="plus" size=${20}/> Новый список</button>
      <${ListRow} list=${null} count=${counts.get('inbox')} open=${isOpen('inbox')} onExpand=${reorder ? null : () => flip('inbox')}/>
      ${isOpen('inbox') ? html`<${ExpandedList} listId="inbox"/>` : null}
      ${lists.length ? html`
        <${SortableList} items=${lists} onMove=${move} disabled=${!reorder}
          render=${(l, handle) => {
            const i = lists.indexOf(l);
            return html`<div>
              <${ListRow} list=${l} count=${counts.get(l.id)} reorder=${reorder} handle=${handle}
                onUp=${i > 0 ? () => move(l.id, i - 1) : null}
                onDown=${i < lists.length - 1 ? () => move(l.id, i + 1) : null}
                open=${isOpen(l.id)} onExpand=${() => flip(l.id)}/>
              ${isOpen(l.id) ? html`<${ExpandedList} listId=${l.id}/>` : null}
            </div>`;
          }}/>` : html`<${Empty}>Списков нет — создай первый.<//>`}
      ${archived.length ? html`
        <${Section} title="Архивные" count=${archived.length} collapsible defaultOpen=${false} storageKey="lists.archived">
          ${archived.map((l) => html`<${ListRow} key=${l.id} list=${l} count=${counts.get(l.id)}/>`)}
        <//>` : null}
    <//>`;
}

export function ListScreen({ listId }) {
  const list = S.liveList(store.data, listId);
  const v = useMemo(() => S.listView(store.data, listId), [store.version, listId]);
  if (!list) {
    return html`<div class="screen"><${Empty}>Список не найден — возможно, он удалён. <${Link} to="/lists">К спискам<//><//></div>`;
  }
  const empty = !v.scheduled.length && !v.noDate.length && !v.repeating.length;
  const section = (key, title, autoReason, extra = {}) => html`
    <${Section} title=${title} count=${key === 'done' ? v.doneCount : v[key].length} ...${extra}>
      <${TaskTree} zone=${'list:' + key} roots=${v[key]} cfg=${sectionZone(listId, key, autoReason)} showList=${false}/>
      ${key === 'done' && v.doneCount > v.done.length
        ? html`<button class="link-btn" onClick=${() => navigate('/archive?list=' + listId)}>Все выполненные — в архиве</button>` : null}
    <//>`;
  return html`
    <${DragScope} className="screen list-screen" key=${listId}>
      <div style=${{ '--list-color': list.color }}>
        ${list.archived ? html`<p class="hint warn">Список в архиве: его задачи не показываются в «Сегодня».</p>` : null}
        ${empty ? html`<${Empty}>В списке нет активных задач. Нажми «+», чтобы добавить.<//>` : null}
        ${SECTIONS.map(([key, title, autoReason]) => (key === 'done'
          ? (v.doneCount ? section(key, title, autoReason, { collapsible: true, defaultOpen: false, storageKey: 'list.done.' + listId }) : null)
          : (v[key].length ? section(key, title, autoReason) : null)))}
      </div>
    <//>`;
}
