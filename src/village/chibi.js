// Чиби-персонажи деревни (обновление 0.8): люди нарисованы вдвое мельче «пикселем», чем мир (1 пиксель чиби =
// ½ пикселя деревни), — так у них помещаются большие аниме-глаза с бликами, чёлка прядями, банты, наушники.
// Каждая поза рисуется один раз в маленький холст и кэшируется; обводка — тёмной линией по силуэту целиком.
//
// Координаты при рисовании — от точки у ног: x вправо (по взгляду), y вверх отрицательный. Спрайт 48 × 68,
// точка привязки (24, 62). look — внешность (village/keepers.js keeperLook или LOOKS ниже), pose — как у puppets.js.

export const CW = 48;
export const CH = 68;
export const AX = 24;
export const AY = 62;
const OUTLINE = '#1e1626';

const rgbCache = new Map();
function rgb(c) {
  let v = rgbCache.get(c);
  if (!v) {
    const h = c.replace('#', '');
    v = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    rgbCache.set(c, v);
  }
  return v;
}
const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
export function mix(a, b, t) {
  const p = rgb(a);
  const q = rgb(b);
  return '#' + hex2(p[0] + (q[0] - p[0]) * t) + hex2(p[1] + (q[1] - p[1]) * t) + hex2(p[2] + (q[2] - p[2]) * t);
}
export const shade = (c, t) => mix(c, '#000000', t);
export const tint = (c, t) => mix(c, '#ffffff', t);

/** Жители-люди из магазина в стиле чиби. */
export const LOOKS = {
  wanderer: { skin: '#f6d2b0', hair: '#6b4a2b', eyes: '#3f7a4a', style: 'messy', top: '#7d6a4f', bottom: 'pants', pants: '#4a3b2a', gender: 'm', stage: 2, cape: '#8a5a3a', tool: 'staff', hat: null },
  miner: { skin: '#efc49a', hair: '#3b2a1e', eyes: '#6a4a32', style: 'short', top: '#4f6e9c', bottom: 'pants', pants: '#3a4a66', gender: 'm', stage: 2, hat: 'helmet', tool: 'pickaxe', overalls: true },
  builder: { skin: '#f6d0a6', hair: '#a8582a', eyes: '#3f6fd0', style: 'ponytail', top: '#e8782a', bottom: 'pants', pants: '#36507a', gender: 'f', stage: 2, hat: 'hardhat', tool: 'hammer', vest: '#fff2a8' },
  archer: { skin: '#fbdcc0', hair: '#d07a30', eyes: '#2f9a6e', style: 'ponytail', top: '#3f7d3a', bottom: 'skirt', skirt: '#5a4630', gender: 'f', stage: 2, hat: 'hood', hood: '#2f6a2c', tool: 'bow' },
  witch: { skin: '#f4e2d6', hair: '#3a2858', eyes: '#c84a8a', style: 'long', top: '#5b3a8a', bottom: 'robe', gender: 'f', stage: 2, hat: 'witch', tool: 'broom' },
  knight: { skin: '#f0ccab', hair: '#5a5a66', eyes: '#3f6fd0', style: 'short', top: '#9aa3ad', bottom: 'pants', pants: '#6d757e', gender: 'm', stage: 3, hat: 'helmetK', plume: '#d84040', tool: 'sword', shield: '#3f62b0', armor: true },
  neko: { skin: '#ffe6d6', hair: '#b7a1ee', eyes: '#e0a020', style: 'twintails', top: '#8e7cd6', bottom: 'skirt', skirt: '#5d4fa8', gender: 'f', stage: 1, ears: true, tail: true, apron: true, hat: null },
};

/** Размеры тела по «возрасту» (ступени навыка): ноги, туловище, ширина. */
const DIM = [
  { leg: 4, body: 7, bw: 9 },
  { leg: 5, body: 8, bw: 10 },
  { leg: 6, body: 9, bw: 10 },
  { leg: 7, body: 10, bw: 11 },
  { leg: 7, body: 10, bw: 11 },
];

function palette(o) {
  const hair = o.hair || '#4a2f2a';
  const top = o.top || '#5c6bc0';
  const skin = o.skin || '#ffe3cf';
  const eyes = o.eyes || '#3f6fd0';
  return {
    skin, skinS: mix(skin, '#c97a6a', 0.3), blush: mix(skin, '#ff6f8a', 0.45),
    hair, hairD: shade(hair, 0.3), hairDD: shade(hair, 0.5), hairL: tint(hair, 0.38),
    eyes, irisD: shade(eyes, 0.45), irisL: tint(eyes, 0.4), pupil: shade(eyes, 0.75),
    top, topD: shade(top, 0.28), topL: tint(top, 0.22),
    skirt: o.skirt || shade(top, 0.42), pants: o.pants || '#3d4560', shoes: o.shoes || '#3a2a2a',
    accent: o.accent || (o.gender === 'm' ? '#3a4a8a' : '#e0506e'),
  };
}

