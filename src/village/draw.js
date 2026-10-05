// Отрисовка деревни (обновление 0.7) на холсте низкого разрешения: небо со сменой дня и ночи, дальний план
// по стилю (горы, готический замок, луга, море с маяком, осенний лес), постройки, фонари, жители, частицы,
// лесная рамка на переднем плане. Ночь — затемнение «земли» и тёплые огни окон, фонарей и костра поверх.

import { painter, drawCharacter, drawEmote, charHeight } from './puppets.js';

// ---------- Цвета ----------

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
/** Смешать два цвета #rrggbb: t = 0 → a, 1 → b. */
export function mix(a, b, t) {
  const p = rgb(a);
  const q = rgb(b);
  return '#' + hex2(p[0] + (q[0] - p[0]) * t) + hex2(p[1] + (q[1] - p[1]) * t) + hex2(p[2] + (q[2] - p[2]) * t);
}
const shade = (c, t) => mix(c, '#000000', t);
const tint = (c, t) => mix(c, '#ffffff', t);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const hash = (n) => {
  let x = Math.imul(n | 0, 374761393);
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967295;
};

function R(c, x, y, w, h, col) {
  if (w <= 0 || h <= 0) return;
  c.fillStyle = col;
  c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

export const flavorOf = (st) => (st.gothic ? 'gothic' : st.meadow ? 'meadow' : st.sea ? 'sea' : st.autumn ? 'autumn' : 'classic');

const SKY = {
  classic: { day: ['#6fb6ec', '#cfe8fb'], dusk: ['#56629e', '#f0a070'], night: ['#0b1433', '#22305c'], shade: '#0e1438' },
  gothic: { day: ['#8d86c4', '#dcd2ef'], dusk: ['#3e2f6e', '#c8708e'], night: ['#0e0720', '#2c1a48'], shade: '#1c0a30' },
  meadow: { day: ['#7dcdfb', '#e8f8ff'], dusk: ['#5a6cae', '#f6b27a'], night: ['#0c1a38', '#23406c'], shade: '#0c1838' },
  sea: { day: ['#5dbbe6', '#d2f0fc'], dusk: ['#4a5c96', '#ef9a7a'], night: ['#071730', '#14385a'], shade: '#061632' },
  autumn: { day: ['#86b4dc', '#f4dcbc'], dusk: ['#5e4a86', '#f08a5a'], night: ['#160f2c', '#35263f'], shade: '#180e2c' },
};

/** Солнце над горизонтом: −1 полночь, 1 полдень. */
const sunElev = (phase) => -Math.cos(phase * Math.PI * 2);

export function skyColors(flavor, phase) {
  const s = SKY[flavor] || SKY.classic;
  const e = sunElev(phase);
  const day = clamp01((e + 0.12) / 0.42);
  const dusk = clamp01(1 - Math.abs(e - 0.02) / 0.3) * 0.85;
  const top = mix(mix(s.night[0], s.day[0], day), s.dusk[0], dusk * 0.6);
  const bottom = mix(mix(s.night[1], s.day[1], day), s.dusk[1], dusk);
  return { top, bottom, day, dusk };
}

// ---------- Небо ----------

function drawSky(c, v, flavor, world) {
  const { W, H, phase, n } = v;
  const { top, bottom, dusk } = skyColors(flavor, phase);
  const bands = 10;
  const sh = v.horizon + 4;
  for (let i = 0; i < bands; i++) {
    const y0 = Math.floor((sh * i) / bands);
    const y1 = Math.floor((sh * (i + 1)) / bands);
    R(c, 0, y0, W, y1 - y0 + 1, mix(top, bottom, i / (bands - 1)));
  }
  R(c, 0, sh, W, H - sh, bottom);
  // звёзды
  if (n > 0.2) {
    const many = world.legacy.has('scene:stars');
    const count = Math.round((W * v.horizon) / (many ? 90 : 160));
    for (let i = 0; i < count; i++) {
      const x = Math.floor(hash(i * 3 + 1) * W);
      const y = Math.floor(hash(i * 7 + 2) * (v.horizon - 6));
      const tw = 0.55 + 0.45 * Math.sin(world.t * (1 + hash(i) * 2) + i);
      c.globalAlpha = clamp01((n - 0.2) * 1.6) * tw;
      R(c, x, y, 1, 1, hash(i * 11) > 0.85 ? '#ffe9a8' : '#ffffff');
    }
    if (many && n > 0.6) {
      // падающая звезда раз в ~12 секунд
      const k = (world.t % 12) / 12;
      if (k < 0.08) {
        const sx = W * (0.2 + hash(Math.floor(world.t / 12)) * 0.6) + k * 400;
        const sy = 4 + k * 120;
        for (let j = 0; j < 6; j++) {
          c.globalAlpha = (1 - j / 6) * (1 - k / 0.08);
          R(c, sx - j * 2, sy - j, 1, 1, '#ffffff');
        }
      }
    }
    c.globalAlpha = 1;
  }
  // северное сияние
  if (world.owned.has('v:aurora') && n > 0.45) {
    const a = clamp01((n - 0.45) * 2.5) * 0.55;
    const cols = ['#5dffb0', '#4fd6ff', '#b78cff'];
    for (let x = 0; x < W; x += 2) {
      const base = v.horizon * 0.25 + Math.sin(x * 0.03 + world.t * 0.4) * 6 + Math.sin(x * 0.011 - world.t * 0.2) * 5;
      const len = 10 + Math.sin(x * 0.05 + world.t) * 5;
      for (let j = 0; j < len; j += 2) {
        c.globalAlpha = a * (1 - j / len) * (0.6 + 0.4 * Math.sin(x * 0.2 + world.t * 2));
        R(c, x, base + j, 2, 2, cols[Math.floor((x / 40 + world.t * 0.1) % 3 + 3) % 3]);
      }
    }
    c.globalAlpha = 1;
  }
  // солнце и луна
  const arc = (p) => {
    const k = (p - 0.22) / 0.56;
    return { x: W * (0.06 + 0.88 * k), y: v.horizon - Math.sin(Math.PI * k) * (v.horizon * 0.8) };
  };
  if (phase > 0.22 && phase < 0.78) {
    const s = arc(phase);
    const col = dusk > 0.4 ? '#ffb070' : '#ffe680';
    c.globalAlpha = 0.25;
    disc(c, s.x, s.y, 7, col);
    c.globalAlpha = 1;
    disc(c, s.x, s.y, 4, col);
    R(c, s.x - 2, s.y - 2, 2, 1, '#fffbe0');
  }
  const mp = (phase + 0.5) % 1;
  if (mp > 0.2 && mp < 0.8) {
    const m = arc(mp);
    const r = flavor === 'gothic' ? 7 : 5;
    c.globalAlpha = clamp01(n * 1.5) * 0.2;
    disc(c, m.x, m.y, r + 4, flavor === 'gothic' ? '#d8b8ff' : '#e6ecff');
    c.globalAlpha = clamp01(0.35 + n);
    disc(c, m.x, m.y, r, flavor === 'gothic' ? '#efe2ff' : '#f2f4ff');
    R(c, m.x - 1, m.y - 1, 2, 2, '#c9cde0');
    R(c, m.x + 2, m.y + 1, 1, 1, '#c9cde0');
    c.globalAlpha = 1;
    if (flavor !== 'gothic') disc(c, m.x + 3, m.y - 2, r - 1, mix(top, bottom, clamp01(m.y / sh))); // серп
  }
  // облака
  const nc = Math.max(2, Math.round(W / 110));
  for (let i = 0; i < nc; i++) {
    const span = W + 60;
    const x = ((hash(i + 40) * span + world.t * (1.5 + hash(i) * 2)) % span) - 30;
    const y = 4 + hash(i + 9) * (v.horizon * 0.45);
    cloud(c, x, y, 10 + Math.floor(hash(i + 3) * 12), mix('#ffffff', '#3a4266', n * 0.85), clamp01(0.9 - n * 0.4));
  }
  // дождевая тучка, если жители унывают
  if (world.mood < 25) {
    const cx = v.focusX ?? W / 2;
    cloud(c, cx - 12, v.horizon * 0.5, 22, '#7b8396', 0.95);
    for (let i = 0; i < 12; i++) {
      const dx = hash(i) * 22;
      const dy = ((world.t * 40 + hash(i + 5) * 40) % 40);
      R(c, cx - 12 + dx, v.horizon * 0.5 + 6 + dy, 1, 2, '#9fb6d8');
    }
  }
}

function disc(c, cx, cy, r, col) {
  c.fillStyle = col;
  for (let y = -r; y <= r; y++) {
    const w = Math.round(Math.sqrt(r * r - y * y));
    c.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2 + 1, 1);
  }
}

