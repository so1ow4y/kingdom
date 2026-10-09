// Перенос продукта между записями дневника перетаскиванием (0.14.1), как вложение задач в Chronicle: тянут за ⋮⋮ у
// продукта (лекарства, замера), бросают на другую запись — продукт становится её частью (время и рацион — её), на
// свободное место рациона — отдельной записью. Переносится один продукт, а не вся запись; запись, в которой ничего
// не осталось, удаляется (store/feastActions.js → moveEntryItem). Мышь и палец (pointer events), у края — прокрутка,
// Esc — отмена. Без мыши — «Перенести в…» в листе записи.

import { moveEntryItem } from '../../store/feastActions.js';
import * as F from '../../core/feast.js';
import { store } from '../../store/appState.js';
import { tr } from '../../core/i18n.js';

const START_DISTANCE = 5;
const EDGE_PX = 64;
const MAX_SCROLL_PX = 16;

let s = null; // текущее перетаскивание
let lastDrop = 0;

/** Только что бросили — щелчок по записи не открывает лист. */
export const justDropped = () => Date.now() - lastDrop < 400;

function scrollerOf(el) {
  for (let x = el?.parentElement; x && x !== document.body; x = x.parentElement) {
    const oy = getComputedStyle(x).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && x.scrollHeight > x.clientHeight + 1) return x;
  }
  return window;
}

/** Куда бросаем: запись (кроме своей) или рацион (отдельной записью). */
function targetAt(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const row = el.closest('.entry-row[data-entry]');
  if (row && row.dataset.entry !== s.entryId) return { el: row, entryId: row.dataset.entry };
  if (row) return null;
  const meal = el.closest('.meal[data-meal]');
  if (meal) return { el: meal, meal: meal.dataset.meal };
  return null;
}

function label(t) {
  if (!t) return tr('Перенести «{name}»', { name: s.name });
  if (t.entryId) {
    const e = store.feast.entries.get(t.entryId);
    return tr('В запись {when}', { when: [e?.time, e ? F.entryTitle(e) : ''].filter(Boolean).join(' · ') });
  }
  const m = F.mealInfo(store.feast, t.meal);
  const alone = t.meal === s.meal && s.single;
  return alone ? tr('Уже отдельная запись') : tr('Отдельной записью · {meal}', { meal: F.mealName(m) });
}

function frame() {
  if (!s) return;
  s.raf = 0;
  const t = targetAt(s.x, s.y);
  if (s.target?.el !== t?.el) {
    s.target?.el.classList.remove('drop-into');
    t?.el.classList.add('drop-into');
  }
  s.target = t;
  const invalid = t && !t.entryId && t.meal === s.meal && s.single;
  s.badge.textContent = label(t);
  s.badge.classList.toggle('invalid', !!invalid);
  s.badge.style.display = 'block';
  s.badge.style.transform = `translate(${Math.min(innerWidth - 40, s.x + 14)}px, ${s.y + 14}px)`;
  // у края — прокрутка
  const v = s.y < EDGE_PX ? -(EDGE_PX - s.y) : s.y > innerHeight - EDGE_PX ? s.y - (innerHeight - EDGE_PX) : 0;
  if (v) {
    const dy = Math.max(-MAX_SCROLL_PX, Math.min(MAX_SCROLL_PX, Math.round(v / 3)));
    if (s.scroller === window) window.scrollBy(0, dy);
    else s.scroller.scrollTop += dy;
    s.raf = requestAnimationFrame(frame);
  }
}

function onMove(e) {
  if (!s || e.pointerId !== s.pointerId) return;
  e.preventDefault();
  s.x = e.clientX;
  s.y = e.clientY;
  if (!s.active) {
    if (Math.hypot(s.x - s.x0, s.y - s.y0) < START_DISTANCE) return;
    s.active = true;
    s.scroller = scrollerOf(s.src);
    s.src.classList.add('drag-src');
    document.body.classList.add('entry-dragging');
    s.badge = document.createElement('div');
    s.badge.className = 'drop-badge';
    document.body.append(s.badge);
  }
  if (!s.raf) s.raf = requestAnimationFrame(frame);
}

function finish(drop) {
  const cur = s;
  s = null;
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  window.removeEventListener('pointercancel', onCancel);
  window.removeEventListener('keydown', onKey);
  if (!cur) return;
  if (cur.raf) cancelAnimationFrame(cur.raf);
  cur.src?.classList.remove('drag-src');
  cur.target?.el.classList.remove('drop-into');
  cur.badge?.remove();
  document.body.classList.remove('entry-dragging');
  if (!cur.active) return;
  lastDrop = Date.now();
  if (!drop || !cur.target) return;
  const t = cur.target;
  if (!t.entryId && t.meal === cur.meal && cur.single) return;
  moveEntryItem(cur.entryId, cur.itemId, t.entryId ? { entryId: t.entryId } : { meal: t.meal });
}

const onUp = (e) => {
  if (s && e.pointerId === s.pointerId) {
    s.x = e.clientX;
    s.y = e.clientY;
    if (s.active) s.target = targetAt(s.x, s.y);
    finish(true);
  }
};
const onCancel = () => finish(false);
const onKey = (e) => {
  if (e.key === 'Escape') finish(false);
};

/**
 * Нажатие на ⋮⋮ продукта: перетаскивание начинается после сдвига на 5 px. item — { entryId, itemId, name, meal, single }.
 */
export function beginItemDrag(e, item) {
  if (s || store.ui.feastReadOnly || (e.pointerType === 'mouse' && e.button !== 0)) return;
  e.preventDefault();
  e.stopPropagation();
  s = { ...item, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, active: false,
    src: e.currentTarget.closest('.er-item-wrap, .entry-row') };
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey);
}
