import http from 'k6/http';
import { check, fail } from 'k6';
import { Trend } from 'k6/metrics';
import { BASE_URL, EMAIL, PASSWORD, USE_API_KEY } from './env.js';

export const loginDuration = new Trend('login_duration', true);

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** Signs in once per test (setup), returns what every scenario needs to call the API. */
export function authenticate() {
  const res = http.post(`${BASE_URL}/api/v1/auth/login`, JSON.stringify({ email: EMAIL, password: PASSWORD }), {
    headers: JSON_HEADERS,
    tags: { endpoint: 'login' },
  });
  if (!check(res, { 'login 200': (r) => r.status === 200 })) {
    fail(`sign-in failed with ${res.status}`);
  }
  const jwt = res.json('token');
  if (!USE_API_KEY) {
    return { token: jwt, keyId: null };
  }
  const minted = http.post(`${BASE_URL}/api/v1/api-keys`, JSON.stringify({ name: 'k6-load-test' }), {
    headers: { ...JSON_HEADERS, Authorization: `Bearer ${jwt}` },
  });
  if (!check(minted, { 'api key minted': (r) => r.status === 200 || r.status === 201 })) {
    fail(`could not mint a service key: ${minted.status}`);
  }
  return { token: minted.json('key'), keyId: minted.json('id'), jwt };
}

/** Removes the key the test minted. */
export function cleanup(data) {
  if (data.keyId) {
    http.del(`${BASE_URL}/api/v1/api-keys/${data.keyId}`, null, {
      headers: { Authorization: `Bearer ${data.jwt}` },
    });
  }
}

export function bearer(data) {
  return { Authorization: `Bearer ${data.token}`, 'Content-Type': 'application/json' };
}