function cloud(c, x, y, w, col, a) {
  c.globalAlpha = a;
  R(c, x + 3, y, w - 6, 2, col);
  R(c, x, y + 2, w, 3, col);
  R(c, x + 2, y - 2, w * 0.4, 2, col);
  R(c, x + w * 0.45, y - 3, w * 0.35, 3, col);
  c.globalAlpha = 1;
}

// ---------- Дальний план ----------

function drawFar(c, v, st, flavor, world) {
  const { W, horizon } = v;
  const off = v.camX * 0.5;
  const far = st.far;
  const by = horizon + 6;
  if (flavor === 'sea') {
    // море до горизонта и маяк
    R(c, 0, horizon - 2, W, by - horizon + 30, mix('#3f86b8', '#0f2a48', v.n * 0.8));
    for (let i = 0; i < W / 6; i++) {
      const x = (hash(i) * W + world.t * 3 * (hash(i + 1) > 0.5 ? 1 : -1)) % W;
      R(c, (x + W) % W, horizon + Math.floor(hash(i + 7) * 8), 3, 1, mix('#bfe6ff', '#4d6c8f', v.n));
    }
    const lx = W * 0.86 - off * 0.3;
    R(c, lx - 6, horizon - 2, 14, 4, '#5b5f66');
    for (let j = 0; j < 18; j++) R(c, lx - 2 + (j > 12 ? 1 : 0), horizon - 3 - j, 5 - (j > 12 ? 2 : 0), 1, Math.floor(j / 3) % 2 ? '#d84b3a' : '#f3efe6');
    R(c, lx - 2, horizon - 24, 5, 4, '#2c2f36');
    v.beacon = { x: lx, y: horizon - 22 };
    return;
  }
  if (flavor === 'meadow' || flavor === 'autumn') {
    for (let x = 0; x < W; x++) {
      const wx = x + off;
      const h = 9 + Math.sin(wx * 0.02) * 5 + Math.sin(wx * 0.047 + 1) * 3;
      R(c, x, by - h, 1, h + 8, tint(far, 0.25));
    }
    if (flavor === 'autumn') {
      for (let i = 0; i < W / 12; i++) {
        const x = ((i * 12 + hash(i) * 8 - off * 0.2) % (W + 20) + W + 20) % (W + 20) - 10;
        const col = ['#d9682e', '#e8a33a', '#b8452a', '#c98a2e'][i % 4];
        const top = by - 8 - Math.round(hash(i + 2) * 6);
        R(c, x + 2, top + 4, 2, by - top - 2, shade(far, 0.35));
        R(c, x, top, 6, 5, col);
        R(c, x + 1, top - 2, 4, 2, col);
      }
    } else {
      for (let i = 0; i < W / 16; i++) {
        const x = ((i * 16 - off * 0.2) % (W + 20) + W + 20) % (W + 20) - 10;
        R(c, x, by - 9 - hash(i) * 4, 5, 5, '#6fbf5a');
        R(c, x + 2, by - 4, 1, 4, '#7a5a3a');
        if (hash(i + 3) > 0.5) R(c, x + 1, by - 8, 1, 1, '#ff8fb0');
      }
    }
    return;
  }
  // горы (классика) или холмы с замком (готика)
  for (let x = 0; x < W; x++) {
    const wx = x + off;
    const h = flavor === 'gothic'
      ? 10 + Math.sin(wx * 0.017) * 6 + Math.sin(wx * 0.05) * 2
      : 14 + Math.abs(Math.sin(wx * 0.021)) * 16 + Math.sin(wx * 0.07) * 3;
    R(c, x, by - h, 1, h + 10, far);
    if (flavor === 'classic' && h > 26) R(c, x, by - h, 1, Math.min(3, h - 26), '#f2f6ff');
  }
  if (flavor === 'gothic') {
    const cx = W * 0.72 - off * 0.4;
    const base = by - 14;
    const castle = shade(far, 0.35);
    R(c, cx, base - 10, 30, 12, castle);
    for (const [dx, h] of [[-2, 20], [12, 26], [28, 18]]) {
      R(c, cx + dx, base - h, 5, h, castle);
      for (let k = 0; k < 4; k++) R(c, cx + dx + 2 - Math.floor(k / 2), base - h - 4 + k, 1 + Math.floor(k / 2) * 2, 1, castle);
    }
    for (let k = 0; k < 4; k++) R(c, cx + k * 7 + 2, base - 7, 1, 2, v.n > 0.4 ? '#ffd27a' : shade(far, 0.5));
  }
}

