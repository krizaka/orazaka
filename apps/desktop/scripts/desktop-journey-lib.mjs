// The pure parts of the Mac journey (krizaka-internal#230): where the app keeps its folder scope, a pre-granted scope, a one-page
// PDF with a line of text, and the stand-in model the automation talks to (an OpenAI-compatible server on loopback). No dependency.
import { createServer } from "node:http";
import { join } from "node:path";

export const IDENTIFIER = "com.krizaka.orazaka.desktop";

/** Where the kit (krizaka-tauri-kit `ScopeStore`) persists the granted folders on a Mac. */
export const scopeFile = (home) => join(home, "Library", "Application Support", IDENTIFIER, "scope.json");

/** The scope the kit loads: `{"roots":[…]}`. It drops a root that is gone or not grantable (the home, `/`, `/tmp`, `/var`). */
export const scopeJson = (roots) => `${JSON.stringify({ roots }, null, 2)}\n`;

/** A valid one-page PDF holding `text` (the automation extracts it with pdf-extract). */
export function minimalPdf(text) {
  const safe = text.replace(/[\\()]/g, "");
  const stream = `BT /F1 14 Tf 72 720 Td (${safe}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

/** The answer of the stand-in model to a request: its model list, or one chat completion (the summary). */
export function modelReply(method, url, summary, model = "journey-model") {
  if (method === "GET" && url.endsWith("/models")) return { data: [{ id: model }] };
  if (method === "POST" && url.endsWith("/chat/completions")) {
    return { choices: [{ message: { role: "assistant", content: summary } }], usage: { prompt_tokens: 120, completion_tokens: 40 } };
  }
  return undefined;
}

/** Starts the stand-in model on loopback (port 0 = any); resolves `{ baseUrl, close }`. */
export function startModel(summary, { port = 0 } = {}) {
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const reply = modelReply(req.method, req.url ?? "", summary);
      res.writeHead(reply ? 200 : 404, { "content-type": "application/json" });
      res.end(JSON.stringify(reply ?? { error: "not found" }));
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      resolve({ baseUrl: `http://127.0.0.1:${server.address().port}/v1`, close: () => new Promise((done) => server.close(done)) });
    });
  });
}
