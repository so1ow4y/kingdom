// Звери деревни (обновление 0.9): кот, котёнок, лиса, слизнюк, грибочек, призрак, паучок и дракончик в той же
// двойной плотности пикселей, что и чиби (village/chibi.js), с обводкой по силуэту. Голова — «анфас» с большими
// глазами и бликом (так милее), тело — сбоку по взгляду. Позы: idle, walk/run (4 кадра), sit, sleep (клубочком),
// jump, held/fall, fly (призрак, дракончик), work (лиса роет).

import { AX, AY, CW, CH, outlined, mix, shade, tint } from './chibi.js';

export const CRITTERS = new Set(['cat', 'kitten', 'fox', 'slime', 'shroom', 'ghost', 'spider', 'dragon']);

const EYE = '#2a1e2a';

function pen(c) {
  const r = (x, y, w, h, col) => {
    if (!col || w <= 0 || h <= 0) return;
    c.fillStyle = col;
    c.fillRect(AX + Math.round(x), AY + Math.round(y), Math.round(w), Math.round(h));
  };
  const px = (x, y, col) => r(x, y, 1, 1, col);
  const ell = (cx, cy, rx, ry, col) => {
    for (let y = -Math.ceil(ry); y <= Math.ceil(ry); y++) {
      const k = 1 - (y * y) / (ry * ry);
      if (k < 0) continue;
      const w = Math.round(rx * Math.sqrt(k));
      r(cx - w, cy + y, w * 2 + 1, 1, col);
    }
  };
  return { r, px, ell };
}

/** Глаза «анфас»: два глаза 2 × 3 с бликом; closed — дужками. */
function eyes(px, r, cx, cy, gap, closed, col = EYE) {
  for (const ex of [cx - gap, cx + gap - 1]) {
    if (closed) {
      px(ex - 1, cy + 1, col);
      px(ex, cy + 2, col);
      px(ex + 1, cy + 1, col);
      continue;
    }
    r(ex - 1, cy, 3, 3, col);
    px(ex - 1, cy, '#ffffff');
    px(ex + 1, cy + 2, mix(col, '#ffffff', 0.35));
  }
}

const PAL = {
  cat: { fur: '#f2a556', dark: '#c8702a', light: '#fde8c8', ear: '#f6a6b0', nose: '#e87a8a', stripes: true },
  kitten: { fur: '#a8b4d8', dark: '#7a88b8', light: '#eef0fa', ear: '#f6b0c0', nose: '#f08aa0', small: true },
  fox: { fur: '#f08a3a', dark: '#5a3420', light: '#fff4e6', ear: '#5a3420', nose: '#2a2020', fox: true },
};

