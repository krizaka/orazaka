#!/usr/bin/env node
// Summarises a PgBouncer sampling (`local-stack.mjs sample <csv>`): per pool, how long clients waited for a server
// connection. A pool whose `cl_waiting` stays above zero is the database-connection ceiling of ADR-083 §4.2.
//   node tests/load/pool-summary.mjs pools.csv [--from <epoch-seconds>] [--to <epoch-seconds>]
import { readFileSync } from "node:fs";

const [file] = process.argv.slice(2);
const flag = (name) => (process.argv.includes(`--${name}`) ? Number(process.argv[process.argv.indexOf(`--${name}`) + 1]) : null);
const from = flag("from") ?? -Infinity;
const to = flag("to") ?? Infinity;
if (!file) {
  console.error("usage: pool-summary.mjs <pools.csv> [--from s] [--to s]");
  process.exit(2);
}
const rows = readFileSync(file, "utf8").trim().split("\n").slice(1).map((l) => l.split(","))
  .map(([t, pool, active, waiting, svActive, svIdle, maxwait]) => ({ t: Number(t), pool, active: Number(active), waiting: Number(waiting), svActive: Number(svActive), svIdle: Number(svIdle), maxwait: Number(maxwait) }))
  .filter((r) => r.t >= from && r.t <= to);
const byPool = new Map();
for (const r of rows) {
  if (!byPool.has(r.pool)) byPool.set(r.pool, []);
  byPool.get(r.pool).push(r);
}
const pct = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0;
};
console.log("pool            samples  server conns busy (max)  clients waiting (p95 / max)  longest wait (s)  seconds with a queue");
for (const [pool, list] of [...byPool].sort()) {
  const busy = Math.max(...list.map((r) => r.svActive));
  const queued = list.filter((r) => r.waiting > 0).length;
  console.log(
    `${pool.padEnd(15)} ${String(list.length).padStart(7)}  ${String(busy).padStart(23)}  ${(pct(list.map((r) => r.waiting), 95) + " / " + Math.max(...list.map((r) => r.waiting))).padStart(26)}  ${String(Math.max(...list.map((r) => r.maxwait))).padStart(16)}  ${String(queued).padStart(20)}`,
  );
}
