// Отрисовка деревни (обновление 0.7, вид сверху «как в Stardew Valley» — 0.7.1) на холсте низкого разрешения.
//
// Земля (трава, дорожки, площадь, вода, скалы, поля, тени) рисуется в кэш один раз на раскладку и стиль.
// Постройки, деревья и обстановка — спрайты, каждый тоже рисуется в свой кэш один раз; в кадре они и жители
// сортируются по глубине (нижний край) и выводятся готовыми картинками. Ночь — затемнение всего кадра, поверх —
// тёплые огни окон и фонарей, потом частицы, светлячки, погода.

import { painter, drawCharacter, drawEmote, charHeight } from './puppets.js';
import { chibiSprite, lookKey, poseOf, LOOKS, CW, CH } from './chibi.js';
import { critterSprite, critterPose, CRITTERS } from './critters.js';
import { TILE, T, rnd } from './map.js';
import { SPRITE_H } from './world.js';

// ---------- Цвета и примитивы ----------

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

function R(c, x, y, w, h, col) {
  if (w <= 0 || h <= 0) return;
  c.fillStyle = col;
  c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}
const P = (c, x, y, col) => R(c, x, y, 1, 1, col);

function ellipse(c, cx, cy, rx, ry, col) {
  c.fillStyle = col;
  for (let y = -Math.floor(ry); y <= Math.floor(ry); y++) {
    const w = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry))));
    c.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2 + 1, 1);
  }
}
const disc = (c, cx, cy, r, col) => ellipse(c, cx, cy, r, r, col);

export const flavorOf = (st) => (st.gothic ? 'gothic' : st.meadow ? 'meadow' : st.sea ? 'sea' : st.autumn ? 'autumn' : 'classic');

const SHADE_NIGHT = { classic: '#0c1236', gothic: '#1a0a2e', meadow: '#0c1838', sea: '#061632', autumn: '#180e2c' };

/** Насколько «сумерки» (0…1) — тёплый оттенок на закате и рассвете. */
export function duskOf(phase) {
  const e = -Math.cos(phase * Math.PI * 2);
  return clamp01(1 - Math.abs(e - 0.02) / 0.3) * 0.85;
}

// [основной, тень, блик, обводка]
const TREES = {
  classic: [['#2f6b33', '#1f4c26', '#4a8a44', '#16351b'], ['#3a7a36', '#285c28', '#589c4a', '#183c1a'], ['#2a6044', '#1c4630', '#3f7d58', '#12301f']],
  meadow: [['#3f8a36', '#2c6a28', '#62a84e', '#1a4418'], ['#4a9640', '#337630', '#70b45a', '#1d4a1c'], ['#3a7e3a', '#2a602a', '#5a9e50', '#183c18']],
  sea: [['#2c6a48', '#1e4e34', '#448a62', '#133222'], ['#357a50', '#265c3a', '#4f9a68', '#173c26'], ['#2c6a48', '#1e4e34', '#448a62', '#133222']],
  autumn: [['#c8622a', '#963e18', '#e88a40', '#5a2410'], ['#d89a34', '#a87020', '#f2bc54', '#5c3a10'], ['#a8422a', '#7a2c1a', '#c86040', '#46160c']],
  gothic: [['#2a3a32', '#1b2721', '#3a4e44', '#0f1612'], ['#32304a', '#221f33', '#46426a', '#121020'], ['#2e2436', '#1e1726', '#403350', '#100c16']],
};

function palette(st, flavor) {
  const grass = st.grass;
  return {
    grass, grass2: st.grass2, grassD: shade(st.grass2, 0.25), tuft: tint(grass, 0.22),
    high: tint(grass, 0.06), path: st.path || '#a9865a', stone: st.stone || '#8c8a84', water: st.water || '#3a7db5',
    cliff: st.cliff || '#7b6a58', sand: st.sand || '#d6c08a', wood: st.wood, wall: st.wall, roof: st.roof,
    iron: '#33333b', trees: TREES[flavor] || TREES.classic, soil: flavor === 'autumn' ? '#6e4a2a' : '#5e4028',
  };
}

// ---------- Земля ----------

function grassTile(c, X, Y, base, K) {
  const { pal } = K;
  R(c, X, Y, TILE, TILE, base);
  const dark = mix(base, pal.grassD, 0.55);
  const light = tint(base, 0.1);
  for (let j = 0; j < TILE; j += 2) {
    for (let i = 0; i < TILE; i += 2) {
      const h = rnd(X + i, Y + j);
      if (h < 0.16) R(c, X + i, Y + j, 2, 2, dark);
      else if (h < 0.22) R(c, X + i + 1, Y + j, 1, 2, dark);
      else if (h > 0.94) R(c, X + i, Y + j, 2, 1, light);
    }
  }
  if (rnd(X * 3, Y) > 0.45) {
    const x = X + 2 + Math.floor(rnd(X, Y * 5) * 8);
    const y = Y + 3 + Math.floor(rnd(X * 5, Y) * 7);
    P(c, x, y - 1, pal.tuft);
    P(c, x - 1, y, pal.tuft);
    P(c, x + 1, y, pal.tuft);
    P(c, x, y, dark);
  }
  const flowers = K.flowers || K.flavor === 'meadow';
  if (flowers && rnd(X, Y * 7) > (K.flavor === 'meadow' ? 0.72 : 0.85)) {
    const x = X + 2 + Math.floor(rnd(X * 7, Y) * 8);
    const y = Y + 2 + Math.floor(rnd(X, Y * 11) * 8);
    const col = ['#ff6f91', '#ffd23a', '#ffffff', '#c86bff', '#ff9a3c'][Math.floor(rnd(X + 3, Y) * 5)];
    P(c, x, y, col);
    P(c, x + 1, y + 1, col);
    P(c, x, y + 1, shade(col, 0.2));
  } else if (rnd(X * 11, Y * 3) > 0.97) {
    R(c, X + 4, Y + 6, 3, 2, '#8a8780');
    P(c, X + 4, Y + 6, '#a8a59c');
  }
}

function pathTile(c, X, Y, K) {
  const p = K.pal.path;
  R(c, X, Y, TILE, TILE, p);
  for (let j = 0; j < TILE; j += 2) {
    for (let i = 0; i < TILE; i += 2) {
      const h = rnd(X + i + 7, Y + j);
      if (h < 0.15) R(c, X + i, Y + j, 2, 1, shade(p, 0.1));
      else if (h > 0.9) P(c, X + i, Y + j, tint(p, 0.14));
    }
  }
  if (rnd(X, Y + 3) > 0.6) {
    const x = X + 2 + Math.floor(rnd(X + 1, Y) * 7);
    const y = Y + 2 + Math.floor(rnd(X, Y + 1) * 7);
    R(c, x, y, 2, 2, shade(p, 0.28));
    P(c, x, y, tint(p, 0.2));
  }
}

function plazaTile(c, X, Y, K) {
  const s = K.pal.stone;
  R(c, X, Y, TILE, TILE, shade(s, 0.28));
  for (let row = 0; row < 4; row++) {
    const off = row % 2 ? 3 : 0;
    for (let x = -off; x < TILE; x += 6) {
      const x0 = Math.max(0, x);
      const x1 = Math.min(TILE, x + 5);
      const k = rnd(X + x, Y + row);
      R(c, X + x0, Y + row * 3, x1 - x0, 2, k > 0.7 ? tint(s, 0.08) : k < 0.2 ? shade(s, 0.06) : s);
      R(c, X + x0, Y + row * 3, x1 - x0, 1, tint(s, 0.12));
    }
  }
}

function fieldTile(c, X, Y, K) {
  R(c, X, Y, TILE, TILE, K.pal.soil);
  for (let j = 1; j < TILE; j += 4) R(c, X, Y + j, TILE, 1, shade(K.pal.soil, 0.25));
  for (let j = 3; j < TILE; j += 4) {
    for (let i = 1; i < TILE; i += 4) {
      const k = rnd(X + i, Y + j);
      const f = K.flavor;
      if (f === 'autumn') {
        R(c, X + i, Y + j - 3, 1, 4, '#d8b44a');
        P(c, X + i, Y + j - 4, '#f0d070');
      } else if (f === 'gothic') {
        R(c, X + i - 1, Y + j - 1, 3, 2, k > 0.5 ? '#6a4a8a' : '#4a6a52');
      } else if (f === 'meadow' && k > 0.5) {
        P(c, X + i, Y + j - 2, ['#ff6f91', '#ffd23a', '#c86bff'][Math.floor(k * 3)]);
        P(c, X + i, Y + j - 1, '#3a7430');
      } else {
        R(c, X + i - 1, Y + j - 1, 3, 2, '#4f9a3c');
        P(c, X + i, Y + j - 2, '#6ab84e');
        if (k > 0.75) P(c, X + i, Y + j, '#e8822a');
      }
    }
  }
}

function waterTile(c, X, Y, K, sea) {
  const w = sea ? shade(K.pal.water, 0.12) : K.pal.water;
  R(c, X, Y, TILE, TILE, w);
  for (let j = 0; j < TILE; j += 3) {
    const k = rnd(X, Y + j);
    if (k > 0.55) R(c, X + Math.floor(k * 6), Y + j, 3 + Math.floor(k * 3), 1, tint(w, 0.14));
  }
}

function bridgeTile(c, X, Y, K) {
  const wood = mix(K.pal.wood, '#a0703a', 0.35);
  R(c, X, Y, TILE, TILE, wood);
  for (let i = 0; i < TILE; i += 3) R(c, X + i, Y, 1, TILE, shade(wood, 0.35));
  for (let i = 1; i < TILE; i += 3) if (rnd(X + i, Y) > 0.6) P(c, X + i, Y + Math.floor(rnd(Y, X + i) * 10), shade(wood, 0.2));
}

function cliffTile(c, X, Y, top, K) {
  const cl = K.pal.cliff;
  R(c, X, Y, TILE, TILE, cl);
  for (let j = 0; j < TILE; j += 3) {
    for (let i = 0; i < TILE; i += 4) {
      const k = rnd(X + i, Y + j);
      const off = (j / 3) % 2 ? 2 : 0;
      R(c, X + i + off, Y + j, 3, 2, k > 0.6 ? tint(cl, 0.1) : k < 0.3 ? shade(cl, 0.14) : cl);
      P(c, X + i + off, Y + j + 2, shade(cl, 0.3));
    }
  }
  if (top) {
    // край уступа: трава нависает, под ней тень
    R(c, X, Y, TILE, 3, K.pal.high);
    for (let i = 0; i < TILE; i++) if (rnd(X + i, Y) > 0.45) P(c, X + i, Y + 3, K.pal.high);
    R(c, X, Y + 4, TILE, 1, shade(cl, 0.35));
  }
}

function sandTile(c, X, Y, K) {
  const s = K.pal.sand;
  R(c, X, Y, TILE, TILE, s);
  for (let j = 0; j < TILE; j += 2) for (let i = 0; i < TILE; i += 2) if (rnd(X + i, Y + j + 3) > 0.85) P(c, X + i, Y + j, shade(s, 0.12));
}

