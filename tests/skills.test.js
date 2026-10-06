// Навыки списков, хранители и разговоры в деревне (обновление 0.8).

import { test, assert } from './runner.js';
import { makeCtx, makeData } from './helpers.js';
import {
  MAX_LEVEL, needForLevel, xpToLevel, levelOf, roman, xpOfPriority, listTotals, skillOf, allSkills, stageOf, affinityOf, DEFAULT_XP,
} from '../src/core/skills.js';
import { newTask, completeTask, touch } from '../src/core/model.js';
import { mergeEntity } from '../src/core/merge.js';
import { archiveRecord } from '../src/core/retention.js';
import { keeperOf, keepersOf, roleOf } from '../src/village/keepers.js';
import { talkTree, RESIDENTS, whoTitle } from '../src/village/dialogs.js';
import { chibiSprite, LOOKS, lookKey, CW, CH } from '../src/village/chibi.js';
import { portrait, PW } from '../src/village/portraits.js';

const UNI = '00000000-0000-7000-8000-000000000102';
const HOME = '00000000-0000-7000-8000-000000000105';
const MID = '00000000-0000-7000-8000-000000000202';
const CRIT = '00000000-0000-7000-8000-000000000204';
const NOW = Date.parse('2026-10-06T12:00:00.000Z');

function done(d, c, listIds, priorityId, title = 'Задача') {
  const t = completeTask(newTask({ title, listIds, priorityId, order: 'a0' }, c), c);
  d.tasks.set(t.id, t);
  return t;
}

test('кривая опыта: каждый уровень дороже предыдущего, 100 — потолок, римские цифры', () => {
  for (let L = 2; L < MAX_LEVEL; L++) assert.ok(needForLevel(L) >= needForLevel(L - 1), `уровень ${L}`);
  assert.equal(needForLevel(1), 20);
  assert.equal(needForLevel(MAX_LEVEL), 0);
  assert.equal(xpToLevel(1), 0);
  assert.ok(xpToLevel(100) > 9000 && xpToLevel(100) < 13000, `до сотого — ${xpToLevel(100)} опыта`);
  assert.deepEqual(levelOf(0), { level: 1, into: 0, need: 20, progress: 0, max: false });
  assert.equal(levelOf(19).level, 1);
  assert.equal(levelOf(20).level, 2);
  assert.equal(levelOf(xpToLevel(57) + 3).level, 57);
  assert.equal(levelOf(xpToLevel(57) + 3).into, 3);
  assert.ok(levelOf(1e9).max && levelOf(1e9).level === 100);
  assert.deepEqual([1, 2, 4, 9, 14, 25, 40, 99].map(roman), ['I', 'II', 'IV', 'IX', 'XIV', 'XXV', 'XL', 'XCIX']);
  assert.equal(roman(0), '');
});

test('опыт: по приоритету (настраивается), каждому списку задачи; удалённые лимитом — тоже считаются', () => {
  const c = makeCtx(NOW);
  const d = makeData();
  assert.equal(xpOfPriority(d.priorities.get(MID)), DEFAULT_XP[MID]);
  done(d, c, [UNI], MID);
  done(d, c, [UNI, HOME], CRIT);
  const t = done(d, c, [HOME], MID);
  let tot = listTotals(d);
  assert.deepEqual(tot.get(UNI), { xp: 20 + 60, done: 2 });
  assert.deepEqual(tot.get(HOME), { xp: 60 + 20, done: 2 });
  // опыт приоритета поменяли в настройках — пересчиталось
  d.priorities.set(MID, touch(d.priorities.get(MID), { xp: 50 }, c));
  tot = listTotals(d);
  assert.equal(tot.get(UNI).xp, 50 + 60);
  // задачу удалил лимит хранения — осталась сводка, опыт не пропал
  d.doneArchive.set(t.id, archiveRecord(d, t));
  d.tasks.set(t.id, { ...t, deletedAt: new Date(NOW).toISOString() });
  assert.equal(listTotals(d).get(HOME).xp, 60 + 50);
  // невыполненные не считаются
  d.tasks.set('x', newTask({ title: 'Открытая', listIds: [UNI], priorityId: CRIT, order: 'a1' }, c));
  assert.equal(listTotals(d).get(UNI).done, 2);
});

