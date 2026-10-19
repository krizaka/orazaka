// node --test scripts/test — the UI workspace's members are cloned from their repositories' main, so the
// aggregate package-lock.json cannot be pinned by hand: a dependency bump in any member made `npm ci` fail
// (EUSAGE) in the Maven frontend step and turned Orazaka's main red. CI derives the lock from the clones
// before the build; the committed lock stays a convenience for local installs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");

test("CI resyncs the UI workspace lock from the cloned members before Maven runs npm ci", () => {
  const resync = ci.search(/npm install --package-lock-only --legacy-peer-deps/);
  const maven = ci.search(/\.\/mvnw /);
  assert.ok(resync > 0, "ci.yml must regenerate orazaka-apps/ui/package-lock.json");
  assert.ok(resync < maven, "the resync must run before the Maven build");
  assert.match(ci.slice(Math.max(0, resync - 300), resync), /working-directory:\s*orazaka-apps\/ui/);
});
