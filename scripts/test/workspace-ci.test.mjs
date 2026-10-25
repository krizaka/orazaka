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
