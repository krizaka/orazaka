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

test("a field that is not a list is audited too: no words in English and French is a finding (« Vos données » on the English page)", () => {
  const found = auditForms(
    bp({
      data: { type: "string", title: "Vos données", description: "Un CSV." },
      question: { type: "string", format: "prose", "x-i18n": { en: { title: "Your question", description: "What you want to see." } } },
      count: { type: "integer", "x-i18n": { en: { title: "Count", description: "How many." }, fr: { title: "Nombre", description: "Combien." } } },
    }),
    models,
  );
  assert.ok(found.some((f) => /#data: no en title and helper/.test(f)), found.join("\n"));
  assert.ok(found.some((f) => /#data: no fr title and helper/.test(f)), found.join("\n"));
  assert.ok(found.some((f) => /#question: no fr title and helper/.test(f)), found.join("\n"));
  assert.ok(!found.some((f) => /#count/.test(f)), "a number has words and needs no placeholder");
});

test("a free-text field also needs its placeholder in both languages; a number, a seed, a file and a list do not", () => {
  const text = (extra = {}) => ({
    type: "string",
    "x-i18n": { en: { title: "T", description: "d", ...extra.en }, fr: { title: "T", description: "d", ...extra.fr } },
  });
  const found = auditForms(
    bp({
      noPh: text(),
      oneLang: text({ en: { placeholder: "x" } }),
      ok: text({ en: { placeholder: "x" }, fr: { placeholder: "y" } }),
      seed: { ...text(), "x-control": "seed" },
      file: { ...text(), format: "asset:image" },
      files: { ...text(), type: "array", items: { type: "string", format: "asset-id" } },
      ids: { ...text(), type: "array", items: { type: "string" } },
    }),
    models,
  );
  assert.ok(found.some((f) => /#noPh: no en placeholder/.test(f)), found.join("\n"));
  assert.ok(found.some((f) => /#noPh: no fr placeholder/.test(f)), found.join("\n"));
  assert.ok(found.some((f) => /#oneLang: no fr placeholder/.test(f)) && !found.some((f) => /#oneLang: no en placeholder/.test(f)));
  assert.ok(found.some((f) => /#ids: no en placeholder/.test(f)));
  for (const quiet of ["ok", "seed", "file", "files"]) assert.ok(!found.some((f) => f.includes(`#${quiet}:`)), `${quiet}: ${found.join("\n")}`);
});

test("a helper over 140 characters is a finding on any field, not only on a list", () => {
  const found = auditForms(
    bp({ long: { type: "integer", "x-i18n": { en: { title: "T", description: "y".repeat(141) }, fr: { title: "T", description: "d" } } } }),
    models,
  );
  assert.ok(found.some((f) => /#long: en helper is 141 characters/.test(f)), found.join("\n"));
});

test("dev data makes the default video model the hosted one, which answers without a GPU droplet", async () => {
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync(new URL("../../infra/deploy/dev-data.sql", import.meta.url), "utf8");
  assert.match(sql, /UPDATE orazaka_models SET is_default = \(model_name = 'wan2-2-t2v-a14b'\) WHERE category = 'video'/);
});

test("dev data says which categories an external worker runs: a model of those is runnable only while a worker drains their queue", async () => {
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync(new URL("../../infra/deploy/dev-data.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS model_category_queue/);
  assert.match(sql, /\('video', FALSE, 'job\.video\.generate'\)/);
  assert.match(sql, /ON CONFLICT \(category, hosted\) DO NOTHING/);
});

test("every output needs its label in English and French too (« Votre image », « Graine… » on the English page)", () => {
  const withOutputs = (outputs) => [{ studioKey: "s", version: "1.0.0", inputSchema: { properties: {} }, outputs }];
  const found = auditForms(
    withOutputs([
      { key: "image", label: "Votre image" },
      { key: "seed", label: "Graine", "x-i18n": { fr: { label: "Graine" } } },
      { key: "ok", label: "Ok", "x-i18n": { en: { label: "Ok" }, fr: { label: "Ok" } } },
    ]),
    models,
  );
  assert.ok(found.some((f) => /s@1\.0\.0#output:image: no en label \(x-i18n\.en\.label\)/.test(f)), found.join("\n"));
  assert.ok(found.some((f) => /#output:image: no fr label/.test(f)));
  assert.ok(found.some((f) => /#output:seed: no en label/.test(f)));
  assert.ok(!found.some((f) => /#output:seed: no fr label/.test(f)) && !found.some((f) => /#output:ok/.test(f)));
});

test("a model's declared aspects must lie within its aspect field's enum, and every model of the field must be declared", () => {
  const bp = (aspects, extra = {}) => [
    {
      studioKey: "v",
      version: "1.0.0",
      inputSchema: {
        properties: {
          aspect: { enum: ["9:16", "16:9"], "x-i18n": { en: { title: "T", description: "d", options: { "9:16": "a", "16:9": "b" } }, fr: { title: "T", description: "d", options: { "9:16": "a", "16:9": "b" } } } },
          model: { "x-options": { source: "models", category: "video", aspectField: "aspect", aspects, ...extra }, "x-i18n": { en: { title: "M", description: "d" }, fr: { title: "M", description: "d" } } },
        },
      },
    },
  ];
  const videoModels = [{ model_name: "wan-hosted", category: "video", status: "available" }];
  assert.deepEqual(auditForms(bp({ "wan-hosted": ["16:9"] }), videoModels), []);
  assert.ok(auditForms(bp({ "wan-hosted": ["4:3"] }), videoModels).some((f) => /aspect « 4:3 » is not in the enum/.test(f)));
  assert.ok(auditForms(bp({}), videoModels).some((f) => /model « wan-hosted » declares no aspects/.test(f)));
});
