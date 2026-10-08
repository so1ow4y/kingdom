// Журнал конфликтов слияния и ошибок (docs/TZ.md §9.7, §14). Полноценный экран — этап 6; здесь простой список.

import { html, useEffect, useState } from '../html.js';
import { Empty } from '../components/Section.js';
import { store, setUi } from '../../store/appState.js';
import { getRepo } from '../../store/localRepo.js';
import { restoreConflict } from '../../store/actions.js';
import { formatMoment } from '../../core/dates.js';
import { tr } from '../../core/i18n.js';

const FIELD_LABELS = {
  title: tr('Название'), note: tr('Заметка'), listId: tr('Список'), priority: tr('Приоритет'), priorityId: tr('Приоритет'), parentId: tr('Родитель'), coins: tr('Монеты'), status: tr('Статус'),
  completedAt: tr('Выполнена'), trashedAt: tr('Корзина'), scheduledDate: tr('Дата'), scheduledTime: tr('Время'),
  deadlineDate: tr('Дедлайн'), deadlineTime: tr('Время дедлайна'), focusDate: tr('Главное'), name: tr('Название'),
  color: tr('Цвет'), emoji: tr('Значок'), archived: tr('Архив'), timeZone: tr('Часовой пояс'), choresListId: tr('Список «Быт»'),
};

function show(field, v) {
  if (v === null || v === undefined || v === '') return tr('пусто');
  if (field === 'listId' || field === 'choresListId') return store.data.lists.get(v)?.name || tr('удалённый список');
  if (field === 'priorityId') return store.data.priorities.get(v)?.name || tr('удалённый приоритет');
  if (field === 'parentId') return store.data.tasks.get(v)?.title || tr('верхний уровень');
  if (typeof v === 'string') return v.length > 160 ? `«${v.slice(0, 160)}…»` : `«${v}»`;
  return JSON.stringify(v).slice(0, 160);
}

const dev = (id) => store.data.devices.get(id)?.name || tr('другое устройство');

export function JournalScreen() {
  const [conflicts, setConflicts] = useState(null);
  const [errors, setErrors] = useState(null);
  const [showHidden, setShowHidden] = useState(false);
  const tz = store.data.settings.timeZone;

  const reload = () => {
    const repo = getRepo();
    repo.listConflicts().then(setConflicts);
    repo.listErrors().then(setErrors);
  };
  useEffect(() => {
    reload();
    setUi({ conflictsNew: 0 });
  }, []);

  const hide = async (row) => {
    await getRepo().updateConflict({ ...row, resolved: true });
    reload();
  };
  const restore = async (row) => {
    if (await restoreConflict(row)) reload();
  };

  const visible = (conflicts || []).filter((r) => showHidden || !r.resolved);
  const hiddenCount = (conflicts || []).filter((r) => r.resolved).length;

  return html`
    <div class="screen journal">
      <section class="set-section">
        <h2>Конфликты при слиянии</h2>
        <p class="muted small">Здесь значения, которые проиграли при слиянии изменений с разных устройств. Ничего не потеряно: любое можно вернуть.</p>
        ${conflicts && !visible.length ? html`<${Empty}>Конфликтов нет.<//>` : null}
        ${visible.map((r) => html`
          <div class=${'journal-row' + (r.resolved ? ' resolved' : '')} key=${r.id}>
            <div class="journal-title">${r.title}</div>
            <div class="muted small">${formatMoment(r.at, tz)}</div>
            ${r.kind === 'field' ? html`
              <div>${FIELD_LABELS[r.field] || r.field}: осталось ${show(r.field, r.winnerValue)} (${dev(r.winnerDevice)}),
                не попало ${show(r.field, r.loserValue)} (${dev(r.loserDevice)})</div>` : null}
            ${r.kind === 'resurrected' ? html`<div>Удалена ${r.deletedOn === 'local' ? tr('на этом устройстве') : tr('на другом устройстве')}, но позже изменена — оставлена.</div>` : null}
            ${r.kind === 'deleted' ? html`<div>Удалена ${r.deletedOn === 'local' ? tr('на этом устройстве') : tr('на другом устройстве')}; правка была раньше удаления.</div>` : null}
            ${!r.resolved ? html`
              <div class="form-actions">
                ${r.kind === 'field' ? html`<button class="btn small" onClick=${() => restore(r)}>Восстановить этот вариант</button>` : null}
                ${r.kind === 'deleted' && r.loserValue ? html`<button class="btn small" onClick=${() => restore(r)}>Восстановить как новую</button>` : null}
                <button class="btn small ghost" onClick=${() => hide(r)}>Скрыть</button>
              </div>` : null}
          </div>`)}
        ${hiddenCount ? html`<button class="link-btn" onClick=${() => setShowHidden(!showHidden)}>
          ${showHidden ? tr('Скрыть решённые') : tr('Показать решённые ({hiddenCount})', { hiddenCount })}</button>` : null}
      </section>
      <section class="set-section">
        <h2>Журнал ошибок</h2>
        ${errors && !errors.length ? html`<${Empty}>Ошибок нет.<//>` : null}
        ${(errors || []).map((e) => html`
          <div class="journal-row" key=${e.id}>
            <div class="journal-title">${e.code}</div>
            <div class="muted small">${formatMoment(e.at, tz)}</div>
            <div class="small">${e.message}</div>
          </div>`)}
      </section>
    </div>`;
}
