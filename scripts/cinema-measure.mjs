#!/usr/bin/env node
/**
 * Writes docs/measurements/cinema.json — the cinematic shorts, measured (ADR-080) — from their production files.
 *
 *   node scripts/cinema-measure.mjs <batch.json>
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
const batchFile = resolve(process.argv[2] ?? "");
const batch = JSON.parse(readFileSync(batchFile, "utf8"));
const base = dirname(batchFile);
const probe = (file) => {
  const out = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", file], { encoding: "utf8" }));
  return { width: out.streams[0].width, height: out.streams[0].height, duration: Number(out.format.duration) };
};
const productions = batch.films.map((f) => JSON.parse(readFileSync(resolve(base, f.dir, "production.json"), "utf8")));
const films = batch.films.map((f, i) =>
  filmRecord({
    id: f.id,
    production: productions[i],
    probe: probe(resolve(base, f.film)),
    rate: batch.rate,
    command: f.command,
  }),
);
// The per-step medians are what the director's estimate multiplies (orazaka-cli src/services/cinema-estimate.json).
const data = { ...cinemaDataset({ films, sessions: batch.sessions, measuredOn: batch.measuredOn, gpu: batch.gpu, rate: batch.rate }), steps: stepMeasures(productions, batch.rate) };
writeFileSync(join(root, "docs/measurements/cinema.json"), `${JSON.stringify(data, null, 2)}\n`);
console.log(`${films.length} film(s), ${data.filmMinutes} min, $${data.usdPerFilmMinute} billed per minute of film`);
