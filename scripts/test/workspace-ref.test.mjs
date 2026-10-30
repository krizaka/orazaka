// A repository of the workspace manifest may name a `ref`: the clone takes that branch, so a lock and the code it
// locks (Expo SDK 57, orazaka-mobile-client#96) land in one pull request instead of waiting for each other.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../workspace.mjs", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../../orazaka.workspace.json", import.meta.url), "utf8"));

test("clone passes the manifest's ref to git as --branch and falls back to the default branch when it is gone", () => {
  assert.match(source, /"--branch", r\.ref/);
  assert.match(source, /is gone, cloning the default branch/);
});

test("a ref is a plain branch name of the repository, nothing a shell or git option could read", () => {
  for (const r of manifest.repositories.filter((x) => x.ref !== undefined)) {
    assert.match(r.ref, /^[A-Za-z0-9][A-Za-z0-9._/-]*$/, `${r.name}: ref`);
  }
});
