// Диалоги жителей «как в новеллах» (обновление 0.8): дерево реплик с выбором ответа. Чистые функции без DOM:
// talkTree(ctx) → { nodes, start }. Узел: { lines: [{ t, e }], choices: [{ label, go | act, close }] }.
// e — эмоция портрета (village/portraits.js). Реплики зависят от симпатии (0…5 — по выполненным задачам),
// «возраста» хранителя, дел в его списке, настроения деревни и времени суток. Отношения — дружеские.

import { STAGES, roman, MAX_LEVEL } from '../core/skills.js';
import { countLabel } from '../core/plural.js';
import { tr, LANG } from '../core/i18n.js';

/** Жители из магазина: имя, кто такой, пол (для «рад/рада»), характер. */
export const RESIDENTS = {
  wanderer: { name: tr('Странник'), title: tr('старожил деревни'), gender: 'm', bio: tr('Я хожу по дорогам и собираю истории. Здесь мне нравится: тут всё растёт вместе с тобой.') },
  miner: { name: tr('Гоша'), title: tr('шахтёр'), gender: 'm', bio: tr('Шахта — дело тонкое: кирку держи крепче, а лампу — ярче. Каждая важная задача — как самоцвет в породе.') },
  builder: { name: tr('Мира'), title: tr('строитель'), gender: 'f', bio: tr('Каждый дом начинается с одного гвоздя. Как и любой проект — с одной маленькой задачи.') },
  archer: { name: tr('Ветка'), title: tr('лучница'), gender: 'f', bio: tr('Главное в стрельбе — ровное дыхание и цель, которую видишь чётко. С задачами точно так же.') },
  witch: { name: tr('Полынь'), title: tr('ведьма'), gender: 'f', bio: tr('Рецепт зелья усердия: щепотка фокуса, ложка терпения и ни капли прокрастинации. Хе-хе.') },
  knight: { name: tr('Тяж'), title: tr('рыцарь'), gender: 'm', bio: tr('Я охраняю деревню днём и ночью. От лени — особенно тщательно.') },
  neko: { name: tr('Нэко'), title: tr('хранительница планов'), gender: 'f', bio: tr('Ня! Хорошо спланированный день — самый вкусный. Я слежу, чтобы ни один план не потерялся~') },
  cat: { name: tr('Баюн'), title: tr('кот'), gender: 'm', beast: true, bio: tr('*Баюн щурится на солнце и громко мурлычет.* Мрр. (Кажется, он говорит: «Отдых — тоже важное дело».)') },
  kitten: { name: tr('Пиксель'), title: tr('котёнок'), gender: 'm', beast: true, bio: tr('*Пиксель гоняется за собственным хвостом, спотыкается и делает вид, что так и задумано.* Мя!') },
  fox: { name: tr('Искра'), title: tr('лисичка'), gender: 'f', beast: true, bio: tr('*Искра роет ямку и прячет туда что-то блестящее.* Фыр! (Секрет. Но тебе, может, когда-нибудь покажет.)') },
  spider: { name: tr('Ниточка'), title: tr('паучок'), gender: 'f', bio: tr('Я плету паутинку из планов. Ни одна задача не проскочит мимо!') },
  shroom: { name: tr('Пуф'), title: tr('грибочек'), gender: 'm', bio: tr('Я гриб. Расту после дождика. И после выполненных задач — тоже. Боинг!') },
  slime: { name: tr('Желейка'), title: tr('слизнюк'), gender: 'f', bio: tr('Блоб! Я мягкая, круглая и счастливая. Особенно когда ты закрываешь задачи. Плюх!') },
  ghost: { name: tr('Шу'), title: tr('призрак'), gender: 'm', bio: tr('У-у-у… Не бойся, я добрый. Просто люблю ночь и тихие звёзды над крышами.') },
  dragon: { name: tr('Уголёк'), title: tr('дракончик'), gender: 'm', bio: tr('Я грозный дракон! …Ну, почти. Когда ты закрываешь важные задачи, я взлетаю от радости!') },
};

