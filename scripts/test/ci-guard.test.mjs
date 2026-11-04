// node --test scripts/test — main must not go red unnoticed: a failing CI run on main files (or comments on) one
// issue "main is red" in the private krizaka-internal (krizaka-internal#2267), through the org's alert-issue action and
// the app token, so this public repository never carries it and the job's own token stays read-only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");

test("CI has a job that reports a red main", () => {
  assert.match(ci, /^ {2}red-main:\s*$/m, "ci.yml needs a red-main job");
  const job = ci.slice(ci.search(/^ {2}red-main:\s*$/m));
  assert.match(job, /needs:\s*\[?workspace\]?/, "it must wait for the workspace job");
  assert.match(job, /if:\s*\$\{\{\s*always\(\)\s*&&\s*needs\.workspace\.result == 'failure'\s*&&\s*github\.ref == 'refs\/heads\/main'/, "only a failed run on main");
  assert.match(job, /permissions:\n {6}contents: read\n/, "least privilege: the job's own token only reads");
  assert.doesNotMatch(job, /issues:\s*write/, "the job's token never writes issues: the app token files the alert");
  assert.match(job, /uses: krizaka\/\.github\/actions\/alert-issue@[0-9a-f]{40}/, "the alert goes through the org's pinned alert-issue action");
  assert.match(job, /main is red/, "one issue, named 'main is red'");
});

test("the workflow-level token stays read-only", () => {
  assert.match(ci, /^permissions:\n {2}contents: read\n/m);
});
