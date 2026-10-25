// Dev preview `journey.core` + `journey.ai-via-orazaka` (orazaka#178): the rules of the journey report — what counts as a
// proven step, what a request id is, how a chat stream is read — tested before the script that replays the journey.
import assert from "node:assert/strict";
import test from "node:test";
import { chatText, edgeRequestId, isProven, readableReport, runFacts } from "../lib/journey.mjs";

test("a request id is the edge's own: x-request-id first, then Cloudflare's cf-ray", () => {
  assert.equal(edgeRequestId(new Headers({ "x-request-id": "r-1", "cf-ray": "a-YUL" })), "r-1");
  assert.equal(edgeRequestId(new Headers({ "cf-ray": "a4dc930cb8e5fbd3-YUL" })), "a4dc930cb8e5fbd3-YUL");
  assert.equal(edgeRequestId(new Headers()), null);
});

test("a chat stream is read from its data events, in order, ignoring pings and the done marker", () => {
  const sse = ["event: ping\ndata: \n", 'data: {"content":"Bonjour"}\n', "data: ,\n", 'data: {"content":" Eric"}\n', "data: [DONE]\n"].join("\n");
  assert.equal(chatText(sse), "Bonjour Eric");
  assert.equal(chatText("data: Hello\n\ndata:  there\n\n"), "Hello there");
  assert.equal(chatText(""), "");
});

test("a run's facts: status, seconds from the platform's own start and finish, the jobs of its steps", () => {
  const f = runFacts({
    id: "r1", studioKey: "image-generation", status: "SUCCEEDED",
    startedAt: "2026-10-21T01:00:00Z", finishedAt: "2026-10-21T01:00:12.500Z",
    steps: [{ stepId: "image", jobId: "j1", status: "SUCCEEDED" }], outputs: [{ kind: "image", value: "/api/v1/media/a1" }],
  });
  assert.deepEqual(f, { runId: "r1", studio: "image-generation", status: "SUCCEEDED", seconds: 12.5, jobIds: ["j1"], outputs: 1 });
});

test("a step is proven only with a request id and an ok result; a journey only when every step is", () => {
  const ok = (name) => ({ name, ok: true, requestId: "x", ms: 10 });
  assert.equal(isProven({ steps: [ok("a"), ok("b")] }), true);
  assert.equal(isProven({ steps: [ok("a"), { ...ok("b"), ok: false }] }), false);
  assert.equal(isProven({ steps: [ok("a"), { ...ok("b"), requestId: null }] }), false, "no request id, no proof");
  assert.equal(isProven({ steps: [] }), false);
});

test("the report names no credential: the persona is a first name, the token never appears", () => {
  const text = readableReport({ persona: "Eric", steps: [{ name: "sign-in", ok: true, requestId: "r", ms: 5, note: "Bearer abc.def.ghi leaked" }] });
  assert.match(text, /Eric/);
  assert.doesNotMatch(text, /abc\.def\.ghi/);
});
