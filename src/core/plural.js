// Русские формы числа: plural(5, ['изменение', 'изменения', 'изменений']) → 'изменений'.

export function plural(n, [one, few, many]) {
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
