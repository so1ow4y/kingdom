// Строка задачи (docs/TZ.md §5.2) и дерево подзадач (обновление 0.3, п. 2.4, 2.8).

import { html, useState, useRef, useEffect, useMemo } from '../html.js';
import { Icon } from '../icons.js';
import { openTask, currentTaskId } from '../router.js';
import { useLocal } from '../hooks.js';
import { store, openSheet } from '../../store/appState.js';
import { toggleComplete, toggleFocus, dropTask } from '../../store/actions.js';
import { humanDate } from '../../core/dates.js';
import * as S from '../../core/selectors.js';
import { liveNotes } from '../../core/model.js';
import { PRIORITY_NONE_ID } from '../../core/priorities.js';
import { TIMINGS } from '../../config.js';
import { DragHandle, SortableList } from './Sortable.js';

/** Списки задачи компактно: точка, эмодзи и название; больше двух — «+N». */
function ListChips({ task }) {
  const ls = S.taskLists(store.data, task);
  if (!ls.length) {
    return S.hasMissingList(store.data, task) ? html`<span class="meta-warn">Список удалён</span>` : null;
  }
  const shown = ls.slice(0, 2);
  return html`<span class="meta-lists" title=${ls.map((l) => l.name).join(', ')}>
    ${shown.map((l) => html`<span class="meta-list"><i class="dot" style=${{ background: l.color }}></i>${l.emoji ? l.emoji + ' ' : ''}${l.name}</span>`)}
    ${ls.length > 2 ? html`<span class="meta-more">+${ls.length - 2}</span>` : null}
  </span>`;
}

export function TaskMeta({ task, showList, showParent = false, index = null }) {
  const { today, time } = store.now;
  const parts = [];
  if (showParent) {
    const p = S.parentOf(store.data, task);
    if (p) parts.push(html`<span class="meta-parent" title="Подзадача">↳ ${p.title}</span>`);
  }
  if (showList) {
    const chips = html`<${ListChips} task=${task}/>`;
    if (S.taskLists(store.data, task).length || S.hasMissingList(store.data, task)) parts.push(chips);
  }
  if (task.scheduledDate) {
    const late = task.status === 'active' && task.scheduledDate < today;
    const timePassed = task.status === 'active' && task.scheduledDate === today && task.scheduledTime && task.scheduledTime <= time;
    parts.push(html`<span class=${'meta-date' + (late ? ' late' : '')}>
      <${Icon} name="calendar" size=${13}/>${humanDate(task.scheduledDate, today)}${task.scheduledTime ? ' ' + task.scheduledTime : ''}
      ${timePassed ? html`<i class="time-passed" title="Время прошло"></i>` : null}</span>`);
  }
  if (task.deadlineDate) {
    const late = task.status === 'active' && S.deadlinePassed(task, today, time);
    parts.push(html`<span class=${'meta-deadline' + (late ? ' late' : '')}>
      <${Icon} name="flag" size=${13}/>${humanDate(task.deadlineDate, today)}${task.deadlineTime ? ' ' + task.deadlineTime : ''}</span>`);
  }
  const prio = S.priorityOf(store.data, task);
  if (prio && prio.id !== PRIORITY_NONE_ID) {
    parts.push(html`<span class="meta-prio" style=${{ color: prio.color }} title=${'Приоритет: ' + prio.name}><${Icon} name="flag" size=${13}/></span>`);
  }
  if (index) {
    const pr = S.progressOf(store.data, task.id, index);
    if (pr.total) parts.push(html`<span class="meta-progress" title="Подзадачи">${pr.done}/${pr.total}</span>`);
  }
  const notes = liveNotes(task).length;
  if (notes) parts.push(html`<span class="meta-note" title="Заметки">≡${notes > 1 ? ' ' + notes : ''}</span>`);
  if ((task.reminders || []).some((r) => !r.deletedAt)) parts.push(html`<span class="meta-note" title="Есть напоминания">🔔</span>`);
  return parts.length ? html`<div class="task-meta">${parts}</div>` : null;
}