const ROLE_BIO = {
  scholar: tr('Я обожаю книги и конспекты. Если разбить большую тему на маленькие задачи — она сдаётся без боя.'),
  home: tr('Уют — это когда всё на своих местах. Давай наводить порядок понемножку, каждый день?'),
  creator: tr('Я снимаю ролики о нашей деревне. Каждая закрытая задача — ещё один удачный кадр.'),
  gamer: tr('Жизнь — это игра, а задачи — квесты. Мы с тобой фармим опыт, и это честный фарм!'),
  sport: tr('Раз-два, вдох-выдох! Сила — в регулярности, а не в рывках.'),
  office: tr('Планы, отчёты, сроки — люблю, когда всё разложено по полочкам.'),
  artist: tr('Я рисую всё, что вижу. Особенно закаты над нашей деревней.'),
  music: tr('Каждый выполненный пункт звучит как нота. Вместе получается мелодия.'),
  health: tr('Береги себя: вода, сон, прогулка. Задачи подождут пять минут — а ты важнее.'),
  garden: tr('Растения учат терпению. Большие цели растут так же — медленно, но верно.'),
  adventurer: tr('Я ищу приключения. Каждый список — как карта неизведанных земель!'),
};

const STAGE_LINE = [
  (g) => tr('Я пока {p0}, но обязательно вырасту. Чем выше навык, тем старше и опытнее я становлюсь!', { p0: g(tr('ученик'), tr('ученица')) }),
  () => tr('Я уже подмастерье — кое-что умею! Если навык дорастёт до 60-го уровня, стану знатоком.'),
  () => tr('Говорят, я теперь знаток. Приятно! А на сотом уровне ты сможешь повысить престиж — и я стану мастером.'),
  (g) => tr('Мастер! Кто бы мог подумать. Я {p0} себе иногда не верю.', { p0: g(tr('сам'), tr('сама')) }),
  () => tr('Магистр… Звучит очень важно. Но я всё ещё помню, как мы начинали с пары задач.'),
];

