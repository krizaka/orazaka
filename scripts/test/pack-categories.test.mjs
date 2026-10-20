// The catalogue's shelves, as the site reads them (orazaka-packs#16): every pack on the shelf stands on a category of
// the closed list, with the shelf's weight and its EN/FR words, read from the pack.yaml and its i18n — never typed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { packs } = JSON.parse(fs.readFileSync(path.join(root, "docs", "_generated", "architecture.json"), "utf8"));
const CATEGORIES = ["business-compliance", "creativity-media", "wellbeing", "data-analytics"];
const onShelf = packs.filter((p) => p.status === "PUBLISHED" && p.showcase);

test("every pack on the shelf has a category of the closed list, its weight and its words in both languages", () => {
  assert.ok(onShelf.length >= 5);
  for (const p of onShelf) {
    assert.ok(CATEGORIES.includes(p.category), `${p.key}: category ${p.category}`);
    assert.equal(typeof p.categorySortWeight, "number", `${p.key}: categorySortWeight`);
    for (const l of ["en", "fr"]) assert.ok(p.categoryText[l]?.label, `${p.key}: ${l} category label`);
  }
});

test("Wellbeing stays Wellbeing, regulated", () => {
  const w = packs.find((p) => p.dir === "wellbeing");
  assert.equal(w.category, "wellbeing");
  assert.equal(w.categoryText.en.label, "Wellbeing");
  assert.equal(w.regulatoryClass, "REGULATED");
});

test("the DRAFT test pack is never on the shelf", () => {
  assert.ok(!onShelf.some((p) => p.key === "echo-toolkit"));
});