/** Нарисовать чиби в холст c (без обводки). pose: { state, frame, blink, happy, night }. */
export function drawChibi(c, o, pose) {
  const P = palette(o);
  const r = (x, y, w, h, col) => {
    if (!col || w <= 0 || h <= 0) return;
    c.fillStyle = col;
    c.fillRect(AX + x, AY + y, w, h);
  };
  const px = (x, y, col) => r(x, y, 1, 1, col);
  const st = pose.state || 'idle';
  const f = pose.frame | 0;
  const D = DIM[Math.max(0, Math.min(4, o.stage ?? 1))];
  const sit = st === 'sit' || st === 'sleep' || st === 'fly' || st === 'pet' || st === 'fish' || st === 'gather';
  const walk = st === 'walk' || st === 'run' || st === 'held';
  const up = st === 'held' || st === 'fall'; // руки вверх: держат «рукой» или падает
  const bob = walk ? (f % 2) : st === 'idle' ? (f % 2) * 0 : 0;
  const lift = sit ? D.leg - 1 : 0; // сидя тело ниже
  const B = -(D.leg + D.body) + lift - bob; // верх туловища
  const F = B - 11; // верх лица
  const hl = -Math.floor(D.bw / 2); // левый край туловища
  const hr = hl + D.bw - 1; // правый край
  const robe = o.bottom === 'robe';

  // ---- сзади: плащ, длинные волосы, хвосты, кошачий хвост ----
  const cape = o.cape || (o.stage >= 3 ? shade(o.top || '#5c6bc0', 0.45) : null);
  if (cape) {
    const bottom = sit ? -1 : -2;
    for (let y = B + 1; y <= bottom; y++) {
      const k = Math.floor((y - B) / 4);
      r(hl - 1 - k, y, D.bw + 2 + k * 2, 1, y === bottom && o.stage >= 4 ? '#e8c050' : cape);
    }
  }
  if (o.style === 'long' || o.style === 'side') {
    const len = robe ? -3 : Math.min(-2, B + D.body - 1);
    r(-8, F + 2, 16, len - F - 1, P.hairD);
    for (let x = -8; x <= 7; x += 3) px(x, len + 1, P.hairD);
  } else if (o.style === 'bob') {
    r(-8, F + 2, 16, 10, P.hairD);
  } else if (o.style === 'twintails') {
    const swing = walk ? (f % 2 ? 1 : -1) : 0;
    for (const sx of [-1, 1]) {
      const x0 = sx < 0 ? -11 : 8;
      for (let y = F + 2; y <= B + D.body - 2; y++) {
        const k = y - (F + 2);
        const w = k < 3 ? 3 : k < 10 ? 3 : 2;
        const dx = Math.round(Math.sin(k / 3) * 0.8) + (k > 6 ? swing * sx : 0);
        r(x0 + dx + (sx < 0 ? 0 : 0), y, w, 1, k % 4 === 1 ? P.hair : P.hairD);
      }
      r(sx < 0 ? -10 : 8, F + 2, 2, 2, P.accent);
    }
  } else if (o.style === 'ponytail') {
    for (let y = F; y <= B + 3; y++) {
      const k = y - F;
      r(-11 + Math.round(Math.sin(k / 2.5)), y, k < 2 ? 2 : 3, 1, k % 3 === 0 ? P.hair : P.hairD);
    }
    px(-9, F + 1, P.accent);
  }
  if (o.tail) {
    const w = f % 2;
    r(hl - 3, B + D.body - 3, 2, 1, P.hair);
    r(hl - 5, B + D.body - 5 - w, 2, 3, P.hair);
    r(hl - 6, B + D.body - 8 - w, 2, 3, P.hair);
    px(hl - 6, B + D.body - 9 - w, P.hairL);
  }

  // ---- ноги ----
  if (sit) {
    const y = lift ? -2 : -2;
    r(-3, y - 1, 7, 2, o.bottom === 'pants' ? P.pants : P.skin);
    r(4, y - 1, 2, 2, P.shoes);
    if (st === 'fly') {
      r(-14, -1, 26, 1, '#7a5230');
      r(-17, -3, 4, 4, '#c9a24a');
      px(-17, -3, '#e0be66');
    }
  } else {
    const jump = st === 'jump' || st === 'fall';
    const liftL = st === 'held' ? f % 2 : walk && f === 1 ? 1 : 0;
    const liftR = st === 'held' ? 1 - (f % 2) : walk && f === 3 ? 1 : 0;
    const legs = [[-3, liftL], [1, liftR]];
    for (const [x, up] of legs) {
      const top = -D.leg;
      const bottomY = -1 - up - (jump ? 1 : 0);
      if (o.bottom === 'pants' || o.overalls || o.armor) {
        r(x, top, 2, bottomY - top - 1, P.pants);
      } else {
        r(x, top, 2, bottomY - top - 1, P.skin);
        r(x, Math.max(top, bottomY - 3), 2, 2, '#f4f0ea'); // гольфы
      }
      r(x, bottomY - 1, 3, 2, P.shoes);
      px(x + 2, bottomY - 1, tint(P.shoes, 0.25));
    }
  }

  // ---- туловище ----
  const waist = B + D.body - 4;
  r(hl + 1, B, D.bw - 2, 1, P.top); // плечи
  r(hl, B + 1, D.bw, D.body - 1, P.top);
  r(hr, B + 1, 1, D.body - 1, P.topD);
  if (o.armor) {
    r(hl, B + 1, D.bw, D.body - 1, '#b9c2cc');
    r(hl, B + 1, D.bw, 1, '#dfe6ee');
    r(hr, B + 1, 1, D.body - 1, '#8a939d');
    r(hl, waist + 1, D.bw, 1, '#6a5030');
    px(-1, waist + 1, '#e8c050');
  } else if (o.overalls) {
    r(hl + 2, B + 3, D.bw - 4, D.body - 3, P.pants);
    px(hl + 2, B + 2, P.pants);
    px(hr - 2, B + 2, P.pants);
    px(hl + 3, B + 4, '#e8c050');
    px(hr - 3, B + 4, '#e8c050');
  } else if (o.vest) {
    r(hl, B + 1, 3, D.body - 2, o.vest);
    r(hr - 2, B + 1, 3, D.body - 2, o.vest);
    r(hl, B + 4, D.bw, 1, tint(o.vest, 0.5));
  }
  // воротник и бант / галстук
  if (!o.armor) {
    r(-2, B, 4, 2, '#f6f2ea');
    px(-3, B, '#f6f2ea');
    px(2, B, '#f6f2ea');
    if (o.tie) r(-1, B + 1, 2, D.body - 3, '#2a2a3a');
    else if (o.gender !== 'm' || o.stage < 2) {
      r(-2, B + 1, 1, 2, P.accent);
      r(1, B + 1, 1, 2, P.accent);
      r(-1, B + 1, 2, 1, shade(P.accent, 0.2));
    }
  }
  if (o.apron) {
    r(-3, B + 3, 6, D.body - 2 + (o.bottom === 'skirt' ? 3 : 0), '#fbf8f2');
    r(-3, B + 3, 6, 1, '#e6e0d6');
  }
  if (o.sporty) {
    r(hl, B + 2, D.bw, 1, '#ffffff');
  }
  if (o.role === 'health') {
    r(-1, B + 3, 2, 2, '#e04a5a');
    px(-2, B + 3, '#e04a5a');
    px(1, B + 3, '#e04a5a');
  }
  // юбка / ряса / брюки до пояса
  if (o.bottom === 'skirt' && !sit) {
    for (let i = 0; i < 4; i++) r(hl - Math.floor(i / 2), waist + i, D.bw + Math.floor(i / 2) * 2, 1, i === 3 ? tint(P.skirt, 0.18) : P.skirt);
    px(hl + 2, waist + 1, shade(P.skirt, 0.25));
    px(hr - 2, waist + 2, shade(P.skirt, 0.25));
  } else if (o.bottom === 'skirt') {
    r(hl - 1, waist, D.bw + 4, 3, P.skirt);
  } else if (robe) {
    const end = sit ? -2 : -2;
    for (let y = waist; y <= end; y++) {
      const k = Math.floor((y - waist) / 3);
      r(hl - k, y, D.bw + k * 2, 1, y === end ? tint(P.top, 0.15) : P.top);
    }
    r(hl, waist, D.bw, 1, '#c9a24a');
  } else {
    r(hl, waist, D.bw, 1, shade(P.pants, 0.3));
  }

  // ---- руки ----
  const sleeve = o.armor ? '#9aa3ad' : P.top;
  const armY = B + 1;
  const armL = D.body - 3;
  const swing = walk ? (f === 1 ? 1 : f === 3 ? -1 : 0) : 0;
  const t2 = f % 2;
  // левая (дальняя) рука
  if (up) {
    r(hl - 2, armY - 6 - (f % 2), 2, 6, sleeve);
    r(hl - 2, armY - 8 - (f % 2), 2, 2, P.skin);
  } else if (st === 'jump' || st === 'dance') {
    const up = st === 'dance' ? t2 : 1;
    r(hl - 2, armY - 3 - up * 2, 2, 4, sleeve);
    r(hl - 2, armY - 5 - up * 2, 2, 2, P.skin);
  } else {
    r(hl - 2, armY + swing, 2, armL, sleeve);
    r(hl - 2, armY + armL + swing, 2, 2, P.skin);
  }

  // ---- голова ----
  const tilt = st === 'sleep' ? 1 : 0;
  const Fy = F + tilt;
  const face = [[-6, 12], [-7, 14], [-7, 14], [-7, 14], [-7, 14], [-7, 14], [-7, 14], [-7, 14], [-7, 14], [-6, 12], [-4, 10], [-2, 6]];
  face.forEach(([x0, w], i) => r(x0 + (i >= 10 ? 1 : 0), Fy + i, w, 1, P.skin));
  r(-6, Fy + 8, 2, 2, P.skinS); // тень у дальней щеки
  // глаза
  const closed = st === 'sleep' || pose.blink;
  const smileEyes = pose.happy && (st === 'celebrate' || st === 'dance' || st === 'wave' || st === 'jump');
  for (const ex of [-4, 2]) {
    const ey = Fy + 5;
    if (closed) {
      px(ex, ey + 2, OUTLINE);
      px(ex + 1, ey + 3, OUTLINE);
      px(ex + 2, ey + 2, OUTLINE);
    } else if (smileEyes) {
      px(ex, ey + 3, OUTLINE);
      px(ex + 1, ey + 2, OUTLINE);
      px(ex + 2, ey + 3, OUTLINE);
    } else {
      r(ex, ey, 3, 1, OUTLINE); // ресницы
      px(ex === -4 ? ex - 1 : ex + 3, ey, OUTLINE);
      px(ex, ey + 1, '#ffffff');
      px(ex + 1, ey + 1, P.irisD);
      px(ex + 2, ey + 1, P.irisD);
      px(ex, ey + 2, P.eyes);
      px(ex + 1, ey + 2, P.pupil);
      px(ex + 2, ey + 2, P.eyes);
      r(ex, ey + 3, 3, 1, P.irisL);
      if (ex === 2) px(ex + 2, ey + 1, P.irisD);
    }
  }
  // румянец и рот
  if (pose.happy || o.blush) {
    px(-6, Fy + 9, P.blush);
    px(-5, Fy + 9, P.blush);
    px(4, Fy + 9, P.blush);
    px(5, Fy + 9, P.blush);
  }
  if (st === 'sleep') px(0, Fy + 10, '#b0605a');
  else if (up) {
    r(0, Fy + 10, 2, 2, '#7a2a3a');
  } else if (st === 'fish' || st === 'gather' || st === 'bucket') {
    r(0, Fy + 10, 2, 1, '#a0504a');
  }
  else if (pose.happy || st === 'wave' || st === 'greet' || st === 'dance' || st === 'jump') {
    r(0, Fy + 10, 2, 1, '#8a2a3a');
    r(0, Fy + 11, 2, 1, '#e87a8a');
  } else if (pose.sad) {
    px(0, Fy + 10, '#8a3a3a');
    px(-1, Fy + 11, '#8a3a3a');
    px(1, Fy + 11, '#8a3a3a');
  } else {
    r(0, Fy + 10, 2, 1, '#a0504a');
  }

  // ---- волосы спереди ----
  if (o.hat !== 'helmetK') {
    r(-4, Fy - 3, 8, 1, P.hair);
    r(-6, Fy - 2, 12, 1, P.hair);
    r(-7, Fy - 1, 14, 1, P.hair);
    const bangs = o.style === 'spiky' || o.style === 'messy'
      ? [8, 5, 3, 4, 2, 3, 2, 3, 2, 3, 4, 3, 5, 8]
      : [9, 6, 4, 4, 3, 4, 2, 3, 4, 3, 4, 4, 5, 9];
    const short = o.style === 'short' || o.style === 'spiky' || o.style === 'messy';
    bangs.forEach((b, i) => {
      const x = -7 + i;
      const len = short && (i === 0 || i === 13) ? 6 : b;
      r(x, Fy, 1, len, P.hair);
      px(x, Fy + len - 1, P.hairD);
    });
    // пряди по бокам лица
    const side = short ? 6 : o.style === 'bob' ? 11 : 10;
    r(-8, Fy + 1, 1, side, P.hairD);
    r(7, Fy + 1, 1, side, P.hairD);
    if (!short) {
      px(-8, Fy + side + 1, P.hairD);
      px(7, Fy + side + 1, P.hairD);
    }
    // макушка-«нимб» — блик
    r(-4, Fy - 1, 2, 1, P.hairL);
    r(0, Fy - 1, 3, 1, P.hairL);
    px(-3, Fy - 2, P.hairL);
    px(1, Fy - 2, tint(P.hair, 0.55));
    px(-6, Fy + 3, P.hairL);
    if (o.style === 'spiky') {
      for (const sx of [-5, -2, 1, 4]) px(sx, Fy - 4, P.hair);
      px(-2, Fy - 5, P.hair);
    } else if (o.style === 'messy') {
      px(-6, Fy - 3, P.hair);
      px(3, Fy - 4, P.hair);
      px(4, Fy - 3, P.hair);
    } else if (o.style === 'bun') {
      for (const bx of [-6, 3]) {
        r(bx, Fy - 6, 3, 3, P.hair);
        px(bx + 1, Fy - 6, P.hairL);
      }
    } else if (o.style === 'side') {
      r(8, Fy + 2, 3, 8, P.hairD);
      r(8, Fy + 2, 2, 1, P.accent);
    }
  }
  if (o.ears) {
    for (const ex of [-6, 3]) {
      r(ex, Fy - 4, 3, 2, P.hair);
      px(ex + 1, Fy - 5, P.hair);
      px(ex + 1, Fy - 4, '#f6a6c0');
    }
  }
  // очки
  if (o.glasses) {
    const g = '#3a3a4a';
    for (const ex of [-4, 2]) {
      r(ex - 1, Fy + 4, 5, 1, g);
      r(ex - 1, Fy + 9, 5, 1, g);
      px(ex - 1, Fy + 5, g);
      px(ex + 3, Fy + 5, g);
      px(ex - 1, Fy + 8, g);
      px(ex + 3, Fy + 8, g);
    }
    px(0, Fy + 6, g);
    px(1, Fy + 6, g);
  }
  if (o.stage >= 4) {
    r(-6, Fy + 1, 12, 1, '#e8c050');
    px(-1, Fy, '#7ad0ff');
    px(0, Fy, '#7ad0ff');
    px(-5, Fy - 1, '#f4f4f8');
    px(4, Fy - 2, '#f4f4f8');
  }
  hat(r, px, o, P, Fy, pose);

  // ---- правая (ближняя) рука и предмет ----
  const RX = hr + 1;
  if (up) {
    r(RX, armY - 6 - (1 - (f % 2)), 2, 6, sleeve);
    r(RX, armY - 8 - (1 - (f % 2)), 2, 2, P.skin);
  } else if (st === 'pet') {
    r(RX, armY + 2, 4, 2, sleeve);
    r(RX + 4, armY + 2 + t2, 2, 2, P.skin);
  } else if (st === 'fish') {
    r(RX, armY, 3, 2, sleeve);
    r(RX + 3, armY - 1, 2, 2, P.skin);
  } else if (st === 'wave' || st === 'greet') {
    r(RX, armY - 4, 2, 5, sleeve);
    r(RX + t2, armY - 7, 2, 3, P.skin);
  } else if (st === 'knock') {
    r(RX, armY + 1, 3 + t2, 2, sleeve);
    r(RX + 3 + t2, armY + 1, 2, 2, P.skin);
  } else if (st === 'jump' || st === 'dance') {
    const up = st === 'dance' ? 1 - t2 : 1;
    r(RX, armY - 3 - up * 2, 2, 4, sleeve);
    r(RX, armY - 5 - up * 2, 2, 2, P.skin);
  } else if (st === 'work') {
    r(RX, armY - (t2 ? 3 : 0), 2, 4, sleeve);
    r(RX, armY - (t2 ? 5 : -4), 2, 2, P.skin);
  } else {
    r(RX, armY - swing, 2, armL, sleeve);
    r(RX, armY + armL - swing, 2, 2, P.skin);
  }
  const hand = st === 'work' ? { x: RX, y: armY - (t2 ? 5 : -4) } : { x: RX, y: armY + armL - swing };
  if (['fish', 'bucket', 'water', 'gather'].includes(st)) choreItem(r, px, st, t2, { x: RX, y: armY }, hl, B, D);
  else if ((!sit || st === 'fly') && !up && st !== 'pet') item(r, px, o, P, hand, st, t2, armY, hl, B, D);
  if (o.shield && !sit) {
    r(hl - 5, B + 2, 4, 6, o.shield);
    r(hl - 5, B + 2, 4, 1, tint(o.shield, 0.3));
    r(hl - 4, B + 4, 2, 2, '#e8c050');
  }
}

