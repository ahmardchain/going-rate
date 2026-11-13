# Going Rate: SERV Hackathon 02 submission

**Track:** Kite
**Repo:** https://github.com/ahmardchain/going-rate
**Live demo:** https://going-rate.ahmardchain.workers.dev/
**Demo video:** _add link_
**X post:** _add link_

## What it does

Going Rate is a rate card for Kite Passport spending sessions. When an agent asks for a session (`kpass session create`), Going Rate shows a card before the passkey: the caps the agent requested next to what people usually approve for that kind of task, with a cue of in line, high or low and suggested caps.

The point is a better first ask. An over-ask is either approved for far more than the task needs or rejected and asked again. An under-ask runs into `session_total_exceeded` partway through the run and has to stop for a second approval. With the going rate, the agent asks for the right caps once and the user taps the passkey once. Going Rate never blocks a spend.

After the passkey, `kpass session status` reports the decision. Going Rate records it, and the rate updates.

## How SERV Reasoning is used

SERV classifies each session's task summary (plus the merchant host, when known) into one of 8 fixed task types, which become the rate card's buckets.

- The system prompt is a single constant. SERV compiles it into a reasoning flowchart, cached per organization for 30 days and keyed on the exact prompt, so every classification reuses the same flowchart. "Generate 20 product thumbnails" and "Make 15 blog header images" both land in image-generation.
- The output is strict JSON with an enum of the task ids, so SERV can't invent a category.
- `serv_prompt_guard` is on, because task summaries are written by agents and are untrusted. A summary that tries to steer the classifier is refused and can't feed the rate card.
- SERV never sees or produces amounts. Medians, percentiles, cap comparisons and dates are plain code, because model replays aren't fully deterministic.
- Model: `gpt-6-luna`.

## Why it's Kite

It uses only Passport features that are live today, tested against `kpass` 6.13.2 on the production backend:

- an agent registered with `kpass agent:register`
- sessions via `kpass session create --separate`, a passkey approval, and `kpass session status`
- history via `kpass activity --kind session_approval` joined with `kpass user sessions`

It doesn't use DIDs, VCs, escrow, streaming or conditional payments.

**Live run:** on a real Passport account, a $100 / $25-per-payment / 24h ask for image generation got a HIGH card (17.7x the usual total) and was rejected with the passkey. A similar task, asked at the going rate ($6.53 / $0.56 / 2h), got an IN LINE card and was approved. Both decisions were recorded as Kite-verified outcomes.

## Honest notes

- The starting pool is 93 seeded records, all labelled `seeded: true`, and the card always says how many of its approvals are seeded. Real approvals come from `going-rate sync` and from decisions recorded by `going-rate ask`.
- `kpass activity` only covers one account, so no shared pool of real approvals exists yet. Going Rate starts one: verified outcomes can be sent to the hosted pool with an ingest token.
- The passkey on the hosted demo page is simulated, and the page says so. The CLI makes the real Kite calls.

## Revenue

A paid going-rate lookup per session ask (an x402 service) for agent builders and wallets, pooled benchmarks that improve as verified approvals come in (contributors get free lookups), and approval-rate analytics for agent marketplaces.
