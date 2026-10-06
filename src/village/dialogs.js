// Диалоги жителей «как в новеллах» (обновление 0.8): дерево реплик с выбором ответа. Чистые функции без DOM:
// talkTree(ctx) → { nodes, start }. Узел: { lines: [{ t, e }], choices: [{ label, go | act, close }] }.
// e — эмоция портрета (village/portraits.js). Реплики зависят от симпатии (0…5 — по выполненным задачам),
// «возраста» хранителя, дел в его списке, настроения деревни и времени суток. Отношения — дружеские.

import { STAGES, roman, MAX_LEVEL } from '../core/skills.js';
import { countLabel } from '../core/plural.js';

/** Жители из магазина: имя, кто такой, пол (для «рад/рада»), характер. */
export const RESIDENTS = {
  wanderer: { name: 'Странник', title: 'старожил деревни', gender: 'm', bio: 'Я хожу по дорогам и собираю истории. Здесь мне нравится: тут всё растёт вместе с тобой.' },
  miner: { name: 'Гоша', title: 'шахтёр', gender: 'm', bio: 'Шахта — дело тонкое: кирку держи крепче, а лампу — ярче. Каждая важная задача — как самоцвет в породе.' },
  builder: { name: 'Мира', title: 'строитель', gender: 'f', bio: 'Каждый дом начинается с одного гвоздя. Как и любой проект — с одной маленькой задачи.' },
  archer: { name: 'Ветка', title: 'лучница', gender: 'f', bio: 'Главное в стрельбе — ровное дыхание и цель, которую видишь чётко. С задачами точно так же.' },
  witch: { name: 'Полынь', title: 'ведьма', gender: 'f', bio: 'Рецепт зелья усердия: щепотка фокуса, ложка терпения и ни капли прокрастинации. Хе-хе.' },
  knight: { name: 'Тяж', title: 'рыцарь', gender: 'm', bio: 'Я охраняю деревню днём и ночью. От лени — особенно тщательно.' },
  neko: { name: 'Нэко', title: 'хранительница планов', gender: 'f', bio: 'Ня! Хорошо спланированный день — самый вкусный. Я слежу, чтобы ни один план не потерялся~' },
  cat: { name: 'Баюн', title: 'кот', gender: 'm', beast: true, bio: '*Баюн щурится на солнце и громко мурлычет.* Мрр. (Кажется, он говорит: «Отдых — тоже важное дело».)' },
  kitten: { name: 'Пиксель', title: 'котёнок', gender: 'm', beast: true, bio: '*Пиксель гоняется за собственным хвостом, спотыкается и делает вид, что так и задумано.* Мя!' },
  fox: { name: 'Искра', title: 'лисичка', gender: 'f', beast: true, bio: '*Искра роет ямку и прячет туда что-то блестящее.* Фыр! (Секрет. Но тебе, может, когда-нибудь покажет.)' },
  spider: { name: 'Ниточка', title: 'паучок', gender: 'f', bio: 'Я плету паутинку из планов. Ни одна задача не проскочит мимо!' },
  shroom: { name: 'Пуф', title: 'грибочек', gender: 'm', bio: 'Я гриб. Расту после дождика. И после выполненных задач — тоже. Боинг!' },
  slime: { name: 'Желейка', title: 'слизнюк', gender: 'f', bio: 'Блоб! Я мягкая, круглая и счастливая. Особенно когда ты закрываешь задачи. Плюх!' },
  ghost: { name: 'Шу', title: 'призрак', gender: 'm', bio: 'У-у-у… Не бойся, я добрый. Просто люблю ночь и тихие звёзды над крышами.' },
  dragon: { name: 'Уголёк', title: 'дракончик', gender: 'm', bio: 'Я грозный дракон! …Ну, почти. Когда ты закрываешь важные задачи, я взлетаю от радости!' },
};

const ROLE_BIO = {
  scholar: 'Я обожаю книги и конспекты. Если разбить большую тему на маленькие задачи — она сдаётся без боя.',
  home: 'Уют — это когда всё на своих местах. Давай наводить порядок понемножку, каждый день?',
  creator: 'Я снимаю ролики о нашей деревне. Каждая закрытая задача — ещё один удачный кадр.',
  gamer: 'Жизнь — это игра, а задачи — квесты. Мы с тобой фармим опыт, и это честный фарм!',
  sport: 'Раз-два, вдох-выдох! Сила — в регулярности, а не в рывках.',
  office: 'Планы, отчёты, сроки — люблю, когда всё разложено по полочкам.',
  artist: 'Я рисую всё, что вижу. Особенно закаты над нашей деревней.',
  music: 'Каждый выполненный пункт звучит как нота. Вместе получается мелодия.',
  health: 'Береги себя: вода, сон, прогулка. Задачи подождут пять минут — а ты важнее.',
  garden: 'Растения учат терпению. Большие цели растут так же — медленно, но верно.',
  adventurer: 'Я ищу приключения. Каждый список — как карта неизведанных земель!',
};

