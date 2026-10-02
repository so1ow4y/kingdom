// Быстрый ввод (docs/TZ.md §5.4): «+» → текст → Enter. Панель остаётся открытой для следующей задачи.

import { html, useState, useRef, useEffect } from '../html.js';
import { Icon } from '../icons.js';
import { Sheet } from './Sheet.js';
import { store, closeQuickAdd, showSnackbar } from '../../store/appState.js';
import { createTask } from '../../store/actions.js';
import { sortedLists } from '../../core/selectors.js';
import { normalizeTitle } from '../../core/model.js';
import { addDays, isoWeekday, WEEKDAY_SHORT } from '../../core/dates.js';
import { readLocal, writeLocal } from '../hooks.js';
import { LIMITS } from '../../config.js';
import { countLabel } from '../../core/plural.js';

function QuickAddSheet({ ctx }) {
  const today = store.now.today;
  const [title, setTitle] = useState(() => readLocal('quickDraft', ''));
  const [note, setNote] = useState('');
  const [date, setDate] = useState(ctx.scheduledDate);
  const [listId, setListId] = useState(ctx.listId);
  const [focus, setFocus] = useState(false);
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
    const r = await createTask({ title: t, note, listId, scheduledDate: date, focus });
    if (r) {
      setTitle('');
      setNote('');
      setFocus(false);
      setAdded((n) => n + 1);
      if (r.focusRejected) showSnackbar(`Уже ${LIMITS.focusMax} главных — задача добавлена без ★`);
    }
    input.current?.focus();
  };

  const onPaste = (e) => {
    const text = e.clipboardData?.getData('text') || '';
    if (!/[\r\n]/.test(text)) return;
    e.preventDefault();
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const i = lines.findIndex((l) => l.trim());
    if (i < 0) return;
    setTitle((title + ' ' + lines[i]).trim());
    const rest = lines.slice(i + 1).join('\n').trim();
    if (rest) setNote((note ? note + '\n' : '') + rest);
  };

  const dayChips = [today, addDays(today, 1), ...[2, 3, 4, 5, 6, 7].map((n) => addDays(today, n))];
  const dayLabel = (d, i) => (i === 0 ? 'Сегодня' : i === 1 ? 'Завтра' : WEEKDAY_SHORT[isoWeekday(d) - 1]);
  const lists = sortedLists(store.data);

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
        ${note ? html`<div class="qa-note">+ заметка (${countLabel(note.split('\n').length, ['строка', 'строки', 'строк'])})
          <button type="button" class="link-btn" onClick=${() => setNote('')}>убрать</button></div>` : null}
        <div class="chip-row scroll">
          ${dayChips.map((d, i) => html`
            <button type="button" class=${'chip' + (date === d ? ' selected' : '')}
              onClick=${() => setDate(date === d ? null : d)}>${dayLabel(d, i)}</button>`)}
        </div>
        <div class="chip-row">
          <button type="button" class=${'chip' + (focus ? ' selected' : '')} onClick=${() => setFocus(!focus)}
            aria-pressed=${focus}><${Icon} name="star" filled=${focus} size=${16}/> Главное</button>
          <label class="chip chip-select">
            <${Icon} name=${listId ? 'lists' : 'inbox'} size=${16}/>
            <select value=${listId ?? ''} onChange=${(e) => setListId(e.target.value || null)} aria-label="Список">
              <option value="">Входящие</option>
              ${lists.map((l) => html`<option value=${l.id}>${(l.emoji ? l.emoji + ' ' : '') + l.name}</option>`)}
            </select>
          </label>
        </div>
      </form>
    <//>`;
}

export function QuickAddHost() {
  const qa = store.ui.quickAdd;
  return qa ? html`<${QuickAddSheet} ctx=${qa}/>` : null;
}
