// Хранители навыков (обновление 0.8): у каждого списка в деревне живёт свой житель. Всё детерминировано из списка:
// имя, внешность (цвет одежды — цвет списка, роль — по эмодзи списка), «возраст» — по уровню и престижу навыка
// (ученик → подмастерье → знаток → мастер → магистр), симпатия — по числу выполненных задач списка. Ничего не хранится.
// Без DOM.

import { STAGES } from '../core/skills.js';

export const MAX_KEEPERS = 12;

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const NAMES_F = ['Мира', 'Ника', 'Ая', 'Рина', 'Кира', 'Юна', 'Лея', 'Тая', 'Мэй', 'Ива', 'Лина', 'Эми', 'Вета', 'Зоя', 'Аля', 'Сора'];
const NAMES_M = ['Тим', 'Лёва', 'Сева', 'Рэн', 'Кай', 'Арс', 'Тео', 'Лука', 'Даня', 'Ян', 'Эрик', 'Мио'];
const HAIR = ['#4a2f2a', '#23202e', '#e9b54e', '#cf7a34', '#e07aa8', '#9a7ae0', '#5fa4dc', '#ece6dc', '#4f8a5a', '#c24840', '#3a3f6a', '#f0a0c0'];
const EYES = ['#3f6fd0', '#c84a72', '#2f9a6e', '#8a52d8', '#d8962a', '#7a4a32', '#3aa8b8', '#d04a3a'];
const SKIN = ['#ffe3cf', '#fbd6bc', '#f2c7a2', '#e8b58e'];
const STYLES_F = ['twintails', 'long', 'bob', 'ponytail', 'bun', 'side'];
const STYLES_M = ['short', 'spiky', 'messy', 'short'];

/** Роль хранителя по эмодзи (и названию) списка: от неё зависят головной убор и предмет в руках. */
// эмодзи — строками без «вариационных селекторов» (иначе ❤️ совпадёт с ✏️ по общему U+FE0F)
const ROLES = [
  ['scholar', ['🎓', '📚', '📖', '✏', '📝', '🧠', '🔬', '🧪', '📐'], /учеб|универ|пересдач|экзам|курс|школ|сесси/i],
  ['home', ['🏠', '🏡', '🧹', '🍳', '🧺', '🛒', '🪴'], /дом|быт|уборк/i],
  ['creator', ['🎬', '📹', '🎥', '📺', '▶', '📷'], /youtube|видео|блог|канал/i],
  ['gamer', ['🎮', '🕹', '👾'], /игр/i],
  ['sport', ['💪', '🏋', '⚽', '🏃', '🚴', '🧘', '🏀', '🎾'], /спорт|трен|зал|бег/i],
  ['office', ['💼', '📈', '💰', '🧾', '🏦'], /работ|офис|финанс|деньг/i],
  ['artist', ['🎨', '🖌', '🖍', '✂', '🧵'], /рисов|арт|дизайн/i],
  ['music', ['🎵', '🎸', '🎹', '🎧', '🎤'], /музык|гитар/i],
  ['health', ['❤', '🩺', '💊', '🏥', '🍎'], /здоров|врач/i],
  ['garden', ['🌱', '🌿', '🌻', '🌳'], /сад|огород|растен/i],
];
const FALLBACK = ['adventurer', 'scholar', 'artist', 'garden', 'music'];

export function roleOf(list) {
  const emoji = list.emoji || '';
  for (const [role, marks] of ROLES) if (marks.some((m) => emoji.includes(m))) return role;
  for (const [role, , re] of ROLES) if (re.test(list.name || '')) return role;
  return FALLBACK[hash(list.id) % FALLBACK.length];
}

export const ROLE_NAMES = {
  scholar: 'учёная душа', home: 'хозяйка уюта', creator: 'создатель роликов', gamer: 'игрок', sport: 'спортсмен', office: 'деловой человек',
  artist: 'художник', music: 'музыкант', health: 'лекарь', garden: 'садовник', adventurer: 'искатель приключений',
};

