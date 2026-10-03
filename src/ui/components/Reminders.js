// Напоминания в интерфейсе (обновление 0.3, п. 2.5): выбор напоминания, список в карточке и в окне «Новая задача»,
// «Пропущенные напоминания», раздел «Уведомления» в настройках.

import { html, useState } from '../html.js';
import { Icon } from '../icons.js';
import { Sheet } from './Sheet.js';
import { store, closeSheet, openSheet, ask, showSnackbar } from '../../store/appState.js';
import * as A from '../../store/actions.js';
import * as R from '../../core/reminders.js';
import { formatMoment } from '../../core/dates.js';
import { openTask, Link } from '../router.js';
import {
  permission, requestPermission, notifyEnabled, setNotifyEnabled, missedReminders, clearMissed, testNotification,
} from '../notifier.js';

const UNITS = [['m', 'мин', 1], ['h', 'ч', 60], ['d', 'дн.', 1440]];

/**
 * Выбор напоминания. Для задачи (taskId) — добавляет сразу; для черновика (draft + onPick) — отдаёт выбранное.
 */
export function ReminderSheet({ taskId = null, draft = null, onPick = null, anchor = null }) {
  const t = taskId ? A.getTask(taskId) : draft;
  const s = store.data.settings;
  const [day, setDay] = useState(s.dayReminderTime || '09:00');
  const [at, setAt] = useState('');
  const [num, setNum] = useState('');
  const [unit, setUnit] = useState('m');
  const [anchorKind, setAnchorKind] = useState('scheduled');
  if (!t) return null;
  const hasTime = !!(t.scheduledDate && t.scheduledTime);
  const hasDeadline = !!t.deadlineDate;
  const hasDay = !!R.taskDay(t);
  const presets = [...(s.reminderPresets || [])].sort((a, b) => a - b);

  const pick = (r) => {
    closeSheet();
    if (onPick) onPick(r);
    else A.addReminder(taskId, r);
  };
  const custom = (e) => {
    e.preventDefault();
    const k = UNITS.find((u) => u[0] === unit)[2];
    const min = Math.round(+num * k);
    if (!(min >= 0) || min > R.MAX_OFFSET_MINUTES) return showSnackbar('От 0 минут до 7 дней');
    pick({ kind: 'relative', anchor: anchorKind, offsetMinutes: min });
  };
  const chips = (anc) => html`<div class="chip-row wrap">
    ${presets.map((m) => html`<button type="button" class="chip" onClick=${() => pick({ kind: 'relative', anchor: anc, offsetMinutes: m })}>
      за ${R.durationLabel(m)}</button>`)}
    <button type="button" class="chip" onClick=${() => pick({ kind: 'relative', anchor: anc, offsetMinutes: 0 })}>в момент ${anc === 'deadline' ? 'дедлайна' : 'начала'}</button>
  </div>`;

  return html`
    <${Sheet} title="Напоминание" onClose=${closeSheet} anchor=${anchor}>
      <div class="field-label">До начала</div>
      ${hasTime ? chips('scheduled') : html`<p class="hint">Поставь задаче время — и можно будет напомнить за 5 минут, за час…</p>`}
      ${hasDeadline ? html`<div class="field-label">До дедлайна</div>${chips('deadline')}` : null}
      <div class="field-label">В день задачи</div>
      <div class="inline-add">
        <input type="time" value=${day} onInput=${(e) => setDay(e.target.value)} aria-label="Время в день задачи"/>
        <button type="button" class="btn small" disabled=${!day || !hasDay} onClick=${() => pick({ kind: 'timeOfDay', time: day })}>Добавить</button>
      </div>
      ${hasDay ? null : html`<p class="hint">Нужна дата задачи.</p>`}
      <div class="field-label">Точное время</div>
      <div class="inline-add">
        <input type="datetime-local" value=${at} onInput=${(e) => setAt(e.target.value)} aria-label="Дата и время напоминания"/>
        <button type="button" class="btn small" disabled=${!at} onClick=${() => pick({ kind: 'absolute', at: at.slice(0, 16) })}>Добавить</button>
      </div>
      ${hasTime || hasDeadline ? html`
        <div class="field-label">Своё значение</div>
        <form class="inline-add" onSubmit=${custom}>
          <span>за</span>
          <input type="number" min="0" max="10080" step="1" value=${num} onInput=${(e) => setNum(e.target.value)} style="width: 72px" aria-label="Сколько"/>
          <select value=${unit} onChange=${(e) => setUnit(e.target.value)} aria-label="Единица">
            ${UNITS.map(([k, label]) => html`<option value=${k}>${label}</option>`)}
          </select>
          <select value=${anchorKind} onChange=${(e) => setAnchorKind(e.target.value)} aria-label="До чего">
            ${hasTime ? html`<option value="scheduled">до начала</option>` : null}
            ${hasDeadline ? html`<option value="deadline">до дедлайна</option>` : null}
          </select>
          <button type="submit" class="btn small" disabled=${num === ''}>Добавить</button>
        </form>` : null}
    <//>`;
}