/** Земля всей карты: тайлы, края, берега, тени от построек и деревьев. */
function paintGround(c, map, K) {
  const { grid, cols, rows } = map;
  const at = (x, y) => (x < 0 || y < 0 || x >= cols || y >= rows ? -1 : grid[y * cols + x]);
  const near = (tx, ty) => tx > map.land.x0 - 12 && tx < map.land.x1 + 12 && ty > map.land.y0 - 12 && ty < map.land.y1 + 12;
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const X = tx * TILE;
      const Y = ty * TILE;
      const t = at(tx, ty);
      if (t === T.FOREST && !near(tx, ty)) {
        // дальний лес — без мелкой фактуры (его всё равно закрывают деревья)
        R(c, X, Y, TILE, TILE, mix(K.pal.grass, K.pal.grassD, 0.6));
        continue;
      }
      if (t === T.GRASS) grassTile(c, X, Y, K.pal.grass, K);
      else if (t === T.HIGH) grassTile(c, X, Y, K.pal.high, K);
      else if (t === T.FOREST) grassTile(c, X, Y, mix(K.pal.grass, K.pal.grassD, 0.55), K);
      else if (t === T.PATH) pathTile(c, X, Y, K);
      else if (t === T.PLAZA) plazaTile(c, X, Y, K);
      else if (t === T.WATER) waterTile(c, X, Y, K, false);
      else if (t === T.SEA) waterTile(c, X, Y, K, true);
      else if (t === T.CLIFF) cliffTile(c, X, Y, ty === map.cliffY, K);
      else if (t === T.FIELD) fieldTile(c, X, Y, K);
      else if (t === T.BRIDGE) bridgeTile(c, X, Y, K);
      else if (t === T.SAND) sandTile(c, X, Y, K);
    }
  }
  // края: трава заходит на дорожки, у площади — бордюр, у воды — берег и пена
  const soft = (t) => t === T.GRASS || t === T.FOREST || t === T.HIGH;
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      if (!near(tx, ty)) continue;
      const t = at(tx, ty);
      const X = tx * TILE;
      const Y = ty * TILE;
      if (t === T.PATH || t === T.FIELD) {
        const g = K.pal.grass;
        if (soft(at(tx, ty - 1))) for (let i = 0; i < TILE; i++) R(c, X + i, Y, 1, 1 + Math.floor(rnd(X + i, Y) * 2.4), g);
        if (soft(at(tx, ty + 1))) for (let i = 0; i < TILE; i++) {
          const d = 1 + Math.floor(rnd(X + i, Y + 5) * 2.4);
          R(c, X + i, Y + TILE - d, 1, d, g);
          P(c, X + i, Y + TILE - d - 1, shade(K.pal.path, 0.2));
        }
        if (soft(at(tx - 1, ty))) for (let j = 0; j < TILE; j++) R(c, X, Y + j, 1 + Math.floor(rnd(X, Y + j) * 2.4), 1, g);
        if (soft(at(tx + 1, ty))) for (let j = 0; j < TILE; j++) {
          const d = 1 + Math.floor(rnd(X + 3, Y + j) * 2.4);
          R(c, X + TILE - d, Y + j, d, 1, g);
        }
      } else if (t === T.PLAZA) {
        const curb = shade(K.pal.stone, 0.35);
        if (at(tx, ty - 1) !== T.PLAZA) R(c, X, Y, TILE, 1, curb);
        if (at(tx, ty + 1) !== T.PLAZA) R(c, X, Y + TILE - 1, TILE, 1, curb);
        if (at(tx - 1, ty) !== T.PLAZA) R(c, X, Y, 1, TILE, curb);
        if (at(tx + 1, ty) !== T.PLAZA) R(c, X + TILE - 1, Y, 1, TILE, curb);
      } else if (t === T.WATER || t === T.SEA) {
        const bank = K.flavor === 'sea' ? shade(K.pal.sand, 0.15) : shade(K.pal.grass2, 0.3);
        const foam = 'rgba(220,240,250,0.7)';
        const dry = (x, y) => {
          const n = at(x, y);
          return n !== T.WATER && n !== T.SEA && n !== T.BRIDGE && n !== T.CLIFF && n !== -1;
        };
        if (dry(tx, ty - 1)) {
          R(c, X, Y, TILE, 2, bank);
          R(c, X, Y + 2, TILE, 1, foam);
        }
        if (dry(tx, ty + 1)) {
          R(c, X, Y + TILE - 1, TILE, 1, bank);
          R(c, X, Y + TILE - 2, TILE, 1, foam);
        }
        if (dry(tx - 1, ty)) {
          R(c, X, Y, 1, TILE, bank);
          R(c, X + 1, Y, 1, TILE, foam);
        }
        if (dry(tx + 1, ty)) {
          R(c, X + TILE - 1, Y, 1, TILE, bank);
          R(c, X + TILE - 2, Y, 1, TILE, foam);
        }
      } else if (t === T.GRASS && at(tx, ty - 1) === T.CLIFF) {
        c.globalAlpha = 0.28; // тень под скалой
        R(c, X, Y, TILE, 3, '#000');
        c.globalAlpha = 1;
      }
    }
  }
  // пруд: кувшинки и камыш
  const pd = map.pond;
  for (let i = 0; i < 7; i++) {
    const x = pd.x * TILE + 6 + rnd(i, 3) * (pd.w * TILE - 12);
    const y = pd.y * TILE + 5 + rnd(3, i) * (pd.h * TILE - 10);
    ellipse(c, x, y, 3, 2, '#3f8a3a');
    P(c, x + 1, y - 1, '#2e6a2c');
    if (i % 3 === 0) P(c, x - 1, y - 1, '#ff8fb0');
  }
  for (let i = 0; i < 10; i++) {
    const side = i % 2;
    const x = pd.x * TILE + (side ? pd.w * TILE - 2 : 1) + (rnd(i, 9) - 0.5) * 2;
    const y = pd.y * TILE + 3 + rnd(9, i) * (pd.h * TILE - 6);
    R(c, x, y - 5, 1, 6, '#2f5a2a');
    P(c, x, y - 6, '#6a4a2a');
  }
  // тени построек и деревьев на земле
  c.globalAlpha = 0.22;
  for (const b of map.buildings) {
    if (b.type === 'field') continue;
    if (b.type.endsWith('mine')) {
      ellipse(c, b.x + b.w / 2 + 2, b.base - 3, b.w / 2 + 2, 5, '#000');
      continue;
    }
    if (b.type === 'fountain') {
      ellipse(c, b.x + b.w / 2 + 2, b.base - 6, b.w / 2, 6, '#000');
      continue;
    }
    R(c, b.x + 3, b.base - 2, b.w, 5, '#000');
    R(c, b.x + b.w, b.base - b.h + 4, 4, b.h, '#000');
  }
  for (const t of map.trees) ellipse(c, t.x + 2, t.y - 1, 9 * t.size, 3.5 * t.size, '#000');
  c.globalAlpha = 1;
}

// ---------- Спрайты: деревья ----------

function roundTree(c, cx, by, size, cols, seed, fruit) {
  const [base, dark, light, line] = cols;
  const r = Math.round(10 * size);
  const th = Math.round(7 * size);
  const bark = '#5a3d24';
  R(c, cx - 2, by - th, 4, th, bark);
  R(c, cx + 1, by - th, 1, th, shade(bark, 0.35));
  P(c, cx - 3, by - 1, bark);
  P(c, cx + 2, by - 1, bark);
  const cy = by - th - r + 3;
  const blobs = [[0, 0, 1], [-0.62, 0.28, 0.72], [0.62, 0.3, 0.7], [-0.28, -0.52, 0.66], [0.3, -0.45, 0.62]];
  for (const [dx, dy, k] of blobs) disc(c, cx + dx * r, cy + dy * r, r * k + 1, line);
  for (const [dx, dy, k] of blobs) disc(c, cx + dx * r, cy + dy * r + 1, r * k, dark);
  for (const [dx, dy, k] of blobs) disc(c, cx + dx * r - 0.5, cy + dy * r - 0.5, r * k - 1.2, base);
  for (const [dx, dy, k] of blobs.slice(2)) disc(c, cx + dx * r - 1.5, cy + dy * r - 1.5, r * k * 0.5, light);
  for (let i = 0; i < r * 3; i++) {
    const a = rnd(seed, i) * Math.PI * 2;
    const d = Math.sqrt(rnd(i, seed + 3)) * r * 0.9;
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d * 0.9;
    if (rnd(seed + i, 7) > 0.5) {
      P(c, x, y, dark);
      P(c, x + 1, y, dark);
    } else P(c, x, y, light);
  }
  if (fruit) for (let i = 0; i < 5; i++) {
    const x = cx + (rnd(seed, i + 30) - 0.5) * r * 1.4;
    const y = cy + (rnd(i + 30, seed) - 0.5) * r;
    R(c, x, y, 2, 2, fruit);
    P(c, x, y, tint(fruit, 0.4));
  }
}

function pineTree(c, cx, by, size, cols, seed) {
  const [base, dark, light, line] = cols;
  const h = Math.round(30 * size);
  R(c, cx - 1, by - 5, 3, 5, '#4a3320');
  const tiers = 4;
  for (let t = 0; t < tiers; t++) {
    const ty = by - 4 - Math.round((t * h) / (tiers + 0.7));
    const th = Math.round(h / 2.5);
    const tw = Math.round((tiers - t) * 2.6 * size + 3);
    for (let r = 0; r <= th; r++) {
      const half = Math.max(0, Math.round((tw * (th - r)) / th));
      R(c, cx - half - 1, ty - r, half * 2 + 3, 1, line);
    }
    for (let r = 0; r < th; r++) {
      const half = Math.max(0, Math.round((tw * (th - r)) / th) - 1);
      R(c, cx - half, ty - r, half, 1, r < 2 ? dark : light);
      R(c, cx, ty - r, half + 1, 1, r < 2 ? shade(dark, 0.2) : base);
      if (r % 3 === 1 && half > 2) P(c, cx + half - 1, ty - r, dark);
    }
  }
  P(c, cx, by - h - 5, light);
  if (seed % 4 === 0) P(c, cx - 2, by - Math.round(h * 0.55), light);
}

function deadTree(c, cx, by, size) {
  const col = '#2e2436';
  const h = Math.round(24 * size);
  R(c, cx - 1, by - h, 3, h, col);
  P(c, cx - 2, by - 1, col);
  P(c, cx + 2, by - 1, col);
  for (const [dir, at, len] of [[-1, 0.55, 7], [1, 0.45, 6], [-1, 0.25, 5], [1, 0.75, 5]]) {
    const yy = by - Math.round(h * at);
    for (let i = 0; i < len * size; i++) P(c, cx + dir * (i + 2), yy - Math.floor(i / 2), col);
  }
}

// ---------- Спрайты: постройки ----------
// Рисуются в локальной системе: x = 2 — левый край основания, y = SPRITE_H[type] — его нижний край.

function masonry(c, x, y, w, h, base, bw = 5, bh = 3, seed = 0) {
  R(c, x, y, w, h, shade(base, 0.32));
  for (let row = 0, yy = y; yy < y + h; row++, yy += bh) {
    const off = row % 2 ? Math.floor(bw / 2) : 0;
    for (let xx = x - off; xx < x + w; xx += bw) {
      const x0 = Math.max(x, xx);
      const x1 = Math.min(x + w, xx + bw - 1);
      const hh = Math.min(bh - 1, y + h - yy);
      const k = rnd(xx + seed, yy);
      R(c, x0, yy, x1 - x0, hh, k > 0.7 ? tint(base, 0.08) : k < 0.25 ? shade(base, 0.08) : base);
      if (hh > 1) R(c, x0, yy, x1 - x0, 1, tint(base, 0.14));
    }
  }
}

function plaster(c, x, y, w, h, col, seed) {
  R(c, x, y, w, h, col);
  for (let i = 0; i < (w * h) / 10; i++) P(c, x + Math.floor(rnd(seed, i) * w), y + Math.floor(rnd(i, seed) * h), rnd(seed + 1, i) > 0.5 ? shade(col, 0.05) : tint(col, 0.05));
}

