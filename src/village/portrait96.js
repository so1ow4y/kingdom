// Портрет человека для разговора (обновление 0.9): 96 × 96, мягкая пастельная палитра, цветная обводка по силуэту,
// волосы из изогнутых прядей (кривые Безье с утончением: тень по краям пряди, светлая сторона, блик-«нимб»),
// большие глаза с градиентом радужки, вытянутым зрачком, двумя бликами и толстыми ресницами с «крылышком».
// Рисуется в буфер цветов с «материалами» (кожа, волосы, ткань…), затем обводка и тени по материалам.

import { mix, shade, tint } from './chibi.js';

export const N = 96;
const CX = 48;

/** Ступени цвета: o — обводка, d2, d1 — тени (с уходом в фиолетовый), b — основа, l1, l2 — свет (с уходом в тёплый). */
function ramp(base, skin = false) {
  if (skin) {
    return {
      o: mix(base, '#8a4a52', 0.62), d2: mix(base, '#d07a80', 0.5), d1: mix(base, '#f0a8a0', 0.36), b: base,
      l1: mix(base, '#fff6ee', 0.5), l2: '#fffaf6',
    };
  }
  return {
    o: mix(shade(base, 0.6), '#24163a', 0.35), d2: mix(shade(base, 0.38), '#3a2a6a', 0.22), d1: mix(shade(base, 0.17), '#5a3a8a', 0.12),
    b: base, l1: mix(tint(base, 0.24), '#fff2d8', 0.12), l2: mix(tint(base, 0.55), '#fffaf0', 0.28),
  };
}
const LV = ['o', 'd2', 'd1', 'b', 'l1', 'l2'];

// материалы
const M_SKIN = 1;
const M_HAIR = 2;
const M_CLOTH = 3;
const M_OTHER = 4;

class Buf {
  constructor() {
    this.col = new Array(N * N).fill(null);
    this.mat = new Uint8Array(N * N);
    this.rmp = new Array(N * N).fill(null);
  }

  set(x, y, col, mat = M_OTHER, rmp = null) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= N || y >= N || !col) return;
    const i = y * N + x;
    this.col[i] = col;
    this.mat[i] = mat;
    this.rmp[i] = rmp;
  }

  m(x, y) {
    return x < 0 || y < 0 || x >= N || y >= N ? 0 : this.mat[y * N + x];
  }

  /** Залить пиксели, где test(x + .5, y + .5); color(x, y) → цвет. */
  fill(x0, y0, x1, y1, test, color, mat = M_OTHER, rmp = null) {
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(N - 1, Math.ceil(y1)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(N - 1, Math.ceil(x1)); x++) {
        if (test(x + 0.5, y + 0.5)) this.set(x, y, typeof color === 'function' ? color(x, y) : color, mat, rmp);
      }
    }
  }

  ellipse(cx, cy, rx, ry, color, mat = M_OTHER, rmp = null) {
    this.fill(cx - rx, cy - ry, cx + rx, cy + ry, (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1, color, mat, rmp);
  }

  poly(pts, color, mat = M_OTHER, rmp = null) {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    this.fill(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), (x, y) => inPoly(pts, x, y), color, mat, rmp);
  }

  /**
   * Прядь: квадратичная кривая p0 → p2 (через управляющую p1), ширина w0 у корня → w1 у кончика.
   * paint(u, t, x, y) → цвет; u — смещение поперёк пряди (−1 … 1), t — вдоль (0 у корня … 1 у кончика).
   */
  strand(p0, p1, p2, w0, w1, paint, mat, rmp) {
    const best = new Map();
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const steps = Math.max(12, Math.ceil(len * 2.5));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const a = (1 - t) * (1 - t);
      const b = 2 * (1 - t) * t;
      const c = t * t;
      const x = a * p0[0] + b * p1[0] + c * p2[0];
      const y = a * p0[1] + b * p1[1] + c * p2[1];
      const tx = 2 * (1 - t) * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]);
      const ty = 2 * (1 - t) * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]);
      const tl = Math.hypot(tx, ty) || 1;
      const nx = -ty / tl;
      const ny = tx / tl;
      const r = w0 + (w1 - w0) * t;
      for (let py = Math.floor(y - r - 1); py <= Math.ceil(y + r + 1); py++) {
        for (let px = Math.floor(x - r - 1); px <= Math.ceil(x + r + 1); px++) {
          if (px < 0 || py < 0 || px >= N || py >= N) continue;
          const dx = px + 0.5 - x;
          const dy = py + 0.5 - y;
          const d = Math.hypot(dx, dy);
          if (d > r) continue;
          const i = py * N + px;
          const u = (dx * nx + dy * ny) / Math.max(0.5, r);
          const prev = best.get(i);
          if (!prev || d / r < prev.k) best.set(i, { k: d / r, u, t });
        }
      }
    }
    for (const [i, v] of best) this.set(i % N, (i / N) | 0, paint(v.u, v.t, i % N, (i / N) | 0), mat, rmp);
  }
}

