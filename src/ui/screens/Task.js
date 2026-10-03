// Карточка задачи (docs/TZ.md §6.6; обновление 0.3: заметки 2.2, списки 2.4, подзадачи 2.8, приоритет 2.9).
// Сохранение автоматическое: название — через 400 мс после ввода и при потере фокуса, остальное — сразу.

import { html, useState, useRef, useEffect, useLayoutEffect, useMemo } from '../html.js';
import { Icon } from '../icons.js';
import { Banner } from '../components/Overlays.js';
import { NotesEditor, SubtasksEditor } from '../components/ItemLists.js';
import { RemindersEditor } from '../components/Reminders.js';
import { closeTask, navigate, openTask } from '../router.js';
import { store, openSheet, showSnackbar, registerFlusher } from '../../store/appState.js';
import * as A from '../../store/actions.js';
import * as S from '../../core/selectors.js';
import { normalizeTitle } from '../../core/model.js';
import { humanDate, formatMoment } from '../../core/dates.js';
import { PRIORITY_NONE_ID } from '../../core/priorities.js';
import { LIMITS, TIMINGS } from '../../config.js';

function autosize(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 2 + 'px';
}

function Chip({ icon, label, onClick, active = false, disabled = false, tone = '', title, style = null }) {
  return html`<button class=${'chip' + (active ? ' active' : '') + (tone ? ' ' + tone : '')} onClick=${onClick}
    disabled=${disabled} title=${title || label} style=${style}>${icon}<span>${label}</span></button>`;
}

const anchorOf = (e) => e.currentTarget.getBoundingClientRect();

