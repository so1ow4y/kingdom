// Гибридные часы для меток слияния (docs/DATA_FORMAT.md §6.2).
// Метка — целое число мс; каждая следующая строго больше предыдущей, даже если системные часы пошли назад.

const DAY_MS = 24 * 60 * 60 * 1000;

export function createClock(lastStamp = 0, now = () => Date.now()) {
  let last = lastStamp;
  return {
    stamp() {
      last = Math.max(now(), last + 1);
      return last;
    },
    // Учесть метки, увиденные в чужих данных. Метки из далёкого будущего не сдвигают часы.
    observe(maxRemote, serverNow = now()) {
      if (Number.isInteger(maxRemote) && maxRemote <= serverNow + DAY_MS) last = Math.max(last, maxRemote);
    },
    get last() {
      return last;
    },
  };
}
