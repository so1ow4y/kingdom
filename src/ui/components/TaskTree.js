// Дерево задач и перетаскивание (обновление 0.4) — одно поведение на всех экранах:
// «Сегодня» (все блоки), «Входящие», экран списка (все разделы), раскрытые списки на «Списках», подзадачи в карточке.
//
// Тащат за ⋮⋮: между строками — переставить (линия показывает место и уровень), на середину строки — вложить
// («Вложить в „…“»), сдвиг вбок на ~28 px — уровень глубже или мельче. Над свёрнутым родителем 0,6 с — раскрыть.
// У края экрана список прокручивается сам. Что получится — считает core/treeDrop.js (чистые функции).
//
// Все деревья экрана живут в одном DragScope: можно вложить задачу в задачу из соседнего блока
// и перенести её между раскрытыми списками. Во время перетаскивания Preact не перерисовывает список:
// строки двигаются через transform в requestAnimationFrame.

import { html, useRef, useMemo, useContext, createContext } from '../html.js';
import { readLocal, writeLocal } from '../hooks.js';
import { TaskRow } from './TaskRow.js';
import { store, notify, showSnackbar } from '../../store/appState.js';
import { moveTask } from '../../store/actions.js';
import * as S from '../../core/selectors.js';
import * as T from '../../core/treeDrop.js';

export const INDENT_PX = 22; // отступ подзадачи в строке (styles/app.css: .task-row.child)
const EXPAND_HOVER_MS = 600;
const START_DISTANCE = 4;
const EDGE_PX = 64;
const MAX_SCROLL_PX = 18;

// ---------- Свёрнутые ветки: общие для всех деревьев, запоминаются на устройстве ----------

let collapsed = new Set(readLocal('collapsed', []));

export const isCollapsed = (id) => collapsed.has(id);

export function setCollapsed(id, value) {
  if (collapsed.has(id) === value) return;
  collapsed = new Set(collapsed);
  if (value) collapsed.add(id);
  else collapsed.delete(id);
  writeLocal('collapsed', [...collapsed]);
  notify();
}

// ---------- Контроллер перетаскивания ----------

const ScopeCtx = createContext(null);

class DragController {
  constructor() {
    this.zones = new Map();
    this.root = null;
    this.s = null; // состояние текущего перетаскивания
    this.onMove = (e) => this.move(e);
    this.onUp = (e) => this.up(e);
    this.onKey = (e) => {
      if (e.key === 'Escape') this.cancel();
    };
  }

  register(zone, cfg) {
    this.zones.set(zone, cfg);
  }

  zonesObj() {
    return Object.fromEntries(this.zones);
  }

  rows() {
    if (!this.root) return [];
    return [...this.root.querySelectorAll('.tree-row')].map((el) => ({
      id: el.dataset.tid, depth: +el.dataset.depth, zone: el.dataset.zone, collapsed: el.dataset.collapsed === '1',
      empty: el.classList.contains('tree-empty'), el,
    }));
  }

  /** Нажатие на ⋮⋮: перетаскивание начинается сразу (без долгого нажатия), но визуально — после сдвига на 4 px. */
  begin(e, id) {
    if (this.s || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // не обязательно: слушаем window
    }
    this.s = { id, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, active: false,
      coarse: e.pointerType === 'touch' || matchMedia('(pointer: coarse)').matches };
    window.addEventListener('pointermove', this.onMove, { passive: false });
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    window.addEventListener('keydown', this.onKey);
  }

  move(e) {
    const s = this.s;
    if (!s || e.pointerId !== s.pointerId) return;
    e.preventDefault();
    s.x = e.clientX;
    s.y = e.clientY;
    if (!s.active) {
      if (Math.hypot(s.x - s.x0, s.y - s.y0) < START_DISTANCE) return;
      this.activate();
    }
    this.schedule();
  }

