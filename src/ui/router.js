// Hash-роутинг (GitHub Pages не умеет SPA-фолбэк). Маршруты — docs/TZ.md §5.6.
// Навигация внутри приложения идёт через navigate(): в history.state хранится глубина,
// чтобы кнопка «←» знала, можно ли вернуться назад или надо уйти на запасной экран.

import { html } from './html.js';

const ROUTES = {
  today: 0, inbox: 0, lists: 0, list: 1, task: 1, archive: 0, trash: 0, settings: 0, more: 0, quick: 0, journal: 0, analytics: 0, shop: 0, village: 0,
  tasks: 0,
  diary: 0, foods: 0, food: 1, nutrition: 0, body: 0, // Crimson Harvest (0.11)
  meals: 0, meal: 1, // рационы — как списки у задач (0.12)
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

// ---------- Карточка задачи (TZ §6.6, обновление 0.3 п. 2.1) ----------
// Карточка — это маршрут #/task/<id> поверх «базового» экрана. На широком экране она открыта панелью справа,
// на узком — на весь экран. Состояние в адресе, поэтому «Назад» в браузере закрывает карточку.

let basePath = '/today';

/** Экран под карточкой (обновляет app.js при каждой смене маршрута). */
export function setBasePath(path) {
  basePath = path;
}

export function currentTaskId() {
  const m = location.hash.match(/^#\/task\/([^?]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Открытая карточка продукта Feast (0.11) — тоже маршрут поверх базового экрана, справа на широком. */
export function currentFoodId() {
  const m = location.hash.match(/^#\/food\/([^?]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Закрыть карточку (задачи или продукта): шаг назад по истории или на базовый экран. */
export function closeTask() {
  if (currentTaskId() || currentFoodId()) goBack(basePath);
}

/** Открыть карточку продукта; та же — закрыть; другая — заменить без новой записи в истории. */
export function openFood(id) {
  const cur = currentFoodId();
  if (cur === id) closeTask();
  else navigate('/food/' + encodeURIComponent(id), { replace: !!cur });
}

/**
 * Клик по задаче: та же задача уже открыта — закрыть; другая — переключить без новой записи в истории
 * (чтобы одно «Назад» закрывало панель); ничего не открыто — открыть.
 */
export function openTask(id) {
  const cur = currentTaskId();
  if (cur === id) closeTask();
  else navigate('/task/' + encodeURIComponent(id), { replace: !!cur });
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
