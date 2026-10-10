// Быстрый ввод (docs/TZ.md §5.4; обновление 0.3, п. 2.7): «+» → текст → Enter. Панель остаётся открытой для следующей задачи.
// Дополнительно, по кнопкам: списки (несколько), приоритет, подзадачи, заметки.
// 0.15: при наборе — подсказки из банка задач (касание подставляет заготовку, «+» — сразу создаёт задачу), «В банк» —
// сохранить и заготовку; тот же лист в режиме template правит заготовку банка (без даты).

import { html, useState, useRef, useEffect, useMemo } from '../html.js';
import { Icon } from '../icons.js';
import { Sheet } from './Sheet.js';
import { DraftList } from './ItemLists.js';
import { DraftReminders } from './Reminders.js';
import { TimeInput } from './TimeInput.js';
import { store, closeQuickAdd, showSnackbar, openSheet } from '../../store/appState.js';
import { createTask, createList, createTemplate, updateTemplate, markTemplateUsed, saveTaskToBank, taskFromTemplate } from '../../store/actions.js';
import { sortedLists, liveList } from '../../core/selectors.js';
import * as BK from '../../core/bank.js';
import { normalizeTitle } from '../../core/model.js';
import { PRIORITY_NONE_ID } from '../../core/priorities.js';
import { addDays, isoWeekday, WEEKDAY_SHORT, humanDate } from '../../core/dates.js';
import { readLocal, writeLocal } from '../hooks.js';
import { LIMITS } from '../../config.js';
import { RepeatEditor } from './Repeat.js';
import { describeRule } from '../../core/repeat.js';
import { tr } from '../../core/i18n.js';

const liveListIds = (ids) => (ids || []).filter((id) => liveList(store.data, id));

/** Подпись заготовки: списки, время, повтор, подзадачи и заметки. */
export function templateMeta(tpl) {
  const lists = liveListIds(tpl.listIds).map((id) => store.data.lists.get(id).name);
  return [lists.length ? lists.join(', ') : tr('Входящие'), tpl.time, tpl.repeat ? '↻ ' + describeRule(tpl.repeat) : null,
    tpl.subtaskTitles.length ? tr('подзадач: {n}', { n: tpl.subtaskTitles.length }) : null, tpl.noteTexts.length ? tr('заметок: {n}', { n: tpl.noteTexts.length }) : null]
    .filter(Boolean).join(' · ');
}