/** Крыша вида сверху-спереди: трапеция с рядами черепицы, конёк сверху. */
function roofSlope(c, x, y, w, h, col, inset = 6) {
  const line = shade(col, 0.55);
  for (let r = 0; r < h; r++) {
    const k = r / Math.max(1, h - 1);
    const ins = Math.round(inset * (1 - k));
    const yy = y + r;
    const band = Math.floor((h - r) / 3) % 2;
    const c0 = mix(tint(col, 0.1), shade(col, 0.12), k);
    R(c, x + ins, yy, w - ins * 2, 1, band ? c0 : shade(c0, 0.08));
    if ((h - r) % 3 === 0) {
      R(c, x + ins, yy, w - ins * 2, 1, shade(c0, 0.22));
      for (let sx = x + ins + (band ? 2 : 0); sx < x + w - ins; sx += 4) P(c, sx, yy + 1, shade(c0, 0.25));
    }
    P(c, x + ins, yy, line);
    P(c, x + w - ins - 1, yy, line);
  }
  R(c, x + inset, y, w - inset * 2, 2, tint(col, 0.2));
  R(c, x + inset, y, w - inset * 2, 1, line);
  R(c, x, y + h - 1, w, 2, line);
}

function windowAt(c, x, y, w, h, K, out, opts = {}) {
  const frame = shade(K.pal.wood, 0.3);
  R(c, x - 1, y - 1, w + 2, h + 2, frame);
  R(c, x, y, w, h, '#2a2f48');
  R(c, x, y, w, 2, '#5a78a0');
  P(c, x + 1, y + 1, '#c4e2f4');
  R(c, x + Math.floor(w / 2), y, 1, h, frame);
  R(c, x, y + Math.floor(h / 2), w, 1, frame);
  R(c, x - 2, y + h + 1, w + 4, 1, shade(K.pal.wood, 0.05));
  out.push({ x, y, w, h, frame });
  if (opts.shutters) {
    const sc = opts.shutters;
    R(c, x - 4, y - 1, 2, h + 2, sc);
    R(c, x + w + 2, y - 1, 2, h + 2, sc);
    for (let j = 1; j < h + 1; j += 2) {
      P(c, x - 4, y + j, shade(sc, 0.3));
      P(c, x + w + 3, y + j, shade(sc, 0.3));
    }
  }
  if (opts.box) {
    R(c, x - 1, y + h + 2, w + 2, 3, K.pal.wood);
    R(c, x - 1, y + h + 2, w + 2, 1, tint(K.pal.wood, 0.15));
    for (let i = 0; i < w + 2; i++) P(c, x - 1 + i, y + h + 1 - (i % 2), ['#ff6f91', '#ffd23a', '#ff9a3c', '#c86bff', '#7ad06a'][(i + x) % 5]);
  }
}

function doorAt(c, x, y, w, h, K) {
  const wood = K.pal.wood;
  R(c, x - 1, y - 1, w + 2, h + 1, shade(wood, 0.5));
  R(c, x, y + 1, w, h - 1, wood);
  R(c, x + 1, y, w - 2, 1, wood);
  for (let i = 2; i < w; i += 2) R(c, x + i, y + 1, 1, h - 1, shade(wood, 0.16));
  R(c, x, y + 3, w, 1, shade(wood, 0.4));
  R(c, x, y + h - 4, w, 1, shade(wood, 0.4));
  P(c, x + w - 2, y + Math.floor(h / 2), '#e6c84a');
  R(c, x - 2, y + h, w + 4, 2, K.pal.stone);
  R(c, x - 2, y + h, w + 4, 1, tint(K.pal.stone, 0.15));
}

function wallLamp(c, x, y, K, lamps) {
  R(c, x, y, 3, 1, K.pal.iron);
  R(c, x + 2, y + 1, 3, 4, K.pal.iron);
  R(c, x + 3, y + 2, 1, 2, '#d8c890');
  lamps.push({ x: x + 3, y: y + 2, w: 1, h: 2, r: 16 });
}

function chimney(c, x, y, h, K) {
  masonry(c, x, y, 7, h, mix(K.pal.roof, '#8a4a32', 0.5), 3, 2, x);
  R(c, x - 1, y - 2, 9, 2, shade(K.pal.stone, 0.3));
  R(c, x - 1, y - 2, 9, 1, tint(K.pal.stone, 0.05));
}

/** Дом (и дом с мансардой): стена спереди, крыша сверху-спереди, окна, дверь, труба. */
function paintHouse(c, b, K, out) {
  const big = b.type === 'house4';
  const W = b.w;
  const base = SPRITE_H[b.type];
  const v = b.v;
  const roofCol = v === 1 ? mix(K.pal.roof, '#b8452f', 0.6) : v === 2 ? mix(K.pal.roof, '#4f6a8f', 0.55) : K.pal.roof;
  const wallCol = v === 2 ? tint(K.pal.wall, 0.08) : K.pal.wall;
  const beam = shade(K.pal.wood, 0.12);
  const wallH = big ? 36 : 22;
  const wx = 2;
  const ww = W;
  const top = base - wallH;
  masonry(c, wx, base - 4, ww, 4, K.pal.stone, 5, 2, b.x);
  if (big) {
    masonry(c, wx, base - 18, ww, 14, tint(K.pal.stone, 0.06), 6, 3, b.x + 1);
    plaster(c, wx - 1, top, ww + 2, 18, wallCol, b.x);
    R(c, wx - 2, top + 17, ww + 4, 2, beam);
    for (let i = 0; i <= 4; i++) R(c, wx - 1 + Math.round((i * ww) / 4), top, 2, 17, beam);
  } else {
    plaster(c, wx, top, ww, wallH - 4, wallCol, b.x);
    for (const px of [wx, wx + ww - 2]) R(c, px, top, 2, wallH - 4, beam);
    if (v !== 1) for (let i = 0; i < 5; i++) {
      P(c, wx + 2 + i, base - 6 - i, beam);
      P(c, wx + ww - 3 - i, base - 6 - i, beam);
    }
  }
  R(c, wx - (big ? 1 : 0), top, ww + (big ? 2 : 0), 2, beam);
  R(c, wx, base - 6, ww, 2, beam);
  // дверь и окна
  const doorX = wx + Math.round(ww / 2) - 5;
  doorAt(c, doorX, base - 16, 10, 15, K);
  wallLamp(c, doorX + 12, base - 17, K, out.lamps);
  const box = K.flowers || K.flavor === 'meadow';
  const sh = v === 1 ? shade(K.style.accent || '#3949ab', 0.1) : null;
  if (big) {
    out.win(wx + 7, base - 14, 8, 7, {});
    out.win(wx + ww - 15, base - 14, 8, 7, {});
    out.win(wx + 7, top + 5, 8, 8, { box });
    out.win(wx + Math.floor(ww / 2) - 4, top + 5, 8, 8, {});
    out.win(wx + ww - 15, top + 5, 8, 8, { box });
  } else {
    out.win(wx + 7, top + 4, 9, 8, { box, shutters: sh });
    out.win(wx + ww - 16, top + 4, 9, 8, { box, shutters: sh });
  }
  // крыша
  const roofH = top - 2;
  roofSlope(c, 0, 2, W + 4, roofH, roofCol, big ? 7 : 6);
  if (K.flavor === 'gothic') {
    // острое слуховое окно со шпилем
    const dx = Math.floor((W + 4) / 2) - 6;
    for (let r = 0; r < 14; r++) R(c, dx + Math.round(r * 0.43), 19 - r, 12 - Math.round(r * 0.86), 1, shade(roofCol, r % 3 ? 0.1 : 0.25));
    R(c, dx + 5, 0, 2, 7, shade(roofCol, 0.35));
    ellipse(c, dx + 6, 14, 2, 2, '#2a2f48');
    out.wins.push({ x: dx + 5, y: 13, w: 3, h: 3 });
  } else if (v === 1 || big) {
    // слуховое окно с треугольным фронтоном
    const n = big ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const dx = n === 1 ? Math.floor((W + 4) / 2) - 7 : Math.floor((W + 4) * (k ? 0.68 : 0.32)) - 7;
      const dy = Math.floor(roofH * 0.35);
      R(c, dx + 1, dy + 6, 12, 9, wallCol);
      out.win(dx + 4, dy + 8, 6, 5, {});
      for (let r = 0; r < 7; r++) R(c, dx + r, dy + 6 - r, 14 - r * 2, 1, r === 0 ? shade(roofCol, 0.4) : roofCol);
      R(c, dx, dy + 6, 14, 1, shade(roofCol, 0.5));
    }
    if (big) {
      R(c, Math.floor((W + 4) / 2), -2, 1, 6, K.pal.iron);
      R(c, Math.floor((W + 4) / 2) + 1, -2, 4, 2, K.letter);
    }
  }
  const chx = Math.round(W * (big ? 0.78 : 0.74)) - 1;
  chimney(c, chx, base - (big ? 72 : 54), 12, K);
  if (K.web) {
    c.globalAlpha = 0.65;
    for (let i = 0; i < 6; i++) P(c, wx + 2 + i, top + 2 + i, '#e8e8f0');
    R(c, wx + 2, top + 5, 5, 1, '#e8e8f0');
    R(c, wx + 5, top + 2, 1, 5, '#e8e8f0');
    c.globalAlpha = 1;
  }
}

function paintTavern(c, b, K, out) {
  const W = b.w;
  const base = SPRITE_H.tavern;
  const wallH = 32;
  const top = base - wallH;
  const wx = 2;
  const ww = W;
  const beam = shade(K.pal.wood, 0.12);
  masonry(c, wx, base - 15, ww, 15, tint(K.pal.stone, 0.05), 6, 3, b.x + 3);
  plaster(c, wx - 1, top, ww + 2, 17, tint(K.pal.wall, 0.04), b.x + 5);
  for (let i = 0; i <= 6; i++) R(c, wx - 1 + Math.round((i * (ww - 1)) / 6), top, 2, 17, beam);
  R(c, wx - 2, top + 16, ww + 4, 2, beam);
  R(c, wx - 1, top, ww + 2, 2, beam);
  R(c, wx + 10, top + 12, ww - 20, 1, beam);
  for (let i = wx + 10; i < wx + ww - 10; i += 3) R(c, i, top + 12, 1, 5, beam);
  for (let i = 0; i < 4; i++) out.win(wx + 6 + i * Math.floor((ww - 18) / 3), top + 3, 7, 7, { box: K.flowers });
  out.win(wx + 6, base - 12, 9, 6, {});
  out.win(wx + ww - 15, base - 12, 9, 6, {});
  doorAt(c, wx + Math.floor(ww / 2) - 6, base - 15, 12, 14, K);
  wallLamp(c, wx + Math.floor(ww / 2) - 12, base - 16, K, out.lamps);
  wallLamp(c, wx + Math.floor(ww / 2) + 8, base - 16, K, out.lamps);
  roofSlope(c, 0, 2, W + 4, top - 2, mix(K.pal.roof, K.pal.wood, 0.25), 7);
  chimney(c, Math.round(W * 0.8) - 1, base - 66, 12, K);
  const sx = wx + ww - 18;
  const sy = top + 20;
  R(c, sx, sy - 2, 12, 1, K.pal.iron);
  R(c, sx + 1, sy, 10, 8, K.pal.wood);
  R(c, sx + 2, sy + 1, 8, 6, shade(K.pal.wood, 0.25));
  R(c, sx + 3, sy + 2, 4, 4, '#f2c25a');
  R(c, sx + 3, sy + 2, 4, 1, '#fff6d0');
  P(c, sx + 7, sy + 3, '#f2c25a');
}

