// node --test scripts/test — a local-stack tool runs only against a folder that holds the stack's compose file.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { composeRoot } from "../lib/compose-root.mjs";

const repo = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const empty = mkdtempSync(path.join(tmpdir(), "compose-root-"));
after(() => rmSync(empty, { recursive: true, force: true }));

test("the repository is a workspace root, answered absolute", () => {
  assert.equal(composeRoot(repo), repo);
  assert.equal(composeRoot(path.relative(process.cwd(), repo) || "."), repo);
});

test("a folder without the compose file, or an option-like argument, is refused", () => {
  for (const dir of [empty, "--env-file=/etc/passwd", path.join(repo, "scripts")]) {
    assert.throws(() => composeRoot(dir), /not an Orazaka workspace/, dir);
  }
});
