// node --test scripts/test - the guard of skipped integration tests (orazaka-studio#98).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { judge, load, readReport } from "../lib/skipped-tests.mjs";

const xml = (name, tests, skipped) => `<?xml version="1.0"?><testsuite name="${name}" time="1" tests="${tests}" errors="0" skipped="${skipped}" failures="0"><testcase name="a"/></testsuite>`;

test("reads the suite's name, tests and skipped", () => {
  assert.deepEqual(readReport(xml("a.FooIT", 47, 0)), { name: "a.FooIT", tests: 47, skipped: 0 });
});

test("orazaka-studio#98: a class that skipped itself fails, the ones that ran pass and are counted", () => {
  const verdict = judge("orazaka-studio", [readReport(xml("a.RunIT", 47, 47)), readReport(xml("a.PackIT", 12, 0))]);
  assert.deepEqual(verdict.offenders.map((r) => r.name), ["a.RunIT"]);
  assert.equal(verdict.tests, 59);
});

test("an allow-listed skip passes for its component only, and a stale entry is reported", () => {
  const allowed = [{ component: "orazaka-studio", class: "a.GpuIT", reason: "needs a GPU" }];
  const skipping = [readReport(xml("a.GpuIT", 3, 3))];
  assert.equal(judge("orazaka-studio", skipping, allowed).offenders.length, 0);
  assert.equal(judge("orazaka-packs", skipping, allowed).offenders.length, 1);
  assert.equal(judge("orazaka-studio", [readReport(xml("a.GpuIT", 3, 0))], allowed).stale.length, 1);
});

test("finds the reports of every module and ignores surefire's", () => {
  const dir = mkdtempSync(join(tmpdir(), "fs-"));
  mkdirSync(join(dir, "svc", "target", "failsafe-reports"), { recursive: true });
  mkdirSync(join(dir, "svc", "target", "surefire-reports"), { recursive: true });
  writeFileSync(join(dir, "svc", "target", "failsafe-reports", "TEST-a.RunIT.xml"), xml("a.RunIT", 5, 0));
  writeFileSync(join(dir, "svc", "target", "surefire-reports", "TEST-a.UnitIT.xml"), xml("a.UnitIT", 1, 1));
  assert.deepEqual(load(dir).map((r) => r.name), ["a.RunIT"]);
});

test("a component with no integration test fails unless it is declared, and a declared one that gains a test is stale", () => {
  const declared = [{ component: "orazaka-contracts", reason: "libraries" }];
  assert.equal(judge("orazaka-contracts", [], [], []).nothingRan, true);
  assert.equal(judge("orazaka-contracts", [], [], declared).nothingRan, false);
  assert.equal(judge("orazaka-packs", [], [], declared).nothingRan, true);
  assert.equal(judge("orazaka-contracts", [readReport(xml("a.FooIT", 1, 0))], [], declared).staleExemption?.component, "orazaka-contracts");
});
