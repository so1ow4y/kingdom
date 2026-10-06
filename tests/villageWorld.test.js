// Мир деревни (обновление 0.7, вид сверху — 0.7.1, свободная расстановка и рост — 0.7.2): карта, проходимость
// и поиск пути, расстановка и рост земли, жители, гость у экрана, отрисовка.

import { test, assert } from './runner.js';
import { World, residentsOf } from '../src/village/world.js';
import { buildMap, findPath, walkable, canPlace, nearestPlace, suggestPlace, buildable, landSize, TILE, T } from '../src/village/map.js';
import { VillageRenderer, drawVisitor } from '../src/village/draw.js';
import { VILLAGE_ITEMS, VILLAGE_STYLES, BASE_VILLAGE, nightness } from '../src/core/village.js';

const CHARS = VILLAGE_ITEMS.filter((x) => x.kind === 'char').map((x) => x.id);
const OWNED = new Set([...BASE_VILLAGE, ...CHARS, 'v:fireflies', 'v:aurora', 'v:flowers', 'v:daynight']);
const LEGACY = new Set(['scene:web', 'scene:stars', 'prop:lantern', 'prop:mushrooms', 'prop:crystal', 'prop:pickaxe']);
const FLYING = new Set(['broom', 'float', 'flyhigh', 'climb', 'held', 'fall']);
const KINDS_HUMAN = new Set(['wanderer', 'keeper', 'miner', 'builder', 'archer', 'neko']);

const obj = (key, place, extra = {}) => ({ key, itemId: 'v:' + place, place, level: 1, x: null, y: null, ...extra });
/** Всё, что можно поставить, + повторы. */
const ALL = [
  obj('h1', 'house'), obj('h2', 'house'), obj('h3', 'house'), obj('m1', 'manor'),
  obj('gm', 'goldmine', { itemId: 'v:mine-gold:1', level: 2 }), obj('em', 'gemmine', { itemId: 'v:mine-gem:1' }),
  obj('fo', 'forge'), obj('wi', 'windmill'), obj('ta', 'tavern'), obj('to', 'tower'), obj('fn', 'fountain'),
  obj('f1', 'field'), obj('f2', 'field'), obj('l1', 'lantern'), obj('l2', 'lantern'), obj('l3', 'lantern'),
  obj('b1', 'bench'), obj('b2', 'bench'), obj('p1', 'pumpkin'), obj('fb', 'flowerbed'), obj('tr', 'tree'), obj('bo', 'bonfire'),
];

function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const tileOf = (x, y) => [Math.floor(x / TILE), Math.floor(y / TILE)];
const things = (m) => [...m.buildings, ...m.smalls];

function noOverlap(m, label) {
  const list = things(m);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      const cross = a.tx < b.tx + b.tw && b.tx < a.tx + a.tw && a.ty < b.ty + b.th && b.ty < a.ty + a.th;
      assert.ok(!cross, `${label}: ${a.key} и ${b.key} пересекаются`);
    }
  }
}

test('карта: всё расставлено без пересечений, к каждой двери можно дойти с площади, река — только по мосту', () => {
  for (const flavor of ['classic', 'sea', 'gothic']) {
    const m = buildMap(ALL, { flavor, legacy: LEGACY });
    assert.equal(things(m).length, ALL.length + 1, `${flavor}: всё на месте (и дом старосты)`);
    noOverlap(m, flavor);
    const plaza = tileOf(m.spots.plaza.x, m.spots.plaza.y);
    for (const b of m.buildings) {
      if (b.place === 'fountain' || b.place === 'field') continue;
      const d = tileOf(b.door.x, b.door.y);
      assert.ok(walkable(m, d[0], d[1]), `${flavor}: перед дверью ${b.key} можно стоять`);
      assert.ok(findPath(m, plaza, d), `${flavor}: путь к ${b.key}`);
    }
    for (const s of m.smalls) {
      assert.ok(s.tx > m.land.x0 && s.tx < m.land.x1 && s.ty > m.land.y0 && s.ty < m.land.y1, `${flavor}: ${s.key} на земле деревни`);
    }
    const exit = tileOf(m.spots.southExit.x, m.spots.southExit.y);
    assert.ok(findPath(m, plaza, exit), `${flavor}: тропинка к экрану`);
    for (let ty = m.cliffY + 3; ty < m.land.y1; ty++) {
      const river = m.grid[ty * m.cols + m.river.x];
      assert.ok(river === T.WATER || river === T.BRIDGE, 'река на месте');
      if (river === T.WATER) assert.ok(!walkable(m, m.river.x, ty), 'по воде не ходят');
    }
    assert.ok(walkable(m, m.river.x + 1, m.road), 'мост проходим');
    assert.ok(m.buildings.filter((b) => b.place === 'field').every((b) => m.grid[b.ty * m.cols + b.tx] === T.FIELD), 'под огородом грядки');
  }
  assert.equal(buildMap(ALL, {}).key, buildMap(ALL.map((o) => ({ ...o })), {}).key, 'одинаковые данные — одинаковая деревня');
  const base = buildMap([], {});
  assert.equal(base.buildings.length, 1);
  assert.ok(base.buildings[0].fixed, 'дом старосты не переставляется');
  assert.ok(base.decor.some((d) => d.type === 'well'), 'без фонтана на площади колодец');
  const fountain = buildMap([obj('fn', 'fountain')], {});
  assert.ok(!fountain.decor.some((d) => d.type === 'well'), 'фонтан встаёт посреди площади');
});

