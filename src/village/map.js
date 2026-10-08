// Карта деревни (обновление 0.7.1 — вид сверху «как в Stardew Valley», 0.7.2 — свободная расстановка и рост).
//
// Тайлы 12 × 12 пикселей. Посередине — «земля деревни» (прямоугольник, где можно строить), её размер растёт уровнями
// по мере застройки: 30 × 18 тайлов, +8 × +4 за уровень. Вокруг: живая изгородь по краю, луговая кайма, сверху
// скальный уступ с водопадом, справа река с мостом, снизу лес (в морском стиле — пляж и море), дальше — лес.
// В центре площадь; через неё проходит главная дорога (запад — восток) и аллея (север — юг, к экрану).
//
// Каждый объект (дом, шахта, фонарь, клумба…) стоит на своей клетке. Позиция хранится относительно центра площади
// (rx, ry), поэтому при росте земли ничего не сдвигается. Объект без позиции (или с занятой/неверной) ставится сам —
// по спирали от «своего» места (дома — к северу от площади, мельница и огороды — к юго-западу и т. д.).
// Большим постройкам нужна клетка зазора вокруг и свободная клетка перед дверью — так к любой двери есть проход.
// От дверей к дороге прокладываются тропинки. Всё детерминировано: одинаковые данные дают одинаковую деревню. Без DOM.

export const TILE = 12;

/** Типы тайлов. */
export const T = { GRASS: 0, PATH: 1, PLAZA: 2, WATER: 3, CLIFF: 4, HIGH: 5, FIELD: 6, BRIDGE: 7, FOREST: 8, SAND: 9, SEA: 10 };
const WALKABLE = new Set([T.GRASS, T.PATH, T.PLAZA, T.BRIDGE, T.SAND]);
/** Цена шага для поиска пути: жители предпочитают дорожки. */
export const STEP_COST = { [T.PATH]: 1, [T.PLAZA]: 1, [T.BRIDGE]: 1, [T.GRASS]: 1.7, [T.SAND]: 1.4 };

/** Размер объектов в клетках [ширина, высота основания]. */
export const FOOT = {
  house: [5, 3], manor: [6, 4], tavern: [7, 4], forge: [5, 3], windmill: [4, 3], tower: [3, 3], fountain: [3, 2],
  goldmine: [3, 2], gemmine: [3, 2], field: [4, 3], lantern: [1, 1], bench: [2, 1], pumpkin: [1, 1], flowerbed: [2, 1],
  tree: [1, 1], bonfire: [1, 1], target: [1, 1], castle: [9, 5],
};
const BIG = new Set(['house', 'manor', 'tavern', 'forge', 'windmill', 'tower', 'fountain', 'goldmine', 'gemmine', 'field', 'castle']);
/** Тип для рисования (дом с мансардой рисуется как house4). */
export const DRAW = { manor: 'house4' };
/** Куда тянется объект без позиции (относительно центра площади). */
const ANCHOR = {
  house: [-3, -8], manor: [4, -8], tavern: [8, -2], forge: [-10, -8], windmill: [-10, 7], field: [-14, 7], tower: [13, -7],
  fountain: [-1, -1], goldmine: [-14, -8], gemmine: [13, -8], lantern: [-1, 2], bench: [-3, 2], pumpkin: [-6, 1],
  flowerbed: [3, 1], tree: [8, 9], bonfire: [-6, 6], target: [13, 7], castle: [-5, -15],
};

export const MARGIN = { w: 26, e: 26, n: 20, s: 20 };
export const landSize = (L) => ({ w: 30 + 8 * L, h: 18 + 4 * L });

