// node --test scripts/test — the law read API's contract (orazaka-ai-engine#89, ADR-089 §2, ADR-083 §2).
// The first document of contracts/openapi/: hand-written until #238 generates them from the controllers, so this test
// pins what the controller (orazaka-conversation-service LawArticleController) and its tests promise.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const doc = JSON.parse(readFileSync(new URL("../../contracts/openapi/law-v1.json", import.meta.url), "utf8"));
const read = doc.paths?.["/api/v1/law/articles"]?.get;

test("an OpenAPI 3.1 document with the read on /api/v1/law/articles, read-only", () => {
  assert.match(doc.openapi, /^3\.1\./);
  assert.ok(read, "GET /api/v1/law/articles is described");
  assert.deepEqual(Object.keys(doc.paths["/api/v1/law/articles"]), ["get"], "a read API: no other method");
  assert.deepEqual(read.security, [{ bearer: [] }], "a session or an oz_ key exchanged at the edge");
});

test("asOf is required, never defaulted; ref is the parameter, never reference", () => {
  const params = Object.fromEntries(read.parameters.map((p) => [p.name, p]));
  assert.deepEqual(Object.keys(params).sort(), ["asOf", "instrument", "jurisdiction", "language", "quote", "ref"]);
  for (const name of ["asOf", "instrument", "jurisdiction", "language", "ref"]) {
    assert.equal(params[name].required, true, `${name} is required`);
  }
  assert.equal(params.quote.required, false);
  assert.equal(params.asOf.schema.format, "date");
  assert.equal(params.asOf.schema.default, undefined, "no « today » default");
  assert.deepEqual(params.language.schema.enum, ["fr", "en"]);
});

test("the article and every outcome that serves no text, each with its status and code", () => {
  const ref = read.responses["200"].content["application/json"].schema.$ref;
  const ok = doc.components.schemas[ref.replace("#/components/schemas/", "")];
  assert.deepEqual(ok.required, ["text", "contentHash", "inForceFrom", "officialUrl", "importId"]);
  assert.deepEqual(ok.properties.quote.enum, ["VERIFIED", "NOT_IN_ARTICLE", null]);
  assert.ok(read.responses["200"].headers["X-Orazaka-Read-Id"]);
  const codes = Object.fromEntries(
    Object.entries(read.responses)
      .filter(([status]) => status !== "200")
      .map(([status, r]) => [status, r["x-codes"]]),
  );
  assert.deepEqual(codes, {
    400: ["invalid-request"],
    401: [],
    402: ["law-budget-exceeded"],
    404: ["law-version-unknown"],
    500: ["law-integrity-error"],
    503: ["law-corpus-disabled", "law-metering-unavailable"],
  });
  for (const [status, r] of Object.entries(read.responses)) {
    if (status !== "200" && status !== "401") {
      assert.ok(r.content["application/problem+json"], `${status} is Problem Details`);
    }
  }
});

test("what is charged is written down: one CALL on FOUND, nothing otherwise", () => {
  assert.match(read.description, /settled only on FOUND/);
  assert.match(read.description, /law-corpus/);
});
