// Карта деревни (обновление 0.7.1, вид сверху «как в Stardew Valley»): сетка тайлов 46 × 34 по 12 пикселей.
// Сверху лес и скальный уступ с шахтами, справа река с водопадом и мостом, посередине площадь, улица и дорога,
// участки под постройки, поля у мельницы, пруд, снизу лес (у морского стиля — пляж и море).
// Раскладка детерминирована: одинаковые покупки и стиль дают одинаковую карту на всех устройствах. Без DOM.

export const TILE = 12;
export const COLS = 46;
export const ROWS = 34;

/** Типы тайлов. */
export const T = { GRASS: 0, PATH: 1, PLAZA: 2, WATER: 3, CLIFF: 4, HIGH: 5, FIELD: 6, BRIDGE: 7, FOREST: 8, SAND: 9, SEA: 10 };
const WALKABLE = new Set([T.GRASS, T.PATH, T.PLAZA, T.BRIDGE, T.SAND]);
/** Цена шага для поиска пути: жители предпочитают дорожки. */
export const STEP_COST = { [T.PATH]: 1, [T.PLAZA]: 1, [T.BRIDGE]: 1, [T.GRASS]: 1.7, [T.SAND]: 1.4 };

/**
 * Участки построек: x, y, w, h — занятые тайлы (основание), door — тайл перед дверью (снаружи), куда подходят жители.
 * Спрайт постройки выше основания (крыша, башня) и рисуется с якорем у нижнего края основания.
 */
export const LOTS = [
  { key: 'v:house:3', type: 'house', x: 3, y: 9, w: 5, h: 3, door: [5, 12], v: 2 },
  { key: 'v:house:4', type: 'house4', x: 11, y: 8, w: 6, h: 4, door: [13, 12], v: 0 },
  { key: 'v:forge', type: 'forge', x: 19, y: 9, w: 5, h: 3, door: [21, 12] },
  { key: 'v:house:2', type: 'house', x: 25, y: 9, w: 5, h: 3, door: [27, 12], v: 1 },
  { key: 'v:tower', type: 'tower', x: 34, y: 8, w: 3, h: 4, door: [35, 12] },
  { key: 'base:house', type: 'house', x: 4, y: 16, w: 5, h: 3, door: [6, 19], v: 0 },
  { key: 'v:tavern', type: 'tavern', x: 29, y: 15, w: 7, h: 4, door: [32, 19] },
  { key: 'v:windmill', type: 'windmill', x: 19, y: 23, w: 4, h: 3, door: [20, 26] },
  { key: 'v:fountain', type: 'fountain', x: 22, y: 14, w: 3, h: 2, door: [23, 16] },
  { key: 'v:mine-gold', type: 'goldmine', x: 8, y: 5, w: 3, h: 2, door: [9, 7], levels: true },
  { key: 'v:mine-gem', type: 'gemmine', x: 30, y: 5, w: 3, h: 2, door: [31, 7], levels: true },
];

/** Места фонарей (по порядку покупки) и обстановки. */
const LANTERN_SPOTS = [[18, 13], [28, 13], [17, 21], [35, 21], [8, 13]];
const levelOf = (owned, prefix) => [3, 2, 1].find((n) => owned.has(`${prefix}:${n}`)) || 0;

