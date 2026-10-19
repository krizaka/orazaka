// node --test scripts/test — the RunPod guard's HTTP call: an explicit User-Agent (urllib's default one gets intermittent
// 403s from RunPod's edge) and retries on 403/429/5xx, but not on other 4xx.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const guard = fileURLToPath(new URL("../runpod-guard.py", import.meta.url));

/** Serve `statuses` in order (then the last one forever); returns the user-agents seen and the python result. */
async function callWith(statuses) {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push(req.headers["user-agent"]);
    const status = statuses[Math.min(seen.length - 1, statuses.length - 1)];
    res.writeHead(status, { "content-type": "application/json" });
    res.end(status === 200 ? '{"ok":true}' : "{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/x`;
  const code = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("g", ${JSON.stringify(guard)}); g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)
try:
    print(json.dumps(g.call(${JSON.stringify(url)}, "k", {"a": 1})))
except Exception as e:
    print("ERR", getattr(e, "code", e))
`;
  const out = await new Promise((resolve, reject) => {
    execFile("python3", ["-c", code], { encoding: "utf8", env: { ...process.env, GPU_RETRY_SLEEP: "0" } }, (error, stdout) =>
      error ? reject(error) : resolve(stdout.trim()));
  });
  server.close();
  return { seen, out };
}

test("every request names itself (explicit User-Agent)", async () => {
  const { seen, out } = await callWith([200]);
  assert.equal(out, '{"ok": true}');
  assert.match(seen[0], /^orazaka-runpod-guard\//);
});

test("403, 429 and 5xx are retried until the call succeeds", async () => {
  const { seen, out } = await callWith([403, 429, 503, 200]);
  assert.equal(out, '{"ok": true}');
  assert.equal(seen.length, 4);
});

test("a persistent 403 gives up after a bounded number of tries", async () => {
  const { seen, out } = await callWith([403]);
  assert.equal(out, "ERR 403");
  assert.equal(seen.length, 4);
});

test("other client errors are not retried", async () => {
  const { seen, out } = await callWith([404]);
  assert.equal(out, "ERR 404");
  assert.equal(seen.length, 1);
});
