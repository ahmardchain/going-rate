import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionAsksFromActivity, parseTtlHours } from "../src/kpass.js";

test("parseTtlHours", () => {
  assert.equal(parseTtlHours("24h"), 24);
  assert.equal(parseTtlHours("90m"), 1.5);
  assert.equal(parseTtlHours("2d"), 48);
  assert.equal(parseTtlHours("3"), 3);
  assert.equal(parseTtlHours("soon"), null);
});

// Kite documents `kpass activity` but not its event schema, so the reader is
// defensive: it maps session approve/reject events it can read and skips the rest.
test("activity: keeps readable session decisions, skips everything else", () => {
  const events = [
    { kind: "agent_session.approved", id: "evt1", created_at: "2026-11-10T10:00:00Z",
      session: { request_id: "req_1", task_summary: "Make 8 blog images", max_amount_per_tx: "0.5", max_total_amount: "5", ttl: "2h" } },
    { type: "session_rejected", data: { id: "req_2", taskSummary: "Crawl 500 pages", maxAmountPerTx: 2, maxTotalAmount: 300, ttl: "7d" } },
    { kind: "payment.completed", amount: 0.01 },                               // not a session decision
    { kind: "agent_session.approved", session: { task_summary: "No caps" } },  // unreadable caps
  ];
  const asks = sessionAsksFromActivity(events);
  assert.equal(asks.length, 2);
  assert.deepEqual(asks[0], { kite_request_id: "req_1", task_summary: "Make 8 blog images", per_tx_usd: 0.5, total_usd: 5, ttl_hours: 2, outcome: "approved", at: "2026-11-10T10:00:00Z" });
  assert.equal(asks[1].outcome, "rejected");
  assert.equal(asks[1].ttl_hours, 168);
});
