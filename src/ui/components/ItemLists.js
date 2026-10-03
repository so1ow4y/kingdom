// Заметки и подзадачи: одинаковые «список элементов + Добавить» в карточке задачи и в окне создания (п. 2.2, 2.7, 2.8).

import { html, useState, useRef, useEffect, useLayoutEffect, useMemo } from '../html.js';
import { Icon } from '../icons.js';
import { SortableList, DragHandle } from './Sortable.js';
import { TaskTree } from './TaskTree.js';
import { NoteAttachments, startVoice } from './Attachments.js';
import { store, registerFlusher } from '../../store/appState.js';
import * as A from '../../store/actions.js';
import * as S from '../../core/selectors.js';
import { liveNotes, normalizeTitle } from '../../core/model.js';
import { formatMoment } from '../../core/dates.js';
import { LIMITS, TIMINGS } from '../../config.js';

function autosize(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 2 + 'px';
}

const URL_RE = /(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]'])/g;

/** Ссылки из текста заметки — кликабельными кнопками под полем. */
function Links({ text }) {
  const urls = [...new Set(text.match(URL_RE) || [])].slice(0, 5);
  return urls.length ? html`<div class="note-links">${urls.map((u) => html`
    <a href=${u} target="_blank" rel="noopener noreferrer">${u.replace(/^https?:\/\//, '').slice(0, 48)}</a>`)}</div>` : null;
}

/** Одна заметка: поле с автосохранением (через 400 мс и при уходе из поля), даты создания и изменения. */
function NoteItem({ taskId, note, handle, locked, autoFocus }) {
  const [text, setText] = useState(note.text);
  const pending = useRef(null);
  const timer = useRef(null);
  const focused = useRef(false);
  const el = useRef(null);
  const tz = store.data.settings.timeZone;

  const flush = async () => {
    clearTimeout(timer.current);
    timer.current = null;
    if (pending.current == null) return;
    const v = pending.current;
    pending.current = null;
    await A.updateNote(taskId, note.id, v);
  };
  useEffect(() => {
    const off = registerFlusher(flush);
    return () => {
      off();
      flush();
    };
  }, []);
  useEffect(() => {
    if (!focused.current && pending.current == null) setText(note.text);
  }, [note.text]);
  useLayoutEffect(() => autosize(el.current), [text]);
  useEffect(() => {
    if (autoFocus) el.current?.focus();
  }, []);

  const onInput = (e) => {
    const v = e.target.value.slice(0, LIMITS.noteMax);
    setText(v);
    pending.current = v;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, TIMINGS.textSaveDebounceMs);
  };
  const changed = note.updatedAt && note.updatedAt !== note.createdAt;
  return html`
    <div class="item-row note-item">
      <div class="item-body">
        <textarea ref=${el} class="note-input" rows="2" value=${text} disabled=${locked}
          placeholder=${(note.attachments || []).some((a) => !a.deletedAt) ? 'Подпись (необязательно)…' : 'Текст заметки…'}
          aria-label="Заметка" onInput=${onInput} onFocus=${() => { focused.current = true; }}
          onBlur=${() => { focused.current = false; flush(); }}></textarea>
        <${Links} text=${text}/>
        <div class="item-meta">Создана ${formatMoment(note.createdAt, tz)}${changed ? ` · изменена ${formatMoment(note.updatedAt, tz)}` : ''}
          ${text.length >= LIMITS.noteCounterFrom ? ` · ${text.length} / ${LIMITS.noteMax}` : ''}</div>
      </div>
      ${locked ? null : html`
        <button class="icon-btn" onClick=${() => A.deleteNote(taskId, note.id)} aria-label="Удалить заметку" title="Удалить заметку">
          <${Icon} name="trash" size=${18}/></button>
        <${DragHandle} handle=${handle} label="Перетащить заметку"/>`}
      <${NoteAttachments} taskId=${taskId} note=${note} locked=${locked}/>
    </div>`;
}

/** Заметки задачи: сколько угодно, правка, удаление, перестановка (каждая — отдельный элемент со своим id). */
export function NotesEditor({ taskId, locked = false }) {
  const t = A.getTask(taskId);
  const [fresh, setFresh] = useState(null);
  if (!t) return null;
  const notes = liveNotes(t);
  const add = async () => setFresh(await A.addNote(taskId, ''));
  // «+ Голосовая заметка»: сразу создаёт заметку и начинает запись (при отмене пустая заметка удаляется)
  const voice = async () => {
    const id = await A.createVoiceNote(taskId);
    if (id) startVoice(taskId, id, true);
  };
  return html`
    <div class="item-list">
      ${notes.length ? html`<${SortableList} items=${notes} disabled=${locked}
        onMove=${(id, index) => A.reorderNote(taskId, id, index)}
        render=${(n, handle) => html`<${NoteItem} key=${n.id} taskId=${taskId} note=${n} handle=${handle} locked=${locked} autoFocus=${n.id === fresh}/>`}/>` : null}
      ${locked ? null : html`<div class="item-add-row">
        <button class="item-add" onClick=${add}><${Icon} name="plus" size=${16}/> Добавить заметку</button>
        <button class="item-add" onClick=${voice}>🎤 Голосовая заметка</button>
      </div>`}
    </div>`;
}

/** Поле «+ Добавить подзадачу»: Enter добавляет и оставляет фокус для следующей. */
export function AddLine({ placeholder, onAdd, disabled = false }) {
  const [v, setV] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    const s = normalizeTitle(v);
    if (!s) return;
    setV('');
    await onAdd(s);
  };
  return html`
    <form class="item-add-line" onSubmit=${submit}>
      <${Icon} name="plus" size=${16}/>
      <input value=${v} placeholder=${placeholder} maxLength=${LIMITS.titleMax} disabled=${disabled} enterkeyhint="done"
        onInput=${(e) => setV(e.target.value)}/>
    </form>`;
}

