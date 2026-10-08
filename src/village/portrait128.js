// Портрет человека для разговора (обновление 0.12.5, вместо 96 × 96 из 0.9): 128 × 128, лицо вполоборота (в три
// четверти, смотрит вправо — на текст реплики), крупные глаза почти в середине лица, широкие скулы и короткий
// подбородок; волосы — прядями-«клочками» с бликом-нимбом, чёлка до бровей, пряди у лица; короткая шея и плечи
// с одеждой. Рисуется в буфер цветов с «материалами» (кожа, волосы, ткань…), затем тени и цветная обводка.
// Персонажи свои (не копии), одежда закрытая.

import { mix, shade, tint } from './chibi.js';

export const N = 128;
const HX = 64; // центр головы
const MX = 68; // средняя линия лица (повёрнуто вправо)
const EY = 67; // линия глаз

/** Ступени цвета: o — обводка, d2, d1 — тени (с уходом в фиолетовый), b — основа, l1, l2 — свет (с уходом в тёплый). */
function ramp(base, skin = false) {
  if (skin) {
    return {
      o: mix(base, '#7a3a4a', 0.66), d2: mix(base, '#c8707a', 0.48), d1: mix(base, '#eea2a0', 0.34), b: base,
      l1: mix(base, '#fff6ee', 0.45), l2: '#fffaf6',
    };
  }
  return {
    o: mix(shade(base, 0.62), '#22142f', 0.38), d2: mix(shade(base, 0.4), '#3a2a6a', 0.22), d1: mix(shade(base, 0.18), '#5a3a8a', 0.12),
    b: base, l1: mix(tint(base, 0.24), '#fff2d8', 0.12), l2: mix(tint(base, 0.58), '#fffaf0', 0.3),
  };
}
const LV = ['o', 'd2', 'd1', 'b', 'l1', 'l2'];

const M_SKIN = 1;
const M_HAIR = 2;
const M_CLOTH = 3;
const M_OTHER = 4;
const M_EYE = 5;

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

  /** Прядь: квадратичная кривая p0 → p2 через p1, ширина w0 → w1; paint(u, t, x, y) — u поперёк (−1…1), t вдоль (0…1). */
  strand(p0, p1, p2, w0, w1, paint, mat, rmp) {
    const best = new Map();
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const steps = Math.max(14, Math.ceil(len * 2.5));
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
      const r = w0 + (w1 - w0) * t ** 1.15;
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

  /** Линия толщиной w (для ресниц, рта, бровей). */
  line(pts, w, col, mat = M_OTHER) {
    for (let k = 1; k < pts.length; k++) {
      const [x0, y0] = pts[k - 1];
      const [x1, y1] = pts[k];
      const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 3));
      for (let s = 0; s <= n; s++) {
        const x = x0 + ((x1 - x0) * s) / n;
        const y = y0 + ((y1 - y0) * s) / n;
        if (w <= 1) this.set(x, y, col, mat);
        else this.fill(x - w / 2, y - w / 2, x + w / 2, y + w / 2, (px, py) => Math.hypot(px - x, py - y) <= w / 2, col, mat);
      }
    }
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

// Лицо вполоборота: ближняя (левая) щека круглая, дальняя — со скулой и прямой линией челюсти, подбородок правее центра.
const FACE = [
  [33, 30], [32, 46], [32, 58], [34, 68], [37, 77], [43, 85], [51, 92], [60, 97], [67, 98.5],
  [73, 96.5], [80, 91], [86, 83], [90, 74], [92.5, 64], [93.5, 52], [93, 30],
];
const faceIn = (x, y) => inPoly(FACE, x, y);
/** Левый и правый край лица в строке y (для теней). */
function faceSpan(y) {
  let l = null;
  let r = null;
  for (let x = 20; x < 110; x += 0.5) {
    if (faceIn(x, y)) {
      if (l == null) l = x;
      r = x;
    }
  }
  return l == null ? null : [l, r];
}

