// Фокус-сессия (обновление 0.7, как в приложении Forest): «Взяться за задачу» — таймер на этом устройстве.
// Полоса фокуса закреплена под заголовком на всех экранах; по окончании — изумруды и вопрос «Задача выполнена?».

import { html, useEffect, useState } from '../html.js';
import { Icon } from '../icons.js';
import { Sheet } from './Sheet.js';
import { store, closeSheet, confirm } from '../../store/appState.js';
import * as A from '../../store/actions.js';
import { getFocus, setFocus, focusLeft } from '../../store/focus.js';
import { FOCUS_PRESETS, gemsForFocus, levelAt } from '../../core/village.js';
import { getPrefs } from '../prefs.js';
import { notifyPlain } from '../notifier.js';

const mmss = (ms) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Выбор длительности: пресеты и своё значение. taskId — необязательно. */
export function FocusStartSheet({ taskId = null }) {
  const t = taskId ? A.getTask(taskId) : null;
  const [custom, setCustom] = useState('');
  const game = store.data.settings.gameEnabled;
  const gemLevel = levelAt(store.data, 'gemmine');
  const start = (m) => {
    closeSheet();
    A.startFocus({ taskId, minutes: m });
  };
  return html`
    <${Sheet} title="Взяться за задачу" onClose=${closeSheet} className="focus-sheet">
      ${t ? html`<p class="focus-task">🎯 ${t.title}</p>` : html`<p class="muted small">Таймер без задачи — просто время на глубокую работу.</p>`}
      <div class="focus-presets">
        ${FOCUS_PRESETS.map((m) => html`<button class="focus-preset" onClick=${() => start(m)}>
          <b>${m}</b><span>мин</span>${game ? html`<small>+${gemsForFocus(m, gemLevel)} 💎</small>` : null}</button>`)}
      </div>
      <form class="field-row focus-custom" onSubmit=${(e) => { e.preventDefault(); if (+custom >= 1) start(+custom); }}>
        <label class="field"><span>Своё время, мин</span><input type="number" min="1" max="240" value=${custom} onInput=${(e) => setCustom(e.target.value)} placeholder="Например, 35"/></label>
        <button class="btn primary" type="submit" disabled=${!(+custom >= 1)}>Начать</button>
      </form>
      <p class="muted small">Пока идёт фокус, строитель трудится в мастерской деревни. От 15 минут — изумруды${getPrefs().focusStrict ? '. Строгий режим: если уйти из приложения больше чем на 15 секунд, фокус прервётся' : ''}.</p>
    <//>`;
}

/** Полоса текущего фокуса: оставшееся время, «Готово» (засчитать прошедшее) и «Прервать». */
export function FocusBar({ sticky = true }) {
  const f = getFocus();
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!f) return undefined;
    const id = setInterval(() => {
      const cur = getFocus();
      if (!cur) return;
      if (focusLeft(cur) <= 0) {
        if (document.hidden) notifyPlain('⏳ Фокус завершён', `«${cur.title}» · ${cur.minutes} мин. Загляни в деревню!`, 'lt-focus');
        A.finishFocus();
      } else setTick((x) => x + 1);
    }, 1000);
    // строгий режим: ушёл из приложения дольше 15 секунд — фокус прерывается
    const onVis = () => {
      const cur = getFocus();
      if (!cur) return;
      if (document.hidden) setFocus({ ...cur, hiddenAt: Date.now() });
      else if (cur.hiddenAt) {
        const away = Date.now() - cur.hiddenAt;
        if (getPrefs().focusStrict && away > 15000 && focusLeft(cur) > 0) A.cancelFocus('Строгий фокус: ты отвлёкся — сессия прервана');
        else setFocus({ ...cur, hiddenAt: null });
      }
    };
    document.addEventListener('visibilitychange', onVis);
    // открыли приложение, а время уже вышло
    if (focusLeft(f) <= 0) A.finishFocus();
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [f?.startedAt]);
  if (!f) return null;
  const left = focusLeft(f);
  const total = f.minutes * 60000;
  const progress = 1 - left / total;
  const stop = async () => {
    const ok = await confirm({ title: 'Прервать фокус?', text: 'Время не засчитается, жители немного расстроятся.', confirmLabel: 'Прервать', danger: true });
    if (ok) A.cancelFocus();
  };
  return html`
    <div class=${'focus-bar' + (sticky ? '' : ' static')} role="timer" aria-live="off">
      <span class="focus-ring" style=${{ '--p': Math.round(progress * 100) }} aria-hidden="true"><i>🔨</i></span>
      <div class="focus-info">
        <b>${mmss(left)}</b>
        <small title=${f.title}>${f.taskId ? html`<a href=${'#/task/' + f.taskId}>${f.title}</a>` : f.title}</small>
      </div>
      <button class="btn small" onClick=${() => A.finishFocus({ early: true })} title="Засчитать прошедшие минуты">Готово</button>
      <button class="icon-btn small" onClick=${stop} aria-label="Прервать фокус" title="Прервать"><${Icon} name="close" size=${18}/></button>
    </div>`;
}
