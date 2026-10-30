#!/usr/bin/env node
/**
 * The FREE preflight of a paid GPU run (orazaka#508): before a pod is rented, ask the dev Studio the exact question the batch will ask
 * (same Studio, same model, same size) and stop if it would answer a 4xx for a reason a booted pod cannot fix.
 *
 *   ORAZAKA_QA_EMAIL=… ORAZAKA_QA_PASSWORD=… node scripts/studio-preflight.mjs --model flux-1-schnell --size 1024x1024
 *
 * A pod that is not up yet makes the Studio answer « <model> is not running (its engine could not be reached) »: that answer PROVES the
 * model is in the catalogue, in the closed set, and the size fits it, so it passes. Any other 4xx (« is not a image model », « is not
 * supported by », a missing field, a rejected login) fails: renting the GPU would only bill minutes before the same refusal.
 * A run the Studio accepts is cancelled at once (nothing is rendered, nothing is held).
 */
const BASE = process.env.ORAZAKA_EDGE_URL ?? "https://dev.orazaka.com/edge";

/** @returns {{ok: boolean, reason: string}} the verdict on one Studio answer. */
export function judge(status, body) {
  const message = typeof body === "string" ? body : (body?.message ?? JSON.stringify(body ?? ""));
  if (status >= 200 && status < 300) return { ok: true, reason: "the Studio accepts the run" };
  if (status === 400 && /is not running \(its engine could not be reached\)/.test(message)) return { ok: true, reason: "the model is in the catalogue; only its engine is down (a pod fixes that)" };
  return { ok: false, reason: `the Studio would refuse (${status}): ${message}`.slice(0, 400) };
}

async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    signal: AbortSignal.timeout(60_000),
    method,
    headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = text;
  try { parsed = JSON.parse(text); } catch { /* keep the text */ }
  return { status: res.status, body: parsed };
}

async function main() {
  const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
  const { ORAZAKA_QA_EMAIL: email, ORAZAKA_QA_PASSWORD: password } = process.env;
  if (!email || !password) throw new Error("ORAZAKA_QA_EMAIL / ORAZAKA_QA_PASSWORD are not set");
  const login = await call("POST", "/api/v1/auth/login", { email, password });
  if (login.status !== 200 || !login.body?.token) throw new Error(`login answered ${login.status}`);
  const token = login.body.token;
  const answer = await call("POST", "/api/v1/studios/image-generation/runs", { inputs: { prompt: "preflight", size: arg("size", "1024x1024"), model: arg("model") } }, token);
  if (answer.status >= 200 && answer.status < 300 && answer.body?.id) await call("POST", `/api/v1/studios/runs/${answer.body.id}/cancel`, undefined, token).catch(() => {});
  const verdict = judge(answer.status, answer.body);
  console.log(`preflight: ${verdict.ok ? "ok" : "REFUSED"} — ${verdict.reason}`);
  process.exit(verdict.ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(`preflight: ${e.message}`); process.exit(1); });
