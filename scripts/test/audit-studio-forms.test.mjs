// node --test scripts/test — the Studio forms audit: a select with nothing to select is a finding.
import assert from "node:assert/strict";
import { test } from "node:test";
import { auditForms } from "../audit-studio-forms.mjs";

const words = (extra = {}) => ({
  en: { title: "Model", description: "Auto picks one.", ...extra },
  fr: { title: "Modèle", description: "Auto en choisit un.", ...extra },
});
const bp = (properties) => [{ studioKey: "s", version: "1.0.0", inputSchema: { properties } }];
const models = [
  { model_name: "wan", category: "video", status: "available" },
  { model_name: "old", category: "chat", status: "internal" },
];

test("a sound catalogue select and a sound enum are clean", () => {
  const found = auditForms(
    bp({
      model: { "x-options": { source: "models", category: "video" }, "x-i18n": words() },
      aspect: { enum: ["9:16"], "x-i18n": words({ options: { "9:16": "Vertical" } }) },
    }),
    models,
  );
  assert.deepEqual(found, []);
});

test("a category in capitals with no available model is the empty select seen on dev", () => {
  const found = auditForms(bp({ model: { "x-options": { source: "models", category: "CHAT" }, "x-i18n": words() } }), models);
  assert.ok(found.some((f) => /not lowercase/.test(f)), found.join("\n"));
  assert.ok(found.some((f) => /no available model/.test(f)), found.join("\n"));
});

test("an empty enum, a missing language, a long helper and an unlabelled value are findings", () => {
  const found = auditForms(
    bp({
      empty: { enum: [] },
      mute: { enum: ["a"], "x-i18n": { en: { title: "T", description: "d", options: { a: "A" } } } },
      long: {
        enum: ["a", "b"],
        "x-i18n": {
          en: { title: "T", description: "y".repeat(141), options: { a: "A" } },
          fr: { title: "T", description: "d", options: { a: "A", b: "B" } },
        },
      },
    }),
    models,
  );
  assert.ok(found.some((f) => /empty enum/.test(f)));
  assert.ok(found.some((f) => /no fr title and helper/.test(f)));
  assert.ok(found.some((f) => /en helper is 141 characters/.test(f)));
  assert.ok(found.some((f) => /no en label for « b »/.test(f)));
});

test("a field that is not a list is not audited", () => {
  assert.deepEqual(auditForms(bp({ prompt: { type: "string" } }), models), []);
});

test("dev data makes the default video model the hosted one, which answers without a GPU droplet", async () => {
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync(new URL("../../infra/deploy/dev-data.sql", import.meta.url), "utf8");
  assert.match(sql, /UPDATE orazaka_models SET is_default = \(model_name = 'wan2-2-t2v-a14b'\) WHERE category = 'video'/);
});
