// A selected calendar day is navigation state, never the application's real clock.
export function planningDate(value, fallback) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return fallback;
  const date = new Date(value + 'T12:00:00Z');
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value ? value : fallback;
}