// ---------- Деревья ----------

function tree(c, x, gy, flavor, s) {
  const big = 1 + s * 0.25;
  if (flavor === 'meadow' || flavor === 'autumn') {
    const cols = flavor === 'autumn' ? ['#d9682e', '#e8a33a', '#b8452a'] : ['#4f9a3c', '#5fae48', '#468a36'];
    const col = cols[s % 3];
    R(c, x, gy - 8 * big, 2, 8 * big, '#6b4a2b');
    R(c, x - 5, gy - 16 * big, 12, 8 * big, col);
    R(c, x - 3, gy - 19 * big, 8, 3 * big, col);
    R(c, x - 4, gy - 16 * big, 3, 2, tint(col, 0.2));
    return;
  }
  if (flavor === 'gothic' && s === 2) {
    // голое корявое дерево
    const col = '#2e2436';
    R(c, x, gy - 16, 2, 16, col);
    R(c, x - 4, gy - 13, 4, 1, col);
    R(c, x - 5, gy - 15, 1, 2, col);
    R(c, x + 2, gy - 11, 4, 1, col);
    R(c, x + 5, gy - 13, 1, 2, col);
    R(c, x - 1, gy - 19, 1, 3, col);
    return;
  }
  const col = flavor === 'gothic' ? '#2f4034' : flavor === 'sea' ? '#2f6e4c' : '#2e6b3a';
  const h = Math.round(18 * big);
  R(c, x, gy - 3, 2, 3, '#5a3d24');
  for (let i = 0; i < h; i++) {
    const w = Math.max(1, Math.round(((i % 6) + 2 + (h - i) * 0.25)));
    R(c, x + 1 - w, gy - 3 - (h - i), w * 2, 1, i % 6 === 0 ? tint(col, 0.08) : col);
  }
}

// ---------- Постройки ----------

const GLASS_DAY = '#9ec9e8';
const GLASS_OFF = '#2b3047';
const WARM = '#ffd36a';

function roof(c, x, y, w, rows, col, steep) {
  for (let r = 0; r < rows; r++) {
    const inset = Math.round(r * (steep ? 0.7 : 1));
    if (w - inset * 2 <= 0) break;
    R(c, x + inset, y - r, w - inset * 2, 1, r === 0 ? shade(col, 0.25) : col);
  }
}

function windowAt(c, x, y, w, h, lit, lights, n) {
  R(c, x - 1, y - 1, w + 2, h + 2, '#00000033');
  if (lit) {
    R(c, x, y, w, h, '#000');
    lights.push({ x: x + w / 2, y: y + h / 2, r: 9, a: n, core: [x, y, w, h] });
  } else R(c, x, y, w, h, n > 0.35 ? GLASS_OFF : GLASS_DAY);
  R(c, x + Math.floor(w / 2), y, 1, h, '#00000040');
}

