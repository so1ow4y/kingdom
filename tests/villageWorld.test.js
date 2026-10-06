// Мир деревни (обновление 0.7, вид сверху — 0.7.1): карта, проходимость и поиск пути, жители, гость у экрана, отрисовка.

import { test, assert } from './runner.js';
import { World, residentsOf } from '../src/village/world.js';
import { buildMap, findPath, walkable, TILE, T, LOTS } from '../src/village/map.js';
import { VillageRenderer, drawVisitor } from '../src/village/draw.js';
import { VILLAGE_ITEMS, VILLAGE_STYLES, BASE_VILLAGE, nightness } from '../src/core/village.js';

const ALL = new Set([...BASE_VILLAGE, ...VILLAGE_ITEMS.map((x) => x.id)]);
const LEGACY = new Set(['scene:web', 'scene:stars', 'prop:lantern', 'prop:mushrooms', 'prop:crystal', 'prop:pickaxe']);
const FLYING = new Set(['broom', 'float', 'flyhigh', 'climb']);

function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const tileOf = (x, y) => [Math.floor(x / TILE), Math.floor(y / TILE)];

test('карта: участки не пересекаются, к каждой двери можно дойти с площади, река — только по мосту', () => {
  for (let i = 0; i < LOTS.length; i++) {
    for (let j = i + 1; j < LOTS.length; j++) {
      const a = LOTS[i];
      const b = LOTS[j];
      const cross = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      assert.ok(!cross, `${a.key} и ${b.key} пересекаются`);
    }
  }
  for (const flavor of ['classic', 'sea', 'gothic']) {
    const m = buildMap(ALL, LEGACY, flavor);
    assert.equal(m.buildings.length, LOTS.length, 'все постройки на месте');
    const plaza = tileOf(m.spots.plaza.x, m.spots.plaza.y);
    for (const b of m.buildings) {
      const d = tileOf(b.door.x, b.door.y);
      assert.ok(walkable(m, d[0], d[1]), `${flavor}: перед дверью ${b.id} можно стоять`);
      assert.ok(findPath(m, plaza, d), `${flavor}: путь к ${b.id}`);
    }
    const exit = tileOf(m.spots.southExit.x, m.spots.southExit.y);
    assert.ok(findPath(m, plaza, exit), `${flavor}: тропинка к экрану`);
    for (let ty = 8; ty < 28; ty++) {
      const river = m.grid[ty * m.cols + m.river.x];
      assert.ok(river === T.WATER || river === T.BRIDGE, 'река на месте');
      if (river === T.WATER) assert.ok(!walkable(m, m.river.x, ty), 'по воде не ходят');
    }
    assert.ok(walkable(m, m.river.x + 1, 19), 'мост проходим');
  }
  const a = buildMap(ALL, LEGACY, 'classic');
  const b = buildMap(new Set([...ALL].reverse()), LEGACY, 'classic');
  assert.equal(a.key, b.key, 'раскладка не зависит от порядка покупок');
  const base = buildMap(new Set(BASE_VILLAGE), new Set(), 'classic');
  assert.equal(base.buildings.length, 1);
  assert.ok(base.decor.some((d) => d.type === 'well'), 'без фонтана на площади колодец');
  assert.ok(!base.fields, 'поля появляются вместе с мельницей');
});

test('поиск пути: дорожки дешевле травы, через постройки не проходит', () => {
  const m = buildMap(ALL, LEGACY, 'classic');
  const path = findPath(m, [4, 12], [37, 12]);
  assert.ok(path && path.length >= 33);
  const onRoad = path.filter(([x, y]) => m.grid[y * m.cols + x] === T.PATH || m.grid[y * m.cols + x] === T.PLAZA).length;
  assert.ok(onRoad / path.length > 0.9, 'идут по улице');
  for (const [x, y] of path) assert.ok(walkable(m, x, y));
  assert.equal(findPath(m, [4, 12], [5, 10]), null, 'внутрь дома пути нет');
});

