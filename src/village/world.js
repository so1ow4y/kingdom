// Мир деревни (обновление 0.7, вид сверху — 0.7.1): карта на тайлах (village/map.js), жители ходят по ней,
// находя путь A* (дорожки предпочитают траве), прыгают и подпрыгивают с тенью (высота z и гравитация), здороваются,
// догоняют друг друга, работают в шахтах и мастерской, вечером собираются у костра и в таверне, ночью расходятся
// по домам, радуются выполненным задачам, иногда уходят по тропинке в лес — к экрану.
//
// Координаты — пиксели карты: x вправо, y вниз (по земле), z — высота над землёй. Без DOM.

import { villageItem } from '../core/village.js';
import { charHeight } from './puppets.js';
import { buildMap, findPath, walkable, randomSpot, buildable, TILE } from './map.js';

export const GRAVITY = 260;
const TAU = Math.PI * 2;

// Высота спрайтов построек над нижним краем основания — для попадания кликом и дыма из труб.
export const SPRITE_H = { house: 60, house4: 78, forge: 52, tavern: 72, tower: 96, windmill: 86, fountain: 34, goldmine: 40, gemmine: 40, field: 40 };
const CHIMNEY = { house: [0.74, 54], house4: [0.78, 72], tavern: [0.8, 66], forge: [0.82, 54] };

export const KINDS = {
  wanderer: { speed: 15, human: true },
  miner: { speed: 16, human: true },
  builder: { speed: 16, human: true },
  archer: { speed: 18, human: true },
  witch: { speed: 16, human: true },
  knight: { speed: 12, human: true },
  neko: { speed: 17, human: true },
  keeper: { speed: 16, human: true }, // хранитель навыка списка (0.8, village/keepers.js)
  cat: { speed: 20, beast: true },
  kitten: { speed: 28, beast: true },
  fox: { speed: 32, beast: true },
  shroom: { speed: 15, hopper: true },
  slime: { speed: 12, hopper: true },
  spider: { speed: 11 },
  ghost: { speed: 12, floater: true },
  dragon: { speed: 17 },
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
  keeper: ['Сделаем ещё задачку?', 'Я тренируюсь!', 'Уровень растёт!', 'Привет!', 'Как продвигается?'],
};
const SAD = ['Скучновато…', 'Задачи копятся…', 'Эх…', 'Сделаешь что-нибудь?'];
const HAPPY = ['Ура!', 'Какой день!', 'Мы растём!', 'Спасибо!'];
const KNOCK = ['Тук-тук!', 'Эй, привет!', 'Как дела?', 'Сделаем задачку?', 'Мы тут!'];

let seq = 0;

function newActor(id, kind, x, y, u) {
  return {
    id, kind, x, y, z: 0, vz: 0, dir: Math.random() < 0.5 ? -1 : 1, u, alpha: 1,
    state: 'idle', anim: Math.random() * 10, phase: 0, path: null, queue: [], task: null, hidden: false,
    emote: null, emoteT: 0, say: null, sayT: 0, happy: false, squash: 0, fire: false, thread: null,
    ox: (Math.random() - 0.5) * 6, oy: (Math.random() - 0.5) * 4, n: ++seq,
  };
}

/** Жители по покупкам: id предмета → вид персонажа. Базовый — странник. keepers — хранители списков (0.8). */
export function residentsOf(owned, keepers = []) {
  const out = [{ id: 'base:wanderer', kind: 'wanderer', big: false }];
  for (const id of owned) {
    const it = villageItem(id);
    if (it?.kind === 'char') out.push({ id, kind: it.char, big: !!it.big, name: it.name });
  }
  for (const k of keepers) if (k) out.push({ id: k.id, kind: 'keeper', big: false, name: k.name, look: k.look, listId: k.listId, listName: k.listName, gender: k.gender });
  return out;
}



export class World {
  constructor({ rand = Math.random } = {}) {
    this.rand = rand;
    this.t = 0;
    this.map = buildMap([], {});
    this.W = this.map.cols * TILE;
    this.H = this.map.rows * TILE;
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
    this.shift = null; // сдвиг карты после перестройки — камера сдвигается так же (VillageView)
    this.legacy = new Set();
    this.owned = new Set();
    this.flavor = 'classic';
  }

  get buildings() {
    return this.map.buildings;
  }

  get lanterns() {
    return this.map.lanterns;
  }

  get decor() {
    return this.map.decor;
  }

  get trees() {
    return this.map.trees;
  }

  get smalls() {
    return this.map.smalls;
  }

  tileOf(x, y) {
    return [Math.max(0, Math.min(this.map.cols - 1, Math.floor(x / TILE))), Math.max(0, Math.min(this.map.rows - 1, Math.floor(y / TILE)))];
  }