test('рост: домов больше, чем помещается, — земля расширяется, и всё по-прежнему без пересечений', () => {
  const few = buildMap([obj('h1', 'house')], {});
  const many = [];
  for (let i = 0; i < 40; i++) many.push(obj('h' + i, 'house'));
  for (let i = 0; i < 6; i++) many.push(obj('f' + i, 'field'));
  const big = buildMap(many, {});
  assert.ok(big.L > few.L, `уровень земли вырос: ${few.L} → ${big.L}`);
  assert.ok(big.land.w > few.land.w && big.land.h > few.land.h);
  assert.equal(big.land.w, landSize(big.L).w);
  assert.equal(things(big).length, many.length + 1, 'все 40 домов и 6 огородов на месте');
  noOverlap(big, 'большая деревня');
  const plaza = tileOf(big.spots.plaza.x, big.spots.plaza.y);
  for (const b of big.buildings) {
    if (b.place === 'field') continue;
    assert.ok(findPath(big, plaza, tileOf(b.door.x, b.door.y), 20000), `путь к ${b.key}`);
  }
  // свободное место остаётся всегда — чтобы было где строить прямо в деревне
  let free = 0;
  for (let ty = big.land.y0; ty <= big.land.y1; ty++) for (let tx = big.land.x0; tx <= big.land.x1; tx++) if (buildable(big, tx, ty)) free++;
  assert.ok(free > 20, 'есть свободные клетки');
});

test('расстановка: место из данных соблюдается, при конфликте — ближайшее свободное; перестановка и подсказка места', () => {
  const m0 = buildMap([], {});
  const a = buildMap([obj('h1', 'house', { x: 6, y: -6 })], {});
  const h = a.buildings.find((b) => b.key === 'h1');
  assert.deepEqual([h.rx, h.ry], [6, -6], 'стоит там, где сказано');
  assert.equal(h.tx, a.cx + 6);
  const b = buildMap([obj('h1', 'house', { x: 6, y: -6 }), obj('h2', 'house', { x: 6, y: -6 })], {});
  const h1 = b.buildings.find((x) => x.key === 'h1');
  const h2 = b.buildings.find((x) => x.key === 'h2');
  assert.deepEqual([h1.rx, h1.ry], [6, -6], 'первый по времени покупки остаётся на месте');
  assert.ok(h2 && (h2.rx !== 6 || h2.ry !== -6), 'второй — рядом');
  noOverlap(b, 'конфликт');
  // место далеко от площади — земля растёт, чтобы оно поместилось
  const far = buildMap([obj('l1', 'lantern', { x: 30, y: 2 })], {});
  assert.ok(far.L > m0.L);
  assert.deepEqual([far.smalls[0].rx, far.smalls[0].ry], [30, 2]);
  // canPlace: занято / свободно / сам на себе
  assert.ok(!canPlace(a, 'house', h.tx, h.ty), 'поверх дома нельзя');
  assert.ok(canPlace(a, 'house', h.tx, h.ty, 'h1'), 'на своё же место — можно');
  assert.ok(!canPlace(a, 'lantern', a.cx, a.cy), 'на площадь — нельзя');
  const near = nearestPlace(a, 'house', h.tx, h.ty);
  assert.ok(near && canPlace(a, 'house', near[0], near[1]));
  // подсказка места для новой покупки совпадает с тем, куда объект встанет
  const pos = suggestPlace([obj('h1', 'house', { x: 6, y: -6 })], 'forge');
  const c = buildMap([obj('h1', 'house', { x: 6, y: -6 }), obj('fo', 'forge', pos)], {});
  const fo = c.buildings.find((x) => x.key === 'fo');
  assert.deepEqual([fo.rx, fo.ry], [pos.x, pos.y]);
  // карта не меньше экрана, площадь — в середине, позиции относительно площади не меняются
  const wide = buildMap([obj('h1', 'house', { x: 6, y: -6 })], { minCols: 200, minRows: 150 });
  assert.ok(wide.cols >= 200 && wide.rows >= 150);
  const hw = wide.buildings.find((x) => x.key === 'h1');
  assert.deepEqual([hw.rx, hw.ry], [6, -6]);
});

