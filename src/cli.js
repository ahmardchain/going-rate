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
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { classify } from "./core/serv.js";
import { ledgerRows, paidSummary } from "./core/ledger.js";
import { listedPrice, quote } from "./catalog.js";
import * as kp from "./kpass.js";

const PAYMENT_NOTES = fileURLToPath(new URL("../data/payments.jsonl", import.meta.url));
const LEDGER_JSON = fileURLToPath(new URL("../public/ledger.json", import.meta.url));
const CONTRAST_JSON = fileURLToPath(new URL("../public/contrast.json", import.meta.url));
const VERIFIED_JSON = fileURLToPath(new URL("../data/verified-pool.json", import.meta.url));
const readJsonl = (p) => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const short = (v, n = 300) => { const s = typeof v === "string" ? v : JSON.stringify(v); return s.length > n ? s.slice(0, n) + "…" : s; };

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

const money = (v) => (v == null ? "?" : `$${Number(v) > 0 && Number(v) < 0.01 ? Number(v).toFixed(5).replace(/0+$/, "") : Number(v).toFixed(2)}`);
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
  if (c.explanation) {
    const by = c.explanation.source === "serv" ? `SERV Reasoning, ${c.serv.model}` : "template (SERV unavailable)";
    console.log(`│ Why (${by}): ${c.explanation.text}`);
  }
  if (c.serv?.classify_request_id) console.log(`│ SERV request ids: classify ${c.serv.classify_request_id}${c.serv.explain_request_id ? `, explain ${c.serv.explain_request_id}` : ""}`);
  console.log(`└${line}\n`);
}

