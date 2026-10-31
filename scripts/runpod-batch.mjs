#!/usr/bin/env node
/**
 * The unattended render batch (orazaka#508), driven by `scripts/gpu-dev.sh runpod batch`: N prompts → one image each, through the
 * `image-generation` Studio of dev.orazaka.com (scripts/showcase-image-run.mjs, never a model called directly) on the pod the shell
 * started → the results to Bunny under `site/renders/<batch>/`. The dollar cap is enforced HERE between every prompt and by the
 * shell around it (the pod is terminated in a trap whatever happens: this script never touches the pod).
 *
 *   node scripts/runpod-batch.mjs --prompts prompts.txt --out <dir> --rate <usd/h> --started <epoch s> --cap <usd> [--refs refs.json] [--model m] [--size WxH] [--batch name] [--no-upload]
 *
 * prompts.txt: one prompt per line (blank lines and `#` comments ignored). The Studio login and the Bunny keys are read from the
 * process settings by name (ORAZAKA_QA_*, MEDIA_STORAGE_*, MEDIA_CDN_HOSTNAME as scripts/pr-assets.mjs), never printed.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * One clip per prompt, ids `r01`, `r02`… (the plan format of gpu-i2v-run.mjs, only `scene` and `references` are read by the image step).
 * A line may start with `[owl, cahier]`: the names of reference pictures, resolved by `refs` (name → asset id of an earlier run's output)
 * so the same character comes back from shot to shot (krizaka-internal#158). An unknown name stops the batch before any pod time is spent.
 */
export function planFromPrompts(text, refs = {}) {
  const prompts = text.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  const width = Math.max(2, String(prompts.length).length);
  return {
    clips: prompts.map((line, i) => {
      const id = `r${String(i + 1).padStart(width, "0")}`;
      const m = /^\[([^\]]*)\]\s*(.+)$/.exec(line);
      if (!m) return { id, scene: line };
      const references = m[1].split(",").map((n) => n.trim()).filter(Boolean).map((name) => {
        if (!refs[name]) throw new Error(`${id}: the reference "${name}" is not in --refs`);
        return refs[name];
      });
      return { id, scene: m[2], ...(references.length ? { references } : {}) };
    }),
  };
}

/** What the pod has cost by `nowMs` (dollars): hours × rate, from the epoch-seconds `startedS`. */
export const spentUsd = (rate, startedS, nowMs) => Math.round(((nowMs / 1000 - startedS) / 3600) * rate * 10000) / 10000;

/** True when one more prompt must NOT start: the cap is reached, or the next prompt (at `perPromptUsd`) would cross it. */
export const capReached = (spent, cap, perPromptUsd = 0) => spent + perPromptUsd >= cap;

/** The Bunny storage URL and the CDN URL of one result (a batch name is a slug, never a path). */
export function bunnyTarget(batch, id, settings) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(batch)) throw new Error(`batch name "${batch}" must be a lowercase slug`);
  const path = `site/renders/${batch}/${id}.png`;
  return { path, put: `https://${settings.MEDIA_STORAGE_ENDPOINT ?? "storage.bunnycdn.com"}/${settings.MEDIA_STORAGE_ZONE}/${path}`, cdn: `https://${settings.MEDIA_CDN_HOSTNAME}/${path}` };
}

async function upload(file, target, settings) {
  const res = await fetch(target.put, { method: "PUT", headers: { AccessKey: settings.MEDIA_STORAGE_API_KEY, "Content-Type": "image/png" }, body: readFileSync(file) });
  if (!res.ok) throw new Error(`Bunny answered ${res.status} for ${target.path}`);
}

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};

async function main() {
  const refs = arg("refs") ? JSON.parse(readFileSync(resolve(arg("refs")), "utf8")) : {};
  const plan = planFromPrompts(readFileSync(resolve(arg("prompts")), "utf8"), refs);
  if (process.argv.includes("--validate-only")) { console.log(`batch: ${plan.clips.length} prompts, ${plan.clips.filter((c) => c.references).length} with references — valid`); return; }
  const out = resolve(arg("out"));
  const rate = Number(arg("rate")), started = Number(arg("started")), cap = Number(arg("cap"));
  if (![rate, started, cap].every(Number.isFinite) || cap <= 0) throw new Error("--rate, --started and --cap are required numbers");
  const batch = arg("batch", new Date().toISOString().slice(0, 10) + "-batch");
  const bootMinutes = Number(process.env.GPU_BATCH_BOOT_MINUTES ?? 20);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "plan.json"), JSON.stringify(plan));
  let perPrompt = 0;
  const results = [];

  async function finish() {
    const lines = [];
    for (const r of results) {
      if (process.argv.includes("--no-upload")) { lines.push(`${r.id}\t${r.file}`); continue; }
      const target = bunnyTarget(batch, r.id, process.env);
      await upload(r.file, target, process.env);
      lines.push(`${r.id}\t${target.cdn}`);
    }
    writeFileSync(join(out, "results.tsv"), lines.join("\n") + "\n");
    console.log(lines.join("\n"));
    console.log(`batch: ${results.length}/${plan.clips.length} rendered, spent ≈ $${spentUsd(rate, started, Date.now()).toFixed(2)} of the $${cap} cap`);
  }

  for (const clip of plan.clips) {
    const png = join(out, `${clip.id}.image.png`);
    // The pod boots for minutes before its worker answers: a prompt is retried until it succeeds; the cap or the boot window stops it.
    while (!existsSync(png)) {
      const spent = spentUsd(rate, started, Date.now());
      if (capReached(spent, cap, perPrompt)) {
        console.log(`batch: cap $${cap} reached at $${spent.toFixed(2)} — stopping before ${clip.id}`);
        return finish();
      }
      if (results.length === 0 && Date.now() / 1000 - started > bootMinutes * 60) throw new Error(`no render after ${bootMinutes} min of boot — giving up`);
      const t0 = Date.now();
      const args = [join(here, "showcase-image-run.mjs"), "--plan", join(out, "plan.json"), "--out", out, "--only", clip.id, "--redo", ...(arg("model") ? ["--model", arg("model")] : []), ...(arg("size") ? ["--size", arg("size")] : [])];
      spawnSync("node", args, { env: process.env, stdio: ["ignore", "inherit", "inherit"] });
      if (existsSync(png)) perPrompt = Math.max(perPrompt, spentUsd(rate, 0, Date.now()) - spentUsd(rate, 0, t0));
      else await new Promise((res) => setTimeout(res, 30_000));
    }
    results.push({ id: clip.id, file: png });
  }
  return finish();
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(`batch: ${e.message}`); process.exit(1); });