function feline(p, kind, st, f, happy) {
  const { r, px, ell } = p;
  const o = PAL[kind];
  const s = o.small ? 0.8 : 1;
  const sleep = st === 'sleep';
  const sit = st === 'sit';
  const jump = st === 'jump' || st === 'fall' || st === 'held';
  const walk = st === 'walk' || st === 'run';
  const wag = f % 2 ? 1 : -1;
  if (sleep) {
    // клубочком: хвост вокруг, голова на лапках
    ell(-1, -4, 9 * s, 4 * s, o.fur);
    ell(-1, -3, 7 * s, 2 * s, o.light);
    r(-9 * s, -2, 14 * s, 2, o.fox ? o.fur : o.dark);
    if (o.fox) r(-10 * s, -2, 3, 2, o.light);
    ell(5 * s, -5, 4.5 * s, 3.5 * s, o.fur);
    r(3 * s, -9 * s, 2, 2, o.fur);
    r(7 * s, -9 * s, 2, 2, o.fur);
    eyes(px, r, 5 * s, -6, 2, true);
    px(5 * s, -3, o.nose);
    if (o.stripes) for (const x of [-5, -2, 1]) r(x * s, -8 * s, 1, 2, o.dark);
    return;
  }
  const by = sit ? -3 : 0;
  // хвост
  if (o.fox) {
    const ty = sit ? -4 : -8 - (walk ? wag : 0);
    ell(-11 * s, ty, 5 * s, 3 * s, o.fur);
    ell(-14 * s, ty - 1, 2.5 * s, 2 * s, o.light);
  } else {
    const t0 = sit ? [-7, -3] : [-8, -7];
    for (let i = 0; i < 6; i++) r((t0[0] - i * 0.7) * s, (t0[1] - i * 1.4 - (i > 3 ? wag : 0)) * s, 2, 2, i > 4 ? o.dark : o.fur);
  }
  // тело и лапы
  if (sit) {
    ell(0, -7 * s, 5 * s, 6 * s, o.fur);
    ell(1 * s, -6 * s, 3 * s, 4 * s, o.light);
    r(-2 * s, -2, 2, 2, o.fox ? o.dark : o.fur);
    r(2 * s, -2, 2, 2, o.fox ? o.dark : o.fur);
  } else {
    ell(-1 * s, -6 * s + (jump ? -2 : 0), 8 * s, 4 * s, o.fur);
    ell(0, -4 * s + (jump ? -2 : 0), 5 * s, 2 * s, o.light);
    const legs = [-6, -3, 2, 5];
    legs.forEach((x, i) => {
      const lift = walk ? ((i + f) % 2) : 0;
      const h = jump ? 2 : 3 - lift;
      r(x * s, -3 - (jump ? 2 : 0) - (lift ? 1 : 0) + (jump ? 0 : 0), 2, h, o.fox ? o.dark : i % 2 ? o.fur : mix(o.fur, o.dark, 0.25));
    });
  }
  if (o.stripes && !sit) for (const x of [-5, -2, 1]) r(x * s, -10 * s + (jump ? -2 : 0), 1, 3, o.dark);
  // голова анфас
  const hx = sit ? 1 * s : 6 * s;
  const hy = (sit ? -15 : -12) * s + (jump ? -2 : 0) + by * 0;
  ell(hx, hy, 5.5 * s, 4.5 * s, o.fur);
  if (o.fox) {
    ell(hx - 3 * s, hy + 2, 2.5 * s, 2 * s, o.light);
    ell(hx + 3 * s, hy + 2, 2.5 * s, 2 * s, o.light);
  } else ell(hx, hy + 2, 3 * s, 2 * s, o.light);
  // уши
  for (const ex of [hx - 4 * s, hx + 2 * s]) {
    const eh = o.fox ? 5 : 4;
    for (let i = 0; i < eh; i++) r(ex + (i >= eh - 1 ? 1 : 0), hy - 4 * s - i, Math.max(1, 3 - Math.floor(i / 2)), 1, o.fox && i > eh - 3 ? o.dark : o.fur);
    px(ex + 1, hy - 4 * s - 1, o.ear);
  }
  if (o.stripes) {
    px(hx - 1, hy - 4, o.dark);
    px(hx + 1, hy - 4, o.dark);
  }
  eyes(px, r, hx, hy - 1, 3 * s, happy && st !== 'walk');
  r(hx - 1, hy + 2, 2, 1, o.nose);
  px(hx - 2, hy + 3, shade(o.fur, 0.5));
  px(hx + 1, hy + 3, shade(o.fur, 0.5));
  if (happy) {
    px(hx - 5 * s, hy + 1, '#f6a0b0');
    px(hx + 5 * s - 1, hy + 1, '#f6a0b0');
  }
  if (st === 'work') for (let i = 0; i < 3; i++) px(hx + 3 + i * 2, -1 - (f + i) % 2, '#8a6040');
}

