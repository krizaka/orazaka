// node --test scripts/test - the layout aliases of the manifest (krizaka-internal#2684).
import assert from "node:assert/strict";
import { test } from "node:test";
import { aliasesToCreate, linkAliases } from "../lib/workspace-aliases.mjs";

const alias = { path: "sovkora-libs", target: "orazaka-libs", why: "merged POMs" };
const present = (...names) => (p) => names.some((n) => p.endsWith(`/${n}`));

test("an alias is created when its target exists and its name does not", () => {
  assert.deepEqual(aliasesToCreate("/w", [alias], { exists: present("orazaka-libs") }), [alias]);
});

test("nothing is created when the target is missing or the name is taken", () => {
  assert.deepEqual(aliasesToCreate("/w", [alias], { exists: present() }), []);
  assert.deepEqual(aliasesToCreate("/w", [alias], { exists: present("orazaka-libs", "sovkora-libs") }), []);
});

test("the link is a relative symbolic link to the target", () => {
  const made = [];
  const created = linkAliases("/w", [alias], { exists: present("orazaka-libs"), link: (...args) => made.push(args) });
  assert.deepEqual(created, ["sovkora-libs"]);
  assert.deepEqual(made, [["orazaka-libs", "/w/sovkora-libs", "dir"]]);
});