test('поиск пути: дорожки дешевле травы, через постройки не проходит', () => {
  const m = buildMap(ALL, {});
  const from = tileOf(m.spots.westEnd.x, m.spots.westEnd.y);
  const to = tileOf(m.spots.eastEnd.x, m.spots.eastEnd.y);
  const path = findPath(m, from, to);
  assert.ok(path && path.length >= to[0] - from[0]);
  const onRoad = path.filter(([x, y]) => m.grid[y * m.cols + x] === T.PATH || m.grid[y * m.cols + x] === T.PLAZA).length;
  assert.ok(onRoad / path.length > 0.9, 'идут по улице');
  for (const [x, y] of path) assert.ok(walkable(m, x, y));
  const home = m.buildings[0];
  assert.equal(findPath(m, from, [home.tx + 1, home.ty + 1]), null, 'внутрь дома пути нет');
});

test('жители: по покупкам, старые питомцы 0.6 — тоже жители', () => {
  const r = residentsOf(new Set([...BASE_VILLAGE, 'pet:cat', 'v:char:dragon', 'v:house:2']));
  assert.deepEqual(r.map((x) => x.kind), ['wanderer', 'cat', 'dragon']);
  assert.ok(r.find((x) => x.kind === 'dragon').big);
});

test('физика: жители ходят только по проходимым тайлам, прыгают и приземляются; день и ночь без ошибок', () => {
  const w = new World({ rand: seeded(7) });
  w.configure({ owned: OWNED, objects: ALL, legacy: LEGACY, flavor: 'classic', mood: 60, visitors: true });
  let jumped = false;
  for (let i = 0; i < 6000; i++) {
    const phase = ((i / 6000) * 2 + 0.3) % 1; // два полных дня
    w.step(0.05, { phase, night: nightness(phase) });
    if (i === 1500) w.celebrate(20, 2);
    if (i === 2000) w.sendVisitor();
    if (i === 3000) w.configure({ owned: OWNED, objects: [...ALL, obj('h9', 'house')], legacy: LEGACY, flavor: 'classic', mood: 60, visitors: true });
    for (const a of w.actors) {
      assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z), `${a.kind} NaN на шаге ${i}`);
      assert.ok(a.z >= 0, `${a.kind} под землёй`);
      if (a.z > 0) jumped = true;
      if (a.hidden || a.z > 0 || FLYING.has(a.task?.type)) continue;
      const [tx, ty] = tileOf(a.x, a.y);
      assert.ok(walkable(w.map, tx, ty), `${a.kind} стоит на непроходимом тайле (${tx}, ${ty}), задача ${a.task?.type}`);
    }
  }
  assert.ok(jumped, 'кто-то прыгал');
  assert.ok(w.particles.length <= 500);
});

