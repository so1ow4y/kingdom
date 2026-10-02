// Дробные индексы для ручного порядка (docs/TZ.md D-09).
// Ключ = «целая» часть переменной длины + дробная часть в base62. Сравниваются как обычные строки.
// Алгоритм тот же, что в библиотеке fractional-indexing (rocicorp, CC0), переписан компактно.

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ZERO = DIGITS[0];
const SMALLEST_INT = 'A' + ZERO.repeat(26);

function midpoint(a, b) {
  // a < b; '' означает 0, null — 1.
  if (b !== null && a >= b) throw new Error(`order: ${a} >= ${b}`);
  if (a.slice(-1) === ZERO || (b && b.slice(-1) === ZERO)) throw new Error('order: trailing zero');
  if (b) {
    let n = 0;
    while ((a[n] || ZERO) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const da = a ? DIGITS.indexOf(a[0]) : 0;
  const db = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length;
  if (db - da > 1) return DIGITS[Math.round(0.5 * (da + db))];
  if (b && b.length > 1) return b.slice(0, 1);
  return DIGITS[da] + midpoint(a.slice(1), null);
}

function intLength(head) {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 97 + 2;
  if (head >= 'A' && head <= 'Z') return 90 - head.charCodeAt(0) + 2;
  throw new Error('order: invalid head ' + head);
}

function intPart(key) {
  const len = intLength(key[0]);
  if (len > key.length) throw new Error('order: invalid key ' + key);
  return key.slice(0, len);
}

function validate(key) {
  if (key === SMALLEST_INT) throw new Error('order: invalid key ' + key);
  const i = intPart(key);
  if (key.slice(i.length).slice(-1) === ZERO) throw new Error('order: invalid key ' + key);
}

function increment(x) {
  const [head, ...digs] = x.split('');
  let carry = true;
  for (let i = digs.length - 1; carry && i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i]) + 1;
    if (d === DIGITS.length) digs[i] = ZERO;
    else { digs[i] = DIGITS[d]; carry = false; }
  }
  if (!carry) return head + digs.join('');
  if (head === 'Z') return 'a' + ZERO;
  if (head === 'z') return null;
  const h = String.fromCharCode(head.charCodeAt(0) + 1);
  if (h > 'a') digs.push(ZERO); else digs.pop();
  return h + digs.join('');
}

function decrement(x) {
  const [head, ...digs] = x.split('');
  let borrow = true;
  for (let i = digs.length - 1; borrow && i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i]) - 1;
    if (d === -1) digs[i] = DIGITS.slice(-1);
    else { digs[i] = DIGITS[d]; borrow = false; }
  }
  if (!borrow) return head + digs.join('');
  if (head === 'a') return 'Z' + DIGITS.slice(-1);
  if (head === 'A') return null;
  const h = String.fromCharCode(head.charCodeAt(0) - 1);
  if (h < 'Z') digs.push(DIGITS.slice(-1)); else digs.pop();
  return h + digs.join('');
}

/** Ключ строго между a и b (любой из них может быть null = край). */
export function keyBetween(a, b) {
  if (a != null) validate(a);
  if (b != null) validate(b);
  if (a != null && b != null && a >= b) throw new Error(`order: ${a} >= ${b}`);
  if (a == null) {
    if (b == null) return 'a' + ZERO;
    const ib = intPart(b);
    const fb = b.slice(ib.length);
    if (ib === SMALLEST_INT) return ib + midpoint('', fb);
    if (ib < b) return ib;
    const r = decrement(ib);
    if (r == null) throw new Error('order: cannot decrement');
    return r;
  }
  if (b == null) {
    const ia = intPart(a);
    const fa = a.slice(ia.length);
    const i = increment(ia);
    return i == null ? ia + midpoint(fa, null) : i;
  }
  const ia = intPart(a);
  const fa = a.slice(ia.length);
  const ib = intPart(b);
  const fb = b.slice(ib.length);
  if (ia === ib) return ia + midpoint(fa, fb);
  const i = increment(ia);
  if (i == null) throw new Error('order: cannot increment');
  if (i < b) return i;
  return ia + midpoint(fa, null);
}

export function keyBefore(first) {
  return keyBetween(null, first ?? null);
}

export function keyAfter(last) {
  return keyBetween(last ?? null, null);
}

/** Сравнение для сортировки: по order, при равенстве — по id. */
export function byOrder(a, b, field = 'order') {
  const x = a[field] ?? '';
  const y = b[field] ?? '';
  if (x !== y) return x < y ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Новый ключ для элемента, перемещённого на позицию index в списке sorted (без самого элемента).
 * sorted — массив сущностей, уже отсортированный по field.
 */
export function keyForIndex(sorted, index, field = 'order') {
  const prev = index > 0 ? sorted[index - 1][field] : null;
  let j = index;
  // Равные ключи (возможны после слияния) пропускаем: встаём после них.
  while (prev != null && j < sorted.length && sorted[j][field] <= prev) j++;
  const next = j < sorted.length ? sorted[j][field] : null;
  return keyBetween(prev, next);
}
