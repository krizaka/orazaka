import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { verdict } from "../dev-persona-smoke.mjs";

test("the smoke fails on the 500 of the duplicated persona and on a tokenless 200", () => {
  assert.equal(verdict(500, false).ok, false);
  assert.match(verdict(500, false).message, /HTTP 500/);
  assert.equal(verdict(200, false).ok, false);
  assert.equal(verdict(200, true).ok, true);
});

test("the workflow runs the smoke after the redeploy and on a schedule, with the persona secrets by name", () => {
  const wf = readFileSync(new URL("../../.github/workflows/dev-persona-smoke.yml", import.meta.url), "utf8");
  assert.match(wf, /workflow_run:[\s\S]*Dev redeploy/);
  assert.match(wf, /schedule:/);
  assert.match(wf, /APP_QA_ORAZAKA_PERSONA_EMAIL: \$\{\{ secrets\.APP_QA_ORAZAKA_PERSONA_EMAIL \}\}/);
  assert.match(wf, /node scripts\/dev-persona-smoke\.mjs eric/);
});
