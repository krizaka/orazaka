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
    if (model.gpuUsdPerHour) {
      // A GPU droplet is billed by the hour: a run costs its own start-to-finish time at the model's hourly rate.
      assert.ok(Math.abs(run.costUsd - (run.seconds / 3600) * model.gpuUsdPerHour) < 0.01, `${run.runId}: GPU time cost`);
      continue;
    }
    if (run.costUsd != null) assert.equal(run.costUsd, model.costUsd, run.runId);
    if (model.costUsd == null) assert.equal(run.costUsd ?? null, null, run.runId);
  }
  assert.match(dataset.measuredOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(dataset.commit, /^[0-9a-f]{7,}$/);
});

test("a GPU-hour model costs the GPU time of its own runs, and the page says what the droplet sessions were billed", () => {
  const gpu = {
    ...fake,
    models: { g: { label: "G", kind: "video", where: "gpu", licence: "L", gpuUsdPerHour: 0.76, costUsd: null, parameters: {} } },
    engineSeconds: {},
    runs: [
      { model: "g", outcome: "succeeded", seconds: 1800, costUsd: 0.38 },
      { model: "g", outcome: "succeeded", seconds: 900, costUsd: 0.19 },
      { model: "g", outcome: "failed", seconds: 17, costUsd: 0 },
    ],
    gpuSessions: [{ what: "batch", gpu: "RTX 4000 Ada", hours: 2, usdPerHour: 0.76 }],
  };
  assert.equal(summarise(gpu).g.costUsd, 0.57);
  const md = mdMeasuredRuns(gpu);
  for (const text of ["$0.76 per GPU hour", "$0.57", "GPU droplet sessions (what was billed)", "$1.52", "setup (image build, weights)"]) assert.ok(md.includes(text), `missing: ${text}`);
});

test("the committed measurements contain no key, token or account identifier", () => {
  const text = readFileSync(new URL("../../docs/measurements/runs.json", import.meta.url), "utf8");
  assert.doesNotMatch(text, /Bearer |api[_-]?key|secret|password|dop_v1|sk-[A-Za-z0-9]{10}/i);
});

test("video upscaling: every tested upscaler is a row with its licence, size, time, cost and the verdict a person gave after looking at the frames", () => {
  const md = mdMeasuredRuns({
    ...fake,
    upscaleTests: [
      { model: "Up A", licence: "Apache-2.0", commercial: "yes", clip: "5 s", from: "1280×704", to: "1920×1080", seconds: 66, gpuUsdPerHour: 3.99, verdict: "winner: clean detail" },
      { model: "Up B", licence: "BSD-3-Clause", commercial: "yes", clip: "5 s", from: "1280×704", to: "3840×2160", seconds: 168, gpuUsdPerHour: 3.99, verdict: "grainy" },
      { model: "Native C", licence: "Community", commercial: "conditions", clip: "5 s", from: "—", to: "—", seconds: null, gpuUsdPerHour: 3.99, verdict: "not run: weights too large" },
    ],
  });
  assert.match(md, /## Video upscaling/);
  assert.match(md, /\| Up A \| Apache-2\.0 \| yes \| 1280×704 → 1920×1080 \| 66 s \| \$0\.07 \| winner: clean detail \|/); // 66 s of a $3.99 hour
  assert.match(md, /\| Up B \| BSD-3-Clause \| yes \| 1280×704 → 3840×2160 \| 168 s \| \$0\.19 \| grainy \|/);
  assert.match(md, /\| Native C \| Community \| conditions \| — \| not run \| — \| not run: weights too large \|/); // nothing is claimed for a test that did not run
});

test("image-to-video bake-off: every model is a row per shot with its licence, time, cost, VRAM and the person's verdict; a run that did not finish says why", () => {
  const md = mdMeasuredRuns({
    ...fake,
    bakeOff: {
      note: "same still, same motion prompt, same seed",
      gpuUsdPerHour: 3.99,
      rows: [
        { model: "Model A", licence: "Apache-2.0", commercial: "yes", shot: "16:9 landscape", size: "1280×720 · 81 fr · 16 fps", seconds: 1200, vramGb: 62.1, verdict: "baseline" },
        { model: "Model B", licence: "Open Weights", commercial: "yes", shot: "9:16 people", size: "704×1216 · 121 fr · 24 fps", seconds: 14.5, vramGb: 38.8, verdict: "fast and clean" },
        { model: "Model C", licence: "Community", commercial: "no (EU)", shot: "16:9 landscape", size: "—", seconds: null, vramGb: null, verdict: "not finished: 75 min a clip" },
      ],
      winners: [{ use: "16:9 landscape", model: "Model B", why: "fast and clean" }],
    },
  });
  assert.match(md, /## Image-to-video bake-off/);
  assert.match(md, /same still, same motion prompt, same seed/);
  assert.match(md, /\| Model A \| Apache-2\.0 \| yes \| 16:9 landscape \| 1280×720 · 81 fr · 16 fps \| 1200 s \| \$1\.33 \| 62\.1 GB \| baseline \|/); // 1200 s of a $3.99 hour
  assert.match(md, /\| Model B \| Open Weights \| yes \| 9:16 people \| 704×1216 · 121 fr · 24 fps \| 14\.5 s \| \$0\.02 \| 38\.8 GB \| fast and clean \|/);
  assert.match(md, /\| Model C \| Community \| no \(EU\) \| 16:9 landscape \| — \| not finished \| — \| — \| not finished: 75 min a clip \|/);
  assert.match(md, /\*\*16:9 landscape\*\*: Model B — fast and clean/);
});
