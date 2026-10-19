import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* The dev image clones every workspace repository; its clone layer must be rebuilt when any of them moves. The cache key
   is one ADD of each repository's ref advertisement before the clone (kaniko reused the clone under --force-rebuild and
   shipped old code to dev on 2026-10-16). Every repository of orazaka.workspace.json has its line, before the clone. */
const root = new URL("../../", import.meta.url);
const workspace = JSON.parse(readFileSync(new URL("orazaka.workspace.json", root), "utf8"));
const dockerfile = readFileSync(new URL("infra/deploy/Dockerfile", root), "utf8");

test("every workspace repository's heads are part of the clone layer's cache key", () => {
  const clone = dockerfile.indexOf("RUN node scripts/workspace.mjs clone");
  assert.ok(clone > 0, "the clone step exists");
  for (const { name } of workspace.repositories) {
    const add = dockerfile.indexOf(`ADD https://github.com/krizaka/${name}.git/info/refs?service=git-upload-pack /tmp/workspace-refs/${name}\n`);
    assert.ok(add > 0, `${name} has its ADD line`);
    assert.ok(add < clone, `${name}'s ADD comes before the clone`);
  }
});

test("no ADD line names a repository the workspace no longer lists", () => {
  const names = new Set(workspace.repositories.map((r) => r.name));
  for (const m of dockerfile.matchAll(/ADD https:\/\/github\.com\/krizaka\/([\w.-]+)\.git\/info\/refs/g)) {
    assert.ok(names.has(m[1]), `${m[1]} is in orazaka.workspace.json`);
  }
});