const STAGE_LINE = [
  (g) => `Я пока ${g('ученик', 'ученица')}, но обязательно вырасту. Чем выше навык, тем старше и опытнее я становлюсь!`,
  () => 'Я уже подмастерье — кое-что умею! Если навык дорастёт до 60-го уровня, стану знатоком.',
  () => 'Говорят, я теперь знаток. Приятно! А на сотом уровне ты сможешь повысить престиж — и я стану мастером.',
  (g) => `Мастер! Кто бы мог подумать. Я ${g('сам', 'сама')} себе иногда не верю.`,
  () => 'Магистр… Звучит очень важно. Но я всё ещё помню, как мы начинали с пары задач.',
];

const DEEP = [
  null,
  null,
  (c) => `Мне нравится, как у тебя получается с «${c.list}». Я это замечаю, правда.`,
  (c) => `Знаешь, раньше я ${c.g('боялся', 'боялась')} больших дел. Но мы справляемся — по одной задаче за раз.`,
  (c) => `Ты для меня не просто «тот, кто ведёт список». Ты друг. Спасибо, что возвращаешься.`,
  () => 'Помнишь, как всё начиналось? Мы прошли длинный путь. Я горжусь нами — и тобой.',
];

const pick = (arr, seed) => arr[Math.abs(seed | 0) % arr.length];
const hearts = (tier) => '♥'.repeat(tier) + '♡'.repeat(5 - tier);

/**
 * Дерево разговора. ctx: {
 *   who: { kind, name, title, gender, keeper (bool), role, stage, listId, listName },
 *   affinity: { tier, name, toNext }, skill?: { level, prestige, roman, into, need, max, done },
 *   tasks?: { open, overdue, today, next: { id, title } | null }, mood (0…100), night (0…1), focus (bool), seed,
 * }
 */