function drawHouse(c, b, x, gy, st, v, lights, world) {
  const big = b.type === 'house4';
  const w = b.w;
  const wallH = big ? 18 : 14;
  const goth = st.gothic;
  const lit = v.n > 0.3 && world.lightOn(b.id);
  // стены и фахверк
  R(c, x + 2, gy - wallH, w - 4, wallH, st.wall);
  R(c, x + 2, gy - 2, w - 4, 2, shade(st.wall, 0.15));
  R(c, x + 2, gy - wallH, 1, wallH, st.wood);
  R(c, x + w - 3, gy - wallH, 1, wallH, st.wood);
  R(c, x + 2, gy - wallH, w - 4, 1, st.wood);
  if (big) R(c, x + 2, gy - 9, w - 4, 1, st.wood);
  // крыша
  const rows = big ? 15 : goth ? 15 : 12;
  roof(c, x, gy - wallH - 1, w, rows, st.roof, goth);
  if (goth) {
    R(c, x + w / 2 - 1, gy - wallH - rows - 5, 2, 6, st.roof);
    R(c, x + w / 2 - 2, gy - wallH - rows - 1, 4, 1, shade(st.roof, 0.3));
  }
  // труба
  R(c, x + w - 9, gy - wallH - 10, 3, 6, shade(st.wood, 0.2));
  // дверь
  const dx = x + Math.round(w / 2) - 2;
  R(c, dx - 1, gy - 10, 6, 10, shade(st.wood, 0.25));
  R(c, dx, gy - 9, 4, 9, st.wood);
  R(c, dx + 3, gy - 5, 1, 1, '#e6c84a');
  // окна
  const wy = gy - wallH + 3;
  windowAt(c, x + 4, wy, 4, 4, lit, lights, v.n);
  windowAt(c, x + w - 8, wy, 4, 4, lit, lights, v.n);
  if (big) {
    windowAt(c, x + w / 2 - 2, gy - wallH - 7, 4, 3, lit, lights, v.n);
    // флюгер цвета иконки
    R(c, x + w / 2, gy - wallH - rows - 5, 1, 5, '#555');
    R(c, x + w / 2 + 1, gy - wallH - rows - 5 + Math.round(Math.sin(world.t * 2)), 3, 2, v.letter);
  }
  if (st.meadow) {
    for (const wx of [x + 4, x + w - 8]) for (let i = 0; i < 4; i++) R(c, wx + i, wy + 5, 1, 1, ['#ff6f91', '#ffd23a', '#ff9a3c', '#c86bff'][(i + wx) % 4]);
  }
  if (world.legacy.has('scene:web')) {
    // паутинка в углу под крышей
    c.globalAlpha = 0.6;
    for (let i = 0; i < 6; i++) R(c, x + 3 + i, gy - wallH + 1 + i, 1, 1, '#e8e8f0');
    R(c, x + 3, gy - wallH + 4, 4, 1, '#e8e8f0');
    R(c, x + 6, gy - wallH + 1, 1, 4, '#e8e8f0');
    c.globalAlpha = 1;
  }
}

function drawMine(c, b, x, gy, st, v, lights, world) {
  const gem = b.type === 'gemmine';
  const rock = gem ? '#6f7a80' : '#857565';
  for (let i = 0; i < b.w; i++) {
    const h = Math.round(Math.sin((Math.PI * (i + 0.5)) / b.w) * (b.h - 2) + hash(i + b.x) * 2);
    R(c, x + i, gy - h, 1, h, (i + Math.floor(h / 3)) % 5 === 0 ? shade(rock, 0.15) : rock);
    if (h > 3 && hash(i * 7 + b.x) > 0.8) R(c, x + i, gy - h + 2, 1, 1, tint(rock, 0.2));
  }
  // вход
  R(c, x + 8, gy - 11, 11, 11, st.wood);
  R(c, x + 10, gy - 9, 7, 9, '#120d0a');
  R(c, x + 7, gy - 12, 13, 2, shade(st.wood, 0.2));
  // рельсы и вагонетка
  R(c, x + 14, gy - 1, b.w - 12, 1, '#6d6d6d');
  const cx = x + b.w - 9;
  R(c, cx, gy - 5, 7, 3, '#5d5f63');
  R(c, cx + 1, gy - 2, 1, 1, '#2a2a2a');
  R(c, cx + 5, gy - 2, 1, 1, '#2a2a2a');
  const ore = gem ? '#36d982' : '#ffcc33';
  R(c, cx + 1, gy - 6, 5, 1, ore);
  R(c, cx + 2, gy - 7, 2, 1, tint(ore, 0.4));
  if (gem) {
    // кристаллы на склоне
    for (const [dx, h] of [[3, 5], [22, 4], [26, 3]]) {
      const top = gy - Math.round(Math.sin((Math.PI * (dx + 0.5)) / b.w) * (b.h - 2));
      R(c, x + dx, top - h, 2, h, '#2ec27e');
      R(c, x + dx, top - h, 1, 1, '#b6ffd8');
    }
    if (Math.floor(world.t * 1.3) % 4 === 0) R(c, x + 4, gy - 14, 1, 1, '#ffffff');
  }
  // уровень: фонарь у входа, табличка
  if (b.level >= 2) {
    R(c, x + 6, gy - 13, 2, 2, v.n > 0.3 ? '#000' : '#f0d070');
    if (v.n > 0.3) lights.push({ x: x + 7, y: gy - 12, r: 10, a: v.n, core: [x + 6, gy - 13, 2, 2] });
  }
  if (b.level >= 3) {
    R(c, x + 1, gy - 6, 6, 4, st.wood);
    R(c, x + 2, gy - 5, 4, 1, ore);
  }
}

function drawForge(c, b, x, gy, st, v, lights, world) {
  R(c, x + 3, gy - 14, b.w - 6, 14, shade(st.wall, 0.35));
  R(c, x + 1, gy - 16, 2, 16, st.wood);
  R(c, x + b.w - 3, gy - 16, 2, 16, st.wood);
  roof(c, x - 1, gy - 16, b.w + 2, 4, st.roof, false);
  // горн
  R(c, x + 4, gy - 8, 7, 8, '#6b6b70');
  const hot = world.focus || Math.floor(world.t * 3) % 7 === 0;
  R(c, x + 6, gy - 6, 3, 3, hot ? '#000' : '#5a2a1a');
  if (hot || v.n > 0.4) lights.push({ x: x + 7, y: gy - 5, r: world.focus ? 14 : 8, a: Math.max(0.5, v.n), core: [x + 6, gy - 6, 3, 3], warm: '#ff8a3a' });
  // наковальня
  R(c, x + 14, gy - 5, 7, 2, '#4a4d55');
  R(c, x + 16, gy - 3, 3, 3, '#3a3d44');
  // труба
  R(c, x + b.w - 7, gy - 22, 4, 7, '#6b6b70');
}

