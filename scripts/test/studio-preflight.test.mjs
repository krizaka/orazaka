import assert from "node:assert/strict";
import { test } from "node:test";
import { judge } from "../studio-preflight.mjs";

test("accepted run passes", () => assert.equal(judge(202, { id: "r" }).ok, true));
test("model known but engine down passes (a pod fixes it)", () => {
  assert.equal(judge(400, { message: "model: FLUX.1 [schnell] (Q8_0) is not running (its engine could not be reached). Choose another model or leave it on automatic." }).ok, true);
});
test("unknown model fails", () => assert.equal(judge(400, { message: "model: 'x' is not a image model. Choose one of: a, b" }).ok, false));
test("aspect refused fails", () => assert.equal(judge(400, { message: "size: '1024x1024' is not supported by X (it makes 512x512)." }).ok, false));
test("auth and server errors fail", () => { assert.equal(judge(401, "").ok, false); assert.equal(judge(500, "boom").ok, false); });

import { readFileSync } from "node:fs";
test("the batch runs the free preflight BEFORE it rents a pod", () => {
  const sh = readFileSync(new URL("../lib/gpu-runpod.sh", import.meta.url), "utf8");
  const body = sh.slice(sh.indexOf("runpod_batch() {"));
  assert.ok(body.indexOf("studio-preflight.mjs") > 0 && body.indexOf("studio-preflight.mjs") < body.indexOf("runpod_start"));
});