/** Нарисовать портрет человека look с эмоцией expr в 2D-контекст c (128 × 128). */
export function drawPortrait128(c, o, expr = 'neutral') {
  const B = new Buf();
  const H = ramp(o.hair || '#4a2f2a');
  const S = ramp(o.skin || '#ffe3cf', true);
  const C = ramp(o.armor ? '#aab3bd' : o.top || '#5c6bc0');
  const eyeBase = o.eyes || '#3f6fd0';
  const E = { b: eyeBase, p: mix(shade(eyeBase, 0.7), '#1a1030', 0.4), d: shade(eyeBase, 0.45), m: shade(eyeBase, 0.18), l: tint(eyeBase, 0.35), ll: tint(eyeBase, 0.7) };
  const LASH = mix(shade(o.hair || '#4a2f2a', 0.7), '#1c1024', 0.6);
  const accent = o.accent || (o.gender === 'm' ? '#3a4a8a' : '#e0506e');
  const male = o.gender === 'm';
  const style = o.style || 'bob';
  const short = style === 'short' || style === 'spiky' || style === 'messy';
  const helmet = o.hat === 'helmetK';
  const hood = o.hat === 'hood';
  const crown = [HX + (male ? 8 : 6), 13];
  const ringY = (x) => 30 + ((x - 66) / 30) ** 2 * 8;
  /** Краска пряди: светлая сторона слева (свет сверху слева), тень справа и на кончиках, блик-нимб. */
  const hairPaint = (dark = 0) => (u, t, x, y) => {
    let lv = 3;
    if (u < -0.4 && t < 0.7) lv = 4;
    if (u > 0.68) lv = 2;
    if (t > 0.86) lv = 2;
    const ry = y + 0.5 - ringY(x);
    if (Math.abs(ry) < 1.4 && u < 0.5 && t < 0.8) lv = 5;
    else if (ry > 1.4 && ry < 3 && u < 0.2 && t < 0.8) lv = 4;
    return H[LV[Math.max(1, lv - dark)]];
  };

  // ---- волосы сзади ----
  if (!helmet && !hood) {
    const bottom = style === 'long' || style === 'side' ? 128 : style === 'bob' ? 100 : style === 'twintails' || style === 'ponytail' || style === 'bun' ? 84 : 80;
    const halfW = short ? 36 : 40;
    B.fill(HX - 48, 6, HX + 48, Math.min(127, bottom), (x, y) => {
      if (y < 52) return ((x - HX) / (halfW + 1)) ** 2 + ((y - 52) / 42) ** 2 <= 1;
      const w = halfW + (style === 'long' ? (y - 52) * 0.1 : 0) - Math.max(0, y - (bottom - 12)) * 1.1;
      const tip = Math.abs(((x * 0.8) % 7) - 3.5) * 1.6; // зубчики кончиков
      return Math.abs(x - HX) <= w && y <= bottom - tip;
    }, (x, y) => (y > 74 || Math.abs(x - HX) > halfW - 4 || (y > 50 && (x * 5 + y) % 23 === 0) ? H.d2 : H.d1), M_HAIR, H);
    if (style === 'twintails') {
      for (const s of [-1, 1]) {
        B.strand([HX + s * 30, 36], [HX + s * 58, 66], [HX + s * 48, 128], 11, 4, hairPaint(1), M_HAIR, H);
        B.strand([HX + s * 32, 42], [HX + s * 52, 76], [HX + s * 56, 124], 7, 2.5, hairPaint(0), M_HAIR, H);
      }
    } else if (style === 'ponytail') {
      B.strand([HX + 30, 38], [HX + 56, 56], [HX + 44, 120], 11, 3, hairPaint(1), M_HAIR, H);
      B.strand([HX + 32, 42], [HX + 50, 64], [HX + 50, 110], 6, 2, hairPaint(0), M_HAIR, H);
    } else if (style === 'side') {
      B.strand([HX + 26, 52], [HX + 46, 82], [HX + 40, 128], 10, 4, hairPaint(1), M_HAIR, H);
    } else if (style === 'bun') {
      for (const s of [-1, 1]) B.ellipse(HX + s * 24, 16, 11, 10, (x, y) => (y < 12 ? H.l1 : (x * 3 + y) % 7 === 0 ? H.d1 : H.b), M_HAIR, H);
    }
  }
  if (o.tail) B.strand([HX + 34, 128], [HX + 60, 106], [HX + 56, 84], 5, 2.5, () => H.b, M_HAIR, H);

  // ---- плащ, одежда, шея ----
  if (o.stage >= 3 || o.cape) {
    const cape = ramp(o.cape || shade(o.top || '#5c6bc0', 0.45));
    B.poly([[HX - 40, 108], [HX + 40, 108], [HX + 64, 128], [HX - 64, 128]], (x) => (x > HX + 28 ? cape.d1 : cape.b), M_CLOTH, cape);
  }
  // шея — короткая, тень от подбородка
  B.poly([[56, 88], [79, 88], [78, 110], [56, 110]], (x, y) => (y < 101 || x > 73 ? S.d1 : S.b), M_SKIN, S);
  // плечи и грудь: покатые плечи, свет слева
  const bodyHalf = (y) => Math.min(63, 14 + (y - 102) * 2.6 + Math.max(0, y - 110) * 0.9);
  B.fill(0, 102, 127, 127, (x, y) => Math.abs(x - HX - 1) <= bodyHalf(y), (x, y) => {
    const k = (x - HX - 1) / bodyHalf(y + 0.5);
    if (o.armor) return k > 0.55 ? C.d1 : k < -0.6 ? C.l1 : (y === 116 || y === 117) ? C.d1 : C.b;
    return k > 0.62 ? C.d1 : k < -0.7 ? C.l1 : (x + y * 2) % 29 === 0 && y > 114 ? C.d1 : C.b;
  }, M_CLOTH, C);
  if (o.armor) {
    // наплечники и горжет
    for (const s of [-1, 1]) B.ellipse(HX + s * 40, 114, 16, 9, (x, y) => (y < 110 ? C.l2 : (x - HX) * s > 46 ? C.d1 : C.l1), M_CLOTH, C);
    B.poly([[50, 104], [80, 104], [84, 112], [46, 112]], (x, y) => (y < 107 ? C.l1 : C.b), M_CLOTH, C);
    B.fill(HX - 2, 113, HX + 4, 127, () => true, '#dfe6ee', M_CLOTH, C);
  } else if (o.tie) {
    // рубашка с воротником и галстук
    B.poly([[54, 102], [80, 102], [70, 127], [64, 127]], '#f6f4f0', M_OTHER);
    for (const s of [-1, 1]) B.poly([[HX + 1 + s * 2, 102], [HX + 1 + s * 14, 101], [HX + 1 + s * 12, 111], [HX + 1 + s * 4, 108]], (x, y) => (y > 107 ? '#e4e0da' : '#fbfaf6'), M_OTHER);
    B.poly([[63, 106], [69, 106], [70, 109], [71, 127], [61, 127], [62, 109]], (x) => (x > 67 ? '#22283a' : '#2e364c'), M_OTHER);
  } else {
    // матросский воротник и бант
    for (const s of [-1, 1]) B.poly([[HX + 1 + s * 4, 102], [HX + 1 + s * 20, 100], [HX + 1 + s * 30, 116], [HX + 1 + s * 6, 120]], (x, y) => (y > 114 ? '#e9e4dc' : '#fbf8f2'), M_OTHER);
    B.fill(HX - 30, 112, HX + 32, 116, (x, y) => y >= 113.5 && Math.abs(x - HX - 1) >= 8 && Math.abs(x - HX - 1) <= 28 && Math.abs(x - HX - 1) >= (y - 100) * 0.55, accent, M_OTHER);
    const A = ramp(accent);
    B.ellipse(HX - 7, 112, 7.5, 4.5, (x) => (x < HX - 10 ? A.l1 : A.b), M_OTHER, A);
    B.ellipse(HX + 9, 112, 7.5, 4.5, (x) => (x > HX + 12 ? A.d1 : A.b), M_OTHER, A);
    B.ellipse(HX + 1, 112, 3, 3.2, A.d1, M_OTHER, A);
    B.poly([[HX - 3, 113], [HX, 113], [HX - 5, 127], [HX - 9, 126]], A.b, M_OTHER, A);
    B.poly([[HX + 2, 113], [HX + 5, 113], [HX + 11, 126], [HX + 7, 127]], A.d1, M_OTHER, A);
    if (o.apron) for (const s of [-1, 1]) B.poly([[HX + 1 + s * 20, 104], [HX + 1 + s * 25, 104], [HX + 1 + s * 25, 127], [HX + 1 + s * 20, 127]], '#fbf8f2');
    if (o.overalls) {
      for (const s of [-1, 1]) {
        B.poly([[HX + 1 + s * 18, 106], [HX + 1 + s * 23, 106], [HX + 1 + s * 23, 127], [HX + 1 + s * 18, 127]], o.pants || '#3a4a66', M_CLOTH);
        B.ellipse(HX + 1 + s * 20.5, 120, 1.6, 1.6, '#e8c860');
      }
    }
    if (o.vest) for (const s of [-1, 1]) B.poly([[HX + 1 + s * 12, 106], [HX + 1 + s * 40, 110], [HX + 1 + s * 50, 127], [HX + 1 + s * 14, 127]], (x) => ((x - HX) * s > 34 ? shade(o.vest, 0.15) : o.vest));
    if (o.sporty) B.fill(HX - 60, 120, HX + 62, 122, (x, y) => Math.abs(x - HX - 1) <= bodyHalf(y) - 1, '#ffffff', M_OTHER);
  }

  // ---- лицо и ухо ----
  B.fill(28, 26, 98, 100, faceIn, (x, y) => {
    const sp = faceSpan(y + 0.5);
    if (!sp) return S.b;
    const [l, r] = sp;
    if (y > 54 && x + 0.5 > r - (y > 74 ? 3.2 : 2.2)) return S.d1; // тень по дальней скуле и челюсти
    if (y > 91 && x > 58) return S.d1; // под подбородком
    if (x + 0.5 < l + 2.5 && y > 60 && y < 84) return S.l1; // свет на ближней щеке
    return S.b;
  }, M_SKIN, S);
  if (short && !helmet && !hood) {
    B.ellipse(32, 70, 3.6, 7, (x, y) => (x < 31 ? S.b : y > 73 ? S.d1 : S.d1), M_SKIN, S);
    B.line([[32, 66], [31, 70], [32, 74]], 1, S.d2, M_SKIN);
  }

  // ---- глаза ----
  const closed = expr === 'closed' || expr === 'grin';
  const sad = expr === 'sad';
  const sur = expr === 'surprised';
  const look = expr === 'blush' ? 1.6 : 1; // смущается — смотрит в сторону
  for (const [ecx, hw, s, k] of [[50, 9.6, -1, 1], [80.5, 7.6, 1, 0.82]]) {
    // s: −1 — ближний (левый) глаз, его внешний угол слева; k — сжатие дальнего глаза
    const out = (dx) => dx * s; // > 0 — к внешнему углу
    const top = (dx) => EY - 8.6 + dx * dx * 3.2 + (out(dx) > 0 ? out(dx) * 1.2 : 0) + (sad ? 1.2 - out(dx) * 1.4 : 0) - (sur ? 1 : 0);
    const bot = (dx) => EY + 7.6 - dx * dx * 4.2 + (sur ? 0.6 : 0);
    if (closed) {
      // счастливые «^^»
      const pts = [];
      for (let dx = -1; dx <= 1.001; dx += 0.125) pts.push([ecx + dx * hw, EY + 1.5 - (1 - dx * dx) * 4.2]);
      B.line(pts, 2.1, LASH, M_EYE);
      if (!male) B.line([[ecx + s * hw, EY + 1.5], [ecx + s * (hw + 2.2), EY + 3]], 1.2, LASH, M_EYE);
      continue;
    }
    B.fill(ecx - hw - 4, EY - 13, ecx + hw + 4, EY + 10, (x, y) => {
      const dx = (x - ecx) / hw;
      if (Math.abs(dx) > 1.03) return false;
      return y > top(dx) - 2.6 && y < bot(dx) + 1.1;
    }, (x, y) => {
      const xx = x + 0.5;
      const yy = y + 0.5;
      const dx = (xx - ecx) / hw;
      const t = top(dx);
      const b = bot(dx);
      const lash = male ? 1.6 : 2.2 + Math.max(0, out(dx)) * 1.2;
      if (yy < t + lash - 1.6) return LASH; // верхнее веко с ресницами — толще к внешнему углу
      if (yy > b) return Math.abs(dx) > 0.15 && Math.abs(dx) < 0.92 && out(dx) > -0.5 ? S.d2 : S.b; // нижнее веко
      // радужка: высокий овал, тёмная сверху, светлая снизу
      const ix = ecx + 0.9 * look + (s > 0 ? -0.6 : 0.4);
      const iy = EY + 0.6 + (sad ? 0.8 : 0) + (expr === 'blush' ? 0.8 : 0);
      const rx = hw * (sur ? 0.52 : 0.7) * (k < 1 ? 1.02 : 1);
      const ry = sur ? 6.2 : 8.2;
      const d = ((xx - ix) / rx) ** 2 + ((yy - iy) / ry) ** 2;
      if (d <= 1) {
        const pd = ((xx - ix) / (rx * 0.36)) ** 2 + ((yy - iy - 0.6) / (ry * 0.5)) ** 2;
        if (pd <= 1) return E.p;
        if (d > 0.8) return E.d;
        const v = (yy - (iy - ry)) / (2 * ry);
        if (yy < t + lash + 1.2) return E.p; // тень от века
        return v < 0.3 ? E.d : v < 0.5 ? E.m : v < 0.72 ? E.b : v < 0.86 ? E.l : E.ll;
      }
      return yy < t + lash + 1 ? '#e2d6e4' : '#fbf7f5';
    }, M_EYE);
    // крылышко у внешнего угла (у девочек), блики
    if (!male) {
      B.line([[ecx + s * hw * 0.9, EY - 6.4], [ecx + s * (hw + 2.6), EY - 7.6]], 1.4, LASH, M_EYE);
      B.line([[ecx + s * hw * 0.95, EY - 4.6], [ecx + s * (hw + 1.6), EY - 3.6]], 1, LASH, M_EYE);
    }
    const ix = ecx + 0.9 * look + (s > 0 ? -0.6 : 0.4);
    const iy = EY + 0.6 + (sad ? 0.8 : 0);
    const rx = hw * (sur ? 0.52 : 0.7);
    B.ellipse(ix - rx * 0.42, iy - 3.6, 2.2 * Math.min(1, k + 0.1), 1.9, '#ffffff', M_EYE);
    B.ellipse(ix + rx * 0.45, iy + 3.4, 0.9, 0.9, '#ffffff', M_EYE);
    B.set(ix + rx * 0.5, iy - 2.4, E.ll, M_EYE);
    // нижние ресницы у девочек — одна чёрточка у внешнего угла
    if (!male) B.set(ecx + s * hw * 0.78, EY + 6.4, mix(LASH, S.b, 0.35), M_EYE);
  }
  // брови: видны поверх чёлки только при грусти и удивлении — нарисуем позже

  // ---- румянец, нос, рот ----
  const blush = expr === 'blush' || expr === 'smile' || expr === 'grin' || expr === 'closed' || o.blush;
  if (blush) {
    const bc = mix(S.b, '#ff7f9a', expr === 'blush' ? 0.5 : 0.28);
    B.ellipse(46, 79.5, 6.5, 2.2, bc, M_SKIN, S);
    B.ellipse(84, 78.5, 4.6, 2, bc, M_SKIN, S);
    if (expr === 'blush') {
      for (const [x, y] of [[42, 78], [45, 78], [48, 78], [82, 77], [85, 77]]) B.line([[x + 1, y], [x, y + 2]], 1, mix(S.b, '#ff5078', 0.6), M_SKIN);
    }
  }
  // нос вполоборота: тень справа и блик
  B.set(72, 76, S.d1, M_SKIN, S);
  B.set(72, 77, S.d2, M_SKIN, S);
  B.set(71, 78, S.d1, M_SKIN, S);
  B.set(70, 75, S.l1, M_SKIN, S);
  const mouth = { neutral: 'line', smile: 'smile', grin: 'open', surprised: 'o', sad: 'down', blush: 'small', closed: 'smile' }[expr] || 'line';
  const MO = mix(S.o, '#a03a4a', 0.4);
  const my = 86.5;
  if (o.ears && mouth !== 'o' && mouth !== 'down' && mouth !== 'open') {
    B.line([[64, my - 0.5], [65.5, my + 0.8], [67, my - 0.2], [68.5, my + 0.8], [70, my - 0.5]], 1, MO);
  } else if (mouth === 'line') B.line([[65.5, my], [70, my]], 1, mix(S.b, MO, 0.8));
  else if (mouth === 'small') B.line([[66.5, my], [68.5, my]], 1, mix(S.b, MO, 0.8));
  else if (mouth === 'smile') B.line([[63.5, my - 1.2], [65, my], [69, my], [70.5, my - 1.2]], 1, MO);
  else if (mouth === 'open') {
    B.fill(62, my - 2, 73, my + 5, (x, y) => y >= my - 1.2 && ((x - 67.5) / 4.8) ** 2 + ((y - (my - 1.2)) / 5) ** 2 <= 1, (x, y) => (y > my + 1.6 ? '#f08a9a' : '#8a2a3e'));
    B.line([[62.8, my - 1.4], [72.2, my - 1.4]], 1, mix(MO, '#5a1a2a', 0.4));
  } else if (mouth === 'o') {
    B.ellipse(67.5, my + 0.5, 2, 2.6, '#8a2a3e');
    B.set(67, my + 1.6, '#f08a9a');
  } else if (mouth === 'down') B.line([[64.5, my + 1.2], [66, my], [69, my], [70.5, my + 1.2]], 1, MO);

  // ---- волосы спереди: шапка, пряди у лица, чёлка ----
  if (!helmet && !hood) {
    const P = hairPaint(0);
    const P1 = hairPaint(1);
    // шапка волос: объём головы, свет слева сверху, блик-нимб с разрывами, тень справа и снизу
    B.fill(24, 8, 104, 60, (x, y) => ((x - HX) / 38.5) ** 2 + ((y - 50) / 41) ** 2 <= 1 && y < 44 + Math.abs(x - MX) * 0.35, (x, y) => {
      const ry = y + 0.5 - ringY(x);
      const gap = (Math.floor(x / 6) + Math.floor(y / 5)) % 4 === 0;
      if (Math.abs(ry) < 1.5 && !gap && x > 30 && x < 98) return H.l2;
      if (ry > 1.5 && ry < 3.2 && !gap && x < 90) return H.l1;
      if (x > 92 || (x - HX) ** 2 / 38 ** 2 + (y - 50) ** 2 / 41 ** 2 > 0.82) return H.d1;
      if (ry < -1.5 && x < crown[0] - 6) return H.l1;
      return H.b;
    }, M_HAIR, H);
    // линии прядей от макушки — несколько, чтобы был объём, а не полоски
    for (const [x, y] of [[34, 30], [46, 18], [82, 18], [94, 30], [100, 46]]) {
      B.strand(crown, [(crown[0] + x) / 2 + (x - HX) * 0.25, (crown[1] + y) / 2 - 3], [x, y], 0.9, 0.5, () => H.d2, M_HAIR, H);
    }
    // пряди у лица: ближняя длиннее и шире, дальняя — за скулой
    const sideTip = short ? 78 : style === 'bob' ? 98 : style === 'long' || style === 'side' ? 116 : 92;
    B.strand([36, 30], [26, 62], [31, sideTip], 8.5, 1.6, P1, M_HAIR, H);
    B.strand([40, 34], [33, 60], [37, sideTip - 12], 5.5, 1, P, M_HAIR, H);
    B.strand([92, 30], [99, 58], [95, sideTip - 4], 7.5, 1.4, P1, M_HAIR, H);
    B.strand([89, 34], [94, 56], [91, sideTip - 16], 4.5, 0.9, P, M_HAIR, H);
    // чёлка: клочки до бровей, над глазами короче, между глазами — длинная прядка; всё чуть зачёсано вправо
    const sweep = male ? 4 : 2.5;
    const tips = short
      ? [[37, 50], [46, 54], [56, 51], [65, 56], [75, 52], [85, 54], [93, 49]]
      : [[36, 53], [45, 57], [54, 54], [63, 60], [72, 56], [81, 58], [90, 54]];
    for (const [tx, ty] of tips) {
      const rx = tx * 0.45 + crown[0] * 0.55 - 2;
      const ctrl = [rx + (tx - rx) * 0.5 + sweep, (crown[1] + 10 + ty) / 2 - 2];
      B.strand([rx, crown[1] + 10], ctrl, [tx, ty], 8, 0.6, P, M_HAIR, H);
    }
    if (style === 'spiky') for (const [x, y] of [[38, 8], [52, 2], [68, 1], [84, 4], [96, 12]]) B.strand(crown, [(crown[0] + x) / 2, crown[1] - 3], [x, y], 5, 1, P, M_HAIR, H);
    if (style === 'messy') for (const [x, y] of [[44, 6], [80, 5], [96, 16]]) B.strand(crown, [(crown[0] + x) / 2, crown[1] - 4], [x, y], 4.5, 1, P, M_HAIR, H);
    // хвостики: резинки у корней
    if (style === 'twintails') for (const s of [-1, 1]) B.ellipse(HX + s * 31, 38, 3.5, 4, accent, M_OTHER);
    // заколка у девочек без шапки
    if (!o.hat && !male) {
      for (let i = -3; i <= 3; i++) {
        B.set(41 + i, 42 + i * 0.5, accent);
        B.set(41 + i, 43 + i * 0.5, shade(accent, 0.2));
      }
    }
    if (o.stage >= 4) {
      B.fill(34, 40, 96, 42, (x, y) => y >= 40.4 && y <= 42 && Math.abs(x - MX) <= 28, '#f0c850');
      B.ellipse(MX, 40.5, 2.8, 2.8, '#7ad0ff');
      B.set(MX - 1, 39.5, '#ffffff');
    }
  }
  // брови поверх чёлки — когда эмоция их показывает
  if (sad || sur) {
    const bc = mix(H.d2, '#1c1024', 0.3);
    if (sad) {
      B.line([[42, 52], [50, 50.5], [56, 48.5]], 1.4, bc);
      B.line([[75, 48.5], [80, 50], [86, 51.5]], 1.4, bc);
    } else {
      B.line([[42, 49], [49, 46.5], [56, 47.5]], 1.4, bc);
      B.line([[75, 47], [81, 45.5], [86, 47]], 1.4, bc);
    }
  }
  if (o.ears) {
    for (const [bx, s] of [[40, -1], [90, 1]]) {
      B.poly([[bx - 9, 22], [bx + s * 6, -2], [bx + 9, 22]], (x) => ((x - bx) * s > 3 ? H.d1 : H.b), M_HAIR, H);
      B.poly([[bx - 5, 19], [bx + s * 4, 4], [bx + 5, 19]], '#f6b0c8', M_OTHER);
    }
  }
  hat128(B, o, H, accent);
  if (o.glasses) {
    const g = '#3a3448';
    for (const [x0, rx] of [[50, 11.5], [80.5, 9.4]]) {
      B.fill(x0 - rx - 1, 56, x0 + rx + 1, 79, (x, y) => {
        const kk = ((x - x0) / rx) ** 2 + ((y - 67.5) / 10) ** 2;
        return kk <= 1 && kk >= 0.8;
      }, g);
      B.line([[x0 - rx * 0.55, 61], [x0 - rx * 0.2, 59.5]], 1, '#f4f6ff'); // блик на стекле
    }
    B.line([[61.5, 65], [71, 65]], 1, g);
    B.line([[38.5, 66], [33, 64]], 1, g);
  }

  // ---- тени и обводка по материалам ----
  const col = B.col.slice();
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (!B.col[i]) continue;
      const m = B.mat[i];
      const R = B.rmp[i];
      // тень от чёлки на лбу (две строки)
      if (m === M_SKIN && R && (B.m(x, y - 1) === M_HAIR || B.m(x, y - 2) === M_HAIR || B.m(x - 1, y - 1) === M_HAIR)) col[i] = R.d1;
      // нижний край прядей над лицом — тёмная линия
      if (m === M_HAIR && R && (B.m(x, y + 1) === M_SKIN || B.m(x, y + 1) === M_EYE)) col[i] = R.o;
      // ткань под шеей
      if (m === M_CLOTH && R && B.m(x, y - 1) === M_SKIN) col[i] = R.d2;
      // кожа у волос сбоку — тень
      if (m === M_SKIN && R && (B.m(x + 1, y) === M_HAIR || B.m(x - 1, y) === M_HAIR) && y > 40) col[i] = R.d1;
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

/** Головные уборы портрета (под голову 128 × 128, вполоборота). */
function hat128(B, o, H, accent) {
  const h = o.hat;
  if (!h) return;
  const A = ramp(accent);
  if (h === 'bow') {
    const bx = 90;
    const by = 20;
    B.ellipse(bx - 8, by, 8.5, 6.5, (x, y) => (x < bx - 12 ? A.l1 : y > by + 3 ? A.d1 : A.b), M_OTHER, A);
    B.ellipse(bx + 8, by + 1, 8, 6.5, (x, y) => (x > bx + 12 ? A.d1 : y > by + 4 ? A.d1 : A.b), M_OTHER, A);
    B.ellipse(bx, by + 1, 3.4, 4, A.d1, M_OTHER, A);
    B.poly([[bx - 3, by + 3], [bx, by + 3], [bx - 6, by + 17], [bx - 10, by + 14]], A.b, M_OTHER, A);
    B.poly([[bx, by + 3], [bx + 3, by + 3], [bx + 9, by + 14], [bx + 5, by + 17]], A.d1, M_OTHER, A);
    B.ellipse(bx - 11, by - 2.5, 2, 1.4, A.l2, M_OTHER, A);
  } else if (h === 'gradcap') {
    const G = ramp('#34344a');
    B.fill(42, 16, 90, 30, (x, y) => Math.abs(x - 66) <= 23 && y >= 18, (x) => (x > 82 ? G.d1 : G.b), M_OTHER, G);
    B.poly([[24, 14], [64, 0], [106, 12], [66, 26]], (x, y) => (y < 12 ? G.l1 : G.b), M_OTHER, G);
    B.strand([66, 12], [92, 12], [100, 34], 1, 1, () => '#f0c850', M_OTHER, null);
    B.ellipse(100, 36, 2.6, 4, '#f0c850');
  } else if (h === 'bandana') {
    const K = ramp('#d8404a');
    B.fill(28, 8, 100, 36, (x, y) => ((x - 64) / 36) ** 2 + ((y - 34) / 24) ** 2 <= 1 && y < 35, (x, y) => ((x * 3 + y * 5) % 19 === 0 ? '#ffffff' : y > 30 ? K.d1 : K.b), M_OTHER, K);
    B.poly([[30, 28], [16, 38], [22, 42], [34, 32]], K.d1, M_OTHER, K);
    B.poly([[30, 30], [20, 46], [27, 47], [34, 34]], K.b, M_OTHER, K);
  } else if (h === 'beret') {
    B.ellipse(62, 16, 37, 11, (x, y) => (y < 12 ? A.l1 : y > 21 ? A.d1 : A.b), M_OTHER, A);
    B.fill(66, 1, 69, 6, () => true, A.d2, M_OTHER, A);
  } else if (h === 'headphones') {
    const D = ramp('#3a3a48');
    B.strand([30, 58], [62, -18], [98, 56], 2.8, 2.8, () => D.b, M_OTHER, D);
    B.ellipse(28, 66, 7.5, 12, (x) => (x > 31 ? A.d1 : A.b), M_OTHER, A);
    B.ellipse(27, 62, 2.4, 3.6, A.l2, M_OTHER, A);
    B.ellipse(99, 63, 5.5, 10, (x) => (x > 101 ? A.d1 : A.b), M_OTHER, A);
  } else if (h === 'headband') {
    B.fill(28, 36, 100, 42, (x, y) => ((x - HX) / 36) ** 2 + ((y - 50) / 30) ** 2 <= 1.08 && y > 36 + Math.abs(x - MX) * 0.06, (x, y) => (y < 39 ? '#ffffff' : A.b), M_OTHER, A);
    B.poly([[30, 40], [14, 48], [18, 52], [31, 44]], '#f4f4f4');
  } else if (h === 'nursecap') {
    B.poly([[46, 16], [84, 14], [80, 2], [50, 4]], (x, y) => (y > 12 ? '#e8e8f0' : '#ffffff'));
    B.fill(64, 4, 68, 13, () => true, '#e04a5a');
    B.fill(61, 7, 71, 10, () => true, '#e04a5a');
  } else if (h === 'straw') {
    const W = ramp('#e8c46a');
    B.ellipse(64, 26, 58, 9, (x, y) => (y < 25 ? W.l1 : W.d1), M_OTHER, W);
    B.fill(40, 2, 90, 25, (x, y) => Math.abs(x - 65) <= 23 - (25 - y) * 0.25, (x, y) => (y > 17 && y < 22 ? '#d84a3a' : (x + y) % 4 === 0 ? W.d1 : W.b), M_OTHER, W);
  } else if (h === 'helmet' || h === 'hardhat') {
    const Y = ramp(h === 'helmet' ? '#f2c230' : '#ff9a2a');
    B.ellipse(64, 30, 36, 27, (x, y) => (y > 30 ? null : x < 46 ? Y.l1 : x > 88 ? Y.d1 : Y.b), M_OTHER, Y);
    B.fill(22, 29, 108, 34, (x, y) => Math.abs(x - 65) <= 42, Y.d1, M_OTHER, Y);
    if (h === 'helmet') {
      B.ellipse(70, 17, 8, 7, '#fff2b0');
      B.ellipse(70, 17, 4.5, 4, '#ffffff');
    } else B.fill(62, 4, 67, 29, () => true, Y.l1, M_OTHER, Y);
  } else if (h === 'hood') {
    const G = ramp(o.hood || '#2f6a2c');
    const open = (x, y) => y > 30 && y < 100 && ((x - 63) / 34) ** 2 + ((y - 66) / 38) ** 2 <= 1;
    // пряди у лица под капюшоном
    B.strand([36, 40], [30, 66], [36, 96], 6, 1.2, (u) => (u > 0.5 ? H.d1 : H.b), M_HAIR, H);
    B.strand([92, 40], [97, 64], [92, 92], 5, 1, (u) => (u > 0.4 ? H.d1 : H.b), M_HAIR, H);
    B.fill(14, 2, 114, 127, (x, y) => {
      const outer = y < 58 ? ((x - HX) / 46) ** 2 + ((y - 58) / 56) ** 2 <= 1 : Math.abs(x - HX) <= 46 + (y - 58) * 0.25;
      return outer && !open(x, y) && y < 112;
    }, (x, y) => {
      const k = ((x - 63) / 34) ** 2 + ((y - 66) / 38) ** 2;
      if (k < 1.22 && y > 28) return G.d2; // тень внутри капюшона
      return x > 100 ? G.d1 : x < 24 ? G.l1 : y > 100 ? G.d1 : G.b;
    }, M_OTHER, G);
    // чёлка из-под капюшона
    for (const [tx, ty] of [[42, 54], [51, 57], [60, 54], [69, 59], [78, 55], [87, 56]]) B.strand([tx + (MX - tx) * 0.3, 32], [tx + 2, 42], [tx, ty], 6, 0.6, (u, t) => (u > 0.6 || t > 0.85 ? H.d1 : u < -0.35 ? H.l1 : H.b), M_HAIR, H);
  } else if (h === 'witch') {
    const W = ramp('#3b2560');
    B.ellipse(64, 26, 60, 9, (x, y) => (y < 25 ? W.l1 : W.d1), M_OTHER, W);
    B.poly([[36, 24], [92, 24], [80, 8], [100, 1], [74, 0], [56, 4]], (x, y) => (x > 78 ? W.d1 : y < 10 && x < 64 ? W.l1 : W.b), M_OTHER, W);
    B.fill(35, 17, 93, 23, (x, y) => Math.abs(x - 64) <= 29 - (23 - y) * 1.1, '#c9a24a');
    B.ellipse(64, 20, 3.4, 2.8, '#f2d860');
  } else if (h === 'helmetK') {
    const K = ramp('#b9c2cc');
    B.fill(22, 0, 106, 108, (x, y) => {
      const outer = y < 60 ? ((x - HX) / 40) ** 2 + ((y - 60) / 58) ** 2 <= 1 : Math.abs(x - HX) <= 40 - (y - 60) * 0.08;
      const inner = y > 42 && y < 99 && faceIn(x, y);
      return outer && !inner;
    }, (x, y) => (x > 94 ? K.d1 : x < 30 ? K.l1 : y > 38 && y < 42 ? K.d1 : (x === 64 || x === 65) && y < 38 ? K.l2 : K.b), M_OTHER, K);
    B.strand([66, 4], [74, -10], [92, -6], 5, 2.5, () => o.plume || '#d84040', M_OTHER, null);
    // тень под краем шлема
    B.fill(30, 42, 98, 52, (x, y) => faceIn(x, y) && y < 46 + Math.abs(x - MX) * 0.08, K.d2, M_OTHER, K);
  }
}
