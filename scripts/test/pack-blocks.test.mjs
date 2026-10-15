import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packBlock, packIndexBlock, packsSection } from "../lib/pack-blocks.mjs";

const pack = {
  key: "document-validation", version: "1.1.0", tier: "WORKER", kind: null, distribution: "CLOUD", regulatoryClass: "SENSITIVE", status: "PUBLISHED",
  category: "legal", workers: ["validation"], scopeGuard: true, consent: false, safety: false,
  rulesets: [{ id: "r", label: "Quebec lease", jurisdiction: "CA-QC", rules: 12, versions: ["2026-01-01", "2026-06-01"] }],
  text: { en: { label: "Document Verification", tagline: "Check a contract.\n  Clause by clause.", description: "Long   text." } },
  categoryText: { en: { label: "Legal" } },
  studios: [{ key: "check", text: { en: { label: "Check", tagline: "Is it valid?", description: "Reads it." } }, inputs: [{ key: "doc", title: "Document" }], steps: 3, stepKinds: ["CAPABILITY"], estimatedCredits: 90 }],
};

test("a pack block carries the facts a card shows, as data, on one line each", () => {
  const b = packBlock(pack);
  assert.equal(b.title, "Document Verification");
  assert.equal(b.tagline, "Check a contract. Clause by clause.");
  assert.deepEqual({ tier: b.tier, regulatoryClass: b.regulatoryClass, category: b.category, workers: b.workers }, { tier: "WORKER", regulatoryClass: "SENSITIVE", category: "Legal", workers: ["validation"] });
  assert.deepEqual(b.rulesets[0], { label: "Quebec lease", jurisdiction: "CA-QC", rules: 12, versions: ["2026-01-01", "2026-06-01"] });
  assert.equal(b.studios[0].credits, 90);
  assert.equal(packIndexBlock([pack])[0].studios, 1);
});

test("a category key without a translation reads like the translated ones (no \"Business\" next to \"business\")", () => {
  const raw = { ...pack, categoryText: {}, category: "business" };
  assert.equal(packBlock(raw).category, "Business");
  assert.equal(packIndexBlock([raw])[0].category, "Business");
});

test("the section is headings plus fences — no table, no prose wall", () => {
  const md = packsSection([pack]).join("\n");
  assert.match(md, /^### Document Verification$/m);
  assert.match(md, /^```pack-index$/m);
  assert.match(md, /^```pack$/m);
  assert.ok(!/^\|/m.test(md));
});

test("the generated Packs page lays the Studios out as cards: no table with more than 3 columns for them", () => {
  const md = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "_generated", "PACKS.md"), "utf8");
  assert.match(md, /^```pack$/m, "the packs are fenced data blocks");
  for (const line of md.split("\n")) {
    if (/^\|\s*Studio\s*\|/.test(line)) assert.fail(`a Studios table is back: ${line.slice(0, 80)}`);
  }
});
