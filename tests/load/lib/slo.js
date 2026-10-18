// The SLO of each endpoint class (ADR-083 §Capacity). A threshold here is a promise of the
// platform: it was written before the first measurement and is only ever changed by a new ADR.
// Latencies are in milliseconds, measured by the client, through the edge.
export const SLO = {
  // Sync API: a read or a small command answered from the database (studios, profile, run read).
  syncApiP95: 300,
  syncApiErrorRate: 0.01,
  // Sign-in: bcrypt makes it slow on purpose.
  loginP95: 800,
  // Starting a run: validate, hold credits (HTTP to billing), persist, dispatch. The answer is a 202,
  // never the result. M0 measured the saga alone at p95 30 ms; the rest is the hold and the network.
  runStartP95: 1000,
  // Chat: time to the first token of the answer (the first `delta` frame), measured by chat-ttft.mjs.
  chatFirstTokenP95: 2000,
  // Chat: the whole stream for a short answer (k6 cannot see inside a stream).
  chatShortAnswerP95: 8000,
};
