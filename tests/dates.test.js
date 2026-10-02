import { test, assert } from './runner.js';
import {
  addDays, daysBetween, isoWeekday, mondayOf, weekDates, todayIn, nowTimeIn, localDateOf, humanDate, dayLabel,
  longDate, formatMoment,
} from '../src/core/dates.js';

test('dates: addDays через границы месяца и года, високосный год', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('dates: переход на летнее время не сдвигает дни', () => {
  assert.equal(addDays('2026-03-28', 2), '2026-03-30');
  assert.equal(daysBetween('2026-10-24', '2026-10-26'), 2);
});

test('dates: день недели и понедельник', () => {
  assert.equal(isoWeekday('2026-10-02'), 5, '02.10.2026 — пятница');
  assert.equal(isoWeekday('2026-10-04'), 7, 'воскресенье = 7');
  assert.equal(mondayOf('2026-10-04'), '2026-09-28');
  assert.equal(mondayOf('2026-09-28'), '2026-09-28');
  assert.deepEqual(weekDates('2026-09-28'), ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
});

test('dates: «сегодня» зависит от часового пояса', () => {
  const d = new Date('2026-10-01T22:30:00Z');
  assert.equal(todayIn('Europe/Moscow', d), '2026-10-02');
  assert.equal(todayIn('UTC', d), '2026-10-01');
  assert.equal(nowTimeIn('Europe/Moscow', d), '01:30');
  assert.equal(localDateOf('2026-10-01T22:30:00.000Z', 'Asia/Tokyo'), '2026-10-02');
  assert.equal(formatMoment('2026-10-01T22:30:00.000Z', 'Europe/Moscow'), '02.10.2026 01:30');
});

test('dates: человекочитаемые даты', () => {
  const today = '2026-10-02';
  assert.equal(humanDate('2026-10-02', today), 'Сегодня');
  assert.equal(humanDate('2026-10-03', today), 'Завтра');
  assert.equal(humanDate('2026-10-01', today), 'Вчера');
  assert.equal(humanDate('2026-10-07', today), 'Ср');
  assert.equal(humanDate('2026-10-12', today), '12 окт');
  assert.equal(humanDate('2027-01-05', today), '5 янв 2027');
  assert.equal(dayLabel('2026-09-28'), 'Пн, 28 сен');
  assert.equal(longDate('2026-05-09', today), '9 мая');
});
