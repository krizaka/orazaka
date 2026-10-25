import assert from "node:assert/strict";
import test from "node:test";
import { PERSONA_RUNS, secretKeys } from "../dev-persona-runs.mjs";

test("the persona's credentials come from their own @dev keys, never the QA account's", () => {
  assert.deepEqual(secretKeys("mira"), ["APP_QA_ORAZAKA_MIRA_EMAIL", "APP_QA_ORAZAKA_MIRA_PASSWORD"]);
  assert.deepEqual(secretKeys("eric"), ["APP_QA_ORAZAKA_PERSONA_EMAIL", "APP_QA_ORAZAKA_PERSONA_PASSWORD"]);
  assert.throws(() => secretKeys("qa"), /unknown persona/);
});

test("the persona's runs are fictional and name a Studio and an input each", () => {
  assert.ok(PERSONA_RUNS.length >= 3);
  for (const r of PERSONA_RUNS) assert.ok(r.studioKey && Object.keys(r.inputs).length);
  assert.doesNotMatch(JSON.stringify(PERSONA_RUNS), /qa\+|@orazaka\.com/i);
});
