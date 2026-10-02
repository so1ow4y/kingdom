// Нижние панели: «Когда», выбор списка, приоритет, меню задачи, выбор главных, синхронизация.

import { html } from '../html.js';
import { Icon } from '../icons.js';
import { Sheet, MenuItem } from './Sheet.js';
import { ListEditorSheet } from './ListEditor.js';
import { SyncPanel } from './Sync.js';
import { navigate } from '../router.js';
import { store, closeSheet, openSheet, showSnackbar } from '../../store/appState.js';
import * as A from '../../store/actions.js';
import * as S from '../../core/selectors.js';
import { addDays, mondayOf, weekDates, isoWeekday, WEEKDAY_SHORT, humanDate } from '../../core/dates.js';
import { PRIORITY_LABEL } from './TaskRow.js';
import { LIMITS } from '../../config.js';

function WhenSheet({ taskId, mode }) {
  const t = A.getTask(taskId);
  if (!t) return null;
  const deadline = mode === 'deadline';
  const cur = deadline ? t.deadlineDate : t.scheduledDate;
  const curTime = deadline ? t.deadlineTime : t.scheduledTime;
  const today = store.now.today;
  const mon = mondayOf(today);
  const apply = (date, time) => {
    closeSheet();
    (deadline ? A.setDeadline : A.setSchedule)(taskId, date, time);
  };
  const day = (d) => html`
    <button class=${'day-chip' + (d === today ? ' today' : '') + (d === cur ? ' selected' : '')}
      disabled=${d < today} onClick=${() => apply(d)} aria-label=${humanDate(d, today)}>
      <span class="dc-wd">${WEEKDAY_SHORT[isoWeekday(d) - 1]}</span>
      <span class="dc-num">${+d.slice(8, 10)}</span>
    </button>`;
  const warn = t.deadlineDate && t.scheduledDate && t.deadlineDate < t.scheduledDate;
  return html`
    <${Sheet} title=${deadline ? 'Дедлайн' : 'Когда'} onClose=${closeSheet}>
      <div class="chip-row">
        <button class=${'chip' + (cur === today ? ' selected' : '')} onClick=${() => apply(today)}>Сегодня</button>
        <button class=${'chip' + (cur === addDays(today, 1) ? ' selected' : '')} onClick=${() => apply(addDays(today, 1))}>Завтра</button>
        <button class=${'chip' + (!cur ? ' selected' : '')} onClick=${() => apply(null)}>${deadline ? 'Без дедлайна' : 'Без даты'}</button>
      </div>
      <div class="week-pick">
        <div class="wp-label">Эта неделя</div>
        <div class="wp-days">${weekDates(mon).map(day)}</div>
        <div class="wp-label">Следующая</div>
        <div class="wp-days">${weekDates(addDays(mon, 7)).map(day)}</div>
      </div>
      <div class="field-row">
        <label class="field">
          <span>Выбрать дату</span>
          <input type="date" value=${cur || ''}
            onChange=${(e) => e.target.value && apply(e.target.value)}/>
        </label>
        <label class="field">
          <span>Время</span>
          <input type="time" value=${curTime || ''}
            onChange=${(e) => apply(cur || today, e.target.value || null)}/>
        </label>
      </div>
      ${curTime ? html`<button class="link-btn" onClick=${() => apply(cur, null)}>Убрать время</button>` : null}
      ${warn ? html`<p class="hint warn">Дедлайн раньше даты выполнения</p>` : null}
    <//>`;
}

function ListPickerSheet({ taskId }) {
  const t = A.getTask(taskId);
  if (!t) return null;
  const pick = (listId) => {
    closeSheet();
    A.moveToList(taskId, listId);
  };
  return html`
    <${Sheet} title="Список" onClose=${closeSheet}>
      <${MenuItem} icon="inbox" label="Входящие" checked=${t.listId == null} onClick=${() => pick(null)}/>
      ${S.sortedLists(store.data).map((l) => html`
        <${MenuItem} key=${l.id} icon=${html`<i class="dot big" style=${{ background: l.color }}></i>`}
          label=${(l.emoji ? l.emoji + ' ' : '') + l.name} checked=${t.listId === l.id} onClick=${() => pick(l.id)}/>`)}
    <//>`;
}

function PrioritySheet({ taskId }) {
  const t = A.getTask(taskId);
  if (!t) return null;
  const pick = (p) => {
    closeSheet();
    A.setPriority(taskId, p);
  };
  const cls = ['', 'prio-low', 'prio-mid', 'prio-high'];
  return html`
    <${Sheet} title="Приоритет" onClose=${closeSheet}>
      ${[3, 2, 1, 0].map((p) => html`
        <${MenuItem} key=${p} icon=${html`<span class=${'meta-prio ' + cls[p]}><${Icon} name="flag" size=${20}/></span>`}
          label=${PRIORITY_LABEL[p]} checked=${(t.priority || 0) === p} onClick=${() => pick(p)}/>`)}
    <//>`;
}