/** Подсказка, если на этом устройстве уведомления не придут. */
function DeviceHint() {
  const p = permission();
  if (p === 'granted' && notifyEnabled()) return null;
  const text = p === 'unsupported' ? 'Этот браузер не умеет показывать уведомления.'
    : p === 'denied' ? 'Уведомления запрещены в браузере.' : 'Уведомления на этом устройстве не включены.';
  return html`<p class="hint">${text} <${Link} to="/settings?section=notifications">Настроить<//></p>`;
}

function ReminderRow({ r, task, onRemove, locked, isDefault = false }) {
  const today = store.now.today;
  const problem = R.reminderProblem(task, r);
  const at = R.reminderMoment(task, r, store.data.settings.timeZone);
  const past = at != null && at < Date.now();
  return html`
    <div class="item-row reminder-row">
      <${Icon} name="bell" size=${16}/>
      <div class="item-main">
        <span>${R.reminderLabel(r, today)}${isDefault ? html` <small class="muted">· по умолчанию</small>` : null}</span>
        ${problem ? html`<small class="hint warn">${problem}</small>`
          : at != null ? html`<small class="muted">${past ? 'было ' : ''}${formatMoment(new Date(at).toISOString(), store.data.settings.timeZone)}</small>` : null}
      </div>
      ${locked ? null : html`<button type="button" class="icon-btn small" onClick=${onRemove} aria-label="Удалить напоминание" title="Удалить"><${Icon} name="close" size=${16}/></button>`}
    </div>`;
}

const NAG_STEPS = [5, 10, 15, 30, 60, 120];

/** Напоминания в карточке задачи. */
export function RemindersEditor({ taskId, locked }) {
  const t = A.getTask(taskId);
  if (!t) return null;
  const list = (t.reminders || []).filter((r) => !r.deletedAt);
  const nag = t.nag || { enabled: false, intervalMinutes: 15 };
  return html`
    <div class="item-list">
      ${list.map((r) => html`<${ReminderRow} key=${r.id} r=${r} task=${t} locked=${locked} onRemove=${() => A.removeReminder(taskId, r.id)}/>`)}
    </div>
    ${locked ? null : html`
      <button type="button" class="item-add" onClick=${(e) => openSheet('reminder', { taskId, anchor: e.currentTarget.getBoundingClientRect() })}
        disabled=${list.length >= R.MAX_REMINDERS}><${Icon} name="plus" size=${16}/> Напоминание</button>
      <label class="toggle-row compact">
        <input type="checkbox" checked=${nag.enabled} onChange=${(e) => A.setNag(taskId, { ...nag, enabled: e.target.checked })}/>
        <span>Напоминать, пока не отмечу</span>
        ${nag.enabled ? html`<select value=${String(nag.intervalMinutes)} onChange=${(e) => A.setNag(taskId, { ...nag, intervalMinutes: +e.target.value })} aria-label="Как часто">
          ${[...new Set([...NAG_STEPS, nag.intervalMinutes])].sort((a, b) => a - b).map((m) => html`<option value=${String(m)}>каждые ${R.durationLabel(m)}</option>`)}
        </select>` : null}
      </label>`}
    ${list.length || nag.enabled ? html`<${DeviceHint}/>` : null}`;
}

/**
 * Напоминания в окне «Новая задача». value === null — «как по умолчанию» (их покажем и создадим по настройкам);
 * любое изменение превращает их в явный список.
 */
