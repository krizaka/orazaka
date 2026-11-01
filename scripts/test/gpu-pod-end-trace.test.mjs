// node --test scripts/test — a pod that destroys itself leaves its end reason and boot log OFF the pod (krizaka-internal#2121).
// Incident 2026-11-01: an H200 pod (run 7 of the vertical film) vanished ~19 min after creation; the API said 404 and nothing on our side
// said why. The pod's watchdog now writes apps/orazaka/gpu-pods/<pod>/end.json and boot.log (Bunny layout v2) BEFORE the delete.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const root = new URL("../../", import.meta.url).pathname;
const bootstrap = readFileSync(join(root, "infra/gpu/runpod-bootstrap.sh"), "utf8");
const watchdog = bootstrap.slice(bootstrap.indexOf("<<'WD'\n") + 7, bootstrap.indexOf("\nWD\n"));
const dir = mkdtempSync(join(tmpdir(), "watchdog-trace-"));
const file = join(dir, "watchdog.sh");
writeFileSync(file, watchdog);

/** A fake `curl` that records each call (method, url, body) in `out` instead of using the network. */
function fakeCurl(bin, out) {
  writeFileSync(
    join(bin, "curl"),
    `#!/usr/bin/env bash
n=$(ls "${out}" | wc -l); body=""; method=GET; url=""
while [[ $# -gt 0 ]]; do case "$1" in -X) method=$2; shift;; --data-binary) body=\${2#@}; shift;; -w|-o|-H|-m) shift;; http*) url=$1;; esac; shift; done
{ echo "$method $url"; [[ -n "$body" ]] && cat "$body"; } > "${out}/$n"
[[ "$method" == DELETE ]] && printf 204
exit 0
`,
    { mode: 0o755 },
  );
}

test("guard: a watchdog destroy leaves a readable end reason and the boot log before the delete", () => {
  const work = mkdtempSync(join(tmpdir(), "wd-trace-"));
  const [bin, out, state] = ["bin", "out", "state/state"].map((d) => join(work, d));
  [bin, out, state].forEach((d) => mkdirSync(d, { recursive: true }));
  writeFileSync(join(work, "state", "boot-epoch"), String(Math.floor(Date.now() / 1000) - 19 * 60));
  writeFileSync(join(state, "progress"), "62 115\n");
  fakeCurl(bin, out);
  const r = spawnSync("bash", [file, "--destroy", "weights download failed"], {
    encoding: "utf8",
    timeout: 10000,
    env: {
      ...process.env, PATH: `${bin}:${process.env.PATH}`, ORAZAKA_STATE: join(work, "state"), RUNPOD_POD_ID: "pod123", RUNPOD_API_KEY: "k",
      MEDIA_STORAGE_API_KEY: "sentinel-value", MEDIA_STORAGE_ZONE: "zone", MEDIA_STORAGE_ENDPOINT: "storage.example",
    },
  });
  assert.equal(r.status, 0, r.stderr);
  const calls = readdirSync(out).sort((a, b) => a - b).map((f) => readFileSync(join(out, f), "utf8"));
  const iEnd = calls.findIndex((c) => c.startsWith("PUT https://storage.example/zone/apps/orazaka/gpu-pods/pod123/end.json"));
  const iDelete = calls.findIndex((c) => c.startsWith("DELETE "));
  assert.ok(iEnd >= 0, `end.json is written (${calls.map((c) => c.split("\n")[0])})`);
  assert.ok(iEnd < iDelete, "the reason is left BEFORE the pod is deleted");
  const trace = JSON.parse(calls[iEnd].split("\n").slice(1).join("\n"));
  assert.equal(trace.reason, "weights download failed");
  assert.equal(trace.pod, "pod123");
  assert.equal(trace.downloadProgress.trim(), "62 115");
  assert.ok(trace.ageMinutes >= 18 && trace.ageMinutes <= 20, `age ${trace.ageMinutes}`);
  assert.ok(calls.some((c) => c.startsWith("PUT https://storage.example/zone/apps/orazaka/gpu-pods/pod123/boot.log")), "the boot log is left too");
  assert.ok(!r.stdout.includes("sentinel-value") && !r.stderr.includes("sentinel-value"), "the storage key is never printed");
});

test("a pod without storage settings still destroys itself and says the reason stays on the pod", () => {
  const work = mkdtempSync(join(tmpdir(), "wd-nostore-"));
  const [bin, out] = ["bin", "out"].map((d) => join(work, d));
  [bin, out].forEach((d) => mkdirSync(d));
  fakeCurl(bin, out);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, ORAZAKA_STATE: work, RUNPOD_POD_ID: "p", RUNPOD_API_KEY: "k" };
  for (const k of ["MEDIA_STORAGE_API_KEY", "MEDIA_STORAGE_ZONE", "MEDIA_STORAGE_ENDPOINT"]) delete env[k];
  const r = spawnSync("bash", [file, "--destroy", "idle"], { encoding: "utf8", timeout: 10000, env });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /no storage settings/);
  assert.match(r.stdout, /destroyed through the API/);
});

test("the pod is given the storage settings for the trace (and a measurement pod is not)", () => {
  const guard = readFileSync(join(root, "scripts/runpod-guard.py"), "utf8");
  assert.match(guard, /MEDIA_STORAGE_API_KEY/);
  assert.match(guard, /not e\.get\("MEASURE"\)/);
});