test('жители: по покупкам, старые питомцы 0.6 — тоже жители', () => {
  const r = residentsOf(new Set([...BASE_VILLAGE, 'pet:cat', 'v:char:dragon', 'v:house:2']));
  assert.deepEqual(r.map((x) => x.kind), ['wanderer', 'cat', 'dragon']);
  assert.ok(r.find((x) => x.kind === 'dragon').big);
});

test('физика: жители ходят только по проходимым тайлам, прыгают и приземляются; день и ночь без ошибок', () => {
  const w = new World({ rand: seeded(7) });
  w.configure({ owned: ALL, legacy: LEGACY, flavor: 'classic', mood: 60, visitors: true });
  let jumped = false;
  for (let i = 0; i < 6000; i++) {
    const phase = ((i / 6000) * 2 + 0.3) % 1; // два полных дня
    w.step(0.05, { phase, night: nightness(phase) });
    if (i === 1500) w.celebrate(20, 2);
    if (i === 2000) w.sendVisitor();
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

test('праздник: жители подпрыгивают, из домика летят монеты, изумрудная шахта — изумруды', () => {
  const w = new World({ rand: seeded(3) });
  w.configure({ owned: new Set([...BASE_VILLAGE, 'pet:cat', 'v:mine-gem:1']), mood: 50 });
  for (let i = 0; i < 40; i++) w.step(0.05, { phase: 0.5, night: 0 });
  w.celebrate(12, 2);
  assert.ok(w.particles.some((p) => p.kind === 'coin') && w.particles.some((p) => p.kind === 'gem'));
  w.step(0.05, { phase: 0.5, night: 0 });
  w.step(0.05, { phase: 0.5, night: 0 });
  assert.ok(w.actors.some((a) => a.z > 0), 'кто-то в прыжке');
});

test('клик: житель реагирует; гость уходит по тропинке к экрану и возвращается', () => {
  const w = new World({ rand: seeded(5) });
  w.configure({ owned: new Set([...BASE_VILLAGE, 'pet:fox']), mood: 80 });
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
});

test('отрисовка: все стили днём, в сумерках и ночью рисуются без ошибок; ночью темнее', () => {
  const main = document.createElement('canvas');
  main.width = 260;
  main.height = 200;
  const ctx = main.getContext('2d');
  const renderer = new VillageRenderer();
  for (const [key, st] of Object.entries(VILLAGE_STYLES)) {
    const w = new World({ rand: seeded(9) });
    const flavor = st.gothic ? 'gothic' : st.meadow ? 'meadow' : st.sea ? 'sea' : st.autumn ? 'autumn' : 'classic';
    w.configure({ owned: ALL, legacy: LEGACY, flavor, mood: 20, focus: true });
    for (let i = 0; i < 30; i++) w.step(0.05, { phase: 0.5, night: 0 });
    w.celebrate(25, 3);
    const lum = (phase) => {
      renderer.render(ctx, w, { W: 260, H: 200, camX: 140, camY: 80, phase, n: nightness(phase), style: st, letter: '#f2a900' });
      const d = ctx.getImageData(0, 0, 260, 200).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 16) s += d[i] + d[i + 1] + d[i + 2];
      return s;
    };
    const day = lum(0.5);
    lum(0.27);
    const night = lum(0);
    assert.ok(night < day * (st.gothic ? 0.95 : 0.8), `${key}: ночь темнее дня`);
    w.sendVisitor();
    for (let i = 0; i < 400 && !w.visitor; i++) w.step(0.05, { phase: 0.5, night: 0 });
    const vc = document.createElement('canvas');
    vc.width = 30;
    vc.height = 40;
    if (w.visitor) assert.ok(drawVisitor(vc.getContext('2d'), w, { W: 30, H: 40, u: 1, n: 0, style: st }));
  }
});
