// Строка поиска «поле:значение» и обозреватель задач (обновление 0.10, перенос из license-store).

import { test, assert } from './runner.js';
import { makeCtx, makeData, addTask } from './helpers.js';
import { parseQuery, evaluate, textMatch, textContains, withTerm, andQuery, usesField, QueryError } from '../src/core/query.js';
import {
  FIELDS, compile, makeContext, search, facets, histogram, histogramInterval, rangeFrom, rowsOf, listNames, matchTerm,
  bulkSummary, statusOf, fieldChips,
} from '../src/core/explore.js';
import { touch, addNote, completeTask, trashTask } from '../src/core/model.js';
import { makeRule } from '../src/core/repeat.js';

const F = { a: ['x'], b: [], 'список': ['list'] };
const terms = (node) => {
  if (!node) return null;
  if (node.type === 'term') return `${node.term.field ?? '*'}=${node.term.value}`;
  if (node.type === 'not') return `!${terms(node.node)}`;
  return `${node.type}(${node.nodes.map(terms).join(',')})`;
};

test('разбор: пробел — AND, OR и |, NOT / - / !, скобки, кавычки; NOT сильнее AND, AND сильнее OR', () => {
  assert.equal(terms(parseQuery('', F)), null);
  assert.equal(terms(parseQuery('   ', F)), null);
  assert.equal(terms(parseQuery('a:1 b:2', F)), 'and(a=1,b=2)');
  assert.equal(terms(parseQuery('a:1 OR b:2 c', F)), 'or(a=1,and(b=2,*=c))');
  assert.equal(terms(parseQuery('a:1 | b:2', F)), 'or(a=1,b=2)');
  assert.equal(terms(parseQuery('(a:1 OR b:2) c', F)), 'and(or(a=1,b=2),*=c)');
  assert.equal(terms(parseQuery('-a:1 !b:2 NOT c', F)), 'and(!a=1,!b=2,!*=c)');
  assert.equal(terms(parseQuery('a:"два слова" "фраза целиком"', F)), 'and(a=два слова,*=фраза целиком)');
  assert.equal(terms(parseQuery('x:1 СПИСОК:дом', F)), 'and(a=1,список=дом)', 'синонимы и регистр имени поля');
  assert.equal(terms(parseQuery('list:Дом', F)), 'список=Дом', 'латинский синоним русского поля');
  assert.equal(terms(parseQuery('a - b', F)), 'and(*=a,*=-,*=b)', 'одинокий минус — просто слово');
});

test('разбор: русские операторы — только заглавными, «не» и «и» в поиске остаются словами', () => {
  assert.equal(terms(parseQuery('a:1 ИЛИ b:2', F)), 'or(a=1,b=2)');
  assert.equal(terms(parseQuery('НЕ a:1', F)), '!a=1');
  assert.equal(terms(parseQuery('не забыть', F)), 'and(*=не,*=забыть)');
  assert.equal(terms(parseQuery('чай и кофе', F)), 'and(*=чай,*=и,*=кофе)');
});

test('разбор: ошибки с понятным текстом — неизвестное поле, пустое значение, скобки, OR/NOT без условия', () => {
  const err = (q) => {
    try {
      parseQuery(q, F);
    } catch (e) {
      assert.ok(e instanceof QueryError);
      return e.code + ' ' + e.message;
    }
    return 'ok';
  };
  assert.ok(err('foo:1').startsWith('SEARCH_FIELD_UNKNOWN') && err('foo:1').includes('«foo»') && err('foo:1').includes('список'));
  assert.ok(err('a:').includes('нет значения'));
  assert.ok(err('(a:1').includes('не закрыта скобка'));
  assert.ok(err('a:1 )').includes('лишняя закрывающая скобка'));
  assert.ok(err('a:1 OR').includes('после OR'));
  assert.ok(err('NOT').includes('после NOT'));
  assert.ok(err(Array.from({ length: 31 }, (_, i) => 'w' + i).join(' ')).includes('не больше 30'));
  assert.ok(err('('.repeat(12) + 'a' + ')'.repeat(12)).includes('вложенность'));
});

