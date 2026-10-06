// Портреты для диалогов деревни (обновление 0.8): крупное пиксельное аниме-лицо 64 × 64 — большие глаза
// с градиентом и бликами, чёлка прядями с бликом-«нимбом», румянец; эмоции: neutral, smile, grin, surprised, sad,
// blush, closed (^^). Для зверей — свои мордочки. Рисуется в холст один раз и кэшируется; обводка — по силуэту.

import { mix, shade, tint, LOOKS } from './chibi.js';

export const PW = 64;
const OUTLINE = '#1e1626';

function pal(o) {
  const hair = o.hair || '#4a2f2a';
  const skin = o.skin || '#ffe3cf';
  const eyes = o.eyes || '#3f6fd0';
  const top = o.top || '#5c6bc0';
  return {
    skin, skinS: mix(skin, '#c97a6a', 0.28), skinSS: mix(skin, '#a85a5a', 0.45), blush: mix(skin, '#ff6f8a', 0.4),
    hair, hairD: shade(hair, 0.3), hairDD: shade(hair, 0.52), hairL: tint(hair, 0.4), hairLL: tint(hair, 0.7),
    eyes, irisD: shade(eyes, 0.5), irisM: shade(eyes, 0.15), irisL: tint(eyes, 0.35), irisLL: tint(eyes, 0.65), pupil: shade(eyes, 0.78),
    top, topD: shade(top, 0.3), topL: tint(top, 0.2), accent: o.accent || (o.gender === 'm' ? '#3a4a8a' : '#e0506e'),
  };
}

/** Полуширина лица в строке y (лицо 18…44, центр между x = 31 и 32): широкие скулы, острый подбородок. */
function faceHalf(y) {
  if (y < 18 || y > 44) return -1;
  if (y === 18) return 9;
  if (y === 19) return 11;
  if (y === 20) return 12;
  if (y === 21) return 13;
  if (y <= 32) return 14;
  return Math.max(2, Math.round(14 - (y - 32) * 0.98));
}

/** Нижний край чёлки в столбце x между остриями прядей (ломаная). */
function bangsBottom(x, tips, outside) {
  if (x < tips[0][0] || x > tips[tips.length - 1][0]) return outside;
  for (let i = 0; i < tips.length - 1; i++) {
    const [xa, ya] = tips[i];
    const [xb, yb] = tips[i + 1];
    if (x < xa || x > xb) continue;
    const mid = (xa + xb) / 2;
    const valley = Math.min(ya, yb) - 4;
    return x <= mid ? Math.round(ya + (valley - ya) * ((x - xa) / Math.max(1, mid - xa))) : Math.round(valley + (yb - valley) * ((x - mid) / Math.max(1, xb - mid)));
  }
  return outside;
}

