// Мир деревни (обновление 0.7): раскладка, рельеф, физика жителей, гость у экрана, отрисовка всех стилей.

import { test, assert } from './runner.js';
import { World, layoutVillage, makeGround, residentsOf } from '../src/village/world.js';
import { drawVillage, drawVisitor, skyColors } from '../src/village/draw.js';
import { VILLAGE_ITEMS, VILLAGE_STYLES, BASE_VILLAGE, nightness } from '../src/core/village.js';

const ALL = new Set([...BASE_VILLAGE, ...VILLAGE_ITEMS.map((x) => x.id)]);
const LEGACY = new Set(['scene:web', 'scene:stars', 'prop:lantern', 'prop:mushrooms', 'prop:crystal', 'prop:pickaxe']);

function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

test('раскладка: постройки не налезают друг на друга, детерминирована, фонари по покупкам', () => {
  const base = layoutVillage(new Set(BASE_VILLAGE), new Set(), 300);
  assert.equal(base.buildings.length, 1);
  assert.equal(base.lanterns.length, 0);
  const a = layoutVillage(ALL, LEGACY, 300);
  const b = layoutVillage(new Set([...ALL].reverse()), LEGACY, 300);
  assert.deepEqual(a.buildings.map((x) => [x.id, x.x]), b.buildings.map((x) => [x.id, x.x]));
  assert.equal(a.lanterns.length, 5, '4 фонаря + фонарь странника из 0.6');
  const sorted = [...a.buildings].sort((p, q) => p.x - q.x);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].x >= sorted[i - 1].x + sorted[i - 1].w, 'наложение ' + sorted[i].id);
  assert.ok(sorted.at(-1).x + sorted.at(-1).w <= a.W, 'в пределах мира');
  // уровни шахт — одна постройка с максимальным уровнем
  assert.equal(a.buildings.filter((x) => x.type === 'goldmine').length, 1);
  assert.equal(a.buildings.find((x) => x.type === 'goldmine').level, 3);
  assert.ok(a.W > 300, 'большая деревня шире экрана — её можно листать');
});

test('рельеф: уступы не выше 2 пикселей, под постройками ровно', () => {
  const L = layoutVillage(ALL, new Set(), 400);
  const g = makeGround(L.W, L.buildings);
  for (let x = 1; x < g.length; x++) assert.ok(Math.abs(g[x] - g[x - 1]) <= 2, `x=${x}`);
  for (const b of L.buildings) for (let x = b.x; x <= b.x + b.w; x++) assert.equal(g[x], b.ground, b.id);
});

test('жители: по покупкам, старые питомцы 0.6 — тоже жители', () => {
  const r = residentsOf(new Set([...BASE_VILLAGE, 'pet:cat', 'v:char:dragon', 'v:house:2']));
  assert.deepEqual(r.map((x) => x.kind), ['wanderer', 'cat', 'dragon']);
  assert.ok(r.find((x) => x.kind === 'dragon').big);
});

test('физика: жители ходят по земле, не проваливаются, не улетают; день и ночь без ошибок', () => {
  const w = new World({ rand: seeded(7) });
  w.configure({ owned: ALL, legacy: LEGACY, viewW: 320, mood: 60, visitors: true });
  const night = (phase) => nightness(phase);
  let visits = 0;
  for (let i = 0; i < 6000; i++) {
    const phase = ((i / 6000) * 2 + 0.3) % 1; // два полных дня
    w.step(0.05, { phase, night: night(phase) });
    if (w.visitor && w.visitor.t === 0.05) visits++;
    if (i === 1500) w.celebrate(20, 2);
    if (i === 2000) w.sendVisitor();
    for (const a of w.actors) {
      assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y), `${a.kind} NaN на шаге ${i}`);
      assert.ok(a.x > -30 && a.x < w.W + 30, `${a.kind} ушёл за край: ${a.x}`);
      if (a.onGround) assert.ok(Math.abs(a.y - w.groundAt(a.x)) < 0.01, `${a.kind} не на земле`);
      else if (!a.hidden) assert.ok(a.y >= w.groundAt(a.x) - 0.01 || a.vy > 0 || a.thread != null, `${a.kind} под землёй`);
    }
  }
  assert.ok(w.particles.length < 400);
  assert.ok(!w.actors.some((a) => a.task?.type === 'away' && !w.visitor), 'гость вернулся в деревню');
});

test('праздник: жители подпрыгивают, из домика летят монеты, изумрудная шахта — изумруды', () => {
  const w = new World({ rand: seeded(3) });
  w.configure({ owned: new Set([...BASE_VILLAGE, 'pet:cat', 'v:mine-gem:1']), viewW: 300, mood: 50 });
  for (let i = 0; i < 40; i++) w.step(0.05, { phase: 0.5, night: 0 });
  w.celebrate(12, 2);
  assert.ok(w.particles.some((p) => p.kind === 'coin') && w.particles.some((p) => p.kind === 'gem'));
  w.step(0.05, { phase: 0.5, night: 0 });
  w.step(0.05, { phase: 0.5, night: 0 });
  assert.ok(w.actors.some((a) => !a.onGround), 'кто-то в прыжке');
});

test('клик: житель реагирует, гость у экрана проходит весь путь и уходит', () => {
  const w = new World({ rand: seeded(5) });
  w.configure({ owned: new Set([...BASE_VILLAGE, 'pet:fox']), viewW: 240, mood: 80 });
  for (let i = 0; i < 20; i++) w.step(0.05, { phase: 0.5, night: 0 });
  const fox = w.actors.find((a) => a.kind === 'fox');
  const h = w.hit(fox.x, fox.y + 3);
  assert.equal(h?.actor, fox);
  w.poke(fox);
  assert.ok(fox.say && fox.emote);
  assert.ok(w.sendVisitor(fox));
  let seen = false;
  for (let i = 0; i < 2000 && !(seen && !w.visitor); i++) {
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
});

test('отрисовка: все стили днём, в сумерках и ночью рисуются без ошибок; ночью земля темнее', () => {
  const w = new World({ rand: seeded(9) });
  w.configure({ owned: ALL, legacy: LEGACY, viewW: 200, mood: 20, focus: true });
  for (let i = 0; i < 30; i++) w.step(0.05, { phase: 0.5, night: 0 });
  w.celebrate(25, 3);
  w.sendVisitor();
  for (let i = 0; i < 200; i++) w.step(0.05, { phase: 0.5, night: 0 });
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = 200;
    c.height = 90;
    return c;
  };
  const main = mk();
  const land = mk();
  const ctx = main.getContext('2d');
  const lctx = land.getContext('2d');
  const lum = (phase, style) => {
    drawVillage(ctx, lctx, w, { W: 200, H: 90, camX: 10, baseY: 84, horizon: 69, phase, n: nightness(phase), style, letter: '#f2a900', mode: 'full' });
    const d = ctx.getImageData(0, 80, 200, 4).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
    return s;
  };
  for (const st of Object.values(VILLAGE_STYLES)) {
    const day = lum(0.5, st);
    lum(0.27, st);
    const night = lum(0, st);
    assert.ok(night < day, `${st.name}: ночь темнее дня`);
  }
  const vc = document.createElement('canvas');
  vc.width = 30;
  vc.height = 40;
  if (w.visitor) assert.ok(drawVisitor(vc.getContext('2d'), w, { W: 30, H: 40, u: 1, n: 0, style: VILLAGE_STYLES.lime }));
  const s = skyColors('gothic', 0);
  assert.ok(/^#[0-9a-f]{6}$/.test(s.top) && /^#[0-9a-f]{6}$/.test(s.bottom));
});
