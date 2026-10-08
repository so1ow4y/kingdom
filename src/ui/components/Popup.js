// Подсказки и выпадающие меню (обновление 0.10) — перенос Tooltip/DropdownMenu из license-store
// (components/ui/tooltip.tsx, dropdown-menu.tsx) на Preact без Radix. Док — плашка с backdrop-filter,
// а он «ловит» position: fixed потомков, поэтому подсказка и меню рисуются отдельными слоями в корне
// приложения (TooltipLayer, MenuLayer), а не внутри дока.
//
// Подсказка: любому элементу достаточно атрибутов data-hint="подпись" (+ data-hint-side, data-hint-kbd).
// Меню: openMenu({ anchor, side, align, title, items }) — от элемента-якоря, по умолчанию по центру.

import { html, useState, useEffect, useLayoutEffect, useRef } from '../html.js';
import { Icon } from '../icons.js';

/** Зазор подсказок и меню от пункта (POPUP_OFFSET дока license-store). */
export const POPUP_OFFSET = 14;
const EDGE = 8;

function place(side, align, r, w, h) {
  let left;
  let top;
  if (side === 'right' || side === 'left') {
    left = side === 'right' ? r.right + POPUP_OFFSET : r.left - POPUP_OFFSET - w;
    top = align === 'start' ? r.top : r.top + r.height / 2 - h / 2;
  } else {
    top = side === 'bottom' ? r.bottom + POPUP_OFFSET : r.top - POPUP_OFFSET - h;
    left = align === 'start' ? r.left : align === 'end' ? r.right - w : r.left + r.width / 2 - w / 2;
  }
  // как collision padding у Radix: не вылезать за край окна
  left = Math.max(EDGE, Math.min(left, innerWidth - w - EDGE));
  top = Math.max(EDGE, Math.min(top, innerHeight - h - EDGE));
  return { left, top };
}

// ---------- Подсказки ----------

let hideTip = () => {};
/** Убрать подсказку (например, перед открытием меню от того же пункта). */
export const hideTooltip = () => hideTip();

export function TooltipLayer() {
  const [tip, setTip] = useState(null);
  const box = useRef(null);
  const [pos, setPos] = useState(null);

  useEffect(() => {
    let current = null;
    const show = (el) => {
      current = el;
      setPos(null);
      setTip({ label: el.dataset.hint, kbd: el.dataset.hintKbd || '', side: el.dataset.hintSide || 'right', r: el.getBoundingClientRect() });
    };
    const hide = () => {
      if (!current) return;
      current = null;
      setTip(null);
    };
    hideTip = hide;
    const over = (e) => {
      if (e.pointerType === 'touch') return; // как у Radix: на сенсорном экране подсказок нет
      const el = e.target.closest?.('[data-hint]');
      if (el && el !== current && el.dataset.state !== 'open') show(el);
      else if (!el && current) hide();
    };
    const out = (e) => {
      if (current && !(e.relatedTarget && current.contains(e.relatedTarget))) hide();
    };
    const focusIn = (e) => {
      const el = e.target.closest?.('[data-hint]');
      if (el && el.matches(':focus-visible')) show(el);
    };
    const key = (e) => e.key === 'Escape' && hide();
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', out);
    document.addEventListener('focusin', focusIn);
    document.addEventListener('focusout', hide);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('hashchange', hide);
    return () => {
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', out);
      document.removeEventListener('focusin', focusIn);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('hashchange', hide);
    };
  }, []);

  useLayoutEffect(() => {
    if (!tip || !box.current) return;
    setPos(place(tip.side, 'center', tip.r, box.current.offsetWidth, box.current.offsetHeight));
  }, [tip]);

  if (!tip) return null;
  // стрелка смотрит на пункт и стоит напротив его середины, даже если подсказку сдвинули от края
  const arrow = pos && (tip.side === 'left' || tip.side === 'right'
    ? { top: tip.r.top + tip.r.height / 2 - pos.top + 'px' }
    : { left: tip.r.left + tip.r.width / 2 - pos.left + 'px' });
  return html`
    <div ref=${box} class=${'tooltip side-' + tip.side} role="tooltip"
      style=${pos ? { left: pos.left + 'px', top: pos.top + 'px' } : { left: '-9999px', top: '0px', visibility: 'hidden' }}>
      <span>${tip.label}</span>${tip.kbd ? html`<kbd class="tooltip-kbd">${tip.kbd}</kbd>` : null}
      <i class="tooltip-arrow" style=${arrow || {}}></i>
    </div>`;
}

// ---------- Меню ----------

let menu = null;
let menuListeners = new Set();
const emitMenu = () => menuListeners.forEach((f) => f(menu));

/**
 * Открыть меню от элемента. items: [{ label, icon, emoji, color, count, kbd, active, danger, disabled, onSelect }
 * | { separator: true }]. Повторный вызов с тем же якорем закрывает меню (как клик по триггеру).
 */