// детерминированный «случай»
export function rnd(a, b = 0) {
  let x = Math.imul((a | 0) ^ Math.imul(b | 0, 0x9e3779b1), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

// Занятость клеток при расстановке
const O = { FREE: 0, ROAD: 1, BIG: 2, APRON: 3, BLOCK: 4, SMALL: 5 };

function frame(L, mw = 0, mh = 0) {
  const { w, h } = landSize(L);
  const extraW = Math.max(0, Math.ceil((mw - (w + MARGIN.w + MARGIN.e)) / 2));
  const extraH = Math.max(0, Math.ceil((mh - (h + MARGIN.n + MARGIN.s)) / 2));
  const x0 = MARGIN.w + extraW;
  const y0 = MARGIN.n + extraH;
  const cols = w + MARGIN.w + MARGIN.e + extraW * 2;
  const rows = h + MARGIN.n + MARGIN.s + extraH * 2;
  return { L, cols, rows, land: { x0, y0, x1: x0 + w - 1, y1: y0 + h - 1, w, h }, cx: x0 + Math.floor(w / 2), cy: y0 + Math.floor(h / 2) };
}

/** Клетки, занятые в начале: всё вне земли, кайма, дороги, площадь, пруд, дом старосты. */
function baseLayout(F, flavor) {
  const { cols, rows, land, cx, cy } = F;
  const N = cols * rows;
  const grid = new Uint8Array(N);
  const occ = new Uint8Array(N);
  const at = (x, y) => y * cols + x;
  const inMap = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;
  const set = (x, y, t) => {
    if (inMap(x, y)) grid[at(x, y)] = t;
  };
  const rect = (x, y, w, h, t) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(i, j, t);
  };
  const sea = flavor === 'sea';
  // лес вокруг, луговая кайма вокруг земли
  rect(0, 0, cols, rows, T.FOREST);
  rect(land.x0 - 3, land.y0 - 1, land.w + 6, land.h + 5, T.GRASS);
  // сверху: уступ (трава выше), скала, кайма
  rect(land.x0 - 8, land.y0 - 5, land.w + 16, 2, T.HIGH);
  rect(land.x0 - 8, land.y0 - 3, land.w + 16, 2, T.CLIFF);
  rect(land.x0 - 3, land.y0 - 1, land.w + 6, 1, T.GRASS);
  // снизу: море с пляжем
  if (sea) {
    rect(0, land.y1 + 3, cols, 2, T.SAND);
    rect(0, land.y1 + 5, cols, rows, T.SEA);
  }
  // река справа: от верхнего леса до низа, водопад со скалы, мост на дороге
  const river = { x: land.x1 + 4, w: 3 };
  rect(river.x, 0, river.w, rows, T.WATER);
  const road = cy + 3;
  rect(0, road, cols, 2, T.PATH);
  rect(river.x, road, river.w, 2, T.BRIDGE);
  // площадь, аллея на север и на юг (к экрану)
  rect(cx - 4, cy - 3, 9, 6, T.PLAZA);
  rect(cx, land.y0, 1, cy - 3 - land.y0, T.PATH);
  rect(cx, road + 2, 1, sea ? land.y1 + 4 - road - 2 : land.y1 + 6 - road - 2, T.PATH);
  // пруд
  const pond = { x: cx + 6, y: cy + 6, w: 6, h: 3 };
  rect(pond.x, pond.y, pond.w, pond.h, T.WATER);
  // занятость
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = at(x, y);
      const inLand = x > land.x0 && x < land.x1 && y > land.y0 && y < land.y1; // крайний ряд земли — изгородь
      const t = grid[i];
      if (!inLand) occ[i] = O.BLOCK;
      else if (t === T.PATH || t === T.PLAZA || t === T.BRIDGE) occ[i] = O.ROAD;
      else if (t !== T.GRASS) occ[i] = O.BLOCK;
    }
  }
  return { grid, occ, river, pond, road, at, inMap };
}

const footOf = (type) => FOOT[type] || [1, 1];

/** Можно ли поставить объект type левым верхним углом в клетку (tx, ty). */
function fitsOcc(F, occ, grid, type, tx, ty, plazaFountain = false) {
  const { cols, rows } = F;
  const [w, h] = footOf(type);
  const big = BIG.has(type);
  for (let y = ty; y < ty + h; y++) {
    for (let x = tx; x < tx + w; x++) {
      if (x < 0 || y < 0 || x >= cols || y >= rows) return false;
      const o = occ[y * cols + x];
      if (o === O.FREE) continue;
      if (plazaFountain && o === O.ROAD && grid[y * cols + x] === T.PLAZA) continue;
      return false;
    }
  }
  if (!big) return true;
  for (let y = ty - 1; y <= ty + h; y++) {
    for (let x = tx - 1; x <= tx + w; x++) {
      if (x >= tx && x < tx + w && y >= ty && y < ty + h) continue;
      if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      const o = occ[y * cols + x];
      if (o === O.BIG) return false;
    }
  }
  if (type === 'fountain' || type === 'field') return true;
  const ax = tx + Math.floor(w / 2);
  const ay = ty + h;
  if (ay >= rows) return false;
  const ao = occ[ay * cols + ax];
  return ao === O.FREE || ao === O.ROAD || ao === O.APRON;
}

