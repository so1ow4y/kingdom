// Клавиатура в списках с панелью справа (обновление 0.16) — перенос useListHotkeys license-store
// (hooks/use-list-hotkeys.ts), как в SIEM: «вниз» и «вверх» (S и W по умолчанию) двигают курсор по строкам —
// если панель справа открыта, она переключается на новую строку; «открыть» (D) открывает строку под курсором,
// «закрыть» (A, и Esc) убирает панель. Клавиши назначаются в «Настройки → Интерфейс → Горячие клавиши» (ui/keys.js).
//
// В license-store каждый список передаёт хуку свои id. Здесь списков много и они разные (задачи на «Сегодня»,
// во «Входящих», в списке, в поиске, выполненные и корзина; записи и заметки дневника; продукты, лекарства,
// замеры), поэтому строки размечены прямо в разметке: data-row="вид:id". Порядок — как на экране, берутся только
// видимые строки основной области (#main): подзадачи в карточке справа в счёт не идут.
// Клавиши не срабатывают, пока человек печатает в поле, держит модификатор или поверх открыто окно (app.js).

import { navigate, currentTaskId, currentFoodId, closeTask } from './router.js';
import { store, openSheet, closeSheet } from '../store/appState.js';

const cardOpen = () => !!(currentTaskId() || currentFoodId());

/**
 * Виды строк. opened — id открытой справа записи этого вида; open — открыть (если справа уже открыта
 * карточка — заменить её без новой записи в истории, чтобы одно «Назад» закрывало панель); close — закрыть.
 */
const KINDS = {
  task: { opened: currentTaskId, open: (id) => navigate('/task/' + encodeURIComponent(id), { replace: cardOpen() }), close: closeTask },
  food: { opened: currentFoodId, open: (id) => navigate('/food/' + encodeURIComponent(id), { replace: cardOpen() }), close: closeTask },
  entry: { opened: () => (store.ui.sheet?.type === 'entry' ? store.ui.sheet.id : null), open: (id) => openSheet('entry', { id }), close: closeSheet },
};

/** Ключ строки под курсором ('task:<id>') и сам элемент (одна задача бывает в двух местах экрана). */
let cursor = null;
let cursorEl = null;
let lastOpened = null;
let lastScreen = null;

const split = (key) => {
  const i = key.indexOf(':');
  return [key.slice(0, i), key.slice(i + 1)];
};

/** Ключ записи, открытой справа (или null). */
export function openedKey() {
  for (const [kind, k] of Object.entries(KINDS)) {
    const id = k.opened();
    if (id) return kind + ':' + id;
  }
  return null;
}

/** Видимые строки основной области в порядке на экране. */
function rows() {
  const main = document.getElementById('main');
  return main ? [...main.querySelectorAll('[data-row]')].filter((el) => el.getClientRects().length > 0) : [];
}

function openRow(key) {
  if (openedKey() === key) return;
  const [kind, id] = split(key);
  KINDS[kind]?.open(id);
}

/** Подсветить строку под курсором (data-cursor; разметку строк Preact не трогает — атрибут ставим сами). */
export function paintCursor() {
  for (const el of document.querySelectorAll('[data-cursor]')) el.removeAttribute('data-cursor');
  if (!cursor) return;
  const main = document.getElementById('main');
  if (!cursorEl || !cursorEl.isConnected || cursorEl.dataset.row !== cursor) {
    cursorEl = main?.querySelector(`[data-row="${CSS.escape(cursor)}"]`) || null;
  }
  cursorEl?.setAttribute('data-cursor', '');
}

function place(el) {
  cursor = el.dataset.row;
  cursorEl = el;
  paintCursor();
  el.scrollIntoView({ block: 'nearest' });
}

function indexOfCursor(list) {
  if (cursorEl && list.includes(cursorEl)) return list.indexOf(cursorEl);
  return cursor ? list.findIndex((el) => el.dataset.row === cursor) : -1;
}

/** «Вниз» (+1) и «вверх» (−1). Первое нажатие встаёт на первую (последнюю) строку. Строк нет — нажатие не наше. */
export function moveCursor(delta) {
  const list = rows();
  if (!list.length) return false;
  const i = indexOfCursor(list);
  const next = i < 0 ? (delta > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, i + delta));
  place(list[next]);
  if (openedKey()) openRow(list[next].dataset.row);
  return true;
}

/** «Открыть»: строку под курсором, а если курсора нет — первую. */
export function openCursor() {
  const list = rows();
  if (!list.length) return false;
  const i = indexOfCursor(list);
  const el = list[i < 0 ? 0 : i];
  place(el);
  openRow(el.dataset.row);
  return true;
}

/** «Закрыть»: убрать открытую справа запись. Ничего не открыто — нажатие не наше. */
export function closeOpened() {
  const key = openedKey();
  if (!key) return false;
  KINDS[split(key)[0]].close();
  return true;
}

/**
 * После каждой перерисовки (app.js): другой экран — курсор сначала (строки ушли из списка); запись открыли
 * мышью — курсор встаёт на неё; подсветка восстанавливается, если строку перерисовали заново.
 */
export function syncCursor(screen) {
  if (screen !== lastScreen) {
    lastScreen = screen;
    cursor = null;
    cursorEl = null;
  }
  const opened = openedKey();
  if (opened && opened !== lastOpened) {
    cursor = opened;
    cursorEl = null;
  }
  lastOpened = opened;
  paintCursor();
}
