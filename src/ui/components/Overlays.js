// Диалог, snackbar и баннеры.

import { html } from '../html.js';
import { store, closeDialog, hideSnackbar } from '../../store/appState.js';

export function DialogHost() {
  const d = store.ui.dialog;
  if (!d) return null;
  return html`
    <div class="overlay center" onClick=${() => closeDialog(null)}>
      <div class="dialog" role="alertdialog" aria-modal="true" aria-label=${d.title} onClick=${(e) => e.stopPropagation()}>
        <h2>${d.title}</h2>
        ${d.text ? html`<p>${d.text}</p>` : null}
        ${d.items ? html`<div class="dialog-items">
          ${d.items.map((it) => html`<button class="menu-item" onClick=${() => closeDialog(it.value)}>
            <span class="mi-label">${it.label}</span></button>`)}
        </div>` : null}
        <div class="dialog-buttons">
          ${d.buttons.map((b) => html`<button class=${'btn ' + (b.kind || '')} onClick=${() => closeDialog(b.value)}>${b.label}</button>`)}
        </div>
      </div>
    </div>`;
}

export function Snackbar() {
  const s = store.ui.snackbar;
  if (!s) return null;
  return html`
    <div class="snackbar" role="status" aria-live="polite" key=${s.id}>
      <span>${s.text}</span>
      ${s.actionLabel ? html`<button class="snack-action" onClick=${() => {
        hideSnackbar();
        s.onAction?.();
      }}>${s.actionLabel}</button>` : null}
    </div>`;
}

export function Banner({ tone = 'info', children, actions = null, onClose = null }) {
  return html`
    <div class=${'banner banner-' + tone} role="status">
      <div class="banner-text">${children}</div>
      <div class="banner-actions">
        ${actions}
        ${onClose ? html`<button class="btn small ghost" onClick=${onClose} aria-label="Закрыть">✕</button>` : null}
      </div>
    </div>`;
}
