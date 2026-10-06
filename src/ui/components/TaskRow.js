// Строка задачи (docs/TZ.md §5.2). Дерево и перетаскивание — components/TaskTree.js (обновление 0.4).

import { html, useState, useRef, useEffect, useContext } from '../html.js';
import { DayContext } from '../dayContext.js';
import { Icon } from '../icons.js';
import { openTask, currentTaskId } from '../router.js';
import { store, openSheet } from '../../store/appState.js';
import { toggleComplete, toggleFocus } from '../../store/actions.js';
import { humanDate } from '../../core/dates.js';
import * as RP from '../../core/repeat.js';
import * as S from '../../core/selectors.js';
import { liveNotes, focusTotal } from '../../core/model.js';
import { getFocus } from '../../store/focus.js';
import { formatMinutes } from './Focus.js';
import { PRIORITY_NONE_ID } from '../../core/priorities.js';
import { TIMINGS } from '../../config.js';
import { DragHandle } from './Sortable.js';

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
  if (task.repeat) {
    // повтор: правило и дата текущего раза
    const due = task.status === 'active' ? RP.dueDate(task, today, store.data.settings.timeZone) : null;
    const late = !!due && due < today;
    parts.push(html`<span class=${'meta-date meta-repeat' + (late ? ' late' : '')} title=${'Повтор: ' + RP.describeRule(task.repeat)}>
      <${Icon} name="repeat" size=${13}/>${RP.describeRule(task.repeat)}${due ? ' · ' + humanDate(due, today).toLowerCase() : ''}${task.scheduledTime ? ' ' + task.scheduledTime : ''}</span>`);
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
  const running = getFocus()?.taskId === task.id;
  const fm = focusTotal(task).minutes;
  if (running || fm) parts.push(html`<span class=${'meta-focus' + (running ? ' running' : '')} title=${running ? 'Сейчас идёт фокус' : 'Фокус по задаче'}>◎ ${running ? 'фокус' : formatMinutes(fm)}</span>`);
  return parts.length ? html`<div class="task-meta">${parts}</div>` : null;
}

/**
 * kids — сколько подзадач показано под строкой (для стрелки), hasKids — есть ли подзадачи вообще (вопрос при выполнении).
 * onKeyMove(key) — клавиши на строке в фокусе: Alt+↑/↓ ('up'/'down'), Tab ('indent'), Shift+Tab ('outdent').
 */
export function TaskRow({ task, showList = true, handle = null, quickActions = false, showParent = false,
  depth = 0, kids = 0, hasKids = null, collapsed = false, onToggle = null, index = null, onKeyMove = null }) {
  const [completing, setCompleting] = useState(false);
  const timer = useRef(null);
  const done = task.status === 'done';
  const today = useContext(DayContext) || store.now.today;
  const focused = task.focusDate === today;
  const overdue = S.isOverdue(task, store.now.today, store.now.time);
  const readOnly = !!store.ui.readOnly;
  const hasParent = !!task.parentId && !!S.parentOf(store.data, task); // ★ — только у задач верхнего уровня

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
    if (done || (hasKids ?? kids)) {
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
    openSheet('taskMenu', { taskId: task.id, date: today });
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
      onKeyDown=${(e) => onRowKey(e, open, onKeyMove)}>
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
      ${(!done && !hasParent) || focused ? html`
        <button class=${'star' + (focused ? ' on' : ' star-optional') + (quickActions ? ' star-visible' : '')}
          onClick=${stop(() => !readOnly && toggleFocus(task.id, today))}
          aria-label=${focused ? 'Убрать из главного' : 'Главное на ' + humanDate(today, store.now.today)} title=${focused ? 'Убрать из главного' : 'Главное на ' + humanDate(today, store.now.today)}>
          <${Icon} name="star" filled=${focused} size=${20}/>
        </button>` : null}
      <button class="icon-btn row-menu" onClick=${menu} aria-label="Действия" title="Действия"><${Icon} name="dots" size=${18}/></button>
      ${handle ? html`<${DragHandle} handle=${handle}/>` : null}
    </div>`;
}

const KEYS = { ArrowUp: 'up', ArrowDown: 'down' };

function onRowKey(e, open, onKeyMove) {
  if (e.target !== e.currentTarget) return;
  if (e.key === 'Enter') {
    open();
    return;
  }
  if (!onKeyMove) return;
  const key = e.altKey && KEYS[e.key] ? KEYS[e.key] : e.key === 'Tab' && !e.altKey && !e.ctrlKey && !e.metaKey ? (e.shiftKey ? 'outdent' : 'indent') : null;
  if (key && onKeyMove(key)) e.preventDefault();
}

/** Простой список строк без перетаскивания (архив, корзина). */
export function TaskList({ tasks, showList = true, quickActions = false, showParent = true }) {
  return html`<div class="task-list">${tasks.map((t) => html`<${TaskRow} key=${t.id} task=${t} showList=${showList}
    quickActions=${quickActions} showParent=${showParent}/>`)}</div>`;
}
