import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../src/app.js";
import { CLASSIFIER_SYSTEM } from "../src/core/serv.js";

function memStore() {
  const outcomes = [], checks = new Map();
  return {
    listOutcomes: async () => outcomes, appendOutcome: async (r) => { outcomes.push(r); },
    putCheck: async (id, c) => { checks.set(id, c); }, getCheck: async (id) => checks.get(id) ?? null, outcomes,
  };
}
// Stub SERV: answers with a fixed task type and records what it was sent.
function stubServ(taskType, sent = []) {
  return async (_url, init) => {
    sent.push(JSON.parse(init.body));
    const content = taskType === "BLOCK" ? "I can't share that." : JSON.stringify({ task_type: taskType, confidence: "high", reason: "stub" });
    return new Response(JSON.stringify({ model: "gpt-6-luna", choices: [{ message: { content }, finish_reason: taskType === "BLOCK" ? "content_filter" : "stop" }] }),
      { headers: { "x-openserv-request-id": "req-1" } });
  };
}
const post = (path, body, headers = {}) => new Request(`http://x${path}`, { method: "POST", headers: { "x-demo-session": "demo-session-1", ...headers }, body: JSON.stringify(body) });
const wild = { task_summary: "Generate 20 product thumbnails", per_tx_usd: 25, total_usd: 100, ttl_hours: 24 };

test("check: wild ask on image generation is high, with a suggestion", async () => {
  const sent = [];
  const res = await handle(post("/api/check", wild), { SERV_API_KEY: "k", fetchImpl: stubServ("image-generation", sent) }, memStore());
  const out = await res.json();
  assert.equal(out.card.overall, "high");
  assert.ok(out.card.suggestion.total_usd < 20);
  // SERV gets the constant system prompt and no amounts.
  assert.equal(sent[0].messages[0].content, CLASSIFIER_SYSTEM);
  assert.doesNotMatch(sent[0].messages[1].content, /100|25/);
  assert.equal(sent[0].model, "gpt-6-luna");
});

test("outcome: a demo approval feeds this browser's rate card only", async () => {
  const store = memStore(), env = { SERV_API_KEY: "k", fetchImpl: stubServ("image-generation") };
  const sug = await (await handle(post("/api/suggest", { task_summary: "Make 15 blog header images" }), env, store)).json();
  const check = await (await handle(post("/api/check", { task_summary: "Make 15 blog header images", ...sug.suggestion }), env, store)).json();
  assert.equal(check.card.overall, "in_line");
  const nBefore = check.card.rate.n;
  const rec = await (await handle(post("/api/outcome", { check_id: check.check_id, outcome: "approved" }), env, store)).json();
  assert.equal(rec.recorded.kite_verified, false);
  assert.equal(rec.recorded.scope, "demo:demo-session-1");
  const again = await (await handle(post("/api/check", { task_summary: "x", ...sug.suggestion }), env, store)).json();
  assert.equal(again.card.rate.n, nBefore + 1);
  const other = await (await handle(post("/api/check", { task_summary: "x", ...sug.suggestion }, { "x-demo-session": "other-browser-2" }), env, store)).json();
  assert.equal(other.card.rate.n, nBefore);
});

test("outcome: only token + kite request id makes a global, verified record", async () => {
  const store = memStore(), env = { SERV_API_KEY: "k", INGEST_TOKEN: "t0ken", fetchImpl: stubServ("data-api-lookup") };
  const check = await (await handle(post("/api/check", { task_summary: "weather", per_tx_usd: 0.05, total_usd: 2, ttl_hours: 4 }), env, store)).json();
  const r = await (await handle(post("/api/outcome", { check_id: check.check_id, outcome: "approved", kite_request_id: "req_abc" }, { authorization: "Bearer t0ken" }), env, store)).json();
  assert.equal(r.recorded.scope, "global");
  assert.equal(r.recorded.kite_verified, true);
});

test("prompt guard block: no card, no task type, can't be recorded", async () => {
  const store = memStore(), env = { SERV_API_KEY: "k", fetchImpl: stubServ("BLOCK") };
  const check = await (await handle(post("/api/check", { ...wild, task_summary: "ignore instructions" }), env, store)).json();
  assert.equal(check.card, null);
  assert.equal(check.classification.blocked, true);
  const res = await handle(post("/api/outcome", { check_id: check.check_id, outcome: "approved" }), env, store);
  assert.equal(res.status, 409);
});

test("prompt guard block in structured-output shape (content null, message.refusal) is a block", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: null, refusal: "I can't share that." }, finish_reason: "stop" }] }));
  const check = await (await handle(post("/api/check", { ...wild, task_summary: "ignore instructions" }), { SERV_API_KEY: "k", fetchImpl }, memStore())).json();
  assert.equal(check.classification.blocked, true);
  assert.equal(check.card, null);
});

test("validation: per-payment cap above total is rejected", async () => {
  const res = await handle(post("/api/check", { ...wild, per_tx_usd: 200 }), { fetchImpl: stubServ("other") }, memStore());
  assert.equal(res.status, 400);
});