function inPoly(pts, x, y) {
  let ins = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}

/** Полуширина лица в строке y: скулы, мягкий острый подбородок (лицо 22…70). */
function faceHalf(y) {
  if (y < 22 || y > 70) return -1;
  if (y <= 52) return Math.min(21, Math.sqrt(Math.max(0, 22.5 ** 2 - (y - 41) ** 2)));
  return 21 * ((70 - y) / 18) ** 0.62;
}

/** Нарисовать портрет человека look с эмоцией expr в 2D-контекст c (96 × 96). */
export function drawPortrait96(c, o, expr = 'neutral') {
  const B = new Buf();
  const H = ramp(o.hair || '#4a2f2a');
  const S = ramp(o.skin || '#ffe3cf', true);
  const C = ramp(o.armor ? '#aab3bd' : o.top || '#5c6bc0');
  const E = { b: o.eyes || '#3f6fd0', d: shade(o.eyes || '#3f6fd0', 0.48), m: shade(o.eyes || '#3f6fd0', 0.18), l: tint(o.eyes || '#3f6fd0', 0.38), ll: tint(o.eyes || '#3f6fd0', 0.68), p: shade(o.eyes || '#3f6fd0', 0.78) };
  const accent = o.accent || (o.gender === 'm' ? '#3a4a8a' : '#e0506e');
  const style = o.style || 'bob';
  const short = style === 'short' || style === 'spiky' || style === 'messy';
  const helmet = o.hat === 'helmetK';
  const hood = o.hat === 'hood';
  const part = (o.gender === 'm' ? -5 : 4) * (style === 'side' ? 1.6 : 1);
  const crown = [CX + part, 11];
  const ringY = (x) => 27 + ((x - CX) / 22) ** 2 * 8;
  const hairPaint = (dark = 0) => (u, t, x, y) => {
    let lv = 3;
    if (u < -0.4) lv = 4;
    if (Math.abs(u) > 0.7) lv = 2;
    if (Math.abs(u) > 0.9) lv = 1;
    if (t > 0.84 && lv > 2) lv = 2;
    if (Math.abs(y + 0.5 - ringY(x)) < 1.5 && Math.abs(u) < 0.62 && t < 0.7) lv = 5;
    return H[LV[Math.max(1, lv - dark)]];
  };

  // ---- волосы сзади ----
  if (!helmet && !hood) {
    const bottom = style === 'long' || style === 'side' ? 100 : style === 'bob' ? 74 : style === 'twintails' || style === 'ponytail' || style === 'bun' ? 62 : 58;
    const halfW = short ? 25 : 28;
    B.fill(CX - 32, 8, CX + 32, Math.min(95, bottom), (x, y) => {
      if (y < 40) return ((x - CX) / (halfW + 1)) ** 2 + ((y - 40) / 30) ** 2 <= 1;
      const w = halfW - Math.max(0, y - (bottom - 10)) * 0.9 + (style === 'long' ? (y - 40) * 0.08 : 0);
      const tip = Math.abs(((x * 0.9) % 6) - 3) * 1.4; // зубчики кончиков
      return Math.abs(x - CX) <= w && y <= bottom - tip;
    }, (x, y) => {
      const k = Math.abs(x - CX) / halfW;
      return (x + Math.floor(y / 9)) % 7 === 0 ? H.d2 : k > 0.82 ? H.d2 : y > 60 ? H.d2 : H.d1;
    }, M_HAIR, H);
    if (style === 'twintails') {
      for (const s of [-1, 1]) {
        B.strand([CX + s * 22, 26], [CX + s * 40, 52], [CX + s * 34, 96], 8, 3, hairPaint(1), M_HAIR, H);
        B.strand([CX + s * 24, 30], [CX + s * 36, 58], [CX + s * 40, 92], 5, 2, hairPaint(0), M_HAIR, H);
      }
    } else if (style === 'ponytail') {
      B.strand([CX + 16, 16], [CX + 40, 30], [CX + 34, 88], 8, 2.5, hairPaint(1), M_HAIR, H);
    } else if (style === 'side') {
      B.strand([CX + 20, 40], [CX + 34, 60], [CX + 30, 96], 7, 3, hairPaint(1), M_HAIR, H);
    } else if (style === 'bun') {
      for (const s of [-1, 1]) B.ellipse(CX + s * 17, 13, 8, 7.5, (x, y) => (y < 10 ? H.l1 : (x + y) % 5 === 0 ? H.d1 : H.b), M_HAIR, H);
    }
  }
  if (o.tail) B.strand([CX + 20, 96], [CX + 40, 80], [CX + 38, 64], 4, 2, () => H.b, M_HAIR, H);

  // ---- плащ, одежда, шея ----
  if (o.stage >= 3 || o.cape) {
    const cape = ramp(o.cape || shade(o.top || '#5c6bc0', 0.45));
    B.poly([[CX - 30, 82], [CX + 30, 82], [CX + 48, 96], [CX - 48, 96]], (x) => (x > CX + 20 ? cape.d1 : cape.b), M_CLOTH, cape);
  }
  B.fill(CX - 48, 76, CX + 48, 95, (x, y) => Math.abs(x + 0.5 - CX) <= Math.min(44, 11 + (y - 76) * 2.1), (x, y) => {
    const k = (x - CX) / Math.min(44, 11 + (y - 76) * 2.1);
    return k > 0.6 ? C.d1 : k < -0.75 ? C.l1 : (x - CX + 60) % 23 === 0 && y > 86 ? C.d1 : C.b;
  }, M_CLOTH, C);
  // шея
  B.fill(CX - 7, 60, CX + 7, 80, (x, y) => Math.abs(x + 0.5 - CX) <= 6.2 - (y > 74 ? (y - 74) * -0.3 : 0), (x, y) => (y < 68 ? S.d1 : x > CX + 3 ? S.d1 : S.b), M_SKIN, S);
  if (o.armor) {
    B.fill(CX - 30, 80, CX + 30, 82, () => true, '#dfe6ee', M_CLOTH, C);
  } else {
    // матросский воротник и бант (или галстук, фартук, комбинезон, жилет)
    for (const s of [-1, 1]) B.poly([[CX + s * 3, 78], [CX + s * 15, 76], [CX + s * 22, 88], [CX + s * 4, 90]], (x, y) => ((x + y) % 13 === 0 ? '#e6e0d8' : '#fbf8f2'), M_OTHER);
    B.fill(CX - 22, 84, CX + 22, 86, (x, y) => y >= 85 && Math.abs(x + 0.5 - CX) >= 6 && Math.abs(x + 0.5 - CX) <= 20 && Math.abs(x + 0.5 - CX) >= (y - 76) * 0.5, accent, M_OTHER);
    if (o.tie) B.poly([[CX - 2, 80], [CX + 2, 80], [CX + 3, 95], [CX, 96], [CX - 3, 95]], '#2a2a3a', M_OTHER);
    else {
      const A = ramp(accent);
      B.ellipse(CX - 6, 84, 5.5, 3.5, (x) => (x < CX - 8 ? A.l1 : A.b), M_OTHER, A);
      B.ellipse(CX + 6, 84, 5.5, 3.5, (x) => (x > CX + 8 ? A.d1 : A.b), M_OTHER, A);
      B.ellipse(CX, 84, 2.5, 2.5, A.d1, M_OTHER, A);
      B.poly([[CX - 3, 85], [CX - 1, 85], [CX - 4, 95], [CX - 7, 94]], A.b, M_OTHER, A);
      B.poly([[CX + 1, 85], [CX + 3, 85], [CX + 7, 94], [CX + 4, 95]], A.d1, M_OTHER, A);
    }
    if (o.apron) for (const s of [-1, 1]) B.fill(CX + s * 17 - 2, 82, CX + s * 17 + 2, 95, () => true, '#fbf8f2');
    if (o.overalls) for (const s of [-1, 1]) B.fill(CX + s * 15 - 2, 82, CX + s * 15 + 2, 95, () => true, o.pants || '#3a4a66');
    if (o.vest) for (const s of [-1, 1]) B.poly([[CX + s * 10, 82], [CX + s * 30, 84], [CX + s * 38, 95], [CX + s * 12, 95]], o.vest);
  }

  // ---- лицо и уши ----
  B.fill(CX - 22, 22, CX + 22, 70, (x, y) => Math.abs(x - CX) <= faceHalf(y), (x, y) => {
    const h = faceHalf(y + 0.5);
    const k = (x + 0.5 - CX) / Math.max(1, h);
    if (y > 54 && k > 0.55) return S.d1; // тень на дальней щеке и подбородке
    if (k > 0.86 && y > 30) return S.d1;
    return S.b;
  }, M_SKIN, S);
  if (short && !helmet && !hood) {
    for (const s of [-1, 1]) B.ellipse(CX + s * 22, 52, 2.6, 4.5, (x) => ((x - CX) * s > 22.5 ? S.d1 : S.b), M_SKIN, S);
  }

  // ---- глаза ----
  const closed = expr === 'closed' || expr === 'grin';
  const sad = expr === 'sad';
  const sur = expr === 'surprised';
  const EY = 52;
  for (const [ecx, s] of [[CX - 10.5, -1], [CX + 10.5, 1]]) {
    if (closed) {
      for (let x = -6.5; x <= 6.5; x += 0.25) {
        const dx = x / 6.5;
        const y = EY + 1 - (1 - dx * dx) * 2.8;
        B.set(ecx + x, y, S.o, M_OTHER);
        B.set(ecx + x, y + 0.9, S.o, M_OTHER);
      }
      continue;
    }
    const EW = 7;
    const ix = ecx - s * 0.6;
    const iy = EY + 0.8 + (sad ? 0.6 : 0);
    const ir = sur ? 4.4 : 5.3;
    B.fill(ecx - EW - 2, EY - 9, ecx + EW + 2, EY + 8, (x, y) => {
      const dx = (x - ecx) / EW;
      if (Math.abs(dx) > 1.02) return false;
      const top = EY - 5.2 + dx * dx * 2.3 + (sad ? 0.8 + dx * s * 0.8 : 0);
      const bot = EY + 5.6 - dx * dx * 2.6;
      return y > top - 2.3 && y < bot + 1;
    }, (x, y) => {
      const xx = x + 0.5;
      const yy = y + 0.5;
      const dx = (xx - ecx) / EW;
      const outer = dx * s;
      const top = EY - 5.2 + dx * dx * 2.3 + (sad ? 0.8 + dx * s * 0.8 : 0);
      const bot = EY + 5.6 - dx * dx * 2.6;
      if (yy < top + 0.4 || (outer > 0.45 && yy < top + 1.2)) return '#2a1830'; // ресницы
      if (yy > bot) return Math.abs(dx) > 0.2 && Math.abs(dx) < 0.85 ? S.d2 : S.b; // нижнее веко
      const d = Math.hypot(xx - ix, yy - iy);
      if (d <= ir) {
        if (Math.abs(xx - ix) <= 1.5 && yy > iy - 2.8 && yy < iy + 2.2) return E.p;
        if (d > ir - 0.9) return E.d;
        const k = (yy - (iy - ir)) / (2 * ir);
        return k < 0.28 ? E.d : k < 0.5 ? E.m : k < 0.74 ? E.b : k < 0.88 ? E.l : E.ll;
      }
      return yy < top + 1.6 ? '#e8dce4' : '#fbf6f4';
    }, M_OTHER);
    // крылышко ресниц, блики
    B.set(ecx + s * (EW + 0.6), EY - 4.6, '#2a1830');
    B.set(ecx + s * (EW + 1.6), EY - 5.6, '#2a1830');
    B.set(ecx + s * (EW + 0.6), EY - 3.6, '#2a1830');
    B.ellipse(ix - 1.8, iy - 2.4, 1.4, 1.2, '#ffffff');
    B.set(ix + 2.1, iy + 2.2, '#ffffff');
    B.set(ix + 2.6, iy - 1.8, E.ll);
    if (sad) for (let i = 0; i < 7; i++) B.set(ecx - s * 3 + s * i, 41 + i * 0.45, H.d2, M_OTHER); // брови домиком
  }

  // ---- румянец, нос, рот ----
  const blush = expr === 'blush' || expr === 'smile' || expr === 'grin' || expr === 'closed' || o.blush;
  if (blush) {
    for (const s of [-1, 1]) {
      B.ellipse(CX + s * 13.5, 60, 4.6, 1.6, mix(S.b, '#ff8aa0', expr === 'blush' ? 0.55 : 0.32), M_SKIN, S);
      if (expr === 'blush') for (let i = -1; i <= 1; i++) B.set(CX + s * 13.5 + i * 2.5, 59, mix(S.b, '#ff6080', 0.6), M_SKIN, S);
    }
  }
  B.set(CX + 1, 59, S.d2, M_SKIN, S);
  B.set(CX + 1, 60, S.d1, M_SKIN, S);
  const mouth = { neutral: 'line', smile: 'smile', grin: 'open', surprised: 'o', sad: 'down', blush: 'small', closed: 'smile' }[expr] || 'line';
  const MO = '#a0505a';
  if (o.ears && mouth !== 'o' && mouth !== 'down') {
    for (const [x, y] of [[CX - 4, 64], [CX - 3, 65], [CX - 2, 64], [CX - 1, 64], [CX, 65], [CX + 1, 64]]) B.set(x, y, MO);
  } else if (mouth === 'line') for (let x = -2; x <= 1; x++) B.set(CX + x, 65, mix(S.b, MO, 0.75));
  else if (mouth === 'small') for (let x = -1; x <= 0; x++) B.set(CX + x, 65, mix(S.b, MO, 0.75));
  else if (mouth === 'smile') {
    for (let x = -2; x <= 1; x++) B.set(CX + x, 65, MO);
    B.set(CX - 3, 64, MO);
    B.set(CX + 2, 64, MO);
  } else if (mouth === 'open') {
    B.fill(CX - 4, 63, CX + 3, 67, (x, y) => ((x - (CX - 0.5)) / 3.6) ** 2 + ((y - 64.6) / 2.4) ** 2 <= 1 && y > 63, (x, y) => (y > 65.4 ? '#f08a9a' : '#a83a4a'));
    for (let x = -3; x <= 2; x++) B.set(CX + x, 63, '#7a2a3a');
  } else if (mouth === 'o') B.ellipse(CX - 0.5, 65, 1.6, 2, '#7a2a3a');
  else if (mouth === 'down') {
    for (let x = -2; x <= 1; x++) B.set(CX + x, 65, MO);
    B.set(CX - 3, 66, MO);
    B.set(CX + 2, 66, MO);
  }

  // ---- волосы спереди: купол, пряди у лица, чёлка ----
  if (!helmet && !hood) {
    const P = hairPaint(0);
    const cap = [[19, 46], [21, 34], [27, 24], [36, 17], [48, 15], [60, 17], [69, 24], [75, 34], [77, 46]];
    for (const [x, y] of cap) {
      const mx = (crown[0] + x) / 2 + (x - CX) * 0.32;
      const my = (crown[1] + y) / 2 - 3;
      B.strand(crown, [mx, my], [x, y], 8, 4, P, M_HAIR, H);
    }
    // пряди по бокам лица
    const sideTip = short ? 50 : style === 'bob' ? 72 : style === 'long' || style === 'side' ? 84 : 66;
    for (const s of [-1, 1]) {
      B.strand([CX + s * 18, 24], [CX + s * 28, 44], [CX + s * 24, sideTip], 6, 1.2, P, M_HAIR, H);
      B.strand([CX + s * 15, 28], [CX + s * 23, 46], [CX + s * 20, sideTip - 8], 4.2, 0.8, P, M_HAIR, H);
    }
    // чёлка: острые пряди, над глазами короче
    const tips = short
      ? [[30, 44], [35, 41], [41, 45], [47, 42], [53, 46], [59, 41], [64, 44], [68, 47]]
      : [[28, 49], [33, 45], [38, 43], [43, 47], [48, 44], [53, 47], [58, 43], [63, 45], [68, 49]];
    const sweep = o.gender === 'm' ? -2.5 : 2;
    for (const [tx, ty] of tips) {
      const rx = tx * 0.55 + crown[0] * 0.45;
      const ctrl = [rx + (tx - rx) * 0.5 + sweep, (16 + ty) / 2 - 3];
      B.strand([rx, 16], ctrl, [tx, ty], 4.4, 0.55, P, M_HAIR, H);
    }
    if (style === 'spiky') for (const [x, y] of [[30, 6], [42, 2], [56, 3], [66, 8]]) B.strand(crown, [(crown[0] + x) / 2, crown[1] - 2], [x, y], 4, 0.8, P, M_HAIR, H);
    if (style === 'messy') for (const [x, y] of [[34, 7], [60, 6]]) B.strand(crown, [(crown[0] + x) / 2, crown[1] - 3], [x, y], 3.5, 0.8, P, M_HAIR, H);
    // заколка у девочек без шапки (как «крестик»)
    if (!o.hat && o.gender === 'f') {
      for (let i = -2; i <= 2; i++) {
        B.set(CX - 16 + i, 35 + i, accent);
        B.set(CX - 16 + i, 35 - i, tint(accent, 0.4));
      }
    }
    if (o.stage >= 4) {
      B.fill(CX - 20, 33, CX + 20, 35, (x, y) => y >= 33.5 && y <= 34.8 && Math.abs(x - CX) <= 19 - (y - 33) * 0, '#f0c850');
      B.ellipse(CX, 33.5, 2.2, 2.2, '#7ad0ff');
    }
  }
  if (o.ears) {
    for (const s of [-1, 1]) {
      B.poly([[CX + s * 9, 16], [CX + s * 25, 0], [CX + s * 22, 22]], H.b, M_HAIR, H);
      B.poly([[CX + s * 12, 15], [CX + s * 22, 5], [CX + s * 20, 18]], '#f6b0c8', M_OTHER);
    }
  }
  hat96(B, o, H, accent);
  if (o.glasses) {
    const g = '#3a3448';
    for (const s of [-1, 1]) {
      const x0 = CX + s * 10.5;
      B.fill(x0 - 9, 44, x0 + 9, 61, (x, y) => {
        const k = ((x - x0) / 8.6) ** 2 + ((y - 52.5) / 7.6) ** 2;
        return k <= 1 && k >= 0.78;
      }, g);
    }
    B.fill(CX - 2, 50, CX + 2, 51, () => true, g);
  }

  // ---- тени и обводка по материалам ----
  const col = B.col.slice();
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (!B.col[i]) continue;
      const m = B.mat[i];
      const R = B.rmp[i];
      // тень от чёлки на лбу
      if (m === M_SKIN && (B.m(x, y - 1) === M_HAIR || B.m(x, y - 2) === M_HAIR) && R) col[i] = R.d1;
      // нижний край прядей над лицом — тонкая тёмная линия
      if (m === M_HAIR && B.m(x, y + 1) === M_SKIN && R) col[i] = R.o;
      // ткань под шеей — линия
      if (m === M_CLOTH && B.m(x, y - 1) === M_SKIN && R) col[i] = R.d2;
      // контур по силуэту — цветной (темнее своего цвета)
      if (!B.col[i - 1] || !B.col[i + 1] || !B.col[i - N] || !B.col[i + N] || x === 0 || x === N - 1) {
        col[i] = R ? R.o : mix(shade(B.col[i], 0.55), '#24163a', 0.3);
      }
    }
  }
  const img = c.createImageData(N, N);
  for (let i = 0; i < N * N; i++) {
    const v = col[i];
    if (!v) continue;
    const h = v.replace('#', '');
    img.data[i * 4] = parseInt(h.slice(0, 2), 16);
    img.data[i * 4 + 1] = parseInt(h.slice(2, 4), 16);
    img.data[i * 4 + 2] = parseInt(h.slice(4, 6), 16);
    img.data[i * 4 + 3] = 255;
  }
  c.putImageData(img, 0, 0);
}

