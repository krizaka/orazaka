// lock-sync opens `chore/ui-lock-sync` when the workspace lock drifts from the components' floors. Same trap as docs-sync
// (fixed in #308): CI is dispatched on the branch only AFTER it is pushed, and once.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const wf = readFileSync(new URL("../../.github/workflows/lock-sync.yml", import.meta.url), "utf8");

test("the lock is regenerated with npm 11 in orazaka-apps/ui, from the components' default branches", () => {
  assert.match(wf, /workspace\.mjs clone/);
  assert.match(wf, /working-directory: orazaka-apps\/ui/);
  assert.match(wf, /npx -y npm@11 install --legacy-peer-deps --package-lock-only/);
});

test("CI is dispatched on chore/ui-lock-sync once, after the push", () => {
  const dispatches = [...wf.matchAll(/gh workflow run ci\.yml[^\n]*--ref chore\/ui-lock-sync/g)];
  assert.equal(dispatches.length, 1);
  assert.ok(dispatches[0].index > wf.indexOf("git push --force origin chore/ui-lock-sync"));
});
