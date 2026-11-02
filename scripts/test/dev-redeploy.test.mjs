// node --test scripts/test — the dev core image follows the repositories it clones (no merge left unbuilt, no rebuild for nothing).
import assert from "node:assert/strict";
import { test } from "node:test";
import { decide, rollbackVerdict, staleSourceVerdict } from "../dev-redeploy.mjs";

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

test("rollbackVerdict fails loudly when the active deployment is an automated rollback (dev ran an old image on 2026-10-29)", () => {
  const failed = "17af0bc7-cfd0-4eed-9c6e-f655164e31cb";
  const v = rollbackVerdict([
    { id: "6f720fd8", created_at: "2026-10-29T13:52:22Z", cause: `automated rollback after failed deployment of "${failed}"`, phase: "ACTIVE" },
    { id: failed, created_at: "2026-10-29T13:31:43Z", cause: "manual", phase: "ERROR" },
  ]);
  assert.equal(v.ok, false);
  assert.match(v.message, /automated rollback/);
  assert.match(v.message, new RegExp(failed));
});

test("rollbackVerdict fails when a newer deployment errored, passes when the active one is the latest", () => {
  const active = { id: "a", created_at: "2026-10-29T10:00:00Z", cause: "manual", phase: "ACTIVE" };
  assert.equal(rollbackVerdict([{ id: "b", created_at: "2026-10-29T11:00:00Z", cause: "manual", phase: "ERROR" }, active]).ok, false);
  assert.equal(rollbackVerdict([active]).ok, true);
  assert.equal(rollbackVerdict([{ ...active, phase: "ERROR" }]).ok, false);
});

test("staleSourceVerdict fails when the newest deployment of core built a commit behind main (2026-11-01: three builds of the commit before the fix)", () => {
  const dep = (id, sha, phase = "ERROR") => ({ id, created_at: "2026-11-01T01:30:12Z", cause: "app spec updated", phase, services: [{ name: "web", source_commit_hash: "w" }, { name: "core", source_commit_hash: sha }] });
  const stale = staleSourceVerdict([dep("59596535", "157c5b9"), dep("old", "aaaaaaa", "ACTIVE")], "ea4a19c");
  assert.equal(stale.ok, false);
  assert.match(stale.message, /59596535.*157c5b9.*ea4a19c.*--force-rebuild/);
  assert.equal(staleSourceVerdict([dep("new", "ea4a19c", "ACTIVE")], "ea4a19c").ok, true);
});

test("staleSourceVerdict ignores a deployment still building and one without a recorded commit", () => {
  assert.equal(staleSourceVerdict([{ id: "b", phase: "BUILDING", services: [{ name: "core", source_commit_hash: "x" }] }], "ea4a19c").ok, true);
  assert.equal(staleSourceVerdict([{ id: "n", phase: "ACTIVE", services: [] }], "ea4a19c").ok, true);
});

test("a finished deployment whose core has no recorded commit is not judged stale", () => {
  const v = staleSourceVerdict([{ id: "d1", phase: "ACTIVE", services: [{ name: "core" }] }], "abcdef1234");
  assert.equal(v.ok, true);
});

test("staleSourceVerdict waits while a rebuild is in progress: the check right after create-deployment must not fail the run (2026-11-01)", () => {
  const core = (sha) => [{ name: "core", source_commit_hash: sha }];
  const v = staleSourceVerdict([{ id: "b", phase: "BUILDING", services: [] }, { id: "a", phase: "ACTIVE", services: core("e5b019e") }], "d2bc55f");
  assert.equal(v.ok, true);
  assert.match(v.message, /in progress/);
});
