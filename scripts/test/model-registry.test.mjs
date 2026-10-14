// node --test scripts/test — the model registry the site and the docs publish: read from the SQL the routing reads, and refused when incomplete.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildModels, catalogue, statements, stripComments, verifiedBySmoke, CAPABILITIES } from "../lib/model-registry.mjs";

const meta = (name, extra = {}) => {
  const set = {
    vendor: "Alibaba Cloud", family: "Qwen 2.5", capabilities: "chat", runs_on: "local", runtime: "Ollama", open_weights: true,
    licence: "Apache-2.0", licence_url: "https://example.org/licence", context_window: 32768, status: "available", ...extra,
  };
  const sql = (v) => (v === null ? "NULL" : typeof v === "boolean" ? String(v).toUpperCase() : typeof v === "number" ? String(v) : `'${v}'`);
  return `UPDATE orazaka_models SET ${Object.entries(set).filter(([, v]) => v !== undefined).map(([k, v]) => `${k} = ${sql(v)}`).join(", ")} WHERE model_name = '${name}';`;
};
const seed = `
INSERT INTO orazaka_models (model_name, model_label, category, options, provider_name, is_default) VALUES
('qwen2.5:7b', 'Qwen 2.5 7B Instruct', 'chat', 'q4_K_M', 'ollama', TRUE), -- a comment with an apostrophe, a vendor's; and a semicolon
('rose', 'Rose Accent', 'theme', NULL, 'ollama', FALSE)
ON CONFLICT (model_name) DO NOTHING;
`;

test("a complete model is published with its registry facts, the default flagged", () => {
  const [m, ...rest] = buildModels(seed + meta("qwen2.5:7b"));
  assert.equal(rest.length, 0, "a UI theme is not a model");
  assert.deepEqual(
    { id: m.id, vendor: m.vendor, capabilities: m.capabilities, runsOn: m.runsOn, licence: m.licence.name, contextWindow: m.contextWindow, status: m.status, openWeights: m.openWeights },
    { id: "qwen2.5:7b", vendor: "Alibaba Cloud", capabilities: ["chat"], runsOn: "local", licence: "Apache-2.0", contextWindow: 32768, status: "default", openWeights: true },
  );
  assert.equal(m.lastVerified, null, "no smoke report, no date");
});

test("the generator fails on a model missing required fields — and names the model and the fields", () => {
  assert.throws(() => buildModels(seed + meta("qwen2.5:7b", { licence: undefined, vendor: undefined })), (e) => /qwen2\.5:7b: licence is missing; vendor is missing|qwen2\.5:7b: vendor is missing; licence is missing/.test(e.message));
  // A model nobody described is refused too — it does not silently disappear from the site.
  assert.throws(() => buildModels(seed), /qwen2\.5:7b: status must be one of/);
  assert.throws(() => buildModels(seed + meta("qwen2.5:7b", { open_weights: undefined })), /open_weights is missing/);
  assert.throws(() => buildModels(seed + meta("qwen2.5:7b", { runs_on: "cloud" })), /runs_on must be one of/);
});

test("a capability outside the vocabulary, a bad context window or a non-https licence link is refused", () => {
  assert.throws(() => buildModels(seed + meta("qwen2.5:7b", { capabilities: "chat,telepathy" })), /capability "telepathy"/);
  assert.throws(() => buildModels(seed + meta("qwen2.5:7b", { context_window: 0 })), /context_window must be a positive integer/);
  assert.throws(() => buildModels(seed + meta("qwen2.5:7b", { licence_url: "http://insecure.example" })), /licence_url must be an https URL/);
  for (const c of ["chat", "reasoning", "vision", "embeddings", "image", "video", "speech-to-text", "text-to-speech"]) assert.ok(CAPABILITIES.includes(c), c);
});

test("metadata for a model no INSERT created is an error, not a silent no-op", () => {
  assert.throws(() => buildModels(seed + meta("qwen2.5:7b") + meta("ghost-model")), /UPDATE of ghost-model, which no INSERT created/);
});

test("an internal row stays in the catalogue and is never published; its other fields may be empty", () => {
  const sql = seed + "UPDATE orazaka_models SET status = 'internal' WHERE model_name = 'qwen2.5:7b';";
  assert.deepEqual(buildModels(sql), []);
  assert.equal(catalogue(sql).find((r) => r.model_name === "qwen2.5:7b").status, "internal");
});

test("rows are read whatever the column order, with concatenated descriptions and the first INSERT of a name winning", () => {
  const sql = `
INSERT INTO orazaka_models (model_name, model_label, category, options, provider_name, is_default, description)
VALUES ('mistral-3-14B', 'Mistral 3 14B', 'chat', NULL, 'do-inference', FALSE, 'Mistral 3 (Apache-2.0) '
        || 'on a provider — it''s billed per token.')
ON CONFLICT (model_name) DO NOTHING;
INSERT INTO orazaka_models (model_name, model_label, category) VALUES ('mistral-3-14B', 'Another label', 'image') ON CONFLICT (model_name) DO NOTHING;
${meta("mistral-3-14B", { runs_on: "provider", runtime: "DigitalOcean serverless inference", status: "planned" })}`;
  const [row] = catalogue(sql);
  assert.equal(row.description, "Mistral 3 (Apache-2.0) on a provider — it's billed per token.");
  assert.equal(row.model_label, "Mistral 3 14B");
  const [m] = buildModels(sql);
  assert.deepEqual([m.runsOn, m.provider, m.status], ["provider", "do-inference", "planned"]);
});

test("local models come first, then by status; the order is stable", () => {
  const rows = [["a", "provider", "available"], ["b", "local", "available"], ["c", "local", "planned"]]
    .map(([n]) => `INSERT INTO orazaka_models (model_name, model_label, category, provider_name, is_default) VALUES ('${n}', '${n}', 'chat', 'ollama', FALSE);`).join("\n");
  const sql = rows + [["a", "provider", "available"], ["b", "local", "available"], ["c", "local", "planned"]].map(([n, r, s]) => meta(n, { runs_on: r, status: s })).join("\n");
  assert.deepEqual(buildModels(sql).map((m) => m.id), ["b", "c", "a"]);
});

test("last verified is the date of the last PASSED smoke check that names the model", () => {
  const report = { finishedAt: "2026-10-20T10:00:00Z", checks: [
    { name: "chat", status: "PASSED", models: ["qwen2.5:7b", "provider:ollama"] },
    { name: "image", status: "FAILED", models: ["flux-2-klein-4b"] },
    { name: "tts", status: "SKIPPED" },
  ] };
  assert.deepEqual([...verifiedBySmoke(report)], [["qwen2.5:7b", "2026-10-20"]]);
  assert.equal(buildModels(seed + meta("qwen2.5:7b"), { smoke: report })[0].lastVerified, "2026-10-20");
  assert.equal(verifiedBySmoke(null).size, 0);
  assert.equal(verifiedBySmoke({ checks: [{ status: "PASSED", models: ["x"] }] }).size, 0, "a report without a date proves nothing");
});

test("comments and dollar-quoted blocks do not break statement splitting", () => {
  assert.equal(stripComments("select 1; -- it's; fine\nselect '--kept';").includes("it's"), false);
  assert.ok(stripComments("select '--kept';").includes("--kept"));
  assert.equal(statements("UPDATE t SET j = $${\"a\": \"b;c\"}$$::jsonb;\nselect 2;").length, 2);
});
