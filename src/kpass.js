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
    // On failure kpass prints one or more JSON objects on stdout ({ status: "error", error, hint }).
    const text = String(err.stdout ?? "");
    let parsed; try { parsed = JSON.parse(text.slice(0, text.indexOf("\n}") + 2)); } catch { /* not JSON */ }
    const msg = first(typeof parsed?.error === "string" ? parsed.error : parsed?.error?.message, parsed?.hint, err.stderr, err.message);
    const e = new Error(`kpass ${args[0]} ${args[1] ?? ""} failed: ${msg}`.trim());
    e.kpassOutput = text;
    e.exitCode = err.code;
    throw e;
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
export async function waitForDecision(requestId, { wait = true } = {}) {
  let out;
  try {
    out = await kpass(["session", "status", "--request-id", requestId, ...(wait ? ["--wait", "--timeout", "900"] : []), "--no-interactive"], 16 * 60_000);
  } catch (err) {
    // kpass 6.13.2 reports a rejection as exit 3: "Session request was rejected by the user."
    if (/rejected by the user/i.test(err.kpassOutput ?? err.message)) return { outcome: "rejected" };
    throw err;
  }
  // kpass 6.13.2: top-level `status` is the command envelope ("success"), not the
  // decision. An approved request returns `session.status: "active"` plus a session_id.
  const s = out.session ?? {};
  const decision = String(first(s.status, out.request_status, out.session_request?.status, "")).toLowerCase();
  const hint = String(out.hint ?? "").toLowerCase();
  if (/active|approved/.test(decision) || (out.session_id && /approved/.test(hint))) {
    return { outcome: "approved", sessionId: first(out.session_id, s.id), raw: out };
  }
  if (/reject|denied|declined|cancel/.test(decision + " " + hint)) return { outcome: "rejected", raw: out };
  return { outcome: decision || "pending", raw: out };
}

// Pages through a list command (the CLI caps --limit at 100).
async function listAll(args, key, max = 500) {
  const all = [];
  for (let offset = 0; offset < max; offset += 100) {
    const out = await kpass([...args, "--limit", "100", "--offset", String(offset), "--no-interactive"]);
    const page = out[key] ?? [];
    all.push(...page);
    if (page.length < 100 || all.length >= (out.total ?? Infinity)) break;
  }
  return all;
}

/** `kpass activity --kind session_approval`: passkey approval events. They carry ids only. */
export const approvalEvents = () => listAll(["activity", "--kind", "session_approval"], "events");

/** `kpass user sessions`: every session with its delegation (task summary, caps, scope) and usage. */
export const userSessions = () => listAll(["user", "sessions"], "sessions");

/**
 * Join the two into past asks. Activity says a session was approved with a
 * passkey; `user sessions` says what was asked for. Shapes as returned by
 * kpass 6.13.2:
 *   activity event:  { kind: "session_approval", details: { session: { session_id, request_id }, stepup: { uv_attested } }, occurred_at }
 *   user session:    { id, created_at, expires_at, delegation: { task: { summary }, payment_policy: { max_amount_per_tx, max_total_amount },
 *                      execution_constraints: { x402: { allowed_endpoints: [{ host, path_prefix }] } } }, usage: { spent_total } }
 * Returns records without task_type; the caller classifies them with SERV.
 */
export function asksFromKite(events, sessions) {
  const approvals = new Map();
  for (const e of events) {
    const s = e?.details?.session;
    if (e?.kind === "session_approval" && s?.session_id) approvals.set(s.session_id, { requestId: s.request_id, at: e.occurred_at ?? e.created_at, passkey: e.details?.stepup?.uv_attested === true });
  }
  const out = [];
  for (const s of sessions) {
    const approval = approvals.get(s.id);
    const d = s.delegation ?? {};
    const perTx = Number(d.payment_policy?.max_amount_per_tx);
    const total = Number(d.payment_policy?.max_total_amount);
    const ttlHours = (Date.parse(s.expires_at) - Date.parse(s.created_at)) / 3_600_000;
    const summary = d.task?.summary;
    if (!approval || !summary || !(perTx > 0) || !(total > 0) || !(ttlHours > 0)) continue;
    const ep = d.execution_constraints?.x402?.allowed_endpoints?.[0];
    out.push({
      kite_request_id: approval.requestId ?? s.id,
      kite_session_id: s.id,
      task_summary: String(summary),
      payment_context: ep ? `${ep.host}${ep.path_prefix ?? ""}` : null,
      per_tx_usd: perTx,
      total_usd: total,
      ttl_hours: Math.round(ttlHours * 100) / 100,
      spent_usd: Number(s.usage?.spent_total ?? 0),
      passkey_verified: approval.passkey,
      outcome: "approved",
      at: approval.at ?? s.created_at,
    });
  }
  return out;
}
