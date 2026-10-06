// Пиксельные персонажи деревни (обновление 0.7). Каждый рисуется «куклой» из прямоугольников на холсте
// низкого разрешения: координаты — от точки у ног (dx вправо по взгляду, dy вверх — отрицательный),
// поэтому отражение по направлению и любые позы получаются кодом, без спрайт-листов.
//
// pose: { state: idle|walk|run|jump|sit|sleep|work|wave|knock|dance|fly|greet, phase (0…1 шаг), t (секунды), night }

const TAU = Math.PI * 2;

/** Кисть: r(dx, dy, w, h, цвет) от точки у ног; dir — взгляд (±1); u — размер «пикселя». */
export function painter(ctx, x, y, dir, u = 1, alpha = 1) {
  return {
    u,
    r(dx, dy, w, h, col) {
      if (!col || w <= 0 || h <= 0) return;
      const X = dir > 0 ? x + dx * u : x - (dx + w) * u;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = col;
      ctx.fillRect(Math.round(X), Math.round(y + dy * u), w * u, h * u);
      ctx.globalAlpha = 1;
    },
  };
}

const swing = (p) => Math.round(Math.sin((p.phase || 0) * TAU));

// ---------- Люди ----------

const HUMANS = {
  wanderer: { skin: '#f2c9a0', hair: '#6b4a2b', shirt: '#7d6a4f', pants: '#4a3b2a', boots: '#2e2219', cloak: '#8a5a3a', tool: 'staff' },
  miner: { skin: '#e9b98f', hair: '#3b2a1e', shirt: '#5a6e8c', pants: '#3f4a5c', boots: '#2a2a2a', hat: 'helmet', tool: 'pickaxe' },
  builder: { skin: '#f0c49a', hair: '#7a4b22', shirt: '#e8782a', pants: '#36507a', boots: '#3a2a1a', hat: 'hardhat', tool: 'hammer', stripe: '#fff2a8' },
  archer: { skin: '#f6d0b0', hair: '#c7792e', shirt: '#3f7d3a', pants: '#5a4630', boots: '#3b2b1b', hat: 'hood', hood: '#2f6a2c', ponytail: true, tool: 'bow' },
  witch: { skin: '#e8d6c8', hair: '#2c1e3a', shirt: '#5b3a8a', pants: '#3a2558', boots: '#1e1428', hat: 'witch', cloak: '#4a2d75', tool: 'broom' },
  knight: { skin: '#e9c3a0', hair: '#555', shirt: '#9aa3ad', pants: '#6d757e', boots: '#4a4f55', hat: 'helmetK', plume: '#d84040', tool: 'sword', shield: '#3f62b0' },
  neko: { skin: '#ffe0cc', hair: '#b7a1ee', shirt: '#8e7cd6', pants: '#6b73b8', boots: '#4e4469', ears: true, tail: '#b7a1ee', apron: '#fff' },
};

function tool(g, kind, p, o) {
  const t = p.t || 0;
  const working = p.state === 'work';
  const up = working ? Math.floor(t * 4) % 2 === 0 : false;
  const wood = '#7a5230';
  if (kind === 'staff') {
    g.r(3, -14, 1, 14, wood);
    g.r(3, -15, 1, 1, '#7fd6ff');
  } else if (kind === 'pickaxe') {
    if (working && up) { g.r(3, -14, 1, 5, wood); g.r(1, -15, 5, 1, '#b8c0c8'); } else { g.r(3, -9, 4, 1, wood); g.r(6, -11, 1, 4, '#b8c0c8'); }
  } else if (kind === 'hammer') {
    if (working && up) { g.r(3, -13, 1, 4, wood); g.r(2, -14, 3, 2, '#8a8f96'); } else { g.r(3, -8, 3, 1, wood); g.r(5, -9, 2, 3, '#8a8f96'); }
  } else if (kind === 'bow') {
    if (working) { g.r(4, -12, 1, 7, '#8a5a2a'); g.r(3, -12, 1, 1, '#8a5a2a'); g.r(3, -6, 1, 1, '#8a5a2a'); g.r(2, -9, 2, 1, '#ddd'); } else g.r(-3, -12, 1, 7, '#8a5a2a');
  } else if (kind === 'broom') {
    if (p.state !== 'fly') { g.r(-3, -12, 1, 11, wood); g.r(-4, -2, 3, 2, '#c9a24a'); }
  } else if (kind === 'sword') {
    if (working && up) { g.r(3, -16, 1, 6, '#dfe6ee'); g.r(2, -10, 3, 1, '#c9a24a'); } else { g.r(3, -7, 1, 5, '#dfe6ee'); g.r(2, -8, 3, 1, '#c9a24a'); }
  }
  if (o.shield) {
    g.r(-4, -10, 2, 5, o.shield);
    g.r(-4, -8, 2, 1, '#e6c84a');
  }
}

