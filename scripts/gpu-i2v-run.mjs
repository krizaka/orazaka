#!/usr/bin/env node
/**
 * Image → video through Orazaka's Studios (docs/DEPLOY_DEV.md § GPU): each clip of a plan is one run of the
 * `video-generation` Studio on dev.orazaka.com, routed to the GPU worker. It never talks to a model directly.
 *
 *   ORAZAKA_QA_EMAIL=… ORAZAKA_QA_PASSWORD=… node scripts/gpu-i2v-run.mjs --plan plan.json --out <dir> [--images <dir>] [--only id,id] [--rate 0.76]
 *
 * A plan is `{ "model": "wan2.2-ti2v-5b", "clips": [{ "id", "image": "<file>", "aspect": "16:9"|"9:16", "prompt", "seed", "seconds" }] }`
 * (image paths are relative to --images, default the plan's folder). Per clip: the photo is uploaded (`/api/v1/media/upload`), the Studio is run
 * with its asset id, the run is followed to the end, the clip is downloaded, and the FACTS the run itself reported
 * (model, size, frames, fps, seed, duration — from the job's metrics, never from this script's wish) are written
 * to `<out>/<id>.json` beside `<id>.mp4`. A clip is never marked good here: a person looks at it (warps are rejected).
 * Cost = wall seconds of the run × the GPU's hourly rate / 3600. Credentials are read from the environment, never printed.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const BASE = process.env.ORAZAKA_EDGE_URL ?? "https://dev.orazaka.com/edge";
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};

let token;
/** One call, retried on a network failure (the edge answers slowly now and then): a clip must not be lost to a socket. */
async function call(method, path, body, { form, raw } = {}) {
  let last;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const res = await fetch(BASE + path, {
        method,
        headers: {
          Accept: "application/json",
          ...(form || body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
      });
      if (!res.ok) {
        const refused = new Error(`${method} ${path} → ${res.status}`);
        refused.final = res.status < 500; // a 4xx is an answer; a 5xx or a dropped socket is retried
        throw refused;
      }
      return raw ? res : res.json();
    } catch (e) {
      last = e;
      if (e.final) break;
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
  throw last;
}

/** The facts a finished run's jobs reported (their own metrics), merged: what the clip is, as the platform measured it. */
export function factsOf(jobs) {
  const facts = {};
  for (const job of jobs) {
    const result = job?.result ?? {};
    const metrics = result.metrics ?? {};
    for (const k of ["model", "seed", "width", "height", "frames", "fps", "durationSeconds", "aspect", "steps", "generationMs", "gpu", "provider", "gpuSeconds", "inference_time_sec", "peak_memory_rss_mb", "gpu_allocated_mb"]) {
      const v = metrics[k] ?? result[k];
      if (v !== undefined && v !== null) facts[k] = v;
    }
  }
  return facts;
}

/** Seconds a run took by the platform's own clock (its start and finish), not by when this script noticed. */
export const runSeconds = (run) => (run?.startedAt && run?.finishedAt ? Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000) : undefined);

export const gpuCostUsd = (seconds, ratePerHour) => Math.round((seconds / 3600) * ratePerHour * 10000) / 10000;

async function runClip(plan, clip, imagesDir, out, rate) {
  const ticket = join(out, `${clip.id}.run`); // a run in flight survives this process: its id and start are kept here
  let started = Date.now();
  let runId;
  if (existsSync(ticket)) {
    ({ runId, started } = JSON.parse(readFileSync(ticket, "utf8")));
    console.log(`i2v: ${clip.id} resumes run ${runId}`);
  } else {
    const imagePath = resolve(imagesDir, clip.image);
    const bytes = readFileSync(imagePath);
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: "image/png" }), basename(imagePath));
    const uploaded = await call("POST", "/api/v1/media/upload", undefined, { form });
    const assetId = uploaded.assetId ?? uploaded.id;
    if (!assetId) throw new Error("the upload answered no asset id");
    const inputs = { prompt: clip.prompt, durationSeconds: clip.seconds ?? 5, aspect: clip.aspect, seed: String(clip.seed), image: assetId, model: plan.model };
    runId = (await call("POST", "/api/v1/studios/video-generation/runs", { inputs })).id;
    writeFileSync(ticket, JSON.stringify({ runId, started }));
  }
  const accepted = { id: runId };
  let run = { status: "RUNNING" };
  const limit = (Number(arg("timeout-min", "60")) || 60) * 60_000;
  while (["PENDING", "RUNNING", "QUEUED", "AWAITING_APPROVAL"].includes(run.status) && Date.now() - started < limit) {
    await new Promise((r) => setTimeout(r, 15_000));
    try {
      run = await call("GET", `/api/v1/studios/runs/${runId}`);
    } catch (e) {
      console.log(`i2v: ${clip.id} poll failed (${e.message}); still waiting`); // a flaky network is not a failed clip
    }
  }
  const seconds = Math.round((Date.now() - started) / 1000);
  const jobs = [];
  for (const step of run.steps ?? []) if (step.jobId) jobs.push(await call("GET", `/api/v1/jobs/${step.jobId}`).catch(() => null));
  const record = {
    id: clip.id,
    model: plan.model,
    sourceImage: clip.image,
    aspect: clip.aspect,
    prompt: clip.prompt,
    requestedSeed: String(clip.seed),
    requestedSeconds: clip.seconds ?? 5,
    runId: accepted.id,
    status: run.status,
    pollSeconds: seconds, // when this script saw it finish: includes any network gap, so it is not the run's time
    runSeconds: runSeconds(run) ?? seconds, // the platform's own clock: start to finish of the run
    gpuRateUsdPerHour: rate,
    gpuCostUsd: gpuCostUsd(runSeconds(run) ?? seconds, rate),
    reported: factsOf(jobs.filter(Boolean)),
    error: run.status === "SUCCEEDED" ? undefined : (run.errorMessage ?? `status ${run.status}`),
  };
  if (run.status === "SUCCEEDED") {
    const output = (run.outputs ?? []).find((o) => typeof (o.value ?? o.url) === "string");
    const url = output?.value ?? output?.url;
    if (!url) throw new Error("the run succeeded without an output url");
    const file = await call("GET", url.startsWith("/") ? url : `/${url}`, undefined, { raw: true });
    const data = Buffer.from(await file.arrayBuffer());
    if (data.length < 10_000) throw new Error(`the clip is ${data.length} bytes: not a video`);
    writeFileSync(join(out, `${clip.id}.mp4`), data);
    record.bytes = data.length;
  }
  writeFileSync(join(out, `${clip.id}.json`), JSON.stringify(record, null, 2) + "\n");
  rmSync(ticket, { force: true });
  return record;
}

