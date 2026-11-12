// Thin wrapper around the live Kite Passport CLI (https://docs.gokite.ai/reference/kpass-cli).
// Only uses commands that exist today: session create / status, activity.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const first = (...v) => v.find((x) => x !== undefined && x !== null && x !== "");

async function kpass(args, timeoutMs = 120_000) {
  try {
    const { stdout } = await run("kpass", [...args, "--output", "json"], { timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch (err) {
    if (err.code === "ENOENT") throw new Error("kpass not found. Install: curl -fsSL https://cli.gokite.ai/install.sh | bash");
    let parsed; try { parsed = JSON.parse(err.stdout); } catch { /* not JSON */ }
    throw new Error(`kpass ${args[0]} ${args[1] ?? ""} failed: ${first(parsed?.error?.code, parsed?.code, "")} ${first(parsed?.error?.hint, parsed?.hint, err.stderr, err.message)}`.trim());
  }
}

export function parseTtlHours(v) {
  if (typeof v === "number") return v;
  const m = /^(\d+(?:\.\d+)?)\s*([smhd])?$/i.exec(String(v ?? "").trim());
  if (!m) return null;
  const n = Number(m[1]);
  return { s: n / 3600, m: n / 60, h: n, d: n * 24 }[(m[2] || "h").toLowerCase()];
}

/** kpass session create — returns { requestId, approvalUrl }. */
export async function createSession({ taskSummary, perTx, total, ttlHours }) {
  const out = await kpass([
    "session", "create",
    "--task-summary", taskSummary,
    "--max-amount-per-tx", String(perTx),
    "--max-total-amount", String(total),
    "--ttl", `${Math.max(1, Math.round(ttlHours))}h`,
    "--assets", "USDC",
    // Always a separately passkey-approved session: without --separate, kpass may
    // pay from the account allowance and no approval (and no going-rate card) happens.
    "--separate",
    "--no-reuse",
    "--no-browser",
    "--no-interactive",
  ]);
  const d = out.data ?? out;
  return { requestId: first(d.request_id, d.requestId, d.id), approvalUrl: first(d.approval_url, d.approvalUrl, d.url), raw: out };
}

/** kpass session status --wait — blocks until the passkey decision. Returns "approved" | "rejected" | other. */
export async function waitForDecision(requestId) {
  const out = await kpass(["session", "status", "--request-id", requestId, "--wait", "--timeout", "900", "--no-interactive"], 16 * 60_000);
  const d = out.data ?? out;
  const status = String(first(d.status, d.state, d.session?.status, "unknown")).toLowerCase();
  if (/active|approved/.test(status)) return { outcome: "approved", sessionId: first(d.session_id, d.sessionId, d.session?.id), raw: out };
  if (/reject|denied|declined|cancel/.test(status)) return { outcome: "rejected", raw: out };
  return { outcome: status, raw: out };
}

/** kpass activity --kind session_approval — raw events (the CLI caps --limit at 100). */
export async function activity({ limit = 100, offset = 0 } = {}) {
  const args = ["activity", "--kind", "session_approval", "--limit", String(Math.min(limit, 100)), "--offset", String(offset)];
  const out = await kpass(args);
  return Array.isArray(out) ? out : first(out.events, out.data, out.items, out.activity) ?? [];
}

/**
 * Turn activity events into past asks. Kite documents the command but not the
 * event schema, so this reads defensively and skips anything it can't map.
 * Returns records without task_type; the caller classifies them with SERV.
 */
export function sessionAsksFromActivity(events) {
  const out = [];
  for (const e of events) {
    const kind = String(first(e.kind, e.type, e.event, e.action, "")).toLowerCase();
    if (!/session/.test(kind)) continue;
    const s = e.session ?? e.data ?? e.details ?? e;
    const outcome = /approv|activ/.test(kind) ? "approved" : /reject|deni|declin/.test(kind) ? "rejected" : null;
    const total = Number(first(s.max_total_amount, s.maxTotalAmount, s.total_limit, s.budget));
    const perTx = Number(first(s.max_amount_per_tx, s.maxAmountPerTx, s.per_tx_limit));
    const ttlHours = parseTtlHours(first(s.ttl, s.ttl_hours));
    const summary = first(s.task_summary, s.taskSummary, s.summary, s.description);
    if (!outcome || !summary || !(total > 0) || !(perTx > 0) || !(ttlHours > 0)) continue;
    out.push({ kite_request_id: first(s.request_id, s.id, e.id), task_summary: String(summary), per_tx_usd: perTx, total_usd: total, ttl_hours: ttlHours, outcome, at: first(e.created_at, e.timestamp, e.at) });
  }
  return out;
}