function human(c, o, expr) {
  const P = pal(o);
  const r = (x, y, w, h, col) => {
    if (!col || w <= 0 || h <= 0) return;
    c.fillStyle = col;
    c.fillRect(x, y, w, h);
  };
  const px = (x, y, col) => r(x, y, 1, 1, col);
  const row = (y, half, col) => r(32 - half, y, half * 2, 1, col);
  const style = o.style || 'bob';
  const short = style === 'short' || style === 'spiky' || style === 'messy';
  const helmet = o.hat === 'helmetK';

  // ---- волосы сзади ----
  if (!helmet) {
    const bottom = style === 'long' || style === 'side' ? 64 : style === 'bob' || style === 'twintails' ? 50 : style === 'ponytail' || style === 'bun' ? 46 : 36;
    for (let y = 8; y < bottom; y++) {
      let half = y < 14 ? 13 + (y - 8) : short ? 18 : 19;
      if (y > bottom - 6) half -= (y - (bottom - 6)) * (short ? 2 : 1);
      if (half <= 0) continue;
      row(y, half, y > 38 ? P.hairDD : P.hairD);
    }
    if (!short && bottom < 64) for (let x = 14; x < 50; x += 4) r(x, bottom - 1, 2, 2, P.hairDD); // кончики прядей
    if (style === 'twintails') {
      for (const sx of [-1, 1]) {
        for (let y = 16; y < 64; y++) {
          const k = y - 16;
          const w = k < 3 ? 5 + k : 8 - Math.floor(k / 12);
          const x0 = sx < 0 ? 4 + Math.round(Math.sin(k / 7) * 2) : 60 - w - Math.round(Math.sin(k / 7) * 2);
          r(x0, y, w, 1, k % 9 === 3 ? P.hair : P.hairD);
          if (k % 9 === 3) px(x0 + 1, y, P.hairL);
        }
        r(sx < 0 ? 6 : 52, 15, 6, 4, P.accent);
        r(sx < 0 ? 7 : 53, 15, 2, 1, tint(P.accent, 0.45));
      }
    } else if (style === 'ponytail') {
      for (let y = 6; y < 54; y++) {
        const k = y - 6;
        r(49 + Math.round(Math.sin(k / 8) * 2), y, k < 3 ? 6 : 8 - Math.floor(k / 14), 1, k % 7 === 2 ? P.hair : P.hairD);
      }
      r(47, 9, 5, 5, P.accent);
    } else if (style === 'side') {
      for (let y = 24; y < 62; y++) r(48 + Math.round(Math.sin((y - 24) / 7) * 1.5), y, 8, 1, (y - 24) % 7 === 2 ? P.hair : P.hairD);
      r(47, 22, 6, 4, P.accent);
    } else if (style === 'bun') {
      for (const bx of [17, 47]) {
        for (let y = 1; y < 13; y++) {
          const hw = Math.round(Math.sqrt(Math.max(0, 36 - (y - 7) ** 2)));
          r(bx - hw, y, hw * 2, 1, y < 5 ? P.hairL : P.hair);
        }
      }
    }
  }
  if (o.tail) for (let i = 0; i < 12; i++) r(52 + Math.round(Math.sin(i / 3) * 2), 52 + i, 4, 1, P.hair);

  // ---- шея, плечи, одежда ----
  r(28, 42, 8, 7, P.skin);
  r(28, 42, 8, 3, P.skinS);
  for (let y = 48; y < 64; y++) {
    const half = Math.min(27, 12 + Math.floor((y - 48) * 1.1) + (y > 51 ? 4 : 0));
    row(y, half, o.armor ? '#b9c2cc' : P.top);
    px(32 + half - 1, y, o.armor ? '#8a939d' : P.topD);
    px(32 + half - 2, y, o.armor ? '#9aa3ad' : mix(P.top, P.topD, 0.5));
  }
  if (o.stage >= 3 || o.cape) {
    const cape = o.cape || shade(P.top, 0.45);
    r(5, 55, 11, 9, cape);
    r(48, 55, 11, 9, cape);
    r(11, 51, 7, 6, cape);
    r(46, 51, 7, 6, cape);
    r(29, 49, 6, 3, '#e8c050');
    px(30, 49, '#fff2b0');
  }
  if (o.armor) {
    r(9, 54, 46, 1, '#dfe6ee');
    r(25, 48, 14, 2, '#8a939d');
  } else {
    for (let i = 0; i < 6; i++) {
      r(23 + i, 48 + i, 4, 1, '#f6f2ea');
      r(37 - i, 48 + i, 4, 1, '#f6f2ea');
    }
    r(24, 48, 16, 1, '#f6f2ea');
    if (o.tie) r(30, 49, 4, 15, '#2a2a3a');
    else {
      r(25, 52, 6, 4, P.accent);
      r(33, 52, 6, 4, P.accent);
      r(30, 52, 4, 4, shade(P.accent, 0.25));
      r(29, 56, 2, 5, P.accent);
      r(33, 56, 2, 5, P.accent);
      r(26, 52, 2, 1, tint(P.accent, 0.45));
    }
    if (o.apron) {
      r(17, 57, 2, 7, '#fbf8f2');
      r(45, 57, 2, 7, '#fbf8f2');
    }
    if (o.overalls) {
      r(19, 54, 4, 10, o.pants || '#3a4a66');
      r(41, 54, 4, 10, o.pants || '#3a4a66');
      px(20, 55, '#e8c050');
      px(42, 55, '#e8c050');
    }
    if (o.vest) {
      r(13, 56, 8, 8, o.vest);
      r(43, 56, 8, 8, o.vest);
    }
  }

  // ---- лицо ----
  for (let y = 18; y <= 44; y++) {
    const h = faceHalf(y);
    row(y, h, P.skin);
    if (y > 22 && y < 42) px(32 + h - 1, y, mix(P.skin, P.skinS, 0.7)); // лёгкая тень справа
  }
  // уши (у коротких причёсок)
  if (short && !helmet && o.hat !== 'hood') {
    r(16, 30, 2, 7, P.skin);
    px(16, 30, P.skinS);
    r(46, 30, 2, 7, P.skinS);
  }
  px(32, 38, P.skinS); // нос

  // ---- глаза ----
  const closed = expr === 'closed' || expr === 'grin';
  const sad = expr === 'sad';
  const sur = expr === 'surprised';
  for (const [x0, mir] of [[20, false], [36, true]]) {
    const X = (cx) => (mir ? x0 + 7 - cx : x0 + cx); // столбец 0 — внешний край глаза
    if (closed) {
      // ^^ — дуги вверх
      for (const [cx, y] of [[0, 32], [1, 31], [2, 30], [3, 30], [4, 30], [5, 30], [6, 31], [7, 32]]) r(X(cx), y, 1, 2, OUTLINE);
      continue;
    }
    const top = sad ? 28 : 27;
    // верхнее веко: толстые ресницы и «крылышко»
    for (let cx = 1; cx < 8; cx++) px(X(cx), top, OUTLINE);
    for (let cx = 0; cx < 8; cx++) px(X(cx), top + 1, OUTLINE);
    px(X(-1), top - 1, OUTLINE);
    px(X(-1), top, OUTLINE);
    if (sad) for (let i = 0; i < 6; i++) px(X(5 - i), 23 + Math.floor(i / 2), P.hairDD); // брови домиком
    const h = sur ? 8 : 7; // высота радужки
    for (let k = 0; k < h; k++) {
      const y = top + 2 + k;
      const narrow = k === h - 1;
      const col = k < 2 ? P.irisD : k < 3 ? P.irisM : k < 5 ? P.eyes : k < 6 ? P.irisL : P.irisLL;
      px(X(0), y, narrow ? P.skin : '#ffffff');
      for (let cx = narrow ? 2 : 1; cx < (narrow ? 6 : 7); cx++) px(X(cx), y, col);
      px(X(7), y, narrow ? P.skin : k < 1 ? P.skin : '#ffffff');
    }
    // зрачок, блики
    const pr = sur ? 2 : 4;
    for (let k = 0; k < pr; k++) {
      px(X(3), top + 3 + k, P.pupil);
      px(X(4), top + 3 + k, P.pupil);
    }
    r(Math.min(X(1), X(2)), top + 2, 2, 2, '#ffffff');
    px(X(5), top + 6, '#ffffff');
    px(X(6), top + 3, tint(P.eyes, 0.75));
    // нижнее веко
    for (let cx = 2; cx < 6; cx++) px(X(cx), top + 2 + h, P.skinSS);
    px(X(1), top + 1 + h, mix(P.skin, OUTLINE, 0.5));
  }

  // ---- румянец ----
  const blush = expr === 'blush' || expr === 'grin' || expr === 'smile' || expr === 'closed' || o.blush;
  if (blush) {
    for (const bx of [18, 40]) {
      r(bx, 37, 6, 2, mix(P.skin, P.blush, expr === 'blush' ? 0.9 : 0.55));
      if (expr === 'blush') for (let i = 0; i < 3; i++) px(bx + i * 2, 36, shade(P.blush, 0.1));
    }
  }

  // ---- рот ----
  const mouth = { neutral: 'line', smile: 'smile', grin: 'open', surprised: 'o', sad: 'down', blush: 'small', closed: 'smile' }[expr] || 'line';
  if (o.ears && mouth !== 'o' && mouth !== 'down') {
    for (const [x, y] of [[29, 41], [30, 42], [31, 41], [32, 41], [33, 42], [34, 41]]) px(x, y, '#8a3a44'); // «ω»
  } else if (mouth === 'line') r(30, 42, 4, 1, '#b0605a');
  else if (mouth === 'small') r(31, 42, 2, 1, '#b0605a');
  else if (mouth === 'smile') {
    r(30, 42, 4, 1, '#9a4a4a');
    px(29, 41, '#9a4a4a');
    px(34, 41, '#9a4a4a');
  } else if (mouth === 'open') {
    r(29, 41, 6, 1, '#7a2a3a');
    r(29, 42, 6, 2, '#c84a5a');
    r(30, 43, 4, 1, '#f08a9a');
    r(30, 42, 4, 1, '#a83a4a');
  } else if (mouth === 'o') {
    r(31, 41, 2, 3, '#7a2a3a');
    px(30, 42, '#7a2a3a');
    px(33, 42, '#7a2a3a');
  } else if (mouth === 'down') {
    r(30, 42, 4, 1, '#9a4a4a');
    px(29, 43, '#9a4a4a');
    px(34, 43, '#9a4a4a');
  }

  // ---- волосы спереди: макушка, чёлка прядями, пряди у лица ----
  if (!helmet) {
    for (let y = 5; y < 22; y++) {
      const half = y < 7 ? 9 + (y - 5) * 3 : Math.min(19, 14 + (y - 7));
      row(y, half, P.hair);
    }
    const tips = short
      ? [[14, 30], [18, 26], [22, 24], [26, 26], [30, 23], [34, 25], [38, 23], [42, 26], [46, 24], [50, 30]]
      : [[13, 46], [17, 30], [21, 25], [25, 27], [29, 24], [33, 26], [37, 24], [41, 27], [45, 25], [48, 31], [51, 46]];
    const outside = short ? 24 : 40;
    for (let x = 12; x <= 51; x++) {
      const b = bangsBottom(x, tips, x < 16 || x > 47 ? outside : 21);
      if (b <= 21) continue;
      r(x, 21, 1, b - 21, P.hair);
      px(x, b - 1, P.hairD);
      if (b - 2 > 21) px(x, b - 2, mix(P.hair, P.hairD, 0.45));
    }
    // мягкие линии между прядями (только у кончиков)
    for (let i = 0; i < tips.length - 1; i++) {
      const mid = Math.round((tips[i][0] + tips[i + 1][0]) / 2);
      const valley = Math.min(tips[i][1], tips[i + 1][1]) - 4;
      r(mid, valley - 4, 1, 3, mix(P.hair, P.hairD, 0.6));
    }
    // тень от чёлки на лбу
    for (let x = 18; x <= 45; x++) {
      const b = bangsBottom(x, tips, 21);
      if (b > 21 && b < 30 && faceHalf(b) > 0) px(x, b, mix(P.skin, P.skinS, 0.6));
    }
    // блик-«нимб»: дуга с разрывами и искорки
    for (let x = 19; x <= 44; x++) {
      if ((x - 19) % 8 === 6) continue;
      const y = 11 + Math.round(((x - 31.5) / 12.5) ** 2 * 3);
      px(x, y, P.hairL);
      if ((x - 19) % 8 < 4) px(x, y + 1, P.hairL);
    }
    px(23, 10, P.hairLL);
    px(24, 10, P.hairLL);
    px(39, 11, P.hairLL);
    for (const [x, y] of [[15, 26], [48, 26]]) r(x, y, 1, 6, P.hairL); // блики на прядях у лица
    if (o.stage >= 4) for (const sx of [21, 40, 44]) r(sx, 15, 1, 9, tint(P.hair, 0.75));
    if (style === 'spiky') {
      for (const [x, y] of [[19, 2], [27, 0], [35, 1], [43, 3]]) {
        r(x, y, 3, 5, P.hair);
        px(x + 1, y, P.hairL);
      }
    } else if (style === 'messy') {
      for (const [x, y] of [[21, 2], [39, 3], [46, 6]]) r(x, y, 3, 4, P.hair);
    }
  }
  if (o.ears) {
    for (const [x0, dir] of [[14, 1], [41, -1]]) {
      for (let i = 0; i < 10; i++) {
        const w = 10 - i;
        const xs = dir > 0 ? x0 + Math.floor(i / 3) : x0 + 9 - w - Math.floor(i / 3) + 1;
        r(xs, 12 - i, w, 1, P.hair);
        if (i < 7 && w > 4) r(xs + 2, 12 - i, w - 4, 1, '#f6a6c0');
      }
    }
  }
  if (o.glasses) {
    const g = '#3a3a4a';
    for (const x0 of [18, 35]) {
      r(x0, 26, 11, 1, g);
      r(x0, 38, 11, 1, g);
      r(x0, 26, 1, 13, g);
      r(x0 + 10, 26, 1, 13, g);
    }
    r(29, 30, 6, 1, g);
    px(19, 27, '#ffffff');
    px(36, 27, '#ffffff');
  }
  if (o.stage >= 4 && !helmet) {
    r(18, 21, 28, 2, '#e8c050');
    r(30, 19, 4, 4, '#7ad0ff');
    px(30, 19, '#e8fbff');
  }
  portraitHat(r, px, o, P);
}

