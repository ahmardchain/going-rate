import { test } from "node:test";
import assert from "node:assert/strict";
import { asksFromKite, parseTtlHours } from "../src/kpass.js";

test("parseTtlHours", () => {
  assert.equal(parseTtlHours("24h"), 24);
  assert.equal(parseTtlHours("90m"), 1.5);
  assert.equal(parseTtlHours("2d"), 48);
  assert.equal(parseTtlHours("3"), 3);
  assert.equal(parseTtlHours("soon"), null);
});

// Shapes copied from real kpass 6.13.2 output (ids replaced).
const approval = (sessionId) => ({
  kind: "session_approval", category: "security", occurred_at: "2026-09-30T10:19:38.925Z", status: "completed",
  details: {
    session: { agent_id: "agent_x", request_id: `req_${sessionId}`, session_id: sessionId, session_type: "dedicated" },
    stepup: { action_type: "agent_session.approve", uv_attested: true },
  },
});
const session = (id, extra = {}) => ({
  id, status: "expired", type: "dedicated", created_at: "2026-09-30T10:19:38.920Z", expires_at: "2026-09-30T11:19:38.920Z",
  delegation: {
    execution_constraints: { x402: { allowed_endpoints: [{ host: "kite-services.kiteai.dev", method: "POST", path_prefix: "/v1/image/edits" }], scope_mode: "scoped" } },
    payment_policy: { currency: "USD", max_amount_per_tx: "0.01", max_total_amount: "0.05" },
    task: { summary: "Generate a PFP from my photo" },
  },
  usage: { spent_total: "0" },
  ...extra,
});

test("joins approval events with user sessions into past asks", () => {
  const asks = asksFromKite([approval("s1")], [session("s1")]);
  assert.deepEqual(asks, [{
    kite_request_id: "req_s1", kite_session_id: "s1", task_summary: "Generate a PFP from my photo",
    payment_context: "kite-services.kiteai.dev/v1/image/edits", per_tx_usd: 0.01, total_usd: 0.05, ttl_hours: 1,
    spent_usd: 0, passkey_verified: true, outcome: "approved", at: "2026-09-30T10:19:38.925Z",
  }]);
});

test("skips sessions with no approval event, and approvals with no session details", () => {
  assert.equal(asksFromKite([], [session("s1")]).length, 0);
  assert.equal(asksFromKite([approval("s2")], [session("s1")]).length, 0);
  const noCaps = session("s3", { delegation: { task: { summary: "x" } } });
  assert.equal(asksFromKite([approval("s3")], [noCaps]).length, 0);
});