function mark(F, occ, type, tx, ty) {
  const { cols } = F;
  const [w, h] = footOf(type);
  const big = BIG.has(type);
  for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) occ[y * cols + x] = big ? O.BIG : O.SMALL;
  if (big && type !== 'fountain' && type !== 'field') {
    const i = (ty + h) * cols + tx + Math.floor(w / 2);
    if (occ[i] === O.FREE) occ[i] = O.APRON;
  }
}

/** Клетки по спирали от якоря (ближние — раньше), только внутри земли. */
function* spiral(F, ax, ay) {
  const { land } = F;
  const maxR = Math.max(land.w, land.h);
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = ax + dx;
        const y = ay + dy;
        if (x > land.x0 && x < land.x1 && y > land.y0 && y < land.y1) yield [x, y];
      }
    }
  }
}

/** Попытаться расставить объекты на земле уровня L. → { placed, failed } */
function placeAll(F, base, objects) {
  const { occ, grid } = base;
  const placed = [];
  // площадь: центр — для фонтана без позиции
  for (const o of objects) {
    const type = o.place;
    const [w, h] = footOf(type);
    let pos = null;
    if (type === 'fountain' && o.x == null) {
      const tx = F.cx - 1;
      const ty = F.cy - 1;
      if (fitsOcc(F, occ, grid, type, tx, ty, true)) pos = [tx, ty];
    }
    if (!pos && o.x != null && o.y != null) {
      const tx = F.cx + o.x;
      const ty = F.cy + o.y;
      if (fitsOcc(F, occ, grid, type, tx, ty, type === 'fountain')) pos = [tx, ty];
    }
    if (!pos) {
      const [ax, ay] = o.x != null ? [F.cx + o.x, F.cy + o.y] : (ANCHOR[type] || [0, 0]).map((v, i) => v + (i ? F.cy : F.cx));
      for (const [x, y] of spiral(F, ax, ay)) {
        if (fitsOcc(F, occ, grid, type, x, y)) {
          pos = [x, y];
          break;
        }
      }
    }
    if (!pos) return { placed, failed: o };
    mark(F, occ, type, pos[0], pos[1]);
    placed.push({ o, tx: pos[0], ty: pos[1], w, h });
  }
  return { placed, failed: null };
}

/** Самый маленький уровень земли, в который влезают все вручную поставленные позиции. */
function minLevel(objects) {
  let L = 0;
  for (const o of objects) {
    if (o.x == null || o.y == null) continue;
    const [w, h] = footOf(o.place);
    while (L < 12) {
      const { w: lw, h: lh } = landSize(L);
      const hx = Math.floor(lw / 2);
      const hy = Math.floor(lh / 2);
      if (o.x > -hx && o.x + w - 1 < lw - hx - 1 && o.y > -hy && o.y + h - 1 < lh - hy - 1) break;
      L++;
    }
  }
  return L;
}

/**
 * Собрать карту. objects — из core/village.js villageObjects (+ виртуальные: мишень лучницы).
 * opts: { flavor, minCols, minRows, legacy } — minCols/minRows: карта не меньше видимой области (чтобы отдалять).
 */