/** Внешность чиби (village/chibi.js) по списку. stage — «возраст» 0…4. */
export function keeperLook(list, gender, stage) {
  const h = hash(list.id);
  const role = roleOf(list);
  const look = {
    skin: SKIN[(h >>> 3) % SKIN.length],
    hair: HAIR[(h >>> 5) % HAIR.length],
    eyes: EYES[(h >>> 9) % EYES.length],
    style: gender === 'f' ? STYLES_F[(h >>> 13) % STYLES_F.length] : STYLES_M[(h >>> 13) % STYLES_M.length],
    top: list.color || '#5c6bc0',
    bottom: gender === 'f' ? 'skirt' : 'pants',
    gender,
    stage,
    role,
  };
  if (role === 'scholar') Object.assign(look, { glasses: (h >>> 17) % 2 === 0, hat: (h >>> 18) % 3 === 0 ? 'gradcap' : null, prop: 'book' });
  else if (role === 'home') Object.assign(look, { apron: true, hat: 'bandana', prop: 'broomsmall' });
  else if (role === 'creator') Object.assign(look, { hat: 'beret', prop: 'camera' });
  else if (role === 'gamer') Object.assign(look, { hat: 'headphones', prop: 'gamepad' });
  else if (role === 'sport') Object.assign(look, { hat: 'headband', sporty: true, prop: 'ball' });
  else if (role === 'office') Object.assign(look, { tie: true, prop: 'folder' });
  else if (role === 'artist') Object.assign(look, { hat: 'beret', prop: 'brush' });
  else if (role === 'music') Object.assign(look, { hat: 'headphones', prop: 'note' });
  else if (role === 'health') Object.assign(look, { hat: 'nursecap', prop: 'heart' });
  else if (role === 'garden') Object.assign(look, { hat: 'straw', prop: 'flower' });
  else Object.assign(look, { hat: gender === 'f' ? 'bow' : null, prop: 'map' });
  if (gender === 'f' && !look.hat) look.hat = 'bow';
  return look;
}

/** Хранитель списка: { id, listId, name, gender, look, stage, title, role, affinity }. skill — из core/skills.js. */
export function keeperOf(list, skill) {
  if (!list || list.deletedAt) return null;
  const h = hash(list.id);
  const gender = h % 3 === 0 ? 'm' : 'f';
  const name = gender === 'f' ? NAMES_F[(h >>> 7) % NAMES_F.length] : NAMES_M[(h >>> 7) % NAMES_M.length];
  const stage = skill ? skill.stage : 0;
  return {
    id: 'keeper:' + list.id, listId: list.id, listName: list.name, name, gender, stage,
    title: STAGES[stage][gender], role: roleOf(list), look: keeperLook(list, gender, stage), affinity: skill?.affinity || null, skill,
  };
}

/** Хранители всех живых неархивных списков (по порядку списков, не больше MAX_KEEPERS). skills — Map из allSkills. */
export function keepersOf(data, skills) {
  const lists = [...data.lists.values()].filter((l) => !l.deletedAt && !l.archived)
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.id < b.id ? -1 : 1));
  const used = new Set();
  return lists.slice(0, MAX_KEEPERS).map((l) => {
    const k = keeperOf(l, skills.get(l.id));
    // имена не повторяются: при совпадении — следующее имя из того же списка имён
    const pool = k.gender === 'f' ? NAMES_F : NAMES_M;
    let i = pool.indexOf(k.name);
    for (let n = 0; used.has(k.name) && n < pool.length; n++) k.name = pool[(i = (i + 1) % pool.length)];
    used.add(k.name);
    return k;
  });
}

/** Имя хранителя списка с учётом остальных списков (как в деревне). */
export function keeperName(data, listId, skills) {
  return keepersOf(data, skills).find((k) => k.listId === listId)?.name || null;
}
