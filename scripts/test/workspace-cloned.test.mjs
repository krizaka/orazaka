// The docs generator needs every repository of the workspace: run from a checkout without its siblings it died with
// « model registry: UPDATE of v1-5-pruned-emaonly, which no INSERT created » (the INSERTs are in orazaka-job-service).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { missingRepositories, notClonedMessage } from "../lib/workspace-cloned.mjs";

const repos = [
  { name: "a", path: "libs/a" },
  { name: "b", path: "apps/b" },
  { name: "c", path: "apps/c" },
];

test("a repository that is absent or empty is reported", () => {
  const present = new Map([["/w/libs/a", ["pom.xml"]], ["/w/apps/c", []]]);
  const missing = missingRepositories("/w", repos, {
    exists: (p) => present.has(p),
    list: (p) => present.get(p),
  });
  assert.deepEqual(missing.map((r) => r.name), ["b", "c"]);
});

test("a complete workspace reports nothing", () => {
  const missing = missingRepositories("/w", repos, { exists: () => true, list: () => ["x"] });
  assert.deepEqual(missing, []);
});

test("the message names the repositories and the command that clones them", () => {
  const text = notClonedMessage([repos[1]]);
  assert.match(text, /apps\/b/);
  assert.match(text, /workspace\.mjs clone/);
});

test("generate-docs.mjs stops on an incomplete workspace before it reads the model catalogue", () => {
  const src = readFileSync(new URL("../generate-docs.mjs", import.meta.url), "utf8");
  const guard = src.indexOf("missingRepositories(");
  const registry = src.indexOf("const registry = extractRegistry()");
  assert.ok(guard > 0 && registry > 0 && guard < registry, "the workspace check must precede extractRegistry()");
});
