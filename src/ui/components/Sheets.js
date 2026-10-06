// Нижние панели: «Когда», выбор списка, приоритет, меню задачи, выбор главных, синхронизация.

import { html, useState } from '../html.js';
import { Icon } from '../icons.js';
import { Sheet, MenuItem } from './Sheet.js';
import { TimeInput } from './TimeInput.js';
import { ListEditorSheet } from './ListEditor.js';
import { SyncPanel } from './Sync.js';
import { navigate } from '../router.js';
import { store, closeSheet, openSheet, showSnackbar } from '../../store/appState.js';
import * as A from '../../store/actions.js';
import * as S from '../../core/selectors.js';
import { addDays, mondayOf, weekDates, isoWeekday, WEEKDAY_SHORT, humanDate } from '../../core/dates.js';
import { LIMITS } from '../../config.js';
import { PRIORITY_NONE_ID } from '../../core/priorities.js';
import { liveNotes } from '../../core/model.js';
import { ReminderSheet, MissedSheet } from './Reminders.js';
import { RecorderSheet } from './Attachments.js';
import { FocusStartSheet } from './Focus.js';
import { RepeatSheet } from './Repeat.js';
import { describeRule } from '../../core/repeat.js';

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
        <div class="field">
          <span>Время</span>
          <${TimeInput} value=${curTime || null} label="Время"
            onChange=${(v) => (deadline ? A.setDeadline : A.setSchedule)(taskId, cur || today, v || null)}/>
        </div>
      </div>
      ${curTime ? html`<button class="link-btn" onClick=${() => apply(cur, null)}>Убрать время</button>` : null}
      ${warn ? html`<p class="hint warn">Дедлайн раньше даты выполнения</p>` : null}
    <//>`;
}

/** Списки задачи (п. 2.4): галочки, задача может быть в нескольких списках; «+ Новый список» прямо здесь. */
function ListPickerSheet({ taskId, anchor }) {
  const t = A.getTask(taskId);
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  if (!t) return null;
  const lists = S.sortedLists(store.data);
  const none = S.taskLists(store.data, t).length === 0;
  const create = async (e) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    await A.createListAndAdd(taskId, n);
    setName('');
    setAdding(false);
  };
  return html`
    <${Sheet} title="Списки" onClose=${closeSheet} anchor=${anchor}>
      <${MenuItem} icon="inbox" label="Входящие (без списков)" checked=${none} onClick=${() => !none && A.clearLists(taskId)}/>
      ${lists.map((l) => html`
        <${MenuItem} key=${l.id} icon=${html`<span class=${'check-box' + (S.inList(t, l.id) ? ' on' : '')} style=${{ '--c': l.color }}>
            ${S.inList(t, l.id) ? html`<${Icon} name="check" size=${14}/>` : null}</span>`}
          label=${(l.emoji ? l.emoji + ' ' : '') + l.name} onClick=${() => A.toggleListMembership(taskId, l.id)}/>`)}
      <div class="menu-sep"></div>
      ${adding ? html`
        <form class="inline-add" onSubmit=${create}>
          <input value=${name} placeholder="Название списка" maxLength="40" autoFocus onInput=${(e) => setName(e.target.value)}/>
          <button class="btn small primary" type="submit" disabled=${!name.trim()}>Создать</button>
        </form>` : html`
        <${MenuItem} icon="plus" label="Новый список" onClick=${() => setAdding(true)}/>`}
    <//>`;
}