function slime(p, st, f, happy, squash) {
  const { r, px, ell } = p;
  const sq = st === 'jump' ? -1 : squash ? 1 : f % 2 && st === 'walk' ? 0.5 : 0;
  const rx = 8 + sq * 2;
  const ry = 6 - sq * 1.5;
  ell(0, -ry, rx, ry, '#4cbf5a');
  ell(-1, -ry - 1, rx - 2, ry - 2, '#6ad878');
  r(-rx + 1, -2, rx * 2 - 1, 2, '#3a9a48');
  ell(-4, -ry * 1.5, 2, 1.2, '#d8ffd8');
  px(3, -ry * 1.6, '#d8ffd8');
  eyes(px, r, 1, -ry - 1, 3, st === 'sleep' || (happy && st === 'idle'), '#1e3a24');
  r(0, -ry + 3, 2, 1, '#1e3a24');
  if (happy) {
    px(-5, -ry + 2, '#ff9ab0');
    px(5, -ry + 2, '#ff9ab0');
  }
}

function shroom(p, st, f, happy) {
  const { r, px, ell } = p;
  const j = st === 'jump' ? -2 : 0;
  // ножки и тельце
  if (st !== 'jump') {
    r(-3, -2, 2, 2, '#c8b08a');
    r(1, -2, 2, 2, '#c8b08a');
  }
  r(-4, -10 + j, 8, 8, '#f6ead2');
  r(2, -10 + j, 2, 8, '#e0d0b0');
  // шляпка
  ell(0, -12 + j, 9, 4, '#e04848');
  r(-9, -12 + j, 19, 2, '#c03838');
  ell(0, -14 + j, 7, 2, '#ee6060');
  for (const [x, y, w] of [[-6, -14, 2], [-1, -16, 3], [4, -14, 2], [6, -12, 1]]) r(x, y + j, w, w > 1 ? 2 : 1, '#ffffff');
  eyes(px, r, 0, -8 + j, 2, st === 'sleep');
  r(0, -4 + j, 1, 1, '#8a3a3a');
  if (happy || st === 'jump') {
    px(-3, -5 + j, '#ff9ab0');
    px(3, -5 + j, '#ff9ab0');
  }
}

function ghost(p, st, f) {
  const { r, px, ell } = p;
  ell(0, -13, 7, 6, '#f4f6ff');
  r(-7, -13, 15, 9, '#f4f6ff');
  r(4, -13, 4, 9, '#d8dcf2');
  for (let i = 0; i < 5; i++) if ((i + f) % 2 === 0) r(-7 + i * 3, -4, 3, 2, i > 3 ? '#d8dcf2' : '#f4f6ff');
  eyes(px, r, 0, -14, 3, false, '#2a2a44');
  r(0, -10, 2, 2, '#2a2a44');
  px(-4, -11, '#ffb0c8');
  px(4, -11, '#ffb0c8');
}

function spider(p, st, f) {
  const { r, px, ell } = p;
  const k = f % 2;
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const y = -6 + i * 1.5;
      const lift = (i + k) % 2;
      r(s < 0 ? -10 : 5, y - lift, 5, 1, '#3e3254');
      px(s < 0 ? -10 : 9, y + 1 - lift, '#3e3254');
    }
  }
  ell(0, -5, 5, 4, '#6a5a9a');
  ell(-1, -6, 3, 2, '#8a7aba');
  r(-3, -7, 3, 3, '#ffffff');
  r(1, -7, 3, 3, '#ffffff');
  px(-2, -6, EYE);
  px(2, -6, EYE);
  px(-1, -2, '#f6f0ff');
  px(1, -2, '#f6f0ff');
}