test('престиж: на сотом уровне — уровень с начала, престиж растёт; поля списка сливаются как обычно', () => {
  const c = makeCtx(NOW);
  const d = makeData();
  for (let i = 0; i < 200; i++) done(d, c, [UNI], CRIT, 'Курсовая ' + i);
  const uni = () => d.lists.get(UNI);
  let s = skillOf(d, uni());
  assert.ok(s.max && s.level === 100 && s.prestige === 0);
  assert.equal(s.stage, 2);
  assert.equal(s.affinity.tier, 5);
  const a = touch(uni(), { prestige: 1, prestigeXp: s.total }, makeCtx(NOW + 10));
  d.lists.set(UNI, a);
  s = skillOf(d, uni());
  assert.deepEqual([s.prestige, s.roman, s.level, s.xp], [1, 'I', 1, 0]);
  assert.equal(s.stage, 3, 'хранитель стал мастером');
  done(d, c, [UNI], MID);
  assert.equal(skillOf(d, uni()).xp, 20, 'новый опыт после престижа идёт в новый круг');
  // правка списка на другом устройстве не теряет престиж
  const b = touch(a, { name: 'Университет' }, { ...makeCtx(NOW + 20), deviceId: 'devB' });
  const m = mergeEntity({ ...a }, b);
  assert.deepEqual([m.prestige, m.name], [1, 'Университет']);
  assert.equal(allSkills(d).size, d.lists.size);
  assert.deepEqual([stageOf(0, 1), stageOf(0, 20), stageOf(0, 60), stageOf(1, 1), stageOf(3, 1)], [0, 1, 2, 3, 4]);
  assert.deepEqual([0, 3, 10, 30, 70, 150, 999].map((n) => affinityOf(n).tier), [0, 1, 2, 3, 4, 5, 5]);
});

test('хранители: по одному на список, имена не повторяются, роль по эмодзи, взрослеют с навыком', () => {
  const c = makeCtx(NOW);
  const d = makeData();
  const ks = keepersOf(d, allSkills(d));
  assert.equal(ks.length, d.lists.size);
  assert.equal(new Set(ks.map((k) => k.name)).size, ks.length, 'имена разные');
  assert.deepEqual(ks.map((k) => k.role), ['scholar', 'scholar', 'creator', 'gamer', 'home']);
  assert.equal(roleOf({ id: 'x', name: 'Здоровье', emoji: '❤️' }), 'health', '❤️ — не «учёба» (общий U+FE0F)');
  assert.equal(roleOf({ id: 'x', name: 'Спорт', emoji: '💪' }), 'sport');
  const k0 = keeperOf(d.lists.get(UNI), skillOf(d, d.lists.get(UNI)));
  assert.equal(k0.stage, 0);
  assert.equal(k0.look.top, d.lists.get(UNI).color, 'одежда — цвета списка');
  for (let i = 0; i < 40; i++) done(d, c, [UNI], MID);
  const k1 = keeperOf(d.lists.get(UNI), skillOf(d, d.lists.get(UNI)));
  assert.equal(k1.stage, 1);
  assert.ok(JSON.stringify(k1.look) !== JSON.stringify(k0.look), 'внешность меняется со ступенью');
  d.lists.set(HOME, touch(d.lists.get(HOME), { archived: true }, c));
  assert.equal(keepersOf(d, allSkills(d)).length, d.lists.size - 1, 'у архивного списка хранителя нет');
});