/** Выбор приоритета (п. 2.9): цветная точка, название, монеты; «Без приоритета» внизу; «Настроить приоритеты». */
function PrioritySheet({ taskId, anchor, onPick = null, current = undefined }) {
  const t = taskId ? A.getTask(taskId) : null;
  if (taskId && !t) return null;
  const cur = current !== undefined ? current : t.priorityId;
  const pick = (id) => {
    closeSheet();
    if (onPick) onPick(id);
    else A.setPriority(taskId, id);
  };
  const list = S.sortedPriorities(store.data).filter((p) => p.id !== PRIORITY_NONE_ID).reverse();
  const none = store.data.priorities.get(PRIORITY_NONE_ID);
  const game = store.data.settings.gameEnabled;
  const item = (p) => html`
    <${MenuItem} key=${p.id} icon=${html`<i class="dot big" style=${{ background: p.color }}></i>`}
      label=${p.name} hint=${game ? `+${p.coins} 🪙 за выполнение` : null} checked=${cur === p.id} onClick=${() => pick(p.id)}/>`;
  return html`
    <${Sheet} title="Приоритет" onClose=${closeSheet} anchor=${anchor}>
      ${list.map(item)}
      ${none && !none.deletedAt ? item(none) : null}
      <div class="menu-sep"></div>
      <${MenuItem} icon="settings" label="Настроить приоритеты" onClick=${() => { closeSheet(); navigate('/settings?section=priorities'); }}/>
    <//>`;
}

/** «Сделать подзадачей…»: выбор родителя (поиск по названию; недопустимые — без циклов и глубже 4 уровней — скрыты). */
function ParentPickerSheet({ taskId }) {
  const t = A.getTask(taskId);
  const [q, setQ] = useState('');
  if (!t) return null;
  const norm = (s) => s.toLowerCase().replace(/ё/g, 'е');
  const nq = norm(q.trim());
  const options = [...store.data.tasks.values()]
    .filter((x) => S.isActive(x) && x.id !== taskId && !S.nestError(store.data, taskId, x.id))
    .filter((x) => !nq || norm(x.title).includes(nq))
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .slice(0, 30);
  const pick = (id) => {
    closeSheet();
    A.setParent(taskId, id);
  };
  return html`
    <${Sheet} title="Сделать подзадачей…" onClose=${closeSheet}>
      <input class="sheet-search" value=${q} placeholder="Найти задачу-родителя" autoFocus onInput=${(e) => setQ(e.target.value)}/>
      ${options.length ? options.map((x) => html`<${MenuItem} key=${x.id} icon="list" label=${x.title}
        hint=${S.parentOf(store.data, x) ? '↳ ' + S.parentOf(store.data, x).title : null} onClick=${() => pick(x.id)}/>`)
        : html`<p class="empty">Нет подходящих задач.</p>`}
    <//>`;
}