// детерминированный «случай»
export function rnd(a, b = 0) {
  let x = Math.imul((a | 0) ^ Math.imul(b | 0, 0x9e3779b1), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/**
 * Собрать карту по покупкам и стилю. Возвращает:
 * { cols, rows, tile, grid (Uint8Array типов), blocked (Uint8Array), buildings, decor, trees, lanterns, village (рамка жилой части),
 *   pond, river, fields, sea, spots (точки интереса), key }
 */
export function buildMap(owned, legacy = new Set(), flavor = 'classic') {
  const grid = new Uint8Array(COLS * ROWS);
  const blocked = new Uint8Array(COLS * ROWS);
  const at = (x, y) => y * COLS + x;
  const set = (x, y, t) => {
    if (x >= 0 && y >= 0 && x < COLS && y < ROWS) grid[at(x, y)] = t;
  };
  const rect = (x, y, w, h, t) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(i, j, t);
  };
  const sea = flavor === 'sea';
  // лес и уступ
  rect(0, 0, COLS, 2, T.FOREST);
  rect(0, 2, COLS, 3, T.HIGH);
  rect(0, 5, COLS, 2, T.CLIFF);
  rect(0, 7, 2, ROWS - 7, T.FOREST);
  rect(COLS - 2, 7, 2, ROWS - 7, T.FOREST);
  if (sea) {
    rect(2, 26, COLS - 4, 2, T.SAND);
    rect(0, 28, COLS, ROWS - 28, T.SEA);
    rect(0, 26, 2, 2, T.SAND);
    rect(COLS - 2, 26, 2, 2, T.SAND);
  } else rect(0, 28, COLS, ROWS - 28, T.FOREST);
  // река с водопадом и мостом
  const river = { x: 41, w: 3 };
  rect(river.x, 2, river.w, ROWS - 2, T.WATER);
  rect(river.x, 5, river.w, 2, T.WATER); // водопад со скалы
  // дороги
  rect(3, 12, 35, 1, T.PATH); // улица
  rect(2, 19, COLS - 2, 2, T.PATH); // главная дорога
  rect(river.x, 19, river.w, 2, T.BRIDGE);
  rect(9, 7, 1, 5, T.PATH); // к золотой шахте
  rect(31, 7, 1, 5, T.PATH); // к изумрудной
  rect(19, 13, 9, 6, T.PLAZA); // площадь
  rect(23, 21, 1, sea ? 5 : ROWS - 21, T.PATH); // тропинка на юг — в лес (к экрану)
  rect(18, 21, 1, 6, T.PATH); // к мельнице
  rect(18, 26, 3, 1, T.PATH);
  // пруд
  const pond = { x: 27, y: 23, w: 6, h: 3 };
  rect(pond.x, pond.y, pond.w, pond.h, T.WATER);
  // поля у мельницы (если она есть)
  const fields = owned.has('v:windmill') ? { x: 4, y: 22, w: 12, h: 4 } : null;
  if (fields) rect(fields.x, fields.y, fields.w, fields.h, T.FIELD);
  // постройки
  const buildings = [];
  for (const lot of LOTS) {
    let level = 1;
    let id = lot.key;
    if (lot.levels) {
      level = levelOf(owned, lot.key);
      if (!level) continue;
      id = `${lot.key}:${level}`;
    } else if (!owned.has(lot.key)) continue;
    const b = {
      id, type: lot.type, level, tx: lot.x, ty: lot.y, tw: lot.w, th: lot.h, v: lot.v ?? 0,
      x: lot.x * TILE, y: lot.y * TILE, w: lot.w * TILE, h: lot.h * TILE,
      base: (lot.y + lot.h) * TILE, // нижний край основания — по нему сортировка глубины
      door: { x: (lot.door[0] + 0.5) * TILE, y: (lot.door[1] + 0.5) * TILE },
    };
    buildings.push(b);
    if (lot.type !== 'goldmine' && lot.type !== 'gemmine') for (let j = lot.y; j < lot.y + lot.h; j++) for (let i = lot.x; i < lot.x + lot.w; i++) blocked[at(i, j)] = 1;
  }
  const has = (type) => buildings.find((b) => b.type === type);
  // фонари
  const nL = [1, 2, 3, 4].filter((n) => owned.has(`v:lantern:${n}`)).length + (legacy.has('prop:lantern') ? 1 : 0);
  const lanterns = [];
  for (let i = 0; i < Math.min(nL, LANTERN_SPOTS.length); i++) {
    const [x, y] = LANTERN_SPOTS[i];
    lanterns.push({ id: 'lantern:' + i, x: (x + 0.5) * TILE, y: (y + 0.8) * TILE });
    blocked[at(x, y)] = 1;
  }
  // обстановка: базовая — у всех, остальная — по покупкам
  const decor = [];
  const put = (type, tx, ty, extra = {}, block = true) => {
    decor.push({ type, x: (tx + 0.5) * TILE, y: (ty + 0.85) * TILE, ...extra });
    if (block) blocked[at(tx, ty)] = 1;
  };
  if (!has('fountain')) put('well', 23, 15, {}, true);
  put('sign', 3, 18, {});
  put('mailbox', 9, 18, {});
  if (has('tavern')) put('barrels', 36, 18, {});
  else put('barrels', 10, 17, {});
  if (has('forge')) put('anvil', 18, 11, {}, false);
  if (has('forge')) put('crates', 24, 11, {});
  if (has('windmill')) put('hay', 17, 24, {});
  if (buildings.some((b) => b.type === 'goldmine')) put('cart', 11, 7, {});
  if (owned.has('v:bonfire')) put('bonfire', 14, 16, {});
  if (owned.has('v:benches')) {
    put('bench', 20, 17, {}, false);
    put('bench', 26, 17, {}, false);
  }
  // тыквы — слева от дома, клумбы — справа (если место свободно)
  const free = (tx, ty) => tx >= 0 && ty >= 0 && tx < COLS && ty < ROWS && grid[at(tx, ty)] === T.GRASS && !blocked[at(tx, ty)] && !decor.some((d) => Math.floor(d.x / TILE) === tx && Math.floor(d.y / TILE) === ty);
  const homes = buildings.filter((q) => q.type.startsWith('house') || q.type === 'tavern');
  if (owned.has('v:pumpkins')) for (const b of homes) if (free(b.tx - 1, b.ty + b.th - 1)) put('pumpkin', b.tx - 1, b.ty + b.th - 1, {}, false);
  if (owned.has('v:flowers')) for (const b of homes) if (free(b.tx + b.tw, b.ty + b.th - 1)) put('flowerbed', b.tx + b.tw, b.ty + b.th - 1, {}, false);
  if (legacy.has('prop:mushrooms')) put('mushrooms', 38, 9, {}, false);
  if (legacy.has('prop:crystal')) put('crystal', 33, 7, {});
  if (legacy.has('prop:pickaxe')) put('pickaxe', 7, 7, {}, false);
  if (owned.has('v:char:archer')) put('target', 38, 24, {});
  if (flavor === 'gothic') for (const [x, y] of [[36, 25], [37, 26], [39, 24]]) put('grave', x, y, {});
  if (sea) put('boat', 30, 28, {}, false);
  // забор вокруг полей
  if (fields) {
    for (let i = fields.x - 1; i <= fields.x + fields.w; i++) {
      if (i !== fields.x + 6) put('fence', i, fields.y - 1, { side: 'top' }, true);
      put('fence', i, fields.y + fields.h, { side: 'bottom' }, true);
    }
    for (let j = fields.y; j < fields.y + fields.h; j++) {
      put('fence', fields.x - 1, j, { side: 'left' }, true);
      put('fence', fields.x + fields.w, j, { side: 'right' }, true);
    }
  }
  // деревья: лес по краям, на уступе, и несколько в деревне
  const trees = [];
  const tree = (tx, ty, jitter, k) => {
    const r = rnd(tx * 31 + k, ty * 17);
    trees.push({ x: (tx + 0.5) * TILE + (r - 0.5) * jitter, y: (ty + 0.9) * TILE + (rnd(ty, tx + k) - 0.5) * jitter, s: Math.floor(rnd(tx, ty * 7 + k) * 3), size: 0.85 + rnd(tx + 9, ty) * 0.35 });
  };
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const t = grid[at(x, y)];
      if (t === T.FOREST && (x + y) % 2 === 0) tree(x, y, 6, 1);
      else if (t === T.FOREST && rnd(x, y) > 0.55) tree(x, y, 8, 2);
      else if (t === T.HIGH && y >= 2 && rnd(x * 3, y) > 0.72 && !(x >= river.x - 1 && x <= river.x + river.w)) tree(x, y, 6, 3);
    }
  }
  for (const [x, y] of [[17, 14], [16, 22], [36, 15], [38, 22], [25, 22], [35, 25], [12, 14], [2, 13], [39, 13], [26, 26], [10, 27]]) {
    if (blocked[at(x, y)] || !WALKABLE.has(grid[at(x, y)]) || grid[at(x, y)] !== T.GRASS) continue;
    tree(x, y, 2, 4);
    blocked[at(x, y)] = 1;
  }
  // точки интереса для жителей
  const tc = (x, y) => ({ x: (x + 0.5) * TILE, y: (y + 0.5) * TILE });
  const spots = {
    plaza: tc(23, 17),
    southExit: tc(23, sea ? 27 : ROWS - 1),
    benches: owned.has('v:benches') ? [tc(20, 17), tc(26, 17)] : [],
    bonfire: owned.has('v:bonfire') ? tc(14, 17) : null,
    pond: tc(29, 22),
    archer: tc(33, 24),
    westEnd: tc(3, 20),
    eastEnd: tc(COLS - 3, 20),
  };
  const village = { x0: 2 * TILE, y0: 7 * TILE, x1: (COLS - 2) * TILE, y1: (sea ? 28 : 28) * TILE };
  const key = [flavor, ...buildings.map((b) => b.id), ...decor.map((d) => d.type), lanterns.length].join('|');
  return { cols: COLS, rows: ROWS, tile: TILE, grid, blocked, buildings, decor, trees, lanterns, village, pond, river, fields, sea, spots, key };
}

