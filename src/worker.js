// Cloudflare Worker entry. Static files in public/ are served by Workers
// static assets; /api/* goes to the shared handler with a KV-backed store.
import { handle } from "./app.js";

const MAX_OUTCOMES = 5000;

function kvStore(kv) {
  return {
    // One key holds the outcome list: KV reads after a write in the same
    // location are immediate, so the card updates right after a decision.
    async listOutcomes() {
      return (await kv.get("outcomes", "json")) ?? [];
    },
    async appendOutcome(record) {
      const list = (await kv.get("outcomes", "json")) ?? [];
      list.push(record);
      await kv.put("outcomes", JSON.stringify(list.slice(-MAX_OUTCOMES)));
    },
    putCheck: (id, check) => kv.put(`check:${id}`, JSON.stringify(check), { expirationTtl: 86400 }),
    getCheck: (id) => kv.get(`check:${id}`, "json"),
  };
}

// Fallback if the KV binding is missing: outcomes live only as long as this
// isolate, so the demo still works but decisions don't persist.
const memory = { outcomes: [], checks: new Map() };
const memoryStore = {
  listOutcomes: async () => memory.outcomes,
  appendOutcome: async (r) => { memory.outcomes.push(r); memory.outcomes.splice(0, memory.outcomes.length - MAX_OUTCOMES); },
  putCheck: async (id, c) => { memory.checks.set(id, c); },
  getCheck: async (id) => memory.checks.get(id) ?? null,
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handle(request, env, env.GOING_RATE ? kvStore(env.GOING_RATE) : memoryStore);
    return env.ASSETS.fetch(request);
  },
};
