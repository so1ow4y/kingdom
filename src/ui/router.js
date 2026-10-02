// Hash-роутинг (GitHub Pages не умеет SPA-фолбэк). Маршруты — docs/TZ.md §5.6.
// Навигация внутри приложения идёт через navigate(): в history.state хранится глубина,
// чтобы кнопка «←» знала, можно ли вернуться назад или надо уйти на запасной экран.

import { html } from './html.js';

const ROUTES = {
  today: 0, inbox: 0, lists: 0, list: 1, task: 1, archive: 0, trash: 0, settings: 0, more: 0, quick: 0, journal: 0,
};

export function parseHash(hash = location.hash) {
  const raw = hash.replace(/^#/, '');
  const [path, qs = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  const name = parts[0] || 'today';
  const param = parts[1] ? decodeURIComponent(parts[1]) : null;
  if (!path.startsWith('/') || !(name in ROUTES) || (ROUTES[name] && !param)) {
    return { name: 'today', param: null, query: {}, path: '/today' };
  }
  return { name, param, query: Object.fromEntries(new URLSearchParams(qs)), path: '/' + parts.join('/') };
}

function emit() {
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function navigate(path, { replace = false } = {}) {
  if ('#' + path === location.hash) return;
  const depth = history.state?.ltDepth || 0;
  if (replace) history.replaceState({ ltDepth: depth }, '', '#' + path);
  else history.pushState({ ltDepth: depth + 1 }, '', '#' + path);
  emit();
}

export function goBack(fallback = '/today') {
  if ((history.state?.ltDepth || 0) > 0) history.back();
  else navigate(fallback, { replace: true });
}

/** Ссылка внутри приложения. */
export function Link({ to, className = '', children, onClick, title }) {
  const click = (e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    onClick?.(e);
    navigate(to);
  };
  return html`<a href=${'#' + to} class=${className} onClick=${click} title=${title}>${children}</a>`;
}
