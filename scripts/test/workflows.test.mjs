// node --test scripts/test — workflow files GitHub would refuse. A workflow that is invalid fails in 0 s on
// every push with no job and no log (gpu-smoke.yml did for days: `runner` is not available in a job-level env),
// which is red on main that nobody sees. The contexts below are the ones a job-level `env:` cannot read.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const dir = new URL("../../.github/workflows/", import.meta.url);
const FORBIDDEN_IN_JOB_ENV = /\$\{\{[^}]*\b(runner|steps|job)\./;

/** Violations: `file:line` of each expression in a job-level `env:` block (indent 4) that reads a step-only context. */
export function jobEnvViolations(name, text) {
  const out = [];
  const lines = text.split("\n");
  let inJobEnv = false;
  lines.forEach((line, i) => {
    if (/^ {4}env:\s*$/.test(line)) inJobEnv = true;
    else if (inJobEnv && !/^ {5,}\S/.test(line) && line.trim() !== "" && !/^\s*#/.test(line)) inJobEnv = false;
    if (inJobEnv && FORBIDDEN_IN_JOB_ENV.test(line)) out.push(`${name}:${i + 1}: ${line.trim()}`);
  });
  return out;
}

test("the checker sees a runner context in a job-level env", () => {
  const bad = "jobs:\n  a:\n    env:\n      X: ${{ runner.temp }}/x\n    steps:\n      - run: echo\n";
  assert.equal(jobEnvViolations("t.yml", bad).length, 1);
  const ok = "jobs:\n  a:\n    steps:\n      - env:\n          X: ${{ runner.temp }}\n        run: echo\n";
  assert.equal(jobEnvViolations("t.yml", ok).length, 0);
});

test("no workflow reads runner/steps/job in a job-level env", () => {
  const found = readdirSync(dir)
    .filter((f) => f.endsWith(".yml"))
    .flatMap((f) => jobEnvViolations(f, readFileSync(new URL(f, dir), "utf8")));
  assert.deepEqual(found, [], `GitHub refuses these (the run fails in 0 s):\n${found.join("\n")}`);
});

test("docs-sync starts CI on its branch itself (a GITHUB_TOKEN PR starts none) and keeps write scopes on the job", () => {
  const text = readFileSync(new URL("docs-sync.yml", dir), "utf8");
  assert.match(text, /gh workflow run ci\.yml[^\n]*--ref chore\/docs-sync/);
  assert.match(text, /actions: write/);
  assert.doesNotMatch(text.split("jobs:")[0], /^  [a-z-]+: write/m, "no write scope at the top level (Scorecard TokenPermissions)");
});

test("the reusable component workflow keeps packages/id-token write on the job, not at the top level", () => {
  const text = readFileSync(new URL("component.yml", dir), "utf8");
  assert.doesNotMatch(text.split("jobs:")[0], /^  [a-z-]+: write/m);
});

test("CI holds a pull request to the docs gate only when it touches what the docs are made from", () => {
  const text = readFileSync(new URL("ci.yml", dir), "utf8");
  assert.match(text, /generate-docs\.mjs --check && exit 0/);
  assert.match(text, /::warning::docs\/_generated drifted/);
  assert.match(text, /docs\/\|scripts\/\|infra\//);
});
