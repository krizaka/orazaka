// node --test scripts/test — the sovereign smoke: what it asserts, what it refuses to pass, and that it always ends the GPU.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CHECKS, credentials, jobFacts, judge } from "../gpu-smoke.mjs";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("a run passes only when it SUCCEEDED with a non-empty output, and names the model our side reported", () => {
  const check = CHECKS.find((c) => c.name === "chat");
  const ok = judge(check, { id: "r", status: "SUCCEEDED", outputs: [{ key: "briefs", value: "content: x, metadata: provider: ollama, model: qwen2.5:7b" }] }, 1200);
  assert.equal(ok.status, "PASSED");
  assert.ok(ok.models.includes("qwen2.5:7b") && ok.models.includes("provider:ollama"));
  assert.equal(judge(check, { status: "SUCCEEDED", outputs: [{ value: "  " }] }, 1).status, "FAILED");
  assert.equal(judge(check, { status: "FAILED", errorMessage: "boom", outputs: [] }, 1).detail, "boom");
  // A chat a cloud API answered is not a pass of OUR runtime.
  const cloud = judge(check, { status: "SUCCEEDED", outputs: [{ value: "content: x, metadata: provider: do-inference" }] }, 1);
  assert.equal(cloud.status, "FAILED");
  assert.match(cloud.detail, /answered by do-inference, not ollama/);
});

test("what dev cannot route is SKIPPED with its reason — never passed", () => {
  const skipped = CHECKS.filter((c) => c.skip);
  assert.deepEqual(skipped.map((c) => c.name).sort(), ["rag", "transcription", "tts"]);
  for (const c of skipped) assert.ok(c.skip.length > 20);
  for (const c of CHECKS.filter((x) => !x.skip)) assert.ok(c.studio && c.inputs && c.timeoutS, c.name);
  assert.equal(CHECKS.find((c) => c.name === "video").inputs.aspect, "9:16");
});

test("credentials: the environment first, else the QA sheet; never invented", () => {
  assert.deepEqual(credentials({ ORAZAKA_QA_EMAIL: "a@b", ORAZAKA_QA_PASSWORD: "p" }, ""), { email: "a@b", password: "p" });
  const qa = "### Orazaka (ORA-DEPLOY, x)\n**Orazaka web — utilisateur**\n- E-mail : `u@x`\n- Mot de passe : `pw`\n";
  assert.deepEqual(credentials({}, qa), { email: "u@x", password: "pw" });
  assert.throws(() => credentials({}, "nothing"), /no QA credentials/);
});

test("gpu-dev.sh smoke destroys the droplet whatever happens", () => {
  const script = read("scripts/gpu-dev.sh");
  const body = script.slice(script.indexOf("smoke() {"), script.indexOf("\n}\n", script.indexOf("smoke() {")));
  assert.ok(body.indexOf("trap destroy_all EXIT INT TERM") < body.indexOf('start "$host"'), "the trap is set before the droplet exists");
  assert.match(body, /destroy_all\n\s+trap - EXIT INT TERM/);
  assert.match(script, /destroy_all\(\) \{[\s\S]*doctl compute droplet delete \$ids --force/);
});

test("the weekly workflow runs the smoke and keeps its report, and never without its secrets", () => {
  const wf = read(".github/workflows/gpu-smoke.yml");
  assert.match(wf, /schedule:/);
  assert.match(wf, /workflow_dispatch:/);
  assert.match(wf, /scripts\/gpu-dev\.sh smoke small/);
  assert.match(wf, /upload-artifact/);
  assert.match(wf, /if: always\(\)[\s\S]*destroy/);
});

test("the model and the facts come from our jobs' own results", () => {
  const reported = jobFacts([
    { id: "j1", result: { url: "/api/v1/assets/j1/video.mp4", metrics: { model: "wan2.1-t2v-1.3b", seed: "7", width: 480, height: 832, durationSeconds: 1.56, gpu: "Apple Silicon (Metal)" } } },
    { id: "j2", result: { content: "x", metadata: { provider: "ollama", durationMs: 9 } } },
  ]);
  assert.deepEqual(reported.models.sort(), ["provider:ollama", "wan2.1-t2v-1.3b"]);
  assert.deepEqual(reported.facts[0], { jobId: "j1", seed: "7", width: 480, height: 832, durationSeconds: 1.56, gpu: "Apple Silicon (Metal)" });
  const video = CHECKS.find((c) => c.name === "video");
  const verdict = judge(video, { id: "r", status: "SUCCEEDED", outputs: [{ value: "/api/v1/assets/j1/video.mp4" }] }, 5, reported);
  assert.equal(verdict.status, "PASSED");
  assert.ok(verdict.models.includes("wan2.1-t2v-1.3b"));
});