export function TaskScreen({ taskId, panel = false, onClose }) {
  const t = A.getTask(taskId);
  const [title, setTitle] = useState(t?.title ?? '');
  const pending = useRef(null);
  const timer = useRef(null);
  const focused = useRef(false);
  const titleEl = useRef(null);
  const index = useMemo(() => S.childrenIndex(store.data), [store.version]);

  const flush = async () => {
    clearTimeout(timer.current);
    timer.current = null;
    const v = pending.current;
    pending.current = null;
    const cur = A.getTask(taskId);
    if (v == null || !cur || cur.deletedAt) return;
    const nt = normalizeTitle(v);
    if (nt) await A.updateTask(taskId, { title: nt });
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
    if (t && !focused.current && pending.current == null) setTitle(t.title);
  }, [t?.title]);
  useLayoutEffect(() => autosize(titleEl.current), [title]);

  const close = () => (onClose ? onClose() : closeTask());

  if (!t || t.deletedAt) {
    return html`
      <div class="screen task-screen">
        <${TaskHeader} onClose=${close}/>
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
  const lists = S.taskLists(store.data, t);
  const prio = S.priorityOf(store.data, t);
  const parent = S.parentOf(store.data, t);
  const focusedToday = t.focusDate === today;
  const progress = S.progressOf(store.data, taskId, index);
  const device = (id) => store.data.devices.get(id)?.name;

  const onTitleInput = (e) => {
    const v = e.target.value.replace(/[\r\n]+/g, ' ');
    setTitle(v);
    if (normalizeTitle(v)) {
      pending.current = v;
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, TIMINGS.textSaveDebounceMs);
    } else pending.current = null;
  };
  const onTitleBlur = () => {
    focused.current = false;
    if (!normalizeTitle(title)) {
      setTitle(t.title);
      pending.current = null;
      showSnackbar('Название не может быть пустым');
    } else flush();
  };

  const listLabel = lists.length
    ? (lists.length > 2 ? `${lists[0].name}, ${lists[1].name} +${lists.length - 2}` : lists.map((l) => (l.emoji ? l.emoji + ' ' : '') + l.name).join(', '))
    : S.hasMissingList(store.data, t) ? 'Список удалён' : 'Входящие';

  return html`
    <div class="screen task-screen">
      <${TaskHeader} onClose=${close} taskId=${taskId}/>

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

      ${parent ? html`<button class="parent-link" onClick=${() => openTask(parent.id)}>↳ подзадача «${parent.title}»</button>` : null}

      <div class="task-title-row">
        <button class=${'check big' + (done ? ' checked' : '')} disabled=${locked}
          onClick=${() => A.toggleComplete(taskId)} aria-label=${done ? 'Вернуть в работу' : 'Выполнить'}>
          ${done ? html`<${Icon} name="check" size=${18}/>` : null}
        </button>
        <textarea ref=${titleEl} class=${'title-input' + (done ? ' done' : '')} rows="1" value=${title}
          maxLength=${LIMITS.titleMax} disabled=${locked} aria-label="Название" enterkeyhint="done"
          placeholder="Конкретное действие: «смонтировать 0:00–3:00»"
          onInput=${onTitleInput} onFocus=${() => { focused.current = true; }} onBlur=${onTitleBlur}
          onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }}></textarea>
      </div>

      <div class="chip-row wrap task-chips">
        <${Chip} icon=${html`<${Icon} name=${lists.length ? 'lists' : 'inbox'} size=${16}/>`} label=${listLabel} active=${lists.length > 0}
          onClick=${(e) => openSheet('listPicker', { taskId, anchor: anchorOf(e) })} disabled=${locked}/>
        <${Chip} icon=${html`<${Icon} name="calendar" size=${16}/>`} active=${!!t.scheduledDate}
          tone=${!done && t.scheduledDate && t.scheduledDate < today ? 'late' : ''}
          label=${t.scheduledDate ? humanDate(t.scheduledDate, today) + (t.scheduledTime ? ' ' + t.scheduledTime : '') : 'Когда'}
          onClick=${() => openSheet('when', { taskId, mode: 'scheduled' })} disabled=${locked}/>
        <${Chip} icon=${html`<${Icon} name="flag" size=${16}/>`} active=${!!t.deadlineDate}
          label=${t.deadlineDate ? 'Дедлайн ' + humanDate(t.deadlineDate, today) + (t.deadlineTime ? ' ' + t.deadlineTime : '') : 'Дедлайн'}
          onClick=${() => openSheet('when', { taskId, mode: 'deadline' })} disabled=${locked}/>
        <${Chip} icon=${html`<i class="dot big" style=${{ background: prio?.color || '#9E9E9E' }}></i>`}
          active=${prio && prio.id !== PRIORITY_NONE_ID} label=${prio && prio.id !== PRIORITY_NONE_ID ? prio.name : 'Приоритет'}
          onClick=${(e) => openSheet('priority', { taskId, anchor: anchorOf(e) })} disabled=${locked}/>
        ${!done ? html`<${Chip} icon=${html`<${Icon} name="star" filled=${focusedToday} size=${16}/>`} active=${focusedToday}
          tone=${focusedToday ? 'star-on' : ''} label=${focusedToday ? 'Главное' : 'В главное'}
          onClick=${() => A.toggleFocus(taskId)} disabled=${locked}/>` : null}
      </div>
      ${t.deadlineDate && t.scheduledDate && t.deadlineDate < t.scheduledDate
        ? html`<p class="hint warn">Дедлайн раньше даты выполнения</p>` : null}

      <section class="card-section">
        <div class="field-label">Подзадачи${progress.total ? ` · ${progress.done}/${progress.total}` : ''}</div>
        ${progress.total ? html`<div class="progress"><i style=${{ width: (progress.done / progress.total) * 100 + '%' }}></i></div>` : null}
        <${SubtasksEditor} taskId=${taskId} locked=${locked}/>
      </section>

      <section class="card-section">
        <div class="field-label">Напоминания</div>
        <${RemindersEditor} taskId=${taskId} locked=${locked || done}/>
      </section>

      <section class="card-section">
        <div class="field-label">Заметки</div>
        <${NotesEditor} taskId=${taskId} locked=${locked}/>
      </section>

      <p class="task-footer muted">
        ${`Создана ${formatMoment(t.createdAt, tz)}${t.createdVia === 'bot' ? ' ботом' : ''} · `
          + `Изменена ${formatMoment(t.updatedAt, tz)}${device(t.updatedBy) ? ` на «${device(t.updatedBy)}»` : ''}`}
      </p>
    </div>`;
}

function TaskHeader({ onClose, taskId = null }) {
  return html`
    <div class="task-header">
      <button class="icon-btn" onClick=${onClose} aria-label="Закрыть" title="Закрыть (Esc)">
        <${Icon} name="close"/>
      </button>
      <span class="task-header-title">Задача</span>
      ${taskId ? html`<button class="icon-btn" onClick=${() => openSheet('taskMenu', { taskId })} aria-label="Действия" title="Действия">
        <${Icon} name="dots"/></button>` : null}
    </div>`;
}
