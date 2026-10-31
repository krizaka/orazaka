#!/usr/bin/env node
/**
 * node scripts/check-skipped-tests.mjs <component-dir> <component-name>
 * Fails when an integration test of the component skipped itself (see scripts/lib/skipped-tests.mjs), except the
 * justified skips of scripts/skipped-tests-allowlist.json. Prints the count: the proof, in the log, that they ran.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { judge, load } from "./lib/skipped-tests.mjs";

const [dir, component] = process.argv.slice(2);
const list = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "skipped-tests-allowlist.json"), "utf8"));
const allowed = list.allowed;
const reports = load(resolve(dir));
const verdict = judge(component, reports, allowed, list.noIntegrationTests);

console.log(`${component}: ${verdict.classes} integration test classes, ${verdict.tests} tests, ${verdict.skipped} skipped`);
for (const r of reports) console.log(`  ${r.name}: ${r.tests} tests, ${r.skipped} skipped`);
for (const r of verdict.offenders) console.error(`SKIPPED, not allowed: ${r.name} (${r.skipped}/${r.tests}) - run it in CI, or justify it in scripts/skipped-tests-allowlist.json`);
for (const a of verdict.stale) console.error(`STALE allow-list entry: ${a.class} no longer skips - remove it`);
if (verdict.staleExemption) console.error(`STALE noIntegrationTests entry: ${component} now has integration tests - remove it`);
if (verdict.nothingRan) console.error(`No integration test report under ${dir}: nothing ran, so nothing is proven.`);
process.exit(verdict.offenders.length || verdict.stale.length || verdict.nothingRan || verdict.staleExemption ? 1 : 0);
