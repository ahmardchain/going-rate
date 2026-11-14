// The public ledger: every real Kite Passport x402 payment, with the task
// type, the catalog's listed price, what Kite actually charged, and a link to
// the transaction. Source of truth is `kpass activity --kind x402_payment`;
// local notes from `going-rate pay` add the task summary and task type.

const EXPLORERS = {
  base: "https://basescan.org/tx/",
  "eip155:8453": "https://basescan.org/tx/",
  8453: "https://basescan.org/tx/",
  kite: "https://kitescan.ai/tx/",
  2366: "https://kitescan.ai/tx/",
  polygon: "https://polygonscan.com/tx/",
  137: "https://polygonscan.com/tx/",
  avalanche: "https://snowtrace.io/tx/",
  43114: "https://snowtrace.io/tx/",
  solana: "https://solscan.io/tx/",
};

const first = (...v) => v.find((x) => x !== undefined && x !== null && x !== "");

export function explorerUrl(chain, chainId, txHash) {
  if (!txHash) return null;
  const base = EXPLORERS[String(chain ?? "").toLowerCase()] ?? EXPLORERS[String(chainId ?? "")];
  return base ? base + txHash : null;
}

/** USD amount from a Kite transaction (amount, or amount_raw with 6 decimals for USDC). */
export function chargedUsd(t) {
  if (t.amount != null && t.amount !== "") return Number(t.amount);
  if (t.amount_usd != null) return Number(t.amount_usd);
  if (t.amount_raw != null) return Number(t.amount_raw) / 10 ** Number(t.decimals ?? 6);
  return null;
}

/**
 * Turn x402_payment activity events into ledger rows.
 * `notes` are local records from `going-rate pay` ({ request_url, session_id, at, task_summary, task_type, listed_usd, service });
 * a note matches an event by session id and request URL, closest in time.
 */
export function ledgerRows(events, notes = []) {
  const rows = [];
  for (const e of events) {
    if (e?.kind !== "x402_payment") continue;
    // kpass 6.13.2: details.transaction (amount, chain_name, x402.request_url) and, for paid
    // calls, details.routing (user_debit_usd_micros, merchant_tx_hash, merchant_chain, merchant_url).
    const t = e.details?.transaction ?? e.details ?? {};
    const x = t.x402 ?? {};
    const rt = e.details?.routing ?? {};
    const requestUrl = first(x.request_url, t.request_url, rt.merchant_url);
    const sessionId = first(x.session_id, t.session_id, e.details?.session?.session_id);
    const at = first(e.occurred_at, e.created_at);
    const candidates = notes.filter((n) => n.request_url === requestUrl && (!sessionId || !n.session_id || n.session_id === sessionId));
    const note = candidates.sort((a, b) => Math.abs(Date.parse(a.at) - Date.parse(at)) - Math.abs(Date.parse(b.at) - Date.parse(at)))[0];
    const txHash = first(rt.merchant_tx_hash, rt.legs?.at(-1)?.dst_tx_hash, t.tx_hash, t.transaction_hash, x.tx_hash, e.details?.tx_hash);
    const chain = first(rt.merchant_chain, t.chain_name, t.chain, e.chain);
    // What the user was debited (merchant price plus any routing overhead), else the transfer amount.
    const charged = rt.user_debit_usd_micros != null ? Number(rt.user_debit_usd_micros) / 1e6 : chargedUsd(t);
    rows.push({
      at,
      status: e.status,
      task_type: note?.task_type ?? null,
      task_summary: note?.task_summary ?? null,
      service: note?.service ?? first(x.merchant_host, t.merchant_host),
      merchant_host: first(x.merchant_host, t.merchant_host),
      request_url: requestUrl,
      listed_usd: note?.listed_usd ?? null,
      quoted_usd: note?.quoted_usd ?? null,
      charged_usd: charged,
      routing_overhead_usd: rt.routing_overhead_usd_micros != null ? Number(rt.routing_overhead_usd_micros) / 1e6 : null,
      chain,
      tx_hash: txHash ?? null,
      tx_url: explorerUrl(chain, t.chain_id, txHash),
      session_id: sessionId ?? null,
      activity_id: e.id,
    });
  }
  return rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/** Per task type: number of real paid calls, charged price per call (min / median / max), last paid date. */
export function paidSummary(rows) {
  const byType = {};
  for (const r of rows) {
    // Free calls (charged $0) say nothing about the price of a task type.
    // Only settled payments count; pending or failed ones haven't been charged for sure.
    if (!r.task_type || !(r.charged_usd > 0) || r.status !== "completed") continue;
    (byType[r.task_type] ??= []).push(r);
  }
  return Object.fromEntries(Object.entries(byType).map(([type, rs]) => {
    const prices = rs.map((r) => r.charged_usd).sort((a, b) => a - b);
    const mid = prices.length >> 1;
    return [type, {
      calls: rs.length,
      charged_min: prices[0],
      charged_median: prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2,
      charged_max: prices[prices.length - 1],
      last_paid_at: rs.map((r) => r.at).sort().at(-1),
    }];
  }));
}
