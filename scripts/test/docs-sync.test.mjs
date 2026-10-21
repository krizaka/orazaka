// docs-sync opens `chore/docs-sync` from main every day. It dispatched CI on that branch BEFORE pushing it
// (« No ref found for: chore/docs-sync », HTTP 422): every run that found drift failed, the branch never existed, the PR
// was never opened, and the generated docs stayed stale — so every pull request touching docs/ or scripts/ failed the
// « docs are stale » check. The dispatch comes once, after the push.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const wf = readFileSync(new URL("../../.github/workflows/docs-sync.yml", import.meta.url), "utf8");

test("CI is dispatched on chore/docs-sync once, and only after the branch is pushed", () => {
  const dispatches = [...wf.matchAll(/gh workflow run ci\.yml[^\n]*--ref chore\/docs-sync/g)];
  assert.equal(dispatches.length, 1, "one dispatch");
  const push = wf.indexOf("git push --force origin chore/docs-sync");
  assert.ok(push > 0, "the branch is pushed");
  assert.ok(dispatches[0].index > push, "the dispatch follows the push");
});