/** Вещи для дел у объектов (0.9): удочка, ведро, лейка, корзинка. */
function choreItem(r, px, st, t2, h, hl, B, D) {
  const wood = '#7a5230';
  if (st === 'fish') {
    // удочка вперёд, леска вниз к поплавку
    for (let i = 0; i < 12; i++) px(h.x + 4 + i, h.y - 2 - Math.floor(i * 0.7), wood);
    const tipX = h.x + 15;
    const tipY = h.y - 10;
    for (let i = 1; i < 14; i++) px(tipX + Math.floor(i / 5), tipY + i, '#dfe6ee');
    r(tipX + 2, tipY + 14 + t2, 2, 2, '#e04a4a');
    px(tipX + 2, tipY + 14 + t2, '#ffffff');
  } else if (st === 'bucket') {
    // тянет ведро за верёвку
    r(h.x, h.y + (t2 ? 0 : 3), 2, 5, '#c8b89a');
    r(h.x - 1, h.y + (t2 ? 5 : 8), 5, 4, '#8a8f96');
    r(h.x - 1, h.y + (t2 ? 5 : 8), 5, 1, '#b8c0c8');
    px(h.x + 1, h.y + (t2 ? 6 : 9), '#7ad0ff');
  } else if (st === 'water') {
    // лейка наклонена, из носика капли
    r(h.x, h.y + 3, 5, 4, '#3f9a7a');
    r(h.x, h.y + 3, 5, 1, '#6ac8a0');
    for (let i = 0; i < 4; i++) px(h.x + 5 + i, h.y + 4 - Math.floor(i / 2), '#3f9a7a');
    px(h.x + 10, h.y + 4 + t2, '#7ad0ff');
    px(h.x + 11, h.y + 6 - t2, '#7ad0ff');
    r(h.x + 1, h.y + 1, 3, 2, '#2f7a5a');
  } else if (st === 'gather') {
    // корзинка рядом
    r(h.x + 1, -6, 7, 5, '#a8783a');
    r(h.x + 1, -6, 7, 1, '#c89a5a');
    for (let x = h.x + 2; x < h.x + 8; x += 2) px(x, -4, '#7a5228');
    px(h.x + 3, -7, '#d84a3a');
    px(h.x + 5, -7, '#e8c040');
    px(h.x + 6, -8, '#d84a3a');
    for (let i = 0; i < 5; i++) px(h.x + 1 + i + (i > 2 ? 1 : 0), -7 - Math.round(Math.sin((i / 4) * Math.PI) * 4), '#8a5a2a');
  }
}

