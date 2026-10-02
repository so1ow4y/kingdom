// Карточка задачи (docs/TZ.md §6.6). Сохранение автоматическое: текст — через 400 мс после ввода
// и при потере фокуса, остальное — сразу.

import { html, useState, useRef, useEffect, useLayoutEffect } from '../html.js';
import { Icon } from '../icons.js';
import { Banner } from '../components/Overlays.js';
import { PRIORITY_LABEL } from '../components/TaskRow.js';
import { goBack, navigate } from '../router.js';
import { store, openSheet, showSnackbar, registerFlusher } from '../../store/appState.js';
import * as A from '../../store/actions.js';
import { liveList, hasMissingList } from '../../core/selectors.js';
import { normalizeTitle, normalizeNote } from '../../core/model.js';
import { humanDate, formatMoment } from '../../core/dates.js';
import { LIMITS, TIMINGS } from '../../config.js';

const URL_RE = /(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]'])/g;

function Linkified({ text }) {
  const parts = text.split(URL_RE);
  return parts.map((p, i) => (i % 2 === 1
    ? html`<a href=${p} target="_blank" rel="noopener noreferrer" onClick=${(e) => e.stopPropagation()}>${p}</a>`
    : p));
}

function autosize(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 2 + 'px';
}

function Chip({ icon, label, onClick, active = false, disabled = false, tone = '', title }) {
  return html`<button class=${'chip' + (active ? ' active' : '') + (tone ? ' ' + tone : '')} onClick=${onClick}
    disabled=${disabled} title=${title || label}>${icon}<span>${label}</span></button>`;
}