/** Подзадачи — настоящие вложенные задачи: дерево с прогрессом, перетаскиванием и «+ Добавить подзадачу». */
export function SubtasksEditor({ taskId, locked = false }) {
  const kids = useMemo(() => S.childrenOf(store.data, taskId), [store.version, taskId]);
  const t = A.getTask(taskId);
  const canNest = t && S.depthOf(store.data, t) < S.MAX_DEPTH;
  return html`
    <div class="item-list">
      ${kids.length ? html`<${TaskTree} zone=${'sub:' + taskId} roots=${kids} showList=${false} cfg=${{ manual: true, rootParentId: taskId }}/>` : null}
      ${locked ? null : canNest
        ? html`<${AddLine} placeholder="Добавить подзадачу" onAdd=${(s) => A.addChild(taskId, s)}/>`
        : html`<p class="hint">Глубже ${S.MAX_DEPTH} уровней вкладывать нельзя.</p>`}
    </div>`;
}

/**
 * Черновой список строк для окна «Новая задача» (подзадачи или заметки до создания задачи).
 * Выглядит так же, как списки в карточке.
 */
export function DraftList({ items, setItems, placeholder, addLabel, multiline = false }) {
  const update = (i, v) => setItems(items.map((x, j) => (j === i ? v : x)));
  const remove = (i) => setItems(items.filter((_, j) => j !== i));
  const onKey = (e, i) => {
    if (!multiline && e.key === 'Enter') {
      e.preventDefault();
      if (items[i].trim()) setItems([...items.slice(0, i + 1), '', ...items.slice(i + 1)]);
      setTimeout(() => e.target.closest('.item-list')?.querySelectorAll('input')[i + 1]?.focus(), 0);
    }
  };
  return html`
    <div class="item-list">
      ${items.map((v, i) => html`
        <div class="item-row draft-row" key=${i}>
          ${multiline
            ? html`<textarea class="note-input" rows="2" value=${v} placeholder=${placeholder} onInput=${(e) => update(i, e.target.value)}></textarea>`
            : html`<input value=${v} placeholder=${placeholder} maxLength=${LIMITS.titleMax} onInput=${(e) => update(i, e.target.value)}
                onKeyDown=${(e) => onKey(e, i)}/>`}
          <button type="button" class="icon-btn" onClick=${() => remove(i)} aria-label="Убрать"><${Icon} name="close" size=${16}/></button>
        </div>`)}
      <button type="button" class="item-add" onClick=${() => setItems([...items, ''])}><${Icon} name="plus" size=${16}/> ${addLabel}</button>
    </div>`;
}
