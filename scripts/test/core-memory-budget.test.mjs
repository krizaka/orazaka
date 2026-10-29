// node --test scripts/test — the core container must fit its memory (2026-10-29: 8 JVMs + 2 Python workers on `basic-s`, 2 GiB,
// ran at 96-99 % memory and restarted several times an hour; each restart is ~4 minutes without the edge).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const MIB = { "basic-xs": 1024, "basic-s": 2048, "basic-m": 4096, "basic-l": 8192 };
// Outside the heap a JVM holds metaspace, the code cache (48m), direct buffers (64m) and thread stacks: ~200 MiB measured as a floor.
const JVM_OVERHEAD = 200;
// A supervised Python worker (document validation, hosted video) with its libraries.
const WORKER = 250;

test("the heaps, the JVMs' overhead and the workers fit the container's memory with 10 % to spare", () => {
  const sh = read("infra/deploy/run-services.sh");
  const services = /SERVICES="\$\{ORAZAKA_SERVICES:-([^}]+)\}"/.exec(sh)[1].trim().split(/\s+/).map((e) => Number(e.split(":")[2]));
  const workers = (sh.match(/starting the .* worker \(supervised\)/g) ?? []).length;
  const need = services.reduce((a, h) => a + h + JVM_OVERHEAD, 0) + workers * WORKER;
  const spec = read("infra/deploy/orazaka-dev.app.yaml");
  const core = /- name: core\n[\s\S]*?instance_size_slug: (\S+)/.exec(spec)[1];
  assert.ok(MIB[core], `unknown size ${core}`);
  assert.ok(need <= MIB[core] * 0.9, `core needs about ${need} MiB (${services.length} JVMs, ${workers} workers) but ${core} has ${MIB[core]} MiB`);
});