function hat(g, o, p) {
  const night = p.night;
  if (o.hat === 'helmet') {
    g.r(-2, -15, 5, 2, '#f2c230');
    g.r(-3, -13, 7, 1, '#d9a91e');
    g.r(2, -14, 1, 1, night ? '#fff7a8' : '#fff2c0');
  } else if (o.hat === 'hardhat') {
    g.r(-2, -15, 5, 2, '#ff9a2a');
    g.r(-3, -13, 7, 1, '#e07a12');
  } else if (o.hat === 'hood') {
    g.r(-3, -15, 6, 3, o.hood);
    g.r(-3, -12, 2, 4, o.hood);
  } else if (o.hat === 'witch') {
    g.r(-4, -14, 9, 1, '#2e1d48');
    g.r(-2, -16, 5, 2, '#3b2560');
    g.r(-1, -18, 3, 2, '#3b2560');
    g.r(-1, -20, 2, 2, '#3b2560');
    g.r(-2, -21, 2, 1, '#3b2560');
    g.r(-2, -15, 5, 1, '#c9a24a');
  } else if (o.hat === 'helmetK') {
    g.r(-2, -15, 5, 5, '#b9c2cc');
    g.r(0, -12, 3, 1, '#2a2f36');
    g.r(-1, -17, 2, 2, o.plume);
    g.r(-2, -16, 1, 1, o.plume);
  }
}

function human(g, kind, p) {
  const o = HUMANS[kind] || HUMANS.wanderer;
  const s = p.state;
  const step = s === 'walk' || s === 'run' ? swing(p) : 0;
  const bob = s === 'dance' ? (Math.floor((p.t || 0) * 6) % 2) : s === 'walk' || s === 'run' ? Math.abs(step) * 0 : 0;
  const sit = s === 'sit' || s === 'sleep';
  const lift = sit ? 2 : 0;
  const y0 = -bob + lift; // смещение тела вниз при сидении
  // плащ — за телом
  if (o.cloak) g.r(-3, -10 + y0, 6, 7, o.cloak);
  if (o.tail) {
    const w = Math.round(Math.sin((p.t || 0) * 3));
    g.r(-4, -6 + y0, 2, 1, o.tail);
    g.r(-5, -8 + y0 + w, 1, 2, o.tail);
  }
  // ноги
  if (sit) {
    g.r(-2, -3, 5, 2, o.pants);
    g.r(3, -3, 1, 2, o.boots);
  } else if (s === 'jump' || s === 'fly') {
    g.r(-2, -5, 2, 3, o.pants);
    g.r(0, -4, 2, 3, o.pants);
    g.r(-2, -2, 2, 1, o.boots);
    g.r(1, -1, 2, 1, o.boots);
  } else {
    g.r(-2 + step, -5, 2, 4, o.pants);
    g.r(0 - step, -5, 2, 4, o.pants);
    g.r(-2 + step, -1, 2, 1, o.boots);
    g.r(0 - step, -1, 2, 1, o.boots);
  }
  // тело
  g.r(-2, -9 + y0, 4, 5, o.shirt);
  if (o.stripe) g.r(-2, -7 + y0, 4, 1, o.stripe);
  if (o.apron) g.r(0, -8 + y0, 2, 3, o.apron);
  // руки
  const arm = o.shirt;
  const t = p.t || 0;
  if (s === 'wave' || s === 'greet') {
    const w = Math.floor(t * 6) % 2;
    g.r(2, -14 + y0 + w, 1, 4, arm);
    g.r(2, -15 + y0 + w, 1, 1, o.skin);
  } else if (s === 'knock') {
    const k = Math.floor(t * 5) % 2;
    g.r(2, -9 + y0, 2 + k, 1, arm);
    g.r(4 + k, -9 + y0, 1, 1, o.skin);
  } else if (s === 'dance' || s === 'jump') {
    const a = Math.floor(t * 5) % 2;
    g.r(-3, -12 + y0 + a, 1, 3, arm);
    g.r(2, -12 + y0 + (1 - a), 1, 3, arm);
  } else {
    g.r(-3, -9 + y0 - step, 1, 3, arm);
    g.r(-3, -6 + y0 - step, 1, 1, o.skin);
    g.r(2, -9 + y0 + step, 1, 3, arm);
    g.r(2, -6 + y0 + step, 1, 1, o.skin);
  }
  // голова
  g.r(-2, -13 + y0, 5, 4, o.skin);
  g.r(-2, -14 + y0, 5, 2, o.hair);
  g.r(-2, -12 + y0, 1, 2, o.hair);
  if (o.ponytail) g.r(-3, -13 + y0, 1, 4, o.hair);
  if (o.ears) {
    g.r(-2, -15 + y0, 1, 1, o.hair);
    g.r(1, -15 + y0, 1, 1, o.hair);
  }
  const closed = s === 'sleep';
  g.r(1, -11 + y0, 1, closed ? 0 : 1, '#2a2233');
  if (closed) g.r(1, -11 + y0, 2, 1, '#8a6a5a');
  if (p.happy) g.r(2, -10 + y0, 1, 1, '#f08a9a');
  hat(g, o, p);
  if (o.tool && !sit) tool(g, o.tool, p, o);
  else if (o.shield) tool(g, null, p, o);
  if (s === 'fly' && o.tool === 'broom') {
    g.r(-6, -1, 11, 1, '#7a5230');
    g.r(-9, -2, 4, 3, '#c9a24a');
  }
}

