import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// 2026-11-06: krizaka-users, krizaka-platform-kit, krizaka-notifications, krizaka-accounts and krizaka-billing are deleted repositories:
// their code is a folder of krizaka-build (ADR-021). The documents a newcomer reads link the folder, never the repository.
// Left on purpose: scripts/lib/krizaka-versions.mjs PACKAGE_REPOSITORIES (GitHub Packages still bound to the old repositories),
// the generated docs/_generated/*, the ADRs and the dev migrations (history).
const GONE = "krizaka-users|krizaka-platform-kit|krizaka-notifications|krizaka-accounts|krizaka-billing";
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("the README, AGENTS, docs and generators link no deleted repository", () => {
  for (const file of ["README.md", "AGENTS.md", ".env.example", "docs/APP_VERSIONING.md", "scripts/generate-docs.mjs"]) {
    assert.doesNotMatch(read(file), new RegExp(`github\\.com/krizaka/(${GONE})(?![-\\w])`), `${file} links a deleted repository`);
    assert.doesNotMatch(read(file), new RegExp(`krizaka/(${GONE})(?![-\\w/])`), `${file} names a deleted repository path`);
  }
});