  /**
   * Обновить мир под покупки, расстановку и стиль. Жители, что уже гуляют, остаются на местах (если место ещё проходимо).
   * objects — из core/village.js villageObjects; minCols/minRows — карта не меньше видимой области при отдалении.
   */
  configure({ owned, objects = [], keepers = [], legacy = new Set(), flavor = 'classic', minCols = 0, minRows = 0, mood = 50, focus = false, visitors = true, lightsOff = null }) {
    this.mood = mood;
    this.focus = focus;
    this.visitors = visitors;
    // невыполненные задачи хранителей (0.9): «!» над головой, к экрану стучат только они
    this.alerts = new Map(keepers.filter(Boolean).map((k) => [k.id, k.alert | 0]));
    if (lightsOff) this.lightsOff = new Set(lightsOff);
    const list = [...objects];
    if (owned.has('v:char:archer')) list.push({ key: 'virtual:target', place: 'target', x: null, y: null, virtual: true, level: 1 });
    const key = [...owned].sort().join(',') + '|' + list.map((o) => `${o.key}:${o.place}:${o.level}:${o.x},${o.y}`).join(';') + '|' + [...legacy].sort().join(',') + '|' + flavor + '|' + minCols + 'x' + minRows
      + '|' + keepers.filter(Boolean).map((k) => `${k.id}:${k.name}:${JSON.stringify(k.look)}`).join(';');
    if (key === this.key) return false;
    this.key = key;
    this.owned = new Set(owned);
    this.legacy = new Set(legacy);
    this.flavor = flavor;
    const prev = this.map;
    this.map = buildMap(list, { flavor, legacy, minCols, minRows });
    this.W = this.map.cols * TILE;
    this.H = this.map.rows * TILE;
    // карта стала шире/выше (рост земли, другой экран) — площадь сместилась: сдвигаем всё, что уже есть, вместе с ней
    const dx = (this.map.cx - prev.cx) * TILE;
    const dy = (this.map.cy - prev.cy) * TILE;
    if (dx || dy) {
      for (const o of [...this.actors, ...this.particles, ...this.fireflies]) {
        o.x += dx;
        o.y += dy;
      }
      this.shift = { dx: (this.shift?.dx || 0) + dx, dy: (this.shift?.dy || 0) + dy };
    }
    const want = residentsOf(owned, keepers);
    const keep = new Map(this.actors.map((a) => [a.id, a]));
    const plaza = this.map.spots.plaza;
    this.actors = want.map((r) => {
      const old = keep.get(r.id);
      if (old) {
        if (r.look) {
          old.look = r.look; // хранитель повзрослел или список перекрасили
          old.lk = null;
          old.name = r.name;
          old.listName = r.listName;
        }
        if (old.talking) return old; // идёт разговор — не трогаем
        if (old.task?.type === 'away') return old; // сейчас у экрана — вернётся сам
        const [tx, ty] = this.tileOf(old.x, old.y);
        if (!walkable(this.map, tx, ty)) this.placeNear(old, old.x, old.y);
        old.queue = [];
        old.task = null;
        old.path = null;
        old.thread = null;
        if (old.kind !== 'ghost') {
          old.hidden = false;
          old.alpha = 1;
        }
        return old;
      }
      const [tx, ty] = randomSpot(this.map, this.rand, plaza, 7);
      const a = newActor(r.id, r.kind, (tx + 0.5) * TILE, (ty + 0.5) * TILE, r.big ? 2 : 1);
      a.name = r.name || 'Странник';
      if (r.look) {
        a.look = r.look;
        a.listId = r.listId;
        a.listName = r.listName;
        a.gender = r.gender;
      }
      if (this.t > 1) {
        a.z = 50; // новый житель после покупки падает с неба в искрах
        this.burst(a.x, a.y, 30, 'spark', 16);
      }
      return a;
    });
    // у каждого жителя свой дом (по кругу); звери тоже иногда ночуют дома
    const homes = this.houses();
    let hi = 0;
    for (const a of this.actors) {
      if (!homes.length || !(KINDS[a.kind]?.human || KINDS[a.kind]?.beast) || a.kind === 'witch' || a.kind === 'knight') {
        a.homeKey = null;
        continue;
      }
      if (!homes.some((h) => h.key === a.homeKey)) a.homeKey = homes[hi % homes.length].key;
      hi++;
    }
    if (owned.has('v:fireflies') && !this.fireflies.length) {
      for (let i = 0; i < 22; i++) {
        const near = i % 3 === 0 ? this.map.spots.pond : plaza;
        this.fireflies.push({ x: near.x + (this.rand() - 0.5) * 120, y: near.y + (this.rand() - 0.5) * 60, z: 4 + this.rand() * 16, p: this.rand() * TAU });
      }
    } else if (!owned.has('v:fireflies')) this.fireflies = [];
    return true;
  }