  activate() {
    const s = this.s;
    s.active = true;
    s.scroller = scrollerOf(this.root);
    s.off0 = scrollOffset(s.scroller);
    this.measure();
    const [a, b] = T.blockRange(s.rows, s.id);
    s.srcDepth = s.rows[a]?.depth ?? 0;
    for (let i = a; i < b; i++) s.rows[i].el.classList.add('drag-src');
    document.body.classList.add('tree-dragging');
    s.line = document.createElement('div');
    s.line.className = 'drop-line';
    s.badge = document.createElement('div');
    s.badge.className = 'drop-badge';
    document.body.append(s.line, s.badge);
    s.observer = new MutationObserver(() => {
      s.dirty = true;
    });
    s.observer.observe(this.root, { childList: true, subtree: true });
  }

  /** Строки и их положение в координатах содержимого прокрутки (не меняются при прокрутке). */
  measure() {
    const s = this.s;
    s.rows = this.rows();
    const [a, b] = T.blockRange(s.rows, s.id);
    s.block = [a, b];
    s.blockEls = s.rows.slice(a, b).map((r) => r.el);
    const off = scrollOffset(s.scroller);
    s.rects = s.rows.map((r, i) => {
      if (i >= a && i < b) return null;
      const rc = r.el.getBoundingClientRect();
      return { top: rc.top + off, bottom: rc.bottom + off, left: rc.left, right: rc.right };
    });
    s.dirty = false;
  }

  schedule() {
    if (this.s && !this.s.raf) this.s.raf = requestAnimationFrame(() => this.frame());
  }

  frame() {
    const s = this.s;
    if (!s || !s.active) return;
    s.raf = 0;
    if (s.dirty) {
      this.measure();
      s.key = null;
      for (const el of s.blockEls) el.classList.add('drag-src');
    }
    const scrolled = autoScroll(s);
    const off = scrollOffset(s.scroller);
    const py = s.y + off;
    const dy = py - (s.y0 + s.off0);
    for (const el of s.blockEls) el.style.transform = `translate3d(0, ${dy}px, 0)`;

    const hit = hitTest(s, py);
    const target = T.pointerTarget(s.rows, s.id, hit, s.x - s.x0);
    // Пока цель та же — не пересчитываем (проверки вложенности обходят все задачи)
    const key = target && JSON.stringify(target);
    const res = key && key === s.key && s.res ? s.res
      : T.resolveDrop(store.data, s.rows, this.zonesObj(), s.id, target, { readOnly: !!store.ui.readOnly });
    s.key = key;
    s.target = target;
    s.res = res;
    this.paint(target, res, off);
    this.hoverExpand(hit);
    if (scrolled) this.schedule();
  }

  /** Линия-указатель, подсветка «Вложить в …» и подпись. */
  paint(target, res, off) {
    const s = this.s;
    const into = target?.type === 'nest' ? s.rows[target.index] : null;
    if (s.into && s.into !== into?.el) s.into.classList.remove('drop-into', 'invalid');
    if (into) {
      into.el.classList.add('drop-into');
      into.el.classList.toggle('invalid', !res.ok);
      if (s.into !== into.el && res.ok) navigator.vibrate?.(12);
      s.into = into.el;
    } else s.into = null;

    const invalid = !res.ok;
    s.line.classList.toggle('invalid', invalid);
    s.badge.classList.toggle('invalid', invalid);
    let lineY = null;
    let left = 0;
    let right = 0;
    if (target?.type === 'gap' && !res.noop) {
      const p = target.prev >= 0 ? s.rects[target.prev] : null;
      const n = target.next >= 0 ? s.rects[target.next] : null;
      const empty = target.next >= 0 && s.rows[target.next].empty;
      lineY = empty ? (n.top + n.bottom) / 2 : p && n ? (p.bottom + n.top) / 2 : p ? p.bottom + 3 : n ? n.top - 3 : null;
      const ref = p || n;
      if (ref) {
        left = ref.left + target.depth * INDENT_PX + 4;
        right = ref.right;
      }
    }
    if (lineY != null) {
      const y = lineY - off;
      s.line.style.cssText = `display:block;transform:translate3d(${left}px,${y - 1.5}px,0);width:${Math.max(40, right - left)}px`;
    } else s.line.style.display = 'none';

    const label = res.label || '';
    if (label && (lineY != null || into)) {
      const r = into ? s.rects[target.index] : null;
      const y = into ? r.top - off + 4 : lineY - off - 26;
      const x = into ? r.right - 8 : right - 8;
      s.badge.textContent = label;
      s.badge.style.cssText = `display:block;transform:translate3d(calc(${x}px - 100%),${Math.max(4, y)}px,0)`;
    } else s.badge.style.display = 'none';
  }