test('проверка дерева и совпадения: без регистра, ё = е, * — подстановка, слово — подстрока', () => {
  const node = parseQuery('a:1 OR -b:2', F);
  assert.ok(evaluate(node, (t) => t.field === 'a'));
  assert.ok(!evaluate(node, (t) => t.field === 'b'));
  assert.ok(evaluate(null, () => false), 'пустой запрос пропускает всё');
  assert.ok(usesField(node, 'b') && !usesField(node, 'c'));
  assert.ok(textMatch('Ёлка', 'елка') && textMatch('ДОМ', 'дом') && !textMatch('Домик', 'дом'));
  assert.ok(textMatch('Домик', 'дом*') && textMatch('YouTube', '*tub*') && textMatch('a.b', 'a.b') && !textMatch('axb', 'a.b'));
  assert.ok(textContains('Купить молоко', 'МОЛ') && !textContains('Купить', 'молоко') && !textContains(null, 'x'));
});

test('withTerm: клик по значению заменяет условие того же поля, исключения копятся, с OR — в скобки', () => {
  assert.equal(withTerm('', 'список', 'Дом'), 'список:Дом');
  assert.equal(withTerm('список:Дом молоко', 'список', 'Игра'), 'молоко список:Игра');
  assert.equal(withTerm('-список:Дом', 'список', 'Игра', true), '-список:Дом -список:Игра');
  assert.equal(withTerm('список:Дом', 'список', 'Дом'), 'список:Дом', 'повтор не дублируется');
  assert.equal(withTerm('a OR b', 'список', 'Дом'), '(a OR b) список:Дом');
  assert.equal(withTerm('(a b)', 'статус', 'активна'), '(a b) статус:активна');
  assert.equal(withTerm('', 'список', 'Мой "дом"'), 'список:"Мой дом"');
  assert.equal(andQuery('a OR b', '', 'c:1'), '(a OR b) c:1');
  assert.equal(andQuery(' x '), 'x');
});

// ---------- Обозреватель ----------

const NOW = Date.parse('2026-10-06T09:00:00.000Z'); // вторник
const TODAY = '2026-10-06';
const PERESDACHA = '00000000-0000-7000-8000-000000000101';
const HOME = '00000000-0000-7000-8000-000000000105';
const HIGH = '00000000-0000-7000-8000-000000000203';

function sample() {
  const d = makeData();
  const c = makeCtx(NOW);
  const a = addTask(d, c, { title: 'Купить молоко', listIds: [HOME], priorityId: HIGH });
  const kid = addTask(d, c, { title: 'Взять пакет', parentId: a.id });
  let n = addTask(d, c, { title: 'Конспект по матану', listIds: [PERESDACHA] });
  n = addNote(n, 'не забыть формулы', 'a0', c);
  d.tasks.set(n.id, n);
  const inbox = addTask(d, c, { title: 'Позвонить маме' });
  const c2 = makeCtx(Date.parse('2026-10-05T08:00:00.000Z'));
  const done = completeTask(addTask(d, c2, { title: 'Пробежка', listIds: [HOME] }), c2);
  d.tasks.set(done.id, done);
  const trashed = trashTask(addTask(d, c, { title: 'Старый план' }), c);
  d.tasks.set(trashed.id, trashed);
  const rep = addTask(d, c, { title: 'Зарядка', repeat: makeRule({ kind: 'daily' }, TODAY) });
  const planned = addTask(d, c, { title: 'Врач', scheduledDate: '2026-10-09' });
  return { d, a, kid, n, inbox, done, trashed, rep, planned, ctx: makeContext(d, 'Europe/Moscow', TODAY) };
}

const titles = (r) => r.rows.map((t) => t.title).sort();