// ---------- Животные ----------

const BEASTS = {
  cat: { fur: '#e8954c', dark: '#b8682c', belly: '#fbe2c2', nose: '#e88a9a', stripes: true },
  kitten: { fur: '#9aa5c9', dark: '#7280a8', belly: '#e8ecf8', nose: '#f0a0b0', small: true },
  fox: { fur: '#ec8a3a', dark: '#5a3420', belly: '#fff1e0', nose: '#2a2020', tailTip: '#fff6ea', bushy: true },
};

function beast(g, kind, p) {
  const o = BEASTS[kind] || BEASTS.cat;
  const s = p.state;
  const t = p.t || 0;
  const sm = o.small ? 1 : 0;
  const wag = Math.round(Math.sin(t * (s === 'walk' || s === 'run' ? 8 : 3)));
  if (s === 'sleep') {
    g.r(-4 + sm, -3, 8 - sm * 2, 3, o.fur);
    g.r(-3 + sm, -4, 6 - sm * 2, 1, o.fur);
    g.r(2 - sm, -4, 3, 3, o.fur);
    g.r(3 - sm, -3, 2, 1, '#5a4040');
    g.r(-5 + sm, -2, 3, 1, o.bushy ? o.fur : o.dark);
    return;
  }
  if (s === 'sit') {
    g.r(-2, -6 + sm, 4, 5 - sm, o.fur);
    g.r(-1, -5 + sm, 2, 3 - sm, o.belly);
    g.r(-1, -9 + sm * 2, 4, 4 - sm, o.fur);
    g.r(-1, -10 + sm * 2, 1, 1, o.fur);
    g.r(2, -10 + sm * 2, 1, 1, o.fur);
    g.r(1, -8 + sm * 2, 1, 1, '#2a2233');
    g.r(3, -7 + sm * 2, 1, 1, o.nose);
    g.r(1, -2, 1, 2, o.dark);
    g.r(-5, -1, 4, 1, o.bushy ? o.fur : o.dark);
    g.r(-6, -2 + wag, 1, 1, o.tailTip || o.fur);
    return;
  }
  const jump = s === 'jump';
  const step = s === 'walk' || s === 'run' ? swing(p) : 0;
  const by = jump ? -1 : 0;
  // хвост
  if (o.bushy) {
    g.r(-7, -6 + wag + by, 3, 2, o.fur);
    g.r(-8, -7 + wag + by, 2, 2, o.fur);
    g.r(-9, -8 + wag + by, 1, 1, o.tailTip);
  } else {
    g.r(-6 + sm, -5 + by, 2, 1, o.fur);
    g.r(-7 + sm, -7 + wag + by, 1, 2, o.fur);
  }
  // тело
  g.r(-4 + sm, -5 + by + sm, 8 - sm * 2, 3 - sm, o.fur);
  g.r(-3 + sm, -3 + by, 6 - sm * 2, 1, o.belly);
  if (o.stripes) {
    g.r(-2, -5 + by, 1, 1, o.dark);
    g.r(0, -5 + by, 1, 1, o.dark);
  }
  // лапы
  const lg = o.bushy ? o.dark : o.fur;
  if (jump) {
    g.r(-5 + sm, -3, 2, 1, lg);
    g.r(3 - sm, -3, 2, 1, lg);
  } else {
    g.r(-4 + sm, -2, 1, 2 - (step > 0 ? 1 : 0), lg);
    g.r(-3 + sm, -2, 1, 2 - (step < 0 ? 1 : 0), lg);
    g.r(2 - sm, -2, 1, 2 - (step < 0 ? 1 : 0), lg);
    g.r(3 - sm, -2, 1, 2 - (step > 0 ? 1 : 0), lg);
  }
  // голова
  const hx = 3 - sm * 2;
  const hy = -8 + by + sm;
  g.r(hx, hy, 4 - sm, 4 - sm, o.fur);
  g.r(hx, hy - 1, 1, 1, o.fur);
  g.r(hx + 2 - sm, hy - 1, 1, 1, o.fur);
  if (o.bushy) g.r(hx + 3 - sm, hy + 2, 2, 1, o.fur);
  g.r(hx + 2 - sm, hy + 1, 1, 1, '#2a2233');
  g.r(hx + 4 - sm + (o.bushy ? 1 : 0), hy + 2, 1, 1, o.nose);
  if (p.happy) g.r(hx + 1, hy + 2, 1, 1, '#f3a0b0');
}