export function buildMap(objects = [], opts = {}) {
  const flavor = opts.flavor || 'classic';
  const legacy = opts.legacy || new Set();
  const list = objects.map((o) => ({ ...o }));
  let L = minLevel(list);
  let F;
  let base;
  let res;
  for (;;) {
    F = frame(L, opts.minCols || 0, opts.minRows || 0);
    base = baseLayout(F, flavor);
    // дом старосты и колодец/почтовый ящик — всегда
    mark(F, base.occ, 'house', F.cx - 11, F.cy - 2);
    base.occ[(F.cy) * F.cols + F.cx - 6] = O.SMALL; // почтовый ящик у дома старосты
    res = placeAll(F, base, list);
    if (!res.failed || L >= 12) {
      // мало свободного места (меньше 16 % земли или меньше трёх мест под новый дом) — расширяемся заранее,
      // чтобы было где строить прямо в деревне
      if (!res.failed && L < 12) {
        let free = 0;
        for (let i = 0; i < base.occ.length; i++) if (base.occ[i] === O.FREE) free++;
        let spots = 0;
        const { land } = F;
        const tmp = new Uint8Array(base.occ); // места считаем, «ставя» дома на копию — так они не пересекаются
        for (let y = land.y0 + 1; y < land.y1 && spots < 3; y++) {
          for (let x = land.x0 + 1; x < land.x1 && spots < 3; x++) {
            if (!fitsOcc(F, tmp, base.grid, 'house', x, y)) continue;
            mark(F, tmp, 'house', x, y);
            spots++;
          }
        }
        if (free < land.w * land.h * 0.16 || spots < 3) {
          L++;
          continue;
        }
      }
      break;
    }
    L++;
  }
  const { cols, rows, land, cx, cy } = F;
  const { grid, occ, river, pond, at } = base;
  const blocked = new Uint8Array(cols * rows);
  // объекты
  const mk = (id, type, tx, ty, extra = {}) => {
    const [w, h] = footOf(type);
    const draw = DRAW[type] || type;
    return {
      id, key: id, type: draw, place: type, tx, ty, tw: w, th: h, x: tx * TILE, y: ty * TILE, w: w * TILE, h: h * TILE,
      base: (ty + h) * TILE, door: { x: (tx + Math.floor(w / 2) + 0.5) * TILE, y: (ty + h + 0.5) * TILE },
      rx: tx - cx, ry: ty - cy, ...extra,
    };
  };
  const buildings = [mk('base:house', 'house', cx - 11, cy - 2, { v: 0, level: 1, fixed: true })];
  const smalls = [];
  let houses = 0;
  for (const { o, tx, ty } of res.placed) {
    const big = BIG.has(o.place);
    const item = mk(o.key, o.place, tx, ty, { itemId: o.itemId, level: o.level || 1, virtual: !!o.virtual, v: o.place === 'house' ? (++houses % 3) : 0 });
    // у временного объекта «куда поставить новую покупку» (suggestPlace) itemId нет
    if ((o.place === 'goldmine' || o.place === 'gemmine') && o.itemId) item.id = `${o.itemId.replace(/:\d+$/, '')}:${o.level}`;
    if (big) buildings.push(item);
    else smalls.push(item);
  }
  // занятые клетки для ходьбы, огороды на земле
  for (const b of buildings) {
    for (let y = b.ty; y < b.ty + b.th; y++) for (let x = b.tx; x < b.tx + b.tw; x++) {
      blocked[at(x, y)] = 1;
      if (b.place === 'field') grid[at(x, y)] = T.FIELD;
    }
  }
  for (const s of smalls) if (s.place !== 'bench') blocked[at(s.tx, s.ty)] = 1;
  // тропинки от дверей к дороге (по траве, в обход построек)
  const isRoad = (i) => grid[i] === T.PATH || grid[i] === T.PLAZA;
  for (const b of buildings) {
    if (b.place === 'fountain' || b.place === 'field') continue;
    const sx = b.tx + Math.floor(b.tw / 2);
    const sy = b.ty + b.th;
    if (sy >= rows) continue;
    const start = at(sx, sy);
    if (isRoad(start)) continue;
    const prev = new Int32Array(cols * rows).fill(-1);
    const seen = new Uint8Array(cols * rows);
    const q = [start];
    seen[start] = 1;
    let found = -1;
    for (let k = 0; k < q.length && k < 4000; k++) {
      const i = q[k];
      if (isRoad(i)) {
        found = i;
        break;
      }
      const x = i % cols;
      const y = (i / cols) | 0;
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const ni = at(nx, ny);
        if (seen[ni] || blocked[ni]) continue;
        const t = grid[ni];
        if (t !== T.GRASS && t !== T.PATH && t !== T.PLAZA) continue;
        seen[ni] = 1;
        prev[ni] = i;
        q.push(ni);
      }
    }
    for (let i = found >= 0 ? prev[found] : -1; i >= 0; i = prev[i]) if (grid[i] === T.GRASS) grid[i] = T.PATH;
  }
  // обстановка: колодец (если фонтан не на площади), указатель, почтовый ящик, надгробия, лодка
  const decor = [];
  const put = (type, tx, ty, block = true) => {
    decor.push({ type, x: (tx + 0.5) * TILE, y: (ty + 0.85) * TILE, tx, ty });
    if (block) blocked[at(tx, ty)] = 1;
  };
  const fountainOnPlaza = buildings.some((b) => b.place === 'fountain' && b.tx === cx - 1 && b.ty === cy - 1);
  if (!fountainOnPlaza) put('well', cx, cy - 1);
  put('sign', land.x0 - 2, base.road - 1);
  put('mailbox', cx - 6, cy);
  if (flavor === 'gothic') for (const [dx, dy] of [[1, 2], [2, 4], [1, 6], [2, 8]]) put('grave', land.x1 + dx, land.y0 + dy, false);
  if (flavor === 'sea') put('boat', cx + 6, land.y1 + 6, false);
  // деревья: изгородь по краю земли, кайма, лес (дальний — в кэш земли), уступ
  const trees = [];
  const farTrees = [];
  const tree = (tx, ty, jitter, k, far) => {
    const r = rnd(tx * 31 + k, ty * 17);
    const t = { x: (tx + 0.5) * TILE + (r - 0.5) * jitter, y: (ty + 0.9) * TILE + (rnd(ty, tx + k) - 0.5) * jitter, s: Math.floor(rnd(tx, ty * 7 + k) * 3), size: 0.85 + rnd(tx + 9, ty) * 0.35 };
    (far ? farTrees : trees).push(t);
  };
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const t = grid[at(x, y)];
      const near = x > land.x0 - 9 && x < land.x1 + 9 && y > land.y0 - 9 && y < land.y1 + 9;
      if (t === T.FOREST) {
        if ((x + y) % 2 === 0 || rnd(x, y) > 0.6) tree(x, y, 6, 1, !near);
        blocked[at(x, y)] = 1;
      } else if (t === T.HIGH && rnd(x * 3, y) > 0.7 && !(x >= river.x - 1 && x <= river.x + river.w)) tree(x, y, 6, 3, !near);
      else if (t === T.GRASS) {
        const edge = (x === land.x0 || x === land.x1 || y === land.y0 || y === land.y1) && occ[at(x, y)] === O.BLOCK;
        const rim = !edge && (x < land.x0 || x > land.x1 || y < land.y0 || y > land.y1);
        if ((edge && rnd(x, y * 5) > (y === land.y1 ? 0.82 : 0.68)) || (rim && rnd(x * 7, y) > 0.9)) {
          tree(x, y, 3, 4, false);
          blocked[at(x, y)] = 1;
        }
      }
    }
  }
  for (const s of smalls) if (s.place === 'tree') trees.push({ x: s.x + TILE / 2, y: s.y + TILE * 0.9, s: (s.tx + s.ty) % 3, size: 1, obj: s.key });
  // точки интереса
  const tc = (x, y) => ({ x: (x + 0.5) * TILE, y: (y + 0.5) * TILE });
  const benches = smalls.filter((s) => s.place === 'bench').map((s) => ({ x: s.x + TILE, y: s.y + TILE * 0.7 }));
  const fire = smalls.find((s) => s.place === 'bonfire');
  const target = smalls.find((s) => s.place === 'target');
  const spots = {
    plaza: tc(cx, cy + 1),
    southExit: tc(cx, flavor === 'sea' ? land.y1 + 3 : land.y1 + 5),
    benches,
    bonfire: fire ? tc(fire.tx, fire.ty + 1) : null,
    pond: tc(pond.x + 2, pond.y - 1),
    archer: target ? tc(Math.max(land.x0 + 1, target.tx - 4), target.ty) : null,
    westEnd: tc(land.x0, base.road),
    eastEnd: tc(land.x1, base.road),
  };
  const lanterns = smalls.filter((s) => s.place === 'lantern').map((s) => ({ ...s, id: s.key, x: (s.tx + 0.5) * TILE, y: (s.ty + 0.8) * TILE }));
  const village = { x0: land.x0 * TILE, y0: land.y0 * TILE, x1: (land.x1 + 1) * TILE, y1: (land.y1 + 1) * TILE };
  const key = [flavor, L, cols, rows, ...buildings.map((b) => `${b.id}@${b.tx},${b.ty}`), ...smalls.map((s) => `${s.place}@${s.tx},${s.ty}`), legacy.size].join('|');
  return {
    cols, rows, tile: TILE, L, land, cx, cy, grid, blocked, occ, buildings, smalls, decor, trees, farTrees, lanterns,
    village, pond, river, road: base.road, cliffY: land.y0 - 3, sea: flavor === 'sea', spots, key,
  };
}

