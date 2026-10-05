// Мир деревни (обновление 0.7): раскладка построек, рельеф с холмами, жители с простой физикой платформера
// (гравитация, прыжки на уступы, падение со склонов) и поведением: гуляют, общаются, работают в шахтах и мастерской,
// ночью расходятся по домам, радуются выполненным задачам, иногда уходят в лес и подходят к экрану.
//
// Координаты мира — «пиксели» холста низкого разрешения: x вправо, y вверх от базовой линии земли.
// Модуль без DOM: рисование — village/draw.js, холст и клики — ui/components/VillageView.js.

import { villageItem } from '../core/village.js';
import { charHeight } from './puppets.js';

export const GRAVITY = 220;
const TAU = Math.PI * 2;

// ---------- Постройки и раскладка ----------

export const STRUCTS = {
  house: { w: 24, h: 27 },
  house4: { w: 30, h: 34 },
  goldmine: { w: 30, h: 18 },
  gemmine: { w: 30, h: 18 },
  forge: { w: 26, h: 20 },
  windmill: { w: 20, h: 40 },
  tavern: { w: 36, h: 29 },
  tower: { w: 14, h: 46 },
  fountain: { w: 20, h: 10 },
};

const ORDER = [
  ['v:mine-gold', 'goldmine'], ['base:house', 'house'], ['v:house:2', 'house'], ['v:forge', 'forge'], ['v:fountain', 'fountain'],
  ['v:tavern', 'tavern'], ['v:house:3', 'house'], ['v:windmill', 'windmill'], ['v:house:4', 'house4'], ['v:tower', 'tower'], ['v:mine-gem', 'gemmine'],
];

const levelOf = (owned, prefix) => [3, 2, 1].find((n) => owned.has(`${prefix}:${n}`)) || 0;

/**
 * Раскладка: какие постройки стоят и где (слева направо), фонари и декор в промежутках, ширина мира.
 * Детерминирована: одинаковые покупки дают одинаковую деревню на всех устройствах.
 */
export function layoutVillage(owned, legacy = new Set(), viewW = 320) {
  const list = [];
  for (const [id, type] of ORDER) {
    const mine = id.startsWith('v:mine-');
    const level = mine ? levelOf(owned, id) : owned.has(id) ? 1 : 0;
    if (!level) continue;
    list.push({ id: mine ? `${id}:${level}` : id, type, level, ...STRUCTS[type] });
  }
  const edge = 26; // лес по краям
  const minGap = 12;
  const used = list.reduce((s, b) => s + b.w, 0);
  const W = Math.max(Math.round(viewW), used + minGap * (list.length + 1) + edge * 2, 200);
  const gap = (W - edge * 2 - used) / (list.length + 1);
  let x = edge + gap;
  for (const b of list) {
    b.x = Math.round(x);
    b.door = b.x + Math.round(b.w / 2);
    x += b.w + gap;
  }
  // промежутки между постройками (и краями) — места для фонарей и декора
  const gaps = [];
  let prev = edge;
  for (const b of list) {
    gaps.push({ a: prev, b: b.x });
    prev = b.x + b.w;
  }
  gaps.push({ a: prev, b: W - edge });
  const mids = gaps.map((g) => ({ x: Math.round((g.a + g.b) / 2), w: g.b - g.a }));
  const byWidth = [...mids].sort((p, q) => q.w - p.w || p.x - q.x);
  const lanterns = [];
  const nL = [1, 2, 3, 4].filter((n) => owned.has(`v:lantern:${n}`)).length + (legacy.has('prop:lantern') ? 1 : 0);
  for (let i = 0; i < nL; i++) {
    const m = mids[(i * 2 + 1) % mids.length];
    const off = Math.floor(i / mids.length) * 7 - 3;
    lanterns.push({ id: 'lantern:' + i, x: Math.min(W - edge - 2, Math.max(edge + 2, m.x + off + (i % 2 ? 4 : -4))) });
  }
  const decor = [];
  const spot = (k, dx = 0) => {
    const m = byWidth[k % byWidth.length];
    return Math.round(m.x + dx);
  };
  const tavern = list.find((b) => b.type === 'tavern');
  const fountain = list.find((b) => b.type === 'fountain');
  if (owned.has('v:bonfire')) decor.push({ type: 'bonfire', x: tavern ? tavern.x + tavern.w + 8 : spot(0, 6) });
  if (owned.has('v:benches')) decor.push({ type: 'bench', x: fountain ? fountain.x - 9 : spot(1, -6) }, { type: 'bench', x: fountain ? fountain.x + fountain.w + 3 : spot(2, 6) });
  if (owned.has('v:pumpkins')) for (const b of list.filter((q) => q.type.startsWith('house')).slice(0, 3)) decor.push({ type: 'pumpkin', x: b.x - 4 });
  if (legacy.has('prop:mushrooms')) decor.push({ type: 'mushrooms', x: spot(3, -8) });
  if (legacy.has('prop:crystal')) decor.push({ type: 'crystal', x: spot(4, 8) });
  if (legacy.has('prop:pickaxe')) decor.push({ type: 'pickaxe', x: list.find((b) => b.type === 'goldmine')?.x - 6 || spot(5, 0) });
  const archer = owned.has('v:char:archer');
  if (archer) decor.push({ type: 'target', x: W - edge - 6 });
  // деревья позади построек — в широких промежутках
  const trees = [];
  for (const m of mids) {
    const n = Math.floor(m.w / 22);
    for (let i = 0; i < n; i++) trees.push({ x: Math.round(m.x - m.w / 2 + 11 + i * 22 + ((m.x * 7 + i * 13) % 7) - 3), s: (m.x + i * 5) % 3 });
  }
  return { W, buildings: list, lanterns, decor, trees, edge };
}

