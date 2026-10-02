// Перестановка перетаскиванием за ручку. Работает мышью и пальцем (pointer events).
// onMove(id, index) — index в списке БЕЗ перемещаемого элемента (как ждёт actions.reorderTask).

import { html, useRef, useState } from '../html.js';

export function SortableList({ items, render, onMove, className = '', disabled = false }) {
  const box = useRef(null);
  const st = useRef(null);
  const [drag, setDrag] = useState(null); // { from, to, dy, h }

  const start = (e, id) => {
    if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const nodes = [...box.current.children];
    const from = nodes.findIndex((n) => n.dataset.sid === id);
    if (from < 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const rects = nodes.map((n) => n.getBoundingClientRect());
    st.current = { id, from, to: from, startY: e.clientY, rects };
    setDrag({ from, to: from, dy: 0, h: rects[from].height });
  };

  const move = (e) => {
    const s = st.current;
    if (!s) return;
    e.preventDefault();
    const dy = e.clientY - s.startY;
    const r = s.rects[s.from];
    const mid = r.top + r.height / 2 + dy;
    let to = 0;
    s.rects.forEach((x, i) => {
      if (i !== s.from && x.top + x.height / 2 < mid) to++;
    });
    s.to = to;
    setDrag({ from: s.from, to, dy, h: r.height });
  };

  const end = () => {
    const s = st.current;
    if (!s) return;
    st.current = null;
    setDrag(null);
    if (s.to !== s.from) onMove(s.id, s.to);
  };

  const shiftOf = (i) => {
    if (!drag) return 0;
    if (i === drag.from) return drag.dy;
    if (drag.to > drag.from && i > drag.from && i <= drag.to) return -drag.h;
    if (drag.to < drag.from && i >= drag.to && i < drag.from) return drag.h;
    return 0;
  };

  return html`
    <div class=${'sortable ' + className + (drag ? ' is-dragging' : '')} ref=${box}>
      ${items.map((item, i) => {
        const handle = {
          onPointerDown: (e) => start(e, item.id),
          onPointerMove: move,
          onPointerUp: end,
          onPointerCancel: end,
        };
        const dy = shiftOf(i);
        return html`<div key=${item.id} data-sid=${item.id}
          class=${'sortable-item' + (drag && i === drag.from ? ' dragging' : '')}
          style=${dy ? { transform: `translateY(${dy}px)` } : { transform: '' }}>
          ${render(item, handle)}
        </div>`;
      })}
    </div>`;
}

export function DragHandle({ handle, label = 'Перетащить' }) {
  return html`<button class="drag-handle" aria-label=${label} title=${label}
    onClick=${(e) => e.stopPropagation()} ...${handle}>
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/>
      <circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/>
    </svg>
  </button>`;
}
