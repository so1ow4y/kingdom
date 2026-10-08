// Фокус-сессия (обновление 0.7, как в приложении Forest): «Взяться за задачу» — таймер на этом устройстве.
// Полоса фокуса закреплена под заголовком на всех экранах; по окончании — изумруды и вопрос «Задача выполнена?».
// С 0.7.1: на что фокусироваться — любая из задач или свой фокус («Чтение»); сессии по задаче хранятся в самой задаче.

import { html, useEffect, useMemo, useState } from '../html.js';
import { Icon } from '../icons.js';
import { Sheet } from './Sheet.js';
import { store, closeSheet, confirm, openSheet } from '../../store/appState.js';
import * as A from '../../store/actions.js';
import { focusTotal, liveFocusSessions } from '../../core/model.js';
import { humanDate, formatMoment } from '../../core/dates.js';
import { getFocus, setFocus, focusLeft } from '../../store/focus.js';
import { FOCUS_PRESETS, gemsForFocus, levelAt } from '../../core/village.js';
import { getPrefs } from '../prefs.js';
import { readLocal, writeLocal } from '../hooks.js';
import { notifyPlain } from '../notifier.js';
import { tr } from '../../core/i18n.js';

const mmss = (ms) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** 25 → «25 мин», 85 → «1 ч 25 мин», 120 → «2 ч». */
export function formatMinutes(m) {
  m = Math.round(m);
  if (m < 60) return tr('{m} мин', { m });
  const h = Math.floor(m / 60);
  return m % 60 ? tr('{h} ч {p1} мин', { h, p1: m % 60 }) : tr('{h} ч', { h });
}

