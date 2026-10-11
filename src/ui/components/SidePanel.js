// Панель справа (обновление 0.16) — перенос SidePanel license-store (components/side-panel.tsx), в духе SIEM:
// клик по строке списка открывает карточку справа (задачи, продукта, записи или заметки дневника, рациона),
// а сам список остаётся на месте и живым — можно щёлкать соседние строки или ходить по ним клавишами
// (ui/listKeys.js), панель просто переключается на них.
//
// Не модальная: фон не затемняется и не блокируется. На компьютере (от 900 px) — панелью: поверх списка или,
// если в настройках включено «ужимать страницу», на широком экране (от 1200 px) страница отодвигается на её
// ширину (переменная --side-panel-width, её читает styles/app.css). Ширина — в «Настройки → Интерфейс →
// Внешний вид» и, если там не запрещено, тянется мышью за левый край (или стрелками, когда край в фокусе).
// На телефоне карточка по-прежнему открывается на весь экран, листы — снизу.

import { html, useState, useEffect, useRef } from '../html.js';
import { getPrefs, setPrefs, PANEL_MIN, PANEL_MAX } from '../prefs.js';
import { bindingOf, shortcutsOn } from '../keys.js';
import { Keys } from './Shortcuts.js';
import { tr } from '../../core/i18n.js';

/** Панель не шире 85 % окна (и не уже PANEL_MIN). */
export const panelMax = () => Math.max(PANEL_MIN, Math.min(PANEL_MAX, Math.round(innerWidth * 0.85)));
export const panelWidthNow = (w = getPrefs().panelWidth) => Math.min(Math.max(PANEL_MIN, w || PANEL_MIN), panelMax());

/** Открытые панели (их бывает две: карточка и предпросмотр в настройках): верхнюю закрывает Esc. */
const open = [];

function publishWidth() {
  const root = document.documentElement.style;
  const top = open.at(-1);
  if (top) root.setProperty('--side-panel-width', top.width + 'px');
  else root.removeProperty('--side-panel-width');
}

/** Закрыть верхнюю панель, у которой нет своего обработчика Esc в app.js (предпросмотр). */
export function closeTopPanel() {
  const top = [...open].reverse().find((p) => p.ownEscape);
  if (!top) return false;
  top.onClose();
  return true;
}

const STEP = 20;

/**
 * label — для экранного диктора; onClose — крестик, Esc и клавиша «закрыть»; ownEscape — Esc закрывает
 * саму панель (у карточек и листов его обрабатывает app.js).
 */
export function SidePanel({ label, onClose, className = '', ownEscape = false, children }) {
  const prefs = getPrefs();
  const [drag, setDrag] = useState(null);
  const [, setViewport] = useState(0);
  const self = useRef({ width: 0, onClose, ownEscape }).current;
  const width = drag ?? panelWidthNow(prefs.panelWidth);
  self.width = width;
  self.onClose = onClose;
  self.ownEscape = ownEscape;

  useEffect(() => {
    open.push(self);
    const onResize = () => setViewport(innerWidth);
    window.addEventListener('resize', onResize);
    return () => {
      open.splice(open.indexOf(self), 1);
      window.removeEventListener('resize', onResize);
      publishWidth();
    };
  }, []);
  // Каркас отодвигает страницу на ширину панели (только на широком экране и если так выбрано в настройках).
  useEffect(publishWidth, [width]);

  const save = (w) => setPrefs({ panelWidth: Math.round(Math.min(PANEL_MAX, Math.max(PANEL_MIN, w))) });

  // Пока тянут мышью — своя ширина; отпустили — она уходит в настройки.
  const startDrag = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    const right = handle.parentElement.getBoundingClientRect().right;
    let last = width;
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      // без захвата тоже работает: слушаем всё окно
    }
    document.body.classList.add('panel-resizing');
    const move = (ev) => {
      last = Math.min(panelMax(), Math.max(PANEL_MIN, right - ev.clientX));
      setDrag(last);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      document.body.classList.remove('panel-resizing');
      save(last);
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
  const onHandleKey = (e) => {
    const d = e.key === 'ArrowLeft' ? 1 : e.key === 'ArrowRight' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    save(Math.min(panelMax(), width + d * (e.shiftKey ? STEP * 3 : STEP)));
  };

  return html`
    <aside class=${'side-panel ' + className} aria-label=${label} style=${{ '--panel-w': width + 'px' }}>
      ${prefs.panelResizable !== false ? html`<div class=${'side-panel-resize' + (drag != null ? ' dragging' : '')} role="separator"
        aria-orientation="vertical" aria-label="Потяните, чтобы изменить ширину панели" tabIndex="0"
        aria-valuemin=${PANEL_MIN} aria-valuemax=${panelMax()} aria-valuenow=${Math.round(width)}
        title=${tr('Потяните, чтобы изменить ширину панели')} onPointerDown=${startDrag} onKeyDown=${onHandleKey}></div>` : null}
      <div class="side-panel-body">${children}</div>
      <${PanelHints}/>
    </aside>`;
}

/** Подсказка внизу панели: какими клавишами ходить по строкам и закрыть (как подвал SidePanel license-store). */
function PanelHints() {
  if (!shortcutsOn()) return null;
  const move = [bindingOf('listUp'), bindingOf('listDown')].filter(Boolean);
  const close = bindingOf('listClose');
  return html`
    <footer class="side-panel-foot">
      ${move.length ? html`<span>${move.map((c) => html`<${Keys} key=${c} combo=${c} ru=${false}/>`)} предыдущая / следующая</span>` : null}
      <span>${close ? html`<${Keys} combo=${close} ru=${false}/> / ` : null}<${Keys} combo="Escape"/> закрыть</span>
    </footer>`;
}