test('разговор: у каждой ветки есть продолжение, престиж — только на сотом уровне, нет «undefined»', () => {
  const base = { mood: 50, night: 0, focus: false, seed: 3 };
  const keeper = { kind: 'keeper', keeper: true, name: 'Сора', title: 'Ученица', gender: 'f', role: 'scholar', stage: 0, listId: UNI, listName: 'Универ' };
  const cases = [];
  for (let tier = 0; tier <= 5; tier++) {
    cases.push({ ...base, who: keeper, affinity: affinityOf([0, 3, 10, 30, 70, 150][tier]), skill: { level: 7, prestige: 0, roman: '', into: 3, need: 27, max: false, done: 4 }, tasks: { open: 3, overdue: 1, today: 2, next: { id: 't', title: 'Курсовая' } } });
  }
  cases.push({ ...base, mood: 10, night: 0.9, focus: true, who: { ...keeper, gender: 'm', stage: 4 }, affinity: affinityOf(200), skill: { level: 100, prestige: 2, roman: 'II', into: 0, need: 0, max: true, done: 900 }, tasks: { open: 0, overdue: 0, today: 0, next: null } });
  for (const kind of Object.keys(RESIDENTS)) cases.push({ ...base, who: { kind, keeper: false, ...RESIDENTS[kind] }, affinity: affinityOf(12) });
  for (const ctx of cases) {
    const { nodes, start } = talkTree(ctx);
    assert.ok(nodes[start], 'есть начало');
    for (const [id, n] of Object.entries(nodes)) {
      assert.ok(n.lines.length > 0, `${ctx.who.kind}/${id}: есть реплики`);
      for (const l of n.lines) assert.ok(l.t && !/undefined|null|NaN/.test(l.t), `${ctx.who.kind}/${id}: «${l.t}»`);
      for (const ch of n.choices) assert.ok(ch.close || nodes[ch.go], `${ctx.who.kind}/${id}: ответ «${ch.label}» ведёт в ${ch.go}`);
    }
    const prestige = Object.values(nodes).some((n) => n.choices.some((ch) => ch.act === 'prestige'));
    assert.equal(prestige, !!ctx.skill?.max, 'престиж — только на сотом уровне');
  }
  assert.equal(whoTitle({ ...keeper, stage: 3 }), 'Мастер · «Универ»');
});

test('отрисовка: чиби во всех позах и портреты со всеми эмоциями рисуются, с обводкой', () => {
  const d = makeData();
  const looks = [...Object.values(LOOKS), ...keepersOf(d, allSkills(d)).map((k) => k.look)];
  for (const stage of [0, 4]) looks.push({ ...looks.at(-1), stage, cape: stage >= 3 ? '#552233' : undefined });
  const painted = (cv) => {
    const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    let dark = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] > 0) {
      n++;
      if (px[i - 3] === 0x1e && px[i - 2] === 0x16 && px[i - 1] === 0x26) dark++;
    }
    return { n, dark };
  };
  for (const look of looks) {
    for (const state of ['idle', 'walk', 'run', 'jump', 'sit', 'sleep', 'work', 'wave', 'greet', 'knock', 'dance', 'fly', 'celebrate']) {
      for (const dir of [1, -1]) {
        const s = chibiSprite(look, lookKey(look), { state, frame: 1, happy: true, night: true }, dir);
        assert.equal(s.cv.width, CW);
        assert.equal(s.cv.height, CH);
        const p = painted(s.cv);
        assert.ok(p.n > 150 && p.dark > 40, `чиби ${look.role || look.hat || look.style} ${state}: ${p.n} пикселей, обводка ${p.dark}`);
      }
    }
    for (const e of ['neutral', 'smile', 'grin', 'surprised', 'sad', 'blush', 'closed']) {
      const p = painted(portrait({ kind: 'keeper', look }, e));
      assert.ok(p.n > 1500, `портрет ${e}: ${p.n}`);
    }
  }
  for (const kind of ['cat', 'kitten', 'fox', 'slime', 'shroom', 'ghost', 'dragon', 'spider']) {
    const cv = portrait({ kind }, 'smile');
    assert.equal(cv.width, PW);
    assert.ok(painted(cv).n > 800, `мордочка ${kind}`);
  }
});
