import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { percentile, goingRate, cue, buildCard, suggestedCaps, MIN_SAMPLE } from "../src/core/rates.js";

const rec = (total, outcome = "approved", extra = {}) => ({
  task_type: "image-generation", per_tx_usd: total / 10, total_usd: total, ttl_hours: 2, outcome, seeded: false, ...extra,
});
const pool = [4, 5, 5, 6, 6, 7].map((t) => rec(t));

test("percentile interpolates", () => {
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(percentile([10], 0.75), 10);
  assert.equal(percentile([], 0.5), null);
});

test("going rate uses approved asks only", () => {
  const r = goingRate([...pool, rec(500, "rejected")], "image-generation");
  assert.equal(r.n, 6);
  assert.equal(r.rejected, 1);
  assert.equal(r.total_usd.median, 5.5);
});

test("cue bands", () => {
  const s = { p25: 5, median: 5.5, p75: 6 };
  assert.equal(cue(5.5, s), "in_line");
  assert.equal(cue(7.5, s), "in_line"); // 6 * 1.25 = 7.5 is the edge
  assert.equal(cue(7.51, s), "high");
  assert.equal(cue(4, s), "in_line");   // 5 * 0.8 = 4 is the edge
  assert.equal(cue(3.99, s), "low");
});

test("wild ask is high, suggested ask is in line, tiny ask is low", () => {
  assert.equal(buildCard(pool, "image-generation", { per_tx_usd: 25, total_usd: 100, ttl_hours: 24 }).overall, "high");
  const sug = suggestedCaps(goingRate(pool, "image-generation"));
  assert.equal(buildCard(pool, "image-generation", sug).overall, "in_line");
  assert.equal(buildCard(pool, "image-generation", { per_tx_usd: 0.05, total_usd: 1, ttl_hours: 1 }).overall, "low");
});

test("suggested per-payment cap never exceeds the total", () => {
  const odd = [1, 1, 1, 1, 1].map((t) => rec(t, "approved", { per_tx_usd: 5 }));
  const s = suggestedCaps(goingRate(odd, "image-generation"));
  assert.ok(s.per_tx_usd <= s.total_usd);
});

test("too few approvals: no rate, no cue, says why", () => {
  const card = buildCard(pool.slice(0, MIN_SAMPLE - 1), "image-generation", { per_tx_usd: 1, total_usd: 100, ttl_hours: 1 });
  assert.equal(card.overall, "unknown");
  assert.equal(card.suggestion, null);
  assert.match(card.notes[0], /no going rate yet/);
});

test("card discloses seeded rows", () => {
  const seeded = pool.map((r) => ({ ...r, seeded: true }));
  const card = buildCard(seeded, "image-generation", { per_tx_usd: 0.5, total_usd: 5, ttl_hours: 2 });
  assert.ok(card.notes.some((n) => /6 of the 6 approvals .* seeded/.test(n)));
});

test("seed pool is fully labelled and covers every task type", async () => {
  const { records } = JSON.parse(readFileSync(new URL("../data/seed-pool.json", import.meta.url)));
  const { TASK_TYPE_IDS } = await import("../src/core/taxonomy.js");
  assert.ok(records.every((r) => r.seeded === true && r.source === "seed"));
  for (const t of TASK_TYPE_IDS) assert.ok(goingRate(records, t).enough, `${t} has enough seeded approvals`);
});
