// Штрихкоды продуктов (обновление 0.11, Feast). Чистые функции: проверка и нормализация кода, кодирование
import { tr } from './i18n.js';
// EAN-13/EAN-8 в полосы (рисунок на карточке, тесты) и свой декодер по строкам изображения — для браузеров
// без BarcodeDetector (Chrome на Windows, Firefox). На продуктах почти всегда EAN-13, EAN-8 или UPC-A
// (это EAN-13 с ведущим нулём), поэтому их и умеем.

// Ширины четырёх полос цифры (в модулях) для кодов L и R (у R те же ширины, начиная с полосы); G — наоборот.
const WIDTHS = [
  [3, 2, 1, 1], [2, 2, 2, 1], [2, 1, 2, 2], [1, 4, 1, 1], [1, 1, 3, 2],
  [1, 2, 3, 1], [1, 1, 1, 4], [1, 3, 1, 2], [1, 2, 1, 3], [3, 1, 1, 2],
];
const G_WIDTHS = WIDTHS.map((w) => [...w].reverse());
// Чётность шести левых цифр задаёт первую цифру EAN-13 (L — 0, G — 1).
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** Контрольная цифра для кода без неё (EAN-8: 7 цифр, EAN-13: 12, UPC-A: 11). */
export function checkDigit(body) {
  let s = 0;
  const digits = body.split('').map(Number).reverse();
  digits.forEach((d, i) => { s += d * (i % 2 === 0 ? 3 : 1); });
  return (10 - (s % 10)) % 10;
}

export const isValidEan = (code) => /^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)
  && checkDigit(code.slice(0, -1)) === Number(code.at(-1));

/**
 * Код, как он хранится у продукта: только цифры; UPC-A (12) — как EAN-13 с нулём впереди.
 * Нецифровые коды (внутренние, Code 128) — заглавными без пробелов. Пусто — null.
 */
export function normalizeBarcode(raw) {
  const s = String(raw ?? '').trim().replace(/[\s-]+/g, '');
  if (!s) return null;
  if (/^\d+$/.test(s)) return s.length === 12 ? '0' + s : s;
  return s.toUpperCase().slice(0, 48);
}

/** Почему код подозрителен (для подсказки при ручном вводе); пусто — всё хорошо. */
export function barcodeWarning(code) {
  if (!code) return tr('Пустой код');
  if (!/^\d+$/.test(code)) return '';
  if (![8, 13, 14].includes(code.length)) return tr('Обычно на продуктах 8 или 13 цифр');
  return isValidEan(code) ? '' : tr('Контрольная цифра не сходится — проверь, нет ли опечатки');
}

// ---------- Кодирование (полосы для рисунка и тестов) ----------

const bits = (w, firstBar) => w.flatMap((n, i) => Array(n).fill((i % 2 === 0) === firstBar ? 1 : 0));

/** EAN-13 или EAN-8 → массив модулей (1 — полоса, 0 — просвет), без тихих зон. null — не EAN. */
export function encodeEan(code) {
  if (!isValidEan(code) || (code.length !== 13 && code.length !== 8)) return null;
  const d = code.split('').map(Number);
  const out = [1, 0, 1];
  if (code.length === 13) {
    const parity = PARITY[d[0]];
    for (let i = 1; i <= 6; i++) out.push(...bits(parity[i - 1] === 'L' ? WIDTHS[d[i]] : G_WIDTHS[d[i]], false));
    out.push(0, 1, 0, 1, 0);
    for (let i = 7; i <= 12; i++) out.push(...bits(WIDTHS[d[i]], true));
  } else {
    for (let i = 0; i < 4; i++) out.push(...bits(WIDTHS[d[i]], false));
    out.push(0, 1, 0, 1, 0);
    for (let i = 4; i < 8; i++) out.push(...bits(WIDTHS[d[i]], true));
  }
  out.push(1, 0, 1);
  return out;
}

// ---------- Декодирование строки пикселей ----------

/** Яркости строки → полосы: [{ bar, w }], порог — среднее в скользящем окне (переживает неровный свет). */
export function runsOf(lum) {
  const n = lum.length;
  if (n < 30) return [];
  let lo = 255;
  let hi = 0;
  for (const v of lum) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (hi - lo < 40) return []; // нет контраста — штрихкода тут нет
  const win = Math.max(8, Math.round(n / 12));
  const pref = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pref[i + 1] = pref[i] + lum[i];
  const runs = [];
  let cur = null;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - win);
    const b = Math.min(n, i + win + 1);
    const local = (pref[b] - pref[a]) / (b - a);
    const t = (local + (lo + hi) / 2) / 2;
    const bar = lum[i] < t;
    if (cur && cur.bar === bar) cur.w++;
    else {
      cur = { bar, w: 1 };
      runs.push(cur);
    }
  }
  return runs;
}