  /** Держит задачу над свёрнутым родителем 0,6 с — раскрыть. */
  hoverExpand(hit) {
    const s = this.s;
    const row = hit && s.rows[hit.index];
    const id = row && row.collapsed ? row.id : null;
    if (id === s.hoverId) return;
    clearTimeout(s.hoverTimer);
    s.hoverId = id;
    if (id) {
      s.hoverTimer = setTimeout(() => {
        if (this.s !== s) return;
        setCollapsed(id, false);
        s.dirty = true;
        requestAnimationFrame(() => this.schedule());
      }, EXPAND_HOVER_MS);
    }
  }

  up(e) {
    const s = this.s;
    if (!s || (e && e.pointerId !== s.pointerId)) return;
    const drop = e?.type === 'pointerup' && s.active && s.res?.ok && !s.res.noop ? s.res.move : null;
    this.cleanup();
    if (drop) {
      if (drop.parentId && isCollapsed(drop.parentId)) setCollapsed(drop.parentId, false);
      moveTask(drop);
    }
  }

  cancel() {
    this.cleanup();
  }

  cleanup() {
    const s = this.s;
    if (!s) return;
    this.s = null;
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    window.removeEventListener('keydown', this.onKey);
    if (s.raf) cancelAnimationFrame(s.raf);
    clearTimeout(s.hoverTimer);
    s.observer?.disconnect();
    for (const el of s.blockEls || []) {
      el.classList.remove('drag-src');
      el.style.transform = '';
    }
    s.into?.classList.remove('drop-into', 'invalid');
    s.line?.remove();
    s.badge?.remove();
    document.body.classList.remove('tree-dragging');
  }

  /** Клавиатура на строке в фокусе: Alt+↑/↓, Tab, Shift+Tab. true — если ход сделан. */
  keyboard(id, key) {
    const rows = this.rows();
    const target = T.keyboardTarget(rows, id, key);
    if (!target) return false;
    const res = T.resolveDrop(store.data, rows, this.zonesObj(), id, target, { readOnly: !!store.ui.readOnly });
    if (!res.ok || res.noop) {
      if (res.reason) showSnackbar(res.reason);
      return true;
    }
    if (res.move.parentId && isCollapsed(res.move.parentId)) setCollapsed(res.move.parentId, false);
    moveTask(res.move).then(() => requestAnimationFrame(() => {
      this.root?.querySelector(`.tree-row[data-tid="${CSS.escape(id)}"] .task-row`)?.focus();
    }));
    return true;
  }
}