test('обозреватель: виды задач, списки подзадачи — от родителя, корень без списков — «Входящие»', () => {
  const s = sample();
  assert.equal(rowsOf(s.d, 'all').length, 8);
  assert.deepEqual(rowsOf(s.d, 'done').map((t) => t.title), ['Пробежка']);
  assert.deepEqual(rowsOf(s.d, 'trash').map((t) => t.title), ['Старый план']);
  assert.deepEqual(listNames(s.ctx, s.kid), ['Дом']);
  assert.deepEqual(listNames(s.ctx, s.inbox), ['Входящие']);
  assert.deepEqual([s.done, s.trashed, s.a].map(statusOf), ['done', 'trash', 'active']);
  assert.ok(!fieldChips('done').includes('статус') && fieldChips('all').includes('статус'));
  assert.equal(Object.keys(FIELDS).length, fieldChips('all').length);
});

test('обозреватель: поля списка, статуса, признаков, дат и дней недели', () => {
  const s = sample();
  const q = (query, kind = 'all') => titles(search(s.ctx, kind, { q: query }));
  assert.deepEqual(q('список:дом'), ['Взять пакет', 'Купить молоко', 'Пробежка']);
  assert.deepEqual(q('list:входящие -статус:корзина'), ['Врач', 'Зарядка', 'Позвонить маме']);
  assert.deepEqual(q('статус:выполнена'), ['Пробежка']);
  assert.deepEqual(q('status:trash'), ['Старый план']);
  assert.deepEqual(q('приоритет:высокий'), ['Купить молоко']);
  assert.deepEqual(q('есть:заметка'), ['Конспект по матану']);
  assert.deepEqual(q('has:subtasks'), ['Купить молоко']);
  assert.deepEqual(q('есть:родитель'), ['Взять пакет']);
  assert.deepEqual(q('есть:повтор'), ['Зарядка']);
  assert.deepEqual(q('заметка:формул'), ['Конспект по матану']);
  assert.deepEqual(q('формулы'), ['Конспект по матану'], 'слово без поля ищет и в заметках');
  assert.deepEqual(q('план:2026-10'), ['Врач']);
  assert.deepEqual(q('план:есть'), ['Врач', 'Зарядка'], 'у повтора своя дата из правила');
  assert.deepEqual(q('дата:вчера'), ['Пробежка']);
  assert.deepEqual(q('дата:<2026-10-06'), ['Пробежка']);
  assert.deepEqual(q('дата:>2026-10'), [], 'после октября — ничего');
  assert.deepEqual(q('дата:>=2026-10-06 список:дом'), ['Взять пакет', 'Купить молоко']);
  assert.deepEqual(q('день:пн'), ['Пробежка']);
  assert.deepEqual(q('день:понедельник'), ['Пробежка']);
  assert.deepEqual(q('дата:вчера', 'done'), ['Пробежка'], 'у выполненных дата — время выполнения');
  assert.deepEqual(q('(список:дом OR список:пересдача) -есть:родитель'), ['Конспект по матану', 'Купить молоко', 'Пробежка']);
  assert.equal(search(s.ctx, 'all', { q: 'поле:1' }).error.includes('Неизвестное поле'), true);
  assert.equal(search(s.ctx, 'all', { q: 'поле:1' }).rows.length, 0);
});