// ---------- Остальные ----------

function slime(g, p) {
  const sq = p.state === 'jump' ? -1 : p.squash ? 1 : 0;
  const w = 8 + sq * 2;
  const h = 6 - sq;
  const x = -Math.floor(w / 2);
  g.r(x + 1, -h, w - 2, 1, '#6fdc6a');
  g.r(x, -h + 1, w, h - 1, '#4cbf4a');
  g.r(x + 1, -h + 1, 2, 1, '#c8ffc0');
  g.r(x + w - 4, -h + 2, 1, 2, '#1e3a20');
  g.r(x + w - 2, -h + 2, 1, 2, '#1e3a20');
  if (p.happy) g.r(x + w - 3, -2, 2, 1, '#2a6a2a');
}

function shroom(g, p) {
  const j = p.state === 'jump' ? -1 : 0;
  g.r(-2, -4 + j, 4, 4, '#f4e6c8');
  g.r(1, -3 + j, 1, 1, '#2a2233');
  g.r(-1, -3 + j, 1, 1, '#2a2233');
  g.r(-4, -7 + j, 8, 3, '#d9363a');
  g.r(-3, -8 + j, 6, 1, '#d9363a');
  g.r(-2, -7 + j, 2, 1, '#fff');
  g.r(2, -6 + j, 1, 1, '#fff');
  g.r(-4, -5 + j, 1, 1, '#fff');
  if (p.state !== 'jump') {
    g.r(-2, -1, 1, 1, '#c9b48a');
    g.r(1, -1, 1, 1, '#c9b48a');
  }
}

function ghost(g, p) {
  const t = p.t || 0;
  const w = Math.floor(t * 4) % 2;
  g.r(-3, -10, 7, 8, '#eef2ff');
  g.r(-2, -11, 5, 1, '#eef2ff');
  for (let i = 0; i < 7; i++) if ((i + w) % 2 === 0) g.r(-3 + i, -2, 1, 1, '#eef2ff');
  g.r(0, -8, 1, 2, '#2a2a44');
  g.r(2, -8, 1, 2, '#2a2a44');
  g.r(1, -5, 1, 1, '#2a2a44');
}

function spider(g, p) {
  const t = p.t || 0;
  const k = Math.floor(t * 6) % 2;
  g.r(-2, -4, 4, 3, '#5c4a78');
  g.r(-1, -5, 2, 1, '#5c4a78');
  g.r(0, -3, 1, 1, '#fff');
  g.r(1, -3, 1, 1, '#fff');
  for (const dy of [-4, -3, -2]) {
    g.r(-4, dy + (k && dy === -3 ? 1 : 0), 2, 1, '#3e3254');
    g.r(2, dy + (!k && dy === -3 ? 1 : 0), 2, 1, '#3e3254');
  }
}