export function DraftReminders({ draft, value, setValue }) {
  const s = store.data.settings;
  const isDefault = value == null;
  const shown = isDefault ? R.defaultReminders({ ...draft, status: 'active' }, s) : value;
  const add = (r) => {
    if (shown.some((x) => R.sameReminder(x, r))) return;
    setValue([...shown, r].slice(0, R.MAX_REMINDERS));
  };
  return html`
    <div class="item-list">
      ${shown.map((r, i) => html`<${ReminderRow} key=${i} r=${r} task=${{ ...draft, status: 'active' }} isDefault=${isDefault}
        onRemove=${() => setValue(shown.filter((_, j) => j !== i))}/>`)}
      ${shown.length ? null : html`<p class="muted small">${R.taskDay(draft) ? 'Без напоминаний' : 'Выбери день — и появится напоминание по умолчанию'}</p>`}
    </div>
    <button type="button" class="item-add" onClick=${(e) => openSheet('reminder', { draft, onPick: add, anchor: e.currentTarget.getBoundingClientRect() })}>
      <${Icon} name="plus" size=${16}/> Напоминание</button>`;
}

/** «Пропущенные напоминания» — что сработало, пока приложение было закрыто. */
export function MissedSheet() {
  const list = missedReminders();
  const tz = store.data.settings.timeZone;
  const open = (id) => {
    closeSheet();
    openTask(id);
  };
  return html`
    <${Sheet} title="Пропущенные напоминания" onClose=${closeSheet}>
      <p class="muted small">Пока приложение было закрыто, уведомления не приходили. Вот что сработало за это время:</p>
      <div class="menu-list">
        ${list.map((m) => {
          const t = store.data.tasks.get(m.taskId);
          const done = t && t.status === 'done';
          return html`<button type="button" class="menu-item" onClick=${() => open(m.taskId)} disabled=${!t || t.deletedAt}>
            <span class="mi-icon"><${Icon} name=${done ? 'check' : 'bell'} size=${18}/></span>
            <span class="mi-label">${t?.title || m.title}${done ? html` <small class="muted">· выполнена</small>` : null}</span>
            <span class="mi-count">${formatMoment(new Date(m.at).toISOString(), tz)}</span>
          </button>`;
        })}
      </div>
      <button type="button" class="btn" onClick=${() => { clearMissed(); closeSheet(); }}>Понятно, очистить</button>
    <//>`;
}

const PERM_TEXT = {
  granted: ['ok', 'Разрешены в браузере'],
  denied: ['danger', 'Запрещены в браузере'],
  default: ['muted', 'Ещё не включены'],
  unsupported: ['muted', 'Этот браузер не поддерживает уведомления'],
};

