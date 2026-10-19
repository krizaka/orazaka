#!/usr/bin/env node
// A stand-in for everything behind the edge, so the edge can be measured alone (CI, a laptop with no
// Docker): identity (login, service-key exchange with the owner's tier), the Studio service
// (catalogue, runs with Idempotency-Key) and a streaming chat. It answers like the real services in
// shape, with a small fixed think time, so what the load test measures is the edge and its contract,
// not a model.
//
//   node tests/load/stub-stack.mjs [port=9000]
//   edge: IDENTITY_INTERNAL_URL=ROUTER_INTERNAL_URL=STUDIO_INTERNAL_URL=http://127.0.0.1:9000
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const port = Number(process.argv[2] ?? 9000);
const runs = new Map(); // id -> { startedAt }
const remembered = new Map(); // `${actor}|${key}` -> { id, fingerprint }
// A service key named oz_tier<N>_... belongs to a tier of N requests per minute (the identity service
// sends the owner's tier with the exchange).
const tierOf = (serviceKey) => Number(/^oz_tier(\d+)/.exec(serviceKey)?.[1] ?? 0) || null;

const json = (res, status, body, headers = {}) => {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text), ...headers });
  res.end(text);
};
const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

createServer(async (req, res) => {
  const url = new URL(req.url, "http://stub");
  const path = url.pathname;

  if (req.method === "POST" && path === "/internal/v1/tokens/exchange") {
    const { apiKey } = JSON.parse((await readBody(req)) || "{}");
    if (!apiKey?.startsWith("oz_") || apiKey.includes("invalid")) return json(res, 401, {});
    await sleep(3); // a database read
    const rpm = tierOf(apiKey);
    return json(res, 200, {
      token: `jwt.${apiKey}`,
      scopes: [],
      ...(rpm ? { tierKey: `tier${rpm}`, requestsPerMinute: rpm } : {}),
    });
  }
  if (req.method === "POST" && path === "/api/v1/auth/login") {
    await sleep(60); // bcrypt
    return json(res, 200, { token: "jwt.login", username: "load", email: "load@example.test", authorities: [], activeInterceptions: [] });
  }
  if (req.method === "POST" && path === "/api/v1/api-keys") {
    return json(res, 201, { id: randomUUID(), name: "k6", keyPrefix: "oz_live_stub", key: `oz_live_${randomUUID()}`, scopes: [] });
  }
  if (req.method === "DELETE" && path.startsWith("/api/v1/api-keys/")) {
    res.writeHead(204);
    return res.end();
  }
  const caller = (req.headers.authorization ?? "").slice(0, 40);

  if (req.method === "GET" && path === "/api/v1/studios") {
    await sleep(8);
    return json(res, 200, [{ studioKey: "compliance-check", title: "Compliance check" }]);
  }
  if (req.method === "GET" && path === "/api/v1/profile") {
    await sleep(5);
    return json(res, 200, { username: "load" });
  }
  const start = /^\/api\/v1\/studios\/([^/]+)\/runs$/.exec(path);
  if (req.method === "POST" && start) {
    const body = await readBody(req);
    await sleep(25); // validate, hold credits, persist
    const idempotencyKey = req.headers["idempotency-key"];
    const fingerprint = `${start[1]}|${body}`;
    if (idempotencyKey) {
      const known = remembered.get(`${caller}|${idempotencyKey}`);
      if (known) {
        if (known.fingerprint !== fingerprint) return json(res, 422, { status: "idempotency_key_reused" });
        return json(res, 202, { id: known.id, status: "RUNNING" }, { "Idempotent-Replayed": "true" });
      }
    }
    const id = randomUUID();
    runs.set(id, { startedAt: Date.now() });
    if (idempotencyKey) remembered.set(`${caller}|${idempotencyKey}`, { id, fingerprint });
    return json(res, 202, { id, status: "RUNNING" });
  }
  const read = /^\/api\/v1\/studios\/runs\/([^/]+)$/.exec(path);
  if (req.method === "GET" && read) {
    await sleep(6);
    const run = runs.get(read[1]);
    if (!run) return json(res, 404, { status: "run_not_found" });
    return json(res, 200, { id: read[1], status: Date.now() - run.startedAt > 1500 ? "SUCCEEDED" : "RUNNING" });
  }
  if (req.method === "GET" && path.startsWith("/api/v1/chat/stream/")) {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    await sleep(120); // first token
    for (let i = 0; i < 12; i++) {
      res.write(`data: {"delta":"w${i} "}\n\n`);
      await sleep(15);
    }
    res.write("data: [DONE]\n\n");
    return res.end();
  }
  json(res, 404, { error: "stub: unknown route", path });
}).listen(port, "127.0.0.1", () => console.log(`stub stack on http://127.0.0.1:${port}`));
