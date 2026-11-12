#!/usr/bin/env node
// going-rate CLI. An agent runs this before `kpass session create`.
//
//   going-rate check  --summary "..." --per-tx 25 --total 100 --ttl 24h [--context host]
//   going-rate ask    --summary "..." [--per-tx .. --total .. --ttl ..] [--context host]
//                     Shows the card, asks Kite for the session, waits for the
//                     passkey decision, records the outcome. Without caps it asks
//                     at the going rate's suggested caps.
//   going-rate sync   Joins `kpass activity --kind session_approval` with `kpass user sessions`
//                     and adds your approved asks to the local pool.
//
// Env: SERV_API_KEY (required). GOING_RATE_URL + INGEST_TOKEN (optional) also
// send verified outcomes to a hosted pool.
import { fileURLToPath } from "node:url";
import { handle } from "./app.js";
import { fileStore } from "./store-file.js";
import { classify } from "./core/serv.js";
import * as kp from "./kpass.js";

const store = fileStore(fileURLToPath(new URL("../data/outcomes.local.jsonl", import.meta.url)));
// Locally the CLI is the trusted writer: outcomes it records come from `kpass session status`.
const env = { SERV_API_KEY: process.env.SERV_API_KEY, INGEST_TOKEN: "local-cli" };
const [cmd, ...rest] = process.argv.slice(2);
const opt = (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };

const call = async (path, body, headers = {}) => {
  const res = await handle(new Request(`http://local${path}`, { method: "POST", headers, body: JSON.stringify(body) }), env, store);
  const out = await res.json();
  if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
  return out;
};

const money = (v) => (v == null ? "?" : `$${Number(v).toFixed(2)}`);
const CUE = { high: "HIGH", low: "LOW", in_line: "IN LINE", unknown: "NO RATE YET" };

function printCard(check) {
  const c = check.card;
  const line = "─".repeat(56);
  console.log(`\n┌─ Going Rate ${line.slice(13)}`);
  console.log(`│ Task: ${check.task_summary}`);
  if (!c) { console.log(`│ ${check.classification.error}`); console.log(`└${line}\n`); return; }
  console.log(`│ Type: ${c.label}  (SERV, ${check.classification.confidence} confidence)`);
  console.log(`│ ${"".padEnd(13)}${"you ask".padEnd(11)}${"going rate".padEnd(12)}cue`);
  const rows = [["per_tx_usd", "Per payment", money], ["total_usd", "Total", money], ["ttl_hours", "Duration", (v) => `${Math.round(v)}h`]];
  for (const [k, name, fmt] of rows) {
    const d = c.dims[k];
    const x = d.x_median && d.cue !== "in_line" ? ` (${d.x_median}x)` : "";
    console.log(`│ ${name.padEnd(13)}${fmt(d.requested).padEnd(11)}${(d.median == null ? "-" : fmt(d.median)).padEnd(12)}${CUE[d.cue]}${x}`);
  }
  console.log(`│ Overall: ${CUE[c.overall]}`);
  for (const n of c.notes) console.log(`│ · ${n}`);
  if (c.suggestion && c.overall !== "in_line") {
    console.log(`│ Suggested: ${money(c.suggestion.per_tx_usd)} per payment, ${money(c.suggestion.total_usd)} total, ${c.suggestion.ttl_hours}h`);
  }
  console.log(`└${line}\n`);
}

async function askBody() {
  const task_summary = opt("summary");
  if (!task_summary) throw new Error("--summary is required");
  const payment_context = opt("context");
  if (opt("total")) {
    return { task_summary, payment_context, per_tx_usd: Number(opt("per-tx") ?? opt("total")), total_usd: Number(opt("total")), ttl_hours: kp.parseTtlHours(opt("ttl") ?? "1h") };
  }
  const sug = await call("/api/suggest", { task_summary, payment_context });
  if (!sug.suggestion) throw new Error(`No going rate for this task (${sug.classification.error ?? "too few approvals"}). Pass --per-tx/--total/--ttl.`);
  console.log(`Asking at the going rate for ${sug.label}.`);
  return { task_summary, payment_context, ...sug.suggestion };
}

async function pushRemote(record) {
  if (!process.env.GOING_RATE_URL || !process.env.INGEST_TOKEN) return;
  // The hosted pool classifies with the same constant SERV prompt, so the bucket matches.
  const h = { "Content-Type": "application/json", authorization: `Bearer ${process.env.INGEST_TOKEN}` };
  const check = await (await fetch(`${process.env.GOING_RATE_URL}/api/check`, { method: "POST", headers: h, body: JSON.stringify(record) })).json();
  await fetch(`${process.env.GOING_RATE_URL}/api/outcome`, { method: "POST", headers: h, body: JSON.stringify({ check_id: check.check_id, outcome: record.outcome, kite_request_id: record.kite_request_id }) });
}

async function main() {
  if (!process.env.SERV_API_KEY) throw new Error("Set SERV_API_KEY (keys at https://console.openserv.ai/settings/keys)");

  if (cmd === "check") {
    printCard(await call("/api/check", await askBody(), { "x-demo-session": "local-cli-check" }));
    return;
  }

  if (cmd === "ask") {
    const body = await askBody();
    const check = await call("/api/check", body, { "x-demo-session": "local-cli-check" });
    printCard(check);
    const { requestId, approvalUrl } = await kp.createSession({ taskSummary: body.task_summary, perTx: body.per_tx_usd, total: body.total_usd, ttlHours: body.ttl_hours });
    console.log(`Approve with your passkey: ${approvalUrl}\nWaiting for your decision...`);
    const decision = await kp.waitForDecision(requestId);
    console.log(`Kite says: ${decision.outcome}`);
    if (check.card && (decision.outcome === "approved" || decision.outcome === "rejected")) {
      await call("/api/outcome", { check_id: check.check_id, outcome: decision.outcome, kite_request_id: requestId }, { authorization: "Bearer local-cli" });
      await pushRemote({ ...body, outcome: decision.outcome, kite_request_id: requestId }).catch((e) => console.warn(`hosted pool not updated: ${e.message}`));
      console.log("Recorded. The rate card now includes this decision.");
    }
    return;
  }

  if (cmd === "sync") {
    // Approvals come from `kpass activity`; what was asked for comes from `kpass user sessions`.
    const [events, sessions] = await Promise.all([kp.approvalEvents(), kp.userSessions()]);
    const asks = kp.asksFromKite(events, sessions);
    const known = new Set((await store.listOutcomes()).map((r) => r.kite_request_id).filter(Boolean));
    let added = 0;
    for (const a of asks) {
      if (known.has(a.kite_request_id)) continue;
      const cls = await classify({ taskSummary: a.task_summary, paymentContext: a.payment_context }, { apiKey: env.SERV_API_KEY });
      if (!cls.ok) { console.log(`  skipped "${a.task_summary}": ${cls.error}`); continue; }
      await store.appendOutcome({ id: crypto.randomUUID(), task_type: cls.task_type, ...a, source: "kpass-activity", seeded: false, kite_verified: true, scope: "global" });
      console.log(`  + ${cls.task_type.padEnd(17)} $${a.per_tx_usd}/payment, $${a.total_usd} total, ${a.ttl_hours}h  "${a.task_summary}"`);
      added++;
    }
    console.log(`Read ${events.length} approval events and ${sessions.length} sessions from Kite; ${asks.length} approved asks matched, ${added} new added to the pool.`);
    return;
  }

  console.log("Usage: going-rate check|ask|sync  (see the header of src/cli.js)");
}

main().catch((e) => { console.error(`going-rate: ${e.message}`); process.exit(1); });
