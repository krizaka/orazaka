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

test("the core build leaves nothing for the layer snapshot (jars copied out, target/ and the Maven repository removed): the eighth service made the snapshot run out of memory", () => {
  const dockerfile = readFileSync(new URL("../../infra/deploy/Dockerfile", import.meta.url), "utf8");
  const build = dockerfile.slice(dockerfile.indexOf('RUN echo "core build'), dockerfile.indexOf("# ── 3. Runtime"));
  assert.match(build, /\/out\/automation\.jar/);
  assert.match(build, /find \/workspace -type d -name target -prune -exec rm -rf/);
  assert.match(build, /rm -rf \/root\/\.m2\/repository/);
  assert.ok(build.lastIndexOf("/out/orazaka-worker-media") < build.indexOf("rm -rf /root/.m2/repository"), "clean up after the last copy");
});

test("the clone layer is also keyed by the apply's stamp (CORE_REBUILD): kaniko kept the cached clone although a repository had moved (packs 1.11.0 never reached dev, 2026-10-20)", () => {
  const clone = dockerfile.indexOf("RUN node scripts/workspace.mjs clone");
  const stamp = dockerfile.indexOf('RUN echo "sources ${CORE_REBUILD}"');
  const arg = dockerfile.indexOf("ARG CORE_REBUILD=0");
  assert.ok(arg > 0 && arg < stamp, "the ARG is declared in the sources stage, before its use");
  assert.ok(stamp > 0 && stamp < clone, "the stamp layer comes before the clone, so a new CORE_REBUILD invalidates it");
  assert.ok(arg < dockerfile.indexOf("FROM eclipse-temurin", 1), "declared in the first (sources) stage");
});