test('обозреватель: диапазон времени, топ значений, гистограмма', () => {
  const s = sample();
  const from = rangeFrom('24h', NOW);
  assert.equal(from, '2026-10-05T09:00:00.000Z');
  assert.equal(rangeFrom('all', NOW), null);
  assert.deepEqual(titles(search(s.ctx, 'done', { from })), [], 'выполнена раньше чем за сутки');
  assert.deepEqual(titles(search(s.ctx, 'done', { from: rangeFrom('7d', NOW) })), ['Пробежка']);
  const r = search(s.ctx, 'all', { q: '' });
  const top = facets(s.ctx, r.rows, 'all');
  assert.deepEqual(top.map((f) => f.field), ['статус', 'список', 'приоритет', 'повтор', 'день', 'устройство']);
  assert.deepEqual(top[0].values, [{ value: 'активна', count: 6 }, { value: 'в корзине', count: 1 }, { value: 'выполнена', count: 1 }]);
  assert.deepEqual(top[1].values[0], { value: 'Входящие', count: 4 });
  const h = histogram(r.rows, 'all', null, NOW);
  assert.equal(h.buckets.reduce((sum, b) => sum + b.count, 0), r.rows.length, 'все задачи в столбиках');
  assert.equal(h.interval, '1 час');
  assert.equal(histogramInterval(0, 2 * 3600000).label, '5 минут');
  assert.equal(histogramInterval(0, 30 * 864e5).label, '1 день');
  assert.equal(histogramInterval(0, 400 * 864e5).label, '7 дней');
  assert.equal(histogramInterval(0, 900 * 864e5).label, '30 дней');
});

test('обозреватель: проверка одного условия и итог массового действия', () => {
  const s = sample();
  assert.ok(matchTerm(s.ctx, s.a, { field: 'название', value: 'молоко' }, 'all'));
  assert.ok(!matchTerm(s.ctx, s.a, compile('название:хлеб').term, 'all'));
  assert.equal(bulkSummary({ total: 3, succeeded: 3, failed: [] }, 'Выполнено'), 'Выполнено: 3');
  assert.equal(bulkSummary({ total: 5, succeeded: 2, failed: [{ id: 1, code: 'ALREADY_DONE' }, { id: 2, code: 'ALREADY_DONE' }, { id: 3, code: 'REPEATING' }] }),
    'Готово: 2 из 5. Не подошли: уже выполнены (2), повторяющиеся — их отмечают по одной (1)');
  const t2 = touch(s.a, { title: 'Ёжик в тумане' }, makeCtx(NOW));
  assert.ok(matchTerm(s.ctx, t2, { field: null, value: 'ежик' }, 'all'), 'ё = е');
});

test('обозреватель (0.12.3): «повтор:» — группы, есть/нет, текст правила, топ «повтор»', () => {
  const s = sample();
  const c = makeCtx(NOW);
  addTask(s.d, c, { title: 'День рождения Кати', repeat: makeRule({ kind: 'yearly', month: 3, monthDay: 8 }, TODAY) });
  addTask(s.d, c, { title: 'Квартплата', repeat: makeRule({ kind: 'monthly', monthDay: 20 }, TODAY) });
  addTask(s.d, c, { title: 'Тренировка', repeat: makeRule({ kind: 'weekly', weekdays: [1, 3, 5] }, TODAY) });
  const ctx = makeContext(s.d, 'Europe/Moscow', TODAY);
  const q = (query) => titles(search(ctx, 'all', { q: query }));
  assert.deepEqual(q('повтор:годы'), ['День рождения Кати']);
  assert.deepEqual(q('repeat:monthly'), ['Квартплата']);
  assert.deepEqual(q('повтор:недели'), ['Тренировка']);
  assert.deepEqual(q('повтор:дни'), ['Зарядка']);
  assert.deepEqual(q('повтор:есть'), ['День рождения Кати', 'Зарядка', 'Квартплата', 'Тренировка']);
  assert.ok(q('повтор:нет').includes('Врач') && !q('повтор:нет').includes('Зарядка'));
  assert.deepEqual(q('повтор:марта'), ['День рождения Кати'], 'по тексту правила');
  assert.deepEqual(q('повтор:"по годам"'), ['День рождения Кати'], 'значение из топа');
  const top = facets(ctx, search(ctx, 'all', { q: '' }).rows, 'all').find((f) => f.field === 'повтор');
  assert.ok(top && top.values.some((v) => v.value === 'по годам' && v.count === 1) && top.values.some((v) => v.value === 'без повтора'));
});