export const tileAt = (map, x, y) => {
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return -1;
  return map.grid[ty * COLS + tx];
};

/** Можно ли стоять на тайле (tx, ty). */
export function walkable(map, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return false;
  const i = ty * COLS + tx;
  return WALKABLE.has(map.grid[i]) && !map.blocked[i];
}

/** Поиск пути A* по тайлам (4 направления, дорожки дешевле травы). Возвращает массив [tx, ty] без стартового тайла или null. */
export function findPath(map, from, to, limit = 4000) {
  const [sx, sy] = from;
  const [gx, gy] = to;
  if (!walkable(map, gx, gy)) return null;
  if (sx === gx && sy === gy) return [];
  const N = COLS * ROWS;
  const g = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const open = [];
  const h = (x, y) => Math.abs(x - gx) + Math.abs(y - gy);
  const s = sy * COLS + sx;
  g[s] = 0;
  open.push([h(sx, sy), s]);
  let steps = 0;
  while (open.length && steps++ < limit) {
    // простая очередь с приоритетом: берём минимум (поле маленькое)
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
    const [, cur] = open[bi];
    open[bi] = open[open.length - 1];
    open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % COLS;
    const cy = (cur / COLS) | 0;
    if (cx === gx && cy === gy) {
      const out = [];
      for (let k = cur; k !== s; k = came[k]) out.push([k % COLS, (k / COLS) | 0]);
      return out.reverse();
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!walkable(map, nx, ny) && !(nx === sx && ny === sy)) continue;
      const ni = ny * COLS + nx;
      if (closed[ni]) continue;
      const cost = g[cur] + (STEP_COST[map.grid[ni]] || 2);
      if (cost < g[ni]) {
        g[ni] = cost;
        came[ni] = cur;
        open.push([cost + h(nx, ny), ni]);
      }
    }
  }
  return null;
}

/** Случайный тайл, где можно стоять, в жилой части (для прогулок). */
export function randomSpot(map, rand, near = null, radius = 8) {
  for (let k = 0; k < 40; k++) {
    let tx;
    let ty;
    if (near) {
      tx = Math.floor(near.x / TILE + (rand() - 0.5) * radius * 2);
      ty = Math.floor(near.y / TILE + (rand() - 0.5) * radius * 2);
    } else {
      tx = 3 + Math.floor(rand() * (COLS - 6));
      ty = 7 + Math.floor(rand() * 21); // жилая часть: между уступом и южным лесом
    }
    if (walkable(map, tx, ty)) return [tx, ty];
  }
  return [23, 17];
}
