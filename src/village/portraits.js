// Портреты для диалогов деревни (обновление 0.8, люди перерисованы в 0.9): эмоции neutral, smile, grin, surprised,
// sad, blush, closed (^^). Люди — village/portrait128.js (128 × 128, с 0.12.5), звери — мордочки 64 × 64 здесь.
// Рисуется в холст один раз и кэшируется; обводка — по силуэту.

import { tint, shade, LOOKS } from './chibi.js';
import { drawPortrait128, N as NP } from './portrait128.js';

export const PW = 64;
const OUTLINE = '#1e1626';

// ---------- Звери ----------

const BEASTS = {
  cat: { fur: '#e8954c', dark: '#b8682c', light: '#fbe2c2', eye: '#5ab84a', nose: '#e88a9a', stripes: true },
  kitten: { fur: '#9aa5c9', dark: '#7280a8', light: '#e8ecf8', eye: '#4a8ad8', nose: '#f0a0b0' },
  fox: { fur: '#ec8a3a', dark: '#5a3420', light: '#fff1e0', eye: '#d89a2a', nose: '#2a2020', fox: true },
};

function beast(c, kind, expr) {
  const o = BEASTS[kind];
  const r = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
  const px = (x, y, col) => r(x, y, 1, 1, col);
  // уши
  for (const [x0, d] of [[12, 1], [40, -1]]) {
    for (let i = 0; i < 14; i++) {
      const w = Math.max(1, 13 - i);
      const xs = d > 0 ? x0 + Math.floor(i / 2) : x0 + 12 - w - Math.floor(i / 2);
      r(xs, 20 - i, w, 1, o.fox && i > 9 ? o.dark : o.fur);
      if (i < 9 && w > 5) r(xs + 3, 20 - i, w - 6, 1, '#f6b0c0');
    }
  }
  // голова
  for (let y = 14; y < 56; y++) {
    const half = Math.round(Math.sqrt(Math.max(0, 1 - ((y - 36) / 21) ** 2)) * (o.fox ? 24 : 22));
    r(32 - half, y, half * 2, 1, o.fur);
    if (half > 2) px(32 + half - 1, y, o.dark);
  }
  if (o.fox) for (let y = 38; y < 54; y++) {
    const half = Math.round(10 + (y - 38) * 0.6);
    r(32 - half - 10, y, 12, 1, o.light);
    r(32 + half - 2, y, 12, 1, o.light);
  }
  r(22, 40, 20, 14, o.light);
  if (o.stripes) for (const x of [26, 31, 36]) r(x, 15, 2, 6, o.dark);
  // глаза
  for (const x0 of [17, 37]) {
    if (expr === 'closed' || expr === 'grin') {
      for (const [dx, y] of [[0, 33], [1, 32], [2, 31], [3, 31], [4, 31], [5, 31], [6, 32], [7, 33]]) r(x0 + dx, y, 1, 2, OUTLINE);
      continue;
    }
    r(x0, 27, 9, 10, OUTLINE);
    r(x0 + 1, 28, 7, 8, o.eye);
    r(x0 + 1, 33, 7, 3, tint(o.eye, 0.35));
    r(x0 + 3, 28, 3, 8, shade(o.eye, 0.7));
    r(x0 + 1, 28, 3, 3, '#ffffff');
    px(x0 + 6, 34, '#ffffff');
  }
  // нос, рот «ω», усы
  r(30, 39, 4, 2, o.nose);
  if (expr === 'surprised') r(30, 43, 4, 3, '#7a2a3a');
  else {
    px(28, 43, '#5a3030'); px(29, 44, '#5a3030'); px(30, 43, '#5a3030'); px(31, 42, '#5a3030');
    px(32, 42, '#5a3030'); px(33, 43, '#5a3030'); px(34, 44, '#5a3030'); px(35, 43, '#5a3030');
    if (expr === 'grin' || expr === 'smile') r(30, 44, 4, 2, '#f08a9a');
  }
  for (const [x, y, d] of [[6, 38, 1], [6, 42, 1], [48, 38, -1], [48, 42, -1]]) r(x, y + (d > 0 ? 0 : 0), 10, 1, '#f4ecdc');
  if (expr === 'blush' || expr === 'smile' || expr === 'grin') {
    r(13, 41, 6, 2, '#f6a0b0');
    r(45, 41, 6, 2, '#f6a0b0');
  }
}

