// node --test scripts/test — the "Measured runs" page is generated from the run records, and says what the records say.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { mdMeasuredRuns, summarise } from "../lib/measured-runs.mjs";

const dataset = JSON.parse(readFileSync(new URL("../../docs/measurements/runs.json", import.meta.url), "utf8"));

const fake = {
  measuredOn: "2026-01-01",
  setup: { machine: "m", engine: "e", platform: "p", hostedProvider: "h" },
  models: { a: { label: "A", kind: "image", where: "digitalocean", licence: "L", priceUnit: "per image", costUsd: 0.1, parameters: { size: "1×1" } }, b: { label: "B", kind: "video", where: "mac", licence: "L", costUsd: null, parameters: {} } },
  engineSeconds: { b: [10, 20, 30] },
  runs: [
    { model: "a", outcome: "succeeded", seconds: 8 },
    { model: "a", outcome: "succeeded", seconds: 10 },
    { model: "a", outcome: "succeeded", seconds: 12 },
    { model: "a", outcome: "succeeded", seconds: 900, excludedFromStats: "the worker restarted" },
    { model: "a", outcome: "placeholder", seconds: 120 },
    { model: "b", outcome: "failed", seconds: null },
  ],
  events: [{ kind: "timeout", what: "it timed out", cause: "the client waits 2 minutes" }],
};

test("a model's time is the median and the range of the runs that produced their output, without the ones left out", () => {
  const a = summarise(fake).a;
  assert.deepEqual(a.seconds, { n: 3, min: 8, median: 10, max: 12 });
  assert.equal(a.runs, 5);
  assert.equal(a.succeeded, 4);
  assert.equal(a.placeholders, 1);
  assert.equal(a.excluded, 1);
});

test("what it cost is the number of runs that produced their output times the provider's price; a local model costs nothing", () => {
  const s = summarise(fake);
  assert.equal(s.a.costUsd, 0.4);
  assert.equal(s.b.costUsd, null);
  assert.deepEqual(s.b.engine, { n: 3, min: 10, median: 20, max: 30 });
});

test("the page names the date, the setup, the parameters, the failures with their causes, the cost and the re-measure rule", () => {
  const md = mdMeasuredRuns(fake);
  for (const text of ["2026-01-01", "| Machine | m |", "**size:** 1×1", "it timed out", "the client waits 2 minutes", "$0.40", "measured again when the setup changes", "energy of the Mac was **not measured**"]) {
    assert.ok(md.includes(text), `missing: ${text}`);
  }
  assert.match(md, /the worker restarted/);
});

test("the committed measurements are consistent: every run is of a known model, every priced output uses the model's price, no run is typed with another cost", () => {
  for (const run of dataset.runs) {
    const model = dataset.models[run.model];
    assert.ok(model, `${run.runId}: unknown model ${run.model}`);
    assert.match(run.runId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    if (run.costUsd != null) assert.equal(run.costUsd, model.costUsd, run.runId);
    if (model.costUsd == null) assert.equal(run.costUsd ?? null, null, run.runId);
  }
  assert.match(dataset.measuredOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(dataset.commit, /^[0-9a-f]{7,}$/);
});

test("the committed measurements contain no key, token or account identifier", () => {
  const text = readFileSync(new URL("../../docs/measurements/runs.json", import.meta.url), "utf8");
  assert.doesNotMatch(text, /Bearer |api[_-]?key|secret|password|dop_v1|sk-[A-Za-z0-9]{10}/i);
});
