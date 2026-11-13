// Kite service catalog lookups via the `ksearch` CLI: the listed price for an
// endpoint, as the catalog publishes it (starting_price of the featured endpoint).
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
let cache;

async function catalog() {
  if (cache) return cache;
  const { stdout } = await run("ksearch", ["service", "list", "--limit", "100", "--output", "json"], { timeout: 60_000, maxBuffer: 20 * 1024 * 1024 });
  cache = JSON.parse(stdout).services ?? [];
  return cache;
}

async function details(serviceId) {
  const { stdout } = await run("ksearch", ["service", "get", serviceId, "--output", "json"], { timeout: 60_000, maxBuffer: 5 * 1024 * 1024 });
  return JSON.parse(stdout).service ?? {};
}

/**
 * The merchant's own price for one exact call: send it unpaid and read the 402
 * challenge (x402 v2 PAYMENT-REQUIRED header, or a v1 JSON body with `accepts`).
 * Costs nothing. Returns { usd, network, asset } or null if no x402 quote was found.
 */
export async function quote(url, { method = "POST", body } = {}) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status !== 402) return null;
  let req;
  const header = res.headers.get("payment-required");
  if (header) { try { req = JSON.parse(atob(header)); } catch { /* not base64 JSON */ } }
  if (!req) req = await res.json().catch(() => null);
  const a = req?.accepts?.[0];
  const atomic = a?.amount ?? a?.maxAmountRequired;
  if (atomic == null) return null;
  // USDC and the other stablecoins Kite settles in use 6 decimals.
  return { usd: Number(atomic) / 1e6, network: a.network ?? null, asset: a.asset ?? null };
}

/** { service, service_id, listed_usd, unit } for a URL, or null if the catalog doesn't list it. */
export async function listedPrice(url) {
  const u = new URL(url);
  const svc = (await catalog()).find((s) => { try { return new URL(s.base_url).host === u.host; } catch { return false; } });
  if (!svc) return null;
  const full = await details(svc.service_id).catch(() => svc);
  const ep = (full.featured_endpoints ?? [])
    .filter((e) => { try { return u.pathname.startsWith(new URL(e.endpoint_url).pathname); } catch { return false; } })
    .sort((a, b) => b.endpoint_url.length - a.endpoint_url.length)[0];
  const price = ep?.starting_price ?? full.starting_price ?? svc.starting_price;
  return { service: svc.name, service_id: svc.service_id, listed_usd: price?.amount != null ? Number(price.amount) : null, unit: price?.unit ?? null };
}