  /** Поставить жителя на ближайший проходимый тайл. */
  placeNear(a, x, y) {
    const [cx, cy] = this.tileOf(x, y);
    for (let r = 0; r < 12; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (walkable(this.map, cx + dx, cy + dy)) {
            a.x = (cx + dx + 0.5) * TILE;
            a.y = (cy + dy + 0.5) * TILE;
            return;
          }
        }
      }
    }
    a.x = this.map.spots.plaza.x;
    a.y = this.map.spots.plaza.y;
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

  /** Труба постройки: { x, y (основание), z (высота) } или null. */
  chimney(b) {
    const c = CHIMNEY[b.type];
    return c ? { x: b.x + b.w * c[0], y: b.base - 1, z: c[1] } : null;
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

  burst(x, y, z, kind, n = 10, spread = 40) {
    for (let i = 0; i < n; i++) {
      const ang = this.rand() * TAU;
      const sp = spread * (0.2 + this.rand() * 0.5);
      this.particles.push({ x, y, z, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp * 0.5, vz: spread * (0.6 + this.rand() * 0.8), life: 1.2 + this.rand(), kind, c: this.rand() });
    }
    if (this.particles.length > 500) this.particles.splice(0, this.particles.length - 500);
  }

  firework(x, y, z) {
    for (let i = 0; i < 28; i++) {
      const ang = (i / 28) * TAU;
      const sp = 26 + this.rand() * 10;
      this.particles.push({ x, y, z, vx: Math.cos(ang) * sp, vy: 0, vz: Math.sin(ang) * sp, life: 1.4 + this.rand() * 0.4, kind: 'fw', c: this.rand(), g: 0.25 });
    }
  }

  /** Задача выполнена: все прыгают, монетки из домика; за важную — фейерверк и дракон. */
  celebrate(amount = 5, gems = 0) {
    const home = this.houses()[0];
    if (home) this.burst(home.door.x, home.door.y - 4, 8, 'coin', Math.min(24, 4 + amount), 34);
    if (gems) {
      const mine = this.building('gemmine');
      if (mine) this.burst(mine.door.x, mine.door.y - 4, 6, 'gem', Math.min(16, gems * 3), 30);
    }
    for (const a of this.actors) {
      if (a.hidden || a.task?.type === 'away' || a.task?.type === 'leave') continue;
      if (a.talking) {
        this.emote(a, gems ? 'gem' : 'star', 2);
        continue;
      }
      if (a.state === 'sleep') this.emote(a, '!');
      if (['broom', 'float', 'flyhigh', 'climb'].includes(a.task?.type)) continue;
      a.queue = [];
      a.path = null;
      a.task = { type: 'celebrate', d: 1.6 + this.rand(), jumps: 0, t: 0 };
      a.happy = true;
      this.emote(a, gems ? 'gem' : amount >= 10 ? 'star' : 'coin', 2);
    }
    if (amount >= 20) {
      const p = this.map.spots.plaza;
      for (let i = 0; i < 3; i++) setTimeoutSafe(() => this.firework(p.x + (this.rand() - 0.5) * 160, p.y - 20 + (this.rand() - 0.5) * 60, 70 + this.rand() * 30), i * 450);
      const d = this.actors.find((a) => a.kind === 'dragon' && !a.hidden);
      if (d) {
        d.queue = [];
        d.task = { type: 'flyhigh', d: 7, t: 0, cx: p.x, cy: p.y };
      }
    }
  }

  focusStart() {
    const b = this.actors.find((a) => a.kind === 'builder') || this.actors.find((a) => a.kind === 'wanderer');
    if (b && !['away', 'leave', 'inside'].includes(b.task?.type)) {
      b.queue = [];
      b.task = null;
      b.path = null;
      this.say(b, 'Беремся за дело!', 3);
    }
  }

  focusDone(gems = 0) {
    const p = this.map.spots.plaza;
    for (let i = 0; i < 4; i++) setTimeoutSafe(() => this.firework(p.x + (this.rand() - 0.5) * 180, p.y - 20 + (this.rand() - 0.5) * 70, 64 + this.rand() * 36), i * 380);
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
      a.task = { type: 'pose', pose: 'idle', d: 2, t: 0 };
      a.queue = [];
      return;
    }
    const flying = ['broom', 'float', 'flyhigh', 'climb', 'leave', 'away'].includes(a.task?.type);
    if (!flying) {
      a.queue = [];
      a.path = null;
      a.task = { type: 'pose', pose: 'wave', d: 1.4, t: 0 };
      if (a.z <= 0) a.vz = 80;
    }
    if (a.kind === 'dragon') {
      a.fire = true;
      this.burst(a.x + a.dir * 12, a.y, a.z + 14, 'fire', 10, 30);
    }
    if (a.kind === 'slime') a.squash = 0.5;
    this.emote(a, this.rand() < 0.6 ? 'heart' : 'note');
    const mood = this.mood < 30 ? SAD : this.mood > 75 ? HAPPY : [];
    this.say(a, this.pick([...(PHRASES[a.kind] || PHRASES.wanderer), ...mood]));
  }

  /** Сколько невыполненных задач у хранителя (0.9). */
  alertOf(a) {
    return a && this.alerts ? this.alerts.get(a.id) || 0 : 0;
  }

  /** Дом жителя (или null). */
  homeOf(a) {
    return (a.homeKey && this.houses().find((h) => h.key === a.homeKey)) || null;
  }

  /** Жители дома b. */
  residentsOf(b) {
    return this.actors.filter((a) => a.homeKey && a.homeKey === b.key);
  }

  /**
   * Горит ли свет в постройке (0.9). Дом: светится, пока внутри кто-то не спит; когда последний житель вошёл
   * ночью — через пару секунд свет гаснет сам. Выключенный вручную — не горит. Остальные постройки — как раньше.
   */
  buildingLit(b) {
    if (!this.lightOn(b.id)) return false;
    if (!b.type.startsWith('house')) return true;
    const inside = this.actors.some((a) => a.task?.type === 'inside' && a.task.b === b && a.hidden);
    if (!inside) return false;
    return !(b.sleepAt && this.t >= b.sleepAt);
  }

  onEnter(a, b) {
    if (!b.type.startsWith('house') || this.night < 0.6) return;
    const res = this.residentsOf(b).filter((x) => KINDS[x.kind]?.human);
    const all = res.every((x) => x === a || (x.task?.type === 'inside' && x.task.b === b) || x.hidden);
    if (all && !b.sleepAt) b.sleepAt = this.t + 2 + this.rand() * 2.5;
  }

  /** Нажали на дом: жители выбегают — «Что происходит?!», свет снова горит. */
  disturb(b) {
    if (!b?.type?.startsWith('house')) return 0;
    b.sleepAt = null;
    let n = 0;
    const lines = (x) => ['Что происходит?!', 'Кто там?', x.gender === 'm' ? 'Я же спал…' : x.gender === 'f' ? 'Я же спала…' : 'Я же спал(а)…', 'Землетрясение?!', 'А? Что? Где?', 'Кто стучит?'];
    for (const x of this.residentsOf(b)) {
      if (x.talking || x.held) continue;
      const inside = x.task?.type === 'inside' && x.task.b === b;
      x.queue = [];
      x.path = null;
      if (inside) {
        x.hidden = false;
        x.alpha = 1;
        x.x = b.door.x + (this.rand() - 0.5) * 14;
        x.y = b.door.y + 2 + this.rand() * 6;
        this.placeNear(x, x.x, x.y);
        x.task = { type: 'pose', pose: 'idle', d: 2.5 + this.rand() * 2, t: 0, face: b.door.x };
        if (x.z <= 0) x.vz = 70;
      } else {
        x.task = { type: 'go', x: b.door.x + (this.rand() - 0.5) * 20, y: b.door.y + 6, run: true, t: 0 };
        x.queue = [{ type: 'pose', pose: 'idle', d: 2, face: b.door.x }];
      }
      this.emote(x, '!', 1.8);
      setTimeoutSafe(() => this.say(x, this.pick(lines(x)), 2.6), n * 250);
      n++;
    }
    return n;
  }

  /** Дело у объекта рядом (0.9): [идти, дело] или null. */
  chore(a) {
    const M = this.map;
    const opts = ['fish', 'gather'];
    const pet = this.actors.find((o) => KINDS[o.kind]?.beast && !o.hidden && !o.held && !o.talking && !['inside', 'leave', 'away'].includes(o.task?.type) && Math.hypot(o.x - a.x, o.y - a.y) < 220);
    if (pet) opts.push('pet', 'pet');
    const well = M.decor.find((d) => d.type === 'well') || M.buildings.find((b) => b.place === 'fountain');
    if (well) opts.push('bucket');
    const fields = M.buildings.filter((b) => b.place === 'field');
    if (fields.length) opts.push('water', 'water');
    const act = opts[Math.floor(this.rand() * opts.length)];
    const near = (x, y, rad = 1) => {
      const [tx, ty] = randomSpot(M, this.rand, { x, y }, rad);
      return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
    };
    if (act === 'pet') {
      const p = near(pet.x + (a.x < pet.x ? -10 : 10), pet.y, 1);
      pet.queue = [];
      pet.path = null;
      pet.task = { type: 'pose', pose: 'sit', d: 9, t: 0, face: p.x };
      return [this.go(p.x, p.y), { type: 'chore', act: 'pet', d: 4, face: pet.x, who: pet }];
    }
    if (act === 'bucket') {
      const x = well.door ? well.door.x : well.x;
      const y = well.door ? well.door.y : well.y + 6;
      const p = near(x + 12, y + 2, 1);
      return [this.go(p.x, p.y), { type: 'chore', act: 'bucket', d: 3.5, face: x }];
    }
    if (act === 'fish') {
      const pd = M.spots.pond;
      const p = near(pd.x + (this.rand() - 0.5) * 40, pd.y, 1);
      return [this.go(p.x, p.y), { type: 'chore', act: 'fish', d: 6 + this.rand() * 5, face: (M.pond.x + M.pond.w / 2) * TILE }];
    }
    if (act === 'gather') {
      const v = M.village;
      const p = near(v.x0 + this.rand() * (v.x1 - v.x0), v.y1 + TILE * 1.5, 2);
      return [this.go(p.x, p.y), { type: 'chore', act: 'gather', d: 4 }];
    }
    if (act === 'water') {
      const f = fields[Math.floor(this.rand() * fields.length)];
      const p = near(f.x + f.w + 6, f.base - 8, 1);
      return [this.go(p.x, p.y), { type: 'chore', act: 'water', d: 4.5, face: f.x + f.w / 2, field: f }];
    }
    return null;
  }

  /** Взять жителя «рукой» (0.9). */
  grab(a) {
    if (!a || a.hidden) return false;
    this.release(a);
    a.held = true;
    a.queue = [];
    a.path = null;
    a.thread = null;
    a.say = null;
    a.task = { type: 'held', t: 0 };
    this.emote(a, '!', 1.2);
    return true;
  }

  /** Держим за макушку в точке (wx, wy) карты: житель висит чуть ниже руки, тень — на земле. */
  holdAt(a, wx, wy) {
    if (!a?.held) return;
    const lift = 14;
    a.dir = wx > a.x + 0.5 ? 1 : wx < a.x - 0.5 ? -1 : a.dir;
    a.x = wx;
    a.z = lift;
    a.y = wy + 2 + charHeight(a.kind) * a.u + lift;
  }

  /** Отпустили — падает с высоты, приземляется с пылью. */
  drop(a) {
    if (!a?.held) return;
    a.held = false;
    a.vz = 10;
    a.task = { type: 'fall', t: 0 };
  }

  /** Разговор (0.8): житель останавливается и смотрит на нас, пока открыто окно диалога. */
  talkTo(a) {
    if (this.visitor && this.visitor.actor === a) {
      // гость у экрана ждёт, пока говорим
      this.visitor.stage = 'talk';
      this.visitor.t = 0;
      this.visitor.say = null;
      a.talking = true;
      return true;
    }
    if (!a || a.hidden) return false;
    for (const o of this.actors) if (o.talking && o !== a) this.release(o);
    a.talking = true;
    a.queue = [];
    a.path = null;
    a.say = null;
    a.task = { type: 'pose', pose: 'idle', d: 1e9, t: 0, talk: true };
    if (a.z <= 0) a.vz = 50;
    this.emote(a, '!', 1.2);
    return true;
  }

  release(a) {
    if (!a) return;
    a.talking = false;
    if (a.task?.talk) a.task = null;
    const v = this.visitor;
    if (v && v.actor === a && v.stage === 'talk') {
      v.stage = 'wave';
      v.t = 0;
      v.stay = 1;
    }
  }

  /** Жест в разговоре: помахать, подпрыгнуть, радость. */
  gesture(a, kind) {
    if (!a || a.hidden) return;
    if (kind === 'wave') a.task = { type: 'pose', pose: 'wave', d: 1.4, t: 0, talk: true, then: 'idle' };
    if (kind === 'jump' && a.z <= 0) a.vz = 80;
    if (kind === 'heart') this.emote(a, 'heart', 2);
    if (kind === 'sad') this.emote(a, 'sad', 2);
    if (kind === 'star') this.emote(a, 'star', 2);
  }

  /** Новый уровень навыка или престиж: хранитель списка радуется. */
  cheer(listId, big = false) {
    const a = this.actors.find((x) => x.listId === listId && !x.hidden);
    if (!a) return;
    if (!a.talking) {
      a.queue = [];
      a.path = null;
      a.task = { type: 'celebrate', d: big ? 3 : 1.8, jumps: 0, t: 0 };
    }
    a.happy = true;
    this.emote(a, 'star', 2.5);
    this.burst(a.x, a.y, 12, 'star', big ? 24 : 12, 30);
    if (big) for (let i = 0; i < 3; i++) setTimeoutSafe(() => this.firework(a.x + (this.rand() - 0.5) * 80, a.y - 10, 60 + this.rand() * 30), i * 400);
  }

  /** Что под точкой карты: житель, фонарь, постройка (передние — первыми). */
  hit(wx, wy) {
    const actors = this.actors.filter((a) => !a.hidden).sort((p, q) => q.y - p.y);
    for (const a of actors) {
      const h = charHeight(a.kind) * a.u + 3;
      const w = 6 * a.u + 3;
      const top = a.y - a.z - h;
      if (Math.abs(wx - a.x) <= w && wy >= top && wy <= a.y - a.z + 3) return { type: 'actor', actor: a };
    }
    for (const l of this.lanterns) if (Math.abs(wx - l.x) <= 4 && wy >= l.y - 24 && wy <= l.y + 2) return { type: 'lantern', lantern: l, obj: l };
    const smalls = [...this.smalls].sort((p, q) => q.base - p.base);
    for (const s of smalls) {
      if (s.place === 'lantern') continue;
      const top = s.base - (s.place === 'tree' ? 30 : 14);
      if (wx >= s.x - 2 && wx <= s.x + s.w + 2 && wy >= top && wy <= s.base + 2) return { type: 'object', obj: s };
    }
    const bs = [...this.buildings].sort((p, q) => q.base - p.base);
    for (const b of bs) {
      const top = b.base - (SPRITE_H[b.type] || b.h);
      if (wx >= b.x - 2 && wx <= b.x + b.w + 2 && wy >= top && wy <= b.base + 2) return { type: 'building', building: b, obj: b };
    }
    const tx = Math.floor(wx / TILE);
    const ty = Math.floor(wy / TILE);
    // окружение (0.9): колодец, деревья, вода
    const well = this.decor.find((d) => d.type === 'well' && Math.abs(wx - d.x) <= 9 && wy >= d.y - 22 && wy <= d.y + 2);
    if (well) return { type: 'scenery', what: 'well', x: well.x, y: well.y };
    for (const t of [...this.trees].sort((p, q) => q.y - p.y)) {
      if (Math.abs(wx - t.x) <= 9 * t.size && wy >= t.y - 34 * t.size && wy <= t.y + 2) return { type: 'scenery', what: 'tree', x: t.x, y: t.y, tree: t };
    }
    const tile = this.map.grid[ty * this.map.cols + tx];
    if (tile === 3 || tile === 10) return { type: 'scenery', what: 'water', x: wx, y: wy };
    if (buildable(this.map, tx, ty)) return { type: 'tile', tx, ty };
    return null;
  }

  /** Нажали на окружение: вода плещется, с дерева летят листья, колодец брызжет; ближайший житель отзывается. */
  touchScenery(h) {
    if (h.what === 'water') {
      this.burst(h.x, h.y, 2, 'drop', 12, 24);
      if (this.rand() < 0.35) this.particles.push({ x: h.x, y: h.y, z: 2, vx: (this.rand() - 0.5) * 20, vy: 0, vz: 70, life: 1.1, kind: 'fish', c: this.rand() });
    } else if (h.what === 'tree') this.burst(h.x, h.y, 22 * (h.tree?.size || 1), 'leaf', 10, 26);
    else if (h.what === 'well') this.burst(h.x, h.y - 4, 8, 'drop', 14, 22);
    const near = this.actors.filter((a) => !a.hidden && !a.held && !a.talking && KINDS[a.kind]?.human && Math.hypot(a.x - h.x, a.y - h.y) < 80);
    const a = near[0];
    if (a) {
      a.dir = h.x > a.x ? 1 : -1;
      this.say(a, this.pick(h.what === 'water' ? ['Не пугай рыбу!', 'Плюх!', 'Вода холодная!'] : h.what === 'tree' ? ['Ой, листья!', 'Шишка упала!', 'Красивое дерево.'] : ['Вода свежая!', 'Отличный колодец.']), 2.2);
    }
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
    this.mill += dt * (this.mood >= 65 ? 2.4 : this.mood >= 35 ? 1.1 : 0.3);
    if (!motion) {
      for (const a of this.actors) {
        a.z = 0;
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
      const g = p.g ?? (p.kind === 'smoke' || p.kind === 'spark' || p.kind === 'fire' ? -0.08 : 1);
      p.vz -= GRAVITY * 0.5 * g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.kind === 'smoke') p.vx += Math.sin(this.t + p.c * 6) * dt * 5;
      if (p.z < 0) {
        if (p.kind === 'drop' || p.kind === 'dirt' || p.kind === 'fw' || p.kind === 'arrow') continue;
        p.z = 0;
        p.vz = Math.abs(p.vz) * 0.35;
        p.vx *= 0.6;
        p.vy *= 0.6;
      }
      out.push(p);
    }
    this.particles = out;
    // фоновые: дым из труб, искры костра, брызги фонтана
    for (const b of this.buildings) {
      const c = this.chimney(b);
      if (!c) continue;
      const rate = b.type === 'forge' ? (this.focus ? 3 : 0.9) : this.night > 0.4 ? 0.7 : 0.25;
      if (this.rand() < dt * rate) this.particles.push({ x: c.x + (this.rand() - 0.5) * 2, y: c.y, z: c.z, vx: 2, vy: 0, vz: 7, life: 2.8, kind: 'smoke', c: this.rand() });
    }
    const fountain = this.building('fountain');
    if (fountain && this.rand() < dt * 12) this.particles.push({ x: fountain.x + fountain.w / 2, y: fountain.y + fountain.h * 0.55, z: 16, vx: (this.rand() - 0.5) * 18, vy: (this.rand() - 0.5) * 8, vz: 14 + this.rand() * 8, life: 1.2, kind: 'drop', c: 0 });
    for (const d of this.decor) {
      if (d.type === 'bonfire' && this.rand() < dt * 5) this.particles.push({ x: d.x + (this.rand() - 0.5) * 4, y: d.y, z: 6, vx: (this.rand() - 0.5) * 4, vy: 0, vz: 12, life: 1, kind: 'spark', c: this.rand() });
    }
  }

  updateFireflies(dt) {
    const v = this.map.village;
    for (const f of this.fireflies) {
      f.p += dt;
      f.x += Math.sin(f.p * 0.7 + f.y * 0.1) * dt * 8;
      f.y += Math.cos(f.p * 0.9 + f.x * 0.1) * dt * 5;
      f.z = 10 + Math.sin(f.p * 1.3) * 5;
      if (f.x < v.x0) f.x = v.x1 - 4;
      if (f.x > v.x1) f.x = v.x0 + 4;
      if (f.y < v.y0) f.y = v.y1 - 4;
      if (f.y > v.y1) f.y = v.y0 + 4;
    }
  }

  // ---------- Поведение ----------

  go(x, y, run = false) {
    return { type: 'go', x, y, run };
  }

  think(a) {
    const r = this.rand();
    const k = a.kind;
    const night = this.night;
    const homes = this.houses();
    const M = this.map;
    const q = a.queue;
    const spot = (near, rad = 8) => {
      const [tx, ty] = randomSpot(M, this.rand, near, rad);
      return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
    };
    // призрак — только ночью, парит над крышами
    if (k === 'ghost') {
      if (night < 0.45) return q.push({ type: 'pose', pose: 'idle', d: 3, ghostHide: true });
      const p = spot(M.spots.plaza, 14);
      return q.push({ type: 'float', tx: p.x, ty: p.y, d: 5 + r * 4 });
    }
    if (k === 'witch' && night > 0.55 && r < 0.7) return q.push({ type: 'broom', d: 10 + r * 8, cx: M.spots.plaza.x, cy: M.spots.plaza.y - 10 });
    // хранитель навыка иногда «тренирует навык»: читает, рисует, играет — по роли
    if (k === 'keeper' && night < 0.6 && r < 0.2) {
      const p = spot(M.spots.plaza, 10);
      return q.push(this.go(p.x, p.y), { type: 'work', d: 4 + r * 10 });
    }
    if (k === 'spider' && r < 0.5 && M.trees.length) {
      const near = M.trees.filter((t) => Math.abs(t.x - a.x) < 140 && Math.abs(t.y - a.y) < 100 && t.y > M.village.y0 + 10);
      const t = near.length ? near[Math.floor(this.rand() * near.length)] : null;
      if (t) {
        const p = spot({ x: t.x, y: t.y + 6 }, 1);
        return q.push(this.go(p.x, p.y), { type: 'climb', d: 3 + r * 6 });
      }
    }
    // сумерки: кот и котёнок охотятся на светлячков
    if ((k === 'cat' || k === 'kitten') && this.fireflies.length && night > 0.2 && r < 0.45) {
      const f = this.fireflies[Math.floor(this.rand() * this.fireflies.length)];
      const p = spot({ x: f.x, y: f.y }, 2);
      return q.push(this.go(p.x, p.y, true), { type: 'pounce', emote: 'heart' });
    }
    // вечер: таверна и костёр
    if (night > 0.3 && night <= 0.68 && r < 0.3) {
      const tavern = this.building('tavern');
      const fire = M.spots.bonfire;
      if (fire && KINDS[k]?.human) {
        const p = { x: fire.x + (a.n % 2 ? 12 : -12) + a.ox, y: fire.y + a.oy };
        return q.push(this.go(p.x, p.y), { type: 'pose', pose: r < 0.15 ? 'dance' : 'sit', d: 8, face: fire.x });
      }
      if (tavern && KINDS[k]?.human) return q.push(this.go(tavern.door.x, tavern.door.y), { type: 'inside', b: tavern, d: 10 + r * 10 });
    }
    // ночь: люди по домам, звери — то дома, то на улице
    if (night > 0.68) {
      const home = this.homeOf(a);
      if (KINDS[k]?.beast) {
        if (home && r < 0.5) return q.push(this.go(home.door.x, home.door.y), { type: 'inside', b: home, d: 30 + r * 30 });
        if (k === 'cat') {
          const l = M.lanterns.find((x) => this.lightOn(x.id));
          if (l) return q.push(this.go(l.x + 8, l.y + 4), { type: 'pose', pose: 'sleep', d: 20 });
        }
        return q.push({ type: 'pose', pose: 'sleep', d: 15 + r * 10 });
      }
      if (KINDS[k]?.human && homes.length && k !== 'witch' && k !== 'knight') {
        const h = home || homes[a.n % homes.length];
        const fire = M.spots.bonfire;
        if (fire && r < 0.25) return q.push(this.go(fire.x + (a.n % 2 ? 12 : -12), fire.y + a.oy), { type: 'pose', pose: 'sit', d: 12, face: fire.x });
        return q.push(this.go(h.door.x, h.door.y), { type: 'inside', b: h, d: 25 + r * 30 });
      }
      if (k === 'knight') return q.push(this.go(M.spots.westEnd.x + 20, M.spots.westEnd.y), this.go(M.spots.eastEnd.x - 30, M.spots.eastEnd.y));
      return q.push({ type: 'pose', pose: 'sleep', d: 15 + r * 10 });
    }
    // фокус-сессия: строитель (или странник) работает в мастерской
    if (this.focus && (k === 'builder' || (k === 'wanderer' && !this.actors.some((x) => x.kind === 'builder')))) {
      const f = this.building('forge') || homes[0];
      return q.push(this.go(f.door.x + 4, f.door.y), { type: 'work', d: 10, sparks: true, face: f.door.x - 10 });
    }
    // настроение низкое — грустят
    if (this.mood < 25 && r < 0.25) return q.push({ type: 'pose', pose: 'sit', d: 5, emote: 'sad' });
    // дела вокруг (0.9): погладить котика, набрать воды из колодца, порыбачить, сходить в лес, полить огород
    if (KINDS[k]?.human && night < 0.45 && this.rand() < 0.3) {
      const job = this.chore(a);
      if (job) return q.push(...job);
    }
    const pr = this.rand();
    if (pr < 0.22) {
      if (k === 'miner') {
        const mines = this.buildings.filter((b) => b.type.endsWith('mine'));
        const m = mines[Math.floor(r * mines.length)];
        if (m) return q.push(this.go(m.door.x, m.door.y), { type: 'inside', b: m, d: 6 + r * 6, loot: m.type === 'gemmine' ? 'gem' : 'coin' });
      }
      if (k === 'builder' && homes.length) {
        const h = homes[Math.floor(r * homes.length)];
        return q.push(this.go(h.door.x + 14, h.door.y), { type: 'work', d: 5, sparks: true, face: h.door.x + 30 });
      }
      if (k === 'archer') {
        const t = M.smalls.find((s) => s.place === 'target');
        if (t && M.spots.archer) return q.push(this.go(M.spots.archer.x, M.spots.archer.y), { type: 'shoot', d: 4, tx: t.x + TILE / 2, ty: t.base - 2, shots: 0 });
      }
      if (k === 'fox') {
        const p = spot(a, 6);
        return q.push(this.go(p.x, p.y, true), { type: 'dig', d: 3 });
      }
      if (k === 'kitten' || k === 'neko' || k === 'cat') {
        const other = this.nearest(a, 140);
        if (other && (k === 'kitten' || r < 0.4)) return q.push({ type: 'chase', who: other, d: 5 });
      }
      if (k === 'dragon' && r < 0.6) return q.push({ type: 'flyhigh', d: 7, cx: a.x, cy: a.y });
      if (k === 'knight') return q.push(this.go(M.spots.westEnd.x + 20, M.spots.westEnd.y), { type: 'pose', pose: 'idle', d: 2 }, this.go(M.spots.eastEnd.x - 30, M.spots.eastEnd.y));
      if (k === 'neko') return q.push({ type: 'pose', pose: 'wave', d: 2.5, say: 'Привет-привет!' });
    }
    if (pr < 0.4) {
      const other = this.nearest(a, 90);
      if (other && !other.hidden && other.task?.type !== 'greet' && !KINDS[other.kind]?.floater && other.z <= 0) {
        const side = a.x < other.x ? -1 : 1;
        q.push(this.go(other.x + side * (8 + 4 * Math.max(a.u, other.u)), other.y), { type: 'greet', who: other, d: 3 });
        return;
      }
    }
    if (pr < 0.5 && KINDS[k]?.hopper) {
      const p = spot(a, 6);
      return q.push(this.go(p.x, p.y));
    }
    if (pr < 0.6 && M.spots.benches.length && KINDS[k]?.human) {
      const b = M.spots.benches[a.n % M.spots.benches.length];
      return q.push(this.go(b.x, b.y), { type: 'pose', pose: 'sit', d: 5 + r * 5 });
    }
    if (pr < 0.66) {
      const p = M.spots.pond;
      return q.push(this.go(p.x + a.ox * 4, p.y + 2), { type: 'pose', pose: KINDS[k]?.beast ? 'sit' : 'idle', d: 3 + r * 3 });
    }
    if (pr < 0.78) return q.push({ type: 'pose', pose: KINDS[k]?.beast && r < 0.5 ? 'sit' : 'idle', d: 2 + r * 4 });
    const p = spot(r < 0.5 ? M.spots.plaza : a, 10);
    q.push(this.go(p.x, p.y, k === 'kitten' && r < 0.5));
  }

  nearest(a, maxD) {
    let best = null;
    let bd = maxD;
    for (const o of this.actors) {
      if (o === a || o.hidden || ['away', 'inside', 'leave'].includes(o.task?.type)) continue;
      const d = Math.hypot(o.x - a.x, o.y - a.y);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  /** Проложить путь к точке (x, y). false — недостижимо. */
  route(a, x, y) {
    const from = this.tileOf(a.x, a.y);
    const to = this.tileOf(x, y);
    let target = to;
    if (!walkable(this.map, to[0], to[1])) {
      // цель на непроходимом тайле — ближайший соседний
      const near = [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1]].map(([dx, dy]) => [to[0] + dx, to[1] + dy]).find(([tx, ty]) => walkable(this.map, tx, ty));
      if (!near) return false;
      target = near;
      x = (near[0] + 0.5) * TILE;
      y = (near[1] + 0.5) * TILE;
    }
    const tiles = findPath(this.map, from, target);
    if (!tiles) return false;
    a.path = tiles.map(([tx, ty]) => ({ x: (tx + 0.5) * TILE + a.ox, y: (ty + 0.5) * TILE + a.oy }));
    a.path.push({ x, y });
    return true;
  }

  /** Идти по пути: true — пришли. */
  walk(a, dt, speed) {
    const p = a.path?.[0];
    if (!p) return true;
    const dx = p.x - a.x;
    const dy = p.y - a.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.8) {
      a.path.shift();
      return !a.path.length;
    }
    const s = Math.min(d, speed * dt);
    a.x += (dx / d) * s;
    a.y += (dy / d) * s;
    if (Math.abs(dx) > 0.25) a.dir = Math.sign(dx);
    return false;
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
    const speed = kind.speed * (this.mood < 25 ? 0.7 : 1) * (a.u > 1 ? 1.3 : 1);
    let state = 'idle';
    let moving = false;
    let done = false;
    let flying = false;
    a.fire = false;
    switch (T.type) {
      case 'go': {
        if (!T.started) {
          T.started = true;
          if (!this.route(a, T.x, T.y)) {
            done = true;
            break;
          }
        }
        const sp = speed * (T.run ? 1.7 : 1);
        if (kind.hopper && a.z <= 0 && a.vz === 0 && (a.path?.length || 0) > 0) a.vz = 55 + this.rand() * 15;
        if (this.walk(a, dt, sp)) done = true;
        else {
          moving = true;
          state = T.run ? 'run' : 'walk';
        }
        if (T.t > 60) done = true;
        break;
      }
      case 'pose':
        state = T.pose;
        if (T.face != null) a.dir = T.face > a.x ? 1 : -1;
        if (T.ghostHide) a.alpha = Math.max(0, a.alpha - dt);
        if (T.t > T.d) {
          if (T.then && a.talking) a.task = { type: 'pose', pose: T.then, d: 1e9, t: 0, talk: true };
          else done = true;
        }
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
          if (!o.task || ['go', 'pose'].includes(o.task.type)) {
            o.queue = [];
            o.path = null;
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
        const d = Math.hypot(o.x - a.x, o.y - a.y);
        if (d > 9 * a.u) {
          if (!T.next || T.t > T.next) {
            T.next = T.t + 0.6;
            this.route(a, o.x, o.y);
          }
          this.walk(a, dt, speed * 1.7);
          moving = true;
          state = 'run';
        } else {
          if (a.z <= 0) a.vz = 70;
          this.emote(a, 'heart', 1);
          if (o.task?.type !== 'flee' && o.z <= 0 && !KINDS[o.kind]?.floater && !['inside', 'leave', 'away'].includes(o.task?.type)) {
            o.queue = [];
            o.path = null;
            const away = { x: o.x + (o.x - a.x) * 4 + (this.rand() - 0.5) * 30, y: o.y + (o.y - a.y) * 4 };
            o.task = { type: 'go', x: away.x, y: away.y, run: true, t: 0 };
            this.emote(o, '!', 1.2);
          }
          done = true;
        }
        break;
      }
      case 'inside': {
        if (T.t < 0.4) a.alpha = Math.max(0, 1 - T.t / 0.4);
        else {
          a.hidden = true;
          if (!T.entered) {
            T.entered = true;
            this.onEnter(a, T.b);
          }
        }
        const home = T.b.type.startsWith('house');
        if (this.night < 0.6 && home && T.t > 4) T.d = Math.min(T.d, T.t);
        if (T.t > T.d && !(home && this.night > 0.6 && T.t < 200)) {
          a.hidden = false;
          a.alpha = 1;
          T.b.sleepAt = null;
          if (T.loot) {
            this.burst(a.x, a.y, 10, T.loot, 5, 25);
            this.emote(a, T.loot, 2);
            this.say(a, T.loot === 'gem' ? 'Изумруд!' : 'Золото!', 2);
          }
          done = true;
        }
        break;
      }
      case 'work':
        state = 'work';
        if (T.face != null) a.dir = T.face > a.x ? 1 : -1;
        if (T.sparks && Math.floor(a.anim * 4) !== Math.floor((a.anim - dt) * 4) && Math.floor(a.anim * 4) % 2 === 0) this.burst(a.x + a.dir * 6, a.y, 5, 'spark', 3, 18);
        if (T.t > T.d && !(this.focus && T.sparks)) done = true;
        if (T.t > T.d * 6) done = true;
        break;
      case 'shoot':
        state = 'work';
        a.dir = T.tx > a.x ? 1 : -1;
        if (T.t > 0.8 * (T.shots + 1) && T.shots < 3) {
          T.shots++;
          const dist = Math.max(1, Math.hypot(T.tx - a.x, T.ty - a.y));
          this.particles.push({ x: a.x + a.dir * 4, y: a.y, z: 9, vx: ((T.tx - a.x) / dist) * 70, vy: ((T.ty - a.y) / dist) * 70, vz: 5, life: Math.max(0.1, (dist - 4) / 70), kind: 'arrow', c: a.dir, g: 0.04 });
          if (T.shots === 3) setTimeoutSafe(() => this.say(a, this.pick(['В яблочко!', 'Почти…', 'Ещё разок!'])), 600);
        }
        if (T.t > T.d) done = true;
        break;
      case 'dig':
        state = 'work';
        if (this.rand() < dt * 10) this.particles.push({ x: a.x + a.dir * 3, y: a.y, z: 1, vx: -a.dir * (8 + this.rand() * 12), vy: (this.rand() - 0.5) * 6, vz: 18 + this.rand() * 12, life: 1, kind: 'dirt', c: this.rand() });
        if (T.t > T.d) done = true;
        break;
      case 'pounce':
        if (!T.jumped && a.z <= 0) {
          a.vz = 85;
          T.jumped = true;
        }
        state = 'jump';
        if ((T.jumped && a.z <= 0 && T.t > 0.25) || T.t > 3) done = true;
        break;
      case 'celebrate':
        state = a.z > 0 ? 'jump' : 'dance';
        if (a.z <= 0 && a.vz === 0 && T.jumps < 3 && T.t > T.jumps * 0.5) {
          a.vz = 70 + this.rand() * 25;
          T.jumps++;
        }
        if (T.t > T.d) {
          done = true;
          a.happy = this.mood >= 50;
        }
        break;
      case 'climb': {
        // паучок забирается на дерево и спускается на паутинке
        flying = true;
        if (!T.st) {
          T.st = 'up';
          T.top = 22;
        }
        if (T.st === 'up') {
          a.z = Math.min(T.top, a.z + dt * 10);
          if (a.z >= T.top) {
            T.st = 'hang';
            T.t0 = T.t;
          }
          a.thread = null;
        } else {
          const k2 = T.t - T.t0;
          if (k2 < 2.5) a.z = T.top - (T.top - 11) * (k2 / 2.5);
          else if (k2 < 2.5 + T.d) a.z = 11 + Math.sin((k2 - 2.5) * 1.5);
          else a.z = Math.max(0, a.z - dt * 7);
          a.thread = T.top + 4;
          if (k2 > 2.5 + T.d && a.z <= 0) {
            a.thread = null;
            a.z = 0;
            done = true;
          }
        }
        state = 'idle';
        break;
      }
      case 'float': {
        flying = true;
        a.alpha = Math.min(0.85, a.alpha + dt);
        const dx = T.tx - a.x;
        const dy = T.ty - a.y;
        const d = Math.hypot(dx, dy);
        if (d > 1) {
          a.x += (dx / d) * Math.min(d, speed * dt);
          a.y += (dy / d) * Math.min(d, speed * dt);
          if (Math.abs(dx) > 0.3) a.dir = Math.sign(dx);
        }
        a.z = 12 + Math.sin(a.anim * 2) * 4;
        if (T.t > T.d) done = true;
        break;
      }
      case 'broom': {
        flying = true;
        const ang = T.t * 0.45;
        const nx = T.cx + Math.sin(ang) * 120;
        const ny = T.cy + Math.cos(ang * 0.8) * 50;
        a.dir = Math.cos(ang) >= 0 ? 1 : -1;
        const air = Math.max(0, Math.min(1, T.t / 1.5, (T.d - T.t) / 1.5));
        const k2 = Math.min(1, T.t / 1.5);
        a.x += (nx - a.x) * k2 * Math.min(1, dt * 3);
        a.y += (ny - a.y) * k2 * Math.min(1, dt * 3);
        a.z = air * (34 + Math.sin(T.t * 1.7) * 6);
        state = a.z > 3 ? 'fly' : 'idle';
        if (this.rand() < dt * 6 && state === 'fly') this.particles.push({ x: a.x - a.dir * 8, y: a.y, z: a.z, vx: -a.dir * 4, vy: 0, vz: 0, life: 0.8, kind: 'star', c: this.rand(), g: 0.1 });
        if (T.t > T.d) {
          this.placeNear(a, a.x, a.y);
          a.z = 0;
          done = true;
        }
        break;
      }
      case 'flyhigh': {
        flying = true;
        const air = Math.max(0, Math.min(1, T.t / 1.2, (T.d - T.t) / 1.2));
        const ang = T.t * 0.8;
        a.dir = Math.cos(ang) >= 0 ? 1 : -1;
        const tx = T.cx + Math.sin(ang) * 70;
        const ty = T.cy + Math.sin(ang * 2) * 20;
        a.x += (tx - a.x) * Math.min(1, dt * 2);
        a.y += (ty - a.y) * Math.min(1, dt * 2);
        a.z = air * (40 + Math.sin(T.t * 2) * 6);
        state = air > 0.05 ? 'fly' : 'idle';
        if (air > 0.8 && this.rand() < dt * 1.5) {
          a.fire = true;
          this.burst(a.x + a.dir * 12, a.y, a.z + 10, 'fire', 8, 30);
        }
        if (T.t > T.d) {
          this.placeNear(a, a.x, a.y);
          a.z = 0;
          done = true;
        }
        break;
      }
      case 'leave': {
        if (!T.started) {
          T.started = true;
          if (!this.route(a, this.map.spots.southExit.x, this.map.spots.southExit.y)) {
            done = true;
            break;
          }
        }
        if (this.walk(a, dt, speed * 1.2)) {
          a.hidden = true;
          a.path = null;
          a.task = { type: 'away', t: 0, side: T.side };
          this.visitor = { actor: a, kind: a.kind, u: a.u, side: T.side, t: 0, stage: 'in', x: 0, state: 'walk', dir: -T.side, knocks: 0, say: null, sayT: 0, emote: null, emoteT: 0, y: 0, vy: 0, ripples: [] };
          return;
        }
        moving = true;
        state = 'walk';
        if (T.t > 90) done = true;
        break;
      }
      case 'held':
        // висит в «руке»: болтает ногами
        flying = true;
        state = 'held';
        a.vz = 0;
        break;
      case 'fall':
        state = 'fall';
        if (KINDS[a.kind]?.floater) a.z = Math.max(0, a.z - dt * 40);
        if (T.t > 0.05 && a.z <= 0) {
          const [tx, ty] = this.tileOf(a.x, a.y);
          if (!walkable(this.map, tx, ty)) this.placeNear(a, a.x, a.y);
          this.burst(a.x, a.y, 0, 'dust', 8, 16);
          a.squash = 0.7;
          this.emote(a, this.rand() < 0.5 ? '!' : 'star', 1.4);
          this.say(a, this.pick(['Ой!', 'Уф!', 'Ещё разок!', 'Голова кружится…', 'Мягкая посадка!', 'Предупреждать надо!']), 2.2);
          a.task = { type: 'pose', pose: 'idle', d: 1.2, t: 0 };
          return;
        }
        break;
      case 'chore': {
        // дело у объекта: колодец, вода, лес, огород, котик
        state = T.act;
        if (T.face != null) a.dir = T.face > a.x ? 1 : -1;
        const beat = Math.floor(T.t * 2) !== Math.floor((T.t - dt) * 2);
        if (beat && (T.act === 'bucket' || T.act === 'water')) this.burst(a.x + a.dir * 6, a.y, T.act === 'water' ? 6 : 3, 'drop', 3, 14);
        if (beat && T.act === 'pet' && T.who && !T.who.hidden) {
          this.emote(T.who, 'heart', 1.2);
          if (Math.floor(T.t) % 2 === 0) this.emote(a, 'heart', 1.2);
        }
        if (T.act === 'fish' && !T.bite && T.t > T.d * 0.7 && this.rand() < 0.5) {
          T.bite = true;
          this.say(a, this.pick(['Клюёт!', 'Попалась!', 'Ух ты, рыбка!']), 2);
          this.burst(a.x + a.dir * 14, a.y - 4, 4, 'drop', 8, 20);
          this.particles.push({ x: a.x + a.dir * 14, y: a.y - 4, z: 4, vx: -a.dir * 10, vy: 0, vz: 60, life: 1.2, kind: 'fish', c: this.rand() });
        }
        if (T.t > T.d) {
          if (T.act === 'gather') {
            this.emote(a, 'star', 2);
            this.say(a, this.pick(['Грибы!', 'Сколько ягод!', 'Лес сегодня щедрый.', 'Нашла шишку!'].map((s) => (a.gender === 'm' ? s.replace('Нашла', 'Нашёл') : s))), 2.4);
          }
          if (T.act === 'water' && T.field) T.field.watered = this.t;
          if (T.who) T.who.task = null;
          done = true;
        }
        break;
      }
      case 'away':
        state = 'idle';
        if (!this.visitor || this.visitor.actor !== a) {
          a.hidden = false;
          a.alpha = 1;
          a.x = this.map.spots.southExit.x;
          a.y = this.map.spots.southExit.y;
          a.queue = [this.go(this.map.spots.plaza.x, this.map.spots.plaza.y + 10)];
          done = true;
        }
        break;
      default:
        done = true;
    }
    if (done) {
      a.task = null;
      if (T.type === 'go' || T.type === 'chase' || T.type === 'leave') a.path = null;
    }
    if (a.kind === 'ghost') a.hidden = a.alpha <= 0.02;
    // высота: прыжки и падение
    if (!flying && !KINDS[a.kind]?.floater) {
      if (a.z > 0 || a.vz !== 0) {
        a.vz -= GRAVITY * dt;
        a.z += a.vz * dt;
        if (a.z <= 0) {
          if (a.vz < -70) {
            if (a.u > 1) this.burst(a.x, a.y, 0, 'dust', 6, 14);
            if (a.kind === 'slime' || a.kind === 'shroom') a.squash = 0.7;
          }
          a.z = 0;
          a.vz = 0;
        }
      }
    }
    a.state = a.z > 0.5 && !flying && T.type !== 'celebrate' && T.type !== 'fall' ? 'jump' : state;
    if (moving) a.phase = (a.phase + (dt * speed) / (8 * a.u)) % 1;
  }

  // ---------- Гость у экрана ----------

  /** Отправить жителя к экрану (по тропинке в лес на юг). Можно вызвать вручную; иначе — само раз в несколько минут. */
  sendVisitor(who = null, auto = false) {
    if (this.visitor || this.actors.some((x) => x.task?.type === 'leave')) return false;
    let pool = this.actors.filter((a) => !a.hidden && !a.held && (!a.talking || a === who) && !['inside', 'leave', 'away'].includes(a.task?.type) && a.kind !== 'ghost' && a.kind !== 'spider');
    // сами стучат только хранители, у чьих списков есть невыполненные задачи
    if (auto) pool = pool.filter((a) => this.alertOf(a) > 0);
    if (!pool.length) return false;
    const grounded = pool.filter((x) => x.z <= 0);
    const a = who && pool.includes(who) ? who : this.pick(grounded.length ? grounded : pool);
    this.release(a);
    if (a.z > 0 || ['broom', 'flyhigh', 'climb'].includes(a.task?.type)) {
      this.placeNear(a, a.x, a.y);
      a.z = 0;
      a.vz = 0;
    }
    const side = a.x < this.W / 2 ? -1 : 1;
    a.queue = [];
    a.path = null;
    a.thread = null;
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
        this.sendVisitor(null, true);
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
    if (v.y > 0 || v.vy > 0) {
      v.vy -= GRAVITY * 1.4 * dt;
      v.y = Math.max(0, v.y + v.vy * dt);
      if (v.y === 0) v.vy = 0;
    }
    const sp = 0.32;
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
        const n = this.alertOf(v.actor);
        v.say = n && v.actor.listName ? `Тук-тук! «${v.actor.listName}»: ждут ${n}` : this.pick(this.mood < 30 ? ['Тук-тук… Мы скучаем', 'Эй! Задачки ждут', ...KNOCK] : KNOCK);
        v.sayT = 3.5;
        v.stay = n ? 7 : 1.6; // с делами — подольше: можно нажать и поговорить
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
    } else if (v.stage === 'talk') {
      v.state = 'idle';
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