export function talkTree(ctx) {
  const w = ctx.who;
  const g = (m, f) => (w.gender === 'm' ? m : f);
  const tier = ctx.affinity?.tier || 0;
  const list = w.listName || '';
  const c = { ...ctx, g, list };
  const beast = !!RESIDENTS[w.kind]?.beast;
  const seed = ctx.seed || 0;
  const nodes = {};
  const back = { label: 'Ещё вопрос…', go: 'more' };

  // ---- приветствие ----
  const hello = [];
  if (beast) {
    hello.push({ t: pick([`*${w.name} поднимает голову и смотрит на тебя.*`, `*${w.name} подбегает поближе.*`, `*${w.name} радостно виляет хвостом.*`], seed), e: tier >= 2 ? 'smile' : 'neutral' });
  } else if (w.keeper) {
    const greet = [
      `Ой, привет! Я ${w.name}, ${w.title.toLowerCase()}. Я слежу за навыком «${list}» — будем знакомы!`,
      `Привет! ${g('Рад', 'Рада')} тебя видеть. Как там «${list}»?`,
      `О, привет! Я как раз ${g('думал', 'думала')} о наших делах в «${list}».`,
      'Привет, друг! Отличный день, чтобы что-нибудь закрыть.',
      `Ты здесь! Я уже ${g('соскучился', 'соскучилась')}.`,
      'Мой лучший напарник! Ну что, покорим ещё пару задач?',
    ];
    hello.push({ t: greet[tier], e: tier === 0 ? 'surprised' : tier >= 3 ? 'grin' : 'smile' });
  } else {
    const greet = [
      `Привет! Я ${w.name}, ${w.title}. Будем знакомы.`,
      `Привет-привет! ${g('Рад', 'Рада')} тебя видеть.`,
      'О, это ты! Заходи, поболтаем.',
      'Привет, друг! Как же хорошо, что ты заглянул(а).',
      `Ура, ты пришёл(а)! Я ${g('ждал', 'ждала')}.`,
      'Лучший друг деревни! Что расскажешь?',
    ];
    hello.push({ t: greet[tier], e: tier === 0 ? 'neutral' : tier >= 3 ? 'grin' : 'smile' });
  }
  if (ctx.knock && w.keeper && ctx.tasks?.open) {
    // постучал в экран сам: пришёл напомнить про невыполненное
    hello.unshift({ t: `Тук-тук! Это я, ${w.name}. ${g('Пришёл', 'Пришла')} напомнить: в «${list}» ещё ${countLabel(ctx.tasks.open, ['задача', 'задачи', 'задач'])}${ctx.tasks.overdue ? `, просрочено ${ctx.tasks.overdue}` : ''}.`, e: ctx.tasks.overdue ? 'sad' : 'smile' });
  } else if (ctx.knock) hello.unshift({ t: beast ? `*${w.name} стучит лапкой по стеклу.*` : `Тук-тук! ${g('Решил', 'Решила')} заглянуть к тебе.`, e: 'grin' });
  if (ctx.night > 0.6 && !beast) hello.push({ t: 'Уже поздно… Не засиживайся, ладно? Отдых — тоже часть плана.', e: 'neutral' });
  if (w.keeper && ctx.tasks?.overdue) hello.push({ t: `Кстати, в «${list}» ${countLabel(ctx.tasks.overdue, ['задача просрочена', 'задачи просрочены', 'задач просрочено'])}. Может, начнём с них?`, e: 'sad' });

  const menu = () => {
    const ch = [{ label: beast ? 'Погладить' : 'Как дела?', go: beast ? 'pat' : 'how' }];
    if (w.keeper) ch.push({ label: 'Что у нас по делам?', go: 'tasks' }, { label: 'Как мой навык?', go: 'skill' });
    ch.push({ label: beast ? 'Кто ты?' : 'Расскажи о себе', go: 'about' });
    if (!beast) ch.push({ label: tier >= 2 ? 'Дай пять!' : 'Помахать', go: 'pat' });
    ch.push({ label: 'Подойди к экрану', go: 'come' }, { label: 'Пока!', go: 'bye' });
    return ch;
  };
  nodes.hello = { lines: hello, choices: menu() };
  nodes.more = { lines: [{ t: beast ? `*${w.name} ждёт, что будет дальше.*` : pick(['Что-то ещё?', 'Спрашивай!', 'Слушаю~'], seed + 1), e: 'smile' }], choices: menu() };

  // ---- как дела ----
  const how = [];
  if (ctx.mood < 25) how.push({ t: 'Честно? Грустновато. Задачи копятся, и в деревне всем немного тревожно.', e: 'sad' });
  else if (ctx.mood < 60) how.push({ t: pick(['Нормально! Тихий, спокойный день.', 'Неплохо. Работаем потихоньку.'], seed), e: 'neutral' });
  else how.push({ t: pick(['Отлично! Деревня просто светится.', 'Прекрасно! Все вокруг довольные — это ты постарался(ась).'], seed), e: 'grin' });
  if (ctx.focus) how.push({ t: 'А ещё ты сейчас в фокусе — я тихонько болею за тебя!', e: 'smile' });
  if (w.keeper && ctx.tasks?.today) how.push({ t: `Сегодня в «${list}» уже ${countLabel(ctx.tasks.today, ['задача выполнена', 'задачи выполнены', 'задач выполнено'])}. Так держать!`, e: 'grin' });
  nodes.how = { lines: how, choices: [back, { label: 'Пока!', go: 'bye' }] };

  // ---- дела в списке ----
  if (w.keeper) {
    const t = ctx.tasks || { open: 0, overdue: 0, next: null };
    const lines = [];
    if (!t.open) lines.push({ t: `В «${list}» сейчас нет открытых задач. Чистота! Можно добавить новую — или просто отдохнуть.`, e: 'grin' });
    else {
      lines.push({ t: `В «${list}» ${countLabel(t.open, ['открытая задача', 'открытые задачи', 'открытых задач'])}${t.overdue ? `, из них просрочено ${t.overdue}` : ''}.`, e: t.overdue ? 'sad' : 'neutral' });
      if (t.next) lines.push({ t: `Я бы ${g('начал', 'начала')} с «${t.next.title}». Возьмёмся?`, e: 'smile' });
    }
    const ch = [{ label: 'Открыть список', act: 'openList', close: true }];
    if (t.next) ch.push({ label: `Фокус на «${t.next.title.length > 24 ? t.next.title.slice(0, 23) + '…' : t.next.title}»`, act: 'focus', close: true });
    ch.push(back);
    nodes.tasks = { lines, choices: ch };

    // ---- навык ----
    const s = ctx.skill || { level: 1, prestige: 0, roman: '', into: 0, need: 20, max: false, done: 0 };
    const sl = [{ t: `Навык «${list}»: ${s.prestige ? `престиж ${s.roman}, ` : ''}уровень ${s.level}. Всего выполнено задач: ${s.done}.`, e: 'neutral' }];
    if (s.max) sl.push({ t: `Мы на вершине — ${MAX_LEVEL}-й уровень! Можно повысить престиж: уровень начнётся заново, а рядом с названием появится ${roman(s.prestige + 1)}. И я повзрослею.`, e: 'grin' });
    else sl.push({ t: `До ${s.level + 1}-го уровня — ещё ${s.need - s.into} опыта. Опыт дают задачи этого списка: чем важнее, тем больше.`, e: 'smile' });
    sl.push({ t: STAGE_LINE[w.stage || 0](g), e: 'smile' });
    const sch = [];
    if (s.max) sch.push({ label: `✨ Повысить престиж (${roman(s.prestige + 1)})`, act: 'prestige', close: true });
    sch.push(back);
    nodes.skill = { lines: sl, choices: sch };
  }

  // ---- о себе ----
  const about = [];
  const bio = w.keeper ? ROLE_BIO[w.role] || ROLE_BIO.adventurer : RESIDENTS[w.kind]?.bio || RESIDENTS.wanderer.bio;
  if (w.keeper && tier === 0) {
    about.push({ t: `Я ${w.title.toLowerCase()} по части «${list}». Мы только знакомимся — выполняй задачи из этого списка, и я расскажу больше.`, e: 'blush' });
  } else {
    about.push({ t: bio, e: 'smile' });
    const deep = DEEP[tier] && !beast ? DEEP[tier](c) : null;
    if (deep) about.push({ t: deep, e: tier >= 4 ? 'blush' : 'smile' });
  }
  if (ctx.affinity) {
    const a = ctx.affinity;
    about.push({ t: a.next == null ? `Наша дружба: ${hearts(a.tier)} — «${a.name}». Больше уже некуда!` : `Наша дружба: ${hearts(a.tier)} — «${a.name}». Ещё ${countLabel(a.toNext, ['задача', 'задачи', 'задач'])}${w.keeper ? ` из «${list}»` : ''} — и станем ближе.`, e: 'closed' });
  }
  nodes.about = { lines: about, choices: [back, { label: 'Пока!', go: 'bye' }] };

  // ---- погладить / дать пять ----
  const pat = beast
    ? [`*${w.name} довольно жмурится.*`, `*${w.name} мурчит… или фырчит… в общем, доволен(льна).*`, `*${w.name} подставляет голову под ладонь.*`]
    : ['Э-э… привет?', 'Хи-хи, ты чего!', 'Дай пять! ✋', 'Ура! Лучший напарник!', '*радостно подпрыгивает* Ещё!', '*обнимает тебя за плечи* Спасибо, что ты есть.'];
  nodes.pat = { lines: [{ t: beast ? pick(pat, seed) : pat[tier], e: beast ? 'closed' : tier === 0 ? 'surprised' : tier >= 2 ? 'grin' : 'smile' }], act: 'poke', choices: [back, { label: 'Пока!', go: 'bye' }] };

  nodes.come = { lines: [{ t: beast ? `*${w.name} бежит к краю экрана.*` : pick(['Иду-иду! Сейчас постучу тебе по стеклу.', 'Уже бегу к экрану!'], seed), e: 'grin' }], act: 'come', choices: [{ label: 'Жду!', close: true }] };
  nodes.bye = { lines: [{ t: beast ? `*${w.name} провожает тебя взглядом.*` : pick(['Пока! Возвращайся!', 'До встречи! Удачи с задачами!', 'Пока-пока~'], seed), e: 'smile' }], choices: [{ label: 'До встречи', close: true }] };
  return { nodes, start: 'hello' };
}

/** Подпись под именем: «Подмастерье · «Универ»» или «шахтёр». */
export function whoTitle(w) {
  if (w.keeper) return `${STAGES[w.stage || 0][w.gender]} · «${w.listName}»`;
  return RESIDENTS[w.kind]?.title || '';
}

export { hearts };
