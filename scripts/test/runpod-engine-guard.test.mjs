import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { engineState } from "../studio-preflight.mjs";
import { ENGINE_DOWN, engineStreak, engineWaitOver } from "../runpod-batch.mjs";

const DOWN = { message: "model: FLUX.2 [klein] 4B is not running (its engine could not be reached). Choose another model or leave it on automatic." };
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

// Guard (a): the engine is proved reachable through the Studio before a prompt is sent (krizaka-internal#138, $1.80 for nothing).
test("the Studio's answer tells up, down and refused apart", () => {
  assert.equal(engineState(202, { id: "r" }), "up");
  assert.equal(engineState(400, DOWN), "down");
  assert.equal(engineState(400, { message: "size: '1x1' is not supported by X" }), "refused");
  assert.equal(engineState(401, ""), "refused");
});
test("the engine wait ends after its minutes, counted from the pod's start", () => {
  const started = 1_000;
  assert.equal(engineWaitOver(started, (started + 14 * 60) * 1000, 15), false);
  assert.equal(engineWaitOver(started, (started + 15 * 60) * 1000, 15), true);
});
test("the batch proves the engine BEFORE its first prompt", () => {
  const src = read("../runpod-batch.mjs");
  const main = src.slice(src.indexOf("async function main"));
  assert.ok(main.indexOf("await waitForEngine(") > 0, "main waits for the engine");
  assert.ok(main.indexOf("await waitForEngine(") < main.indexOf("for (const clip of plan.clips)"), "before the first prompt");
});
test("the preflight has an engine mode that fails while the engine is down", () => {
  assert.match(read("../studio-preflight.mjs"), /--require-engine/);
});

// Guard (b): repeated « engine could not be reached » mid-batch stops paying.
test("three unreachable answers in a row abort", () => {
  let s = engineStreak(undefined, true, 0);
  s = engineStreak(s, true, 30_000);
  assert.equal(s.abort, false);
  s = engineStreak(s, true, 60_000);
  assert.equal(s.abort, true);
});
test("five minutes of unreachable answers abort, even with fewer of them", () => {
  let s = engineStreak(undefined, true, 0);
  s = engineStreak(s, true, 5 * 60_000);
  assert.equal(s.abort, true);
});
test("an answer from the engine resets the streak", () => {
  let s = engineStreak(undefined, true, 0);
  s = engineStreak(s, true, 30_000);
  s = engineStreak(s, false, 60_000);
  s = engineStreak(s, true, 90_000);
  assert.equal(s.count, 1);
  assert.equal(s.abort, false);
});
test("the unreachable answer is recognised in the image step's error", () => {
  assert.match(`image: POST /api/v1/studios/image-generation/runs → 400 ${DOWN.message}`, ENGINE_DOWN);
  assert.doesNotMatch("image: GET /api/v1/studios/runs/x → 502", ENGINE_DOWN);
});
test("the image step prints the Studio's message, so the batch can read it", () => {
  assert.match(read("../showcase-image-run.mjs"), /→ \$\{res\.status\} \$\{/);
});

// The root cause: a stills pod waited for ~49 GB of video weights and a 3-arch CUDA build before its image engine listened.
test("a stills pod starts sd-server without fetching the video weights", () => {
  const boot = read("../../infra/gpu/runpod-bootstrap.sh");
  const stills = boot.indexOf('if [[ -n "${STILLS:-}" ]]');
  assert.ok(stills > 0, "a STILLS branch");
  const branch = boot.slice(stills, boot.indexOf("\nfi\n", stills));
  assert.doesNotMatch(branch, /app\.fetch_models "\$\{PROFILE/, "no whole-profile fetch");
  assert.doesNotMatch(branch, /seedvr2|requirements-cuda/i, "no upscaler, no torch");
  assert.match(branch, /app\.sd_server/);
  assert.match(branch, /exit 0|wait/);
});
test("sd-server is built for the card it runs on (a B200 is sm_100)", () => {
  const boot = read("../../infra/gpu/runpod-bootstrap.sh");
  assert.match(boot, /compute_cap/);
  assert.doesNotMatch(boot, /CMAKE_CUDA_ARCHITECTURES="80;89;90"/);
});
test("the batch asks for a stills pod and the pod receives the setting", () => {
  assert.match(read("../lib/gpu-runpod.sh"), /STILLS=1/);
  assert.match(read("../runpod-guard.py"), /"STILLS"/);
});
test("the batch keeps the pod's boot log before it ends the pod", () => {
  const sh = read("../lib/gpu-runpod.sh");
  const cleanup = sh.slice(sh.indexOf("runpod_batch_cleanup() {"), sh.indexOf("runpod_batch() {"));
  assert.ok(cleanup.indexOf("pod-boot.log") > 0 && cleanup.indexOf("pod-boot.log") < cleanup.indexOf("runpod_stop"));
});

test("the watchdog's lifetime survives fractional hours (a batch gives MAX_HOURS=0.6)", () => {
  for (const f of ["../../infra/gpu/runpod-bootstrap.sh", "../../infra/gpu/runpod-measure.sh"]) {
    const src = read(f);
    assert.doesNotMatch(src, /\(\( age >= MAX \* 60 \)\)/, f);
    assert.match(src, /MAXMIN=\$\(awk/, f);
  }
});