function drawWindmill(c, b, x, gy, st, v, lights, world) {
  const cx = x + b.w / 2;
  for (let i = 0; i < 28; i++) {
    const half = Math.round(7 - i * 0.12);
    R(c, cx - half, gy - 1 - i, half * 2, 1, i % 7 === 0 ? shade(st.wall, 0.12) : st.wall);
  }
  R(c, cx - 2, gy - 8, 4, 8, st.wood);
  windowAt(c, cx - 1, gy - 20, 2, 3, v.n > 0.3 && world.lightOn(b.id), lights, v.n);
  roof(c, cx - 6, gy - 29, 12, 5, st.roof, false);
  const hy = gy - 31;
  const ang = world.mill;
  for (let k = 0; k < 4; k++) {
    const a = ang + (k * Math.PI) / 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    for (let r = 1; r < 14; r++) {
      R(c, cx + ca * r, hy + sa * r, 1, 1, st.wood);
      if (r > 4) R(c, cx + ca * r - sa * 2, hy + sa * r + ca * 2, 1, 1, r % 3 ? '#f3efe6' : v.letter);
    }
  }
  R(c, cx - 1, hy - 1, 2, 2, '#3a2a1a');
}

function drawTavern(c, b, x, gy, st, v, lights, world) {
  const w = b.w;
  R(c, x + 2, gy - 18, w - 4, 18, st.wall);
  R(c, x + 2, gy - 18, w - 4, 1, st.wood);
  R(c, x + 2, gy - 9, w - 4, 1, st.wood);
  roof(c, x - 1, gy - 19, w + 2, 11, st.roof, st.gothic);
  const lit = v.n > 0.25 && world.lightOn(b.id);
  windowAt(c, x + 5, gy - 7, 5, 4, lit, lights, v.n);
  windowAt(c, x + w - 10, gy - 7, 5, 4, lit, lights, v.n);
  windowAt(c, x + 6, gy - 16, 4, 4, lit, lights, v.n);
  windowAt(c, x + w - 10, gy - 16, 4, 4, lit, lights, v.n);
  R(c, x + w / 2 - 3, gy - 8, 6, 8, st.wood);
  R(c, x + w / 2 - 2, gy - 7, 4, 7, shade(st.wood, 0.3));
  // вывеска с кружкой
  R(c, x + w - 2, gy - 15, 5, 1, st.wood);
  R(c, x + w + 1, gy - 14, 4, 4, '#e8c06a');
  R(c, x + w + 2, gy - 13, 2, 2, '#fff6d0');
}

function drawTower(c, b, x, gy, st, v, lights, world) {
  const stone = st.gothic ? '#5e5870' : '#9a958c';
  R(c, x + 1, gy - 38, b.w - 2, 38, stone);
  for (let y = 0; y < 38; y += 4) for (let i = (y / 4) % 2 ? 0 : 3; i < b.w - 2; i += 6) R(c, x + 1 + i, gy - 38 + y, 1, 4, shade(stone, 0.12));
  for (let i = 0; i < b.w; i += 3) R(c, x + i, gy - 41, 2, 3, stone);
  R(c, x, gy - 38, b.w, 1, shade(stone, 0.2));
  windowAt(c, x + b.w / 2 - 1, gy - 30, 2, 4, v.n > 0.3 && world.lightOn(b.id), lights, v.n);
  windowAt(c, x + b.w / 2 - 1, gy - 18, 2, 4, v.n > 0.3 && world.lightOn(b.id), lights, v.n);
  R(c, x + b.w / 2 - 2, gy - 6, 4, 6, '#3a2a1a');
  // флаг цвета иконки
  const fx = x + b.w / 2;
  R(c, fx, gy - 50, 1, 9, '#4a4a4a');
  for (let i = 0; i < 7; i++) {
    const wave = Math.round(Math.sin(world.t * 4 - i * 0.8));
    R(c, fx + 1 + i, gy - 50 + wave, 1, 4, i % 3 === 2 ? shade(v.letter, 0.2) : v.letter);
  }
}

function drawFountain(c, b, x, gy, st) {
  const stone = st.gothic ? '#6c6680' : '#a8a39a';
  R(c, x + 1, gy - 4, 18, 4, stone);
  R(c, x + 2, gy - 4, 16, 1, '#5aaee0');
  R(c, x + 9, gy - 9, 2, 5, stone);
  R(c, x + 6, gy - 10, 8, 1, stone);
  R(c, x + 7, gy - 10, 6, 1, '#7cc8f0');
}

const DRAWERS = { house: drawHouse, house4: drawHouse, goldmine: drawMine, gemmine: drawMine, forge: drawForge, windmill: drawWindmill, tavern: drawTavern, tower: drawTower, fountain: drawFountain };