function QuickAddSheet({ ctx }) {
  const today = store.now.today;
  // template: 'new' — новая заготовка банка, id — правка существующей; иначе — обычная «Новая задача»
  const tplMode = !!ctx.template;
  const editing = tplMode && ctx.template !== 'new' ? store.data.templates.get(ctx.template) || null : null;
  const init = editing || {};
  const [title, setTitle] = useState(() => (tplMode ? init.title || '' : readLocal('quickDraft', '')));
  const [notes, setNotes] = useState(() => [...(init.noteTexts || [])]);
  const [subtasks, setSubtasks] = useState(() => [...(init.subtaskTitles || [])]);
  const [date, setDate] = useState(tplMode ? null : ctx.scheduledDate);
  const [time, setTime] = useState(init.time || null);
  const [reminders, setReminders] = useState(init.reminderRules ?? null); // null — по умолчанию из настроек
  const [listIds, setListIds] = useState(() => (editing ? liveListIds(init.listIds) : ctx.listId ? [ctx.listId] : []));
  const [priorityId, setPriorityId] = useState(init.priorityId || PRIORITY_NONE_ID);
  const [focus, setFocus] = useState(!!init.focus);
  const [repeat, setRepeat] = useState(init.repeat || null);
  const [open, setOpen] = useState({ lists: false, subtasks: !!init.subtaskTitles?.length, notes: !!init.noteTexts?.length, reminders: false });
  const [newList, setNewList] = useState('');
  const [added, setAdded] = useState(0);
  const [fromTpl, setFromTpl] = useState(null); // заготовка, чьи поля подставлены (её счётчик +1 при создании)
  const [toBank, setToBank] = useState(false);
  const input = useRef(null);
  const readOnly = !!store.ui.readOnly;

  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    if (!tplMode) writeLocal('quickDraft', title ? title : undefined);
  }, [title]);

  // подсказки банка: по набранному — поиск, пустое поле — частые заготовки
  const hasBank = !tplMode && BK.templateList(store.data).length > 0;
  const suggestions = useMemo(() => {
    if (!hasBank || readOnly) return [];
    const q = normalizeTitle(title);
    const tpl = fromTpl ? store.data.templates.get(fromTpl) : null;
    if (tpl && normalizeTitle(tpl.title) === q) return [];
    return q ? BK.searchTemplates(store.data, q, { limit: 5 }) : BK.templateList(store.data).slice(0, 4);
  }, [store.version, title, fromTpl, hasBank]);

  /** Подставить заготовку: всё, кроме даты (дата — как выбрано сейчас). */
  const apply = (tpl) => {
    setTitle(tpl.title);
    setListIds(liveListIds(tpl.listIds));
    setPriorityId(tpl.priorityId || PRIORITY_NONE_ID);
    setTime(tpl.time || null);
    setReminders(tpl.reminderRules ?? null);
    setRepeat(tpl.repeat ? BK.taskInput(tpl, { date, today }).repeat : null);
    setSubtasks([...tpl.subtaskTitles]);
    setNotes([...tpl.noteTexts]);
    setFocus(!!tpl.focus);
    setOpen({ ...open, subtasks: tpl.subtaskTitles.length > 0, notes: tpl.noteTexts.length > 0 });
    setFromTpl(tpl.id);
    input.current?.focus();
  };
  // после задачи из заготовки — и её списки, время и повтор (обычно список и время остаются для следующей задачи)
  const reset = (full = !!fromTpl) => {
    setTitle('');
    setNotes([]);
    setSubtasks([]);
    setFocus(false);
    setPriorityId(PRIORITY_NONE_ID);
    setReminders(null);
    if (full) {
      setListIds(ctx.listId ? [ctx.listId] : []);
      setTime(null);
      setRepeat(null);
    }
    setFromTpl(null);
    setToBank(false);
    setOpen({ ...open, subtasks: false, notes: false, repeat: full ? false : open.repeat });
  };
  const fields = (t) => ({
    title: t, listIds, priorityId, time, reminderRules: reminders, repeat, focus,
    noteTexts: notes.filter((n) => n.trim()), subtaskTitles: subtasks.filter((s) => s.trim()),
  });

  const submit = async (e) => {
    e?.preventDefault();
    const t = normalizeTitle(title);
    if (!t || readOnly) return;
    if (tplMode) {
      const ok = editing ? await updateTemplate(editing.id, fields(t)) : await createTemplate(fields(t));
      if (ok) {
        showSnackbar(editing ? tr('Заготовка сохранена') : tr('«{title}» — в банке задач', { title: t }));
        closeQuickAdd();
      }
      return;
    }
    const r = await createTask({
      title: t, listIds, priorityId, scheduledDate: repeat ? null : date, scheduledTime: date || repeat ? time : null, focus, focusDate: date || today, repeat,
      reminders: reminders ?? undefined,
      notes: notes.filter((n) => n.trim()), subtasks: subtasks.filter((s) => s.trim()),
    });
    if (r) {
      if (fromTpl && store.data.templates.get(fromTpl) && !toBank) await markTemplateUsed(fromTpl);
      if (toBank) await saveTaskToBank(r.task.id);
      reset();
      setAdded((n) => n + 1);
      if (r.focusRejected) showSnackbar(tr('Уже {focusMax} главных — задача добавлена без ★', { focusMax: LIMITS.focusMax }));
    }
    input.current?.focus();
  };

  /** «+» у подсказки: задача из заготовки сразу, на выбранный день. */
  const addNow = async (tpl) => {
    const r = await taskFromTemplate(tpl.id, { date });
    if (r) {
      reset(fromTpl === tpl.id); // набранное было поиском по банку
      setAdded((n) => n + 1);
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
  const dayLabel = (d, i) => (i === 0 ? tr('Сегодня') : i === 1 ? tr('Завтра') : WEEKDAY_SHORT[isoWeekday(d) - 1]);
  const flip = (k) => setOpen({ ...open, [k]: !open[k] });
  const timed = tplMode || date; // у заготовки нет даты — время и напоминания задаются сразу
  const reminderDraft = { scheduledDate: date || today, scheduledTime: time, deadlineDate: null };
  const typed = !!normalizeTitle(title);
  const sameInBank = !tplMode && typed && BK.findByTitle(store.data, title);
  const listsLabel = listIds.length
    ? listIds.map((id) => store.data.lists.get(id)?.name).filter(Boolean).slice(0, 2).join(', ') + (listIds.length > 2 ? ` +${listIds.length - 2}` : '')
    : tr('Входящие');

  return html`
    <${Sheet} title=${tplMode ? (editing ? tr('Заготовка в банке задач') : tr('Новая заготовка')) : tr('Новая задача')} onClose=${closeQuickAdd} className="quick-add">
      <form onSubmit=${submit}>
        ${added ? html`<div class="qa-counter">Добавлено: ${added}</div>` : null}
        ${tplMode ? html`<p class="qa-note qa-bank-note">Заготовка — задача без даты: день выбирается, когда создаёшь из неё задачу (в банке задач или в «Новой задаче» — начни печатать название).</p>` : null}
        <div class="qa-input-row">
          <input ref=${input} class="qa-input" value=${title} maxLength=${LIMITS.titleMax} enterkeyhint="done"
            placeholder=${tplMode ? tr('Название заготовки') : hasBank ? tr('Что сделать? Или найди в банке задач') : tr('Что сделать? Конкретное действие')}
            aria-label=${tplMode ? tr('Название заготовки') : tr('Название задачи')}
            onInput=${(e) => setTitle(e.target.value)} onPaste=${onPaste} disabled=${readOnly}/>
          <button type="submit" class="btn primary" disabled=${!typed || readOnly}>${tplMode ? tr('Сохранить') : tr('Добавить')}</button>
        </div>
        ${suggestions.length ? html`<div class=${'qa-bank' + (typed ? '' : ' frequent')} role="group" aria-label=${tr('Из банка задач')}>
          <div class="qa-bank-title"><${Icon} name="bank" size=${14}/> ${typed ? tr('Из банка задач') : tr('Частые из банка задач')}</div>
          ${suggestions.map((tpl) => html`<div class="qa-bank-row" key=${tpl.id}>
            <button type="button" class="qa-bank-pick" onClick=${() => apply(tpl)} title=${tr('Подставить заготовку — можно поправить перед созданием')}>
              <span class="qa-bank-name">${tpl.title}</span><small class="muted">${templateMeta(tpl)}</small>
            </button>
            <button type="button" class="icon-btn qa-bank-add" onClick=${() => addNow(tpl)}
              aria-label=${tr('Создать «{title}» сразу', { title: tpl.title })} title=${date ? tr('Создать сразу — на {day}', { day: humanDate(date, today).toLowerCase() }) : tr('Создать сразу')}>
              <${Icon} name="plus" size=${18}/></button>
          </div>`)}
        </div>` : null}
        ${tplMode ? null : html`
        <div class="chip-row scroll">
          ${dayChips.map((d, i) => html`
            <button type="button" class=${'chip' + (date === d ? ' selected' : '')}
              onClick=${() => setDate(date === d ? null : d)}>${dayLabel(d, i)}</button>`)}
        </div>
        <label class="field"><span>Дата задачи</span><input type="date" aria-label="Дата новой задачи" value=${date || ''}
          onChange=${e => setDate(e.target.value || null)}/></label>`}
        ${timed ? html`<div class="chip-row wrap">
          <span class=${'chip chip-timebox' + (time ? ' selected' : '')}><${Icon} name="clock" size=${16}/>
            <${TimeInput} value=${time} onChange=${setTime} label="Время"/></span>
          <button type="button" class=${'chip' + (open.reminders ? ' selected' : '')} onClick=${() => flip('reminders')} aria-expanded=${open.reminders}>
            <${Icon} name="bell" size=${16}/> Напоминание${reminders && !reminders.length ? tr(': нет') : ''}</button>
        </div>` : null}
        <div class="chip-row wrap">
          <button type="button" class=${'chip' + (focus ? ' selected' : '')} onClick=${() => setFocus(!focus)}
            aria-pressed=${focus}><${Icon} name="star" filled=${focus} size=${16}/> Главное</button>
          <button type="button" class=${'chip' + (open.lists || listIds.length ? ' selected' : '')} onClick=${() => flip('lists')}
            aria-expanded=${open.lists}><${Icon} name=${listIds.length ? 'lists' : 'inbox'} size=${16}/> ${listsLabel}</button>
          <button type="button" class=${'chip' + (priorityId !== PRIORITY_NONE_ID ? ' selected' : '')}
            onClick=${(e) => openSheet('priority', { anchor: e.currentTarget.getBoundingClientRect(), current: priorityId, onPick: setPriorityId })}>
            <i class="dot big" style=${{ background: prio?.color || '#9E9E9E' }}></i> ${priorityId !== PRIORITY_NONE_ID ? prio?.name : tr('Приоритет')}</button>
          <button type="button" class=${'chip' + (open.repeat || repeat ? ' selected' : '')} onClick=${() => flip('repeat')}
            aria-expanded=${!!open.repeat}><${Icon} name="repeat" size=${16}/> ${repeat ? describeRule(repeat) : tr('Повтор')}</button>
          <button type="button" class=${'chip' + (open.subtasks ? ' selected' : '')} onClick=${() => { flip('subtasks'); if (!subtasks.length) setSubtasks(['']); }}
            aria-expanded=${open.subtasks}><${Icon} name="list" size=${16}/> Подзадачи${subtasks.filter((s) => s.trim()).length ? ' · ' + subtasks.filter((s) => s.trim()).length : ''}</button>
          <button type="button" class=${'chip' + (open.notes ? ' selected' : '')} onClick=${() => { flip('notes'); if (!notes.length) setNotes(['']); }}
            aria-expanded=${open.notes}><${Icon} name="edit" size=${16}/> Заметки${notes.filter((s) => s.trim()).length ? ' · ' + notes.filter((s) => s.trim()).length : ''}</button>
          ${tplMode ? null : html`<button type="button" class=${'chip' + (toBank ? ' selected' : '')} onClick=${() => setToBank(!toBank)} aria-pressed=${toBank}
            title=${sameInBank ? tr('Заготовка с таким названием уже есть — обновится') : tr('Сохранить и заготовкой в банке задач — потом не печатать заново')}>
            <${Icon} name="bank" size=${16}/> ${sameInBank ? tr('Обновить в банке') : tr('В банк')}</button>`}
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
        ${open.reminders && timed ? html`<div class="qa-panel"><div class="field-label">Напоминания</div>
          <${DraftReminders} draft=${reminderDraft} value=${reminders} setValue=${setReminders} onSetTime=${setTime}/></div>` : null}
        ${open.repeat ? html`<div class="qa-panel"><div class="field-label">Повтор</div>
          <${RepeatEditor} value=${repeat} onChange=${setRepeat} startDate=${date || today}/>
          ${repeat && !tplMode ? html`<div class="chip-row wrap"><span class=${'chip chip-timebox' + (time ? ' selected' : '')}><${Icon} name="clock" size=${16}/>
            <${TimeInput} value=${time} onChange=${setTime} label="Время"/></span></div>` : null}</div>` : null}
        ${open.subtasks ? html`<div class="qa-panel"><div class="field-label">Подзадачи</div>
          <${DraftList} items=${subtasks} setItems=${setSubtasks} placeholder="Подзадача" addLabel="Добавить подзадачу"/></div>` : null}
        ${open.notes ? html`<div class="qa-panel"><div class="field-label">Заметки</div>
          <${DraftList} items=${notes} setItems=${setNotes} placeholder="Текст заметки" addLabel="Добавить заметку" multiline/></div>` : null}
      </form>
    <//>`;
}

export function QuickAddHost() {
  const qa = store.ui.quickAdd;
  return qa ? html`<${QuickAddSheet} key=${qa.template || 'task'} ctx=${qa}/>` : null;
}
