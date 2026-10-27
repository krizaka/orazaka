// node --test scripts/test — the dev core image follows the repositories it clones (no merge left unbuilt, no rebuild for nothing).
import assert from "node:assert/strict";
import { test } from "node:test";
import { decide } from "../dev-redeploy.mjs";

const manual = { created_at: "2026-10-27T10:47:33Z", cause: "manual", phase: "ACTIVE" };

test("a component merged after the last manual rebuild starts one, and says which", () => {
  const v = decide({ deployments: [manual], heads: { orazaka: "2026-10-26T00:00:00Z", "krizaka-billing": "2026-10-27T11:00:00Z" } });
  assert.deepEqual([v.redeploy, v.newer], [true, ["krizaka-billing"]]);
});

test("nothing newer: nothing starts", () => {
  assert.equal(decide({ deployments: [manual], heads: { orazaka: "2026-10-27T10:00:00Z" } }).redeploy, false);
});

test("web-client pushes do not count as a rebuild of core; only a manual deployment does", () => {
  const push = { created_at: "2026-10-27T12:00:00Z", cause: "commit 1 pushed to github.com/krizaka/orazaka-web-client/tree/main", phase: "ACTIVE" };
  assert.equal(decide({ deployments: [push, manual], heads: { x: "2026-10-27T11:00:00Z" } }).redeploy, true);
});

test("never while a deployment is building, and a failed manual one does not count as done", () => {
  assert.equal(decide({ deployments: [{ ...manual, phase: "BUILDING" }], heads: { x: "2030-01-01T00:00:00Z" } }).redeploy, false);
  assert.equal(decide({ deployments: [{ ...manual, phase: "ERROR" }, { ...manual, created_at: "2026-10-01T00:00:00Z" }], heads: { x: "2026-10-10T00:00:00Z" } }).redeploy, true);
});
