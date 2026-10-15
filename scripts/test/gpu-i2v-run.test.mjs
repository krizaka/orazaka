// node --test scripts/test — the image-to-video batch: its plan is complete and honest, its cost and facts are computed, not wished.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { factsOf, gpuCostUsd, runSeconds } from "../gpu-i2v-run.mjs";

const plan = JSON.parse(readFileSync(new URL("../gpu-i2v-plan.json", import.meta.url), "utf8"));

test("every subject of the plan comes as a 16:9 and a 9:16 pair, each with its own prompt and a fixed seed", () => {
  const bySubject = new Map();
  for (const clip of plan.clips) bySubject.set(clip.source, [...(bySubject.get(clip.source) ?? []), clip]);
  assert.ok(bySubject.size >= 4);
  for (const [source, clips] of bySubject) {
    assert.deepEqual(clips.map((c) => c.aspect).sort(), ["16:9", "9:16"], source);
    assert.notEqual(clips[0].prompt, clips[1].prompt, `${source}: re-prompted per aspect`);
    for (const c of clips) assert.ok(Number.isInteger(c.seed) && c.seconds === 5, c.id);
  }
  assert.equal(new Set(plan.clips.map((c) => c.id)).size, plan.clips.length);
  assert.equal(plan.model, "wan2.2-ti2v-5b");
});

test("the facts of a run are what its jobs measured, merged", () => {
  const facts = factsOf([null, { result: { metrics: { model: "wan2.2-ti2v-5b", width: 960, height: 544, frames: 121, fps: 24, seed: "5" } } }]);
  assert.deepEqual(facts, { model: "wan2.2-ti2v-5b", width: 960, height: 544, frames: 121, fps: 24, seed: "5" });
  assert.deepEqual(factsOf([]), {});
});

test("GPU cost is wall seconds at the hourly rate", () => {
  assert.equal(gpuCostUsd(3600, 0.76), 0.76);
  assert.equal(gpuCostUsd(900, 0.76), 0.19);
});

test("a run's time is the platform's own clock, never when the script noticed", () => {
  assert.equal(runSeconds({ startedAt: "2026-10-15T20:02:19.118878Z", finishedAt: "2026-10-15T20:20:44.854535Z" }), 1106);
  assert.equal(runSeconds({}), undefined);
});