/** Головные уборы. */
function hat(r, px, o, P, F, pose) {
  const h = o.hat;
  if (!h) return;
  if (h === 'bow') {
    const c = P.accent;
    r(3, F - 4, 2, 3, c);
    r(7, F - 4, 2, 3, c);
    r(5, F - 3, 2, 2, shade(c, 0.25));
    px(3, F - 4, tint(c, 0.4));
    px(7, F - 4, tint(c, 0.4));
  } else if (h === 'gradcap') {
    r(-8, F - 5, 16, 1, '#2a2a3a');
    r(-6, F - 4, 12, 2, '#3a3a4c');
    px(-1, F - 6, '#e8c050');
    r(7, F - 5, 1, 4, '#e8c050');
  } else if (h === 'bandana') {
    r(-7, F - 3, 14, 3, '#d8404a');
    px(-4, F - 2, '#ffffff');
    px(0, F - 3, '#ffffff');
    px(3, F - 2, '#ffffff');
    r(-10, F - 1, 3, 2, '#d8404a');
  } else if (h === 'beret') {
    r(-7, F - 4, 14, 2, P.accent);
    r(-5, F - 5, 11, 1, P.accent);
    px(1, F - 6, shade(P.accent, 0.3));
    r(-7, F - 2, 14, 1, shade(P.accent, 0.3));
  } else if (h === 'headphones') {
    r(-6, F - 4, 12, 1, '#3a3a46');
    px(-7, F - 3, '#3a3a46');
    px(6, F - 3, '#3a3a46');
    r(-10, F + 3, 3, 4, P.accent);
    r(8, F + 3, 3, 4, P.accent);
    px(-9, F + 3, tint(P.accent, 0.4));
    px(9, F + 3, tint(P.accent, 0.4));
  } else if (h === 'headband') {
    r(-7, F + 1, 14, 2, '#f4f4f4');
    r(-6, F + 1, 12, 1, P.accent);
    r(-10, F + 2, 3, 1, '#f4f4f4');
    px(-11, F + 3, '#f4f4f4');
  } else if (h === 'nursecap') {
    r(-4, F - 5, 8, 3, '#ffffff');
    px(-1, F - 4, '#e04a5a');
    px(0, F - 4, '#e04a5a');
    px(-1, F - 5, '#e04a5a');
    px(-1, F - 3, '#e04a5a');
  } else if (h === 'straw') {
    r(-11, F - 2, 22, 1, '#e8c46a');
    r(-9, F - 1, 18, 1, '#d8b058');
    r(-5, F - 6, 10, 4, '#f0d080');
    r(-5, F - 3, 10, 1, '#d84a3a');
  } else if (h === 'helmet') {
    r(-7, F - 5, 14, 4, '#f2c230');
    r(-8, F - 1, 16, 1, '#d9a91e');
    r(-6, F - 6, 12, 1, '#f2c230');
    r(2, F - 4, 3, 2, pose.night ? '#fff7a8' : '#fff2c0');
    px(-5, F - 5, '#fff2a0');
  } else if (h === 'hardhat') {
    r(-7, F - 5, 14, 4, '#ff9a2a');
    r(-6, F - 6, 12, 1, '#ff9a2a');
    r(-9, F - 1, 18, 1, '#e07a12');
    r(-1, F - 6, 2, 5, '#ffb75a');
  } else if (h === 'hood') {
    const c = o.hood || '#2f6a2c';
    r(-8, F - 4, 16, 4, c);
    r(-9, F - 1, 2, 11, c);
    r(7, F - 1, 2, 11, c);
    r(-6, F - 5, 12, 1, c);
    px(-3, F - 4, tint(c, 0.25));
    px(-2, F - 4, tint(c, 0.25));
  } else if (h === 'witch') {
    r(-12, F - 2, 24, 1, '#2e1d48');
    r(-9, F - 3, 18, 1, '#3b2560');
    r(-6, F - 4, 12, 1, '#c9a24a');
    for (let i = 0; i < 9; i++) {
      const w = Math.max(2, 10 - i);
      r(-Math.floor(w / 2) + Math.floor(i / 3), F - 5 - i, w, 1, i % 4 === 1 ? '#4a2d75' : '#3b2560');
    }
    r(3, F - 14, 2, 1, '#3b2560');
    px(5, F - 13, '#3b2560');
    px(-1, F - 7, '#f2d860');
  } else if (h === 'helmetK') {
    r(-8, F - 4, 16, 6, '#b9c2cc');
    r(-8, F + 2, 2, 9, '#b9c2cc');
    r(6, F + 2, 2, 9, '#9aa3ad');
    r(-7, F - 5, 14, 1, '#dfe6ee');
    r(-6, F + 1, 12, 1, '#8a939d');
    px(-4, F - 3, '#ffffff');
    r(-1, F - 9, 2, 4, o.plume || '#d84040');
    r(1, F - 8, 2, 2, o.plume || '#d84040');
    r(-6, F - 2, 12, 1, P.hair);
  }
}

