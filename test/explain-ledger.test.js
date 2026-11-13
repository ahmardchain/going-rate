import { test } from "node:test";
import assert from "node:assert/strict";
import { explain, explanationFacts, onlyGivenNumbers, EXPLAINER_SYSTEM } from "../src/core/serv.js";
import { kiteTaskSummary, KITE_SUMMARY_MAX, buildCard } from "../src/core/rates.js";
import { ledgerRows, paidSummary, explorerUrl } from "../src/core/ledger.js";

const facts = explanationFacts({
  label: "Video generation", cue: "low", n: 8,
  ask: { per_tx_usd: 1, total_usd: 5, ttl_hours: 1 },
  rate: { per_tx_usd: 2.87, total_usd: 21.55, ttl_hours: 6 },
  suggestion: { per_tx_usd: 3.21, total_usd: 25.07, ttl_hours: 6 },
});
const servReturns = (sentence, sent = []) => async (_u, init) => {
  sent.push(JSON.parse(init.body));
  return new Response(JSON.stringify({ model: "gpt-6-luna", choices: [{ message: { content: JSON.stringify({ sentence }) }, finish_reason: "stop" }] }),
    { headers: { "x-openserv-request-id": "req-explain" } });
};

test("numbers check: only numbers from the facts pass", () => {
  assert.ok(onlyGivenNumbers("Asks $1.00 per payment; video usually needs $2.87, so $3.21 fits.", facts));
  assert.equal(onlyGivenNumbers("Asks $1.00; you should allow $4.50.", facts), false);
});

test("explain: keeps SERV's sentence when it only uses given numbers", async () => {
  const sent = [];
  const e = await explain(facts, "Make a video", { apiKey: "k", fetchImpl: servReturns("Video calls usually cost $2.87, above the $1.00 cap, so $3.21 per payment avoids a refused first call.", sent) });
  assert.equal(e.source, "serv");
  assert.equal(e.requestId, "req-explain");
  assert.equal(sent[0].messages[0].content, EXPLAINER_SYSTEM); // constant prompt, facts in the user message
  assert.equal(sent[0].model, "gpt-6-luna");
});

test("explain: falls back to the template when SERV invents a number", async () => {
  const e = await explain(facts, "Make a video", { apiKey: "k", fetchImpl: servReturns("Set the cap to $4.00 to be safe.") });
  assert.equal(e.source, "template");
  assert.ok(onlyGivenNumbers(e.text, facts));
});

test("explain: falls back when SERV is unreachable", async () => {
  const e = await explain(facts, "x", { apiKey: "k", fetchImpl: async () => { throw new Error("down"); } });
  assert.equal(e.source, "template");
});

test("kite task summary carries the going rate and stays within the limit", () => {
  const pool = [4, 5, 5, 6, 6, 7].map((t) => ({ task_type: "image-generation", per_tx_usd: t / 10, total_usd: t, ttl_hours: 2, outcome: "approved" }));
  const card = buildCard(pool, "image-generation", { per_tx_usd: 0.6, total_usd: 6, ttl_hours: 2 });
  card.label = "Image generation";
  const s = kiteTaskSummary("Make 15 blog header images", card);
  assert.match(s, /^Make 15 blog header images \| Going rate \(image generation, 6 approvals\): \$5\.50 total/);
  assert.match(s, /IN LINE$/);
  const long = kiteTaskSummary("x".repeat(500), card);
  assert.ok(long.length <= KITE_SUMMARY_MAX);
  assert.match(long, /IN LINE$/);
});

// Shape of a real kpass 6.13.2 x402_payment event (ids replaced); paid ones add a tx hash.
const event = (over = {}) => ({
  kind: "x402_payment", status: "completed", chain: "base", occurred_at: "2026-11-14T10:00:00Z", id: "activity_1",
  details: { transaction: { amount_raw: "1330000", chain_id: 8453, session_id: "s1", tx_hash: "0xabc",
    x402: { merchant_host: "api.x402video.com", request_url: "https://api.x402video.com/generate/seedance/custom", session_id: "s1" } } },
  ...over,
});

test("ledger: joins Kite payment events with local notes", () => {
  const rows = ledgerRows([event()], [{ request_url: "https://api.x402video.com/generate/seedance/custom", session_id: "s1", at: "2026-11-14T10:00:01Z",
    task_summary: "Teaser video", task_type: "video-generation", listed_usd: 0.98, service: "x402 Video Gateway" }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].charged_usd, 1.33);
  assert.equal(rows[0].listed_usd, 0.98);
  assert.equal(rows[0].task_type, "video-generation");
  assert.equal(rows[0].tx_url, "https://basescan.org/tx/0xabc");
});

test("ledger: free calls and other kinds", () => {
  const free = event({ chain: "kite", details: { transaction: { amount_raw: "0", chain_id: 2366, x402: { request_url: "https://k/v1/x" } } } });
  const rows = ledgerRows([free, { kind: "session_approval" }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].charged_usd, 0);
  assert.equal(rows[0].tx_url, null);
  assert.equal(explorerUrl("kite", 2366, "0x1"), "https://kitescan.ai/tx/0x1");
});

test("paid summary per task type", () => {
  const s = paidSummary([
    { task_type: "data-api-lookup", charged_usd: 0.01, at: "2026-11-14T10:00:00Z" },
    { task_type: "data-api-lookup", charged_usd: 0.007, at: "2026-11-14T11:00:00Z" },
    { task_type: null, charged_usd: 1 },
  ]);
  assert.deepEqual(Object.keys(s), ["data-api-lookup"]);
  assert.equal(s["data-api-lookup"].calls, 2);
  assert.equal(s["data-api-lookup"].charged_median, 0.0085);
  assert.equal(s["data-api-lookup"].last_paid_at, "2026-11-14T11:00:00Z");
});
