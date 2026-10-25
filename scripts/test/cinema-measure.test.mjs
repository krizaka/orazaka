// Cinematic shorts, measured (ADR-080): the record of a film comes from its production file and its probe, never typed.
import test from "node:test";
import assert from "node:assert/strict";
import { cinemaDataset, filmRecord, mdCinema, stepMeasures, stepOf } from "../lib/cinema-measure.mjs";

const run = (studioKey, runId, seconds, start, status = "SUCCEEDED") => ({
  studioKey, runId, seconds, status,
  startedAt: new Date(Date.parse("2026-10-17T10:00:00Z") + start * 1000).toISOString(),
  finishedAt: new Date(Date.parse("2026-10-17T10:00:00Z") + (start + seconds) * 1000).toISOString(),
});
const production = {
  brief: { aspect: "9:16", scriptModel: "gemma-4-31B-it" },
  script: { runId: "s1", parsed: { title: "Nightfall", voiceover: "", shots: [{}, {}] } },
  characters: { nova: { runId: "c1" } },
  cut: { runId: "cut1" },
  sound: { runId: "snd1" },
  history: [
    run("cinematic-script", "s1", 40, 0),
    run("image-generation", "c1", 10, 40),
    run("image-generation", "k1", 12, 50),
    run("image-generation", "k2", 14, 62),
    run("video-generation", "v1", 100, 76),
    run("video-generation", "v2", 30, 176, "FAILED"),
    run("video-generation", "v2b", 110, 206),
    run("video-generation", "v1b", 104, 316),
    run("cinematic-cut", "cut1", 300, 420),
    run("video-sound", "snd1", 60, 720),
  ],
};

test("a step is read from the Studio and the production (a character still is not a keyframe)", () => {
  assert.equal(stepOf(production.history[1], production), "character");
  assert.equal(stepOf(production.history[2], production), "keyframe");
  assert.equal(stepOf(production.history[8], production), "cut");
});

test("a film's record: GPU time of its successful GPU runs, reshoots, failures, wall time, the film's own probe", () => {
  const f = filmRecord({ id: "nightfall", production, probe: { width: 1080, height: 1920, duration: 45.33 }, rate: 3.6, command: "orazaka cinema new …" });
  assert.equal(f.gpuSeconds, 10 + 12 + 14 + 100 + 110 + 104 + 300 + 60);
  assert.equal(f.gpuUsd, Math.round((710 / 3600) * 3.6 * 100) / 100);
  assert.equal(f.reshoots, 1); // three shot videos succeeded for two shots
  assert.equal(f.failedRuns, 1);
  assert.equal(f.productionSeconds, 780);
  assert.deepEqual([f.width, f.height, f.duration, f.media], [1080, 1920, 45.33, "products/orazaka/cinema/nightfall"]);
  assert.equal(f.models.voice, undefined); // no voice-over, no voice claimed
});

test("per-step medians feed the estimate; a CPU step costs no GPU", () => {
  const m = stepMeasures([production], 3.6);
  assert.equal(m.video.seconds, 104);
  assert.equal(m.video.n, 3);
  assert.equal(m.script.gpuUsd, 0);
  assert.equal(m.keyframe.seconds, 13);
});

test("the batch is billed by its pod sessions, divided by the minutes of finished film", () => {
  const film = filmRecord({ id: "a", production, probe: { width: 1080, height: 1920, duration: 60 }, rate: 3.6, command: "x" });
  const data = cinemaDataset({ films: [film], sessions: [{ label: "pod 1", gpu: "H100", hours: 1.5, rate: 4 }], measuredOn: "2026-10-17", gpu: "H100", rate: 4 });
  assert.equal(data.billedUsd, 6);
  assert.equal(data.usdPerFilmMinute, 6);
  const md = mdCinema(data).join("\n");
  assert.match(md, /## Cinematic shorts/);
  assert.match(md, /\*\*\$6\.00\*\*/);
  assert.deepEqual(mdCinema({ films: [] }), []);
  const noted = cinemaDataset({ films: [film], sessions: [], measuredOn: "x", gpu: "H100", rate: 4, note: "shared pod" });
  assert.match(mdCinema(noted).join("\n"), /> shared pod/);
});

test("a film's video models are its shots' own, and a batch can name what ran outside the Studios (orazaka#259)", () => {
  const planned = {
    ...production,
    script: { ...production.script, parsed: { ...production.script.parsed, shots: [{ model: "wan2.2-i2v-a14b-hq" }, { model: "ltx-video-0.9.8-13b-distilled" }, { model: "wan2.2-i2v-a14b-hq" }] } },
  };
  const f = filmRecord({ id: "dawn", production: planned, probe: { width: 3840, height: 2160, duration: 62 }, rate: 5.29, gpu: "RunPod H200 141 GB", command: "orazaka cinema plan …", models: { image: "FLUX.2 [klein] 4B on the Mac" } });
  assert.equal(f.models.video, "Wan 2.2 I2V A14B (40 steps), LTX-Video 0.9.8 13B distilled");
  assert.equal(f.models.image, "FLUX.2 [klein] 4B on the Mac");
  assert.deepEqual([f.gpu, f.rate], ["RunPod H200 141 GB", 5.29]);
  // A production without per-shot models keeps the default it always had.
  assert.equal(filmRecord({ id: "a", production, probe: { width: 1, height: 1, duration: 1 }, rate: 1, command: "x" }).models.video, "Wan 2.2 I2V A14B (4-step distill)");
});

test("the page names each film's own video model and GPU", () => {
  const planned = { ...production, script: { ...production.script, parsed: { ...production.script.parsed, shots: [{ model: "wan2.2-i2v-a14b-hq" }] } } };
  const a = filmRecord({ id: "a", production, probe: { width: 1080, height: 1920, duration: 40 }, rate: 3.99, gpu: "RunPod H100 80 GB", command: "x" });
  const b = filmRecord({ id: "b", production: planned, probe: { width: 3840, height: 2160, duration: 62 }, rate: 5.29, gpu: "RunPod H200 141 GB", command: "y" });
  const md = mdCinema(cinemaDataset({ films: [a, b], sessions: [], measuredOn: "2026-10-20", gpu: "RunPod", rate: 5.29 })).join("\n");
  assert.match(md, /Wan 2\.2 I2V A14B \(4-step distill\) on RunPod H100 80 GB/);
  assert.match(md, /Wan 2\.2 I2V A14B \(40 steps\) on RunPod H200 141 GB/);
  assert.match(md, /3840×2160/);
});