/** Раздел «Уведомления» в настройках. */
export function NotificationsSection({ focus = false }) {
  const s = store.data.settings;
  const readOnly = !!store.ui.readOnly;
  const [, rerender] = useState(0);
  const [newPreset, setNewPreset] = useState('');
  const [presetUnit, setPresetUnit] = useState('m');
  const p = permission();
  const [tone, label] = PERM_TEXT[p] || PERM_TEXT.unsupported;
  const presets = [...(s.reminderPresets || [])].sort((a, b) => a - b);

  const enable = async () => {
    const v = await ask({
      title: 'Включить уведомления?',
      text: 'LifeTasks будет напоминать о задачах: за 5 минут до начала (или как настроишь), а у задач без времени — в выбранное время дня. '
        + 'Важно: сервера у нас нет, поэтому уведомления приходят, только пока приложение открыто — вкладка или установленное приложение, можно свёрнутое. '
        + 'Сейчас браузер спросит разрешение.',
      buttons: [{ label: 'Не сейчас', value: null }, { label: 'Включить', value: 'yes', kind: 'primary' }],
    });
    if (v !== 'yes') return;
    const r = await requestPermission();
    if (r === 'granted') showSnackbar('Уведомления включены');
    else if (r === 'denied') showSnackbar('Браузер запретил уведомления');
    rerender((n) => n + 1);
  };
  const addPreset = (e) => {
    e.preventDefault();
    const k = UNITS.find((u) => u[0] === presetUnit)[2];
    const m = Math.round(+newPreset * k);
    if (!(m > 0) || m > R.MAX_OFFSET_MINUTES) return showSnackbar('От 1 минуты до 7 дней');
    if (presets.includes(m)) return setNewPreset('');
    A.updateSettings({ reminderPresets: [...presets, m].sort((a, b) => a - b).slice(0, 12) });
    setNewPreset('');
  };

  return html`
    <section class="set-section" id="notifications" ref=${(el) => focus && el && !el.dataset.scrolled && (el.dataset.scrolled = '1', setTimeout(() => el.scrollIntoView({ block: 'start' }), 100))}>
      <h2>Уведомления</h2>
      <div class="set-row">
        <div class="set-label">На этом устройстве<small class=${'tone-' + tone}>${label}</small></div>
        <div class="set-control">
          ${p === 'default' ? html`<button class="btn primary" onClick=${enable}>Включить уведомления</button>` : null}
          ${p === 'granted' ? html`<label class="switch"><input type="checkbox" checked=${notifyEnabled()}
            onChange=${(e) => { setNotifyEnabled(e.target.checked); rerender((n) => n + 1); }}/> ${notifyEnabled() ? 'Включены' : 'Выключены'}</label>` : null}
        </div>
      </div>
      ${p === 'denied' ? html`<p class="hint">Чтобы включить обратно: нажми на значок слева от адреса сайта (замок или «настройки сайта») → «Уведомления» → «Разрешить», затем перезагрузи страницу. В установленном приложении на Android: Настройки телефона → Приложения → LifeTasks (или Chrome) → Уведомления.</p>` : null}
      ${p === 'granted' && notifyEnabled() ? html`<button class="btn small" onClick=${testNotification}>Проверить уведомление</button>` : null}
      <p class="hint">Сервера у LifeTasks нет, поэтому напоминания приходят, <b>только пока приложение открыто</b> (вкладка или окно установленного приложения, можно в фоне). Если приложение было закрыто, при следующем открытии появится список «Пропущенные напоминания». Надёжную доставку позже возьмёт на себя Telegram-бот.</p>

      <h3 class="set-sub">Напоминания по умолчанию (для всех устройств)</h3>
      <div class="set-row">
        <div class="set-label">Новой задаче со временем<small>Добавляется само, его можно убрать в карточке</small></div>
        <div class="set-control">
          <select value=${s.defaultReminderMinutes == null ? '' : String(s.defaultReminderMinutes)} disabled=${readOnly}
            onChange=${(e) => A.updateSettings({ defaultReminderMinutes: e.target.value === '' ? null : +e.target.value })}>
            <option value="">Не напоминать</option>
            ${[...new Set([0, ...presets, ...(s.defaultReminderMinutes == null ? [] : [s.defaultReminderMinutes])])].sort((a, b) => a - b)
              .map((m) => html`<option value=${String(m)}>${m ? 'за ' + R.durationLabel(m) : 'в момент начала'}</option>`)}
          </select>
        </div>
      </div>
      <div class="set-row">
        <div class="set-label">Задаче с датой, но без времени<small>Напоминание в этот час в день задачи</small></div>
        <div class="set-control">
          <input type="time" value=${s.dayReminderTime || ''} disabled=${readOnly}
            onChange=${(e) => A.updateSettings({ dayReminderTime: e.target.value || null })}/>
        </div>
      </div>
      <div class="field-label">Быстрые варианты «за … до»</div>
      <div class="chip-row wrap">
        ${presets.map((m) => html`<span class="chip">за ${R.durationLabel(m)}
          ${readOnly ? null : html`<button type="button" class="chip-x" aria-label="Убрать" onClick=${() => A.updateSettings({ reminderPresets: presets.filter((x) => x !== m) })}>×</button>`}</span>`)}
      </div>
      ${readOnly ? null : html`<form class="inline-add" onSubmit=${addPreset}>
        <input type="number" min="1" step="1" value=${newPreset} placeholder="Своё" onInput=${(e) => setNewPreset(e.target.value)} style="width: 90px" aria-label="Сколько"/>
        <select value=${presetUnit} onChange=${(e) => setPresetUnit(e.target.value)} aria-label="Единица">
          ${UNITS.map(([k, l]) => html`<option value=${k}>${l}</option>`)}
        </select>
        <button type="submit" class="btn small" disabled=${!newPreset}>Добавить вариант</button>
      </form>`}
    </section>`;
}

