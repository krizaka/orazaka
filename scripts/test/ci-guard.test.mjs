// node --test scripts/test — main must not go red unnoticed: a failing CI run on main opens (or comments on) one
// issue named "main is red", so the next person finds it without having to look at the Actions tab.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");

test("CI has a job that reports a red main", () => {
  assert.match(ci, /^ {2}red-main:\s*$/m, "ci.yml needs a red-main job");
  const job = ci.slice(ci.search(/^ {2}red-main:\s*$/m));
  assert.match(job, /needs:\s*\[?workspace\]?/, "it must wait for the workspace job");
  assert.match(job, /if:\s*\$\{\{\s*always\(\)\s*&&\s*needs\.workspace\.result == 'failure'\s*&&\s*github\.ref == 'refs\/heads\/main'/, "only a failed run on main");
  assert.match(job, /issues:\s*write/, "least privilege: issues: write at job level only");
  assert.match(job, /main is red/, "one issue, named 'main is red'");
});

test("the workflow-level token stays read-only", () => {
  assert.match(ci, /^permissions:\n {2}contents: read\n/m);
});
