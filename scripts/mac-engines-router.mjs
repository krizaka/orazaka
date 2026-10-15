#!/usr/bin/env node
// The Mac's engines behind ONE relay port (docs/DEPLOY_DEV.md § The Mac as the GPU).
//
// The dev relay admits one remote for the image engine, gpu-relay:8086 (`R:0.0.0.0:8086`). The Mac serves two
// OpenAI-compatible engines — sd-server (FLUX.2 [klein], images) and LocalAI (Piper, speech) — so this router
// listens on :8086 and answers each path from the engine that owns it:
//   /v1/audio/*  -> LocalAI  (MEDIA_SPEECH_URL, default http://127.0.0.1:8085)
//   everything else -> sd-server (MEDIA_IMAGE_URL, default http://127.0.0.1:8087)
// Start sd-server on :8087 (`MEDIA_IMAGE_PORT=8087`) and the chisel client keeps `R:0.0.0.0:8086:127.0.0.1:8086`.
// The dev provider row `localai` points at the same base URL (infra/deploy/dev-data.sql).
import http from "node:http";
import { pathToFileURL } from "node:url";

/** The engine that owns a request path. */
export function target(path, env = process.env) {
  const speech = env.MEDIA_SPEECH_URL ?? "http://127.0.0.1:8085";
  const image = env.MEDIA_IMAGE_URL ?? "http://127.0.0.1:8087";
  return /^\/v1\/audio\//.test(path) ? speech : image;
}

export function serve(port = Number(process.env.MEDIA_ROUTER_PORT ?? 8086), host = "127.0.0.1") {
  const server = http.createServer((req, res) => {
    const base = new URL(target(req.url ?? "/"));
    const upstream = http.request(
      { host: base.hostname, port: base.port, path: req.url, method: req.method, headers: { ...req.headers, host: base.host } },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
      },
    );
    upstream.on("error", (error) => {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `engine unreachable: ${error.message}` }));
    });
    req.pipe(upstream);
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await serve();
  console.log(`[mac-engines-router] :${process.env.MEDIA_ROUTER_PORT ?? 8086}`);
}
