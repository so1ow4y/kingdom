// Минимальный валидатор JSON Schema (draft 2020-12) — ровно то подмножество, что используется в schemas/v1.
// Только для тестов: проверка образцов и того, что пишет приложение. Бот на Python возьмёт полноценный jsonschema.

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function typeMatches(t, v) {
  const actual = typeOf(v);
  if (t === 'number') return actual === 'number' || actual === 'integer';
  return actual === t;
}

function resolve(root, ref) {
  if (!ref.startsWith('#/')) throw new Error('Поддерживаются только локальные $ref: ' + ref);
  return ref.slice(2).split('/').reduce((o, k) => o[k], root);
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Возвращает массив ошибок (пустой — данные валидны). */
export function validate(schema, data, root = schema, path = '$') {
  const errs = [];
  const fail = (msg) => errs.push(`${path}: ${msg}`);
  if (schema === true || schema === undefined) return errs;
  if (schema === false) return [`${path}: запрещено схемой`];

  if (schema.$ref) errs.push(...validate(resolve(root, schema.$ref), data, root, path));
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(t, data))) fail(`ожидался тип ${types.join('|')}, получено ${typeOf(data)}`);
  }
  if ('const' in schema && !eq(schema.const, data)) fail(`ожидалось ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((x) => eq(x, data))) fail(`значение ${JSON.stringify(data)} не из ${JSON.stringify(schema.enum)}`);

  if (typeof data === 'string') {
    const len = [...data].length;
    if (schema.minLength !== undefined && len < schema.minLength) fail(`длина ${len} < ${schema.minLength}`);
    if (schema.maxLength !== undefined && len > schema.maxLength) fail(`длина ${len} > ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(data)) fail(`«${data}» не подходит под ${schema.pattern}`);
  }
  if (typeof data === 'number') {
    if (schema.minimum !== undefined && data < schema.minimum) fail(`${data} < ${schema.minimum}`);
    if (schema.maximum !== undefined && data > schema.maximum) fail(`${data} > ${schema.maximum}`);
  }
  if (Array.isArray(data)) {
    if (schema.minItems !== undefined && data.length < schema.minItems) fail(`элементов ${data.length} < ${schema.minItems}`);
    if (schema.maxItems !== undefined && data.length > schema.maxItems) fail(`элементов ${data.length} > ${schema.maxItems}`);
    if (schema.uniqueItems && new Set(data.map((x) => JSON.stringify(x))).size !== data.length) fail('элементы повторяются');
    if (schema.items) data.forEach((x, i) => errs.push(...validate(schema.items, x, root, `${path}[${i}]`)));
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const k of schema.required || []) if (!(k in data)) fail(`нет обязательного поля ${k}`);
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(data)) {
      if (k in props) errs.push(...validate(props[k], v, root, `${path}.${k}`));
      else if (schema.additionalProperties !== undefined) errs.push(...validate(schema.additionalProperties, v, root, `${path}.${k}`));
      if (schema.propertyNames) errs.push(...validate(schema.propertyNames, k, root, `${path}{${k}}`));
    }
  }
  if (schema.allOf) for (const s of schema.allOf) errs.push(...validate(s, data, root, path));
  if (schema.oneOf) {
    const ok = schema.oneOf.filter((s) => validate(s, data, root, path).length === 0).length;
    if (ok !== 1) fail(`oneOf: подошло вариантов ${ok}, нужно ровно 1`);
  }
  if (schema.if) {
    const cond = validate(schema.if, data, root, path).length === 0;
    if (cond && schema.then) errs.push(...validate(schema.then, data, root, path));
    if (!cond && schema.else) errs.push(...validate(schema.else, data, root, path));
  }
  return errs;
}
