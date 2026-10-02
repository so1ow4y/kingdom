// Строка задачи (docs/TZ.md §5.2).

import { html, useState, useRef, useEffect } from '../html.js';
import { Icon } from '../icons.js';
import { navigate } from '../router.js';
import { store, openSheet } from '../../store/appState.js';
import { toggleComplete, toggleFocus } from '../../store/actions.js';
import { humanDate } from '../../core/dates.js';
import { deadlinePassed, isOverdue, liveList, hasMissingList } from '../../core/selectors.js';
import { TIMINGS } from '../../config.js';
import { DragHandle } from './Sortable.js';

const PRIORITY_CLASS = ['', 'prio-low', 'prio-mid', 'prio-high'];
export const PRIORITY_LABEL = ['Без приоритета', 'Низкий', 'Средний', 'Высокий'];

export function TaskMeta({ task, showList }) {
  const { today, time } = store.now;
  const parts = [];
  if (showList) {
    const list = liveList(store.data, task.listId);
    if (list) {
      parts.push(html`<span class="meta-list"><i class="dot" style=${{ background: list.color }}></i>${list.emoji ? list.emoji + ' ' : ''}${list.name}</span>`);
    } else if (hasMissingList(store.data, task)) {
      parts.push(html`<span class="meta-warn">Список удалён</span>`);
    }
  }
  if (task.scheduledDate) {
    const late = task.status === 'active' && task.scheduledDate < today;
    const timePassed = task.status === 'active' && task.scheduledDate === today && task.scheduledTime && task.scheduledTime <= time;
    parts.push(html`<span class=${'meta-date' + (late ? ' late' : '')}>
      <${Icon} name="calendar" size=${13}/>${humanDate(task.scheduledDate, today)}${task.scheduledTime ? ' ' + task.scheduledTime : ''}
      ${timePassed ? html`<i class="time-passed" title="Время прошло"></i>` : null}</span>`);
  }
  if (task.deadlineDate) {
    const late = task.status === 'active' && deadlinePassed(task, today, time);
    parts.push(html`<span class=${'meta-deadline' + (late ? ' late' : '')}>
      <${Icon} name="flag" size=${13}/>${humanDate(task.deadlineDate, today)}${task.deadlineTime ? ' ' + task.deadlineTime : ''}</span>`);
  }
  if (task.priority > 0) {
    parts.push(html`<span class=${'meta-prio ' + PRIORITY_CLASS[task.priority]} title=${PRIORITY_LABEL[task.priority]}>
      <${Icon} name="flag" size=${13}/></span>`);
  }
  if (task.note) parts.push(html`<span class="meta-note" title="Есть заметка">≡</span>`);
  return parts.length ? html`<div class="task-meta">${parts}</div>` : null;
}

export function TaskRow({ task, showList = true, handle = null, quickActions = false }) {
  const [completing, setCompleting] = useState(false);
  const timer = useRef(null);
  const done = task.status === 'done';
  const today = store.now.today;
  const focused = task.focusDate === today;
  const overdue = isOverdue(task, today, store.now.time);
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
    if (done) {
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

  // Если карточка уже открыта (панель справа на широком экране) — заменяем её, а не копим историю.
  const open = () => navigate('/task/' + task.id, { replace: location.hash.startsWith('#/task/') });
  const menu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    openSheet('taskMenu', { taskId: task.id });
  };
  const stop = (fn) => (e) => {
    e.stopPropagation();
    fn();
  };

  const cls = ['task-row'];
  if (done || completing) cls.push('done');
  if (completing) cls.push('completing');
  if (overdue) cls.push('overdue');

  return html`
    <div class=${cls.join(' ')} onClick=${open} onContextMenu=${menu} role="button" tabIndex="0"
      onKeyDown=${(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) open(); }}>
      <button class=${'check' + (done || completing ? ' checked' : '')} onClick=${onCheck}
        aria-label=${done ? 'Вернуть в работу' : 'Выполнить'} disabled=${readOnly}>
        ${done || completing ? html`<${Icon} name="check" size=${16}/>` : null}
      </button>
      <div class="task-main">
        <div class="task-title">${task.title}</div>
        <${TaskMeta} task=${task} showList=${showList}/>
        ${quickActions && !readOnly ? html`
          <div class="quick-row">
            <button class="mini-chip" onClick=${stop(() => openSheet('when', { taskId: task.id, mode: 'scheduled' }))}>
              <${Icon} name="calendar" size=${14}/> Когда</button>
            <button class="mini-chip" onClick=${stop(() => openSheet('listPicker', { taskId: task.id }))}>
              <${Icon} name="lists" size=${14}/> Список</button>
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

/** Простой список строк. */
export function TaskList({ tasks, showList = true, quickActions = false }) {
  return html`<div class="task-list">${tasks.map((t) => html`<${TaskRow} key=${t.id} task=${t} showList=${showList} quickActions=${quickActions}/>`)}</div>`;
}