export function TaskScreen({ taskId, panel = false, onClose }) {
  const t = A.getTask(taskId);
  const [title, setTitle] = useState(t?.title ?? '');
  const [note, setNote] = useState(t?.note ?? '');
  const [editingNote, setEditingNote] = useState(false);
  const pending = useRef({});
  const timer = useRef(null);
  const focused = useRef({ title: false, note: false });
  const titleEl = useRef(null);
  const noteEl = useRef(null);

  const flush = async () => {
    clearTimeout(timer.current);
    timer.current = null;
    const p = pending.current;
    pending.current = {};
    const cur = A.getTask(taskId);
    if (!cur || cur.deletedAt) return;
    const changes = {};
    if ('title' in p) {
      const nt = normalizeTitle(p.title);
      if (nt) changes.title = nt;
    }
    if ('note' in p) changes.note = normalizeNote(p.note);
    if (Object.keys(changes).length) await A.updateTask(taskId, changes);
  };

  const scheduleSave = (field, value) => {
    pending.current[field] = value;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, TIMINGS.textSaveDebounceMs);
  };

  useEffect(() => {
    const off = registerFlusher(flush);
    return () => {
      off();
      flush();
    };
  }, [taskId]);

  // Изменение пришло извне (другая вкладка, отмена) — обновить поле, если его сейчас не редактируют.
  useEffect(() => {
    if (t && !focused.current.title && !('title' in pending.current)) setTitle(t.title);
  }, [t?.title]);
  useEffect(() => {
    if (t && !focused.current.note && !('note' in pending.current)) setNote(t.note);
  }, [t?.note]);

  useLayoutEffect(() => autosize(titleEl.current), [title]);
  useLayoutEffect(() => autosize(noteEl.current), [note, editingNote]);

  const close = () => (onClose ? onClose() : goBack('/today'));

  if (!t || t.deletedAt) {
    return html`
      <div class="screen task-screen">
        <${TaskHeader} panel=${panel} onClose=${close}/>
        <div class="empty-state">
          <p>Задача не найдена — возможно, удалена на другом устройстве.</p>
          <button class="btn" onClick=${() => navigate('/today')}>К «Сегодня»</button>
        </div>
      </div>`;
  }

  const today = store.now.today;
  const tz = store.data.settings.timeZone;
  const trashed = !!t.trashedAt;
  const done = t.status === 'done';
  const locked = trashed || !!store.ui.readOnly;
  const list = liveList(store.data, t.listId);
  const focusedToday = t.focusDate === today;
  const device = (id) => store.data.devices.get(id)?.name;

  const onTitleInput = (e) => {
    const v = e.target.value.replace(/[\r\n]+/g, ' ');
    setTitle(v);
    if (normalizeTitle(v)) scheduleSave('title', v);
    else delete pending.current.title;
  };
  const onTitleBlur = () => {
    focused.current.title = false;
    if (!normalizeTitle(title)) {
      setTitle(t.title);
      delete pending.current.title;
      showSnackbar('Название не может быть пустым');
    } else {
      flush();
    }
  };
  const onTitleKey = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      setEditingNote(true);
      setTimeout(() => noteEl.current?.focus(), 0);
    }
  };
  const onNoteInput = (e) => {
    const v = e.target.value.slice(0, LIMITS.noteMax);
    setNote(v);
    scheduleSave('note', v);
  };
  const onNoteBlur = () => {
    focused.current.note = false;
    setEditingNote(false);
    flush();
  };

  const showNoteEditor = editingNote || !note || locked;

  return html`
    <div class="screen task-screen">
      <${TaskHeader} panel=${panel} onClose=${close} taskId=${taskId}/>

      ${trashed ? html`
        <${Banner} tone="warn" actions=${html`
          <button class="btn small primary" onClick=${() => A.restoreTask(taskId)}>Восстановить</button>
          <button class="btn small danger-outline" onClick=${async () => { if (await A.deleteForever(taskId)) close(); }}>Удалить навсегда</button>`}>
          Задача в корзине
        <//>` : null}
      ${done && !trashed ? html`
        <${Banner} tone="ok" actions=${html`<button class="btn small" onClick=${() => A.reopenTask(taskId)} disabled=${locked}>Вернуть</button>`}>
          Выполнена ${t.completedAt ? formatMoment(t.completedAt, tz) : ''}
        <//>` : null}

      <div class="task-title-row">
        <button class=${'check big' + (done ? ' checked' : '')} disabled=${locked}
          onClick=${() => A.toggleComplete(taskId)} aria-label=${done ? 'Вернуть в работу' : 'Выполнить'}>
          ${done ? html`<${Icon} name="check" size=${18}/>` : null}
        </button>
        <textarea ref=${titleEl} class=${'title-input' + (done ? ' done' : '')} rows="1" value=${title}
          maxLength=${LIMITS.titleMax} disabled=${locked} aria-label="Название" enterkeyhint="next"
          placeholder="Конкретное действие: «смонтировать 0:00–3:00»"
          onInput=${onTitleInput} onFocus=${() => { focused.current.title = true; }} onBlur=${onTitleBlur} onKeyDown=${onTitleKey}></textarea>
      </div>

      <div class="chip-row wrap task-chips">
        <${Chip} icon=${html`<${Icon} name=${list ? 'lists' : 'inbox'} size=${16}/>`}
          label=${list ? (list.emoji ? list.emoji + ' ' : '') + list.name : hasMissingList(store.data, t) ? 'Список удалён' : 'Входящие'}
          onClick=${() => openSheet('listPicker', { taskId })} disabled=${locked}/>
        <${Chip} icon=${html`<${Icon} name="calendar" size=${16}/>`} active=${!!t.scheduledDate}
          tone=${!done && t.scheduledDate && t.scheduledDate < today ? 'late' : ''}
          label=${t.scheduledDate ? humanDate(t.scheduledDate, today) + (t.scheduledTime ? ' ' + t.scheduledTime : '') : 'Когда'}
          onClick=${() => openSheet('when', { taskId, mode: 'scheduled' })} disabled=${locked}/>
        <${Chip} icon=${html`<${Icon} name="flag" size=${16}/>`} active=${!!t.deadlineDate}
          label=${t.deadlineDate ? 'Дедлайн ' + humanDate(t.deadlineDate, today) + (t.deadlineTime ? ' ' + t.deadlineTime : '') : 'Дедлайн'}
          onClick=${() => openSheet('when', { taskId, mode: 'deadline' })} disabled=${locked}/>
        <${Chip} icon=${html`<span class=${'meta-prio ' + ['', 'prio-low', 'prio-mid', 'prio-high'][t.priority || 0]}><${Icon} name="flag" size=${16}/></span>`}
          active=${t.priority > 0} label=${t.priority ? PRIORITY_LABEL[t.priority] : 'Приоритет'}
          onClick=${() => openSheet('priority', { taskId })} disabled=${locked}/>
        ${!done ? html`<${Chip} icon=${html`<${Icon} name="star" filled=${focusedToday} size=${16}/>`} active=${focusedToday}
          tone=${focusedToday ? 'star-on' : ''} label=${focusedToday ? 'Главное' : 'В главное'}
          onClick=${() => A.toggleFocus(taskId)} disabled=${locked}/>` : null}
      </div>
      ${t.deadlineDate && t.scheduledDate && t.deadlineDate < t.scheduledDate
        ? html`<p class="hint warn">Дедлайн раньше даты выполнения</p>` : null}

      <div class="note-block">
        <div class="field-label">Заметка</div>
        ${showNoteEditor ? html`
          <textarea ref=${noteEl} class="note-input" value=${note} rows="3" disabled=${locked}
            placeholder="Подробности, ссылки, мысли…" aria-label="Заметка"
            onInput=${onNoteInput} onFocus=${() => { focused.current.note = true; }} onBlur=${onNoteBlur}></textarea>` : html`
          <div class="note-view" role="button" tabIndex="0" title="Нажми, чтобы редактировать"
            onClick=${() => { setEditingNote(true); setTimeout(() => noteEl.current?.focus(), 0); }}
            onKeyDown=${(e) => { if (e.key === 'Enter') { setEditingNote(true); setTimeout(() => noteEl.current?.focus(), 0); } }}>
            <${Linkified} text=${note}/>
          </div>`}
        ${note.length >= LIMITS.noteCounterFrom ? html`<div class="counter">${note.length} / ${LIMITS.noteMax}</div>` : null}
      </div>

      <p class="task-footer muted">
        ${`Создана ${formatMoment(t.createdAt, tz)}${t.createdVia === 'bot' ? ' ботом' : ''} · `
          + `Изменена ${formatMoment(t.updatedAt, tz)}${device(t.updatedBy) ? ` на «${device(t.updatedBy)}»` : ''}`}
      </p>
    </div>`;
}

function TaskHeader({ panel, onClose, taskId = null }) {
  return html`
    <div class="task-header">
      <button class="icon-btn" onClick=${onClose} aria-label=${panel ? 'Закрыть' : 'Назад'} title=${panel ? 'Закрыть' : 'Назад'}>
        <${Icon} name=${panel ? 'close' : 'back'}/>
      </button>
      <span class="task-header-title">Задача</span>
      ${taskId ? html`<button class="icon-btn" onClick=${() => openSheet('taskMenu', { taskId })} aria-label="Действия" title="Действия">
        <${Icon} name="dots"/></button>` : null}
    </div>`;
}