function drawDecor(c, d, x, gy, st, v, lights, world) {
  switch (d.type) {
    case 'bench':
      R(c, x, gy - 3, 7, 1, st.wood);
      R(c, x, gy - 2, 1, 2, shade(st.wood, 0.3));
      R(c, x + 6, gy - 2, 1, 2, shade(st.wood, 0.3));
      R(c, x, gy - 5, 1, 2, st.wood);
      break;
    case 'pumpkin':
      R(c, x, gy - 3, 5, 3, '#e8822a');
      R(c, x + 1, gy - 4, 3, 1, '#e8822a');
      R(c, x + 2, gy - 5, 1, 1, '#4a6a2a');
      if (v.n > 0.3) {
        R(c, x + 1, gy - 3, 1, 1, '#000');
        R(c, x + 3, gy - 3, 1, 1, '#000');
        lights.push({ x: x + 2, y: gy - 2, r: 6, a: v.n * 0.8, core: [x + 1, gy - 3, 1, 1], core2: [x + 3, gy - 3, 1, 1], warm: '#ffb040' });
      }
      break;
    case 'bonfire': {
      R(c, x - 4, gy - 1, 9, 1, '#5a3a20');
      R(c, x - 3, gy - 2, 7, 1, '#7a5230');
      const f = world.t * 10;
      for (let i = -2; i <= 2; i++) {
        const h = 3 + Math.round(Math.abs(Math.sin(f + i * 1.7)) * 3) - Math.abs(i);
        R(c, x + i, gy - 2 - h, 1, h, i === 0 ? '#ffe070' : '#ff8a2a');
      }
      lights.push({ x, y: gy - 4, r: 22, a: Math.max(0.35, v.n), warm: '#ff9a40', flicker: true });
      break;
    }
    case 'mushrooms':
      for (const [dx, h] of [[0, 3], [4, 2], [7, 4]]) {
        R(c, x + dx + 1, gy - h, 1, h, '#f4e6c8');
        R(c, x + dx, gy - h - 2, 3, 2, '#d9363a');
        R(c, x + dx + 1, gy - h - 2, 1, 1, '#fff');
      }
      break;
    case 'crystal':
      R(c, x, gy - 6, 2, 6, '#2ec27e');
      R(c, x + 2, gy - 4, 2, 4, '#25a86c');
      R(c, x - 2, gy - 3, 2, 3, '#25a86c');
      R(c, x, gy - 6, 1, 1, '#c8ffe4');
      lights.push({ x: x + 1, y: gy - 3, r: 8, a: 0.25 + v.n * 0.4, warm: '#5dffb0' });
      break;
    case 'pickaxe':
      R(c, x, gy - 7, 1, 7, st.wood);
      R(c, x - 3, gy - 8, 7, 1, '#b8c0c8');
      R(c, x - 3, gy - 7, 1, 1, '#b8c0c8');
      R(c, x + 3, gy - 7, 1, 1, '#b8c0c8');
      break;
    case 'target':
      R(c, x, gy - 3, 1, 3, st.wood);
      R(c, x - 2, gy - 10, 5, 7, '#f3efe6');
      R(c, x - 1, gy - 9, 3, 5, '#d84040');
      R(c, x, gy - 7, 1, 1, '#f3efe6');
      break;
    default:
  }
}

function drawLantern(c, l, x, gy, v, lights, world) {
  const on = world.lightOn(l.id);
  R(c, x, gy - 11, 1, 11, '#34343a');
  R(c, x - 1, gy - 15, 3, 1, '#26262a');
  const lit = on && v.n > 0.25;
  R(c, x - 1, gy - 14, 3, 3, lit ? '#000' : on ? '#d8c890' : '#6a6a6a');
  if (lit) lights.push({ x: x + 0.5, y: gy - 12.5, r: 16, a: v.n, core: [x - 1, gy - 14, 3, 3] });
}

// ---------- Земля ----------

function drawGround(c, v, st, world) {
  const { W, H, camX, baseY } = v;
  const flowers = world.owned.has('v:flowers') || st.meadow;
  const dirt = shade(st.wood, 0.1);
  for (let sx = 0; sx < W; sx++) {
    const wx = Math.round(sx + camX);
    const g = world.groundAt(wx);
    const top = baseY - g;
    R(c, sx, top, 1, H - top, dirt);
    R(c, sx, top, 1, 3, hash(wx) > 0.75 ? st.grass2 : st.grass);
    R(c, sx, top + 3, 1, 1, st.grass2);
    if (hash(wx + 77) > 0.86) R(c, sx, top + 5 + Math.floor(hash(wx + 3) * 4), 1, 1, shade(dirt, 0.25));
    const hb = hash(wx * 3 + 11);
    if (hb > 0.8) R(c, sx, top - 1, 1, 1, st.grass2);
    if (flowers && hb > 0.93 && !world.buildings.some((b) => wx >= b.x - 2 && wx <= b.x + b.w + 2)) {
      R(c, sx, top - 2, 1, 2, st.grass2);
      R(c, sx, top - 3, 1, 1, ['#ff6f91', '#ffd23a', '#ffffff', '#c86bff', '#ff9a3c'][Math.floor(hash(wx + 9) * 5)]);
    }
  }
}

// ---------- Лес на переднем плане ----------

function drawForestFrame(c, v, flavor) {
  const { W, H } = v;
  const dark = flavor === 'gothic' ? '#1a1424' : flavor === 'autumn' ? '#3a2416' : '#14281a';
  const leaf = flavor === 'autumn' ? '#5a2e18' : flavor === 'gothic' ? '#231b30' : '#1d3a24';
  // кусты снизу
  for (let x = 0; x < W; x++) {
    const h = Math.round(2 + Math.abs(Math.sin(x * 0.13)) * 3 + Math.sin(x * 0.41) * 1.2);
    R(c, x, H - h, 1, h, x % 9 === 0 ? leaf : dark);
  }
  // стволы и ветви по краям
  const k = Math.min(1, W / 240); // на узком экране ветви короче — деревню не заслоняют
  const trunk = (x0, side) => {
    R(c, x0, 0, 5, H, dark);
    for (let y = 2; y < H - 6; y += 9) {
      const len = Math.round((8 + ((y * 7) % 9)) * k);
      for (let i = 0; i < len; i++) R(c, x0 + (side > 0 ? 5 + i : -i), y + Math.floor(i / 3), 1, 3 - Math.floor(i / 5), leaf);
    }
  };
  trunk(1, 1);
  trunk(W - 6, -1);
}

// ---------- Частицы и свет ----------

const FW = ['#ff5c7a', '#ffd23a', '#5dffb0', '#7ab8ff', '#c78cff'];

