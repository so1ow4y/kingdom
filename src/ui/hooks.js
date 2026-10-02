import { useState, useEffect } from './html.js';
import { subscribe } from '../store/appState.js';
import { parseHash } from './router.js';

/** Перерисовывать компонент при любом изменении store. */
export function useStore() {
  const [, setN] = useState(0);
  useEffect(() => {
    const off = subscribe(() => setN((n) => n + 1));
    // Изменения между первой отрисовкой и подпиской иначе потерялись бы.
    setN((n) => n + 1);
    return off;
  }, []);
}

export function useRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const f = () => setRoute(parseHash());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return route;
}

export function useMedia(query) {
  const [m, setM] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const f = () => setM(mq.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, [query]);
  return m;
}

// localStorage для мелких настроек устройства (свёрнутые блоки и т. п.). Всегда через try/catch.
export function readLocal(key, fallback) {
  try {
    const v = localStorage.getItem('lifetasks.' + key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function writeLocal(key, value) {
  try {
    if (value === undefined) localStorage.removeItem('lifetasks.' + key);
    else localStorage.setItem('lifetasks.' + key, JSON.stringify(value));
  } catch {
    // недоступно — не страшно
  }
}

export function useLocal(key, fallback) {
  const [v, setV] = useState(() => readLocal(key, fallback));
  const set = (x) => {
    setV(x);
    writeLocal(key, x);
  };
  return [v, set];
}