/** Можно ли поставить объект key (его самого не считаем) типа type в клетку (tx, ty) на готовой карте. */
export function canPlace(map, type, tx, ty, key = null) {
  const occ = new Uint8Array(map.occ);
  const own = [...map.buildings, ...map.smalls].find((b) => b.key === key);
  if (own) for (let y = own.ty; y < own.ty + own.th; y++) for (let x = own.tx; x < own.tx + own.tw; x++) occ[y * map.cols + x] = O.FREE;
  // уже стоящие на занятых клетках деревья и обстановка
  for (const d of map.decor) if (occ[d.ty * map.cols + d.tx] === O.FREE && map.blocked[d.ty * map.cols + d.tx]) occ[d.ty * map.cols + d.tx] = O.SMALL;
  const F = { cols: map.cols, rows: map.rows, land: map.land, cx: map.cx, cy: map.cy };
  return fitsOcc(F, occ, map.grid, type, tx, ty, type === 'fountain');
}

/** Ближайшая подходящая клетка к (tx, ty) для объекта: [tx, ty] или null. */
export function nearestPlace(map, type, tx, ty, key = null) {
  const F = { land: map.land };
  if (canPlace(map, type, tx, ty, key)) return [tx, ty];
  for (const [x, y] of spiral(F, tx, ty)) if (canPlace(map, type, x, y, key)) return [x, y];
  return null;
}