function dragon(g, p) {
  const t = p.t || 0;
  const s = p.state;
  const flap = s === 'fly' || s === 'jump' ? Math.floor(t * 8) % 2 : 0;
  const step = s === 'walk' ? swing(p) : 0;
  const body = '#4fae6a';
  const dark = '#2f7a46';
  const belly = '#f1d27a';
  g.r(-8, -5, 3, 1, body);
  g.r(-10, -6, 2, 1, body);
  g.r(-11, -7, 1, 2, '#e85a3a');
  g.r(-5, -7, 9, 4, body);
  g.r(-4, -4, 7, 1, belly);
  // крылья
  if (flap) { g.r(-3, -12, 5, 2, dark); g.r(-2, -14, 3, 2, dark); } else { g.r(-3, -9, 6, 2, dark); g.r(-2, -10, 3, 1, dark); }
  // лапы
  g.r(-4 + step, -3, 2, 3, dark);
  g.r(2 - step, -3, 2, 3, dark);
  // голова
  g.r(3, -10, 5, 4, body);
  g.r(7, -8, 2, 2, body);
  g.r(4, -12, 1, 2, '#f1e6c8');
  g.r(6, -11, 1, 1, '#f1e6c8');
  g.r(6, -9, 1, 1, '#1e2a22');
  g.r(8, -7, 1, 1, '#1e2a22');
  if (p.fire) {
    g.r(9, -8, 3, 1, '#ffb347');
    g.r(11, -9, 2, 3, '#ff7a2a');
  }
}

/** Нарисовать персонажа kind в позе pose. */
export function drawCharacter(g, kind, pose) {
  if (kind in HUMANS) return human(g, kind, pose);
  if (kind in BEASTS) return beast(g, kind, pose);
  if (kind === 'slime') return slime(g, pose);
  if (kind === 'shroom') return shroom(g, pose);
  if (kind === 'ghost') return ghost(g, pose);
  if (kind === 'spider') return spider(g, pose);
  if (kind === 'dragon') return dragon(g, pose);
  return human(g, 'wanderer', pose);
}

/** Высота персонажа в «пикселях» (для пузырей и попадания кликом). */
export const charHeight = (kind) => ({ cat: 9, kitten: 8, fox: 9, slime: 6, shroom: 8, ghost: 11, spider: 5, dragon: 14, witch: 22 }[kind] || 16);

/** Эмоция над головой: сердце, «!», нота, звезда, «Z», монета, изумруд. */
export function drawEmote(ctx, x, y, kind, u = 1) {
  const g = painter(ctx, x, y, 1, u);
  const R = (dx, dy, w, h, c) => g.r(dx, dy, w, h, c);
  if (kind === 'heart') { R(-2, -3, 2, 1, '#ff5c7a'); R(1, -3, 2, 1, '#ff5c7a'); R(-2, -2, 5, 1, '#ff5c7a'); R(-1, -1, 3, 1, '#ff5c7a'); R(0, 0, 1, 1, '#ff5c7a'); }
  else if (kind === '!') { R(0, -4, 1, 3, '#ffd23a'); R(0, 0, 1, 1, '#ffd23a'); }
  else if (kind === 'note') { R(1, -4, 1, 4, '#9ad0ff'); R(-1, -1, 2, 2, '#9ad0ff'); R(2, -4, 1, 1, '#9ad0ff'); }
  else if (kind === 'star') { R(0, -3, 1, 1, '#ffe14a'); R(-1, -2, 3, 1, '#ffe14a'); R(-2, -1, 5, 1, '#ffe14a'); R(-1, 0, 1, 1, '#ffe14a'); R(1, 0, 1, 1, '#ffe14a'); }
  else if (kind === 'z') { R(-1, -3, 3, 1, '#cfd8ff'); R(0, -2, 1, 1, '#cfd8ff'); R(-1, -1, 3, 1, '#cfd8ff'); }
  else if (kind === 'coin') { R(-1, -2, 3, 3, '#ffcc33'); R(0, -1, 1, 1, '#b8860b'); }
  else if (kind === 'gem') { R(0, -3, 1, 1, '#7dffb0'); R(-1, -2, 3, 2, '#2ec27e'); R(0, 0, 1, 1, '#1a8a55'); }
  else if (kind === 'sad') { R(-1, -3, 3, 1, '#7aa0d0'); R(-2, -2, 1, 1, '#7aa0d0'); R(2, -2, 1, 1, '#7aa0d0'); }
}
