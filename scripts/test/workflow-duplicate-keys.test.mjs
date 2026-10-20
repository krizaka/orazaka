// node --test scripts/test — a duplicated mapping key in a workflow (two `permissions:` on one job) is a workflow-file
// error: the run fails at startup with no job, and every repository that calls component.yml goes red (2026-10-19).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const dir = new URL("../../.github/workflows/", import.meta.url);

/** Duplicated keys among the direct children of every mapping at `indent`, per parent line. */
export function duplicateKeys(text) {
  const dups = [];
  const stack = []; // { indent, keys:Set, parent }
  for (const [i, raw] of text.split("\n").entries()) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const m = /^(\s*)(?:- )?([A-Za-z0-9_.\-"']+):(\s|$)/.exec(raw);
    if (!m) continue;
    const indent = m[1].length + (raw.trimStart().startsWith("- ") ? 2 : 0);
    const fresh = raw.trimStart().startsWith("- ");
    while (stack.length && stack[stack.length - 1].indent > indent) stack.pop();
    if (fresh) while (stack.length && stack[stack.length - 1].indent === indent) stack.pop();
    let top = stack[stack.length - 1];
    if (!top || top.indent < indent) {
      top = { indent, keys: new Set() };
      stack.push(top);
    }
    const key = m[2].replace(/["']/g, "");
    if (top.keys.has(key)) dups.push(`line ${i + 1}: ${key}`);
    top.keys.add(key);
  }
  return dups;
}

test("the detector finds a repeated job key and ignores sequences of steps", () => {
  assert.deepEqual(duplicateKeys("jobs:\n  a:\n    permissions:\n      x: 1\n    runs-on: u\n    permissions:\n      x: 1\n"), ["line 6: permissions"]);
  assert.deepEqual(duplicateKeys("steps:\n  - name: a\n    run: x\n  - name: b\n    run: y\n"), []);
});

test("no workflow repeats a key in the same mapping", () => {
  for (const f of readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
    assert.deepEqual(duplicateKeys(readFileSync(new URL(f, dir), "utf8")), [], f);
  }
});