/** Задачи для выбора фокуса: «главное» на сегодня, на сегодня и просроченные, потом остальные (свежие сверху). */
function focusCandidates(data, today) {
  const rank = (t) => (t.focusDate === today ? 0 : (t.scheduledDate && t.scheduledDate <= today) || (t.deadlineDate && t.deadlineDate <= today) ? 1 : 2);
  return [...data.tasks.values()]
    .filter((t) => !t.deletedAt && !t.trashedAt && t.status === 'active')
    .sort((a, b) => rank(a) - rank(b) || (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

/** «Взяться за задачу»: на что (задача из списка или свой фокус) и сколько минут. taskId — выбранная заранее задача. */
export function FocusStartSheet({ taskId = null }) {
  const today = store.now.today;
  const [what, setWhat] = useState(taskId ? { kind: 'task', id: taskId } : { kind: 'pick' });
  const [mode, setMode] = useState('task'); // 'task' | 'custom' — вкладка выбора, пока задача не выбрана
  const [q, setQ] = useState('');
  const [label, setLabel] = useState(() => readLocal('focusLabel', ''));
  const [minutes, setMinutes] = useState(() => readLocal('focusMinutes', 25));
  const [own, setOwn] = useState('');
  const game = store.data.settings.gameEnabled;
  const gemLevel = levelAt(store.data, 'gemmine');
  const all = useMemo(() => focusCandidates(store.data, today), [store.version, today]);
  const needle = q.trim().toLowerCase();
  const shown = (needle ? all.filter((t) => t.title.toLowerCase().includes(needle)) : all).slice(0, 40);
  const task = what.kind === 'task' ? A.getTask(what.id) : null;
  const m = +own >= 1 ? Math.min(240, Math.round(+own)) : minutes;
  const ready = !!task || (mode === 'custom' && what.kind !== 'task');
  const start = () => {
    writeLocal('focusMinutes', m);
    if (!task) writeLocal('focusLabel', label.trim());
    closeSheet();
    A.startFocus({ taskId: task?.id || null, minutes: m, title: task ? '' : label });
  };
  const hint = (t) => {
    const parts = [];
    if (t.focusDate === today) parts.push(tr('★ главное'));
    if (t.scheduledDate) parts.push(humanDate(t.scheduledDate, today));
    const fm = focusTotal(t).minutes;
    if (fm) parts.push('◎ ' + formatMinutes(fm));
    return parts.join(' · ');
  };
  return html`
    <${Sheet} title="Взяться за задачу" onClose=${closeSheet} className="focus-sheet">
      <div class="field-label">На что фокус</div>
      ${task ? html`
        <div class="focus-what">
          <span>🎯</span><b>${task.title}</b>
          <button class="link-btn" onClick=${() => setWhat({ kind: 'pick' })}>Сменить</button>
        </div>` : html`
        <div class="chip-row" role="tablist">
          <button role="tab" aria-selected=${mode === 'task'} class=${'chip' + (mode === 'task' ? ' selected' : '')} onClick=${() => setMode('task')}>Задача</button>
          <button role="tab" aria-selected=${mode === 'custom'} class=${'chip' + (mode === 'custom' ? ' selected' : '')} onClick=${() => setMode('custom')}>✏️ Свой фокус</button>
        </div>
        ${mode === 'task' ? html`
          <input class="sheet-search" value=${q} placeholder="Найти задачу" onInput=${(e) => setQ(e.target.value)}/>
          <div class="focus-pick">
            ${shown.length ? shown.map((t) => html`<button class="focus-pick-item" key=${t.id} onClick=${() => setWhat({ kind: 'task', id: t.id })}>
              <span class="fpi-title">${t.title}</span>${hint(t) ? html`<small>${hint(t)}</small>` : null}</button>`)
              : html`<p class="muted small">${needle ? tr('Ничего не нашлось.') : tr('Активных задач нет — выбери «Свой фокус».')}</p>`}
          </div>` : html`
          <label class="field"><span>Название (необязательно)</span>
            <input value=${label} maxLength="80" placeholder="Например: чтение, английский, уборка" onInput=${(e) => setLabel(e.target.value)}/></label>`}`}

      <div class="field-label">Сколько</div>
      <div class="focus-presets">
        ${FOCUS_PRESETS.map((x) => html`<button class=${'focus-preset' + (!own && minutes === x ? ' selected' : '')} onClick=${() => { setMinutes(x); setOwn(''); }}>
          <b>${x}</b><span>мин</span>${game ? html`<small>+${gemsForFocus(x, gemLevel)} 💎</small>` : null}</button>`)}
      </div>
      <label class="field focus-own"><span>Своё время, мин</span>
        <input type="number" min="1" max="240" value=${own} onInput=${(e) => setOwn(e.target.value)} placeholder="Например, 35"/></label>
      <button class="btn primary focus-go" disabled=${!ready} onClick=${start}>
        ${ready ? tr('Начать · {p0}{p1}', { p0: formatMinutes(m), p1: game && gemsForFocus(m, gemLevel) ? ` · +${gemsForFocus(m, gemLevel)} 💎` : '' }) : tr('Выбери задачу или свой фокус')}</button>
      <p class="muted small">Время по задаче сохраняется в ней самой. Пока идёт фокус, строитель трудится в мастерской деревни; от 15 минут — изумруды${getPrefs().focusStrict ? tr('. Строгий режим: уйдёшь из приложения дольше чем на 15 секунд — фокус прервётся') : ''}.</p>
    <//>`;
}

/** Блок «Фокус» в карточке задачи: сколько всего, последние сессии, «Взяться». */
export function FocusSection({ task, locked = false }) {
  const f = getFocus();
  const total = focusTotal(task);
  const recent = liveFocusSessions(task).slice(0, 5);
  const tz = store.data.settings.timeZone;
  const running = f && f.taskId === task.id;
  return html`
    <div class="focus-summary">
      <span class="fs-total">${total.count ? html`◎ <b>${formatMinutes(total.minutes)}</b> · ${total.count} ${total.count === 1 ? tr('сессия') : total.count < 5 ? tr('сессии') : tr('сессий')}` : html`<span class="muted">Ещё не было фокуса</span>`}</span>
      ${running ? html`<span class="fs-running">${f.pausedAt ? tr('на паузе') : tr('идёт')} · осталось ${mmss(focusLeft(f))}</span>`
        : html`<button class="btn small" disabled=${locked} onClick=${() => openSheet('focus', { taskId: task.id })}><${Icon} name="focus" size=${16}/> Взяться</button>`}
    </div>
    ${recent.length ? html`<ul class="focus-history">${recent.map((s) => html`<li key=${s.id}><span>${formatMoment(s.startedAt, tz)}</span><b>${formatMinutes(s.minutes)}</b></li>`)}</ul>` : null}`;
}

/** Полоса текущего фокуса: оставшееся время, пауза, «Готово» (засчитать прошедшее) и «Прервать». */
export function FocusBar({ sticky = true }) {
  const f = getFocus();
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!f) return undefined;
    const id = setInterval(() => {
      const cur = getFocus();
      if (!cur) return;
      if (!cur.pausedAt && focusLeft(cur) <= 0) {
        if (document.hidden) notifyPlain(tr('⏳ Фокус завершён'), tr('«{title}» · {minutes} мин. Загляни в деревню!', { title: cur.title, minutes: cur.minutes }), 'lt-focus');
        A.finishFocus();
      } else setTick((x) => x + 1);
    }, 1000);
    // строгий режим: ушёл из приложения дольше 15 секунд — фокус прерывается (на паузе — можно уходить)
    const onVis = () => {
      const cur = getFocus();
      if (!cur || cur.pausedAt) return;
      if (document.hidden) setFocus({ ...cur, hiddenAt: Date.now() });
      else if (cur.hiddenAt) {
        const away = Date.now() - cur.hiddenAt;
        if (getPrefs().focusStrict && away > 15000 && focusLeft(cur) > 0) A.cancelFocus(tr('Строгий фокус: ты отвлёкся — сессия прервана'));
        else setFocus({ ...cur, hiddenAt: null });
      }
    };
    document.addEventListener('visibilitychange', onVis);
    // открыли приложение, а время уже вышло
    if (!f.pausedAt && focusLeft(f) <= 0) A.finishFocus();
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [f?.startedAt]);
  if (!f) return null;
  const left = focusLeft(f);
  const total = f.minutes * 60000;
  const progress = 1 - left / total;
  const paused = !!f.pausedAt;
  const stop = async () => {
    const ok = await confirm({ title: tr('Прервать фокус?'), text: tr('Время не засчитается, жители немного расстроятся.'), confirmLabel: tr('Прервать'), danger: true });
    if (ok) A.cancelFocus();
  };
  return html`
    <div class=${'focus-bar' + (sticky ? '' : ' static') + (paused ? ' paused' : '')} role="timer" aria-live="off">
      <span class="focus-ring" style=${{ '--p': Math.round(progress * 100) }} aria-hidden="true"><i>${paused ? '☕' : '🔨'}</i></span>
      <div class="focus-info">
        <b>${mmss(left)}${paused ? html` <span class="focus-paused">на паузе</span>` : null}</b>
        <small title=${f.title}>${f.taskId ? html`<a href=${'#/task/' + f.taskId}>${f.title}</a>` : f.title}</small>
      </div>
      <button class="icon-btn small" onClick=${() => (paused ? A.resumeFocus() : A.pauseFocus())}
        aria-label=${paused ? tr('Продолжить фокус') : tr('Пауза')} title=${paused ? tr('Продолжить') : tr('Пауза')}><${Icon} name=${paused ? 'play' : 'pause'} size=${18}/></button>
      <button class="btn small" onClick=${() => A.finishFocus({ early: true })} title="Засчитать прошедшие минуты">Готово</button>
      <button class="icon-btn small" onClick=${stop} aria-label="Прервать фокус" title="Прервать"><${Icon} name="close" size=${18}/></button>
    </div>`;
}