function paintForge(c, b, K, out) {
  const W = b.w;
  const base = SPRITE_H.forge;
  masonry(c, 2, base - 24, 32, 24, K.pal.stone, 6, 3, b.x);
  out.win(9, base - 18, 8, 7, {});
  roofSlope(c, 0, 12, 36, base - 24 - 12, shade(K.pal.roof, 0.15), 4);
  R(c, 34, base - 22, W - 30, 22, shade(K.pal.stone, 0.5));
  R(c, 34, base - 22, W - 30, 3, shade(K.pal.stone, 0.6));
  R(c, 34, base - 24, 2, 24, K.pal.wood);
  R(c, W, base - 24, 2, 24, K.pal.wood);
  roofSlope(c, 32, 18, W - 28, base - 24 - 18, K.pal.roof, 3);
  R(c, 37, base - 14, 14, 13, shade(K.pal.stone, 0.15));
  R(c, 39, base - 11, 10, 7, '#1a0e08');
  R(c, 40, base - 6, 8, 2, '#ff8a2a');
  out.cores.push({ x: 40, y: base - 7, w: 8, h: 3, warm: '#ff8a3a', always: true });
  for (const [dx, h] of [[53, 6], [55, 5], [57, 7]]) R(c, dx, base - 20, 1, h, K.pal.iron);
  chimney(c, Math.round(W * 0.82) - 2, base - 54, 26, K);
}

function paintWindmill(c, b, K, out) {
  const W = b.w;
  const base = SPRITE_H.windmill;
  const cx = Math.floor((W + 4) / 2);
  const towerH = 56;
  for (let i = 0; i < towerH; i++) {
    const half = Math.round(15 - (i * 6) / towerH);
    const y = base - 1 - i;
    const col = i < 8 ? K.pal.stone : mix(K.pal.wall, K.pal.wood, 0.35);
    R(c, cx - half, y, half, 1, i % 4 === 0 && i >= 8 ? shade(col, 0.06) : tint(col, 0.06));
    R(c, cx, y, half, 1, i % 4 === 0 && i >= 8 ? shade(col, 0.22) : shade(col, 0.12));
    P(c, cx - half, y, shade(col, 0.45));
    P(c, cx + half - 1, y, shade(col, 0.5));
  }
  masonry(c, cx - 15, base - 8, 30, 8, K.pal.stone, 5, 2, b.x);
  doorAt(c, cx - 4, base - 14, 8, 13, K);
  out.win(cx - 2, base - 34, 5, 6, {});
  const capY = base - towerH;
  for (let r = 0; r < 12; r++) {
    const half = Math.round(12 - r * 0.95);
    R(c, cx - half, capY - r, half * 2, 1, r === 0 ? shade(K.pal.roof, 0.4) : r < 5 ? K.pal.roof : tint(K.pal.roof, 0.1));
    P(c, cx - half, capY - r, shade(K.pal.roof, 0.5));
  }
}

function paintTower(c, b, K, out) {
  const W = b.w;
  const base = SPRITE_H.tower;
  const stone = K.flavor === 'gothic' ? '#5e5870' : '#9a958c';
  const top = base - 82;
  masonry(c, 3, top, W - 2, 82, stone, 6, 3, b.x);
  R(c, W - 3, top, 4, 82, 'rgba(0,0,0,0.18)');
  for (let i = 1; i < W + 2; i += 5) masonry(c, i, top - 5, 3, 5, stone, 3, 2, i);
  R(c, 1, top, W + 2, 2, shade(stone, 0.3));
  for (const yy of [top + 10, top + 30, top + 50]) out.win(Math.floor(W / 2) + 1, yy, 3, 7, {});
  doorAt(c, Math.floor(W / 2) - 3, base - 14, 9, 13, K);
  const bx = Math.floor(W / 2) - 4;
  R(c, bx - 1, top + 62, 13, 1, K.pal.iron);
  R(c, bx, top + 63, 11, 12, K.letter);
  R(c, bx + 10, top + 63, 1, 12, shade(K.letter, 0.25));
  R(c, bx, top + 75, 4, 1, K.letter);
  R(c, bx + 7, top + 75, 4, 1, K.letter);
  R(c, bx + 3, top + 66, 5, 5, tint(K.letter, 0.5));
  R(c, bx + 4, top + 67, 3, 3, K.letter);
  R(c, Math.floor((W + 4) / 2), top - 18, 1, 13, K.pal.iron);
}

function paintFountain(c, b, K) {
  const W = b.w + 4;
  const base = SPRITE_H.fountain;
  const cx = W / 2;
  const stone = K.flavor === 'gothic' ? '#6c6680' : '#aaa59a';
  ellipse(c, cx, base - 10, 17, 9, shade(stone, 0.35));
  ellipse(c, cx, base - 11, 16, 8, stone);
  ellipse(c, cx, base - 11, 13, 6, '#3f8fc8');
  ellipse(c, cx, base - 12, 11, 4, '#5aa8de');
  R(c, cx - 2, base - 24, 4, 12, stone);
  R(c, cx + 1, base - 24, 1, 12, shade(stone, 0.2));
  ellipse(c, cx, base - 24, 6, 2, tint(stone, 0.1));
  ellipse(c, cx, base - 24, 4, 1, '#7cc8f0');
  R(c, cx - 1, base - 28, 2, 4, stone);
}

/** Шахта (0.7.2 — стоит где угодно): каменный холм со входом на юг, крепь, рельсы, фонарь; у изумрудной — кристаллы. */
function paintMine(c, b, K, out) {
  const gem = b.type === 'gemmine';
  const W = b.w + 4;
  const base = SPRITE_H[b.type];
  const cx = Math.floor(W / 2);
  const rock = K.flavor === 'gothic' ? '#5e5870' : K.pal.cliff;
  const wood = K.pal.wood;
  // силуэт холма по столбцам: обводка, заливка, каменная кладка, тень справа, трава на макушке
  const top = [];
  for (let i = 0; i < W; i++) {
    const k = Math.sin((Math.PI * (i + 0.5)) / W);
    top.push(base - 3 - Math.round(Math.pow(k, 0.55) * 27 + rnd(i >> 1, b.x) * 3));
  }
  for (let i = 0; i < W; i++) R(c, i - 1, top[i] - 1, 3, base - top[i] + 1, shade(rock, 0.55));
  for (let i = 0; i < W; i++) R(c, i, top[i], 1, base - top[i], rock);
  for (let y = base - 3, row = 0; y > base - 34; y -= 4, row++) {
    for (let x = row % 2 ? 3 : 0; x < W - 1; x += 6) {
      const xe = Math.min(W - 1, x + 5);
      if (y - 3 < Math.max(top[x], top[xe - 1]) + 2) continue;
      const k = rnd(x + b.x, y);
      R(c, x, y - 3, xe - x, 3, k > 0.65 ? tint(rock, 0.1) : k < 0.3 ? shade(rock, 0.1) : rock);
      R(c, x, y, xe - x, 1, shade(rock, 0.3));
      P(c, xe, y - 2, shade(rock, 0.3));
    }
  }
  c.globalAlpha = 0.22;
  for (let i = Math.floor(W * 0.6); i < W; i++) R(c, i, top[i] + 1, 1, base - top[i] - 1, '#000');
  c.globalAlpha = 1;
  R(c, 0, base - 3, W, 3, shade(rock, 0.3));
  for (let i = 1; i < W * 0.55; i++) P(c, i, top[i] + 1, tint(rock, 0.22));
  if (K.flavor !== 'gothic' && K.flavor !== 'sea') {
    for (let i = 2; i < W - 2; i++) if (rnd(i, b.x + 5) > 0.55) {
      P(c, i, top[i], K.pal.high);
      if (rnd(b.x, i) > 0.6) P(c, i, top[i] - 1, tint(K.pal.high, 0.15));
    }
  }
  // вход: темнота, крепь, перекладина, табличка с добычей
  const ex = cx - 7;
  R(c, ex, base - 17, 14, 17, '#120d0a');
  R(c, ex + 2, base - 15, 10, 15, '#1d1511');
  R(c, ex + 4, base - 12, 6, 12, '#2a1f18');
  if (b.level >= 2) R(c, ex + 1, base - 12, 12, 1, shade(wood, 0.35));
  R(c, ex - 2, base - 18, 3, 18, wood);
  R(c, ex - 2, base - 18, 1, 18, tint(wood, 0.15));
  R(c, ex + 13, base - 18, 3, 18, shade(wood, 0.12));
  R(c, ex - 4, base - 21, 22, 4, shade(wood, 0.1));
  R(c, ex - 4, base - 21, 22, 1, tint(wood, 0.18));
  R(c, ex - 4, base - 18, 22, 1, shade(wood, 0.45));
  R(c, cx - 4, base - 28, 9, 6, wood);
  R(c, cx - 4, base - 28, 9, 1, tint(wood, 0.2));
  if (gem) {
    R(c, cx - 1, base - 26, 3, 2, '#2ec27e');
    P(c, cx, base - 27, '#b6ffd8');
    P(c, cx, base - 24, '#25a86c');
  } else {
    R(c, cx - 2, base - 26, 5, 2, '#ffcc33');
    P(c, cx - 1, base - 26, '#fff2a0');
  }
  // рельсы из штольни
  R(c, cx - 4, base - 7, 1, 10, '#7a7a80');
  R(c, cx + 3, base - 7, 1, 10, '#7a7a80');
  for (let y = base - 6; y < base + 3; y += 2) R(c, cx - 5, y, 10, 1, shade(wood, 0.3));
  // фонарь на левом столбе
  R(c, ex - 6, base - 17, 4, 1, K.pal.iron);
  R(c, ex - 7, base - 16, 3, 4, K.pal.iron);
  R(c, ex - 6, base - 15, 1, 2, '#d8c890');
  out.lamps.push({ x: ex - 6, y: base - 15, w: 1, h: 2, r: 16 });
  if (gem) {
    for (const [dx, dy, h] of [[5, -12, 6], [8, -19, 5], [W - 7, -14, 7], [W - 11, -23, 5], [W - 4, -8, 4]]) {
      for (let r = 0; r < h; r++) R(c, dx - Math.floor((h - r) / 3), base + dy - r, 1 + Math.floor((h - r) / 1.5), 1, r > h - 2 ? '#b6ffd8' : r % 2 ? '#2ec27e' : '#25a86c');
      out.glows.push({ x: dx, y: base + dy - h / 2, r: 9, warm: '#5dffb0', base: 0.3 });
    }
  } else {
    for (let i = 0; i < 14; i++) {
      const x = 2 + rnd(i, b.x) * (W - 4);
      const y = base - 6 - rnd(b.x, i) * 24;
      if (Math.abs(x - cx) < 10 && y > base - 22) continue;
      if (y < top[Math.min(W - 1, Math.floor(x))] + 2) continue;
      R(c, x, y, 2, 1, '#ffcc33');
      if (i % 3 === 0) P(c, x, y - 1, '#fff2a0');
    }
  }
  if (b.level >= 3) {
    // вагонетка с добычей на рельсах
    R(c, cx - 5, base - 5, 11, 4, '#5a5a62');
    R(c, cx - 5, base - 5, 11, 1, '#7c7c86');
    R(c, cx - 4, base - 7, 9, 2, gem ? '#2ec27e' : '#ffcc33');
    P(c, cx - 2, base - 8, gem ? '#b6ffd8' : '#fff2a0');
    P(c, cx - 3, base - 1, '#222');
    P(c, cx + 3, base - 1, '#222');
  }
}

