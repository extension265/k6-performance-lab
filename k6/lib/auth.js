import { fail } from 'k6';
import http from 'k6/http';
import { expectJson } from './checks.js';
import { BASE_URL, CREDENTIALS, FRESH_AUTH_RATIO } from './config.js';
import { params } from './http.js';

export function login() {
  const res = http.post(`${BASE_URL}/auth/token`, JSON.stringify(CREDENTIALS), params('POST /auth/token'));
  const body = expectJson(res, 200, 'auth');
  return body?.accessToken ?? null;
}

/** Call from setup(): one token shared by every VU. */
export function setupAuth() {
  const token = login();
  if (!token) fail(`setup(): could not get a token from ${BASE_URL}/auth/token`);
  return { token };
}

/**
 * Token for this iteration. Most iterations reuse the setup() token, but FRESH_AUTH_RATIO of them
 * (default 15%) log in again so that /auth/token, and the bcrypt cost behind it, stays under load.
 */
export function tokenForIteration(data) {
  if (FRESH_AUTH_RATIO > 0 && Math.random() < FRESH_AUTH_RATIO) {
    return login() ?? data.token;
  }
  return data.token;
}