test('карта выросла или экран стал больше — жители сдвигаются вместе с площадью', () => {
  const w = new World({ rand: seeded(11) });
  w.configure({ owned: new Set([...BASE_VILLAGE, 'pet:cat']), objects: [], mood: 50 });
  for (let i = 0; i < 20; i++) w.step(0.05, { phase: 0.5, night: 0 });
  const cat = w.actors.find((a) => a.kind === 'cat');
  const rel = [cat.x - w.map.spots.plaza.x, cat.y - w.map.spots.plaza.y];
  w.configure({ owned: new Set([...BASE_VILLAGE, 'pet:cat']), objects: [], mood: 50, minCols: 220, minRows: 160 });
  assert.ok(w.shift && (w.shift.dx || w.shift.dy), 'сдвиг для камеры');
  assert.ok(Math.abs(cat.x - w.map.spots.plaza.x - rel[0]) < TILE && Math.abs(cat.y - w.map.spots.plaza.y - rel[1]) < TILE * 2, 'кот там же относительно площади');
});

test('праздник: жители подпрыгивают, из домика летят монеты, изумрудная шахта — изумруды', () => {
  const w = new World({ rand: seeded(3) });
  w.configure({ owned: new Set([...BASE_VILLAGE, 'pet:cat', 'v:mine-gem:1']), objects: [obj('em', 'gemmine', { itemId: 'v:mine-gem:1' })], mood: 50 });
  for (let i = 0; i < 40; i++) w.step(0.05, { phase: 0.5, night: 0 });
  w.celebrate(12, 2);
  assert.ok(w.particles.some((p) => p.kind === 'coin') && w.particles.some((p) => p.kind === 'gem'));
  w.step(0.05, { phase: 0.5, night: 0 });
  w.step(0.05, { phase: 0.5, night: 0 });
  assert.ok(w.actors.some((a) => a.z > 0), 'кто-то в прыжке');
});

test('клик: житель реагирует; гость уходит по тропинке к экрану и возвращается; дом, фонарь, пустая клетка', () => {
  const w = new World({ rand: seeded(5) });
  w.configure({ owned: new Set([...BASE_VILLAGE, 'pet:fox']), objects: [obj('l1', 'lantern', { x: 6, y: 5 })], mood: 80 });
  for (let i = 0; i < 20; i++) w.step(0.05, { phase: 0.5, night: 0 });
  const fox = w.actors.find((a) => a.kind === 'fox');
  fox.task = { type: 'pose', pose: 'idle', d: 99, t: 0 };
  fox.queue = [];
  const h = w.hit(fox.x, fox.y - 3);
  assert.equal(h?.actor, fox);
  w.poke(fox);
  assert.ok(fox.say && fox.emote);
  for (let i = 0; i < 30; i++) w.step(0.05, { phase: 0.5, night: 0 });
  assert.ok(w.sendVisitor(fox));
  let seen = false;
  for (let i = 0; i < 4000 && !(seen && !w.visitor); i++) {
    w.step(0.05, { phase: 0.5, night: 0 });
    if (w.visitor) {
      seen = true;
      if (w.visitor.stage === 'knock') w.pokeVisitor();
    }
  }
  assert.ok(seen, 'гость подошёл к экрану');
  assert.equal(w.visitor, null, 'и ушёл');
  for (let i = 0; i < 400; i++) w.step(0.05, { phase: 0.5, night: 0 });
  assert.ok(!fox.hidden, 'лиса вернулась в деревню');
  const house = w.buildings[0];
  assert.equal(w.hit(house.x + house.w / 2, house.base - 20)?.building, house, 'по дому тоже можно нажать');
  const l = w.lanterns[0];
  assert.equal(w.hit(l.x, l.y - 10)?.lantern, l, 'и по фонарю');
  assert.equal(l.id, 'l1', 'свет фонаря помнится по id покупки');
  const m = w.map;
  let free = null;
  for (let ty = m.land.y0 + 2; ty < m.land.y1 && !free; ty++) for (let tx = m.land.x0 + 2; tx < m.land.x1 && !free; tx++) if (buildable(m, tx, ty) && buildable(m, tx, ty - 1) && buildable(m, tx, ty + 1)) free = [tx, ty];
  const t = w.hit((free[0] + 0.5) * TILE, (free[1] + 0.5) * TILE);
  assert.deepEqual(t && [t.type, t.tx, t.ty], ['tile', free[0], free[1]], 'пустая клетка — можно строить');
});