export function openMenu({ anchor, side = 'bottom', align = 'center', title = '', items, className = '', viaKeyboard = false }) {
  if (menu && menu.anchor === anchor) return closeMenu();
  closeMenu();
  hideTip();
  anchor?.setAttribute('data-state', 'open');
  anchor?.setAttribute('aria-expanded', 'true');
  menu = { anchor, side, align, title, items, className, viaKeyboard, r: anchor.getBoundingClientRect() };
  emitMenu();
}

export function closeMenu({ restoreFocus = false } = {}) {
  if (!menu) return;
  const a = menu.anchor;
  a?.removeAttribute('data-state');
  a?.setAttribute('aria-expanded', 'false');
  menu = null;
  emitMenu();
  if (restoreFocus) a?.focus?.();
}

export const isMenuOpen = () => !!menu;

export function MenuLayer() {
  const [m, setM] = useState(menu);
  const box = useRef(null);
  const [pos, setPos] = useState(null);

  useEffect(() => {
    const f = (v) => {
      setPos(null);
      setM(v);
    };
    menuListeners.add(f);
    return () => menuListeners.delete(f);
  }, []);

  useLayoutEffect(() => {
    if (!m || !box.current) return;
    const el = box.current;
    const r = m.r;
    // место по выбранной стороне: столько, сколько есть до края окна (available-height у Radix)
    const room = m.side === 'top' ? r.top - POPUP_OFFSET - EDGE : m.side === 'bottom' ? innerHeight - r.bottom - POPUP_OFFSET - EDGE : innerHeight - 2 * EDGE;
    el.style.maxHeight = Math.max(120, room) + 'px';
    setPos(place(m.side, m.align, r, el.offsetWidth, Math.min(el.scrollHeight, Math.max(120, room))));
  }, [m]);

  // Фокус — когда меню уже видно (скрытый visibility элемент фокус не принимает).
  // С клавиатуры — сразу на первый пункт, мышью — на само меню (стрелки ведут дальше), как у Radix.
  useLayoutEffect(() => {
    if (!m || !pos || !box.current) return;
    const el = box.current;
    if (el.contains(document.activeElement)) return;
    const first = m.viaKeyboard ? el.querySelector('[role="menuitem"]:not(:disabled)') : null;
    (first || el).focus({ preventScroll: true });
  }, [m, pos]);

  useEffect(() => {
    if (!m) return undefined;
    const down = (e) => {
      if (box.current?.contains(e.target) || m.anchor?.contains(e.target)) return;
      closeMenu();
    };
    const resize = () => closeMenu();
    document.addEventListener('pointerdown', down, true);
    window.addEventListener('resize', resize);
    window.addEventListener('hashchange', resize);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      window.removeEventListener('resize', resize);
      window.removeEventListener('hashchange', resize);
    };
  }, [m]);

  if (!m) return null;

  const onKey = (e) => {
    const items = [...box.current.querySelectorAll('[role="menuitem"]:not(:disabled)')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeMenu({ restoreFocus: true });
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = items.length;
      const down = e.key === 'ArrowDown';
      if (n) items[i < 0 ? (down ? 0 : n - 1) : (i + (down ? 1 : n - 1)) % n].focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      (e.key === 'Home' ? items[0] : items.at(-1))?.focus();
    } else if (e.key === 'Tab') {
      closeMenu();
    }
  };

  const pick = (it) => {
    if (it.disabled) return;
    closeMenu();
    it.onSelect?.();
  };

  return html`
    <div ref=${box} class=${'menu side-' + m.side + ' ' + m.className} role="menu" tabIndex="-1" aria-label=${m.title || undefined}
      onKeyDown=${onKey} style=${pos ? { left: pos.left + 'px', top: pos.top + 'px' } : { left: '-9999px', top: '0px', visibility: 'hidden' }}>
      ${m.title ? html`<div class="menu-label">${m.title}</div><div class="menu-divider" role="separator"></div>` : null}
      ${m.items.map((it, i) => it.separator ? html`<div class="menu-divider" role="separator" key=${'s' + i}></div>` : html`
        <button type="button" role="menuitem" key=${i} disabled=${!!it.disabled}
          class=${'menu-row' + (it.active ? ' active' : '') + (it.danger ? ' danger' : '')}
          aria-current=${it.active ? 'page' : undefined} onClick=${() => pick(it)}
          onPointerMove=${(e) => e.currentTarget !== document.activeElement && e.currentTarget.focus({ preventScroll: true })}>
          ${it.color ? html`<i class="dot" style=${{ background: it.color }}></i>`
            : it.icon ? html`<${Icon} name=${it.icon} size=${16}/>` : it.emoji ? null : html`<span class="menu-gap"></span>`}
          <span class="menu-text">${it.emoji ? it.emoji + ' ' : ''}${it.label}</span>
          ${it.count ? html`<span class="menu-count">${it.count}</span>` : null}
          ${it.kbd ? html`<kbd class="menu-kbd">${it.kbd}</kbd>` : null}
        </button>`)}
    </div>`;
}