function blob(c, kind, expr) {
  const r = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
  const px = (x, y, col) => r(x, y, 1, 1, col);
  const cfg = {
    slime: { body: '#4cbf4a', light: '#c8ffc0', dark: '#2f8a30', top: 18, w: 26 },
    ghost: { body: '#eef2ff', light: '#ffffff', dark: '#c0c8e8', top: 10, w: 22 },
    shroom: { body: '#f4e6c8', light: '#fffaf0', dark: '#d8c49a', top: 30, w: 16 },
    spider: { body: '#5c4a78', light: '#8a78a8', dark: '#3e3254', top: 16, w: 22 },
    dragon: { body: '#4fae6a', light: '#8ad89a', dark: '#2f7a46', top: 16, w: 24 },
  }[kind];
  if (kind === 'spider') for (let i = 0; i < 4; i++) {
    r(2, 26 + i * 7, 12, 2, cfg.dark); r(50, 26 + i * 7, 12, 2, cfg.dark);
  }
  if (kind === 'dragon') {
    r(14, 6, 5, 12, '#f1e6c8'); r(45, 6, 5, 12, '#f1e6c8'); px(15, 5, '#f1e6c8'); px(48, 5, '#f1e6c8');
    r(4, 30, 8, 10, cfg.dark); r(52, 30, 8, 10, cfg.dark);
  }
  for (let y = cfg.top; y < 62; y++) {
    const k = (y - cfg.top) / (62 - cfg.top);
    const half = kind === 'ghost' ? cfg.w : Math.round(cfg.w * Math.sqrt(Math.max(0, 1 - (1 - k * 1.6) ** 2)) + (k > 0.6 ? 2 : 0));
    if (half <= 0) continue;
    r(32 - half, y, half * 2, 1, cfg.body);
    px(32 + half - 1, y, cfg.dark);
  }
  if (kind === 'ghost') for (let x = 10; x < 54; x += 8) r(x, 58, 4, 6, 'rgba(0,0,0,0)');
  if (kind === 'shroom') {
    for (let y = 2; y < 32; y++) {
      const half = Math.round(30 * Math.sqrt(Math.max(0, 1 - ((y - 30) / 28) ** 2)));
      r(32 - half, y, half * 2, 1, '#d9363a');
    }
    for (const [x, y, s] of [[18, 10, 5], [34, 6, 6], [46, 16, 4], [24, 22, 4]]) r(x, y, s, s, '#ffffff');
    r(4, 30, 56, 2, '#a8282c');
  }
  r(20, cfg.top + 6, 6, 3, cfg.light);
  // глаза
  const ey = kind === 'shroom' ? 40 : kind === 'ghost' ? 26 : 32;
  for (const x0 of kind === 'spider' ? [16, 26, 34, 44] : [20, 38]) {
    const w = kind === 'spider' ? 5 : 7;
    if (expr === 'closed' || expr === 'grin') { r(x0, ey + 3, w, 2, OUTLINE); continue; }
    r(x0, ey, w, w + 1, kind === 'ghost' ? '#2a2a44' : OUTLINE);
    r(x0 + 1, ey + 1, 2, 2, '#ffffff');
  }
  const my = ey + 11;
  if (kind === 'dragon') { r(26, my, 12, 2, '#1e2a22'); r(28, my + 2, 2, 2, '#ffffff'); }
  else if (expr === 'surprised' || kind === 'ghost') r(30, my, 4, 4, '#2a2a44');
  else if (expr === 'sad') { r(28, my + 1, 8, 1, '#2a2a2a'); px(27, my + 2, '#2a2a2a'); px(36, my + 2, '#2a2a2a'); }
  else { r(28, my, 8, 1, '#2a2a2a'); px(27, my - 1, '#2a2a2a'); px(36, my - 1, '#2a2a2a'); if (expr === 'grin' || expr === 'smile') r(29, my + 1, 6, 2, '#f08a9a'); }
  if (expr !== 'sad') { r(14, ey + 9, 5, 2, '#f6a0b0'); r(45, ey + 9, 5, 2, '#f6a0b0'); }
}

// ---------- Кэш ----------

const cache = new Map();

/** Холст портрета 64 × 64 (с обводкой). who: { kind, look? }, expr — эмоция. */
export function portrait(who, expr = 'neutral') {
  const look = who.look || LOOKS[who.kind] || null;
  const key = `${who.kind}|${look ? JSON.stringify(look) : ''}|${expr}`;
  let cv = cache.get(key);
  if (cv) return cv;
  if (cache.size > 120) cache.clear();
  if (look) {
    // 0.12.5: люди — портрет 128 × 128 вполоборота (village/portrait128.js), обводка уже внутри
    cv = document.createElement('canvas');
    cv.width = NP;
    cv.height = NP;
    drawPortrait128(cv.getContext('2d'), look, expr);
    cache.set(key, cv);
    return cv;
  }
  const base = document.createElement('canvas');
  base.width = PW;
  base.height = PW;
  const c = base.getContext('2d');
  if (BEASTS[who.kind]) beast(c, who.kind, expr);
  else blob(c, ['slime', 'ghost', 'shroom', 'spider', 'dragon'].includes(who.kind) ? who.kind : 'slime', expr);
  cv = document.createElement('canvas');
  cv.width = PW;
  cv.height = PW;
  const o = cv.getContext('2d');
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) o.drawImage(base, dx, dy);
  o.globalCompositeOperation = 'source-in';
  o.fillStyle = OUTLINE;
  o.fillRect(0, 0, PW, PW);
  o.globalCompositeOperation = 'source-over';
  o.drawImage(base, 0, 0);
  cache.set(key, cv);
  return cv;
}
