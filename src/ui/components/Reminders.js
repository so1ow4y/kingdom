// Напоминания в интерфейсе (обновление 0.3, п. 2.5): выбор напоминания, список в карточке и в окне «Новая задача»,
// «Пропущенные напоминания», раздел «Уведомления» в настройках.

import { html, useState } from '../html.js';
import { Icon } from '../icons.js';
import { Sheet } from './Sheet.js';
import { TimeInput } from './TimeInput.js';
import { store, closeSheet, openSheet, ask, showSnackbar } from '../../store/appState.js';
import * as A from '../../store/actions.js';
import * as R from '../../core/reminders.js';
import { formatMoment } from '../../core/dates.js';
import { LIMITS } from '../../config.js';
import { openTask, Link } from '../router.js';
import {
  permission, requestPermission, notifyEnabled, setNotifyEnabled, missedReminders, clearMissed, testNotification,
} from '../notifier.js';
import { tr } from '../../core/i18n.js';

const UNITS = [['m', tr('мин'), 1], ['h', tr('ч'), 60], ['d', tr('дн.'), 1440]];

/**
 * Выбор напоминания. Для задачи (taskId) — добавляет сразу; для черновика (draft + onPick) — отдаёт выбранное.
 * Варианты «за … до начала» видны всегда: если у задачи нет времени начала, они неактивны с подписью
 * «нужно время начала», а время можно поставить прямо здесь (для черновика — через onSetTime).
 */