/** Огород: грядки — на земле (тайлы FIELD), здесь — заборчик с калиткой и пугало. */
function paintField(c, b, K) {
  const W = b.w;
  const base = SPRITE_H.field;
  const top = base - b.h;
  const wood = mix(K.pal.wood, '#a0703a', 0.3);
  const post = (x, y) => {
    R(c, x, y - 6, 2, 6, wood);
    P(c, x, y - 6, tint(wood, 0.25));
    P(c, x + 1, y - 3, shade(wood, 0.3));
  };
  const rail = (x0, x1, y) => {
    R(c, x0, y - 5, x1 - x0, 1, tint(wood, 0.12));
    R(c, x0, y - 2, x1 - x0, 1, wood);
  };
  const gate = Math.floor(W / 2) - 3;
  rail(2, W + 2, top + 3);
  for (let x = 2; x <= W; x += 8) post(x, top + 3);
  post(W, top + 3);
  for (const x of [2, W]) {
    R(c, x, top + 3, 1, base - top - 3, shade(wood, 0.15));
    R(c, x + 1, top + 3, 1, base - top - 3, tint(wood, 0.05));
    for (let y = top + 11; y < base; y += 8) post(x, y);
  }
  rail(2, gate, base);
  rail(gate + 8, W + 2, base);
  for (const x of [2, gate - 2, gate + 8, W]) post(x, base);
  if (K.flavor === 'sea') return;
  // пугало
  const sx = 2 + Math.round(W * 0.68);
  const sy = top + 20;
  R(c, sx, sy - 15, 1, 15, shade(wood, 0.2));
  R(c, sx - 5, sy - 11, 11, 1, wood);
  R(c, sx - 3, sy - 11, 7, 5, K.flavor === 'gothic' ? '#4a3a5a' : mix(K.style.accent || '#3949ab', '#8a5a3a', 0.4));
  R(c, sx - 3, sy - 6, 7, 1, '#c8a440');
  if (K.flavor === 'gothic') {
    disc(c, sx, sy - 15, 2.5, '#d8722a');
    P(c, sx - 1, sy - 15, '#ffd23a');
    P(c, sx + 1, sy - 15, '#ffd23a');
  } else {
    disc(c, sx, sy - 15, 2.5, '#e8d4a0');
    R(c, sx - 4, sy - 18, 9, 1, '#6a4a2a');
    R(c, sx - 2, sy - 20, 5, 2, '#6a4a2a');
  }
}

const PAINTERS = { house: paintHouse, house4: paintHouse, tavern: paintTavern, forge: paintForge, windmill: paintWindmill, tower: paintTower, fountain: paintFountain, goldmine: paintMine, gemmine: paintMine, field: paintField };

// ---------- Спрайты: обстановка (холст 32 × 34, точка у основания — (16, 30)) ----------

function paintDecor(c, d, K, out) {
  const { pal } = K;
  const x = 16;
  const y = 30;
  switch (d.type) {
    case 'well':
      ellipse(c, x, y - 4, 9, 5, shade(pal.stone, 0.35));
      ellipse(c, x, y - 5, 8, 4, pal.stone);
      ellipse(c, x, y - 5, 5, 2.5, '#2c5a88');
      R(c, x - 8, y - 20, 2, 15, pal.wood);
      R(c, x + 6, y - 20, 2, 15, pal.wood);
      for (let r = 0; r < 6; r++) R(c, x - 11 + r, y - 21 - r, 22 - r * 2, 1, r === 0 ? shade(pal.roof, 0.4) : pal.roof);
      R(c, x - 6, y - 16, 12, 1, shade(pal.wood, 0.2));
      R(c, x, y - 15, 1, 5, '#c8b89a');
      R(c, x - 1, y - 11, 3, 3, shade(pal.wood, 0.1));
      break;
    case 'sign':
      R(c, x, y - 14, 2, 14, pal.wood);
      R(c, x - 6, y - 15, 14, 6, tint(pal.wood, 0.1));
      R(c, x - 6, y - 15, 14, 1, tint(pal.wood, 0.25));
      R(c, x - 4, y - 13, 9, 1, shade(pal.wood, 0.45));
      R(c, x - 4, y - 11, 6, 1, shade(pal.wood, 0.45));
      break;
    case 'mailbox':
      R(c, x, y - 9, 1, 9, pal.wood);
      R(c, x - 3, y - 13, 7, 5, '#c84a3a');
      R(c, x - 3, y - 13, 7, 1, '#e86a5a');
      R(c, x + 4, y - 13, 1, 3, '#ffd23a');
      break;
    case 'fence':
      if (d.side === 'top' || d.side === 'bottom') {
        R(c, x - 6, y - 7, 12, 1, tint(pal.wood, 0.1));
        R(c, x - 6, y - 4, 12, 1, pal.wood);
        R(c, x - 1, y - 9, 2, 9, pal.wood);
        P(c, x - 1, y - 9, tint(pal.wood, 0.2));
      } else {
        R(c, x - 1, y - 14, 2, 14, pal.wood);
        R(c, x - 1, y - 14, 1, 14, tint(pal.wood, 0.15));
      }
      break;
    case 'barrels':
      for (const [dx, dy] of [[-5, 0], [3, 0], [-1, -5]]) {
        R(c, x + dx - 3, y - 10 + dy, 7, 10, mix(pal.wood, '#a0703a', 0.4));
        ellipse(c, x + dx, y - 10 + dy, 3, 1.5, shade(pal.wood, 0.25));
        R(c, x + dx - 3, y - 7 + dy, 7, 1, pal.iron);
        R(c, x + dx - 3, y - 3 + dy, 7, 1, pal.iron);
        R(c, x + dx + 2, y - 9 + dy, 1, 9, shade(pal.wood, 0.2));
      }
      break;
    case 'crates':
      for (const [dx, dy, s] of [[-7, 0, 8], [1, 0, 7], [-4, -7, 7]]) {
        R(c, x + dx, y - s + dy, s, s, mix(pal.wood, '#c8a060', 0.35));
        R(c, x + dx, y - s + dy, s, 1, tint(pal.wood, 0.25));
        R(c, x + dx, y - 1 + dy, s, 1, shade(pal.wood, 0.3));
        for (let i = 0; i < s; i++) P(c, x + dx + i, y - s + dy + i, shade(pal.wood, 0.25));
      }
      break;
    case 'hay':
      ellipse(c, x, y - 6, 10, 7, '#c8a440');
      ellipse(c, x - 1, y - 7, 8, 5, '#e2bf52');
      for (let i = 0; i < 12; i++) P(c, x - 8 + rnd(i, 1) * 16, y - 12 + rnd(1, i) * 10, '#a8862e');
      R(c, x + 8, y - 16, 1, 14, pal.wood);
      break;
    case 'cart':
      R(c, x - 8, y - 10, 15, 6, mix(pal.wood, '#8a6a42', 0.4));
      R(c, x - 8, y - 10, 15, 1, tint(pal.wood, 0.2));
      disc(c, x - 4, y - 3, 3, '#3a2a1a');
      disc(c, x + 3, y - 3, 3, '#3a2a1a');
      P(c, x - 4, y - 3, '#8a7a6a');
      P(c, x + 3, y - 3, '#8a7a6a');
      R(c, x - 7, y - 13, 13, 3, '#ffcc33');
      R(c, x - 5, y - 14, 7, 1, '#ffe680');
      R(c, x + 7, y - 8, 6, 1, pal.wood);
      break;
    case 'anvil':
      R(c, x - 3, y - 5, 6, 5, '#6b4a2b');
      R(c, x - 5, y - 9, 11, 4, '#4a4d55');
      R(c, x - 6, y - 9, 2, 2, '#4a4d55');
      R(c, x - 4, y - 9, 9, 1, '#7c8088');
      break;
    case 'bench':
      R(c, x - 7, y - 5, 14, 2, pal.wood);
      R(c, x - 7, y - 5, 14, 1, tint(pal.wood, 0.2));
      R(c, x - 6, y - 3, 1, 3, shade(pal.wood, 0.3));
      R(c, x + 5, y - 3, 1, 3, shade(pal.wood, 0.3));
      R(c, x - 7, y - 10, 14, 2, pal.wood);
      R(c, x - 6, y - 8, 1, 3, pal.wood);
      R(c, x + 5, y - 8, 1, 3, pal.wood);
      break;
    case 'pumpkin':
      ellipse(c, x, y - 4, 5, 4, '#d8722a');
      ellipse(c, x - 1, y - 5, 3, 2, '#f0923a');
      R(c, x, y - 8, 1, 4, '#c86a1a');
      R(c, x, y - 10, 2, 2, '#4a6a2a');
      out.cores.push({ x: x - 3, y: y - 5, w: 1, h: 1, warm: '#ffb040', night: true });
      out.cores.push({ x: x + 2, y: y - 5, w: 1, h: 1, warm: '#ffb040', night: true });
      out.glows.push({ x, y: y - 4, r: 8, warm: '#ffb040' });
      break;
    case 'bonfire':
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        R(c, x + Math.cos(a) * 6 - 1, y - 3 + Math.sin(a) * 3, 3, 2, '#7a7870');
      }
      R(c, x - 5, y - 4, 10, 2, '#5a3a20');
      R(c, x - 4, y - 5, 8, 2, '#7a5230');
      break;
    case 'flowerbed':
      R(c, x - 7, y - 4, 14, 4, shade(pal.wood, 0.1));
      R(c, x - 7, y - 4, 14, 1, tint(pal.wood, 0.1));
      for (let i = 0; i < 14; i++) {
        P(c, x - 7 + i, y - 5, '#3a7430');
        if (i % 2 === 0) P(c, x - 7 + i, y - 6 - (i % 3 === 0 ? 1 : 0), ['#ff6f91', '#ffd23a', '#ffffff', '#c86bff', '#ff9a3c'][i % 5]);
      }
      break;
    case 'mushrooms':
      for (const [dx, h] of [[-4, 3], [0, 2], [3, 4]]) {
        R(c, x + dx, y - h, 1, h, '#f4e6c8');
        R(c, x + dx - 1, y - h - 2, 3, 2, '#d9363a');
        P(c, x + dx, y - h - 2, '#fff');
      }
      break;
    case 'crystal':
      R(c, x, y - 10, 3, 10, '#2ec27e');
      R(c, x + 3, y - 6, 2, 6, '#25a86c');
      R(c, x - 2, y - 5, 2, 5, '#25a86c');
      P(c, x, y - 10, '#c8ffe4');
      out.glows.push({ x: x + 1, y: y - 5, r: 12, warm: '#5dffb0', base: 0.3 });
      break;
    case 'pickaxe':
      R(c, x, y - 9, 1, 9, pal.wood);
      R(c, x - 4, y - 10, 9, 1, '#b8c0c8');
      P(c, x - 4, y - 9, '#b8c0c8');
      P(c, x + 4, y - 9, '#b8c0c8');
      break;
    case 'target':
      R(c, x - 4, y - 6, 1, 6, pal.wood);
      R(c, x + 4, y - 6, 1, 6, pal.wood);
      disc(c, x, y - 12, 6, '#f3efe6');
      disc(c, x, y - 12, 4.5, '#d84040');
      disc(c, x, y - 12, 2.5, '#f3efe6');
      disc(c, x, y - 12, 1, '#d84040');
      break;
    case 'grave':
      R(c, x - 3, y - 9, 7, 9, '#6e687a');
      R(c, x - 2, y - 10, 5, 1, '#6e687a');
      R(c, x - 3, y - 9, 1, 9, '#8a849a');
      R(c, x - 1, y - 7, 3, 1, '#4e4a5a');
      break;
    case 'boat':
      ellipse(c, x, y - 3, 10, 3, '#7a5230');
      ellipse(c, x, y - 4, 8, 2, '#a0703a');
      R(c, x - 1, y - 18, 1, 14, '#3a2a1a');
      for (let r = 0; r < 10; r++) R(c, x, y - 17 + r, Math.round(r * 0.8), 1, '#f3efe6');
      break;
    default:
  }
}