function portraitHat(r, px, o, P) {
  const h = o.hat;
  if (!h) return;
  if (h === 'bow') {
    const c = P.accent;
    r(42, 4, 7, 8, c); r(53, 4, 7, 8, c); r(48, 6, 6, 5, shade(c, 0.25));
    r(43, 5, 2, 2, tint(c, 0.45)); r(54, 5, 2, 2, tint(c, 0.45));
    r(46, 11, 3, 5, c); r(52, 11, 3, 5, c);
  } else if (h === 'gradcap') {
    r(6, 4, 52, 3, '#2a2a3a'); r(14, 7, 36, 6, '#3a3a4c'); r(30, 2, 4, 2, '#e8c050'); r(55, 6, 2, 12, '#e8c050'); r(54, 17, 4, 3, '#e8c050');
  } else if (h === 'bandana') {
    r(12, 6, 40, 9, '#d8404a');
    for (const [x, y] of [[18, 8], [26, 11], [34, 7], [42, 10], [48, 8]]) r(x, y, 2, 2, '#ffffff');
    r(4, 12, 9, 5, '#d8404a'); r(2, 16, 5, 3, '#c0303a');
  } else if (h === 'beret') {
    r(10, 2, 46, 8, P.accent); r(14, 0, 36, 2, P.accent); r(10, 10, 46, 2, shade(P.accent, 0.3)); r(31, 0, 2, 1, shade(P.accent, 0.4));
    r(16, 3, 8, 2, tint(P.accent, 0.3));
  } else if (h === 'headphones') {
    r(14, 1, 36, 3, '#3a3a46'); r(11, 3, 4, 8, '#3a3a46'); r(49, 3, 4, 8, '#3a3a46');
    r(6, 24, 8, 14, P.accent); r(50, 24, 8, 14, P.accent); r(7, 25, 3, 6, tint(P.accent, 0.4)); r(51, 25, 3, 6, tint(P.accent, 0.4));
  } else if (h === 'headband') {
    r(13, 17, 38, 4, '#f4f4f4'); r(13, 18, 38, 2, P.accent); r(4, 19, 10, 3, '#f4f4f4'); r(2, 22, 4, 5, '#f4f4f4');
  } else if (h === 'nursecap') {
    r(20, 2, 24, 9, '#ffffff'); r(30, 3, 4, 7, '#e04a5a'); r(27, 5, 10, 3, '#e04a5a'); r(20, 10, 24, 1, '#dcdcdc');
  } else if (h === 'straw') {
    r(0, 11, 64, 3, '#e8c46a'); r(2, 14, 60, 2, '#d8b058'); r(16, 0, 32, 11, '#f0d080'); r(16, 8, 32, 3, '#d84a3a');
    for (let x = 18; x < 46; x += 4) px(x, 3, '#d8b058');
  } else if (h === 'helmet') {
    r(10, 2, 44, 14, '#f2c230'); r(6, 15, 52, 3, '#d9a91e'); r(28, 4, 9, 7, '#fff2c0'); r(29, 5, 7, 5, '#fff7a8'); r(14, 4, 6, 3, '#fff2a0');
  } else if (h === 'hardhat') {
    r(10, 2, 44, 14, '#ff9a2a'); r(4, 15, 56, 3, '#e07a12'); r(29, 0, 6, 16, '#ffb75a'); r(14, 4, 6, 3, '#ffd0a0');
  } else if (h === 'hood') {
    const c = o.hood || '#2f6a2c';
    for (let y = 0; y < 50; y++) {
      const half = y < 8 ? 14 + y * 1.5 : 26;
      const inner = y < 14 ? 0 : faceHalf(y) + 3;
      if (inner <= 0) r(32 - Math.round(half), y, Math.round(half) * 2, 1, c);
      else {
        r(32 - Math.round(half), y, Math.round(half) - inner, 1, c);
        r(32 + inner, y, Math.round(half) - inner, 1, shade(c, 0.12));
      }
    }
    r(14, 2, 10, 3, tint(c, 0.2));
  } else if (h === 'witch') {
    r(0, 13, 64, 3, '#2e1d48'); r(6, 11, 52, 2, '#3b2560'); r(16, 9, 32, 3, '#c9a24a');
    for (let i = 0; i < 12; i++) {
      const w = Math.max(4, 30 - i * 2.4);
      r(Math.round(32 - w / 2 + i * 0.9), 8 - i, Math.round(w), 1, i % 4 === 1 ? '#4a2d75' : '#3b2560');
    }
    r(30, 10, 4, 3, '#f2d860');
  } else if (h === 'helmetK') {
    for (let y = 2; y < 46; y++) {
      const half = y < 10 ? 12 + y * 1.2 : 24;
      const inner = y < 20 ? 0 : y < 42 ? faceHalf(y) + 1 : 0;
      if (!inner) r(32 - Math.round(half), y, Math.round(half) * 2, 1, y < 20 ? '#b9c2cc' : '#9aa3ad');
      else {
        r(32 - Math.round(half), y, Math.round(half) - inner, 1, '#b9c2cc');
        r(32 + inner, y, Math.round(half) - inner, 1, '#8a939d');
      }
    }
    r(18, 18, 28, 2, '#8a939d'); r(14, 6, 6, 4, '#dfe6ee');
    r(28, 0, 8, 6, o.plume || '#d84040'); r(34, 2, 8, 4, o.plume || '#d84040');
    r(20, 20, 24, 3, P.hair);
  }
}

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
  const base = document.createElement('canvas');
  base.width = PW;
  base.height = PW;
  const c = base.getContext('2d');
  if (look) human(c, look, expr);
  else if (BEASTS[who.kind]) beast(c, who.kind, expr);
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
