// The rules of `scripts/journey-dev.mjs` (Dev preview journey.core, orazaka#178), kept pure so they are tested first.

/** The id the edge gives a request: its own `x-request-id`, else Cloudflare's `cf-ray`. */
export function edgeRequestId(headers) {
  return headers.get("x-request-id") ?? headers.get("cf-ray") ?? null;
}

/** The text of a chat stream (SSE): every `data:` event in order, JSON `{content}` or plain text, no ping, no done marker. */
export function chatText(sse) {
  let out = "";
  for (const line of sse.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).replace(/^ /, "");
    if (data === "" || data === "[DONE]" || data === ",") continue;
    try {
      const json = JSON.parse(data);
      out += typeof json === "string" ? json : (json.content ?? json.delta ?? json.text ?? "");
    } catch {
      out += data;
    }
  }
  return out;
}

/** What a finished Studio run reports about itself — the platform's own start and finish, never a wish of the script. */
export function runFacts(run) {
  const ms = run.startedAt && run.finishedAt ? Date.parse(run.finishedAt) - Date.parse(run.startedAt) : null;
  return {
    runId: run.id,
    studio: run.studioKey,
    status: run.status,
    seconds: ms === null ? null : Math.round(ms) / 1000,
    jobIds: (run.steps ?? []).map((s) => s.jobId).filter(Boolean),
    outputs: (run.outputs ?? []).length,
  };
}

/** A journey is proven when it has steps and every one is ok AND carries the id of its request (no id, no proof). */
export function isProven(report) {
  return report.steps.length > 0 && report.steps.every((s) => s.ok && Boolean(s.requestId));
}

/** The report as a person reads it (markdown table); bearer tokens and JWTs are scrubbed from every note. */
export function readableReport(report) {
  const scrub = (text) => String(text ?? "").replace(/Bearer\s+\S+/gi, "Bearer …").replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "…").replace(/\b[\w-]{2,}\.[\w-]{2,}\.[\w-]{2,}\b/g, (m) => (/^\d+\.\d+\.\d+/.test(m) ? m : "…"));
  const rows = report.steps.map((s) => `| ${s.name} | ${s.ok ? "ok" : "FAILED"} | ${scrub(s.note)} | ${s.requestId ?? "—"} |`);
  return [`Persona: ${report.persona}`, "", "| Step | Result | What the platform said | Edge request id |", "| :-- | :-- | :-- | :-- |", ...rows].join("\n");
}
