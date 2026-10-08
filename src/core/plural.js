// Формы числа: plural(5, ['изменение', 'изменения', 'изменений']) → 'изменений'.
// 0.12.5: по-английски — две формы из словаря (core/i18n.en.js → PLURALS, ключ — первая русская форма).
import { LANG, pluralForms } from './i18n.js';

export function plural(n, forms) {
  if (LANG === 'en') {
    const en = pluralForms(forms);
    if (en) return Math.abs(n) === 1 ? en[0] : en[1];
  }
  const [one, few, many] = forms;
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

export function countLabel(n, forms) {
  return `${n} ${plural(n, forms)}`;
}
