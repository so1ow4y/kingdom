// Вход Google: OAuth 2.0 implicit flow через полный редирект (docs/TZ.md §8, D-05).
// Почему редирект: работает без жеста пользователя (авто-вход при открытии) и в установленном PWA.
// Токен живёт около часа; refresh-токена без сервера нет — повторный вход идёт тем же редиректом.

import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES } from '../config.js';
import { setTokenProvider, gfetch } from './http.js';
import { createDrive } from './drive.js';
import { getRepo } from '../store/localRepo.js';
import { store, setUi, flushAll } from '../store/appState.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SKEW_MS = 120000; // токен считаем истёкшим за 2 минуты до конца
const PENDING_TTL_MS = 15 * 60000;
const BLOCK_MS = 10 * 60000; // после ошибки входа авто-редирект не повторяется 10 минут

/** Адрес возврата: папка приложения со слешем. localhost:8080/ или <ник>.github.io/lifetasks/ */
export function redirectUri() {
  const u = new URL('./', location.href);
  u.search = '';
  u.hash = '';
  return u.href;
}

function scopeCovers(scope) {
  const granted = new Set(String(scope || '').split(/\s+/));
  return GOOGLE_SCOPES.every((s) => granted.has(s));
}

export function tokenValid(a = store.auth) {
  return !!a?.accessToken && a.expiresAt - SKEW_MS > Date.now() && scopeCovers(a.scope);
}

setTokenProvider(() => (tokenValid() ? store.auth.accessToken : null));

function randomNonce() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Забрать ответ Google из адреса (#access_token=… или #error=…) и сразу убрать его из адресной строки.
 * Вызывается в самом начале загрузки, до роутера.
 */
export function takeOAuthFragment() {
  const h = location.hash.slice(1);
  if (!/(^|&)(access_token|error)=/.test(h)) return null;
  const params = Object.fromEntries(new URLSearchParams(h));
  history.replaceState(null, '', redirectUri() + '#/today');
  return params;
}

/**
 * Уйти на страницу входа Google.
 * action — что сделать после возврата ('push' | 'pull' | null); returnRoute — куда вернуться.
 */
export async function startLogin({ action = null, returnRoute = null, selectAccount = false } = {}) {
  const repo = getRepo();
  const nonce = randomNonce();
  const route = returnRoute || (location.hash.startsWith('#/') ? location.hash.slice(1) : '/today');
  await repo.setMeta('auth.pending', { nonce, action, returnRoute: route, createdAt: Date.now() });
  const p = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: GOOGLE_SCOPES.join(' '),
    include_granted_scopes: 'true',
    state: nonce,
  });
  const hint = store.auth?.email || (await repo.getMeta('account.email'));
  if (hint && !selectAccount) p.set('login_hint', hint);
  if (selectAccount) p.set('prompt', 'select_account');
  else if (await repo.getMeta('auth.needConsent')) p.set('prompt', 'consent');
  await flushAll();
  setUi({ redirecting: true });
  setTimeout(() => location.assign(`${AUTH_URL}?${p}`), 300);
}

/**
 * Обработать ответ Google. Возвращает { ok, code?, action, returnRoute, email }.
 */
export async function completeLogin(params) {
  const repo = getRepo();
  const pending = await repo.getMeta('auth.pending');
  await repo.setMeta('auth.pending', null);
  const base = { action: pending?.action ?? null, returnRoute: pending?.returnRoute || '/today' };

  if (params.error) {
    await repo.setMeta('auth.blockedUntil', Date.now() + BLOCK_MS);
    const code = params.error === 'access_denied' ? 'E-AUTH-DENIED'
      : /origin|redirect_uri/.test(params.error) ? 'E-AUTH-ORIGIN' : 'E-AUTH';
    return { ...base, ok: false, code, detail: params.error };
  }
  if (!pending || pending.nonce !== params.state || Date.now() - pending.createdAt > PENDING_TTL_MS) {
    return { ...base, ok: false, code: 'E-AUTH-STATE' };
  }
  if (!scopeCovers(params.scope)) {
    await repo.setMeta('auth.needConsent', true);
    await repo.setMeta('auth.blockedUntil', Date.now() + BLOCK_MS);
    return { ...base, ok: false, code: 'E-AUTH-SCOPE' };
  }

  const auth = {
    accessToken: params.access_token,
    expiresAt: Date.now() + (Number(params.expires_in) || 3600) * 1000,
    scope: params.scope,
    email: null,
  };
  store.auth = auth;
  try {
    const about = await createDrive().about();
    auth.email = about?.user?.emailAddress || null;
  } catch (e) {
    console.warn('about.get не удался', e);
  }
  await repo.setMeta('auth', auth);
  await repo.setMeta('auth.everLoggedIn', true);
  await repo.setMeta('auth.blockedUntil', 0);
  await repo.setMeta('auth.needConsent', false);
  return { ...base, ok: true, email: auth.email };
}

/** Испортить токен (режим отладки): следующий пуш пойдёт через повторный вход. */
export async function expireToken() {
  if (!store.auth) return;
  store.auth = { ...store.auth, expiresAt: Date.now() - 1000 };
  await getRepo().setMeta('auth', store.auth);
}

export async function logout() {
  const token = store.auth?.accessToken;
  store.auth = null;
  await getRepo().setMeta('auth', null);
  if (token) {
    try {
      await gfetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        auth: false,
        as: 'none',
      });
    } catch (e) {
      console.warn('Отзыв токена не удался (не страшно, он истечёт сам)', e);
    }
  }
}
