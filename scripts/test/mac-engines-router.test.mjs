// node --test scripts/test — the Mac's two engines behind one relay port.
import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { serve, target } from "../mac-engines-router.mjs";

test("speech goes to LocalAI, everything else to sd-server", () => {
  assert.equal(target("/v1/audio/speech"), "http://127.0.0.1:8085");
  assert.equal(target("/v1/images/generations"), "http://127.0.0.1:8087");
  assert.equal(target("/"), "http://127.0.0.1:8087");
  assert.equal(target("/v1/audio/x", { MEDIA_SPEECH_URL: "http://s" }), "http://s");
});

const engine = (name) => new Promise((resolve) => {
  const s = http.createServer((req, res) => {
    res.setHeader("content-type", "text/plain; charset=utf-8"); // a plain-text echo of the path, never HTML
    res.end(`${name}:${req.url}`);
  });
  s.listen(0, "127.0.0.1", () => resolve(s));
});
const get = (port, path) => new Promise((resolve, reject) => {
  http.get({ host: "127.0.0.1", port, path }, (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => resolve(b)); }).on("error", reject);
});

test("forwards each path to the engine that owns it, and says so when an engine is down", async () => {
  const speech = await engine("speech");
  const image = await engine("image");
  const env = process.env;
  env.MEDIA_SPEECH_URL = `http://127.0.0.1:${speech.address().port}`;
  env.MEDIA_IMAGE_URL = `http://127.0.0.1:${image.address().port}`;
  const router = await serve(0);
  const port = router.address().port;
  assert.equal(await get(port, "/v1/audio/speech"), "speech:/v1/audio/speech");
  assert.equal(await get(port, "/v1/images/generations"), "image:/v1/images/generations");
  image.close();
  env.MEDIA_IMAGE_URL = "http://127.0.0.1:1";
  assert.match(await get(port, "/v1/images/generations"), /engine unreachable/);
  router.close(); speech.close();
  delete env.MEDIA_SPEECH_URL; delete env.MEDIA_IMAGE_URL;
});
