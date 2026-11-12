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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handle(request, env, kvStore(env.GOING_RATE));
    return env.ASSETS.fetch(request);
  },
};