function paintLantern(c, K, out) {
  const x = 16;
  const y = 30;
  R(c, x - 2, y - 2, 5, 2, K.pal.iron);
  R(c, x, y - 18, 1, 16, K.pal.iron);
  R(c, x + 1, y - 18, 1, 16, shade(K.pal.iron, 0.4));
  R(c, x - 3, y - 25, 7, 1, shade(K.pal.iron, 0.3));
  R(c, x - 2, y - 26, 5, 1, shade(K.pal.iron, 0.3));
  R(c, x - 3, y - 24, 7, 6, K.pal.iron);
  R(c, x - 2, y - 23, 5, 4, '#d8c890');
  out.lampCore = { x: x - 2, y: y - 23, w: 5, h: 4 };
}

// ---------- Динамика ----------

function animatedParts(c, b, world, K) {
  const base = b.base;
  if (b.type === 'windmill') {
    const cx = b.x + b.w / 2;
    const hy = base - 52;
    for (let k = 0; k < 4; k++) {
      const a = world.mill + (k * Math.PI) / 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      for (let r = 2; r < 30; r++) {
        P(c, cx + ca * r, hy + sa * r, shade(K.pal.wood, 0.25));
        if (r > 7) for (let o = 1; o <= 6; o++) {
          const frame = o === 6 || r % 5 === 0 || r === 29;
          P(c, cx + ca * r - sa * o, hy + sa * r + ca * o, frame ? K.pal.wood : r % 2 ? '#f3efe6' : '#e2dccc');
        }
      }
    }
    disc(c, cx, hy, 2.5, '#3a2a1a');
    P(c, cx, hy, K.letter);
  } else if (b.type === 'tower') {
    const fx = b.x + b.w / 2 + 1;
    const fy = base - 100;
    for (let i = 0; i < 11; i++) {
      const wave = Math.round(Math.sin(world.t * 4 - i * 0.7) * 1.2);
      R(c, fx + i, fy + wave, 1, 7 - Math.floor(i / 4), i % 4 === 3 ? shade(K.letter, 0.2) : K.letter);
    }
  } else if (b.type === 'fountain') {
    const cx = b.x + b.w / 2;
    for (let s = -1; s <= 1; s += 2) {
      for (let i = 0; i < 10; i++) {
        const k = (i + world.t * 12) % 10;
        P(c, cx + s * (k * 1.1), base - 28 - Math.sin((k / 10) * Math.PI) * 5 + k * 1.4, k % 3 ? '#9ad8ff' : '#e0f6ff');
      }
    }
    const shim = Math.floor(world.t * 3) % 4;
    for (let i = -10; i < 10; i += 4) P(c, cx + i + shim, base - 11, '#cfeeff');
  } else if (b.type === 'forge') {
    for (let i = 0; i < 7; i++) {
      const fh = 1 + Math.round(Math.abs(Math.sin(world.t * 9 + i * 1.7)) * 3);
      R(c, b.x + 38 + i, base - 7 - fh, 1, fh, i % 2 ? '#ffb347' : '#ff7a2a');
    }
  } else if (b.type === 'gemmine' && Math.floor(world.t * 1.5) % 3 === 0) {
    P(c, b.x + 5, base - 24, '#ffffff');
    P(c, b.x + b.w - 7, base - 26, '#ffffff');
  }
}

function bonfireFlames(c, d, world) {
  for (let i = -3; i <= 3; i++) {
    const h = 4 + Math.round(Math.abs(Math.sin(world.t * 10 + i * 1.7)) * 4) - Math.abs(i);
    R(c, d.x + i, d.y - 5 - h, 1, h, i === 0 || i === 1 ? '#ffe070' : '#ff8a2a');
  }
}

const FW = ['#ff5c7a', '#ffd23a', '#5dffb0', '#7ab8ff', '#c78cff'];

function drawParticles(c, world) {
  for (const p of world.particles) {
    const x = p.x;
    const y = p.y - p.z;
    const a = clamp01(p.life * 1.5);
    c.globalAlpha = a;
    switch (p.kind) {
      case 'coin': R(c, x, y - 2, 2, 2, '#ffcc33'); P(c, x, y - 2, '#fff2a0'); break;
      case 'gem': R(c, x, y - 2, 2, 2, '#2ec27e'); P(c, x, y - 2, '#c8ffe4'); break;
      case 'spark': P(c, x, y, p.c > 0.5 ? '#ffd23a' : '#ff8a2a'); break;
      case 'fire': R(c, x, y, 2, 1, p.c > 0.5 ? '#ffb347' : '#ff5a2a'); break;
      case 'smoke': c.globalAlpha = a * 0.4; R(c, x, y, 2 + Math.floor((2.8 - p.life) * 1.3), 2, '#c8c8d0'); break;
      case 'drop': P(c, x, y, '#9ad8ff'); break;
      case 'dirt': P(c, x, y, '#8a6040'); break;
      case 'dust': c.globalAlpha = a * 0.6; P(c, x, y, '#d8c8a8'); break;
      case 'star': P(c, x, y, p.c > 0.5 ? '#fff6c0' : '#c8a6ff'); break;
      case 'arrow': R(c, x - 2, y, 4, 1, '#7a5230'); P(c, x + (p.c > 0 ? 2 : -2), y, '#d0d0d0'); break;
      case 'fw': P(c, x, y, FW[Math.floor(p.c * FW.length)]); break;
      case 'leaf': R(c, x, y, 2, 1, p.c > 0.5 ? '#5aa04a' : '#3f8a3a'); break;
      case 'fish': R(c, x - 1, y, 3, 1, '#7ab8e8'); P(c, x + (p.c > 0.5 ? 2 : -2), y, '#5a90c8'); P(c, x, y - 1, '#c8e8ff'); break;
      default: P(c, x, y, '#fff');
    }
  }
  c.globalAlpha = 1;
}

// ---------- Рендерер ----------

/**
 * Рисует деревню в контекст видимого холста. view: { W, H, camX, camY, phase, n, style, letter, R }.
 * camX, camY — левый верхний угол экрана в пикселях карты. R (0.8) — пикселей холста на пиксель деревни (1 или 2):
 * при R = 2 люди-чиби рисуются вдвое мельче «пикселем», чем мир.
 */
export class VillageRenderer {
  constructor() {
    this.ground = null;
    this.groundKey = null;
    this.sprites = new Map();
    this.spriteStyle = null;
    this.K = null;
    this.smallDecor = [];
    this.smallKey = null;
  }

  canvas(w, h) {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    return cv;
  }

  /** Спрайт из кэша: { cv, ax, ay, wins, lamps, cores, glows } — (ax, ay) — точка привязки внутри холста. */
  sprite(key, w, h, ax, ay, paint) {
    let s = this.sprites.get(key);
    if (!s) {
      const cv = this.canvas(w, h);
      const c = cv.getContext('2d');
      const meta = { wins: [], lamps: [], cores: [], glows: [] };
      meta.win = (x, y, ww, hh, opts) => windowAt(c, x, y, ww, hh, this.K, meta.wins, opts);
      paint(c, meta);
      delete meta.win;
      s = { cv, ax, ay, ...meta };
      this.sprites.set(key, s);
    }
    return s;
  }