/** Высоты земли по столбцам: пологие холмы, под постройками — ровные площадки. */
export function makeGround(W, buildings, seed = 0) {
  const g = new Float32Array(W + 1);
  for (let x = 0; x <= W; x++) {
    g[x] = Math.round(3 + 2.2 * Math.sin(x * 0.043 + 0.7 + seed) + 1.4 * Math.sin(x * 0.11 + 2.1 + seed * 2));
  }
  for (const b of buildings) {
    const pad = g[Math.min(W, b.x + (b.w >> 1))];
    b.ground = pad;
    for (let x = Math.max(0, b.x - 3); x <= Math.min(W, b.x + b.w + 3); x++) g[x] = pad;
  }
  // уступы не выше 2 пикселей — чтобы жители запрыгивали, а не упирались
  for (let pass = 0; pass < 2; pass++) {
    for (let x = 1; x <= W; x++) if (g[x] - g[x - 1] > 2) g[x - 1] = g[x] - 2;
    for (let x = W - 1; x >= 0; x--) if (g[x] - g[x + 1] > 2) g[x + 1] = g[x] - 2;
  }
  return g;
}

// ---------- Жители ----------

export const KINDS = {
  wanderer: { speed: 7, human: true },
  miner: { speed: 8, human: true },
  builder: { speed: 8, human: true },
  archer: { speed: 10, human: true },
  witch: { speed: 8, human: true },
  knight: { speed: 6, human: true },
  neko: { speed: 9, human: true },
  cat: { speed: 11, beast: true },
  kitten: { speed: 17, beast: true },
  fox: { speed: 21, beast: true },
  shroom: { speed: 9, hopper: true },
  slime: { speed: 7, hopper: true },
  spider: { speed: 5 },
  ghost: { speed: 7, floater: true },
  dragon: { speed: 9 },
};

export const PHRASES = {
  wanderer: ['Хороший денёк!', 'Куда бы сходить…', 'Привет!', 'Ещё одну задачку?'],
  cat: ['Мяу!', 'Мрр…', 'Мяу?', '*мурчит*'],
  kitten: ['Мя!', 'Догони!', 'Играем?'],
  fox: ['Фыр!', 'Тяв!', 'Что там в норке?'],
  spider: ['Плету-плету…', 'Вишу.', 'Привет сверху!'],
  neko: ['Ня!', 'Ты молодец!', 'План — сила!', 'Не забудь про задачи~'],
  shroom: ['Пуф!', 'Боинг!', 'Я гриб.'],
  slime: ['Плюх!', 'Блоб?', 'Желе-е-е'],
  miner: ['За работу!', 'Ещё глубже!', 'Нашёл самоцвет!'],
  builder: ['Тук-тук!', 'Строим!', 'Почти готово!'],
  archer: ['В яблочко!', 'Тихо…', 'Ветер западный.'],
  witch: ['Хе-хе!', 'Зелье почти готово.', 'Полетаем?'],
  knight: ['К службе готов!', 'Деревня под защитой.', 'Ох, тяжёлые латы.'],
  ghost: ['Бу!', 'У-у-у…', 'Не бойся.'],
  dragon: ['Ррр!', '*пых*', 'Я грозный. Наверное.'],
};
const SAD = ['Скучновато…', 'Задачи копятся…', 'Эх…', 'Сделаешь что-нибудь?'];
const HAPPY = ['Ура!', 'Какой день!', 'Мы растём!', 'Спасибо!'];
const KNOCK = ['Тук-тук!', 'Эй, привет!', 'Как дела?', 'Сделаем задачку?', 'Мы тут!'];

let seq = 0;

function newActor(id, kind, x, u) {
  return {
    id, kind, x, y: 0, vx: 0, vy: 0, dir: Math.random() < 0.5 ? -1 : 1, u, onGround: false, alpha: 1,
    state: 'idle', anim: Math.random() * 10, phase: 0, queue: [], task: null, hidden: false,
    emote: null, emoteT: 0, say: null, sayT: 0, happy: false, squash: 0, fire: false, n: ++seq,
  };
}

/** Жители по покупкам: id предмета → вид персонажа. Базовый — странник. */
export function residentsOf(owned) {
  const out = [{ id: 'base:wanderer', kind: 'wanderer', big: false }];
  for (const id of owned) {
    const it = villageItem(id);
    if (it?.kind === 'char') out.push({ id, kind: it.char, big: !!it.big, name: it.name });
  }
  return out;
}

// ---------- Мир ----------

export class World {
  constructor({ rand = Math.random } = {}) {
    this.rand = rand;
    this.t = 0;
    this.W = 320;
    this.ground = makeGround(320, []);
    this.buildings = [];
    this.lanterns = [];
    this.decor = [];
    this.trees = [];
    this.actors = [];
    this.particles = [];
    this.fireflies = [];
    this.visitor = null;
    this.nextVisit = 60 + rand() * 120;
    this.night = 0;
    this.phase = 0.5;
    this.mood = 50;
    this.focus = false;
    this.visitors = true;
    this.lightsOff = new Set();
    this.mill = 0;
    this.key = '';
    this.legacy = new Set();
    this.owned = new Set();
    this.events = []; // для интерфейса: { type: 'say', actor } и т. п. (не обязательно)
  }

