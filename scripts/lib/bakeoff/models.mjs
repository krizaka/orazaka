// Candidates are called through the OpenAI-compatible chat API they all speak: local Ollama (the sovereign baseline) and DigitalOcean serverless inference. Sampling is fixed (temperature 0,
// a seed) where the provider honours it. Prices are per million tokens, from docs/evaluations/law-bakeoff/prices.json; a model without a price is reported without a dollar figure, never with a guess.
export const SEED = 20261026;

export function chatClient({ base, apiKey, fetchImpl = fetch }) {
  return async function chat({ model, messages, maxTokens = 2048, timeoutMs = 180_000 }) {
    const started = performance.now();
    const response = await fetchImpl(`${base.replace(/\/$/u, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({ model, messages, temperature: 0, seed: SEED, max_tokens: maxTokens, stream: false }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ms = Math.round(performance.now() - started);
    if (!response.ok) throw new Error(`${model}: HTTP ${response.status}`);
    const json = await response.json();
    return {
      text: json.choices?.[0]?.message?.content ?? "",
      usage: { promptTokens: json.usage?.prompt_tokens ?? 0, completionTokens: json.usage?.completion_tokens ?? 0 },
      ms,
    };
  };
}

/** What a call cost in dollars at the model's price, or null when no price is recorded. */
export function costUsd(usage, price) {
  if (!price) return null;
  return (usage.promptTokens * price.inputPerMillion + usage.completionTokens * price.outputPerMillion) / 1_000_000;
}