  render(ctx, world, v) {
    const st = v.style;
    const flavor = flavorOf(st);
    const map = world.map;
    const W = v.W;
    const H = v.H;
    const camX = Math.round(v.camX);
    const camY = Math.round(v.camY);
    const RES = v.R || 1;
    ctx.setTransform(RES, 0, 0, RES, 0, 0);
    const styleKey = `${flavor}|${st.roof}|${st.grass}|${v.letter}|${world.owned.has('v:flowers')}|${world.legacy.has('scene:web')}`;
    this.K = {
      st, style: st, flavor, pal: palette(st, flavor), world, letter: v.letter,
      flowers: world.owned.has('v:flowers'), web: world.legacy.has('scene:web'),
    };
    const K = this.K;
    if (this.spriteStyle !== styleKey) {
      this.sprites.clear();
      this.spriteStyle = styleKey;
    }
    ctx.imageSmoothingEnabled = false;
    // земля (с дальним лесом — он статичный, рисуется в кэш вместе с ней)
    const gKey = `${styleKey}|${map.key}`;
    if (this.groundKey !== gKey) {
      const gw = map.cols * TILE;
      const gh = map.rows * TILE;
      if (!this.ground || this.ground.width !== gw || this.ground.height !== gh) this.ground = this.canvas(gw, gh);
      const gc = this.ground.getContext('2d');
      gc.imageSmoothingEnabled = false;
      paintGround(gc, map, K);
      for (const t of [...map.farTrees].sort((p, q) => p.y - q.y)) {
        const s = this.treeSprite(t, flavor, K);
        gc.drawImage(s.cv, Math.round(t.x - s.ax), Math.round(t.y - s.ay));
      }
      this.groundKey = gKey;
      this.smallKey = null;
    }
    // мелкие объекты (скамейки, клумбы, тыквы, костёр, мишень) рисуются как обстановка
    if (this.smallKey !== map.key) {
      this.smallDecor = map.smalls.filter((s) => s.place !== 'lantern' && s.place !== 'tree')
        .map((s) => ({ type: s.place, key: s.key, x: s.x + s.w / 2, y: s.y + TILE * 0.85 }));
      this.smallKey = map.key;
    }
    R(ctx, 0, 0, W, H, mix(K.pal.grass, K.pal.grassD, 0.6));
    ctx.drawImage(this.ground, -camX, -camY);
    ctx.save();
    ctx.translate(-camX, -camY);
    this.waterShimmer(ctx, map, world, camX, camY, W, H);
    // подсветка клеток: выбранное, место для перестановки
    const ghost = v.ghost || null;
    for (const m of v.marks || []) this.mark(ctx, m);
    if (ghost) this.mark(ctx, { tx: ghost.tx, ty: ghost.ty, tw: ghost.tw, th: ghost.th, kind: ghost.ok ? 'ok' : 'bad' });
    // спрайты и жители — по глубине (нижнему краю)
    const skip = ghost?.key;
    const items = [];
    const inView = (x, y, w, h) => x + w > camX - 8 && x - 8 < camX + W && y + 8 > camY && y - h < camY + H + 8;
    for (const b of map.buildings) if (b.key !== skip && inView(b.x - 6, b.base, b.w + 12, SPRITE_H[b.type] + 34)) items.push({ y: b.base, b });
    for (const t of map.trees) if ((!skip || t.obj !== skip) && inView(t.x - 20, t.y, 40, 48)) items.push({ y: t.y, t });
    for (const d of map.decor) if (inView(d.x - 16, d.y, 32, 34)) items.push({ y: d.y, d });
    for (const d of this.smallDecor) if (d.key !== skip && inView(d.x - 16, d.y, 32, 34)) items.push({ y: d.y, d });
    for (const l of map.lanterns) if (l.key !== skip && inView(l.x - 8, l.y, 16, 30)) items.push({ y: l.y, l });
    for (const a of world.actors) if (!a.hidden && inView(a.x - 20, a.y, 40, 60 + a.z)) items.push({ y: a.y + 0.5, a });
    if (ghost) {
      const g = this.ghostItem(map, ghost);
      if (g) items.push(g);
    }
    items.sort((p, q) => p.y - q.y);
    const lit = [];
    const night = v.n > 0.5;
    for (const it of items) {
      if (it.ghost) ctx.globalAlpha = 0.8;
      if (it.b) {
        const b = it.b;
        const s = this.buildingSprite(b, K);
        const ox = (it.at ? it.at.x : b.x) - s.ax;
        const oy = (it.at ? it.at.base : b.base) - s.ay;
        ctx.drawImage(s.cv, ox, oy);
        if (!it.ghost) {
          animatedParts(ctx, b, world, K);
          lit.push({ s, ox, oy, id: b.id, b });
        }
      } else if (it.t) {
        const t = it.t;
        const s = this.treeSprite(t, flavor, K);
        ctx.drawImage(s.cv, Math.round(t.x - s.ax), Math.round(t.y - s.ay));
      } else if (it.d) {
        const d = it.d;
        const s = this.sprite(`d|${d.type}|${d.side || ''}`, 32, 34, 16, 30, (c, meta) => paintDecor(c, d, K, meta));
        const ox = Math.round(d.x - s.ax);
        const oy = Math.round(d.y - s.ay);
        ctx.drawImage(s.cv, ox, oy);
        if (d.type === 'bonfire') bonfireFlames(ctx, d, world);
        if (!it.ghost && (s.cores.length || s.glows.length)) lit.push({ s, ox, oy, id: 'decor' });
      } else if (it.l) {
        const l = it.l;
        const s = this.sprite('lantern', 32, 34, 16, 30, (c, meta) => paintLantern(c, K, meta));
        const ox = Math.round(l.x - s.ax);
        const oy = Math.round(l.y - s.ay);
        ctx.drawImage(s.cv, ox, oy);
        if (!it.ghost) lit.push({ s, ox, oy, id: l.id, lantern: true });
      } else {
        const a = it.a;
        const x = Math.round(a.x);
        const y = Math.round(a.y);
        const k = Math.max(0.35, 1 - a.z / 50);
        ctx.globalAlpha = 0.28 * k * a.alpha;
        ellipse(ctx, x, y, 4 * a.u * k + 1, 1.5 * a.u * k + 0.5, '#000');
        ctx.globalAlpha = 1;
        if (a.thread != null) {
          ctx.globalAlpha = 0.7;
          R(ctx, x, y - a.thread, 1, Math.max(0, a.thread - a.z - 4), '#e8e8f0');
          ctx.globalAlpha = 1;
        }
        const look = a.look || LOOKS[a.kind];
        if (CRITTERS.has(a.kind)) {
          // звери (0.9): спрайт в той же плотности пикселей, что и чиби
          const s = critterSprite(a.kind, critterPose(a), a.dir);
          const fs = 0.5 * a.u;
          ctx.globalAlpha = a.alpha;
          ctx.imageSmoothingEnabled = RES * fs < 1;
          ctx.drawImage(s.cv, Math.round(a.x / fs) * fs - s.ax * fs, Math.round((a.y - a.z) / fs) * fs - s.ay * fs, CW * fs, CH * fs);
          ctx.imageSmoothingEnabled = false;
          ctx.globalAlpha = 1;
        } else if (look) {
          // чиби: спрайт в кэше, «пиксель» — половина пикселя деревни (у больших — целый)
          if (!a.lk) a.lk = lookKey(look);
          const s = chibiSprite(look, a.lk, poseOf(a, v.n), a.dir);
          const fs = 0.5 * a.u;
          const X = Math.round(a.x / fs) * fs - s.ax * fs;
          const Y = Math.round((a.y - a.z) / fs) * fs - s.ay * fs;
          ctx.globalAlpha = a.alpha;
          ctx.imageSmoothingEnabled = RES * fs < 1;
          ctx.drawImage(s.cv, X, Y, CW * fs, CH * fs);
          ctx.imageSmoothingEnabled = false;
          ctx.globalAlpha = 1;
        } else {
          const g = painter(ctx, x, Math.round(y - a.z), a.dir, a.u, a.alpha);
          drawCharacter(g, a.kind, { state: a.state, phase: a.phase, t: a.anim, night, happy: a.happy, squash: a.squash > 0.3, fire: a.fire });
        }
      }
      if (it.ghost) ctx.globalAlpha = 1;
    }
    if (ghost) this.mark(ctx, { tx: ghost.tx, ty: ghost.ty, tw: ghost.tw, th: ghost.th, kind: ghost.ok ? 'ok' : 'bad', line: true });
    ctx.restore();
    // ночь и сумерки — затемняем весь кадр
    const dusk = duskOf(v.phase);
    if (v.n > 0.01) {
      const s = rgb(SHADE_NIGHT[flavor] || SHADE_NIGHT.classic);
      ctx.fillStyle = `rgba(${s[0]},${s[1]},${s[2]},${0.55 * v.n})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (dusk > 0.05) {
      ctx.fillStyle = `rgba(255,140,70,${0.1 * dusk})`;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.save();
    ctx.translate(-camX, -camY);
    this.lights(ctx, lit, world, v);
    if (world.fireflies.length && v.n > 0.2) {
      for (const f of world.fireflies) {
        const x = Math.round(f.x);
        const y = Math.round(f.y - f.z);
        const a = clamp01((v.n - 0.2) * 2) * (0.5 + 0.5 * Math.sin(f.p * 3));
        ctx.globalAlpha = a * 0.35;
        R(ctx, x - 1, y - 1, 3, 3, '#d8ff7a');
        ctx.globalAlpha = a;
        P(ctx, x, y, '#f4ffb0');
      }
      ctx.globalAlpha = 1;
    }
    drawParticles(ctx, world);
    for (const a of world.actors) {
      if (a.hidden) continue;
      const top = Math.round(a.y - a.z - charHeight(a.kind) * a.u - 4);
      if (a.emote) drawEmote(ctx, Math.round(a.x), top, a.emote, 1);
      else if (world.alertOf(a) > 0 && !a.held) alertMark(ctx, Math.round(a.x), top - 1 + Math.round(Math.sin(world.t * 4 + (a.n || 0)) * 1.2));
    }
    if (v.hand) drawHand(ctx, Math.round(v.hand.x), Math.round(v.hand.y), !!v.hand.closed);
    if (v.pointer) {
      // стрелка над выбранным объектом
      const px = Math.round(v.pointer.x);
      const py = Math.round(v.pointer.y - 4 + Math.sin(world.t * 5) * 2);
      for (let r = 0; r < 6; r++) R(ctx, px - 5 + r, py - 6 + r, 11 - r * 2, 1, '#2a2a38');
      for (let r = 0; r < 4; r++) R(ctx, px - 3 + r, py - 5 + r, 7 - r * 2, 1, '#ffd23a');
      P(ctx, px - 2, py - 5, '#fff6c0');
    }
    ctx.restore();
    this.weather(ctx, world, v, flavor, camX, camY);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Спрайт постройки (огород, шахта, дом…) из кэша. */
  buildingSprite(b, K) {
    const sh = SPRITE_H[b.type];
    return this.sprite(`b|${b.type}|${b.v}|${b.level}|${b.x}|${b.y}`, b.w + 8, sh + 10, 4, sh + 6, (c, meta) => {
      c.translate(2, 6);
      PAINTERS[b.type](c, b, K, meta);
      c.setTransform(1, 0, 0, 1, 0, 0);
      for (const list of [meta.wins, meta.lamps, meta.cores, meta.glows]) for (const o of list) {
        o.x += 2;
        o.y += 6;
      }
    });
  }

  treeSprite(t, flavor, K) {
    const sz = Math.round(t.size * 10) / 10;
    return this.sprite(`t|${t.s}|${sz}`, 40, 48, 20, 46, (c) => {
      if (flavor === 'gothic' && t.s === 2) deadTree(c, 20, 46, sz);
      else if ((flavor === 'classic' || flavor === 'sea' || flavor === 'gothic') && t.s !== 1) pineTree(c, 20, 46, sz, K.pal.trees[t.s % 3], t.s * 7 + 1);
      else roundTree(c, 20, 46, sz, K.pal.trees[t.s % 3], t.s * 13 + 5, flavor === 'meadow' && t.s === 0 ? '#ff6f91' : flavor === 'classic' && t.s === 1 ? '#d84a3a' : null);
    });
  }

  /** Объект, который переставляют, — на новом месте (полупрозрачный). */
  ghostItem(map, g) {
    const b = map.buildings.find((x) => x.key === g.key);
    const x = g.tx * TILE;
    const y = g.ty * TILE;
    if (b) return { y: (g.ty + b.th) * TILE, b, at: { x, base: (g.ty + b.th) * TILE }, ghost: true };
    const s = map.smalls.find((o) => o.key === g.key);
    if (!s) return null;
    if (s.place === 'lantern') return { y: y + TILE * 0.8, l: { ...s, x: x + TILE / 2, y: y + TILE * 0.8 }, ghost: true };
    if (s.place === 'tree') {
      const t = map.trees.find((o) => o.obj === s.key) || { s: 0, size: 1 };
      return { y: y + TILE * 0.9, t: { ...t, x: x + TILE / 2, y: y + TILE * 0.9 }, ghost: true };
    }
    return { y: y + TILE * 0.85, d: { type: s.place, x: x + s.w / 2, y: y + TILE * 0.85 }, ghost: true };
  }

  /** Подсветка клеток: ok — можно поставить, bad — нельзя, tile — выбранная пустая клетка. line — только рамка. */
  mark(ctx, m) {
    const x = m.tx * TILE;
    const y = m.ty * TILE;
    const w = (m.tw || 1) * TILE;
    const h = (m.th || 1) * TILE;
    const col = m.kind === 'ok' ? '110,230,140' : m.kind === 'bad' ? '245,90,80' : '255,255,255';
    if (!m.line) {
      ctx.fillStyle = `rgba(${col},${m.kind === 'tile' ? 0.22 : 0.32})`;
      ctx.fillRect(x, y, w, h);
    }
    ctx.fillStyle = `rgba(${col},${m.line ? 0.75 : 0.9})`;
    ctx.fillRect(x, y, w, 1);
    ctx.fillRect(x, y + h - 1, w, 1);
    ctx.fillRect(x, y, 1, h);
    ctx.fillRect(x + w - 1, y, 1, h);
  }

  /** Блики на воде и струи водопада — каждый кадр, по видимым тайлам воды. */
  waterShimmer(c, map, world, camX, camY, W, H) {
    const tx0 = Math.max(0, Math.floor(camX / TILE));
    const ty0 = Math.max(0, Math.floor(camY / TILE));
    const tx1 = Math.min(map.cols - 1, Math.ceil((camX + W) / TILE));
    const ty1 = Math.min(map.rows - 1, Math.ceil((camY + H) / TILE));
    const t = world.t;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const type = map.grid[ty * map.cols + tx];
        if (type !== T.WATER && type !== T.SEA) continue;
        const X = tx * TILE;
        const Y = ty * TILE;
        if (ty === map.cliffY || ty === map.cliffY + 1) {
          for (let i = 1; i < TILE - 1; i += 2) {
            const off = (t * 40 + rnd(i, tx) * 12) % 12;
            R(c, X + i, Y + off, 1, 3, '#e6f6ff');
          }
          continue;
        }
        const k = rnd(tx, ty);
        const ph = (t * (0.6 + k * 0.6) + k * 10) % 3;
        if (ph < 1.4) R(c, X + 2 + Math.floor(k * 7), Y + 2 + Math.floor(rnd(ty, tx) * 8), ph < 0.7 ? 2 : 3, 1, '#d8f0ff');
        if (ty === map.cliffY + 2 && map.grid[(map.cliffY + 1) * map.cols + tx] === T.WATER) {
          for (let i = 0; i < 4; i++) P(c, X + 1 + rnd(i, Math.floor(t * 6)) * 10, Y + rnd(Math.floor(t * 6), i) * 4, '#ffffff');
        }
      }
    }
  }

  lights(ctx, lit, world, v) {
    const n = v.n;
    const glowA = clamp01((n - 0.2) / 0.5);
    ctx.globalCompositeOperation = 'lighter';
    const glow = (x, y, r, a, col) => {
      if (a <= 0.02) return;
      const c = col ? rgb(col) : [255, 190, 96];
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${0.5 * a})`);
      g.addColorStop(0.45, `rgba(${c[0]},${c[1]},${c[2]},${0.16 * a})`);
      g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    };
    const cores = [];
    for (const it of lit) {
      const { s, ox, oy } = it;
      const on = it.b ? world.buildingLit(it.b) : it.id === 'decor' || world.lightOn(it.id);
      for (const g of s.glows) glow(ox + g.x, oy + g.y, g.r, Math.max(g.base || 0, glowA), g.warm);
      if (on && glowA > 0) {
        for (const w of s.wins) {
          glow(ox + w.x + w.w / 2, oy + w.y + w.h / 2, Math.max(12, w.w * 2), glowA);
          cores.push({ x: ox + w.x, y: oy + w.y, w: w.w, h: w.h, frame: w.frame });
        }
        for (const l of s.lamps) {
          glow(ox + l.x, oy + l.y, l.r, glowA);
          cores.push({ x: ox + l.x, y: oy + l.y, w: l.w, h: l.h });
        }
        if (it.lantern && s.lampCore) {
          glow(ox + s.lampCore.x + 2.5, oy + s.lampCore.y + 2, 24, glowA);
          cores.push({ ...s.lampCore, x: ox + s.lampCore.x, y: oy + s.lampCore.y });
        }
      }
      for (const cc of s.cores) {
        if (cc.night && glowA <= 0) continue;
        if (cc.always) glow(ox + cc.x + cc.w / 2, oy + cc.y, 14, Math.max(0.4, glowA), cc.warm);
        cores.push({ ...cc, x: ox + cc.x, y: oy + cc.y });
      }
    }
    for (const d of this.smallDecor || []) if (d.type === 'bonfire') glow(d.x, d.y - 6, 30, Math.max(0.35, n) * (0.85 + Math.random() * 0.15), '#ff9a40');
    const forge = world.buildings.find((b) => b.type === 'forge');
    if (forge && world.focus) glow(forge.x + 42, forge.base - 8, 20, 0.6, '#ff8a3a');
    ctx.globalCompositeOperation = 'source-over';
    for (const k of cores) {
      const warm = k.warm && k.warm !== '#ff8a3a' && k.warm !== '#ffb040' ? k.warm : '#ffc95a';
      R(ctx, k.x, k.y, k.w, k.h, warm);
      if (k.w > 2 && k.h > 2) R(ctx, k.x + 1, k.y + 1, k.w - 2, k.h - 2, tint(warm, 0.35));
      if (k.frame) {
        R(ctx, k.x + Math.floor(k.w / 2), k.y, 1, k.h, k.frame);
        R(ctx, k.x, k.y + Math.floor(k.h / 2), k.w, 1, k.frame);
      }
    }
  }

  /** Погода и живность поверх: тени облаков, дождь, листья, бабочки, летучие мыши, птицы, сияние. */
  weather(ctx, world, v, flavor, camX, camY) {
    const { W, H, n } = v;
    const t = world.t;
    if (n < 0.35) {
      ctx.globalAlpha = 0.07 * (1 - n * 2);
      for (let i = 0; i < 3; i++) {
        const span = W + 200;
        const x = ((rnd(i, 40) * span + t * (3 + i)) % span) - 100;
        const y = ((rnd(40, i) * (H + 100) + t * 1.5) % (H + 100)) - 50;
        ellipse(ctx, x, y, 50 + i * 12, 22 + i * 4, '#000');
      }
      ctx.globalAlpha = 1;
    }
    if (world.owned.has('v:aurora') && n > 0.45) {
      ctx.globalCompositeOperation = 'lighter';
      const a = clamp01((n - 0.45) * 2.5) * 0.12;
      const cols = ['93,255,176', '79,214,255', '183,140,255'];
      for (let x = 0; x < W; x += 3) {
        const y0 = H * 0.2 + Math.sin(x * 0.02 + t * 0.3) * H * 0.12;
        ctx.fillStyle = `rgba(${cols[Math.floor((x / 70 + t * 0.05) % 3 + 3) % 3]},${a * (0.6 + 0.4 * Math.sin(x * 0.1 + t))})`;
        ctx.fillRect(x, y0, 3, H * 0.35);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    if (world.legacy.has('scene:stars') && n > 0.5) {
      // звёзды отражаются в пруду
      const pd = world.map.pond;
      for (let i = 0; i < 14; i++) {
        const x = pd.x * TILE + 3 + rnd(i, 77) * (pd.w * TILE - 6) - camX;
        const y = pd.y * TILE + 3 + rnd(77, i) * (pd.h * TILE - 6) - camY;
        ctx.globalAlpha = (0.5 + 0.5 * Math.sin(t * 2 + i)) * clamp01((n - 0.5) * 2);
        P(ctx, x, y, '#ffffff');
      }
      ctx.globalAlpha = 1;
    }
    if (world.mood < 25) {
      ctx.globalAlpha = 0.5;
      for (let i = 0; i < 60; i++) {
        const x = (rnd(i, 5) * W + t * 20) % W;
        const y = (rnd(5, i) * H + t * 160) % H;
        R(ctx, x, y, 1, 3, '#9fb6d8');
      }
      ctx.globalAlpha = 1;
    }
    if (flavor === 'autumn') {
      for (let i = 0; i < 16; i++) {
        const x = (rnd(i, 2) * W + Math.sin(t + i) * 10 + t * 8) % W;
        const y = (rnd(2, i) * H + t * (14 + rnd(i, 4) * 10)) % H;
        R(ctx, x, y, 2, 1, ['#e8822a', '#d9682e', '#e8a33a'][i % 3]);
      }
    }
    if (flavor === 'meadow' && n < 0.4) {
      for (let i = 0; i < 6; i++) {
        const x = (rnd(i, 3) * W + Math.sin(t * 0.4 + i) * 40 + W) % W;
        const y = (rnd(3, i) * H + Math.cos(t * 0.3 + i) * 30 + H) % H;
        const f = Math.floor(t * 10 + i) % 2;
        R(ctx, x - (f ? 1 : 0), y, f ? 3 : 1, 1, ['#ffd23a', '#ff8fb0', '#8fd0ff', '#ffffff', '#c86bff', '#ffd23a'][i]);
      }
    }
    if (flavor === 'gothic' && n > 0.5) {
      for (let i = 0; i < 5; i++) {
        const x = ((t * (14 + i * 3) + i * 97) % (W + 40)) - 20;
        const y = (rnd(i, 8) * H * 0.7 + Math.sin(t * 2 + i) * 10 + H) % H;
        const f = Math.floor(t * 8 + i) % 2;
        P(ctx, x, y, '#120a1c');
        R(ctx, x - 2, y - f, 2, 1, '#120a1c');
        R(ctx, x + 1, y - f, 2, 1, '#120a1c');
      }
    } else if (n < 0.4) {
      const col = flavor === 'sea' ? '#f3f6fa' : '#2a2a38';
      for (let i = 0; i < 3; i++) {
        const x = ((t * (12 + i * 3) + i * 140) % (W + 40)) - 20;
        const y = (rnd(i, 9) * H * 0.8 + Math.sin(t + i * 2) * 6 + H) % H;
        const f = Math.floor(t * 4 + i) % 2;
        R(ctx, x - 2, y - f, 2, 1, col);
        P(ctx, x, y, col);
        R(ctx, x + 1, y - f, 2, 1, col);
      }
    }
  }
}

/** Знак «!» над хранителем, у чьего списка есть невыполненные задачи (0.9): белое облачко с оранжевым «!». */
function alertMark(c, x, y) {
  R(c, x - 3, y - 9, 7, 9, '#2a1e2a');
  R(c, x - 2, y - 10, 5, 11, '#2a1e2a');
  R(c, x - 2, y - 9, 5, 9, '#fff8e8');
  P(c, x, y + 1, '#2a1e2a');
  R(c, x, y - 8, 1, 4, '#ff8a1a');
  R(c, x, y - 3, 1, 1, '#ff8a1a');
}

/** Рука, которая держит жителя (0.9): белая перчатка; closed — пальцы сжаты. */
function drawHand(c, x, y, closed) {
  const o = '#2a1e2a';
  const w = '#ffffff';
  const s = '#d8dcea';
  R(c, x - 4, y - 10, 9, 9, o);
  R(c, x - 3, y - 9, 7, 7, w);
  R(c, x + 2, y - 9, 2, 7, s);
  // пальцы
  for (let i = 0; i < 3; i++) {
    R(c, x - 3 + i * 2, y - (closed ? 2 : 1), 2, closed ? 2 : 4, o);
    R(c, x - 3 + i * 2, y - (closed ? 2 : 1), 1, closed ? 1 : 3, w);
  }
  // большой палец
  R(c, x - 6, y - 6, 3, 3, o);
  R(c, x - 5, y - 5, 2, 1, w);
  // манжета
  R(c, x - 4, y - 13, 9, 3, o);
  R(c, x - 3, y - 12, 7, 1, '#ffd23a');
}

/**
 * Гость у экрана: крупный житель на своём маленьком холсте поверх приложения.
 * v: { W, H, u, n, style }, world.visitor — состояние.
 */
export function drawVisitor(c, world, v) {
  const vis = world.visitor;
  c.clearRect(0, 0, v.W, v.H);
  if (!vis) return null;
  const st = v.style;
  const flavor = flavorOf(st);
  c.imageSmoothingEnabled = false;
  const from = vis.side < 0 ? -9 * v.u : v.W + 9 * v.u;
  const to = v.W * (vis.side < 0 ? 0.45 : 0.55);
  const x = Math.round(from + (to - from) * vis.x);
  const dark = flavor === 'gothic' ? '#2a2236' : flavor === 'autumn' ? '#5a3a1e' : '#2e5a34';
  const reach = Math.round(to) + 9;
  for (let i = 0; i < reach; i++) {
    const px = vis.side < 0 ? i : v.W - 1 - i;
    const h = Math.max(0, Math.round((2 + Math.abs(Math.sin(px * 0.35)) * 2) * Math.min(1, (reach - i) / 6)));
    R(c, px, v.H - h, 1, h, px % 5 ? dark : st.grass2);
  }
  const y = v.H - 3 - Math.round(vis.y / 6);
  const dir = vis.stage === 'out' ? vis.side : -vis.side;
  const look = vis.actor?.look || LOOKS[vis.kind];
  if (CRITTERS.has(vis.kind)) {
    const a = { state: vis.state, phase: vis.phase || 0, anim: vis.anim || 0, happy: vis.stage === 'poked' || vis.stage === 'talk' };
    const s = critterSprite(vis.kind, critterPose(a), dir);
    const fs = 0.5 * v.u;
    c.drawImage(s.cv, Math.round(x / fs) * fs - s.ax * fs, Math.round(y / fs) * fs - s.ay * fs, CW * fs, CH * fs);
  } else if (look) {
    const a = { state: vis.state, phase: vis.phase || 0, anim: vis.anim || 0, happy: vis.stage === 'poked', n: 0 };
    const s = chibiSprite(look, lookKey(look), poseOf(a, v.n), dir);
    const fs = 0.5 * v.u;
    c.drawImage(s.cv, Math.round(x / fs) * fs - s.ax * fs, Math.round(y / fs) * fs - s.ay * fs, CW * fs, CH * fs);
  } else {
    const g = painter(c, x, y, dir, v.u, 1);
    drawCharacter(g, vis.kind, { state: vis.state, phase: vis.phase || 0, t: vis.anim || 0, happy: vis.stage === 'poked', night: v.n > 0.5 });
  }
  const hTop = y - charHeight(vis.kind) * v.u;
  if (vis.emote) drawEmote(c, x, hTop - 6, vis.emote, Math.max(1, v.u - 1));
  else if (world.alertOf(vis.actor) > 0 && vis.stage !== 'talk') alertMark(c, x, hTop - 4 + Math.round(Math.sin((vis.anim || 0) * 4) * 1.2));
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