  /** Обновить мир под покупки, ширину экрана и настройки. Жители, что уже гуляют, остаются на местах. */
  configure({ owned, legacy = new Set(), viewW = 320, mood = 50, focus = false, visitors = true, lightsOff = null }) {
    this.mood = mood;
    this.focus = focus;
    this.visitors = visitors;
    if (lightsOff) this.lightsOff = new Set(lightsOff);
    const key = [...owned].sort().join(',') + '|' + [...legacy].sort().join(',') + '|' + Math.round(viewW / 8);
    if (key === this.key) return false;
    this.key = key;
    this.owned = new Set(owned);
    this.legacy = new Set(legacy);
    const L = layoutVillage(owned, legacy, viewW);
    const scale = this.W ? L.W / this.W : 1;
    Object.assign(this, { W: L.W, buildings: L.buildings, lanterns: L.lanterns, decor: L.decor, trees: L.trees, edge: L.edge });
    this.ground = makeGround(L.W, L.buildings);
    const want = residentsOf(owned);
    const keep = new Map(this.actors.map((a) => [a.id, a]));
    this.actors = want.map((r) => {
      const old = keep.get(r.id);
      if (old) {
        if (old.task?.type === 'away') return old; // сейчас у экрана — вернётся сам
        old.x = Math.min(L.W - 2, Math.max(2, old.x * scale));
        old.y = this.groundAt(old.x);
        old.queue = [];
        old.task = null;
        old.thread = null;
        if (old.kind !== 'ghost') {
          old.hidden = false;
          old.alpha = 1;
        }
        return old;
      }
      const a = newActor(r.id, r.kind, 30 + this.rand() * (L.W - 60), r.big ? 2 : 1);
      a.name = r.name || 'Странник';
      a.y = this.groundAt(a.x) + (this.t > 1 ? 30 : 0); // новые после покупки — падают с неба с искрами
      if (this.t > 1) this.burst(a.x, a.y, 'spark', 14);
      return a;
    });
    if (owned.has('v:fireflies') && !this.fireflies.length) {
      for (let i = 0; i < 14; i++) this.fireflies.push({ x: this.rand() * L.W, y: 4 + this.rand() * 18, p: this.rand() * TAU });
    } else if (!owned.has('v:fireflies')) this.fireflies = [];
    for (const f of this.fireflies) f.x = Math.min(f.x, L.W);
    return true;
  }

  groundAt(x) {
    const g = this.ground;
    const i = Math.max(0, Math.min(g.length - 1, Math.round(x)));
    return g[i];
  }

  building(type) {
    return this.buildings.find((b) => b.type === type || b.type.startsWith(type)) || null;
  }

  houses() {
    return this.buildings.filter((b) => b.type === 'house' || b.type === 'house4');
  }

  lightOn(id) {
    return !this.lightsOff.has(id);
  }

  // ---------- События ----------

  say(a, text, sec = 3) {
    a.say = text;
    a.sayT = sec;
  }

  emote(a, kind, sec = 1.6) {
    a.emote = kind;
    a.emoteT = sec;
  }

  pick(arr) {
    return arr[Math.floor(this.rand() * arr.length)];
  }

