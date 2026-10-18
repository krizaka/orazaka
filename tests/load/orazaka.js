// Orazaka load suite (ADR-083). One file, four scenarios, thresholds tied to the SLO table.
//
//   k6 run -e PROFILE=smoke  -e BASE_URL=http://localhost:8088 tests/load/orazaka.js
//   k6 run -e PROFILE=dev    -e BASE_URL=https://dev.orazaka.com/edge ...   (a few RPS, off-peak, announced)
//   k6 run -e PROFILE=load   -e BASE_URL=http://localhost:8088 ...          (a local stack only)
//
// PROFILE sets the arrival rates; SCENARIOS=sync,run,login (comma list) narrows what runs.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { SLO } from './lib/slo.js';
import { BASE_URL, EMAIL, INPUTS, PASSWORD, STUDIO } from './lib/env.js';
import { authenticate, bearer, cleanup, loginDuration } from './lib/auth.js';

const runStart = new Trend('run_start_duration', true);
const runToTerminal = new Trend('run_to_terminal_duration', true);
const replayed = new Counter('idempotent_replays');
const idempotencyHeld = new Rate('idempotency_held');
const limited = new Counter('rate_limited_429');
const runSkipped = new Counter('run_skipped');

// Arrival rates (iterations per second) per profile. `dev` is deliberately tiny: the dev stack is
// shared and small (one 2 GB container), so it is a check that the suite works there, not a stress.
const PROFILES = {
  smoke: { sync: 5, run: 0.5, login: 0.2, chat: 0.2, seconds: 30, vus: 10 },
  dev: { sync: 2, run: 0.1, login: 0.05, chat: 0.05, seconds: 60, vus: 5 },
  load: { sync: 100, run: 5, login: 2, chat: 2, seconds: 180, vus: 200 },
};
const profile = { ...PROFILES[__ENV.PROFILE || 'smoke'] };
// Narrow overrides, for finding a knee: RATE (sync requests per second) and SECONDS.
if (__ENV.RATE) profile.sync = Number(__ENV.RATE);
if (__ENV.SECONDS) profile.seconds = Number(__ENV.SECONDS);
if (__ENV.RATE) profile.vus = Math.max(profile.vus, Math.ceil(Number(__ENV.RATE) / 2));
const wanted = (__ENV.SCENARIOS || 'sync,run,login').split(',');

function scenario(name, exec, rate) {
  return {
    executor: 'constant-arrival-rate',
    exec,
    rate: Math.max(1, Math.round(rate * 10)),
    timeUnit: '10s',
    duration: `${profile.seconds}s`,
    preAllocatedVUs: profile.vus,
    maxVUs: profile.vus * 4,
    tags: { scenario: name },
  };
}

const scenarios = {};
if (wanted.includes('sync')) scenarios.sync = scenario('sync', 'syncApi', profile.sync);
if (wanted.includes('run')) scenarios.run = scenario('run', 'runStartAndPoll', profile.run);
if (wanted.includes('login')) scenarios.login = scenario('login', 'login', profile.login);

// Thresholds are the SLO table. A run that breaks one exits non-zero (CI fails). A threshold on a
// metric no sample will feed (its scenario is off) would only add noise, so they follow SCENARIOS.
const thresholds = {};
if (scenarios.sync) {
  thresholds['http_req_duration{endpoint:sync}'] = [`p(95)<${SLO.syncApiP95}`];
  thresholds['http_req_failed{endpoint:sync}'] = [`rate<${SLO.syncApiErrorRate}`];
}
if (scenarios.login) thresholds.login_duration = [`p(95)<${SLO.loginP95}`];
if (scenarios.run) {
  thresholds.run_start_duration = [`p(95)<${SLO.runStartP95}`];
  if (__ENV.NO_REPLAY !== '1') thresholds.idempotency_held = ['rate==1'];
}

export const options = {
  scenarios,
  thresholds,
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  return authenticate();
}

export function teardown(data) {
  cleanup(data);
}

function noteLimit(res) {
  if (res.status === 429) {
    limited.add(1);
  }
}

export function syncApi(data) {
  const headers = bearer(data);
  const a = http.get(`${BASE_URL}/api/v1/studios`, { headers, tags: { endpoint: 'sync' } });
  noteLimit(a);
  check(a, { 'studios 200': (r) => r.status === 200 });
  const b = http.get(`${BASE_URL}/api/v1/profile`, { headers, tags: { endpoint: 'sync' } });
  noteLimit(b);
  check(b, { 'profile 200': (r) => r.status === 200 });
}

export function login() {
  // The sign-in path under load: the same call as setup, nothing kept.
  const res = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, tags: { endpoint: 'login' } },
  );
  noteLimit(res);
  check(res, { 'login 200': (r) => r.status === 200 });
  if (res.status === 200) {
    loginDuration.add(res.timings.duration);
  }
}

function uuid() {
  // Good enough for a key: unique per VU and iteration.
  return `k6-${__VU}-${__ITER}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

export function runStartAndPoll(data) {
  const headers = bearer(data);
  const key = uuid();
  const body = JSON.stringify({ inputs: INPUTS });
  const url = `${BASE_URL}/api/v1/studios/${STUDIO}/runs`;

  const start = http.post(url, body, { headers: { ...headers, 'Idempotency-Key': key }, tags: { endpoint: 'run-start' } });
  noteLimit(start);
  if (start.status === 409 || start.status === 402 || start.status === 404) {
    // Not entitled / unaffordable / absent on this stack: the scenario cannot run here.
    runSkipped.add(1);
    return;
  }
  if (!check(start, { 'run accepted 202': (r) => r.status === 202 })) {
    return;
  }
  runStart.add(start.timings.duration);
  const runId = start.json('id');

  // The same key, the same request: the same run, flagged as a replay (ADR-083). NO_REPLAY=1 skips it
  // on a stack that does not have idempotency yet (it would start the run twice).
  if (__ENV.NO_REPLAY === '1') {
    pollUntilTerminal(runId, headers);
    return;
  }
  const again = http.post(url, body, { headers: { ...headers, 'Idempotency-Key': key }, tags: { endpoint: 'run-start-replay' } });
  const held = again.status === 202 && again.json('id') === runId && again.headers['Idempotent-Replayed'] === 'true';
  idempotencyHeld.add(held);
  if (held) replayed.add(1);

  pollUntilTerminal(runId, headers);
}

function pollUntilTerminal(runId, headers) {
  // Poll until terminal, politely: one read a second, at most 90 s.
  const t0 = Date.now();
  for (let i = 0; i < 90; i++) {
    sleep(1);
    const r = http.get(`${BASE_URL}/api/v1/studios/runs/${runId}`, { headers, tags: { endpoint: 'sync' } });
    noteLimit(r);
    const status = r.status === 200 ? r.json('status') : null;
    if (status && status !== 'RUNNING' && status !== 'PENDING' && status !== 'AWAITING_APPROVAL') {
      runToTerminal.add(Date.now() - t0);
      check(r, { 'run reached a terminal state': () => true });
      return;
    }
  }
}