/** Ближайшая строка к указателю и часть строки: верх / середина (вложить) / низ. */
function hitTest(s, py) {
  let best = -1;
  let bestDist = Infinity;
  s.rects.forEach((r, i) => {
    if (!r) return;
    const d = py < r.top ? r.top - py : py > r.bottom ? py - r.bottom : 0;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  if (best < 0) return null;
  const r = s.rects[best];
  if (s.rows[best].empty) return { index: best, part: 'top' }; // пустой список: только «бросить сюда»
  if (py < r.top) return { index: best, part: 'top' };
  if (py > r.bottom) return { index: best, part: 'bottom' };
  // На телефоне середина уже: промежутки ловить пальцем легче, а вкладывать удобнее сдвигом вбок
  const f = (py - r.top) / Math.max(1, r.bottom - r.top);
  const edge = s.coarse ? 0.32 : 0.25;
  return { index: best, part: f < edge ? 'top' : f > 1 - edge ? 'bottom' : 'middle' };
}

function scrollerOf(el) {
  for (let x = el?.parentElement; x && x !== document.body; x = x.parentElement) {
    const oy = getComputedStyle(x).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && x.scrollHeight > x.clientHeight + 1) return x;
  }
  return window;
}

const scrollTop = (sc) => (sc === window ? window.scrollY : sc.scrollTop);
const scrollOffset = (sc) => (sc === window ? window.scrollY : sc.scrollTop - sc.getBoundingClientRect().top);

/** Прокрутка у края экрана (или панели карточки). true — если прокрутили. */
function autoScroll(s) {
  const sc = s.scroller;
  let top = 0;
  let bottom = window.innerHeight;
  if (sc === window) {
    const css = getComputedStyle(document.documentElement);
    top += parseFloat(css.getPropertyValue('--dock-top')) || 0;
    bottom -= parseFloat(css.getPropertyValue('--dock-bottom')) || 0;
  } else {
    const r = sc.getBoundingClientRect();
    top = r.top;
    bottom = r.bottom;
  }
  let v = 0;
  if (s.y < top + EDGE_PX) v = -Math.ceil(((top + EDGE_PX - s.y) / EDGE_PX) * MAX_SCROLL_PX);
  else if (s.y > bottom - EDGE_PX) v = Math.ceil(((s.y - (bottom - EDGE_PX)) / EDGE_PX) * MAX_SCROLL_PX);
  if (!v) return false;
  const before = scrollTop(sc);
  if (sc === window) window.scrollBy(0, v);
  else sc.scrollTop += v;
  return scrollTop(sc) !== before;
}

/** Общая область перетаскивания экрана: все деревья внутри видят друг друга. */
export function DragScope({ children, className = '' }) {
  const ctl = useRef(null);
  if (!ctl.current) ctl.current = new DragController();
  return html`<${ScopeCtx.Provider} value=${ctl.current}>
    <div class=${'drag-scope ' + className} ref=${(el) => { ctl.current.root = el; }}>${children}</div>
  <//>`;
}

/**
 * Дерево задач одного блока. zone — уникальный ключ блока на экране; cfg — что значит бросок в корень блока
 * (см. resolveDrop в core/treeDrop.js: manual, orderField, rootParentId, listId, accepts, rejectReason, autoReason).
 * index — дети для показа (по умолчанию — все подзадачи; на «Сегодня» — только те, что на экране).
 * limit — показать не больше стольких корней (остальное — «Показать ещё» снаружи).
 */
export function TaskTree({ zone, roots, cfg = {}, index = null, showList = true, quickActions = false, limit = Infinity, className = '' }) {
  const scope = useContext(ScopeCtx);
  if (!scope) {
    return html`<${DragScope}><${TaskTree} zone=${zone} roots=${roots} cfg=${cfg} index=${index} showList=${showList}
      quickActions=${quickActions} limit=${limit} className=${className}/><//>`;
  }
  scope.register(zone, cfg);
  const full = useMemo(() => S.childrenIndex(store.data), [store.version]);
  const show = index || full;
  const rows = [];
  const walk = (list, depth) => {
    for (const t of list) {
      const kids = show.get(t.id) || [];
      const closed = isCollapsed(t.id);
      rows.push({ t, depth, kids: kids.length, closed });
      if (kids.length && !closed && depth < 12) walk(kids, depth + 1);
    }
  };
  walk(roots.slice(0, limit), 0);
  return html`<div class=${'task-tree ' + className}>
    ${rows.map(({ t, depth, kids, closed }) => html`
      <div class="tree-row" key=${t.id} data-tid=${t.id} data-zone=${zone} data-depth=${depth} data-collapsed=${kids && closed ? '1' : '0'}>
        <${TaskRow} task=${t} depth=${depth} kids=${kids} hasKids=${(full.get(t.id) || []).length > 0} collapsed=${closed}
          onToggle=${() => setCollapsed(t.id, !closed)} index=${full}
          showList=${showList && depth === 0} showParent=${depth === 0} quickActions=${quickActions && depth === 0}
          handle=${{ onPointerDown: (e) => scope.begin(e, t.id) }}
          onKeyMove=${(key) => scope.keyboard(t.id, key)}/>
      </div>`)}
  </div>`;
}

/** Цель для броска в пустой блок (раскрытый пустой список на «Списках»). */
export function EmptyDrop({ zone, cfg, text }) {
  const scope = useContext(ScopeCtx);
  scope?.register(zone, cfg);
  return html`<div class="tree-row tree-empty" data-tid="" data-zone=${zone} data-depth="0" data-collapsed="0">${text}</div>`;
}