// Platform-neutral request handler, shared by the Cloudflare Worker and the
// local Node dev server. `store` abstracts where outcomes live (KV or a file).
import seed from "../data/seed-pool.json" with { type: "json" };
import { classify, SERV_MODEL } from "./core/serv.js";
import { buildCard, goingRate, suggestedCaps } from "./core/rates.js";
import { TASK_TYPES, labelFor } from "./core/taxonomy.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

const num = (v, name, max) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > max) throw new RangeError(`${name} must be a number between 0 and ${max}`);
  return Math.round(n * 100) / 100;
};

// Demo outcomes are scoped to one browser so public visitors don't skew each
// other's rate card. Outcomes confirmed through `kpass session status` are global.
const scopeFor = (sid) => (sid && /^[a-z0-9-]{8,64}$/i.test(sid) ? `demo:${sid}` : null);

async function pool(store, sid) {
  const scope = scopeFor(sid);
  const outcomes = (await store.listOutcomes()).filter((r) => r.scope === "global" || (scope && r.scope === scope));
  return [...seed.records, ...outcomes];
}

function provenance(records, taskType) {
  const approved = records.filter((r) => r.task_type === taskType && r.outcome === "approved");
  return {
    seeded: approved.filter((r) => r.seeded).length,
    demo_clicks: approved.filter((r) => r.scope?.startsWith("demo:")).length,
    kite_verified: approved.filter((r) => r.kite_verified).length,
  };
}

async function classifyOrFail(body, env) {
  const task_summary = String(body.task_summary ?? "").trim().slice(0, 500);
  if (!task_summary) throw new RangeError("task_summary is required");
  const payment_context = body.payment_context ? String(body.payment_context).slice(0, 200) : null;
  const classification = await classify({ taskSummary: task_summary, paymentContext: payment_context }, { apiKey: env.SERV_API_KEY, fetchImpl: env.fetchImpl });
  return { task_summary, payment_context, classification };
}

export async function handle(request, env, store) {
  const url = new URL(request.url);
  const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
  const sid = request.headers.get("x-demo-session") || body.demo_session;

  try {
    if (url.pathname === "/api/config") {
      return json({ model: SERV_MODEL, task_types: TASK_TYPES, seed_note: seed.note, seed_records: seed.records.length });
    }

    // The rate card for every task type.
    if (url.pathname === "/api/rates") {
      const records = await pool(store, sid);
      return json(TASK_TYPES.map((t) => {
        const r = goingRate(records, t.id);
        return { task_type: t.id, label: t.label, n: r.n, enough: r.enough, provenance: provenance(records, t.id),
          median: { per_tx_usd: r.per_tx_usd.median, total_usd: r.total_usd.median, ttl_hours: r.ttl_hours.median },
          suggestion: suggestedCaps(r) };
      }));
    }

    // Before asking: classify the task and return caps that land in line.
    if (url.pathname === "/api/suggest" && request.method === "POST") {
      const { task_summary, classification } = await classifyOrFail(body, env);
      if (!classification.ok) return json({ task_summary, classification, suggestion: null });
      const records = await pool(store, sid);
      return json({ task_summary, classification, label: labelFor(classification.task_type), suggestion: suggestedCaps(goingRate(records, classification.task_type)) });
    }

    // The approval card: requested caps vs the going rate for this task type.
    if (url.pathname === "/api/check" && request.method === "POST") {
      const ask = {
        per_tx_usd: num(body.per_tx_usd, "per_tx_usd", 10_000),
        total_usd: num(body.total_usd, "total_usd", 100_000),
        ttl_hours: num(body.ttl_hours, "ttl_hours", 24 * 30),
      };
      if (ask.per_tx_usd > ask.total_usd) throw new RangeError("per_tx_usd can't exceed total_usd");
      const { task_summary, payment_context, classification } = await classifyOrFail(body, env);
      const check_id = crypto.randomUUID();
      const check = { check_id, task_summary, payment_context, ask, classification, at: new Date().toISOString() };
      if (!classification.ok) {
        await store.putCheck(check_id, check);
        return json({ ...check, card: null });
      }
      const records = await pool(store, sid);
      const card = buildCard(records, classification.task_type, ask);
      card.label = labelFor(classification.task_type);
      card.provenance = provenance(records, classification.task_type);
      await store.putCheck(check_id, check);
      return json({ ...check, card });
    }

    // After the passkey: record approved / rejected so the rate updates.
    if (url.pathname === "/api/outcome" && request.method === "POST") {
      const outcome = body.outcome;
      if (!["approved", "rejected"].includes(outcome)) throw new RangeError('outcome must be "approved" or "rejected"');
      const check = await store.getCheck(String(body.check_id ?? ""));
      if (!check) return json({ error: "unknown check_id" }, 404);
      if (!check.classification.ok) return json({ error: "this check has no task type, so it can't feed the rate card" }, 409);

      // Global (pooled) outcomes require the ingest token and a Kite request id,
      // i.e. they come from the CLI after `kpass session status`. Everything else is a demo click.
      const verified = Boolean(env.INGEST_TOKEN) && request.headers.get("authorization") === `Bearer ${env.INGEST_TOKEN}` && Boolean(body.kite_request_id);
      const scope = verified ? "global" : scopeFor(sid);
      if (!scope) throw new RangeError("demo outcomes need a demo session id");

      const record = {
        id: crypto.randomUUID(), task_type: check.classification.task_type, task_summary: check.task_summary,
        ...check.ask, outcome, source: verified ? "kpass-session" : "going-rate-demo", seeded: false,
        kite_verified: verified, kite_request_id: verified ? String(body.kite_request_id) : undefined,
        scope, at: new Date().toISOString(),
      };
      await store.appendOutcome(record);
      return json({ recorded: record });
    }

    return json({ error: "not found" }, 404);
  } catch (err) {
    if (err instanceof RangeError) return json({ error: err.message }, 400);
    return json({ error: "internal error", detail: err.message }, 500);
  }
}