async function askBody() {
  const task_summary = opt("summary");
  if (!task_summary) throw new Error("--summary is required");
  const payment_context = opt("context");
  if (opt("total")) {
    return { task_summary, payment_context, per_tx_usd: Number(opt("per-tx") ?? opt("total")), total_usd: Number(opt("total")), ttl_hours: kp.parseTtlHours(opt("ttl") ?? "1h") };
  }
  console.log("Asking at the going rate.");
  return { task_summary, payment_context, at_going_rate: true };
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
    const caps = check.ask ?? body; // at the going rate, the caps come from the same classification as the card
    if (!caps?.total_usd) throw new Error(`No going rate for this task (${check.error ?? check.classification?.error ?? "too few approvals"}). Pass --per-tx/--total/--ttl.`);
    Object.assign(body, caps);
    // The going rate travels in --task-summary, so it is on Kite's own approval screen.
    const taskSummary = check.card?.kite_task_summary ?? body.task_summary;
    console.log(`Task summary sent to Kite: ${taskSummary}`);
    const { requestId, approvalUrl } = await kp.createSession({ taskSummary, perTx: caps.per_tx_usd, total: caps.total_usd, ttlHours: caps.ttl_hours });
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

  // Several jobs at once: one going-rate session per job (all approval links up front),
  // then wait for each passkey decision, record it, and make the job's paid call.
  if (cmd === "run") {
    const jobs = JSON.parse(readFileSync(opt("jobs"), "utf8"));
    const asks = [];
    for (const job of jobs) {
      const payment_context = new URL(job.url).host;
      // One classification drives both the suggested caps and the card.
      const check = await call("/api/check", { task_summary: job.summary, payment_context, at_going_rate: true }, { "x-demo-session": "local-cli-check" });
      if (!check.card) { console.log(`skip "${job.summary}": ${check.error ?? check.classification?.error ?? "no going rate"}`); continue; }
      const caps = check.ask;
      const s = await kp.createSession({ taskSummary: check.card.kite_task_summary, perTx: caps.per_tx_usd, total: caps.total_usd, ttlHours: caps.ttl_hours });
      asks.push({ job, check, s });
      console.log(`\n[${asks.length}] ${check.card.label}: ${job.summary}\n    caps ${money(caps.per_tx_usd)}/payment, ${money(caps.total_usd)} total, ${caps.ttl_hours}h (${check.card.overall})\n    SERV: ${check.card.explanation?.text ?? "-"}\n    APPROVE: ${s.approvalUrl}`);
    }
    for (const { job, check, s } of asks) {
      const d = await kp.waitForDecision(s.requestId);
      console.log(`\n${job.summary}: ${d.outcome}`);
      if (d.outcome !== "approved" && d.outcome !== "rejected") continue;
      await call("/api/outcome", { check_id: check.check_id, outcome: d.outcome, kite_request_id: s.requestId }, { authorization: "Bearer local-cli" });
      if (d.outcome !== "approved") continue;
      const listed = await listedPrice(job.url).catch(() => null);
      const res = await kp.executePaid({ sessionId: d.sessionId, url: job.url, method: job.method ?? "POST", body: job.body, idempotencyKey: `going-rate-run-${s.requestId}` });
      appendFileSync(PAYMENT_NOTES, JSON.stringify({ at: new Date().toISOString(), task_summary: job.summary, task_type: check.classification.task_type,
        service: listed?.service ?? new URL(job.url).host, listed_usd: listed?.listed_usd ?? null, request_url: job.url, method: job.method ?? "POST",
        session_id: d.sessionId, ok: res.ok, code: res.code ?? null }) + "\n");
      console.log(res.ok ? `  paid: ${short(res.raw, 400)}` : `  refused: ${res.code ?? ""} ${res.message}`);
    }
    return;
  }

  // One real paid call from the current (or given) approved session, noted for the ledger.
  if (cmd === "pay") {
    const url = opt("url"), task_summary = opt("summary");
    if (!url || !task_summary) throw new Error("--url and --summary are required");
    const method = opt("method") ?? "POST";
    const body = opt("body") ? JSON.parse(opt("body")) : undefined;
    const sessionId = opt("session-id") ?? (await kp.currentSessionId());
    if (!sessionId) throw new Error("No approved session. Run going-rate ask first.");
    const [listed, cls] = await Promise.all([
      listedPrice(url).catch(() => null),
      classify({ taskSummary: task_summary, paymentContext: new URL(url).host }, { apiKey: env.SERV_API_KEY }),
    ]);
    console.log(`${cls.task_type ?? "unclassified"} · ${listed?.service ?? new URL(url).host} · listed ${listed?.listed_usd != null ? money(listed.listed_usd) : "?"}`);
    const res = await kp.executePaid({ sessionId, url, method, body, idempotencyKey: `going-rate-${crypto.randomUUID()}` });
    const note = { at: new Date().toISOString(), task_summary, task_type: cls.task_type ?? null, service: listed?.service ?? null, listed_usd: listed?.listed_usd ?? null,
      request_url: url, method, session_id: sessionId, ok: res.ok, code: res.code ?? null };
    appendFileSync(PAYMENT_NOTES, JSON.stringify(note) + "\n");
    console.log(res.ok ? `Paid. Response: ${short(res.raw)}` : `Refused by Kite: ${res.code ?? ""} ${res.message}`);
    return;
  }

  // Free price check: the merchant's 402 quote for one exact call, plus the catalog's listed price.
  if (cmd === "quote") {
    const url = opt("url");
    if (!url) throw new Error("--url is required");
    const body = opt("body") ? JSON.parse(opt("body")) : undefined;
    const [q, listed] = await Promise.all([quote(url, { method: opt("method") ?? "POST", body }), listedPrice(url).catch(() => null)]);
    console.log(`${listed?.service ?? new URL(url).host}: listed ${listed?.listed_usd != null ? money(listed.listed_usd) : "?"}, quoted ${q ? `${money(q.usd)} on ${q.network}` : "? (no x402 quote)"}`);
    return;
  }

  // Rebuild public/ledger.json from Kite's own payment history.
  if (cmd === "ledger") {
    const events = await kp.paymentEvents();
    const rows = ledgerRows(events, readJsonl(PAYMENT_NOTES));
    // Payments made outside `going-rate pay` have no note: SERV classifies them from
    // the paid URL and merchant host, and the catalog supplies the listed price.
    for (const r of rows) {
      if (!r.task_type && r.request_url) {
        const cls = await classify({ taskSummary: `Paid x402 call: ${r.request_url}`, paymentContext: r.merchant_host }, { apiKey: env.SERV_API_KEY });
        r.task_type = cls.task_type ?? null;
        r.classified_from = "request_url";
      }
      if (r.listed_usd == null && r.request_url) {
        const l = await listedPrice(r.request_url).catch(() => null);
        r.listed_usd = l?.listed_usd ?? null;
        r.service = l?.service ?? r.service;
      }
    }
    const ledger = { generated_at: new Date().toISOString(), source: "kpass activity --kind x402_payment", rows, by_type: paidSummary(rows) };
    writeFileSync(LEDGER_JSON, JSON.stringify(ledger, null, 1) + "\n");
    console.log(`${events.length} payment events from Kite, ${rows.length} ledger rows -> public/ledger.json`);
    // Export Kite-verified session decisions so the hosted rate card has them too.
    const verifiedRecords = (await store.listOutcomes()).filter((r) => r.kite_verified)
      .map(({ scope, ...r }) => r).sort((a, b) => String(a.at).localeCompare(String(b.at)));
    writeFileSync(VERIFIED_JSON, JSON.stringify({ note: "Real session decisions confirmed through Kite Passport (kpass session status / kpass user sessions). Not seeded.",
      updated_at: new Date().toISOString(), records: verifiedRecords }, null, 1) + "\n");
    console.log(`${verifiedRecords.length} Kite-verified session decisions -> data/verified-pool.json`);
    for (const r of rows) console.log(`  ${r.at}  ${String(r.task_type ?? "?").padEnd(17)} listed ${r.listed_usd ?? "?"}  charged ${r.charged_usd ?? "?"}  ${r.tx_url ?? r.tx_hash ?? "(no tx hash)"}`);
    return;
  }

  // Same task, two asks: the docs-example caps ($1 per payment, $5 total) vs Going Rate's suggestion.
  if (cmd === "contrast") {
    const url = opt("url"), task_summary = opt("summary");
    if (!url || !task_summary) throw new Error("--url and --summary are required");
    const method = opt("method") ?? "POST";
    const body = opt("body") ? JSON.parse(opt("body")) : undefined;
    // The merchant's own quote for this exact call (free, unpaid 402). It must be above $1,
    // or the docs-example cap would not fail and the demo would just spend money.
    const q = await quote(url, { method, body });
    const price = q?.usd ?? Number(opt("price"));
    if (!(price > 1)) throw new Error(`This call is quoted at ${price ? money(price) : "an unknown price"}; it must be above $1 for the $1 cap to fail.`);
    console.log(`Merchant quote for this exact call: ${money(price)}${q?.network ? ` on ${q.network}` : ""}`);
    const result = { task_summary, url, quoted_price_usd: price, phases: [] };

    for (const phase of ["docs_default", "going_rate"]) {
      const payment_context = new URL(url).host;
      const check = phase === "docs_default"
        ? await call("/api/check", { task_summary, payment_context, per_tx_usd: 1, total_usd: 5, ttl_hours: 1 }, { "x-demo-session": "local-cli-check" })
        : await call("/api/check", { task_summary, payment_context, at_going_rate: true }, { "x-demo-session": "local-cli-check" });
      const caps = check.ask;
      if (!caps || !check.card) throw new Error(`No going rate for this task (${check.error ?? check.classification?.error ?? "unknown"}).`);
      console.log(`\n=== ${phase === "docs_default" ? "Docs-example caps ($1 / $5)" : "Going Rate's suggested caps"} ===`);
      printCard(check);
      const taskSummary = phase === "going_rate" ? check.card?.kite_task_summary ?? task_summary : task_summary;
      const s = await kp.createSession({ taskSummary, perTx: caps.per_tx_usd, total: caps.total_usd, ttlHours: caps.ttl_hours });
      console.log(`Approve with your passkey: ${s.approvalUrl}\nWaiting for your decision...`);
      const d = await kp.waitForDecision(s.requestId);
      const entry = { phase, caps, kite_task_summary: taskSummary, cue: check.card?.overall ?? null, explanation: check.card?.explanation ?? null,
        serv: check.card?.serv ?? null, kite_request_id: s.requestId, decision: d.outcome, session_id: d.sessionId ?? null, at: new Date().toISOString() };
      if (d.outcome === "approved") {
        await call("/api/outcome", { check_id: check.check_id, outcome: "approved", kite_request_id: s.requestId }, { authorization: "Bearer local-cli" });
        const res = await kp.executePaid({ sessionId: d.sessionId, url, method, body, idempotencyKey: `going-rate-contrast-${phase}-${s.requestId}` });
        Object.assign(entry, { paid: res.ok, kite_error: res.code ?? null, kite_message: res.ok ? null : res.message, response: res.ok ? short(res.raw, 800) : null, paid_at: new Date().toISOString() });
        appendFileSync(PAYMENT_NOTES, JSON.stringify({ at: entry.paid_at, task_summary, task_type: check.classification.task_type, service: opt("service") ?? new URL(url).host,
          listed_usd: price, request_url: url, method, session_id: d.sessionId, ok: res.ok, code: res.code ?? null }) + "\n");
        console.log(res.ok ? `First paid call succeeded.` : `First paid call refused by Kite: ${res.code ?? res.message}`);
      }
      result.phases.push(entry);
    }
    result.generated_at = new Date().toISOString();
    writeFileSync(CONTRAST_JSON, JSON.stringify(result, null, 1) + "\n");
    console.log("\nWrote public/contrast.json. Run `going-rate ledger` to add the transaction.");
    return;
  }

  if (cmd === "record") {
    // Record the passkey decision for an existing request, e.g. if `ask` was interrupted.
    const requestId = opt("request-id");
    if (!requestId) throw new Error("--request-id is required");
    const body = await askBody();
    const decision = await kp.waitForDecision(requestId, { wait: false });
    if (decision.outcome !== "approved" && decision.outcome !== "rejected") throw new Error(`Request is ${decision.outcome}, nothing to record yet.`);
    const check = await call("/api/check", body, { "x-demo-session": "local-cli-check" });
    if (!check.card) throw new Error(check.classification.error);
    await call("/api/outcome", { check_id: check.check_id, outcome: decision.outcome, kite_request_id: requestId }, { authorization: "Bearer local-cli" });
    console.log(`Kite says ${decision.outcome}. Recorded under ${check.card.label}.`);
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