function TaskMenuSheet({ taskId, date }) {
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
  const focusDate = date || today;
  const focused = t.focusDate === focusDate;
  const prio = S.priorityOf(store.data, t);
  const parent = S.parentOf(store.data, t);
  return html`
    <${Sheet} title=${t.title} onClose=${closeSheet} className="sheet-menu">
      ${t.status === 'done'
        ? html`<${MenuItem} icon="restore" label="Вернуть в работу" onClick=${run(() => A.reopenTask(taskId))}/>`
        : html`
          <${MenuItem} icon="focus" label="Взяться за задачу" hint="фокус-таймер" onClick=${() => openSheet('focus', { taskId })}/>
          ${!parent || focused ? html`<${MenuItem} icon=${html`<${Icon} name="star" filled=${focused} size=${20}/>`}
            label=${focused ? 'Убрать из главного' : 'Главное на ' + humanDate(focusDate, today).toLowerCase()} onClick=${run(() => A.toggleFocus(taskId, focusDate))}/>` : null}
          ${t.repeat ? html`
            <${MenuItem} icon="up" label="Пропустить этот раз" hint="без монет и опыта" onClick=${run(() => A.skipOccurrence(taskId))}/>` : html`
            <${MenuItem} icon="calendar" label="Когда…" hint=${t.scheduledDate ? humanDate(t.scheduledDate, today) : null}
              onClick=${() => openSheet('when', { taskId, mode: 'scheduled' })}/>
            <${MenuItem} icon="flag" label="Дедлайн…" hint=${t.deadlineDate ? humanDate(t.deadlineDate, today) : null}
              onClick=${() => openSheet('when', { taskId, mode: 'deadline' })}/>`}
          <${MenuItem} icon="repeat" label="Повтор…" hint=${t.repeat ? describeRule(t.repeat) : null}
            onClick=${() => openSheet('repeat', { taskId })}/>`}
      <${MenuItem} icon="lists" label="Списки…" hint=${S.taskLists(store.data, t).map((l) => l.name).join(', ') || null}
        onClick=${() => openSheet('listPicker', { taskId })}/>
      <${MenuItem} icon="flag" label="Приоритет…" hint=${prio && prio.id !== PRIORITY_NONE_ID ? prio.name : null}
        onClick=${() => openSheet('priority', { taskId })}/>
      <${MenuItem} icon="list" label="Сделать подзадачей…" onClick=${() => openSheet('parentPicker', { taskId })}/>
      ${parent ? html`<${MenuItem} icon="up" label="Вынести на верхний уровень" hint=${'сейчас внутри «' + parent.title + '»'}
        onClick=${run(() => A.setParent(taskId, null))}/>` : null}
      <${MenuItem} icon="plus" label="Дублировать" onClick=${run(async () => {
        const c = await A.duplicateTask(taskId);
        if (c) navigate('/task/' + c.id);
      })}/>
      <${MenuItem} icon="copy" label="Скопировать текст" onClick=${run(async () => {
        try {
          const notes = liveNotes(t).map((n) => n.text).filter(Boolean);
          await navigator.clipboard.writeText([t.title, ...notes].join('\n\n'));
          showSnackbar('Скопировано');
        } catch {
          showSnackbar('Не удалось скопировать');
        }
      })}/>
      <${MenuItem} icon="trash" label=${t.repeat ? 'Удалить повторяющуюся задачу' : 'В корзину'} danger onClick=${run(() => A.trashTask(taskId))}/>
    <//>`;
}

/** «Выбрать» главные: задачи на сегодня, просроченные и «Входящие». */
function FocusPickerSheet({ date }) {
  const today = date || store.now.today;
  const v = S.todayView(store.data, today, today === store.now.today ? store.now.time : '00:00',
    Date.parse(today + 'T12:00:00Z'), today !== store.now.today);
  const focusCount = S.focusTasks(store.data, today).length;
  const seen = new Set();
  const groups = [
    ['На выбранный день', [...v.today, ...v.chores.filter((t) => !S.isOverdue(t, today, store.now.time))]],
    ['Просрочено', [...v.overdue, ...v.chores.filter((t) => S.isOverdue(t, today, store.now.time))]],
    ['Входящие', S.inboxView(store.data)],
  ].map(([title, list]) => [title, list.filter((t) => t.focusDate !== today && !S.parentOf(store.data, t) && !seen.has(t.id) && seen.add(t.id))]);
  const pick = async (id) => {
    await A.toggleFocus(id, today);
    if (S.focusTasks(store.data, today).length >= LIMITS.focusMax) closeSheet();
  };
  const total = groups.reduce((n, [, l]) => n + l.length, 0);
  return html`
    <${Sheet} title=${`Главное: ${humanDate(today, store.now.today)} · ${focusCount}/${LIMITS.focusMax}`} onClose=${closeSheet}>
      ${total === 0 ? html`<p class="empty">Нет задач на выбранный день и во «Входящих». Отметь ★ у любой задачи в её списке.</p>` : null}
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
    case 'focusPicker': return html`<${FocusPickerSheet} ...${s}/>`;
    case 'sync': return html`<${SyncPanel}/>`;
    case 'listEditor': return html`<${ListEditorSheet} ...${s}/>`;
    case 'reminder': return html`<${ReminderSheet} ...${s}/>`;
    case 'missed': return html`<${MissedSheet}/>`;
    case 'recorder': return html`<${RecorderSheet} ...${s}/>`;
    case 'parentPicker': return html`<${ParentPickerSheet} ...${s}/>`;
    case 'focus': return html`<${FocusStartSheet} ...${s}/>`;
    case 'repeat': return html`<${RepeatSheet} ...${s}/>`;
    default: return null;
  }
}
