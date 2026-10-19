// What the edge itself promises, checked end to end against tests/load/stub-stack.mjs (ADR-083):
// the per-key rate limit (429 + Retry-After), Idempotency-Key passing through both ways, a bad key
// refused at the door, and an event stream relayed frame by frame. Run with the edge in `enforce`
// mode:  ABUSE_RATE_LIMIT_MODE=enforce  (CI does, see .github/workflows/load-smoke.yml).
//
//   k6 run -e BASE_URL=http://127.0.0.1:8088 tests/load/edge-contract.js
import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = (__ENV.BASE_URL || 'http://127.0.0.1:8088').replace(/\/$/, '');

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: { checks: ['rate==1'] },
};

const json = (key) => ({ headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } });

export default function () {
  // A key whose owner's tier allows 5 requests a minute: five pass, the sixth is told when to return.
  const tiny = 'oz_tier5_contract';
  let lastOk;
  for (let i = 0; i < 5; i++) {
    lastOk = http.get(`${BASE_URL}/api/v1/studios`, json(tiny));
    check(lastOk, { [`call ${i + 1} of 5 passes`]: (r) => r.status === 200 });
  }
  check(lastOk, {
    'RateLimit-Limit is the tier': (r) => r.headers['Ratelimit-Limit'] === '5',
    'RateLimit-Remaining counts down to 0': (r) => r.headers['Ratelimit-Remaining'] === '0',
  });
  const refused = http.get(`${BASE_URL}/api/v1/studios`, json(tiny));
  check(refused, {
    'the 6th call is a 429': (r) => r.status === 429,
    'Retry-After is a positive number of seconds': (r) => Number(r.headers['Retry-After']) >= 1,
    'the body says when to come back': (r) => r.json('retryAfterSeconds') >= 1,
  });
  // Another key is not slowed by it.
  check(http.get(`${BASE_URL}/api/v1/studios`, json('oz_tier5_other')), {
    'another key still passes': (r) => r.status === 200,
  });

  // Idempotency-Key crosses the edge both ways: the same key answers the same run, flagged.
  const key = `contract-${Date.now()}`;
  const body = JSON.stringify({ inputs: { document: 'a lease' } });
  const headers = { ...json('oz_tier600_contract').headers, 'Idempotency-Key': key };
  const first = http.post(`${BASE_URL}/api/v1/studios/compliance-check/runs`, body, { headers });
  const again = http.post(`${BASE_URL}/api/v1/studios/compliance-check/runs`, body, { headers });
  const other = http.post(
    `${BASE_URL}/api/v1/studios/compliance-check/runs`,
    JSON.stringify({ inputs: { document: 'another lease' } }),
    { headers },
  );
  check(first, { 'first start is accepted': (r) => r.status === 202 });
  check(again, {
    'the retry answers the same run': (r) => r.status === 202 && r.json('id') === first.json('id'),
    'and says it is a replay': (r) => r.headers['Idempotent-Replayed'] === 'true',
  });
  check(other, { 'the key reused for another request is refused': (r) => r.status === 422 });

  // A key the identity service does not know never reaches a backend.
  check(http.get(`${BASE_URL}/api/v1/studios`, json('oz_invalid')), { 'an invalid key is a 401': (r) => r.status === 401 });

  // A stream is relayed as a stream.
  const stream = http.get(`${BASE_URL}/api/v1/chat/stream/contract?prompt=ready`, {
    headers: { Authorization: 'Bearer oz_tier600_contract', Accept: 'text/event-stream' },
  });
  check(stream, {
    'the stream keeps its content type': (r) => String(r.headers['Content-Type']).startsWith('text/event-stream'),
    'every frame arrives, to the end': (r) => r.body.includes('[DONE]') && r.body.includes('"w11 "'),
  });
}