function dragon(p, st, f, happy, fire) {
  const { r, px, ell } = p;
  const fly = st === 'fly' || st === 'jump' || st === 'held' || st === 'fall';
  const flap = fly ? f % 2 : 0;
  const walk = st === 'walk' || st === 'run';
  const body = '#5ac06e';
  const dark = '#2f8a4a';
  const belly = '#f4d880';
  // хвост
  for (let i = 0; i < 8; i++) r(-7 - i, -5 - Math.round(Math.sin(i / 2.5) * 2) - (fly ? 3 : 0), 3, 3, i > 5 ? dark : body);
  r(-17, -10 - (fly ? 3 : 0), 3, 3, '#e8603a');
  // крылья
  if (flap) {
    r(-6, -24, 8, 6, '#3f9a5a');
    r(-4, -27, 5, 3, '#3f9a5a');
    r(-5, -23, 6, 2, '#7ad890');
  } else {
    r(-8, -17, 9, 5, '#3f9a5a');
    r(-7, -16, 7, 2, '#7ad890');
  }
  // тело и лапы
  const by = fly ? -3 : 0;
  ell(0, -8 + by, 8, 6, body);
  ell(1, -7 + by, 5, 4, belly);
  if (!fly) {
    for (const [x, i] of [[-5, 0], [3, 1]]) r(x, -3 - (walk && (i + f) % 2 ? 1 : 0), 3, 3, dark);
  }
  // голова
  const hx = 6;
  const hy = -18 + by;
  ell(hx, hy, 7, 6, body);
  ell(hx + 4, hy + 3, 4, 3, mix(body, belly, 0.4));
  r(hx - 5, hy - 9, 2, 4, '#f6ecd0');
  r(hx + 3, hy - 9, 2, 4, '#f6ecd0');
  px(hx - 4, hy - 10, '#f6ecd0');
  px(hx + 4, hy - 10, '#f6ecd0');
  eyes(px, r, hx, hy - 2, 3, happy && !fly);
  px(hx + 5, hy + 3, EYE);
  px(hx + 7, hy + 3, EYE);
  r(hx + 1, hy + 4, 4, 1, '#2a4a2a');
  px(hx + 2, hy + 5, '#ffffff');
  if (happy) {
    px(hx - 4, hy + 2, '#ff9ab0');
    px(hx + 4, hy + 2, '#ff9ab0');
  }
  if (fire) {
    r(hx + 8, hy + 3, 4, 2, '#ffb347');
    r(hx + 11, hy + 2, 4, 4, '#ff7a2a');
    px(hx + 12, hy + 3, '#ffe070');
  }
}

/** Нарисовать зверя kind (без обводки). pose: { state, frame, happy, squash, fire }. */
export function drawCritter(c, kind, pose) {
  const p = pen(c);
  const st = pose.state || 'idle';
  const f = pose.frame | 0;
  if (kind === 'cat' || kind === 'kitten' || kind === 'fox') return feline(p, kind, st, f, pose.happy);
  if (kind === 'slime') return slime(p, st, f, pose.happy, pose.squash);
  if (kind === 'shroom') return shroom(p, st, f, pose.happy);
  if (kind === 'ghost') return ghost(p, st, f);
  if (kind === 'spider') return spider(p, st, f);
  if (kind === 'dragon') return dragon(p, st, f, pose.happy, pose.fire);
  return null;
}

/** Кадр позы зверя (для кэша). */
export function critterPose(a) {
  const st = a.state || 'idle';
  const t = a.anim || 0;
  let frame = 0;
  if (st === 'walk' || st === 'run') frame = Math.floor((a.phase || 0) * 4) % 4;
  else if (st === 'fly' || st === 'held') frame = Math.floor(t * 6) % 2;
  else frame = Math.floor(t * 1.5) % 2;
  return { state: st, frame, happy: !!a.happy, squash: a.squash > 0.3, fire: !!a.fire };
}

/** Спрайт зверя с обводкой (смотрит вправо; dir < 0 — зеркальный). */
export function critterSprite(kind, pose, dir = 1) {
  const key = `c|${kind}|${pose.state}|${pose.frame}|${pose.happy ? 1 : 0}|${pose.squash ? 1 : 0}|${pose.fire ? 1 : 0}`;
  return outlined(key, (c) => drawCritter(c, kind, pose), dir);
}

export { CW, CH };
