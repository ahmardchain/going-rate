// The going rate is ordinary arithmetic over past approvals. SERV never sees
// or produces any number here; it only supplies the task type.
//
// Record shape (one past session ask):
// { id, task_type, task_summary, per_tx_usd, total_usd, ttl_hours,
//   outcome: "approved" | "rejected", source: "seed" | "kpass-activity" | "going-rate",
//   seeded: boolean, at: ISO date }

export const MIN_SAMPLE = 5;      // fewer approvals than this and we say so instead of guessing
const LOW_FACTOR = 0.8;           // below 80% of the 25th percentile counts as low
const HIGH_FACTOR = 1.25;         // above 125% of the 75th percentile counts as high
const FIELDS = ["per_tx_usd", "total_usd", "ttl_hours"];

/** Percentile with linear interpolation. `sorted` must be ascending. */
export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function stats(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  return { p25: percentile(sorted, 0.25), median: percentile(sorted, 0.5), p75: percentile(sorted, 0.75) };
}

/** The going rate for one task type, from approved asks only. */
export function goingRate(records, taskType) {
  const ofType = records.filter((r) => r.task_type === taskType);
  const approved = ofType.filter((r) => r.outcome === "approved");
  const rate = {
    task_type: taskType,
    n: approved.length,
    seeded: approved.filter((r) => r.seeded).length,
    rejected: ofType.length - approved.length,
    enough: approved.length >= MIN_SAMPLE,
  };
  for (const f of FIELDS) rate[f] = stats(approved.map((r) => r[f]));
  return rate;
}

/** "low" | "in_line" | "high" for one requested value against its stats. */
export function cue(value, s) {
  if (s?.median == null || !Number.isFinite(value)) return "unknown";
  if (value > s.p75 * HIGH_FACTOR) return "high";
  if (value < s.p25 * LOW_FACTOR) return "low";
  return "in_line";
}

const roundUpCents = (v) => Math.ceil(v * 100 - 1e-9) / 100;
const roundHours = (v) => Math.max(1, Math.round(v));

/** Caps an agent should ask for to land in line: the 75th percentile, so most runs finish in one session. */
export function suggestedCaps(rate) {
  if (!rate.enough) return null;
  const total = roundUpCents(rate.total_usd.p75);
  const perTx = Math.min(roundUpCents(rate.per_tx_usd.p75), total);
  return { per_tx_usd: perTx, total_usd: total, ttl_hours: roundHours(rate.ttl_hours.median) };
}

/** Of past asks of this type with a total within 0.5x–2x of this one, how many were approved. */
export function similarAskApproval(records, taskType, totalUsd) {
  const similar = records.filter(
    (r) => r.task_type === taskType && r.total_usd >= totalUsd * 0.5 && r.total_usd <= totalUsd * 2,
  );
  return { n: similar.length, approved: similar.filter((r) => r.outcome === "approved").length };
}

const money = (v) => (v == null ? "?" : `$${v < 1 ? v.toFixed(2) : v.toFixed(v % 1 ? 2 : 0)}`);

export const KITE_SUMMARY_MAX = 240;

/**
 * The text passed to `kpass session create --task-summary`, so the going rate
 * appears on Kite's own approval screen. Built by code from the card, never by SERV.
 * e.g. "Make 15 blog header images | Going rate (image generation, 11 approvals): $5.67 total, $0.52/payment, 2h. This ask: $6.53, $0.56/payment, 2h - IN LINE"
 */
export function kiteTaskSummary(taskSummary, card) {
  const cueText = { high: "HIGH", low: "LOW", in_line: "IN LINE" }[card.overall];
  if (!cueText) return String(taskSummary).slice(0, KITE_SUMMARY_MAX);
  const d = card.dims;
  const tail = ` | Going rate (${(card.label ?? card.task_type).toLowerCase()}, ${card.rate.n} approvals): ${money(d.total_usd.median)} total, ${money(d.per_tx_usd.median)}/payment, ${Math.round(d.ttl_hours.median)}h. This ask: ${money(d.total_usd.requested)}, ${money(d.per_tx_usd.requested)}/payment, ${Math.round(d.ttl_hours.requested)}h - ${cueText}`;
  const room = KITE_SUMMARY_MAX - tail.length;
  const head = String(taskSummary).trim();
  return (head.length > room ? head.slice(0, Math.max(0, room - 1)).trimEnd() + "…" : head) + tail;
}

/**
 * Everything the approval card shows. `ask` = { per_tx_usd, total_usd, ttl_hours }.
 * The card informs the first ask; it never blocks the spend.
 */
export function buildCard(records, taskType, ask) {
  const rate = goingRate(records, taskType);
  const dims = {};
  for (const f of FIELDS) {
    const s = rate[f];
    dims[f] = {
      requested: ask[f],
      ...s,
      cue: rate.enough ? cue(ask[f], s) : "unknown",
      x_median: s.median ? Math.round((ask[f] / s.median) * 10) / 10 : null,
    };
  }
  // Overall cue follows the money caps. TTL is shown but doesn't drive the cue.
  const moneyCues = [dims.total_usd.cue, dims.per_tx_usd.cue];
  const overall = !rate.enough ? "unknown"
    : moneyCues.includes("high") ? "high"
    : moneyCues.includes("low") ? "low"
    : "in_line";

  const suggestion = suggestedCaps(rate);
  const similar = similarAskApproval(records, taskType, ask.total_usd);
  const notes = [];
  if (!rate.enough) {
    notes.push(`Only ${rate.n} past approvals for this task type, fewer than ${MIN_SAMPLE}, so there's no going rate yet.`);
  } else if (overall === "high") {
    notes.push(`This asks for ${dims.total_usd.x_median}x the usual total. People usually approve about ${money(dims.total_usd.median)}.`);
  } else if (overall === "low") {
    // Name the Kite error the agent would actually hit first.
    notes.push(dims.per_tx_usd.cue === "low"
      ? `The per-payment cap is below what a single call of this type usually costs, so Kite may refuse the first payment (session_rule_exceeded) and the agent has to ask again.`
      : `This is below what similar tasks usually need. The agent is likely to hit session_total_exceeded mid-run and have to ask again.`);
  } else {
    notes.push(`In line with what people usually approve for this task type.`);
  }
  if (similar.n >= 2) notes.push(`${similar.approved} of ${similar.n} past asks of a similar size were approved.`);
  if (rate.seeded) notes.push(`${rate.seeded} of the ${rate.n} approvals behind this rate are seeded demo data.`);

  return { task_type: taskType, ask, rate: { n: rate.n, seeded: rate.seeded, rejected: rate.rejected, enough: rate.enough }, dims, overall, suggestion, similar, notes };
}
