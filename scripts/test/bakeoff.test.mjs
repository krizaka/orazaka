// node --test scripts/test — the law bake-off: the verifier port, the scoring, the decision rule and the budget cap, on a fictional statute (no real article text in this repository).
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { passagesFrom } from "../lib/bakeoff/corpus.mjs";
import { verifyClaim, normalize, containsQuote, key, keys } from "../lib/bakeoff/verify.mjs";
import { scoreCase, aggregate, decide, stability, parseAnswer } from "../lib/bakeoff/score.mjs";
import { runBakeoff } from "../law-bakeoff.mjs";
import { mdLawBakeoff } from "../lib/bakeoff/report.mjs";

const xml = fileURLToPath(new URL("./fixtures/fictional-statute.xml", import.meta.url));
const passages = passagesFrom(xml, "FICT-1", ["1", "2", "3"], "fr");
const [p1, p2, p3] = passages;
const cite = (p, quote) => ({ url: p.url, contentHash: p.contentHash, quote });
const golden = { id: "g", language: "fr", question: "q", targets: [{ instrument: "FICT-1", refs: ["1", "2"] }], decoys: ["3"], expectedRefs: ["1", "2"], mustState: [{ id: "thirty", pattern: "30" }], forbidden: [{ pattern: "jamais allumer", why: "x" }], offTopic: "redevance" };

test("the corpus reads an article as a label and one paragraph per subsection", () => {
  assert.equal(p2.text, "Article 2\n\nLe gardien peut refuser l'accès au phare après 22 heures.\n\nIl ne peut jamais refuser l'accès aux secours.");
  assert.match(p1.contentHash, /^[0-9a-f]{64}$/u);
  assert.throws(() => passagesFrom(xml, "FICT-1", ["9"], "fr"), /article 9/u);
});

test("quotes are normalised like the engine's (typography, case, spaces)", () => {
  assert.equal(normalize("« L’accès : Œuvre »"), '"l\'accès : oeuvre"');
  assert.ok(containsQuote(p2.text, "REFUSER L’ACCÈS au phare"));
  assert.ok(!containsQuote(p2.text, ""));
  assert.equal(key("Articles 12"), key("art. 12"));
  assert.ok(keys("l'article 12 et https://x.test/a.").has("https://x.test/a"));
});

test("the verifier: provenance, then support of numbers and references", () => {
  const ok = verifyClaim({ text: "La lampe est allumée 30 minutes avant le coucher du soleil.", citations: [cite(p1, "allumer la lampe 30 minutes avant")] }, passages);
  assert.equal(ok.status, "VERIFIED");
  const none = verifyClaim({ text: "x", citations: [] }, passages);
  assert.equal(none.reason, "NO_SOURCE");
  const hash = verifyClaim({ text: "x", citations: [{ ...cite(p1, "lampe"), contentHash: "0".repeat(64) }] }, passages);
  assert.equal(hash.reason, "URL_UNRESOLVED");
  const invented = verifyClaim({ text: "x", citations: [cite(p1, "une phrase inventée")] }, passages);
  assert.equal(invented.reason, "QUOTE_NOT_FOUND");
  const number = verifyClaim({ text: "La lampe est allumée 45 minutes avant.", citations: [cite(p1, "30 minutes avant")] }, passages);
  assert.equal(number.reason, "UNSUPPORTED");
  const article = verifyClaim({ text: "Selon l'article 3, le gardien refuse.", citations: [cite(p2, "refuser l'accès au phare")] }, passages);
  assert.equal(article.reason, "UNSUPPORTED");
  const long = verifyClaim({ text: "x", citations: [cite(p1, "lampe ".repeat(60))] }, passages);
  assert.equal(long.reason, "QUOTE_NOT_FOUND");
});

const answer = (claims) => JSON.stringify({ answer: "a", claims, sources: [] });