/** Головные уборы и аксессуары портрета. */
function hat96(B, o, H, accent) {
  const h = o.hat;
  if (!h) return;
  const A = ramp(accent);
  if (h === 'bow') {
    const bx = CX + 19;
    B.ellipse(bx - 6, 14, 6.5, 5, (x) => (x < bx - 9 ? A.l1 : A.b), M_OTHER, A);
    B.ellipse(bx + 6, 14, 6.5, 5, (x) => (x > bx + 9 ? A.d1 : A.b), M_OTHER, A);
    B.ellipse(bx, 14.5, 2.6, 3, A.d1, M_OTHER, A);
    B.poly([[bx - 2, 16], [bx, 16], [bx - 5, 26], [bx - 8, 24]], A.b, M_OTHER, A);
    B.poly([[bx, 16], [bx + 2, 16], [bx + 7, 24], [bx + 4, 26]], A.d1, M_OTHER, A);
    B.ellipse(bx - 8, 12, 1.6, 1.2, A.l2, M_OTHER, A);
  } else if (h === 'gradcap') {
    const G = ramp('#34344a');
    B.poly([[CX - 30, 10], [CX, 0], [CX + 30, 10], [CX, 20]], (x, y) => (y < 10 ? G.l1 : G.b), M_OTHER, G);
    B.fill(CX - 17, 14, CX + 17, 22, (x, y) => Math.abs(x - CX) <= 16 && y >= 15, G.d1, M_OTHER, G);
    B.strand([CX, 10], [CX + 20, 10], [CX + 27, 26], 0.8, 0.8, () => '#f0c850', M_OTHER, null);
    B.ellipse(CX + 27, 27, 2, 3, '#f0c850');
  } else if (h === 'bandana') {
    const K = ramp('#d8404a');
    B.fill(CX - 26, 6, CX + 26, 26, (x, y) => ((x - CX) / 26) ** 2 + ((y - 24) / 18) ** 2 <= 1 && y < 25, (x, y) => ((x * 3 + y * 5) % 17 === 0 ? '#ffffff' : y > 21 ? K.d1 : K.b), M_OTHER, K);
    B.poly([[CX - 26, 20], [CX - 36, 28], [CX - 30, 30], [CX - 22, 24]], K.d1, M_OTHER, K);
  } else if (h === 'beret') {
    B.ellipse(CX - 2, 12, 28, 9, (x, y) => (y < 9 ? A.l1 : y > 15 ? A.d1 : A.b), M_OTHER, A);
    B.fill(CX - 1, 1, CX + 1, 4, () => true, A.d2, M_OTHER, A);
  } else if (h === 'headphones') {
    const D = ramp('#3a3a48');
    B.strand([CX - 26, 40], [CX, -14], [CX + 26, 40], 2.2, 2.2, () => D.b, M_OTHER, D);
    for (const s of [-1, 1]) {
      B.ellipse(CX + s * 26, 46, 6, 9, (x) => ((x - CX) * s > 28 ? A.d1 : A.b), M_OTHER, A);
      B.ellipse(CX + s * 25, 43, 2, 3, A.l2, M_OTHER, A);
    }
  } else if (h === 'headband') {
    B.fill(CX - 24, 31, CX + 24, 35, (x, y) => Math.abs(x - CX) <= 23, (x, y) => (y < 33 ? '#ffffff' : A.b), M_OTHER, A);
    B.poly([[CX - 23, 32], [CX - 34, 38], [CX - 31, 41], [CX - 22, 35]], '#f4f4f4');
  } else if (h === 'nursecap') {
    B.poly([[CX - 14, 12], [CX + 14, 12], [CX + 10, 2], [CX - 10, 2]], '#ffffff');
    B.fill(CX - 1.5, 3, CX + 1.5, 10, () => true, '#e04a5a');
    B.fill(CX - 4, 5.5, CX + 4, 7.5, () => true, '#e04a5a');
  } else if (h === 'straw') {
    const W = ramp('#e8c46a');
    B.ellipse(CX, 22, 44, 7, (x, y) => (y < 21 ? W.l1 : W.d1), M_OTHER, W);
    B.fill(CX - 18, 2, CX + 18, 21, (x, y) => Math.abs(x - CX) <= 17 - (21 - y) * 0.2, (x, y) => (y > 15 && y < 19 ? '#d84a3a' : (x + y) % 4 === 0 ? W.d1 : W.b), M_OTHER, W);
  } else if (h === 'helmet' || h === 'hardhat') {
    const Y = ramp(h === 'helmet' ? '#f2c230' : '#ff9a2a');
    B.ellipse(CX, 22, 27, 20, (x, y) => (y > 22 ? null : x < CX - 12 ? Y.l1 : x > CX + 16 ? Y.d1 : Y.b), M_OTHER, Y);
    B.fill(CX - 32, 21, CX + 32, 25, (x, y) => Math.abs(x - CX) <= 31, Y.d1, M_OTHER, Y);
    if (h === 'helmet') {
      B.ellipse(CX + 4, 12, 6, 5, '#fff2b0');
      B.ellipse(CX + 4, 12, 3.5, 3, '#ffffff');
    } else B.fill(CX - 2, 2, CX + 2, 21, () => true, Y.l1, M_OTHER, Y);
  } else if (h === 'hood') {
    const G = ramp(o.hood || '#2f6a2c');
    B.fill(CX - 34, 4, CX + 34, 95, (x, y) => {
      const outer = y < 44 ? ((x - CX) / 32) ** 2 + ((y - 44) / 40) ** 2 <= 1 : Math.abs(x - CX) <= 32 - (y - 44) * 0.05;
      const inner = faceHalf(y) > 0 ? Math.abs(x - CX) <= faceHalf(y) + 1.5 && y > 26 : false;
      return outer && !inner && y < 82;
    }, (x, y) => (x > CX + 22 ? G.d1 : x < CX - 26 ? G.l1 : G.b), M_OTHER, G);
    // чёлка из-под капюшона
    for (const [tx, ty] of [[36, 42], [42, 45], [48, 42], [54, 45], [60, 42]]) B.strand([tx + (CX - tx) * 0.3, 26], [tx, 32], [tx, ty], 4, 0.6, (u) => (Math.abs(u) > 0.7 ? H.d1 : H.b), M_HAIR, H);
  } else if (h === 'witch') {
    const W = ramp('#3b2560');
    B.ellipse(CX, 20, 46, 6.5, (x, y) => (y < 19 ? W.l1 : W.d1), M_OTHER, W);
    B.poly([[CX - 22, 18], [CX + 22, 18], [CX + 8, -2], [CX + 22, -6], [CX - 2, -4]], (x, y) => (x > CX + 8 ? W.d1 : W.b), M_OTHER, W);
    B.fill(CX - 21, 13, CX + 21, 17, (x, y) => Math.abs(x - CX) <= 21 - (17 - y) * 0.8, '#c9a24a');
    B.ellipse(CX, 15, 2.5, 2, '#f2d860');
  } else if (h === 'helmetK') {
    const K = ramp('#b9c2cc');
    B.fill(CX - 30, 0, CX + 30, 82, (x, y) => {
      const outer = y < 46 ? ((x - CX) / 29) ** 2 + ((y - 46) / 44) ** 2 <= 1 : Math.abs(x - CX) <= 29;
      const inner = y > 30 && y < 72 && Math.abs(x - CX) <= Math.max(0, faceHalf(Math.min(y, 52)) - 1);
      return outer && !inner;
    }, (x, y) => (x > CX + 20 ? K.d1 : x < CX - 22 ? K.l1 : y > 28 && y < 31 ? K.d1 : K.b), M_OTHER, K);
    B.strand([CX, 4], [CX + 6, -8], [CX + 20, -6], 4, 2, () => o.plume || '#d84040', M_OTHER, null);
    for (const [tx, ty] of [[38, 40], [44, 43], [50, 40], [56, 43]]) B.strand([tx, 31], [tx + 1, 35], [tx, ty], 3.4, 0.6, (u) => (Math.abs(u) > 0.7 ? H.d1 : H.b), M_HAIR, H);
  }
}
