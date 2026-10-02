import { html, useState } from '../html.js';
import { Icon } from '../icons.js';
import { readLocal, writeLocal } from '../hooks.js';

/**
 * Блок экрана с заголовком. collapsible — можно свернуть; storageKey — помнить состояние на устройстве.
 */
export function Section({ title, count, children, collapsible = false, defaultOpen = true, storageKey = null,
  actions = null, className = '', tone = '' }) {
  const [open, setOpen] = useState(() => (storageKey ? readLocal('section.' + storageKey, defaultOpen) : defaultOpen));
  const toggle = () => {
    setOpen(!open);
    if (storageKey) writeLocal('section.' + storageKey, !open);
  };
  const head = html`
    <span class="section-title">${title}${count != null ? html` <span class="section-count">· ${count}</span>` : null}</span>`;
  return html`
    <section class=${`section ${tone ? 'section-' + tone : ''} ${className}`}>
      <header class="section-head">
        ${collapsible
          ? html`<button class="section-toggle" onClick=${toggle} aria-expanded=${open}>
              <${Icon} name=${open ? 'chevronDown' : 'chevron'} size=${18}/>${head}</button>`
          : head}
        ${actions ? html`<div class="section-actions">${actions}</div>` : null}
      </header>
      ${!collapsible || open ? html`<div class="section-body">${children}</div>` : null}
    </section>`;
}

export function Empty({ children }) {
  return html`<p class="empty">${children}</p>`;
}
