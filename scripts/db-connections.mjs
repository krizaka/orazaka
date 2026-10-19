#!/usr/bin/env node
// Connection budget alarm for krizaka-dev-pg (docs/DEV_DATABASE.md, "Connection budget").
// DigitalOcean monitoring has no connection-count metric, so the check is a read-only query piped in:
//   psql "$URL" -At -F, -c "select usename, count(*) from pg_stat_activity where datname is not null group by 1" \
//     | node scripts/db-connections.mjs [--max 25] [--reserved 3] [--threshold 80]
// Exit 1 when the usable slots are used above the threshold. Prints counts per role, never a credential.
import { pathToFileURL } from "node:url";

export function parseRows(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [role, count] = line.split(",");
      const n = Number(count);
      if (!role || !Number.isInteger(n) || n < 0) throw new Error(`not a "role,count" line: ${line}`);
      return { role, count: n };
    });
}

/** Usable slots = max_connections minus the ones the provider keeps for itself (DigitalOcean: 25 − 3 = 22). */
export function evaluate(rows, { max = 25, reserved = 3, threshold = 80 } = {}) {
  const usable = max - reserved;
  const used = rows.reduce((sum, row) => sum + row.count, 0);
  const percent = Math.round((used / usable) * 100);
  return { usable, used, percent, over: percent > threshold, byRole: [...rows].sort((a, b) => b.count - a.count) };
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const result = evaluate(parseRows(input), { max: arg("max", 25), reserved: arg("reserved", 3), threshold: arg("threshold", 80) });
  for (const { role, count } of result.byRole) console.log(`${String(count).padStart(3)}  ${role}`);
  console.log(`${result.used}/${result.usable} usable connections (${result.percent} %)`);
  if (result.over) {
    console.error(`ALERT: above the threshold — see docs/DEV_DATABASE.md, "Connection budget"`);
    process.exit(1);
  }
}