const DEEP = [
  null,
  null,
  (c) => tr('Мне нравится, как у тебя получается с «{list}». Я это замечаю, правда.', { list: c.list }),
  (c) => tr('Знаешь, раньше я {p0} больших дел. Но мы справляемся — по одной задаче за раз.', { p0: c.g(tr('боялся'), tr('боялась')) }),
  (c) => tr('Ты для меня не просто «тот, кто ведёт список». Ты друг. Спасибо, что возвращаешься.'),
  () => tr('Помнишь, как всё начиналось? Мы прошли длинный путь. Я горжусь нами — и тобой.'),
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
  const back = { label: tr('Ещё вопрос…'), go: 'more' };

  // ---- приветствие ----
  const hello = [];
  if (beast) {
    hello.push({ t: pick([tr('*{name} поднимает голову и смотрит на тебя.*', { name: w.name }), tr('*{name} подбегает поближе.*', { name: w.name }), tr('*{name} радостно виляет хвостом.*', { name: w.name })], seed), e: tier >= 2 ? 'smile' : 'neutral' });
  } else if (w.keeper) {
    const greet = [
      tr('Ой, привет! Я {name}, {p1}. Я слежу за навыком «{list}» — будем знакомы!', { name: w.name, p1: w.title.toLowerCase(), list }),
      tr('Привет! {p0} тебя видеть. Как там «{list}»?', { p0: g(tr('Рад'), tr('Рада')), list }),
      tr('О, привет! Я как раз {p0} о наших делах в «{list}».', { p0: g(tr('думал'), tr('думала')), list }),
      tr('Привет, друг! Отличный день, чтобы что-нибудь закрыть.'),
      tr('Ты здесь! Я уже {p0}.', { p0: g(tr('соскучился'), tr('соскучилась')) }),
      tr('Мой лучший напарник! Ну что, покорим ещё пару задач?'),
    ];
    hello.push({ t: greet[tier], e: tier === 0 ? 'surprised' : tier >= 3 ? 'grin' : 'smile' });
  } else {
    const greet = [
      tr('Привет! Я {name}, {title}. Будем знакомы.', { name: w.name, title: w.title }),
      tr('Привет-привет! {p0} тебя видеть.', { p0: g(tr('Рад'), tr('Рада')) }),
      tr('О, это ты! Заходи, поболтаем.'),
      tr('Привет, друг! Как же хорошо, что ты заглянул(а).'),
      tr('Ура, ты пришёл(а)! Я {p0}.', { p0: g(tr('ждал'), tr('ждала')) }),
      tr('Лучший друг деревни! Что расскажешь?'),
    ];
    hello.push({ t: greet[tier], e: tier === 0 ? 'neutral' : tier >= 3 ? 'grin' : 'smile' });
  }
  if (ctx.knock && w.keeper && ctx.tasks?.open) {
    // постучал в экран сам: пришёл напомнить про невыполненное
    hello.unshift({ t: tr('Тук-тук! Это я, {name}. {p1} напомнить: в «{list}» ещё {p3}{p4}.', { name: w.name, p1: g(tr('Пришёл'), tr('Пришла')), list, p3: countLabel(ctx.tasks.open, ['задача', 'задачи', 'задач']), p4: ctx.tasks.overdue ? tr(', просрочено {overdue}', { overdue: ctx.tasks.overdue }) : '' }), e: ctx.tasks.overdue ? 'sad' : 'smile' });
  } else if (ctx.knock) hello.unshift({ t: beast ? tr('*{name} стучит лапкой по стеклу.*', { name: w.name }) : tr('Тук-тук! {p0} заглянуть к тебе.', { p0: g(tr('Решил'), tr('Решила')) }), e: 'grin' });
  if (ctx.night > 0.6 && !beast) hello.push({ t: tr('Уже поздно… Не засиживайся, ладно? Отдых — тоже часть плана.'), e: 'neutral' });
  if (w.keeper && ctx.tasks?.overdue) hello.push({ t: tr('Кстати, в «{list}» {p1}. Может, начнём с них?', { list, p1: countLabel(ctx.tasks.overdue, ['задача просрочена', 'задачи просрочены', 'задач просрочено']) }), e: 'sad' });

  const menu = () => {
    const ch = [{ label: beast ? tr('Погладить') : tr('Как дела?'), go: beast ? 'pat' : 'how' }];
    if (w.keeper) ch.push({ label: tr('Что у нас по делам?'), go: 'tasks' }, { label: tr('Как мой навык?'), go: 'skill' });
    else if (!beast && ctx.tasks) ch.push({ label: tr('Что у нас по делам?'), go: 'tasks' });
    ch.push({ label: beast ? tr('Кто ты?') : tr('Расскажи о себе'), go: 'about' });
    if (!beast) ch.push({ label: tier >= 2 ? tr('Дай пять!') : tr('Помахать'), go: 'pat' });
    ch.push({ label: tr('Подойди к экрану'), go: 'come' }, { label: tr('Пока!'), go: 'bye' });
    return ch;
  };
  nodes.hello = { lines: hello, choices: menu() };
  nodes.more = { lines: [{ t: beast ? tr('*{name} ждёт, что будет дальше.*', { name: w.name }) : pick([tr('Что-то ещё?'), tr('Спрашивай!'), tr('Слушаю~')], seed + 1), e: 'smile' }], choices: menu() };

  // ---- как дела ----
  const how = [];
  if (ctx.mood < 25) how.push({ t: tr('Честно? Грустновато. Задачи копятся, и в деревне всем немного тревожно.'), e: 'sad' });
  else if (ctx.mood < 60) how.push({ t: pick([tr('Нормально! Тихий, спокойный день.'), tr('Неплохо. Работаем потихоньку.')], seed), e: 'neutral' });
  else how.push({ t: pick([tr('Отлично! Деревня просто светится.'), tr('Прекрасно! Все вокруг довольные — это ты постарался(ась).')], seed), e: 'grin' });
  if (ctx.focus) how.push({ t: tr('А ещё ты сейчас в фокусе — я тихонько болею за тебя!'), e: 'smile' });
  if (w.keeper && ctx.tasks?.today) how.push({ t: tr('Сегодня в «{list}» уже {p1}. Так держать!', { list, p1: countLabel(ctx.tasks.today, ['задача выполнена', 'задачи выполнены', 'задач выполнено']) }), e: 'grin' });
  nodes.how = { lines: how, choices: [back, { label: tr('Пока!'), go: 'bye' }] };

  // ---- дела: в списке хранителя или (у жителей из магазина) на сегодня во всех списках ----
  // 0.12.5: из разговора можно выбрать задачу для фокуса и закрыть задачи — списком по дням, не выходя из окна
  if (ctx.tasks && !beast) {
    const t = ctx.tasks;
    const lines = [];
    if (w.keeper) {
      if (!t.open) lines.push({ t: tr('В «{list}» сейчас нет открытых задач. Чистота! Можно добавить новую — или просто отдохнуть.', { list }), e: 'grin' });
      else {
        lines.push({ t: tr('В «{list}» {p1}{p2}.', { list, p1: countLabel(t.open, ['открытая задача', 'открытые задачи', 'открытых задач']), p2: t.overdue ? tr(', из них просрочено {overdue}', { overdue: t.overdue }) : '' }), e: t.overdue ? 'sad' : 'neutral' });
        if (t.next) lines.push({ t: tr('Я бы {p0} с «{title}». Возьмёмся?', { p0: g(tr('начал'), tr('начала')), title: t.next.title }), e: 'smile' });
      }
    } else if (!t.open) lines.push({ t: tr('На сегодня всё сделано — красота! Можно заглянуть в списки на завтра.'), e: 'grin' });
    else lines.push({ t: tr('На сегодня у тебя {p0}{p1}. Поможем друг другу?', { p0: countLabel(t.open, ['задача', 'задачи', 'задач']), p1: t.overdue ? tr(', просрочено {overdue}', { overdue: t.overdue }) : '' }), e: t.overdue ? 'sad' : 'smile' });
    const ch = [{ label: w.keeper ? tr('Открыть список') : tr('Открыть «Сегодня»'), act: 'openList', close: true }];
    if (t.any) ch.push({ label: tr('Фокус на задаче…'), go: 'pickFocus' }, { label: tr('Закрыть задачу…'), go: 'pickDone' });
    ch.push(back);
    nodes.tasks = { lines, choices: ch };
    const toTasks = { label: tr('Назад к делам'), go: 'tasks' };
    nodes.pickFocus = { lines: [{ t: tr('На чём сосредоточимся? Сверху — то, что на сегодня.'), e: 'smile' }], picker: 'focus', choices: [toTasks, back] };
    nodes.pickDone = { lines: [{ t: tr('Что уже готово? Отмечай — я запишу!'), e: 'grin' }], picker: 'done', choices: [toTasks, back] };
  }
  if (w.keeper) {

    // ---- навык ----
    const s = ctx.skill || { level: 1, prestige: 0, roman: '', into: 0, need: 20, max: false, done: 0 };
    const sl = [{ t: tr('Навык «{list}»: {p1}уровень {level}. Всего выполнено задач: {done}.', { list, p1: s.prestige ? tr('престиж {roman}, ', { roman: s.roman }) : '', level: s.level, done: s.done }), e: 'neutral' }];
    if (s.max) sl.push({ t: tr('Мы на вершине — {MAX_LEVEL}-й уровень! Можно повысить престиж: уровень начнётся заново, а рядом с названием появится {p1}. И я повзрослею.', { MAX_LEVEL, p1: roman(s.prestige + 1) }), e: 'grin' });
    else sl.push({ t: tr('До {p0}-го уровня — ещё {p1} опыта. Опыт дают задачи этого списка: чем важнее, тем больше.', { p0: s.level + 1, p1: s.need - s.into }), e: 'smile' });
    sl.push({ t: STAGE_LINE[w.stage || 0](g), e: 'smile' });
    const sch = [];
    if (s.max) sch.push({ label: tr('✨ Повысить престиж ({p0})', { p0: roman(s.prestige + 1) }), act: 'prestige', close: true });
    sch.push(back);
    nodes.skill = { lines: sl, choices: sch };
  }

  // ---- о себе ----
  const about = [];
  const bio = w.keeper ? ROLE_BIO[w.role] || ROLE_BIO.adventurer : RESIDENTS[w.kind]?.bio || RESIDENTS.wanderer.bio;
  if (w.keeper && tier === 0) {
    about.push({ t: tr('Я {p0} по части «{list}». Мы только знакомимся — выполняй задачи из этого списка, и я расскажу больше.', { p0: w.title.toLowerCase(), list }), e: 'blush' });
  } else {
    about.push({ t: bio, e: 'smile' });
    const deep = DEEP[tier] && !beast ? DEEP[tier](c) : null;
    if (deep) about.push({ t: deep, e: tier >= 4 ? 'blush' : 'smile' });
  }
  if (ctx.affinity) {
    const a = ctx.affinity;
    about.push({ t: a.next == null ? tr('Наша дружба: {p0} — «{name}». Больше уже некуда!', { p0: hearts(a.tier), name: a.name }) : tr('Наша дружба: {p0} — «{name}». Ещё {p2}{p3} — и станем ближе.', { p0: hearts(a.tier), name: a.name, p2: countLabel(a.toNext, ['задача', 'задачи', 'задач']), p3: w.keeper ? tr(' из «{list}»', { list }) : '' }), e: 'closed' });
  }
  nodes.about = { lines: about, choices: [back, { label: tr('Пока!'), go: 'bye' }] };

  // ---- погладить / дать пять ----
  const pat = beast
    ? [tr('*{name} довольно жмурится.*', { name: w.name }), tr('*{name} мурчит… или фырчит… в общем, доволен(льна).*', { name: w.name }), tr('*{name} подставляет голову под ладонь.*', { name: w.name })]
    : [tr('Э-э… привет?'), tr('Хи-хи, ты чего!'), tr('Дай пять! ✋'), tr('Ура! Лучший напарник!'), tr('*радостно подпрыгивает* Ещё!'), tr('*обнимает тебя за плечи* Спасибо, что ты есть.')];
  nodes.pat = { lines: [{ t: beast ? pick(pat, seed) : pat[tier], e: beast ? 'closed' : tier === 0 ? 'surprised' : tier >= 2 ? 'grin' : 'smile' }], act: 'poke', choices: [back, { label: tr('Пока!'), go: 'bye' }] };

  nodes.come = { lines: [{ t: beast ? tr('*{name} бежит к краю экрана.*', { name: w.name }) : pick([tr('Иду-иду! Сейчас постучу тебе по стеклу.'), tr('Уже бегу к экрану!')], seed), e: 'grin' }], act: 'come', choices: [{ label: tr('Жду!'), close: true }] };
  nodes.bye = { lines: [{ t: beast ? tr('*{name} провожает тебя взглядом.*', { name: w.name }) : pick([tr('Пока! Возвращайся!'), tr('До встречи! Удачи с задачами!'), tr('Пока-пока~')], seed), e: 'smile' }], choices: [{ label: tr('До встречи'), close: true }] };
  return { nodes, start: 'hello' };
}

/** Подпись под именем: «Подмастерье · «Универ»» или «шахтёр». */
export function whoTitle(w) {
  if (w.keeper) return `${STAGES[w.stage || 0][w.gender]} · ${LANG === 'en' ? `“${w.listName}”` : `«${w.listName}»`}`;
  return RESIDENTS[w.kind]?.title || '';
}

export { hearts };