function TaskMenuSheet({ taskId }) {
  const t = A.getTask(taskId);
  if (!t || t.deletedAt) return null;
  const run = (fn) => () => {
    closeSheet();
    fn();
  };
  const today = store.now.today;
  if (t.trashedAt) {
    return html`
      <${Sheet} title=${t.title} onClose=${closeSheet}>
        <${MenuItem} icon="restore" label="Восстановить" onClick=${run(() => A.restoreTask(taskId))}/>
        <${MenuItem} icon="trash" label="Удалить навсегда" danger onClick=${run(() => A.deleteForever(taskId))}/>
      <//>`;
  }
  const focused = t.focusDate === today;
  return html`
    <${Sheet} title=${t.title} onClose=${closeSheet} className="sheet-menu">
      ${t.status === 'done'
        ? html`<${MenuItem} icon="restore" label="Вернуть в работу" onClick=${run(() => A.reopenTask(taskId))}/>`
        : html`
          <${MenuItem} icon=${html`<${Icon} name="star" filled=${focused} size=${20}/>`}
            label=${focused ? 'Убрать из главного' : 'Главное на сегодня'} onClick=${run(() => A.toggleFocus(taskId))}/>
          <${MenuItem} icon="calendar" label="Когда…" hint=${t.scheduledDate ? humanDate(t.scheduledDate, today) : null}
            onClick=${() => openSheet('when', { taskId, mode: 'scheduled' })}/>
          <${MenuItem} icon="flag" label="Дедлайн…" hint=${t.deadlineDate ? humanDate(t.deadlineDate, today) : null}
            onClick=${() => openSheet('when', { taskId, mode: 'deadline' })}/>`}
      <${MenuItem} icon="lists" label="Список…" onClick=${() => openSheet('listPicker', { taskId })}/>
      <${MenuItem} icon="flag" label="Приоритет…" hint=${t.priority ? PRIORITY_LABEL[t.priority] : null}
        onClick=${() => openSheet('priority', { taskId })}/>
      <${MenuItem} icon="plus" label="Дублировать" onClick=${run(async () => {
        const c = await A.duplicateTask(taskId);
        if (c) navigate('/task/' + c.id);
      })}/>
      <${MenuItem} icon="copy" label="Скопировать текст" onClick=${run(async () => {
        try {
          await navigator.clipboard.writeText(t.title + (t.note ? '\n\n' + t.note : ''));
          showSnackbar('Скопировано');
        } catch {
          showSnackbar('Не удалось скопировать');
        }
      })}/>
      <${MenuItem} icon="trash" label="В корзину" danger onClick=${run(() => A.trashTask(taskId))}/>
    <//>`;
}

/** «Выбрать» главные: задачи на сегодня, просроченные и «Входящие». */
function FocusPickerSheet() {
  const today = store.now.today;
  const v = S.todayView(store.data, today, store.now.time, store.now.ms);
  const focusCount = S.focusTasks(store.data, today).length;
  const seen = new Set();
  const groups = [
    ['На сегодня', [...v.today, ...v.chores.filter((t) => !S.isOverdue(t, today, store.now.time))]],
    ['Просрочено', [...v.overdue, ...v.chores.filter((t) => S.isOverdue(t, today, store.now.time))]],
    ['Входящие', S.inboxView(store.data)],
  ].map(([title, list]) => [title, list.filter((t) => t.focusDate !== today && !seen.has(t.id) && seen.add(t.id))]);
  const pick = async (id) => {
    await A.toggleFocus(id);
    if (S.focusTasks(store.data, today).length >= LIMITS.focusMax) closeSheet();
  };
  const total = groups.reduce((n, [, l]) => n + l.length, 0);
  return html`
    <${Sheet} title=${`Главное на сегодня · ${focusCount}/${LIMITS.focusMax}`} onClose=${closeSheet}>
      ${total === 0 ? html`<p class="empty">Нет задач на сегодня и во «Входящих». Отметь ★ у любой задачи в её списке.</p>` : null}
      ${groups.filter(([, l]) => l.length).map(([title, list]) => html`
        <div class="picker-group">
          <div class="wp-label">${title}</div>
          ${list.map((t) => html`<${MenuItem} key=${t.id} icon=${html`<${Icon} name="star" size=${20}/>`} label=${t.title} onClick=${() => pick(t.id)}/>`)}
        </div>`)}
    <//>`;
}

export function SheetHost() {
  const s = store.ui.sheet;
  if (!s) return null;
  switch (s.type) {
    case 'when': return html`<${WhenSheet} ...${s}/>`;
    case 'listPicker': return html`<${ListPickerSheet} ...${s}/>`;
    case 'priority': return html`<${PrioritySheet} ...${s}/>`;
    case 'taskMenu': return html`<${TaskMenuSheet} ...${s}/>`;
    case 'focusPicker': return html`<${FocusPickerSheet}/>`;
    case 'sync': return html`<${SyncPanel}/>`;
    case 'listEditor': return html`<${ListEditorSheet} ...${s}/>`;
    default: return null;
  }
}
