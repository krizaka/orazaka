// node --test scripts/test — a pod must not be destroyed by its own watchdog while it works (krizaka-internal#2101).
// Incident 2026-11-01: three H200 pods (Wan 2.2 I2V A14B, ~115 GB of weights, no volume, 120 GB disk) ended with « idle for 15 min » before
// the engine answered (about $6.72): `ready` and the worker came up whether or not the weights were there, and a download or model load
// (GPU idle) counted as idleness.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { bootBudgetMinutes, diskVerdict, downloadEstimate, progressLine } from "../lib/boot-budget.mjs";

const root = new URL("../../", import.meta.url).pathname;
const bootstrap = readFileSync(join(root, "infra/gpu/runpod-bootstrap.sh"), "utf8");
const watchdog = bootstrap.slice(bootstrap.indexOf("<<'WD'\n") + 7, bootstrap.indexOf("\nWD\n"));
const dir = mkdtempSync(join(tmpdir(), "watchdog-"));
const file = join(dir, "watchdog.sh");
writeFileSync(file, watchdog);

// decide <idle> <age> <ready> <busy> <idle limit> <max min> <setup min>
const decide = (...args) => {
  const r = spawnSync("bash", [file, "--decide", ...args.map(String)], { encoding: "utf8", timeout: 5000 });
  assert.equal(r.status, 0, `the watchdog answers --decide (got ${r.status} ${r.signal ?? ""} ${r.stderr})`);
  return r.stdout.trim();
};

test("guard: a pod whose weights are downloading (GPU idle, heartbeat fresh) is not idle-killed", () => {
  assert.equal(decide(40, 40, 0, 1, 15, 90, 120), "");
  assert.equal(decide(40, 40, 1, 1, 15, 90, 120), "", "a model load or a job after ready counts too");
});
test("guard: ready before the weights, nothing happening, is the idle kill of the incident", () => {
  assert.equal(decide(15, 24, 1, 0, 15, 90, 120), "idle for 15 min");
});
test("the idle timer, the lifetime and the unfinished setup still end the pod", () => {
  assert.equal(decide(14, 30, 1, 0, 15, 90, 120), "");
  assert.match(decide(0, 90, 1, 1, 15, 90, 120), /lifetime/);
  assert.match(decide(0, 121, 0, 1, 15, 600, 120), /setup unfinished/);
});

test("guard: `ready` is set only after the weights, and a failed fetch ends the pod instead of serving nothing", () => {
  const main = bootstrap.slice(bootstrap.indexOf("# --- 3. weights"));
  const fetch = main.indexOf("app.fetch_models");
  assert.match(main.slice(fetch - 60, fetch), /if ! \(cd \/app-src && /, "the fetch's exit status is read");
  assert.ok(main.indexOf('--destroy "weights download failed"') > fetch);
  assert.ok(main.lastIndexOf('touch "$STATE/ready"') > fetch, "ready comes after the weights");
  assert.match(main, /heartbeat/, "the download beats while it runs");
  assert.match(main, /\/state\/progress/, "the download reports X / Y GB");
  assert.match(bootstrap, /MEDIA_HEARTBEAT_FILE=/, "the worker is told where to beat during a model load or a job");
});
test("the pod refuses weights that cannot fit its disk, before downloading", () => {
  assert.match(bootstrap, /do not fit in \$\{FREE_GB\} GB/);
});

test("boot budget: sized to the model's download, with a flat floor for a pod with nothing to fetch", () => {
  assert.equal(bootBudgetMinutes({ downloadGb: 0 }), 19);
  const a14b = bootBudgetMinutes({ downloadGb: 115 });
  assert.ok(a14b >= 40 && a14b <= 60, `A14B budget ${a14b}`);
  assert.ok(bootBudgetMinutes({ downloadGb: 34 }) < a14b);
});
test("preflight: 115 GB do not fit a 120 GB disk without a volume (the incident), do with a volume or a bigger disk", () => {
  assert.equal(diskVerdict({ downloadGb: 115, diskGb: 120, volume: "none" }).fits, false);
  assert.equal(diskVerdict({ downloadGb: 115, diskGb: 120, volume: "" }).fits, false);
  assert.equal(diskVerdict({ downloadGb: 115, diskGb: 120, volume: "models-ca" }).fits, true);
  assert.equal(diskVerdict({ downloadGb: 115, diskGb: 160, volume: "none" }).fits, true);
  assert.match(diskVerdict({ downloadGb: 115, diskGb: 120 }).reason, /GPU_RUNPOD_DISK_GB to 140/);
});
test("preflight: the download's time and cost are stated before paying", () => {
  const { minutes, usd } = downloadEstimate({ downloadGb: 115, rate: 5.29 });
  assert.ok(minutes >= 18 && minutes <= 22 && usd > 1.5 && usd < 2.2, `${minutes} min $${usd}`);
});
test("the batch reports the download, not « gone »", () => {
  assert.equal(progressLine("62 115\n"), "still downloading 62 / 115 GB");
  assert.equal(progressLine(undefined), "the pod gave no download progress");
  assert.match(readFileSync(join(root, "scripts/runpod-batch.mjs"), "utf8"), /progressLine\(/);
});
