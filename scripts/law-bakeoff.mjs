#!/usr/bin/env node
// Model bake-off for the law chain (orazaka#406). Step 1: the grounded legal claims of the law retrieval.
//   node scripts/law-bakeoff.mjs --corpus-fr <CCQ-1991_FR.xml> --corpus-en <CCQ-1991_EN.xml> --models qwen2.5:7b@ollama,mistral-3-14B@do [--repeat 2] [--max-usd 5]
// The corpus files are the official Données Québec statute XML, kept outside the repository. Paid calls stop at --max-usd. Local models run one at a time (take the heavy lock around this script).
// Writes docs/measurements/law-bakeoff.json (metrics and run ids, never the models' quotes); raw answers go to --raw-dir (git-ignored).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { passagesFrom } from "./lib/bakeoff/corpus.mjs";
import { messagesFor, PROMPT_VERSION } from "./lib/bakeoff/prompt.mjs";
import { chatClient, costUsd, SEED } from "./lib/bakeoff/models.mjs";
import { scoreCase, aggregate, stability, decide } from "./lib/bakeoff/score.mjs";

const ENDPOINTS = { ollama: "http://localhost:11434/v1", do: "https://inference.do-ai.run/v1" };

export async function runBakeoff({ golden, prices, models, repeat, maxUsd, passagesFor, chatFor, onModel = () => {}, now = new Date() }) {
  let spent = 0;
  const out = [];
  const runIds = [];
  const stoppedAt = [];
  for (const { id, where } of models) {
    const chat = chatFor(where);
    const runs = [];
    for (const goldenCase of golden.cases) {
      const passages = passagesFor(goldenCase);
      for (let n = 1; n <= repeat; n++) {
        if (where !== "ollama" && spent >= maxUsd) {
          stoppedAt.push(`${id}/${goldenCase.id}/${n}`);
          continue;
        }
        let answer;
        try {
          answer = await chat({ model: id, messages: messagesFor(goldenCase.question, goldenCase.language, passages) });
        } catch (failure) {
          stoppedAt.push(`${id}/${goldenCase.id}/${n}: ${failure.message}`);
          continue;
        }
        const cost = where === "ollama" ? 0 : costUsd(answer.usage, prices.models[id]);
        spent += cost ?? 0;
        const score = scoreCase(goldenCase, passages, answer.text);
        const runId = createHash("sha256").update(`${PROMPT_VERSION}|${id}|${goldenCase.id}|${n}|${answer.text}`).digest("hex").slice(0, 10);
        runIds.push({ runId, model: id, caseId: goldenCase.id, n });
        runs.push({ caseId: goldenCase.id, language: goldenCase.language, score, ms: answer.ms, costUsd: cost, usage: answer.usage, text: answer.text });
      }
    }
    if (!runs.length) continue;
    const agg = aggregate(runs);
    out.push({ id, local: where === "ollama", aggregate: agg, stability: stability(runs), costPerRunUsd: agg.costUsd == null ? null : agg.costUsd / runs.length, runs });
    onModel(out.at(-1), spent);
  }
  const decision = decide(Object.fromEntries(out.map((m) => [m.id, m])));
  return {
    measuredOn: now.toISOString().slice(0, 10),
    promptVersion: PROMPT_VERSION,
    seed: SEED,
    cases: golden.cases.length,
    runsPerCase: repeat,
    priceDate: prices.priceDate,
    maxUsd,
    spentUsd: spent,
    stoppedAtCap: stoppedAt,
    models: out,
    decision,
    runIds,
    notMeasured: [],
  };
}

async function main() {
  const { values: v } = parseArgs({
    options: { "corpus-fr": { type: "string" }, "corpus-en": { type: "string" }, models: { type: "string" }, repeat: { type: "string", default: "2" }, "max-usd": { type: "string", default: "5" }, out: { type: "string", default: "docs/measurements/law-bakeoff.json" }, "raw-dir": { type: "string", default: "var/bakeoff" } },
  });
  const golden = JSON.parse(readFileSync(new URL("../docs/evaluations/law-bakeoff/law-retrieval.golden.json", import.meta.url), "utf8"));
  const prices = JSON.parse(readFileSync(new URL("../docs/evaluations/law-bakeoff/prices.json", import.meta.url), "utf8"));
  const corpus = { fr: v["corpus-fr"], en: v["corpus-en"] };
  const models = v.models.split(",").map((s) => {
    const [id, where] = s.split("@");
    return { id, where };
  });
  const cache = new Map();
  const passagesFor = (c) => {
    if (!cache.has(c.id)) {
      const refs = c.targets.flatMap((t) => t.refs);
      const decoy = c.decoys ?? [];
      cache.set(c.id, passagesFrom(corpus[c.language], c.targets[0].instrument, [...decoy, ...refs], c.language));
    }
    return cache.get(c.id);
  };
  const key = process.env.AI_INFERENCE_KEY;
  const chatFor = (where) => chatClient({ base: ENDPOINTS[where], apiKey: where === "do" ? key : undefined });
  if (models.some((m) => m.where === "do") && !key) throw new Error("AI_INFERENCE_KEY is not set (read it with tools/secret.sh, never print it)");
  mkdirSync(v["raw-dir"], { recursive: true });
  const onModel = (m, spent) => writeFileSync(`${v["raw-dir"]}/law-retrieval-partial-${m.id.replace(/[^\w.-]/gu, "_")}.json`, JSON.stringify({ model: m, spentUsd: spent }, null, 1));
  const result = await runBakeoff({ onModel, golden, prices, models, repeat: Number(v.repeat), maxUsd: Number(v["max-usd"]), passagesFor, chatFor });
  mkdirSync(v["raw-dir"], { recursive: true });
  writeFileSync(`${v["raw-dir"]}/law-retrieval-${result.measuredOn}.json`, JSON.stringify(result, null, 1));
  for (const m of result.models) for (const r of m.runs) delete r.text;
  writeFileSync(v.out, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ decision: result.decision, spentUsd: result.spentUsd, stoppedAtCap: result.stoppedAtCap }, null, 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
