// Единая точка импорта Preact + htm (вендорный файл лежит локально — приложение работает офлайн).
// 0.12.5: html`` переводит статичный текст шаблонов (тексты между тегами и значения атрибутов в кавычках)
// на выбранный язык — один раз на шаблон, перевод кэшируется. Подставленные значения ${…} не трогаются.
import { html as rawHtml } from '../../vendor/htm-preact-standalone.mjs';
import { LANG, tText } from '../core/i18n.js';

export {
  render, h, Component, createContext,
  useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, useContext, useReducer,
} from '../../vendor/htm-preact-standalone.mjs';

const cache = new WeakMap();

/** Перевести статичные куски шаблона: состояние «внутри тега / в кавычках» переходит через ${…}. */
export function translateTemplate(strings) {
  let out = cache.get(strings);
  if (out) return out;
  out = [];
  let inTag = false;
  let quote = null;
  for (const s of strings) {
    let res = '';
    let run = '';
    const flush = () => {
      if (run) res += tText(run);
      run = '';
    };
    for (const c of s) {
      if (quote) {
        if (c === quote) {
          flush();
          quote = null;
          res += c;
        } else run += c;
      } else if (inTag) {
        if (c === '"' || c === "'") quote = c;
        else if (c === '>') inTag = false;
        res += c;
      } else if (c === '<') {
        flush();
        inTag = true;
        res += c;
      } else run += c;
    }
    flush();
    out.push(res);
  }
  cache.set(strings, out);
  return out;
}

export const html = LANG === 'ru' ? rawHtml : (strings, ...values) => rawHtml(translateTemplate(strings), ...values);