export function ReminderSheet({ taskId = null, draft = null, onPick = null, onSetTime = null, anchor = null }) {
  const task = taskId ? A.getTask(taskId) : null;
  const s = store.data.settings;
  const today = store.now.today;
  const [day, setDay] = useState(s.dayReminderTime || '09:00');
  const [atDate, setAtDate] = useState(today);
  const [atTime, setAtTime] = useState(null);
  const [num, setNum] = useState('');
  const [unit, setUnit] = useState('m');
  const [anchorKind, setAnchorKind] = useState('scheduled');
  const [draftTime, setDraftTime] = useState(draft?.scheduledTime ?? null);
  const [newTime, setNewTime] = useState(null);
  const t = task || (draft ? { ...draft, scheduledTime: draftTime } : null);
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
  const setStart = () => {
    if (!newTime) return;
    if (task) A.setSchedule(taskId, task.scheduledDate || today, newTime);
    else {
      setDraftTime(newTime);
      onSetTime?.(newTime);
    }
  };
  const customMinutes = () => Math.round(+num * UNITS.find((u) => u[0] === unit)[2]);
  const customOk = num !== '' && (anchorKind === 'deadline' ? hasDeadline : hasTime);
  const custom = (e) => {
    e.preventDefault();
    const min = customMinutes();
    if (!(min >= 0) || min > R.MAX_OFFSET_MINUTES) return showSnackbar(tr('От 0 минут до 7 дней'));
    pick({ kind: 'relative', anchor: anchorKind, offsetMinutes: min });
  };
  const chips = (anc, enabled) => html`<div class="chip-row wrap">
    ${presets.map((m) => html`<button type="button" class="chip" disabled=${!enabled} onClick=${() => pick({ kind: 'relative', anchor: anc, offsetMinutes: m })}>
      за ${R.durationLabel(m)}</button>`)}
    <button type="button" class="chip" disabled=${!enabled} onClick=${() => pick({ kind: 'relative', anchor: anc, offsetMinutes: 0 })}>в момент ${anc === 'deadline' ? tr('дедлайна') : tr('начала')}</button>
  </div>`;

  return html`
    <${Sheet} title="Когда напомнить" onClose=${closeSheet} anchor=${anchor}>
      <div class="field-label">До начала${hasTime ? ` (${t.scheduledTime})` : ''}</div>
      ${chips('scheduled', hasTime)}
      ${hasTime ? null : html`
        <div class="need-time">
          <span class="hint warn">Нужно время начала</span>
          <${TimeInput} value=${newTime} onChange=${setNewTime} label="Время начала"/>
          <button type="button" class="btn small" disabled=${!newTime} onClick=${setStart}>Поставить</button>
        </div>`}
      ${hasDeadline ? html`<div class="field-label">До дедлайна</div>${chips('deadline', true)}` : null}
      <div class="field-label">Своё значение</div>
      <form class="inline-add wrap" onSubmit=${custom}>
        <span>за</span>
        <input type="number" min="0" max="10080" step="1" value=${num} onInput=${(e) => setNum(e.target.value)} style="width: 72px" aria-label="Сколько"/>
        <select value=${unit} onChange=${(e) => setUnit(e.target.value)} aria-label="Единица">
          ${UNITS.map(([k, label]) => html`<option value=${k}>${label}</option>`)}
        </select>
        <select value=${anchorKind} onChange=${(e) => setAnchorKind(e.target.value)} aria-label="До чего">
          <option value="scheduled">до начала</option>
          ${hasDeadline ? html`<option value="deadline">до дедлайна</option>` : null}
        </select>
        <button type="submit" class="btn small" disabled=${!customOk}>Добавить</button>
      </form>
      ${num !== '' && !customOk ? html`<p class="hint warn">Нужно время начала — поставь его выше.</p>` : null}
      <div class="field-label">В день задачи</div>
      <div class="inline-add">
        <${TimeInput} value=${day} onChange=${(v) => setDay(v)} label="Время в день задачи" allowEmpty=${false}/>
        <button type="button" class="btn small" disabled=${!day || !hasDay} onClick=${() => pick({ kind: 'timeOfDay', time: day })}>Добавить</button>
      </div>
      ${hasDay ? null : html`<p class="hint">Нужна дата задачи.</p>`}
      <div class="field-label">Точное время</div>
      <div class="inline-add wrap">
        <input type="date" value=${atDate} onInput=${(e) => setAtDate(e.target.value)} aria-label="Дата напоминания"/>
        <${TimeInput} value=${atTime} onChange=${setAtTime} label="Время напоминания"/>
        <button type="button" class="btn small" disabled=${!atDate || !atTime} onClick=${() => pick({ kind: 'absolute', at: `${atDate}T${atTime}` })}>Добавить</button>
      </div>
    <//>`;
}
/** Подсказка, если на этом устройстве уведомления не придут. */
function DeviceHint() {
  const p = permission();
  if (p === 'granted' && notifyEnabled()) return null;
  const text = p === 'unsupported' ? tr('Этот браузер не умеет показывать уведомления.')
    : p === 'denied' ? tr('Уведомления запрещены в браузере.') : tr('Уведомления на этом устройстве не включены.');
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
          : at != null ? html`<small class="muted">${past ? tr('было ') : ''}${formatMoment(new Date(at).toISOString(), store.data.settings.timeZone)}</small>` : null}
      </div>
      ${locked ? null : html`<button type="button" class="icon-btn small" onClick=${onRemove} aria-label="Удалить напоминание" title="Удалить"><${Icon} name="close" size=${16}/></button>`}
    </div>`;
}

const everyLabel = (m) => (m === 1 ? tr('каждую минуту') : tr('каждые {p0}', { p0: R.durationLabel(m) }));

/** «Каждые …»: варианты из настроек (settings.nagPresets) и своё значение. */
function NagInterval({ value, onChange, disabled }) {
  const presets = [...(store.data.settings.nagPresets || [1, 5, 10, 15, 30, 60])].sort((a, b) => a - b);
  const [custom, setCustom] = useState(false);
  const [num, setNum] = useState('');
  const [unit, setUnit] = useState('m');
  const options = [...new Set([...presets, value])].sort((a, b) => a - b);
  if (custom) {
    const apply = (e) => {
      e.preventDefault();
      const m = Math.round(+num * (unit === 'h' ? 60 : 1));
      if (!(m >= LIMITS.nagMin && m <= LIMITS.nagMax)) return showSnackbar(tr('От {nagMin} минуты до {p1} часов', { nagMin: LIMITS.nagMin, p1: LIMITS.nagMax / 60 }));
      onChange(m);
      setCustom(false);
    };
    return html`<form class="inline-add" onSubmit=${apply}>
      <span>каждые</span>
      <input type="number" min="1" max="1440" value=${num} onInput=${(e) => setNum(e.target.value)} style="width: 64px" aria-label="Интервал" autoFocus/>
      <select value=${unit} onChange=${(e) => setUnit(e.target.value)} aria-label="Единица"><option value="m">мин</option><option value="h">ч</option></select>
      <button type="submit" class="btn small" disabled=${!num}>OK</button>
      <button type="button" class="btn small ghost" onClick=${() => setCustom(false)}>Отмена</button>
    </form>`;
  }
  return html`<select value=${String(value)} disabled=${disabled} aria-label="Как часто повторять"
    onChange=${(e) => (e.target.value === 'custom' ? setCustom(true) : onChange(+e.target.value))}>
    ${options.map((m) => html`<option value=${String(m)}>${everyLabel(m)}</option>`)}
    <option value="custom">Своё значение…</option>
  </select>`;
}

/** Напоминания в карточке задачи: «Когда напомнить» и отдельно «Повторять, пока не отмечу». */
export function RemindersEditor({ taskId, locked }) {
  const t = A.getTask(taskId);
  if (!t) return null;
  const list = (t.reminders || []).filter((r) => !r.deletedAt);
  const nag = t.nag || { enabled: false, intervalMinutes: 15 };
  return html`
    <div class="rem-block">
      <div class="rem-sub">Когда напомнить</div>
      <div class="item-list">
        ${list.map((r) => html`<${ReminderRow} key=${r.id} r=${r} task=${t} locked=${locked} onRemove=${() => A.removeReminder(taskId, r.id)}/>`)}
        ${list.length ? null : html`<p class="muted small">Напоминаний нет</p>`}
      </div>
      ${locked ? null : html`
        <button type="button" class="item-add" onClick=${(e) => openSheet('reminder', { taskId, anchor: e.currentTarget.getBoundingClientRect() })}
          disabled=${list.length >= R.MAX_REMINDERS}><${Icon} name="plus" size=${16}/> Напоминание</button>`}
    </div>
    <div class="rem-block">
      <div class="rem-sub">Повторять, пока не отмечу</div>
      <div class="nag-row">
        <label class="switch"><input type="checkbox" checked=${nag.enabled} disabled=${locked}
          onChange=${(e) => A.setNag(taskId, { ...nag, enabled: e.target.checked })}/> ${nag.enabled ? tr('Включено:') : tr('Выключено')}</label>
        ${nag.enabled ? html`<${NagInterval} value=${nag.intervalMinutes} disabled=${locked} onChange=${(m) => A.setNag(taskId, { ...nag, intervalMinutes: m })}/>` : null}
      </div>
      ${nag.enabled && !list.length ? html`<p class="hint">Повтор начинается после первого напоминания — добавь его выше.</p>` : null}
    </div>
    ${list.length || nag.enabled ? html`<${DeviceHint}/>` : null}`;
}

/**
 * Напоминания в окне «Новая задача». value === null — «как по умолчанию» (их покажем и создадим по настройкам);
 * любое изменение превращает их в явный список.
 */
export function DraftReminders({ draft, value, setValue, onSetTime = null }) {
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
      ${shown.length ? null : html`<p class="muted small">${R.taskDay(draft) ? tr('Без напоминаний') : tr('Выбери день — и появится напоминание по умолчанию')}</p>`}
    </div>
    <button type="button" class="item-add" onClick=${(e) => openSheet('reminder', { draft, onPick: add, onSetTime, anchor: e.currentTarget.getBoundingClientRect() })}>
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
  granted: ['ok', tr('Разрешены в браузере')],
  denied: ['danger', tr('Запрещены в браузере')],
  default: ['muted', tr('Ещё не включены')],
  unsupported: ['muted', tr('Этот браузер не поддерживает уведомления')],
};

/** Раздел «Уведомления» в настройках. */
export function NotificationsSection({ focus = false }) {
  const s = store.data.settings;
  const readOnly = !!store.ui.readOnly;
  const [, rerender] = useState(0);
  const p = permission();
  const [tone, label] = PERM_TEXT[p] || PERM_TEXT.unsupported;
  const presets = [...(s.reminderPresets || [])].sort((a, b) => a - b);

  const enable = async () => {
    const v = await ask({
      title: tr('Включить уведомления?'),
      text: tr('Chronicle будет напоминать о задачах: за 5 минут до начала (или как настроишь), а у задач без времени — в выбранное время дня. ')
        + tr('Важно: сервера у нас нет, поэтому уведомления приходят, только пока приложение открыто — вкладка или установленное приложение, можно свёрнутое. ')
        + tr('Сейчас браузер спросит разрешение.'),
      buttons: [{ label: tr('Не сейчас'), value: null }, { label: tr('Включить'), value: 'yes', kind: 'primary' }],
    });
    if (v !== 'yes') return;
    const r = await requestPermission();
    if (r === 'granted') showSnackbar(tr('Уведомления включены'));
    else if (r === 'denied') showSnackbar(tr('Браузер запретил уведомления'));
    rerender((n) => n + 1);
  };

  return html`
    <section class="set-section" id="notifications" ref=${(el) => focus && el && !el.dataset.scrolled && (el.dataset.scrolled = '1', setTimeout(() => el.scrollIntoView({ block: 'start' }), 100))}>
      <h2>Уведомления и напоминания</h2>
      <div class="set-row">
        <div class="set-label">На этом устройстве<small class=${'tone-' + tone}>${label}</small></div>
        <div class="set-control">
          ${p === 'default' ? html`<button class="btn primary" onClick=${enable}>Включить уведомления</button>` : null}
          ${p === 'granted' ? html`<label class="switch"><input type="checkbox" checked=${notifyEnabled()}
            onChange=${(e) => { setNotifyEnabled(e.target.checked); rerender((n) => n + 1); }}/> ${notifyEnabled() ? tr('Включены') : tr('Выключены')}</label>` : null}
        </div>
      </div>
      ${p === 'denied' ? html`<p class="hint">Чтобы включить обратно: нажми на значок слева от адреса сайта (замок или «настройки сайта») → «Уведомления» → «Разрешить», затем перезагрузи страницу. В установленном приложении на Android: Настройки телефона → Приложения → Kingdom (или Chrome) → Уведомления.</p>` : null}
      ${p === 'granted' && notifyEnabled() ? html`<button class="btn small" onClick=${testNotification}>Проверить уведомление</button>` : null}
      <p class="hint">Сервера у Kingdom нет, поэтому напоминания приходят, <b>только пока приложение открыто</b> (вкладка или окно установленного приложения, можно в фоне). Если приложение было закрыто, при следующем открытии появится список «Пропущенные напоминания». Надёжную доставку позже возьмёт на себя Telegram-бот.</p>

      <h3 class="set-sub">Напоминания по умолчанию (для всех устройств)</h3>
      <div class="set-row">
        <div class="set-label">Новой задаче со временем<small>Добавляется само, его можно убрать в карточке</small></div>
        <div class="set-control">
          <select value=${s.defaultReminderMinutes == null ? '' : String(s.defaultReminderMinutes)} disabled=${readOnly}
            onChange=${(e) => A.updateSettings({ defaultReminderMinutes: e.target.value === '' ? null : +e.target.value })}>
            <option value="">Не напоминать</option>
            ${[...new Set([0, ...presets, ...(s.defaultReminderMinutes == null ? [] : [s.defaultReminderMinutes])])].sort((a, b) => a - b)
              .map((m) => html`<option value=${String(m)}>${m ? tr('за ') + R.durationLabel(m) : tr('в момент начала')}</option>`)}
          </select>
        </div>
      </div>
      <div class="set-row">
        <div class="set-label">Задаче с датой, но без времени<small>Напоминание в этот час в день задачи</small></div>
        <div class="set-control">
          <${TimeInput} value=${s.dayReminderTime || null} disabled=${readOnly} label="Время дня"
            onChange=${(v) => A.updateSettings({ dayReminderTime: v || null })}/>
        </div>
      </div>
      <div class="field-label">Быстрые варианты «Когда напомнить: за … до»</div>
      <${PresetsEditor} values=${presets} prefix="за" units=${UNITS} max=${R.MAX_OFFSET_MINUTES} readOnly=${readOnly}
        rangeText="От 1 минуты до 7 дней" onChange=${(v) => A.updateSettings({ reminderPresets: v })}/>
      <div class="field-label">Варианты «Повторять, пока не отмечу: каждые …»</div>
      <${PresetsEditor} values=${[...(s.nagPresets || [])].sort((a, b) => a - b)} prefix="каждые" units=${UNITS.slice(0, 2)} max=${LIMITS.nagMax}
        readOnly=${readOnly} rangeText=${tr('От {nagMin} минуты до {p1} часов', { nagMin: LIMITS.nagMin, p1: LIMITS.nagMax / 60 })} onChange=${(v) => A.updateSettings({ nagPresets: v })}/>
    </section>`;
}

/** Набор быстрых вариантов в минутах: чипы с «×» и «+ своё значение». */
function PresetsEditor({ values, prefix, units, max, readOnly, rangeText, onChange }) {
  const [num, setNum] = useState('');
  const [unit, setUnit] = useState('m');
  const add = (e) => {
    e.preventDefault();
    const m = Math.round(+num * units.find((u) => u[0] === unit)[2]);
    if (!(m >= 1) || m > max) return showSnackbar(rangeText);
    setNum('');
    if (values.includes(m)) return;
    if (values.length >= LIMITS.presetsMax) return showSnackbar(tr('Не больше {presetsMax} вариантов', { presetsMax: LIMITS.presetsMax }));
    onChange([...values, m].sort((a, b) => a - b));
  };
  return html`
    <div class="chip-row wrap">
      ${values.map((m) => html`<span class="chip">${prefix} ${R.durationLabel(m)}
        ${readOnly ? null : html`<button type="button" class="chip-x" aria-label="Убрать" onClick=${() => onChange(values.filter((x) => x !== m))}>×</button>`}</span>`)}
    </div>
    ${readOnly ? null : html`<form class="inline-add" onSubmit=${add}>
      <input type="number" min="1" step="1" value=${num} placeholder="Своё" onInput=${(e) => setNum(e.target.value)} style="width: 90px" aria-label="Сколько"/>
      <select value=${unit} onChange=${(e) => setUnit(e.target.value)} aria-label="Единица">
        ${units.map(([k, l]) => html`<option value=${k}>${l}</option>`)}
      </select>
      <button type="submit" class="btn small" disabled=${!num}>Добавить вариант</button>
    </form>`}`;
}