/** Предмет в руке: инструменты жителей и вещи хранителей. */
function item(r, px, o, P, h, st, t2, armY, hl, B) {
  const work = st === 'work';
  const wood = '#7a5230';
  const x = h.x;
  const y = h.y;
  switch (o.tool || o.prop) {
    case 'staff':
      r(x + 2, y - 18, 1, 22, wood);
      r(x + 1, y - 21, 3, 3, '#7fd6ff');
      px(x + 2, y - 21, '#e8fbff');
      break;
    case 'pickaxe':
      if (work && t2) { r(x + 1, y - 7, 1, 8, wood); r(x - 2, y - 8, 7, 1, '#b8c0c8'); px(x - 3, y - 7, '#b8c0c8'); px(x + 5, y - 7, '#b8c0c8'); } else { r(x + 2, y - 1, 6, 1, wood); r(x + 7, y - 4, 1, 7, '#b8c0c8'); }
      break;
    case 'hammer':
      if (work && t2) { r(x + 1, y - 6, 1, 7, wood); r(x - 1, y - 8, 5, 3, '#8a8f96'); } else { r(x + 2, y, 5, 1, wood); r(x + 6, y - 2, 3, 4, '#8a8f96'); }
      break;
    case 'bow':
      if (work) { r(x + 4, y - 8, 1, 14, '#8a5a2a'); px(x + 3, y - 8, '#8a5a2a'); px(x + 3, y + 5, '#8a5a2a'); r(x + 2, y - 1, 2, 1, '#dddddd'); } else r(hl - 4, B + 1, 1, 12, '#8a5a2a');
      break;
    case 'broom':
      if (st !== 'fly') { r(hl - 4, B - 4, 1, 22, wood); r(hl - 6, B + 15, 5, 3, '#c9a24a'); }
      break;
    case 'sword':
      if (work && t2) { r(x + 1, y - 12, 1, 10, '#dfe6ee'); r(x - 1, y - 2, 5, 1, '#c9a24a'); } else { r(x + 1, y + 2, 1, 9, '#dfe6ee'); r(x - 1, y + 1, 5, 1, '#c9a24a'); }
      break;
    case 'book':
      if (work) { r(x - 9, y + 1, 9, 5, '#f4efe2'); r(x - 5, y + 1, 1, 5, '#c8bfa8'); r(x - 9, y + 6, 9, 1, P.accent); }
      else { r(x, y - 2, 4, 5, P.accent); r(x + 3, y - 2, 1, 5, '#f4efe2'); }
      break;
    case 'camera':
      r(x - 1, y - 3, 5, 4, '#2a2a34');
      px(x + 2, y - 2, '#7ad0ff');
      px(x, y - 4, '#e04a5a');
      break;
    case 'gamepad':
      r(x - 2, y - 1, 6, 3, '#4a4a58');
      px(x - 1, y, '#e8e8f0');
      px(x + 2, y - 1, '#e04a5a');
      px(x + 3, y, '#4ac080');
      break;
    case 'ball':
      r(x, y - 2, 3, 3, '#ff8a3a');
      px(x, y - 2, '#ffc08a');
      px(x + 1, y - 1, '#a84a1a');
      break;
    case 'folder':
      r(x, y - 3, 4, 6, '#e8c890');
      r(x, y - 3, 4, 1, '#c8a060');
      break;
    case 'brush':
      r(x + 1, y - 6, 1, 7, wood);
      r(x + 1, y - 8, 1, 2, '#e04a8a');
      break;
    case 'note':
      if (work) { r(x + 2, y - 10, 1, 5, '#7ab8ff'); r(x, y - 7, 2, 2, '#7ab8ff'); px(x + 3, y - 10, '#7ab8ff'); }
      else { r(x, y - 3, 3, 4, '#c8783a'); r(x + 1, y - 7, 1, 4, '#5a3a20'); }
      break;
    case 'heart':
      px(x, y - 2, '#ff5c7a'); px(x + 2, y - 2, '#ff5c7a'); r(x, y - 1, 3, 1, '#ff5c7a'); px(x + 1, y, '#ff5c7a');
      break;
    case 'flower':
      r(x + 1, y - 4, 1, 5, '#3a8a3a');
      r(x, y - 6, 3, 2, '#ff7aa8');
      px(x + 1, y - 6, '#ffe070');
      break;
    case 'broomsmall':
      r(x + 1, y - 6, 1, 9, wood);
      r(x, y + 3, 3, 2, '#c9a24a');
      break;
    case 'map':
      r(x, y - 2, 4, 3, '#f0e2b8');
      px(x + 1, y - 1, '#d84a3a');
      break;
    default:
  }
}

