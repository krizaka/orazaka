#!/usr/bin/env node
// Chat time-to-first-token (ADR-083): k6 cannot see inside a stream, so this reads it.
//
//   BASE_URL=... CHAT_BEARER=<session jwt or oz_ key> node tests/load/chat-ttft.mjs [--n 10] [--gap 10]
//
// Asks a one-word question n times, `gap` seconds apart (it is paced on purpose: a chat turn costs
// model tokens and ties up a connection), and reports the time to the first `data:` frame that carries
// text, and to the end of the stream. Exits 1 when the p95 first token breaks the SLO.
import { performance } from "node:perf_hooks";

const SLO_FIRST_TOKEN_P95_MS = 2000; // keep in step with lib/slo.js

const base = (process.env.BASE_URL ?? "http://localhost:8088").replace(/\/$/, "");
const bearer = process.env.CHAT_BEARER;
if (!bearer) {
  console.error("CHAT_BEARER is required (a session JWT or an oz_ key)");
  process.exit(2);
}
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const n = opt("n", 10);
const gapSeconds = opt("gap", 10);

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : NaN;
};

async function turn(i) {
  const conversation = `load-${Date.now()}-${i}`;
  const url = `${base}/api/v1/chat/stream/${conversation}?prompt=${encodeURIComponent("Answer with one word: ready?")}`;
  const t0 = performance.now();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${bearer}`, Accept: "text/event-stream" } });
  if (!res.ok || !res.body) {
    return { status: res.status };
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let firstToken = null;
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let cut;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const data = frame
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("");
      if (firstToken === null && data && data !== "[DONE]") {
        firstToken = performance.now() - t0;
      }
    }
  }
  return { status: res.status, firstToken, total: performance.now() - t0 };
}

const first = [];
const total = [];
let failed = 0;
for (let i = 0; i < n; i++) {
  const r = await turn(i).catch(() => ({ status: 0 }));
  if (r.status !== 200 || r.firstToken == null) {
    failed += 1;
    console.log(`turn ${i + 1}: failed (${r.status})`);
  } else {
    first.push(r.firstToken);
    total.push(r.total);
    console.log(`turn ${i + 1}: first token ${r.firstToken.toFixed(0)} ms, complete ${r.total.toFixed(0)} ms`);
  }
  if (i < n - 1) await new Promise((resolve) => setTimeout(resolve, gapSeconds * 1000));
}
const p95 = percentile(first, 95);
console.log(
  JSON.stringify({
    turns: n,
    failed,
    firstTokenMs: { p50: percentile(first, 50), p95, max: first.length ? Math.max(...first) : null },
    completeMs: { p50: percentile(total, 50), p95: percentile(total, 95) },
    sloFirstTokenP95Ms: SLO_FIRST_TOKEN_P95_MS,
  }),
);
process.exit(failed === 0 && p95 <= SLO_FIRST_TOKEN_P95_MS ? 0 : 1);
