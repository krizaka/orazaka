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

// Root of the recurring « docs are stale » reds: the generated docs read the default branches of ~20 repositories, so they
// drift whenever one of them merges, while docs-sync ran once a day and left its pull request waiting for a human. Every
// PR touching docs/ or scripts/ failed in between. It now runs every two hours and puts auto-merge on its own pull request.
test("docs-sync runs every two hours, not daily", () => {
  assert.match(wf, /cron: "17 \*\/2 \* \* \*"/);
});

test("its pull request is merged by itself once green", () => {
  const merge = wf.indexOf("gh pr merge");
  assert.ok(merge > wf.indexOf("gh pr create"), "auto-merge follows the creation");
  assert.match(wf, /gh pr merge[^\n]*--auto --squash/);
});
