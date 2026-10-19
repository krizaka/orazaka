// node --test scripts/test — the docs generator's text helpers cannot be fooled by nested or doubled input.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mdCell, stripTags, xmlDecode } from "../lib/doc-text.mjs";

test("stripTags leaves no tag rebuilt from the remains of another", () => {
  assert.equal(stripTags("a <b>bold</b> word"), "a bold word");
  assert.ok(!stripTags("<<b>script>alert(1)<</b>/script>").includes("<"));
  assert.ok(!/<[a-z/]/i.test(stripTags("<scr<b>ipt>x</scr</b>ipt>")));
});

test("mdCell escapes the backslash before the pipe", () => {
  assert.equal(mdCell("a|b"), "a\\|b");
  assert.equal(mdCell("a\\|b"), "a\\\\\\|b");
});

test("xmlDecode reads &amp;lt; as the text &lt;, not as <", () => {
  assert.equal(xmlDecode("a &lt;b&gt; &amp; c"), "a <b> & c");
  assert.equal(xmlDecode("&amp;lt;"), "&lt;");
});

test("generate-docs uses the helpers, not the one-pass replaces", () => {
  const source = new URL("../generate-docs.mjs", import.meta.url);
  return import("node:fs").then(({ readFileSync }) => {
    const text = readFileSync(source, "utf8");
    assert.ok(!text.includes('.replace(/<[^>]+>/g, "")'));
    assert.ok(!text.includes('replace(/&amp;/g, "&")'));
  });
});
