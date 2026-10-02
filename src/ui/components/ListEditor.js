// Создание и редактирование списка (docs/TZ.md §6.5).

import { html, useState, useRef, useEffect } from '../html.js';
import { Sheet } from './Sheet.js';
import { navigate } from '../router.js';
import { store, closeSheet } from '../../store/appState.js';
import * as A from '../../store/actions.js';
import * as S from '../../core/selectors.js';
import { normalizeListName, firstGrapheme } from '../../core/model.js';
import { LIST_COLORS, EMOJI_SUGGESTIONS, LIMITS } from '../../config.js';

export function ListEditorSheet({ listId = null }) {
  const existing = listId ? A.getList(listId) : null;
  const [name, setName] = useState(existing?.name ?? '');
  const [color, setColor] = useState(existing?.color ?? '#1E88E5');
  const [emoji, setEmoji] = useState(existing?.emoji ?? '');
  const input = useRef(null);
  useEffect(() => {
    if (!existing) input.current?.focus();
  }, []);

  if (listId && (!existing || existing.deletedAt)) return null;
  const readOnly = !!store.ui.readOnly;
  const n = normalizeListName(name);
  const all = [...S.sortedLists(store.data), ...S.sortedLists(store.data, { archived: true })];
  const duplicate = n && all.some((l) => l.id !== listId && l.name.toLowerCase() === n.toLowerCase());
  const hasTasks = existing ? S.listHasTasks(store.data, listId) : false;

  const save = async (e) => {
    e?.preventDefault();
    if (!n || readOnly) return;
    const fields = { name: n, color, emoji: firstGrapheme(emoji) };
    if (existing) {
      await A.updateList(listId, fields);
      closeSheet();
    } else {
      const l = await A.createList(fields);
      closeSheet();
      if (l) navigate('/list/' + l.id);
    }
  };

  const archive = async () => {
    if (existing.archived) {
      await A.unarchiveList(listId);
      closeSheet();
    } else if (await A.archiveList(listId)) {
      closeSheet();
    }
  };

  const remove = async () => {
    if (await A.deleteList(listId)) {
      closeSheet();
      navigate('/lists', { replace: true });
    }
  };

  return html`
    <${Sheet} title=${existing ? 'Список' : 'Новый список'} onClose=${closeSheet}>
      <form onSubmit=${save} class="list-editor">
        <label class="field">
          <span>Название</span>
          <input ref=${input} value=${name} maxLength=${LIMITS.listNameMax} placeholder="Например, «Спорт»"
            onInput=${(e) => setName(e.target.value)} disabled=${readOnly}/>
        </label>
        ${duplicate ? html`<p class="hint warn">Список с таким названием уже есть</p>` : null}
        <div class="field">
          <span>Цвет</span>
          <div class="color-grid">
            ${LIST_COLORS.map((c) => html`
              <button type="button" class=${'color-swatch' + (c.hex === color ? ' selected' : '')}
                style=${{ background: c.hex }} aria-label=${c.name} title=${c.name} onClick=${() => setColor(c.hex)}></button>`)}
          </div>
        </div>
        <div class="field">
          <span>Значок</span>
          <div class="emoji-row">
            <input class="emoji-input" value=${emoji} maxLength="16" placeholder="—" aria-label="Эмодзи"
              onInput=${(e) => setEmoji(e.target.value)}/>
            <button type="button" class="link-btn" onClick=${() => setEmoji('')}>Без значка</button>
          </div>
          <div class="emoji-grid">
            ${EMOJI_SUGGESTIONS.map((x) => html`
              <button type="button" class=${'emoji-btn' + (firstGrapheme(emoji) === x ? ' selected' : '')} onClick=${() => setEmoji(x)}>${x}</button>`)}
          </div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn primary" disabled=${!n || readOnly}>${existing ? 'Сохранить' : 'Создать'}</button>
          ${existing ? html`
            <button type="button" class="btn" onClick=${archive} disabled=${readOnly}>${existing.archived ? 'Вернуть из архива' : 'Архивировать'}</button>
            <button type="button" class="btn danger-outline" onClick=${remove} disabled=${hasTasks || readOnly}
              title=${hasTasks ? 'Сначала перенеси или удали задачи' : ''}>Удалить</button>` : null}
        </div>
        ${existing && hasTasks ? html`<p class="hint">Удалить можно только пустой список (включая выполненные и корзину). Сначала перенеси или удали задачи.</p>` : null}
      </form>
    <//>`;
}