function drawParticles(c, v, world) {
  for (const p of world.particles) {
    const x = p.x - v.camX;
    const y = v.baseY - p.y;
    if (x < -4 || x > v.W + 4) continue;
    const a = clamp01(p.life * 1.5);
    c.globalAlpha = a;
    switch (p.kind) {
      case 'coin': R(c, x, y - 2, 2, 2, '#ffcc33'); R(c, x, y - 2, 1, 1, '#fff2a0'); break;
      case 'gem': R(c, x, y - 2, 2, 2, '#2ec27e'); R(c, x, y - 2, 1, 1, '#c8ffe4'); break;
      case 'spark': R(c, x, y, 1, 1, p.c > 0.5 ? '#ffd23a' : '#ff8a2a'); break;
      case 'fire': R(c, x, y, 2, 1, p.c > 0.5 ? '#ffb347' : '#ff5a2a'); break;
      case 'smoke': c.globalAlpha = a * 0.45; R(c, x, y, 2, 2, '#c8c8d0'); break;
      case 'drop': R(c, x, y, 1, 1, '#9ad8ff'); break;
      case 'dirt': R(c, x, y, 1, 1, '#8a6040'); break;
      case 'dust': c.globalAlpha = a * 0.6; R(c, x, y, 1, 1, '#d8c8a8'); break;
      case 'star': R(c, x, y, 1, 1, p.c > 0.5 ? '#fff6c0' : '#c8a6ff'); break;
      case 'arrow': R(c, x - (p.c > 0 ? 3 : 0), y, 3, 1, '#7a5230'); R(c, x + (p.c > 0 ? 0 : -1), y, 1, 1, '#d0d0d0'); break;
      case 'fw': R(c, x, y, 1, 1, FW[Math.floor(p.c * FW.length)]); break;
      default: R(c, x, y, 1, 1, '#fff');
    }
  }
  c.globalAlpha = 1;
}