test('отрисовка: все стили днём, в сумерках и ночью рисуются без ошибок; ночью темнее; перестановка и выбор', () => {
  const main = document.createElement('canvas');
  main.width = 260;
  main.height = 200;
  const ctx = main.getContext('2d');
  const renderer = new VillageRenderer();
  for (const [key, st] of Object.entries(VILLAGE_STYLES)) {
    const w = new World({ rand: seeded(9) });
    const flavor = st.gothic ? 'gothic' : st.meadow ? 'meadow' : st.sea ? 'sea' : st.autumn ? 'autumn' : 'classic';
    w.configure({ owned: OWNED, objects: ALL, legacy: LEGACY, flavor, mood: 20, focus: true });
    for (let i = 0; i < 30; i++) w.step(0.05, { phase: 0.5, night: 0 });
    w.celebrate(25, 3);
    const p = w.map.spots.plaza;
    const view = { W: 260, H: 200, camX: p.x - 130, camY: p.y - 110, style: st, letter: '#f2a900' };
    const lum = (phase) => {
      renderer.render(ctx, w, { ...view, phase, n: nightness(phase) });
      const d = ctx.getImageData(0, 0, 260, 200).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 16) s += d[i] + d[i + 1] + d[i + 2];
      return s;
    };
    const day = lum(0.5);
    lum(0.27);
    const night = lum(0);
    assert.ok(night < day * (st.gothic ? 0.95 : 0.8), `${key}: ночь темнее дня`);
    // переставляемый объект («призрак»), выбранная клетка, стрелка над выбранным
    const mine = w.buildings.find((b) => b.place === 'gemmine');
    renderer.render(ctx, w, {
      ...view, phase: 0.5, n: 0, marks: [{ tx: w.map.cx, ty: w.map.cy, kind: 'tile' }], pointer: { x: p.x, y: p.y - 30 },
      ghost: { key: mine.key, place: 'gemmine', tw: mine.tw, th: mine.th, tx: w.map.cx + 2, ty: w.map.cy + 2, ok: false },
    });
    for (const s of w.smalls) renderer.render(ctx, w, { ...view, phase: 0, n: 1, ghost: { key: s.key, place: s.place, tw: s.tw, th: s.th, tx: s.tx + 1, ty: s.ty, ok: true } });
    w.sendVisitor();
    for (let i = 0; i < 400 && !w.visitor; i++) w.step(0.05, { phase: 0.5, night: 0 });
    const vc = document.createElement('canvas');
    vc.width = 30;
    vc.height = 40;
    if (w.visitor) assert.ok(drawVisitor(vc.getContext('2d'), w, { W: 30, H: 40, u: w.visitor.u, n: 0, style: st }));
  }
});