// ---------- Кэш спрайтов с обводкой ----------

const cache = new Map();
let mk = null;

function canvas(w, h) {
  if (mk) return mk(w, h);
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return cv;
}

/** Для тестов и рисования вне браузера можно подменить создание холстов. */
export function setCanvasFactory(fn) {
  mk = fn;
}

/** Ключ внешности (для кэша). */
export const lookKey = (o) => JSON.stringify(o);

/**
 * Спрайт чиби с обводкой: { cv, ax, ay } (смотрит вправо; dir < 0 — зеркальный, тот же якорь).
 * key — lookKey(look), pose — { state, frame, blink, happy, sad, night }.
 */
export function chibiSprite(look, key, pose, dir = 1) {
  const k = `${key}|${pose.state}|${pose.frame | 0}|${pose.blink ? 1 : 0}|${pose.happy ? 1 : 0}|${pose.sad ? 1 : 0}|${pose.night ? 1 : 0}`;
  return outlined(k, (c) => drawChibi(c, look, pose), dir);
}

/** Спрайт с обводкой по силуэту из функции рисования draw(ctx) (0.9: общий для чиби и зверей), с кэшем по ключу. */
export function outlined(key, draw, dir = 1) {
  const k = `${key}|${dir < 0 ? 'L' : 'R'}`;
  let s = cache.get(k);
  if (s) return s;
  if (cache.size > 1400) cache.clear();
  const base = canvas(CW, CH);
  draw(base.getContext('2d'));
  const out = canvas(CW, CH);
  const c = out.getContext('2d');
  if (dir < 0) {
    c.translate(CW, 0);
    c.scale(-1, 1);
  }
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) c.drawImage(base, dx, dy);
  c.globalCompositeOperation = 'source-in';
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = OUTLINE;
  c.fillRect(0, 0, CW, CH);
  c.globalCompositeOperation = 'source-over';
  if (dir < 0) {
    c.translate(CW, 0);
    c.scale(-1, 1);
  }
  c.drawImage(base, 0, 0);
  c.setTransform(1, 0, 0, 1, 0, 0);
  s = { cv: out, ax: AX, ay: AY };
  cache.set(k, s);
  return s;
}

/** Кадр позы по состоянию жителя (для кэша). */
export function poseOf(a, night) {
  const st = a.state || 'idle';
  const t = a.anim || 0;
  let frame = 0;
  if (st === 'walk' || st === 'run') frame = Math.floor((a.phase || 0) * 4) % 4;
  else if (['wave', 'greet', 'knock', 'dance', 'work'].includes(st)) frame = Math.floor(t * 5) % 2;
  else if (st === 'held') frame = Math.floor(t * 6) % 2;
  else if (['pet', 'fish', 'bucket', 'water', 'gather'].includes(st)) frame = Math.floor(t * 2.5) % 2;
  const blink = st !== 'sleep' && (t + (a.n || 0) * 1.7) % 4.2 < 0.14;
  return { state: st, frame, blink, happy: !!a.happy, sad: !!a.sad, night: night > 0.5 };
}

/** Высота чиби над землёй в пикселях деревни (для облачков и кликов). */
export const CHIBI_H = 16;
