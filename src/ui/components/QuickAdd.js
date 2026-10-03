// Быстрый ввод (docs/TZ.md §5.4; обновление 0.3, п. 2.7): «+» → текст → Enter. Панель остаётся открытой для следующей задачи.
// Дополнительно, по кнопкам: списки (несколько), приоритет, подзадачи, заметки.

import { html, useState, useRef, useEffect } from '../html.js';
import { Icon } from '../icons.js';
import { Sheet } from './Sheet.js';
import { DraftList } from './ItemLists.js';
import { DraftReminders } from './Reminders.js';
import { TimeInput } from './TimeInput.js';
import { store, closeQuickAdd, showSnackbar, openSheet } from '../../store/appState.js';
import { createTask, createList } from '../../store/actions.js';
import { sortedLists } from '../../core/selectors.js';
import { normalizeTitle } from '../../core/model.js';
import { PRIORITY_NONE_ID } from '../../core/priorities.js';
import { addDays, isoWeekday, WEEKDAY_SHORT } from '../../core/dates.js';
import { readLocal, writeLocal } from '../hooks.js';
import { LIMITS } from '../../config.js';

function QuickAddSheet({ ctx }) {
  const today = store.now.today;
  const [title, setTitle] = useState(() => readLocal('quickDraft', ''));
  const [notes, setNotes] = useState([]);
  const [subtasks, setSubtasks] = useState([]);
  const [date, setDate] = useState(ctx.scheduledDate);
  const [time, setTime] = useState(null);
  const [reminders, setReminders] = useState(null); // null — по умолчанию из настроек
  const [listIds, setListIds] = useState(ctx.listId ? [ctx.listId] : []);
  const [priorityId, setPriorityId] = useState(PRIORITY_NONE_ID);
  const [focus, setFocus] = useState(false);
  const [open, setOpen] = useState({ lists: false, subtasks: false, notes: false, reminders: false });
  const [newList, setNewList] = useState('');
  const [added, setAdded] = useState(0);
  const input = useRef(null);
  const readOnly = !!store.ui.readOnly;

  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    writeLocal('quickDraft', title ? title : undefined);
  }, [title]);

  const submit = async (e) => {
    e?.preventDefault();
    const t = normalizeTitle(title);
    if (!t || readOnly) return;
    const r = await createTask({
      title: t, listIds, priorityId, scheduledDate: date, scheduledTime: date ? time : null, focus, focusDate: date || today,
      reminders: reminders ?? undefined,
      notes: notes.filter((n) => n.trim()), subtasks: subtasks.filter((s) => s.trim()),
    });
    if (r) {
      setTitle('');
      setNotes([]);
      setSubtasks([]);
      setFocus(false);
      setPriorityId(PRIORITY_NONE_ID);
      setReminders(null);
      setOpen({ ...open, subtasks: false, notes: false });
      setAdded((n) => n + 1);
      if (r.focusRejected) showSnackbar(`Уже ${LIMITS.focusMax} главных — задача добавлена без ★`);
    }
    input.current?.focus();
  };

  // Вставка многострочного текста: первая строка — название, остальное — заметка.
  const onPaste = (e) => {
    const text = e.clipboardData?.getData('text') || '';
    if (!/[\r\n]/.test(text)) return;
    e.preventDefault();
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const i = lines.findIndex((l) => l.trim());
    if (i < 0) return;
    setTitle((title + ' ' + lines[i]).trim());
    const rest = lines.slice(i + 1).join('\n').trim();
    if (rest) {
      setNotes([...notes.filter((n) => n.trim()), rest]);
      setOpen({ ...open, notes: true });
    }
  };

  const toggleList = (id) => setListIds(listIds.includes(id) ? listIds.filter((x) => x !== id) : [...listIds, id]);
  const addList = async () => {
    const n = newList.trim();
    if (!n) return;
    const l = await createList({ name: n, color: '#1E88E5', emoji: null });
    if (l) setListIds([...listIds, l.id]);
    setNewList('');
  };
  const prio = store.data.priorities.get(priorityId);
  const lists = sortedLists(store.data);
  const dayChips = [today, addDays(today, 1), ...[2, 3, 4, 5, 6, 7].map((n) => addDays(today, n))];
  const dayLabel = (d, i) => (i === 0 ? 'Сегодня' : i === 1 ? 'Завтра' : WEEKDAY_SHORT[isoWeekday(d) - 1]);
  const flip = (k) => setOpen({ ...open, [k]: !open[k] });
  const listsLabel = listIds.length
    ? listIds.map((id) => store.data.lists.get(id)?.name).filter(Boolean).slice(0, 2).join(', ') + (listIds.length > 2 ? ` +${listIds.length - 2}` : '')
    : 'Входящие';

  return html`
    <${Sheet} title="Новая задача" onClose=${closeQuickAdd} className="quick-add">
      <form onSubmit=${submit}>
        ${added ? html`<div class="qa-counter">Добавлено: ${added}</div>` : null}
        <div class="qa-input-row">
          <input ref=${input} class="qa-input" value=${title} maxLength=${LIMITS.titleMax} enterkeyhint="done"
            placeholder="Что сделать? Конкретное действие" aria-label="Название задачи"
            onInput=${(e) => setTitle(e.target.value)} onPaste=${onPaste} disabled=${readOnly}/>
          <button type="submit" class="btn primary" disabled=${!normalizeTitle(title) || readOnly}>Добавить</button>
        </div>
        <div class="chip-row scroll">
          ${dayChips.map((d, i) => html`
            <button type="button" class=${'chip' + (date === d ? ' selected' : '')}
              onClick=${() => setDate(date === d ? null : d)}>${dayLabel(d, i)}</button>`)}
        </div>
        <label class="field"><span>Дата задачи</span><input type="date" aria-label="Дата новой задачи" value=${date || ''}
          onChange=${e => setDate(e.target.value || null)}/></label>
        ${date ? html`<div class="chip-row wrap">
          <span class=${'chip chip-timebox' + (time ? ' selected' : '')}><${Icon} name="clock" size=${16}/>
            <${TimeInput} value=${time} onChange=${setTime} label="Время"/></span>
          <button type="button" class=${'chip' + (open.reminders ? ' selected' : '')} onClick=${() => flip('reminders')} aria-expanded=${open.reminders}>
            <${Icon} name="bell" size=${16}/> Напоминание${reminders && !reminders.length ? ': нет' : ''}</button>
        </div>` : null}
        <div class="chip-row wrap">
          <button type="button" class=${'chip' + (focus ? ' selected' : '')} onClick=${() => setFocus(!focus)}
            aria-pressed=${focus}><${Icon} name="star" filled=${focus} size=${16}/> Главное</button>
          <button type="button" class=${'chip' + (open.lists || listIds.length ? ' selected' : '')} onClick=${() => flip('lists')}
            aria-expanded=${open.lists}><${Icon} name=${listIds.length ? 'lists' : 'inbox'} size=${16}/> ${listsLabel}</button>
          <button type="button" class=${'chip' + (priorityId !== PRIORITY_NONE_ID ? ' selected' : '')}
            onClick=${(e) => openSheet('priority', { anchor: e.currentTarget.getBoundingClientRect(), current: priorityId, onPick: setPriorityId })}>
            <i class="dot big" style=${{ background: prio?.color || '#9E9E9E' }}></i> ${priorityId !== PRIORITY_NONE_ID ? prio?.name : 'Приоритет'}</button>
          <button type="button" class=${'chip' + (open.subtasks ? ' selected' : '')} onClick=${() => { flip('subtasks'); if (!subtasks.length) setSubtasks(['']); }}
            aria-expanded=${open.subtasks}><${Icon} name="list" size=${16}/> Подзадачи${subtasks.filter((s) => s.trim()).length ? ' · ' + subtasks.filter((s) => s.trim()).length : ''}</button>
          <button type="button" class=${'chip' + (open.notes ? ' selected' : '')} onClick=${() => { flip('notes'); if (!notes.length) setNotes(['']); }}
            aria-expanded=${open.notes}><${Icon} name="edit" size=${16}/> Заметки${notes.filter((s) => s.trim()).length ? ' · ' + notes.filter((s) => s.trim()).length : ''}</button>
        </div>
        ${open.lists ? html`
          <div class="qa-panel">
            <div class="chip-row wrap">
              ${lists.map((l) => html`<button type="button" class=${'chip' + (listIds.includes(l.id) ? ' selected' : '')}
                onClick=${() => toggleList(l.id)}><i class="dot" style=${{ background: l.color }}></i>${l.emoji ? l.emoji + ' ' : ''}${l.name}</button>`)}
            </div>
            <div class="inline-add">
              <input value=${newList} placeholder="+ Новый список" maxLength="40" onInput=${(e) => setNewList(e.target.value)}
                onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); addList(); } }}/>
              <button type="button" class="btn small" onClick=${addList} disabled=${!newList.trim()}>Создать</button>
            </div>
          </div>` : null}
        ${open.reminders && date ? html`<div class="qa-panel"><div class="field-label">Напоминания</div>
          <${DraftReminders} draft=${{ scheduledDate: date, scheduledTime: time, deadlineDate: null }} value=${reminders} setValue=${setReminders} onSetTime=${setTime}/></div>` : null}
        ${open.subtasks ? html`<div class="qa-panel"><div class="field-label">Подзадачи</div>
          <${DraftList} items=${subtasks} setItems=${setSubtasks} placeholder="Подзадача" addLabel="Добавить подзадачу"/></div>` : null}
        ${open.notes ? html`<div class="qa-panel"><div class="field-label">Заметки</div>
          <${DraftList} items=${notes} setItems=${setNotes} placeholder="Текст заметки" addLabel="Добавить заметку" multiline/></div>` : null}
      </form>
    <//>`;
}

export function QuickAddHost() {
  const qa = store.ui.quickAdd;
  return qa ? html`<${QuickAddSheet} ctx=${qa}/>` : null;
}