/** Место для новой покупки без указанной клетки: относительная позиция { x, y } или null. */
export function suggestPlace(objects, type, opts = {}) {
  const next = [...objects, { key: '__new__', place: type, x: null, y: null }];
  const map = buildMap(next, opts);
  const o = map.buildings.find((b) => b.key === '__new__') || map.smalls.find((b) => b.key === '__new__');
  return o ? { x: o.rx, y: o.ry } : null;
}

export const tileAt = (map, x, y) => {
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  if (tx < 0 || ty < 0 || tx >= map.cols || ty >= map.rows) return -1;
  return map.grid[ty * map.cols + tx];
};

/** Можно ли стоять на тайле (tx, ty). */
export function walkable(map, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= map.cols || ty >= map.rows) return false;
  const i = ty * map.cols + tx;
  return WALKABLE.has(map.grid[i]) && !map.blocked[i];
}

/** Можно ли строить в клетке (свободная трава на земле деревни). */
export const buildable = (map, tx, ty) => tx > map.land.x0 && tx < map.land.x1 && ty > map.land.y0 && ty < map.land.y1 && map.occ[ty * map.cols + tx] === O.FREE && !map.blocked[ty * map.cols + tx];

/** Поиск пути A* по тайлам (4 направления, дорожки дешевле травы). Возвращает массив [tx, ty] без стартового тайла или null. */
export function findPath(map, from, to, limit = 6000) {
  const cols = map.cols;
  const [sx, sy] = from;
  const [gx, gy] = to;
  if (!walkable(map, gx, gy)) return null;
  if (sx === gx && sy === gy) return [];
  const N = cols * map.rows;
  const g = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const open = [];
  const h = (x, y) => Math.abs(x - gx) + Math.abs(y - gy);
  const s = sy * cols + sx;
  g[s] = 0;
  open.push([h(sx, sy), s]);
  let steps = 0;
  while (open.length && steps++ < limit) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
    const [, cur] = open[bi];
    open[bi] = open[open.length - 1];
    open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % cols;
    const cy = (cur / cols) | 0;
    if (cx === gx && cy === gy) {
      const out = [];
      for (let k = cur; k !== s; k = came[k]) out.push([k % cols, (k / cols) | 0]);
      return out.reverse();
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!walkable(map, nx, ny) && !(nx === sx && ny === sy)) continue;
      const ni = ny * cols + nx;
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
  const { land } = map;
  for (let k = 0; k < 40; k++) {
    let tx;
    let ty;
    if (near) {
      tx = Math.floor(near.x / TILE + (rand() - 0.5) * radius * 2);
      ty = Math.floor(near.y / TILE + (rand() - 0.5) * radius * 2);
    } else {
      tx = land.x0 + Math.floor(rand() * land.w);
      ty = land.y0 + Math.floor(rand() * land.h);
    }
    if (walkable(map, tx, ty)) return [tx, ty];
  }
  return [map.cx, map.cy + 1];
}
