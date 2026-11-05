// node --test scripts/test — a path an operator passes to a workspace tool (an output file, a folder) stays inside the repository.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { REPO_ROOT, repoPath } from "../lib/repo-path.mjs";

test("the repository root is the folder above scripts/", () => {
  assert.equal(REPO_ROOT, path.resolve(fileURLToPath(new URL("../..", import.meta.url))));
});

test("a relative or absolute path inside the repository is answered absolute", () => {
  assert.equal(repoPath("docs/measurements/law-bakeoff.json"), path.join(REPO_ROOT, "docs/measurements/law-bakeoff.json"));
  assert.equal(repoPath(path.join(REPO_ROOT, "var", "bakeoff")), path.join(REPO_ROOT, "var", "bakeoff"));
  assert.equal(repoPath("x", "/r"), path.join("/r", "x"));
});

test("a path outside the repository, or the root itself, is refused", () => {
  for (const p of ["../outside", "/etc/passwd", "var/../../outside", "", "."]) {
    assert.throws(() => repoPath(p, "/r"), /inside the repository/, p);
  }
  assert.throws(() => repoPath("/r-sibling/x", "/r"), /inside the repository/);
});
