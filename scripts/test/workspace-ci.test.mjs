// node --test — the workspace CI builds its upstream repositories to INSTALL them, not to test them (krizaka/.github#113, CI-CARBURE).
// Measured on orazaka-conversation-service: `install -DskipTests` still ran the Failsafe integration tests (Testcontainers) of every
// upstream — krizaka-platform-kit 87 s, billing 44 s, users 32 s, studio 37 s... — 3 to 4 minutes of a 6-minute job. Their own CI
// tests them. `-DskipTests` must therefore never travel without `-DskipITs`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../workspace.mjs", import.meta.url), "utf8");

test("every Maven install/deploy of an upstream skips the unit AND the integration tests", () => {
  const uses = source.split("\n").filter((l) => /"(install|deploy)",\s*\.\.\.SKIP_TESTS/.test(l));
  assert.ok(uses.length >= 3, "the upstream builds and the publish use SKIP_TESTS");
  assert.match(source, /const SKIP_TESTS = \["-DskipTests", "-DskipITs"\];/);
});

test("no bare -DskipTests is left in the workspace script", () => {
  const bare = source
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//"))
    .filter((l) => l.includes("-DskipTests") && !l.includes("const SKIP_TESTS"));
  assert.deepEqual(bare, []);
});

test("the packs recipe writes coverage.xml at the repository root (krizaka/.github#377): every worker suite runs under coverage, then one report", () => {
  const packs = source.slice(source.indexOf('target.kind === "packs"'));
  const suites = [...packs.matchAll(/run\("python3", \[\.\.\.COVERAGE, "(test_\w+\.py)"\]/g)].map((m) => m[1]);
  assert.ok(suites.includes("test_rules.py") && suites.includes("test_screening.py") && suites.includes("test_worker_broker.py"));
  assert.doesNotMatch(packs, /run\("python3", \["test_/, "no suite runs outside coverage");
  assert.match(packs, /"coverage", "xml"[\s\S]*"coverage\.xml"/);
});

test("every npm member with a format:check script is checked by the workspace CI (krizaka/.github#427)", () => {
  assert.match(source, /function formatCheck\(target\)/);
  assert.match(source, /scripts\?\.\["format:check"\]/);
  const calls = source.split("\n").filter((l) => l.trim() === "formatCheck(target);");
  assert.equal(calls.length, 2, "the pnpm member and the npm members both run it");
});