async function main() {
  const planFile = resolve(arg("plan"));
  const out = resolve(arg("out"));
  const rate = Number(arg("rate", "0.76"));
  const only = arg("only")?.split(",");
  const plan = JSON.parse(readFileSync(planFile, "utf8"));
  const email = process.env.ORAZAKA_QA_EMAIL;
  const password = process.env.ORAZAKA_QA_PASSWORD;
  if (!email || !password) throw new Error("ORAZAKA_QA_EMAIL / ORAZAKA_QA_PASSWORD are not set (read them with secret.sh)");
  mkdirSync(out, { recursive: true });
  token = (await call("POST", "/api/v1/auth/login", { email, password })).token;
  let spent = 0;
  for (const clip of plan.clips.filter((c) => !only || only.includes(c.id))) {
    if (existsSync(join(out, `${clip.id}.json`)) && !process.argv.includes("--redo")) {
      console.log(`i2v: ${clip.id} already recorded (use --redo)`);
      continue;
    }
    try {
      const r = await runClip(plan, clip, resolve(arg("images", dirname(planFile))), out, rate);
      spent += r.gpuCostUsd;
      const got = r.reported;
      console.log(`i2v: ${clip.id.padEnd(22)} ${r.status.padEnd(9)} ${String(r.runSeconds).padStart(5)} s  ${got.width ?? "?"}x${got.height ?? "?"}  ${got.frames ?? "?"} fr  $${r.gpuCostUsd}  ${r.error ?? ""}`);
    } catch (e) {
      console.log(`i2v: ${clip.id.padEnd(22)} ERROR ${e.message}`);
    }
  }
  console.log(`i2v: batch GPU cost ≈ $${spent.toFixed(2)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => {
  console.error(`i2v: ${e.message}`);
  process.exit(1);
});
