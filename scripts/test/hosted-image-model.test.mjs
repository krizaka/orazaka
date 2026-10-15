// node --test scripts/test — a hosted image model is routed by data: provider, no declared steps, honest registry facts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const MODEL = "stable-diffusion-3.5-large";

test("the migration and the dev data give the hosted model the same provider, a null step count and provider facts", () => {
  for (const file of ["infra/migrations/2026-10-15-do-sd35.sql", "infra/deploy/dev-data.sql"]) {
    const sql = read(file);
    assert.match(sql, new RegExp(`'${MODEL}', 'Stable Diffusion 3\\.5 Large \\(DigitalOcean\\)', 'image', NULL, 'do-inference-images', FALSE, NULL, NULL, NULL`), file);
    assert.match(sql, /'do-inference-images', 'https:\/\/inference\.do-ai\.run\/v1'/, file); // Spring AI's image client appends /images/generations
    assert.match(sql, /runs_on = 'provider'/, file);
    assert.match(sql, /licence = 'Stability AI Community Licence'/, file);
    assert.match(sql, /commercial_use = 'conditions'/, file);
  }
});

test("the dev data job writes the all-models key to the provider when the secrets file has one", () => {
  const mjs = read("scripts/dev-deploy.mjs");
  assert.match(mjs, /env\.AI_INFERENCE_KEY_ALL \|\| env\.AI_INFERENCE_KEY/);
  assert.doesNotMatch(mjs, /console\.log\([^)]*inferenceKey/);
});
