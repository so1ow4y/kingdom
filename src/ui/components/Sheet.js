import { html } from '../html.js';
import { Icon } from '../icons.js';

/**
 * Нижняя панель на телефоне, диалог по центру на компьютере.
 * anchor (DOMRect кнопки) — на компьютере вместо диалога выпадающий список под кнопкой.
 */
export function Sheet({ title, onClose, children, className = '', anchor = null }) {
  if (anchor && matchMedia('(min-width: 900px)').matches) {
    const width = 320;
    const left = Math.max(8, Math.min(anchor.left, innerWidth - width - 8));
    const below = innerHeight - anchor.bottom;
    const up = below < 320 && anchor.top > below;
    const style = up
      ? { left: left + 'px', bottom: innerHeight - anchor.top + 6 + 'px', maxHeight: anchor.top - 16 + 'px' }
      : { left: left + 'px', top: anchor.bottom + 6 + 'px', maxHeight: below - 16 + 'px' };
    return html`
      <div class="popover-layer" onClick=${onClose}>
        <div class=${'popover ' + className} style=${style} role="dialog" aria-label=${title}
          onClick=${(e) => e.stopPropagation()}>
          <div class="popover-title">${title}</div>
          ${children}
        </div>
      </div>`;
  }
  return html`
    <div class="overlay" onClick=${onClose}>
      <div class=${'sheet ' + className} role="dialog" aria-modal="true" aria-label=${title}
        onClick=${(e) => e.stopPropagation()}>
        <header class="sheet-head">
          <h2>${title}</h2>
          <button class="icon-btn" onClick=${onClose} aria-label="Закрыть"><${Icon} name="close"/></button>
        </header>
        <div class="sheet-body">${children}</div>
      </div>
    </div>`;
}

/** Пункт меню в панели. */
export function MenuItem({ icon, label, onClick, danger = false, checked = false, disabled = false, hint = null }) {
  return html`
    <button class=${'menu-item' + (danger ? ' danger' : '') + (checked ? ' checked' : '')} onClick=${onClick} disabled=${disabled}>
      ${icon ? html`<span class="mi-icon">${typeof icon === 'string' ? html`<${Icon} name=${icon} size=${20}/>` : icon}</span>` : null}
      <span class="mi-label">${label}${hint ? html`<small>${hint}</small>` : null}</span>
      ${checked ? html`<${Icon} name="check" size=${18} className="mi-check"/>` : null}
    </button>`;
}