test("scoring counts verified claims, recall, facts stated and wrong accepted", () => {
  const good = answer([
    { text: "Le gardien allume la lampe 30 minutes avant le coucher du soleil.", citations: [cite(p1, "allumer la lampe 30 minutes avant")] },
    { text: "Le gardien peut refuser l'accès après 22 heures.", citations: [cite(p2, "refuser l'accès au phare après 22 heures")] },
  ]);
  const s = scoreCase(golden, passages, good);
  assert.deepEqual([s.claims, s.verified, s.wrongAccepted, s.recalled, s.expected, s.stated], [2, 2, 0, 2, 2, 1]);
  assert.equal(s.quotesFound, 2);
  assert.ok(s.wording > 0.7);

  const decoy = scoreCase(golden, passages, answer([{ text: "La redevance est de 12 pièces d'argent.", citations: [cite(p3, "12 pièces d'argent")] }]));
  assert.equal(decoy.verified, 1);
  assert.equal(decoy.wrongAccepted, 1);
  assert.match(decoy.wrongReasons[0], /does not target/u);

  const forbidden = scoreCase(golden, passages, answer([{ text: "Le gardien peut jamais allumer la lampe.", citations: [cite(p1, "allumer la lampe")] }]));
  assert.equal(forbidden.wrongAccepted, 1);
});

test("an answer that is not the citation shape scores zero claims; a fence is tolerated and noted", () => {
  assert.equal(parseAnswer("Voici la réponse").ok, false);
  assert.equal(parseAnswer('{"claims": []}').ok, false);
  const fenced = parseAnswer("```json\n" + answer([]) + "\n```");
  assert.deepEqual([fenced.ok, fenced.fenced], [true, true]);
  assert.equal(scoreCase(golden, passages, "nope").verified, 0);
});

test("the same answers always give the same verdict key", () => {
  const a = answer([{ text: "Le gardien allume la lampe 30 minutes avant.", citations: [cite(p1, "30 minutes avant")] }]);
  assert.equal(scoreCase(golden, passages, a).verdictKey, scoreCase(golden, passages, a).verdictKey);
});

const agg = (o) => ({ aggregate: { wrongAccepted: 0, recall: 1, statedRate: 1, verifiedRate: 1, ...o }, local: false, costPerRunUsd: 0.01 });

test("decision: a wrong accepted citation disqualifies; then accuracy; then local and cheap", () => {
  assert.deepEqual(decide({ a: agg({ wrongAccepted: 1 }), b: agg({ recall: 0.5 }) }).winner, "b");
  assert.equal(decide({ a: agg({ wrongAccepted: 1 }) }).winner, null);
  assert.equal(decide({ a: agg({ recall: 0.9 }), b: agg({ recall: 1 }) }).winner, "b");
  assert.equal(decide({ a: agg({}), b: { ...agg({}), local: true, costPerRunUsd: 0 } }).winner, "b");
  assert.equal(decide({ a: agg({}), b: { ...agg({}), costPerRunUsd: 0.001 } }).winner, "b");
});

test("stability compares the verdicts of repeated runs", () => {
  const r = (caseId, verdictKey) => ({ caseId, score: { verdictKey } });
  assert.equal(stability([r("a", "1"), r("a", "1"), r("b", "1"), r("b", "2")]), 0.5);
  assert.equal(stability([r("a", "1")]), null);
});

test("the run stops paid calls at the cap and says so; local calls never count", async () => {
  const good = answer([{ text: "Le gardien allume la lampe 30 minutes avant.", citations: [cite(p1, "30 minutes avant")] }]);
  let calls = 0;
  const chatFor = (where) => async () => {
    calls++;
    return { text: good, usage: { promptTokens: 1_000_000, completionTokens: 0 }, ms: 10 + calls };
  };
  const prices = { priceDate: "2026-10-26", models: { paid: { inputPerMillion: 1, outputPerMillion: 1 } } };
  const result = await runBakeoff({
    golden: { cases: [golden, { ...golden, id: "h" }] },
    prices,
    models: [{ id: "local", where: "ollama" }, { id: "paid", where: "do" }],
    repeat: 2,
    maxUsd: 2,
    passagesFor: () => passages,
    chatFor,
    now: new Date("2026-10-26T00:00:00Z"),
  });
  const paid = result.models.find((m) => m.id === "paid");
  assert.equal(paid.runs.length, 2);
  assert.equal(result.spentUsd, 2);
  assert.deepEqual(result.stoppedAtCap, ["paid/h/1", "paid/h/2"]);
  assert.equal(result.models.find((m) => m.id === "local").runs.length, 4);
  assert.equal(result.runIds.length, 6);
  const md = mdLawBakeoff({ ...result, notMeasured: [{ step: "x", why: "y" }] });
  assert.match(md, /## Law retrieval bake-off/u);
  assert.match(md, /\*\*local\*\*/u);
  assert.match(md, /Steps not measured yet/u);
  assert.ok(aggregate(result.models[0].runs).latencyP95 > 0);
});
