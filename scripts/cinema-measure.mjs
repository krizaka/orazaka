#!/usr/bin/env node
/**
 * Writes docs/measurements/cinema.json — the cinematic shorts, measured (ADR-080) — from their production files.
 *
 *   node scripts/cinema-measure.mjs <batch.json> [<batch.json> …]   (one per production session: its GPU, its rate)
 *
 * batch.json: { "measuredOn", "gpu", "rate", "films": [{ "id", "dir", "film" (the delivered mp4), "command" }],
 * "sessions": [{ "label", "gpu", "hours", "rate" }] }. Each film is probed (ffprobe) — its frame and length are the
 * file's, never typed — and its production file gives every run. Then: node scripts/generate-docs.mjs.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cinemaDataset, filmRecord, stepMeasures } from "./lib/cinema-measure.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Several batches (one per production session, each with its GPU and rate): every film keeps its own.
const batchFiles = process.argv.slice(2).map((f) => resolve(f));
if (!batchFiles.length) throw new Error("usage: node scripts/cinema-measure.mjs <batch.json> [<batch.json> …]");
const probe = (file) => {
  const out = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", file], { encoding: "utf8" }));
  return { width: out.streams[0].width, height: out.streams[0].height, duration: Number(out.format.duration) };
};
const batches = batchFiles.map((file) => ({ base: dirname(file), ...JSON.parse(readFileSync(file, "utf8")) }));
const entries = batches.flatMap((b) => b.films.map((f) => ({ b, f, production: JSON.parse(readFileSync(resolve(b.base, f.dir, "production.json"), "utf8")) })));
// The Studio's estimate multiplies Studio runs: a batch made on a GPU host outside the Studios says `"estimate": false`.
const productions = entries.filter((e) => e.b.estimate !== false).map((e) => e.production);
const films = entries.map(({ b, f, production }) =>
  filmRecord({ id: f.id, production, probe: probe(resolve(b.base, f.film)), rate: b.rate, gpu: b.gpu, models: f.models, command: f.command }),
);
const batch = batches[batches.length - 1];
batch.sessions = batches.flatMap((b) => b.sessions);
batch.note = batches.map((b) => b.note).filter(Boolean).join(" ");
// The per-step medians are what the director's estimate multiplies (orazaka-cli src/services/cinema-estimate.json).
const data = { ...cinemaDataset({ films, sessions: batch.sessions, measuredOn: batch.measuredOn, gpu: batch.gpu, rate: batch.rate, note: batch.note }), steps: stepMeasures(productions, (batches.find((b) => b.estimate !== false) ?? batch).rate) };
writeFileSync(join(root, "docs/measurements/cinema.json"), `${JSON.stringify(data, null, 2)}\n`);
console.log(`${films.length} film(s), ${data.filmMinutes} min, $${data.usdPerFilmMinute} billed per minute of film`);