function drawLights(c, v, lights) {
  if (!lights.length) return;
  c.globalCompositeOperation = 'lighter';
  for (const l of lights) {
    const a = clamp01(l.a) * (l.flicker ? 0.85 + Math.random() * 0.15 : 1);
    if (a <= 0.02) continue;
    const g = c.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
    const col = l.warm ? rgb(l.warm) : [255, 196, 96];
    g.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${0.55 * a})`);
    g.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
    c.fillStyle = g;
    c.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
  }
  c.globalCompositeOperation = 'source-over';
  for (const l of lights) {
    for (const k of [l.core, l.core2]) if (k) R(c, k[0], k[1], k[2], k[3], l.warm && l.warm !== '#ff8a3a' ? '#ffcf6a' : WARM);
  }
}

function drawCritters(c, v, flavor, world) {
  const { W, n, horizon } = v;
  // летучие мыши (готика, ночью), чайки (море, днём), бабочки (луг, днём), листья (осень)
  if (flavor === 'gothic' && n > 0.5) {
    for (let i = 0; i < 4; i++) {
      const x = ((world.t * (10 + i * 3) + i * 97) % (W + 40)) - 20;
      const y = horizon * 0.5 + Math.sin(world.t * 2 + i) * 6 + i * 4;
      const f = Math.floor(world.t * 8 + i) % 2;
      R(c, x, y, 1, 1, '#120a1c');
      R(c, x - 2, y - f, 2, 1, '#120a1c');
      R(c, x + 1, y - f, 2, 1, '#120a1c');
    }
  }
  if (flavor === 'sea' && n < 0.4) {
    for (let i = 0; i < 3; i++) {
      const x = ((world.t * (6 + i * 2) + i * 140) % (W + 40)) - 20;
      const y = horizon * 0.4 + Math.sin(world.t + i * 2) * 4 + i * 5;
      const f = Math.floor(world.t * 3 + i) % 2;
      R(c, x - 2, y - f, 2, 1, '#f3f6fa');
      R(c, x, y, 1, 1, '#f3f6fa');
      R(c, x + 1, y - f, 2, 1, '#f3f6fa');
    }
  }
  if (flavor === 'meadow' && n < 0.4) {
    for (let i = 0; i < 4; i++) {
      const x = (hash(i) * W + Math.sin(world.t * 0.4 + i) * 30 + W) % W;
      const y = v.baseY - 10 - Math.abs(Math.sin(world.t * 1.3 + i)) * 10;
      const f = Math.floor(world.t * 10 + i) % 2;
      const col = ['#ffd23a', '#ff8fb0', '#8fd0ff', '#ffffff'][i];
      R(c, x - (f ? 1 : 0), y, f ? 3 : 1, 1, col);
    }
  }
  if (flavor === 'autumn') {
    for (let i = 0; i < 7; i++) {
      const fall = (world.t * (6 + hash(i) * 4) + hash(i + 1) * 80) % 80;
      const x = (hash(i + 2) * W + Math.sin(world.t + i) * 6 + fall * 0.4) % W;
      const y = v.baseY - 50 + fall;
      if (y < v.baseY) R(c, x, y, 1 + (i % 2), 1, ['#e8822a', '#d9682e', '#e8a33a'][i % 3]);
    }
  }
  if (flavor === 'sea' && v.beacon && n > 0.35) {
    const ang = world.t * 1.2;
    const dir = Math.cos(ang);
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = clamp01(n) * 0.35 * Math.abs(dir);
    const len = 60 * Math.abs(dir);
    for (let i = 0; i < len; i++) R(c, v.beacon.x + Math.sign(dir) * i, v.beacon.y - i * 0.08 - 1, 1, 2 + i * 0.06, '#fff2b0');
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }
}

// ---------- Кадр ----------

/**
 * Нарисовать кадр. c — контекст видимого холста, land — контекст вспомогательного того же размера (для затемнения ночью).
 * v: { W, H, camX, baseY, horizon, phase, n, style, letter, mode }
 */
export function drawVillage(c, land, world, v) {
  const st = v.style;
  const flavor = flavorOf(st);
  c.imageSmoothingEnabled = false;
  drawSky(c, v, flavor, world);
  const L = land;
  L.clearRect(0, 0, v.W, v.H);
  drawFar(L, v, st, flavor, world);
  const toX = (wx) => Math.round(wx - v.camX);
  const gyOf = (wx) => v.baseY - world.groundAt(wx);
  const lights = [];
  for (const t of world.trees) {
    const x = toX(t.x);
    if (x > -20 && x < v.W + 20) tree(L, x, gyOf(t.x) + 1, flavor, t.s);
  }
  drawGround(L, v, st, world);
  for (const b of world.buildings) {
    const x = toX(b.x);
    if (x + b.w < -16 || x > v.W + 16) continue;
    DRAWERS[b.type]?.(L, b, x, v.baseY - b.ground, st, v, lights, world);
  }
  for (const d of world.decor) {
    const x = toX(d.x);
    if (x > -10 && x < v.W + 10) drawDecor(L, d, x, gyOf(d.x), st, v, lights, world);
  }
  for (const l of world.lanterns) {
    const x = toX(l.x);
    if (x > -10 && x < v.W + 10) drawLantern(L, l, x, gyOf(l.x), v, lights, world);
  }
  // жители
  const night = v.n > 0.5;
  for (const a of world.actors) {
    if (a.hidden) continue;
    const x = toX(a.x);
    if (x < -30 || x > v.W + 30) continue;
    const y = Math.round(v.baseY - a.y);
    if (a.thread != null) {
      L.globalAlpha = 0.7;
      R(L, x, v.baseY - a.thread, 1, Math.max(0, a.thread - a.y - 4), '#e8e8f0');
      L.globalAlpha = 1;
    }
    const g = painter(L, x, y, a.dir, a.u, a.alpha);
    drawCharacter(g, a.kind, { state: a.state, phase: a.phase, t: a.anim, night, happy: a.happy, squash: a.squash > 0.3, fire: a.fire });
  }
  drawForestFrame(L, v, flavor);
  // ночь и сумерки: затемняем только «землю», небо уже своего цвета
  const { dusk } = skyColors(flavor, v.phase);
  if (v.n > 0.01 || dusk > 0.05) {
    L.globalCompositeOperation = 'source-atop';
    if (v.n > 0.01) {
      const s = rgb(SKY[flavor].shade);
      L.fillStyle = `rgba(${s[0]},${s[1]},${s[2]},${0.52 * v.n})`;
      L.fillRect(0, 0, v.W, v.H);
    }
    if (dusk > 0.05) {
      L.fillStyle = `rgba(255,140,80,${0.12 * dusk})`;
      L.fillRect(0, 0, v.W, v.H);
    }
    L.globalCompositeOperation = 'source-over';
  }
  c.drawImage(L.canvas, 0, 0);
  drawLights(c, v, lights);
  // светлячки
  if (world.fireflies.length && v.n > 0.2) {
    for (const f of world.fireflies) {
      const x = toX(f.x);
      const y = v.baseY - f.y;
      const a = clamp01((v.n - 0.2) * 2) * (0.5 + 0.5 * Math.sin(f.p * 3));
      c.globalAlpha = a * 0.35;
      R(c, x - 1, y - 1, 3, 3, '#d8ff7a');
      c.globalAlpha = a;
      R(c, x, y, 1, 1, '#f4ffb0');
    }
    c.globalAlpha = 1;
  }
  drawCritters(c, v, flavor, world);
  drawParticles(c, v, world);
  for (const a of world.actors) {
    if (a.hidden || !a.emote) continue;
    const x = toX(a.x);
    drawEmote(c, x, Math.round(v.baseY - a.y - charHeight(a.kind) * a.u - 4), a.emote, 1);
  }
}

/**
 * Гость у экрана: крупный житель на своём маленьком холсте поверх приложения.
 * v: { W, H, u, ground } (ground — y земли), world.visitor — состояние.
 */
export function drawVisitor(c, world, v) {
  const vis = world.visitor;
  c.clearRect(0, 0, v.W, v.H);
  if (!vis) return;
  const st = v.style;
  const flavor = flavorOf(st);
  c.imageSmoothingEnabled = false;
  // выходит из-за края экрана (из леса) и встаёт ближе к середине своего холста
  const from = vis.side < 0 ? -9 * v.u : v.W + 9 * v.u;
  const to = v.W * (vis.side < 0 ? 0.45 : 0.55);
  const x = Math.round(from + (to - from) * vis.x);
  // лесная тропинка от края экрана до места, где стоит гость: трава сходит на нет
  const dark = flavor === 'gothic' ? '#2a2236' : flavor === 'autumn' ? '#5a3a1e' : '#2e5a34';
  const reach = Math.round(to) + 9;
  for (let i = 0; i < reach; i++) {
    const px = vis.side < 0 ? i : v.W - 1 - i;
    const h = Math.max(0, Math.round((2 + Math.abs(Math.sin(px * 0.35)) * 2) * Math.min(1, (reach - i) / 6)));
    R(c, px, v.H - h, 1, h, px % 5 ? dark : st.grass2);
  }
  const y = v.H - 3 - Math.round(vis.y / 6);
  const dir = vis.stage === 'out' ? vis.side : -vis.side;
  const g = painter(c, x, y, dir, v.u, 1);
  drawCharacter(g, vis.kind, { state: vis.state, phase: vis.phase || 0, t: vis.anim || 0, happy: vis.stage === 'poked', night: v.n > 0.5 });
  const hTop = y - charHeight(vis.kind) * v.u;
  if (vis.emote) drawEmote(c, x, hTop - 6, vis.emote, Math.max(1, v.u - 1));
  // круги на «стекле» от стука
  const kx = x + dir * 6 * v.u;
  const ky = y - 9 * v.u;
  for (const r of vis.ripples) {
    const rad = 2 + r.t * 14;
    c.globalAlpha = (1 - r.t / 0.9) * 0.8;
    c.strokeStyle = '#ffffff';
    c.lineWidth = 1;
    c.beginPath();
    c.arc(kx, ky, rad, 0, Math.PI * 2);
    c.stroke();
  }
  c.globalAlpha = 1;
  return { x, y, top: hTop, w: 8 * v.u };
}
