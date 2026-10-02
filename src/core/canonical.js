// Канонический JSON: ключи отсортированы рекурсивно, без пробелов. Используется для сравнения значений
// и детерминированного выбора при равных метках (docs/DATA_FORMAT.md §6.3).

export function canonicalJson(v) {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(v)
    .filter((k) => v[k] !== undefined)
    .sort()
    .map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k]))
    .join(',') + '}';
}

export function sameValue(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  return canonicalJson(a) === canonicalJson(b);
}
