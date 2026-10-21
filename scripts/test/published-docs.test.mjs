// The hand-written docs the site publishes (dev.orazaka.com/docs): no link to an internal document, no autolink the
// site's markdown cannot render, and one Node.js minimum — the one CI runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
/** Published by orazaka-web-client (scripts/docs-manifest.mjs). */
const PUBLISHED = ["docs/101.md", "docs/SELF_HOSTING.md", "SECURITY.md", "docs/GLOSSARY.md", "docs/AUTH.md", "docs/LICENSING.md", "docs/CONTENT_POLICY.md"];
/** Internal: strategy, pricing, audits. */
const INTERNAL = ["DELIVERY.md", "BILLING_ARCHITECTURE.md", "PRODUCTION_READINESS_AUDIT.md", "ARCHITECTURE_ASSESSMENT.md"];

test("a published doc never links to an internal document", () => {
  for (const f of PUBLISHED) {
    const md = read(f);
    for (const name of INTERNAL) assert.ok(!md.includes(name), `${f} links ${name}`);
  }
});

test("a published doc has no <https://…> autolink (the site would print it literally)", () => {
  for (const f of PUBLISHED) assert.ok(!/<https?:\/\//.test(read(f)), `${f} has an autolink`);
});

test("the docs state the Node.js minimum CI runs", () => {
  const ci = [...read(".github/workflows/ci.yml").matchAll(/node-version:\s*"(\d+)"/g)].map((m) => m[1]);
  assert.ok(ci.length > 0);
  const major = ci[0];
  for (const f of ["docs/101.md", "docs/SELF_HOSTING.md", "README.md", "docs/DEVEX_LIFECYCLE.md"]) {
    const mins = [...read(f).matchAll(/Node(?:\.js)?\s+(\d+)\+/g)].map((m) => m[1]);
    for (const m of mins) assert.equal(m, major, `${f} says Node ${m}+, CI runs ${major}`);
  }
});

// Unpublished on dev.orazaka.com (orazaka-web-client#231): a marketing playbook, a tour and a generated stub.
// A published doc, and the README, must not link them or the removed /gallery page.
test("no published doc links a page the site no longer publishes", () => {
  const gone = [/BUSINESS_IMPLEMENTATION\.md/, /CINEMATIC_SHORTS\.md/, /\]\(USE_CASES\.md\)/, /orazaka\.com\/gallery/];
  for (const f of [...PUBLISHED, "docs/_generated/PACKS.md", "README.md"]) {
    const md = read(f);
    for (const re of gone) assert.ok(!re.test(md), `${f} links an unpublished page (${re})`);
  }
});