test('0.9: в экран стучат только хранители с делами; «рука» и падение; дом, свет и пробуждение; дела у объектов', async () => {
  const { LOOKS } = await import('../src/village/chibi.js');
  const w = new World({ rand: seeded(21) });
  const keepers = (alertA, alertB) => [
    { id: 'keeper:a', listId: 'a', listName: 'Универ', name: 'Сора', gender: 'f', look: { ...LOOKS.neko, ears: false }, alert: alertA },
    { id: 'keeper:b', listId: 'b', listName: 'Дом', name: 'Рэн', gender: 'm', look: { ...LOOKS.wanderer }, alert: alertB },
  ];
  const cfg = (a, b) => ({ owned: new Set([...BASE_VILLAGE, 'pet:cat']), objects: [obj('fi', 'field')], keepers: keepers(a, b), mood: 60, visitors: true });
  w.configure(cfg(2, 0));
  for (let i = 0; i < 20; i++) w.step(0.05, { phase: 0.5, night: 0 });
  assert.ok(w.sendVisitor(null, true));
  assert.equal(w.actors.find((a) => a.task?.type === 'leave').name, 'Сора', 'пошла та, у кого дела');
  const sora = w.actors.find((a) => a.name === 'Сора');
  sora.task = null;
  w.configure(cfg(0, 0));
  assert.equal(w.sendVisitor(null, true), false, 'без дел сами не стучат');
  assert.ok(w.sendVisitor(), '«Позвать» — кто угодно');
  for (const a of w.actors) if (a.task?.type === 'leave') a.task = null;
  // «рука»: взять, подержать, отпустить — падает и встаёт на проходимую клетку
  const ren = w.actors.find((a) => a.name === 'Рэн');
  assert.ok(w.grab(ren));
  w.holdAt(ren, w.map.spots.plaza.x + 40, w.map.spots.plaza.y - 30);
  assert.ok(ren.held && ren.z === 14);
  for (let i = 0; i < 5; i++) w.step(0.05, { phase: 0.5, night: 0 });
  assert.equal(ren.state, 'held');
  w.drop(ren);
  for (let i = 0; i < 40; i++) w.step(0.05, { phase: 0.5, night: 0 });
  assert.equal(ren.z, 0);
  assert.ok(walkable(w.map, ...tileOf(ren.x, ren.y)), 'приземлился на проходимое');
  // дом: ночью все уходят, свет горит, потом гаснет; нажали — выбежали
  const home = w.houses()[0];
  assert.ok(w.residentsOf(home).length >= 3, 'у каждого свой дом');
  let wasLit = false;
  for (let i = 0; i < 1500; i++) {
    w.step(0.1, { phase: 0.02, night: 1 });
    if (w.buildingLit(home)) wasLit = true;
  }
  const people = w.residentsOf(home).filter((a) => KINDS_HUMAN.has(a.kind));
  assert.ok(people.every((a) => a.hidden), 'все люди дома');
  assert.ok(wasLit, 'пока укладывались — свет горел');
  assert.ok(!w.buildingLit(home), 'все легли — свет погас');
  assert.ok(w.disturb(home) >= people.length, 'потревожили — выбежали');
  assert.ok(people.every((a) => !a.hidden));
  // днём — дела у объектов: котик, огород, колодец, пруд, лес
  const seen = new Set();
  for (let i = 0; i < 8000 && seen.size < 4; i++) {
    w.step(0.1, { phase: 0.5, night: 0 });
    for (const a of w.actors) if (a.task?.type === 'chore') seen.add(a.task.act);
  }
  assert.ok(seen.size >= 4, 'разные дела: ' + [...seen].join(', '));
  // нажатия на окружение
  const well = w.decor.find((d) => d.type === 'well');
  assert.equal(w.hit(well.x, well.y - 6)?.what, 'well');
  const pond = w.map.pond;
  const water = w.hit((pond.x + 2.5) * TILE, (pond.y + 1.5) * TILE);
  assert.equal(water?.what, 'water');
  w.touchScenery(water);
  assert.ok(w.particles.some((p) => p.kind === 'drop'));
});

test('0.9: звери и портреты 96 × 96 рисуются во всех позах и головных уборах', async () => {
  const { critterSprite } = await import('../src/village/critters.js');
  const { drawPortrait96, N } = await import('../src/village/portrait96.js');
  const { LOOKS } = await import('../src/village/chibi.js');
  const painted = (cv) => {
    const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] > 0) n++;
    return n;
  };
  for (const kind of ['cat', 'kitten', 'fox', 'slime', 'shroom', 'ghost', 'spider', 'dragon']) {
    for (const state of ['idle', 'walk', 'run', 'sit', 'sleep', 'jump', 'held', 'fall', 'fly', 'work']) {
      for (const frame of [0, 1, 3]) {
        const n = painted(critterSprite(kind, { state, frame, happy: frame === 1, squash: false, fire: kind === 'dragon' }, frame ? -1 : 1).cv);
        assert.ok(n > 60, `${kind} ${state}: ${n}`);
      }
    }
  }
  const hats = ['bow', 'gradcap', 'bandana', 'beret', 'headphones', 'headband', 'nursecap', 'straw', 'helmet', 'hardhat', 'hood', 'witch', 'helmetK', null];
  const styles = ['short', 'spiky', 'messy', 'bob', 'long', 'twintails', 'ponytail', 'bun', 'side'];
  const cv = document.createElement('canvas');
  cv.width = N;
  cv.height = N;
  hats.forEach((hat, i) => {
    const look = { ...LOOKS.neko, hat, ears: i === 0, style: styles[i % styles.length], gender: i % 2 ? 'm' : 'f', glasses: i % 3 === 0, stage: i % 5, tie: i === 4, apron: i === 5 };
    for (const e of ['neutral', 'smile', 'grin', 'surprised', 'sad', 'blush', 'closed']) {
      const c = cv.getContext('2d');
      c.clearRect(0, 0, N, N);
      drawPortrait96(c, look, e);
      assert.ok(painted(cv) > 3000, `портрет ${hat} ${e}`);
    }
  });
});