export function TaskRow({ task, showList = true, handle = null, quickActions = false, showParent = false,
  depth = 0, kids = 0, collapsed = false, onToggle = null, index = null }) {
  const [completing, setCompleting] = useState(false);
  const timer = useRef(null);
  const done = task.status === 'done';
  const today = store.now.today;
  const focused = task.focusDate === today;
  const overdue = S.isOverdue(task, today, store.now.time);
  const readOnly = !!store.ui.readOnly;

  useEffect(() => {
    if (done) setCompleting(false);
  }, [done]);

  // Если строка исчезла (переход на другой экран) до конца анимации — выполнить сразу.
  useEffect(() => () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      toggleComplete(task.id);
    }
  }, []);

  const onCheck = (e) => {
    e.stopPropagation();
    if (readOnly || task.trashedAt) return;
    if (done || kids) {
      // У родителя сразу (будет вопрос про подзадачи), у выполненной — вернуть без задержки.
      toggleComplete(task.id);
      return;
    }
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      setCompleting(false);
      return;
    }
    setCompleting(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      toggleComplete(task.id);
    }, TIMINGS.completeDelayMs);
  };

  // Повторный клик по открытой задаче закрывает панель, клик по другой — переключает (router.openTask).
  const open = () => openTask(task.id);
  const selected = currentTaskId() === task.id;
  const menu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    openSheet('taskMenu', { taskId: task.id });
  };
  const stop = (fn) => (e) => {
    e.stopPropagation();
    fn(e);
  };

  const cls = ['task-row'];
  if (done || completing) cls.push('done');
  if (completing) cls.push('completing');
  if (overdue) cls.push('overdue');
  if (selected) cls.push('selected');
  if (depth) cls.push('child');

  return html`
    <div class=${cls.join(' ')} onClick=${open} onContextMenu=${menu} role="button" tabIndex="0"
      style=${{ '--depth': depth }}
      onKeyDown=${(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) open(); }}>
      ${onToggle ? html`<button class=${'tree-toggle' + (kids ? '' : ' empty')} onClick=${stop(onToggle)} disabled=${!kids}
        aria-label=${collapsed ? 'Развернуть подзадачи' : 'Свернуть подзадачи'} aria-expanded=${!collapsed}>
        ${kids ? html`<${Icon} name=${collapsed ? 'chevron' : 'chevronDown'} size=${16}/>` : null}</button>` : null}
      <button class=${'check' + (done || completing ? ' checked' : '')} onClick=${onCheck}
        aria-label=${done ? 'Вернуть в работу' : 'Выполнить'} disabled=${readOnly}>
        ${done || completing ? html`<${Icon} name="check" size=${16}/>` : null}
      </button>
      <div class="task-main">
        <div class="task-title">${task.title}</div>
        <${TaskMeta} task=${task} showList=${showList} showParent=${showParent} index=${index}/>
        ${quickActions && !readOnly ? html`
          <div class="quick-row">
            <button class="mini-chip" onClick=${stop((e) => openSheet('when', { taskId: task.id, mode: 'scheduled' }))}>
              <${Icon} name="calendar" size=${14}/> Когда</button>
            <button class="mini-chip" onClick=${stop((e) => openSheet('listPicker', { taskId: task.id, anchor: e.currentTarget.getBoundingClientRect() }))}>
              <${Icon} name="lists" size=${14}/> Списки</button>
          </div>` : null}
      </div>
      ${!done || focused ? html`
        <button class=${'star' + (focused ? ' on' : ' star-optional') + (quickActions ? ' star-visible' : '')}
          onClick=${stop(() => !readOnly && toggleFocus(task.id))}
          aria-label=${focused ? 'Убрать из главного' : 'Главное на сегодня'} title=${focused ? 'Убрать из главного' : 'Главное на сегодня'}>
          <${Icon} name="star" filled=${focused} size=${20}/>
        </button>` : null}
      <button class="icon-btn row-menu" onClick=${menu} aria-label="Действия" title="Действия"><${Icon} name="dots" size=${18}/></button>
      ${handle ? html`<${DragHandle} handle=${handle}/>` : null}
    </div>`;
}

/** Простой список строк (подзадачи — с подписью родителя). */
export function TaskList({ tasks, showList = true, quickActions = false, showParent = true }) {
  return html`<div class="task-list">${tasks.map((t) => html`<${TaskRow} key=${t.id} task=${t} showList=${showList}
    quickActions=${quickActions} showParent=${showParent}/>`)}</div>`;
}

/**
 * Дерево задач: корни и их подзадачи с отступами, сворачиванием и прогрессом «2/5».
 * Перетаскивание: на середину строки — вложить, между строками — переставить на том же уровне (п. 2.8).
 * listId — контекст экрана (null — «Входящие»): задача, вынесенная на верхний уровень, остаётся в этом списке.
 */
export function TaskTree({ roots, listId = null, showList = true, quickActions = false, sortable = true, rootParentId = null }) {
  const index = useMemo(() => S.childrenIndex(store.data), [store.version]);
  const [collapsed, setCollapsed] = useLocal('collapsed', []);
  const closed = new Set(collapsed);
  const flat = [];
  const walk = (list, depth) => {
    for (const t of list) {
      const kids = index.get(t.id) || [];
      flat.push({ id: t.id, task: t, depth, kids: kids.length });
      if (kids.length && !closed.has(t.id)) walk(kids, depth + 1);
    }
  };
  walk(roots, 0);
  const toggle = (id) => setCollapsed(closed.has(id) ? collapsed.filter((x) => x !== id) : [...collapsed, id]);
  return html`<${SortableList} items=${flat} nestable disabled=${!!store.ui.readOnly || !sortable}
    onDrop=${(d) => dropTask(d.id, d, listId, rootParentId)}
    render=${(it, handle) => html`<${TaskRow} task=${it.task} depth=${it.depth} kids=${it.kids} collapsed=${closed.has(it.id)}
      onToggle=${() => toggle(it.id)} showList=${showList && it.depth === 0} quickActions=${quickActions && it.depth === 0}
      handle=${sortable ? handle : null} index=${index}/>`}/>`;
}