/** Лучшая цифра для четырёх полос: { d, parity, err }. */
function matchDigit(ws, tables) {
  const total = ws[0] + ws[1] + ws[2] + ws[3];
  const unit = total / 7;
  let best = null;
  for (const [parity, table] of tables) {
    for (let d = 0; d < 10; d++) {
      let err = 0;
      for (let k = 0; k < 4; k++) err += Math.abs(ws[k] / unit - table[d][k]);
      if (!best || err < best.err) best = { d, parity, err };
    }
  }
  return best;
}

const LEFT13 = [['L', WIDTHS], ['G', G_WIDTHS]];
const ONLY_L = [['L', WIDTHS]];
const MAX_DIGIT_ERR = 1.8;

/** Полосы-ограничители примерно по модулю шириной. */
function guardOk(runs, from, count, module) {
  for (let k = 0; k < count; k++) {
    const r = runs[from + k];
    if (!r || r.w < module * 0.35 || r.w > module * 2.2) return false;
  }
  return true;
}

function tryEan13(runs, i) {
  if (i + 59 > runs.length || !runs[i].bar) return null;
  let total = 0;
  for (let k = 0; k < 59; k++) total += runs[i + k].w;
  const m = total / 95;
  if (m < 0.8 || !guardOk(runs, i, 3, m) || !guardOk(runs, i + 27, 5, m) || !guardOk(runs, i + 56, 3, m)) return null;
  // Перед штрихкодом — светлая тихая зона (если строка не обрезана по краю)
  if (i > 0 && runs[i - 1].w < m * 3) return null;
  const digits = [];
  let parity = '';
  for (let g = 0; g < 12; g++) {
    const at = i + 3 + g * 4 + (g >= 6 ? 5 : 0);
    const ws = [runs[at].w, runs[at + 1].w, runs[at + 2].w, runs[at + 3].w];
    const r = matchDigit(ws, g < 6 ? LEFT13 : ONLY_L);
    if (!r || r.err > MAX_DIGIT_ERR) return null;
    digits.push(r.d);
    if (g < 6) parity += r.parity;
  }
  const first = PARITY.indexOf(parity);
  if (first < 0) return null;
  const code = first + digits.join('');
  return isValidEan(code) ? code : null;
}

function tryEan8(runs, i) {
  if (i + 43 > runs.length || !runs[i].bar) return null;
  let total = 0;
  for (let k = 0; k < 43; k++) total += runs[i + k].w;
  const m = total / 67;
  if (m < 0.8 || !guardOk(runs, i, 3, m) || !guardOk(runs, i + 19, 5, m) || !guardOk(runs, i + 40, 3, m)) return null;
  if (i > 0 && runs[i - 1].w < m * 3) return null;
  const digits = [];
  for (let g = 0; g < 8; g++) {
    const at = i + 3 + g * 4 + (g >= 4 ? 5 : 0);
    const r = matchDigit([runs[at].w, runs[at + 1].w, runs[at + 2].w, runs[at + 3].w], ONLY_L);
    if (!r || r.err > MAX_DIGIT_ERR) return null;
    digits.push(r.d);
  }
  const code = digits.join('');
  return isValidEan(code) ? code : null;
}

/** Строка яркостей (0…255) → код EAN-13/EAN-8 или null. Пробует и перевёрнутый штрихкод. */
export function decodeRow(lum) {
  const forward = runsOf(lum);
  for (const runs of [forward, [...forward].reverse()]) {
    for (let i = 0; i < runs.length; i++) {
      if (!runs[i].bar) continue;
      const c = tryEan13(runs, i) || tryEan8(runs, i);
      if (c) return c;
    }
  }
  return null;
}

/**
 * Картинка (ImageData или { width, height, data: RGBA }) → { code, votes } или null.
 * Читает горизонтальные строки (и вертикальные — если штрихкод повёрнут), побеждает самый частый код.
 */
export function decodeImage(img, { rows = 24 } = {}) {
  const { width: w, height: h, data } = img;
  const lumAt = (x, y) => {
    const p = (y * w + x) * 4;
    return (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
  };
  const votes = new Map();
  const vote = (c) => c && votes.set(c, (votes.get(c) || 0) + 1);
  for (let k = 0; k < rows; k++) {
    const y = Math.round(h * (0.15 + (0.7 * k) / Math.max(1, rows - 1)));
    const lum = new Float32Array(w);
    for (let x = 0; x < w; x++) lum[x] = lumAt(x, y);
    vote(decodeRow(lum));
  }
  if (!votes.size) {
    for (let k = 0; k < rows / 2; k++) {
      const x = Math.round(w * (0.2 + (0.6 * k) / Math.max(1, rows / 2 - 1)));
      const lum = new Float32Array(h);
      for (let y = 0; y < h; y++) lum[y] = lumAt(x, y);
      vote(decodeRow(lum));
    }
  }
  let best = null;
  for (const [code, n] of votes) if (!best || n > best.votes) best = { code, votes: n };
  return best;
}