  burst(x, y, kind, n = 10, spread = 40) {
    for (let i = 0; i < n; i++) {
      const ang = Math.PI / 2 + (this.rand() - 0.5) * 2.2;
      const sp = spread * (0.4 + this.rand() * 0.8);
      this.particles.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 1.2 + this.rand(), kind, c: this.rand() });
    }
    if (this.particles.length > 400) this.particles.splice(0, this.particles.length - 400);
  }

  firework(x, y) {
    for (let i = 0; i < 26; i++) {
      const ang = (i / 26) * TAU;
      const sp = 24 + this.rand() * 10;
      this.particles.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 1.4 + this.rand() * 0.4, kind: 'fw', c: this.rand(), g: 0.25 });
    }
  }

  /** Задача выполнена: все прыгают, монетки из домика; за важную — фейерверк и дракон. */
  celebrate(amount = 5, gems = 0) {
    const home = this.houses()[0];
    if (home) this.burst(home.door, (home.ground || 0) + home.h, 'coin', Math.min(24, 4 + amount));
    if (gems) {
      const mine = this.building('gemmine');
      if (mine) this.burst(mine.x + 8, (mine.ground || 0) + 10, 'gem', Math.min(16, gems * 3));
    }
    for (const a of this.actors) {
      if (a.hidden || a.task?.type === 'away' || a.task?.type === 'leave') continue;
      if (a.state === 'sleep') this.emote(a, '!');
      a.queue = [];
      a.task = { type: 'celebrate', d: 1.6 + this.rand(), jumps: 0 };
      a.happy = true;
      this.emote(a, gems ? 'gem' : amount >= 10 ? 'star' : 'coin', 2);
    }
    if (amount >= 20) {
      for (let i = 0; i < 3; i++) setTimeoutSafe(() => this.firework(30 + this.rand() * (this.W - 60), 40 + this.rand() * 20), i * 450);
      const d = this.actors.find((a) => a.kind === 'dragon');
      if (d) d.task = { type: 'flyhigh', d: 6, t: 0, x0: d.x };
    }
  }

  focusStart() {
    const b = this.actors.find((a) => a.kind === 'builder') || this.actors.find((a) => a.kind === 'wanderer');
    if (b) {
      b.queue = [];
      b.task = null;
      this.say(b, 'Беремся за дело!', 3);
    }
  }

  focusDone(gems = 0) {
    for (let i = 0; i < 4; i++) setTimeoutSafe(() => this.firework(30 + this.rand() * (this.W - 60), 36 + this.rand() * 26), i * 380);
    this.celebrate(10, gems);
  }

  focusFailed() {
    for (const a of this.actors) if (!a.hidden) this.emote(a, 'sad', 2.5);
  }

  /** Клик по жителю: реакция и фраза. */
  poke(a) {
    if (!a) return;
    if (a.state === 'sleep') {
      this.emote(a, '!');
      this.say(a, a.kind === 'cat' ? 'Мрр… ещё пять минут' : 'Зе-е-е… а? Что?', 2.5);
      a.task = { type: 'pose', pose: 'idle', d: 2 };
      a.queue = [];
      return;
    }
    a.queue = [];
    a.task = { type: 'pose', pose: 'wave', d: 1.4 };
    if (a.onGround) {
      a.vy = 70;
      a.onGround = false;
    }
    if (a.kind === 'dragon') {
      a.fire = true;
      this.burst(a.x + a.dir * 10 * a.u, a.y + 8 * a.u, 'fire', 10, 30);
    }
    if (a.kind === 'slime') a.squash = 0.5;
    this.emote(a, this.rand() < 0.6 ? 'heart' : 'note');
    const mood = this.mood < 30 ? SAD : this.mood > 75 ? HAPPY : [];
    this.say(a, this.pick([...(PHRASES[a.kind] || PHRASES.wanderer), ...mood]));
  }

  /** Что под точкой (координаты мира): житель, фонарь, постройка. */
  hit(wx, wy) {
    for (const a of [...this.actors].reverse()) {
      if (a.hidden) continue;
      const h = charHeight(a.kind) * a.u + 3;
      const w = 7 * a.u + 3;
      if (Math.abs(wx - a.x) <= w && wy >= a.y - 2 && wy <= a.y + h) return { type: 'actor', actor: a };
    }
    for (const l of this.lanterns) {
      const g = this.groundAt(l.x);
      if (Math.abs(wx - l.x) <= 3 && wy >= g && wy <= g + 13) return { type: 'lantern', lantern: l };
    }
    for (const b of this.buildings) {
      if (wx >= b.x && wx <= b.x + b.w && wy >= b.ground - 1 && wy <= b.ground + b.h) return { type: 'building', building: b };
    }
    return null;
  }

  toggleLight(id) {
    if (this.lightsOff.has(id)) this.lightsOff.delete(id);
    else this.lightsOff.add(id);
    return [...this.lightsOff];
  }

  // ---------- Шаг симуляции ----------

  /** Шаг мира на dt секунд (большие шаги — по кусочкам до 0,1 с; больше 0,5 с за раз не догоняем). */
  step(dt, opts = {}) {
    let left = Math.min(0.5, Math.max(0, dt));
    do {
      const d = Math.min(0.1, left);
      this.tick(d, opts);
      left -= d;
    } while (left > 1e-6);
  }

  tick(dt, { phase = this.phase, night = this.night, motion = true } = {}) {
    this.t += dt;
    this.phase = phase;
    this.night = night;
    const happy = this.mood >= 65;
    this.mill += dt * (happy ? 2.4 : this.mood >= 35 ? 1.1 : 0.3);
    if (!motion) {
      for (const a of this.actors) {
        a.vx = 0;
        if (!a.task || a.task.type !== 'away') a.y = this.groundAt(a.x);
        a.state = night > 0.65 && !KINDS[a.kind]?.human ? 'sleep' : 'idle';
      }
      return;
    }
    for (const a of this.actors) this.updateActor(a, dt);
    this.updateParticles(dt);
    this.updateFireflies(dt);
    this.updateVisitor(dt);
  }

  updateParticles(dt) {
    const out = [];
    for (const p of this.particles) {
      p.life -= dt;
      if (p.life <= 0) continue;
      const g = p.g ?? (p.kind === 'smoke' || p.kind === 'spark' || p.kind === 'fire' ? -0.1 : 1);
      p.vy -= GRAVITY * 0.5 * g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'smoke') p.vx += Math.sin(this.t + p.c * 6) * dt * 4;
      const gy = this.groundAt(p.x);
      if ((p.kind === 'coin' || p.kind === 'gem' || p.kind === 'drop' || p.kind === 'dirt') && p.y < gy) {
        if (p.kind === 'drop' || p.kind === 'dirt') continue;
        p.y = gy;
        p.vy = Math.abs(p.vy) * 0.35;
        p.vx *= 0.6;
      }
      out.push(p);
    }
    this.particles = out;
    // фоновые частицы: дым кузни, костра, брызги фонтана
    const forge = this.building('forge');
    if (forge && this.rand() < dt * (this.focus ? 3 : 0.8)) this.particles.push({ x: forge.x + forge.w - 5, y: forge.ground + forge.h + 2, vx: 0, vy: 6, life: 2.5, kind: 'smoke', c: this.rand() });
    const fountain = this.building('fountain');
    if (fountain && this.rand() < dt * 14) this.particles.push({ x: fountain.x + 10, y: fountain.ground + 10, vx: (this.rand() - 0.5) * 14, vy: 22 + this.rand() * 6, life: 1.2, kind: 'drop', c: 0 });
    const fire = this.decor.find((d) => d.type === 'bonfire');
    if (fire && this.rand() < dt * 5) this.particles.push({ x: fire.x + (this.rand() - 0.5) * 3, y: this.groundAt(fire.x) + 4, vx: (this.rand() - 0.5) * 4, vy: 10, life: 1, kind: 'spark', c: this.rand() });
    for (const h of this.houses()) {
      if (this.night > 0.5 && this.rand() < dt * 0.4) this.particles.push({ x: h.x + h.w - 6, y: h.ground + h.h + 1, vx: 0, vy: 5, life: 2.2, kind: 'smoke', c: this.rand() });
    }
  }

  updateFireflies(dt) {
    if (!this.fireflies.length) return;
    for (const f of this.fireflies) {
      f.p += dt;
      f.x += Math.sin(f.p * 0.7 + f.y) * dt * 6;
      f.y += Math.cos(f.p * 1.1) * dt * 3;
      if (f.x < 4) f.x = this.W - 6;
      if (f.x > this.W - 4) f.x = 6;
      f.y = Math.max(this.groundAt(f.x) + 3, Math.min(this.groundAt(f.x) + 26, f.y));
    }
  }

  // ---------- Поведение ----------

  think(a) {
    const r = this.rand();
    const k = a.kind;
    const night = this.night;
    const homes = this.houses();
    const W = this.W;
    const near = (x, d = 40) => Math.max(10, Math.min(W - 10, x + (this.rand() - 0.5) * d));
    const q = a.queue;
    // призрак — только ночью
    if (k === 'ghost') {
      if (night < 0.45) return q.push({ type: 'pose', pose: 'idle', d: 3, ghostHide: true });
      return q.push({ type: 'float', tx: near(a.x, 120), d: 5 + r * 4 });
    }
    if (k === 'witch' && night > 0.55 && r < 0.7) return q.push({ type: 'broom', d: 10 + r * 8, x0: a.x });
    if (k === 'spider') {
      const h = homes[Math.floor(r * homes.length)] || null;
      if (r < 0.55 && h) {
        const hx = h.x + (r < 0.3 ? 2 : h.w - 3);
        return q.push({ type: 'walk', x: hx }, { type: 'hang', b: h, hx, d: 3 + r * 6 });
      }
    }
    // ночь: люди по домам, звери спят
    if (night > 0.68) {
      if (k === 'cat') {
        const l = this.lanterns.find((x) => this.lightOn(x.id));
        if (l) return q.push({ type: 'walk', x: l.x + 4 }, { type: 'pose', pose: 'sleep', d: 20 });
      }
      if (KINDS[k]?.human && homes.length && k !== 'witch' && k !== 'knight') {
        const h = homes[a.n % homes.length];
        const fire = this.decor.find((d) => d.type === 'bonfire');
        if (fire && r < 0.25) return q.push({ type: 'walk', x: fire.x + (a.n % 2 ? 7 : -7) }, { type: 'pose', pose: 'sit', d: 12, face: fire.x });
        return q.push({ type: 'walk', x: h.door }, { type: 'inside', b: h, d: 25 + r * 30 });
      }
      if (k === 'knight') return q.push({ type: 'walk', x: near(a.x, 100) }, { type: 'pose', pose: 'idle', d: 6 });
      return q.push({ type: 'pose', pose: 'sleep', d: 15 + r * 10 });
    }
    // сумерки: кот и котёнок охотятся на светлячков
    if ((k === 'cat' || k === 'kitten') && this.fireflies.length && night > 0.2 && r < 0.45) {
      const f = this.fireflies[Math.floor(this.rand() * this.fireflies.length)];
      return q.push({ type: 'walk', x: Math.max(8, Math.min(W - 8, f.x)), run: true }, { type: 'pounce', emote: 'heart' });
    }
    // вечер: таверна и костёр
    if (night > 0.3 && r < 0.3) {
      const tavern = this.building('tavern');
      const fire = this.decor.find((d) => d.type === 'bonfire');
      if (fire && KINDS[k]?.human) return q.push({ type: 'walk', x: fire.x + (a.n % 2 ? 8 : -8) }, { type: 'pose', pose: r < 0.15 ? 'dance' : 'sit', d: 8, face: fire.x });
      if (tavern && KINDS[k]?.human) return q.push({ type: 'walk', x: tavern.door }, { type: 'inside', b: tavern, d: 10 + r * 10 });
    }
    // фокус-сессия: строитель (или странник) работает в мастерской
    if (this.focus && (k === 'builder' || (k === 'wanderer' && !this.actors.some((x) => x.kind === 'builder')))) {
      const f = this.building('forge') || homes[0];
      return q.push({ type: 'walk', x: f.x + 6 }, { type: 'work', d: 10, sparks: true, face: f.x + f.w });
    }
    // настроение низкое — грустят
    if (this.mood < 25 && r < 0.25) return q.push({ type: 'pose', pose: 'sit', d: 5, emote: 'sad' });
    const pr = this.rand();
    if (pr < 0.22) {
      // профессия / особенность
      if (k === 'miner') {
        const mines = this.buildings.filter((b) => b.type.endsWith('mine'));
        const m = mines[Math.floor(r * mines.length)];
        if (m) return q.push({ type: 'walk', x: m.x + 9 }, { type: 'inside', b: m, d: 6 + r * 6, loot: m.type === 'gemmine' ? 'gem' : 'coin' });
        return q.push({ type: 'work', d: 4, face: a.x + 5 });
      }
      if (k === 'builder') {
        const h = homes[Math.floor(r * homes.length)] || this.buildings[0];
        if (h) return q.push({ type: 'walk', x: h.x - 3 }, { type: 'work', d: 5, sparks: true, face: h.x + 5 });
      }
      if (k === 'archer') {
        const t = this.decor.find((d) => d.type === 'target');
        if (t) return q.push({ type: 'walk', x: t.x - 34 }, { type: 'shoot', d: 4, tx: t.x, shots: 0 });
      }
      if (k === 'fox') return q.push({ type: 'walk', x: near(a.x, 80), run: true }, { type: 'dig', d: 3 });
      if (k === 'kitten' || k === 'neko' || k === 'cat') {
        const other = this.nearest(a, 120);
        if (other && (k === 'kitten' || r < 0.4)) return q.push({ type: 'chase', who: other, d: 5 });
      }
      if (k === 'dragon' && r < 0.6) return q.push({ type: 'flyhigh', d: 7, t: 0, x0: a.x });
      if (k === 'knight') return q.push({ type: 'walk', x: 20 }, { type: 'pose', pose: 'idle', d: 2 }, { type: 'walk', x: W - 20 });
      if (k === 'neko') return q.push({ type: 'pose', pose: 'wave', d: 2.5, say: 'Привет-привет!' });
    }
    if (pr < 0.4) {
      const other = this.nearest(a, 70);
      if (other && !other.hidden && other.task?.type !== 'greet' && !KINDS[other.kind]?.floater) {
        const side = a.x < other.x ? -1 : 1;
        const meet = other.x + side * (6 + 4 * Math.max(a.u, other.u));
        q.push({ type: 'walk', x: meet }, { type: 'greet', who: other, d: 3 });
        return;
      }
    }
    if (pr < 0.55 && KINDS[k]?.hopper) return q.push({ type: 'hops', x: near(a.x, 90) });
    if (pr < 0.62) {
      const bench = this.decor.find((d) => d.type === 'bench');
      if (bench && KINDS[k]?.human) return q.push({ type: 'walk', x: bench.x + 3 }, { type: 'pose', pose: 'sit', d: 5 + r * 5 });
    }
    if (pr < 0.75) return q.push({ type: 'pose', pose: KINDS[k]?.beast && r < 0.5 ? 'sit' : 'idle', d: 2 + r * 4 });
    q.push({ type: 'walk', x: near(a.x, 140), run: k === 'kitten' && r < 0.5 });
  }

  nearest(a, maxD) {
    let best = null;
    let bd = maxD;
    for (const o of this.actors) {
      if (o === a || o.hidden || o.task?.type === 'away' || o.task?.type === 'inside') continue;
      const d = Math.abs(o.x - a.x);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  updateActor(a, dt) {
    a.anim += dt;
    if (a.emoteT > 0 && (a.emoteT -= dt) <= 0) a.emote = null;
    if (a.sayT > 0 && (a.sayT -= dt) <= 0) a.say = null;
    if (a.squash > 0) a.squash = Math.max(0, a.squash - dt * 2);
    if (!a.task) {
      if (!a.queue.length) this.think(a);
      a.task = a.queue.shift() || { type: 'pose', pose: 'idle', d: 1 };
      a.task.t = 0;
      if (a.task.say) this.say(a, a.task.say);
      if (a.task.emote) this.emote(a, a.task.emote, 2.5);
    }
    const T = a.task;
    T.t = (T.t || 0) + dt;
    const kind = KINDS[a.kind] || KINDS.wanderer;
    const slow = this.mood < 25 ? 0.7 : 1;
    const speed = kind.speed * slow * (a.u > 1 ? 1.4 : 1);
    let move = 0;
    let state = 'idle';
    let flying = false;
    let done = false;
    a.fire = false;
    switch (T.type) {
      case 'walk': {
        const d = T.x - a.x;
        if (Math.abs(d) < 1.5) done = true;
        else {
          a.dir = Math.sign(d);
          move = a.dir * speed * (T.run ? 1.8 : 1);
          state = T.run ? 'run' : 'walk';
          if (KINDS[a.kind]?.hopper && a.onGround) {
            a.vy = 48;
            a.onGround = false;
          }
        }
        if (T.t > 40) done = true;
        break;
      }
      case 'hops': {
        const d = T.x - a.x;
        if (Math.abs(d) < 2) done = true;
        else {
          a.dir = Math.sign(d);
          if (a.onGround) {
            if ((T.wait = (T.wait || 0) + dt) > 0.35) {
              a.vy = 55 + this.rand() * 20;
              a.onGround = false;
              T.wait = 0;
              a.squash = 0;
            } else a.squash = 0.6;
          } else move = a.dir * speed * 1.4;
          state = a.onGround ? 'idle' : 'jump';
        }
        if (T.t > 30) done = true;
        break;
      }
      case 'pose':
        state = T.pose;
        if (T.face != null) a.dir = T.face > a.x ? 1 : -1;
        if (T.ghostHide) a.alpha = Math.max(0, a.alpha - dt);
        if (T.t > T.d) done = true;
        break;
      case 'greet': {
        const o = T.who;
        if (!o || o.hidden) {
          done = true;
          break;
        }
        a.dir = o.x > a.x ? 1 : -1;
        state = T.t < 1.2 ? 'wave' : 'idle';
        if (T.t < dt * 1.5) {
          this.emote(a, this.rand() < 0.5 ? 'heart' : 'note', 2);
          if (this.rand() < 0.6) this.say(a, this.pick(['Привет!', 'Как ты?', 'Хорошо выглядишь!', 'Пойдём гулять?', ...(this.mood < 30 ? SAD : [])]), 2.4);
          if (!o.task || ['walk', 'pose'].includes(o.task.type)) {
            o.queue = [];
            o.task = { type: 'pose', pose: 'wave', d: 2.4, face: a.x, t: 0 };
            setTimeoutSafe(() => this.say(o, this.pick(['Привет!', 'Отлично!', 'Давай!', 'Ага!'])), 900);
          }
        }
        if (T.t > T.d) done = true;
        break;
      }
      case 'chase': {
        const o = T.who;
        if (!o || o.hidden || T.t > T.d) {
          done = true;
          break;
        }
        const d = o.x - a.x;
        a.dir = Math.sign(d) || a.dir;
        if (Math.abs(d) > 5 * a.u) {
          move = a.dir * speed * 1.7;
          state = 'run';
        } else if (a.onGround) {
          a.vy = 60;
          a.onGround = false;
          this.emote(a, 'heart', 1);
          if (o.task?.type !== 'flee' && o.onGround && !KINDS[o.kind]?.floater) {
            o.queue = [];
            o.task = { type: 'flee', from: a, d: 2, t: 0 };
          }
          done = true;
        }
        break;
      }
      case 'flee': {
        a.dir = a.x > T.from.x ? 1 : -1;
        if ((a.x < 12 && a.dir < 0) || (a.x > this.W - 12 && a.dir > 0)) a.dir = -a.dir;
        move = a.dir * speed * 1.8;
        state = 'run';
        if (T.t < dt * 1.5) this.emote(a, '!', 1.2);
        if (T.t > T.d) done = true;
        break;
      }
      case 'inside': {
        // зашёл в дом / шахту / таверну
        if (T.t < 0.4) a.alpha = Math.max(0, 1 - T.t / 0.4);
        else a.hidden = true;
        const morning = T.b.type.startsWith('house') && this.night > 0.6;
        if (T.t > T.d && !(morning && T.t < 200)) {
          a.hidden = false;
          a.alpha = 1;
          if (T.loot) {
            this.burst(a.x, a.y + 10, T.loot, 5, 25);
            this.emote(a, T.loot, 2);
            this.say(a, T.loot === 'gem' ? 'Изумруд!' : 'Золото!', 2);
          }
          done = true;
        }
        if (this.night < 0.6 && T.b.type.startsWith('house') && T.t > 4) T.d = Math.min(T.d, T.t);
        state = 'idle';
        break;
      }
      case 'work':
        state = 'work';
        if (T.face != null) a.dir = T.face > a.x ? 1 : -1;
        if (T.sparks && Math.floor(a.anim * 4) !== Math.floor((a.anim - dt) * 4) && Math.floor(a.anim * 4) % 2 === 0) {
          this.burst(a.x + a.dir * 5 * a.u, a.y + 4 * a.u, 'spark', 3, 18);
        }
        if (T.t > T.d && !(this.focus && T.sparks && a.kind !== 'miner')) done = true;
        if (!this.focus && T.sparks && T.t > T.d) done = true;
        break;
      case 'shoot':
        state = 'work';
        a.dir = T.tx > a.x ? 1 : -1;
        if (T.t > 0.8 * (T.shots + 1) && T.shots < 3) {
          T.shots++;
          this.particles.push({ x: a.x + a.dir * 4, y: a.y + 9, vx: a.dir * 60, vy: 6, life: (Math.abs(T.tx - a.x) - 4) / 60, kind: 'arrow', c: a.dir, g: 0.05 });
          if (T.shots === 3) setTimeoutSafe(() => this.say(a, this.pick(['В яблочко!', 'Почти…', 'Ещё разок!'])), 600);
        }
        if (T.t > T.d) done = true;
        break;
      case 'pounce':
        // прыжок на месте (за светлячком, от радости)
        if (!T.jumped && a.onGround) {
          a.vy = 75;
          a.onGround = false;
          T.jumped = true;
        }
        state = 'jump';
        if (T.jumped && a.onGround && T.t > 0.2) done = true;
        if (T.t > 3) done = true;
        break;
      case 'dig':
        state = 'work';
        if (this.rand() < dt * 10) this.particles.push({ x: a.x + a.dir * 3, y: a.y + 1, vx: -a.dir * (10 + this.rand() * 15), vy: 20 + this.rand() * 15, life: 1, kind: 'dirt', c: this.rand() });
        if (T.t > T.d) done = true;
        break;
      case 'celebrate':
        state = a.onGround ? 'dance' : 'jump';
        if (a.onGround && T.jumps < 3 && T.t > T.jumps * 0.5) {
          a.vy = 60 + this.rand() * 20;
          a.onGround = false;
          T.jumps++;
        }
        if (T.t > T.d) {
          done = true;
          a.happy = this.mood >= 50;
        }
        break;
      case 'hang': {
        // паучок забирается по стене под карниз и спускается на паутинке
        flying = true;
        const top = T.b.ground + T.b.h - 6;
        const g0 = this.groundAt(T.hx);
        a.x = T.hx;
        if (!T.st) {
          T.st = 'climb';
          T.y = a.y;
        }
        if (T.st === 'climb') {
          T.y += dt * 8;
          a.thread = null;
          if (T.y >= top) {
            T.y = top;
            T.st = 'hang';
            T.t0 = T.t;
          }
        } else {
          const k = T.t - T.t0;
          const mid = top - (top - g0) * 0.5;
          if (k < 3) T.y = top - (top - mid) * (k / 3);
          else if (k < 3 + T.d) T.y = mid + Math.sin((k - 3) * 1.5);
          else T.y = Math.max(g0, T.y - dt * 6);
          a.thread = top;
          if (k > 3 + T.d && T.y <= g0 + 0.01) {
            a.thread = null;
            a.onGround = true;
            done = true;
          }
        }
        a.y = T.y;
        state = 'idle';
        break;
      }
      case 'float': {
        flying = true;
        a.alpha = Math.min(0.85, a.alpha + dt);
        const d = T.tx - a.x;
        a.dir = Math.sign(d) || a.dir;
        a.x += Math.sign(d) * Math.min(Math.abs(d), speed * dt);
        a.y = this.groundAt(a.x) + 14 + Math.sin(a.anim * 2) * 4;
        state = 'idle';
        if (T.t > T.d) done = true;
        break;
      }
      case 'broom': {
        flying = true;
        const r = Math.min(80, this.W / 2 - 20);
        const ang = T.t * 0.5;
        const nx = T.x0 + Math.sin(ang) * r;
        a.dir = Math.cos(ang) >= 0 ? 1 : -1;
        a.x = Math.max(8, Math.min(this.W - 8, nx));
        const air = Math.min(1, T.t / 1.5, (T.d - T.t) / 1.5);
        a.y = this.groundAt(a.x) + Math.max(0, air) * (34 + Math.sin(T.t * 1.7) * 6);
        state = a.y - this.groundAt(a.x) > 2 ? 'fly' : 'idle';
        if (this.rand() < dt * 6 && state === 'fly') this.particles.push({ x: a.x - a.dir * 8, y: a.y + 1, vx: -a.dir * 4, vy: 0, life: 0.8, kind: 'star', c: this.rand(), g: 0.1 });
        if (T.t > T.d) {
          a.onGround = false;
          a.vy = 0;
          done = true;
        }
        break;
      }
      case 'flyhigh': {
        flying = true;
        const air = Math.max(0, Math.min(1, T.t / 1.2, (T.d - T.t) / 1.2));
        a.dir = Math.cos(T.t * 0.9) >= 0 ? 1 : -1;
        a.x = Math.max(12, Math.min(this.W - 12, T.x0 + Math.sin(T.t * 0.9) * 50));
        a.y = this.groundAt(a.x) + air * (30 + Math.sin(T.t * 2) * 5);
        state = air > 0.05 ? 'fly' : 'idle';
        if (air > 0.8 && this.rand() < dt * 1.5) {
          a.fire = true;
          this.burst(a.x + a.dir * 10 * a.u, a.y + 8 * a.u, 'fire', 8, 30);
        }
        if (T.t > T.d) {
          a.onGround = false;
          a.vy = 0;
          done = true;
        }
        break;
      }
      case 'leave': {
        const tx = T.side < 0 ? -12 : this.W + 12;
        a.dir = T.side;
        move = a.dir * speed * 1.2;
        state = 'walk';
        if ((T.side < 0 && a.x <= tx + 2) || (T.side > 0 && a.x >= tx - 2)) {
          a.hidden = true;
          a.task = { type: 'away', t: 0, side: T.side };
          this.visitor = { actor: a, kind: a.kind, u: a.u, side: T.side, t: 0, stage: 'in', x: 0, state: 'walk', dir: -T.side, knocks: 0, say: null, sayT: 0, emote: null, emoteT: 0, y: 0, vy: 0, ripples: [] };
          return;
        }
        if (T.t > 60) done = true;
        break;
      }
      case 'away':
        state = 'idle';
        if (!this.visitor || this.visitor.actor !== a) {
          a.hidden = false;
          a.alpha = 1;
          a.x = T.side < 0 ? -6 : this.W + 6;
          a.queue = [{ type: 'walk', x: T.side < 0 ? 30 : this.W - 30 }];
          done = true;
        }
        break;
      default:
        done = true;
    }
    if (done) a.task = null;
    if (a.kind === 'ghost') a.hidden = a.alpha <= 0.02;
    // физика
    if (flying || KINDS[a.kind]?.floater) {
      a.onGround = false;
      a.state = state;
      a.phase = (a.anim * 1.6) % 1;
      return;
    }
    a.vx = move;
    if (move) a.x += move * dt;
    if (a.task?.type !== 'leave' && a.task?.type !== 'away') a.x = Math.max(4, Math.min(this.W - 4, a.x));
    const g = this.groundAt(a.x);
    const ahead = this.groundAt(a.x + a.dir * 3);
    if (a.onGround) {
      if (move && ahead - a.y >= 2) {
        a.vy = 40; // уступ — запрыгиваем
        a.onGround = false;
      } else if (g < a.y - 0.6) a.onGround = false;
      else a.y = g;
    }
    if (!a.onGround) {
      a.vy -= GRAVITY * dt;
      a.y += a.vy * dt;
      if (a.y <= g && a.vy <= 0) {
        if (a.vy < -60) {
          if (a.u > 1) this.burst(a.x, g, 'dust', 6, 14);
          if (a.kind === 'slime' || a.kind === 'shroom') a.squash = 0.7;
        }
        a.y = g;
        a.vy = 0;
        a.onGround = true;
      }
    }
    a.state = !a.onGround && !['celebrate'].includes(T.type) ? 'jump' : state;
    if (!a.onGround && T.type === 'celebrate') a.state = 'jump';
    a.phase = (a.phase + (dt * Math.abs(move)) / (6 * a.u)) % 1;
  }

  // ---------- Гость у экрана ----------

  /** Отправить жителя к экрану (через лес). Можно вызвать вручную; иначе — само раз в несколько минут. */
  sendVisitor(who = null) {
    if (this.visitor || this.actors.some((x) => x.task?.type === 'leave')) return false;
    const pool = this.actors.filter((a) => !a.hidden && !['inside', 'leave', 'away'].includes(a.task?.type)
      && a.kind !== 'ghost' && a.kind !== 'spider');
    if (!pool.length) return false;
    const a = who && pool.includes(who) ? who : this.pick(pool.filter((x) => x.onGround).length ? pool.filter((x) => x.onGround) : pool);
    const side = a.x < this.W / 2 ? -1 : 1;
    a.queue = [];
    a.task = { type: 'leave', side, t: 0 };
    if (this.rand() < 0.5) this.say(a, 'Схожу проведаю!', 2.5);
    return true;
  }

  updateVisitor(dt) {
    if (!this.visitor) {
      if (!this.visitors) return;
      this.nextVisit -= dt;
      if (this.nextVisit <= 0) {
        this.nextVisit = 150 + this.rand() * 210;
        this.sendVisitor();
      }
      return;
    }
    const v = this.visitor;
    v.t += dt;
    v.anim = (v.anim || 0) + dt;
    if (v.sayT > 0 && (v.sayT -= dt) <= 0) v.say = null;
    if (v.emoteT > 0 && (v.emoteT -= dt) <= 0) v.emote = null;
    for (const r of v.ripples) r.t += dt;
    v.ripples = v.ripples.filter((r) => r.t < 0.9);
    // вертикаль: прыжки
    if (v.y > 0 || v.vy > 0) {
      v.vy -= GRAVITY * 1.4 * dt;
      v.y = Math.max(0, v.y + v.vy * dt);
      if (v.y === 0) v.vy = 0;
    }
    const sp = 0.32; // доля ширины в секунду
    if (v.stage === 'in') {
      v.state = 'walk';
      v.x = Math.min(1, v.x + dt * sp * 1.6);
      v.phase = (v.anim * 1.8) % 1;
      if (v.x >= 1) {
        v.stage = 'look';
        v.t = 0;
      }
    } else if (v.stage === 'look') {
      v.state = 'idle';
      if (v.t > 1.2) {
        v.stage = 'knock';
        v.t = 0;
        v.say = this.pick(this.mood < 30 ? ['Тук-тук… Мы скучаем', 'Эй! Задачки ждут', ...KNOCK] : KNOCK);
        v.sayT = 3;
      }
    } else if (v.stage === 'knock') {
      v.state = 'knock';
      const k = Math.floor(v.t * 2.5);
      if (k > v.knocks && k <= 3) {
        v.knocks = k;
        v.ripples.push({ t: 0 });
      }
      if (v.t > 1.8) {
        v.stage = 'wave';
        v.t = 0;
      }
    } else if (v.stage === 'wave') {
      v.state = 'wave';
      if (v.t > (v.stay || 1.6)) {
        v.stage = 'out';
        v.t = 0;
        v.dir = -v.dir;
      }
    } else if (v.stage === 'out') {
      v.state = 'walk';
      v.phase = (v.anim * 1.8) % 1;
      v.x -= dt * sp * 1.6;
      if (v.x <= 0) this.visitor = null;
    } else if (v.stage === 'poked') {
      v.state = v.y > 0 ? 'jump' : 'wave';
      if (v.t > 1.8) {
        v.stage = 'wave';
        v.t = 0;
        v.stay = 1.2;
      }
    }
  }

  /** Клик по гостю у экрана. */
  pokeVisitor() {
    const v = this.visitor;
    if (!v || v.stage === 'out') return;
    v.stage = 'poked';
    v.t = 0;
    v.vy = 90;
    v.emote = this.rand() < 0.6 ? 'heart' : 'star';
    v.emoteT = 1.8;
    v.say = this.pick([...(PHRASES[v.kind] || PHRASES.wanderer), 'Хи-хи!', 'Ой!']);
    v.sayT = 2.4;
  }
}

/** setTimeout, который не ломает тесты без таймеров. */
function setTimeoutSafe(fn, ms) {
  if (typeof setTimeout === 'function') setTimeout(fn, ms);
  else fn();
}
