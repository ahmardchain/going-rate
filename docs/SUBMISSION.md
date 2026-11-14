# Going Rate: SERV Hackathon 02 submission

**Track:** Kite
**Repo:** https://github.com/ahmardchain/going-rate
**Live demo:** https://going-rate.ahmardchain.workers.dev/ · [Contrast](https://going-rate.ahmardchain.workers.dev/contrast) · [Ledger](https://going-rate.ahmardchain.workers.dev/ledger)
**Demo video:** https://github.com/ahmardchain/going-rate/blob/main/docs/going-rate-demo.mp4 (70s; replace with your YouTube/X link if you upload it)
**X post:** https://x.com/Ahmardchain/status/2121415151375282467

## What it does

An agent should know the price of a job before it asks you to pay.

When an agent asks for a Kite Passport spending session, Going Rate shows the going rate for that kind of task (what people usually approve) before the passkey, so the agent asks for the right caps the first time. Today caps are guesses. Too low, and Kite refuses a payment mid-run (`session_rule_exceeded` / `session_total_exceeded`) and the user gets a second approval. Too high, and the user over-approves or rejects.

Proof, on Kite's production backend (14 Nov 2026):
- **Contrast:** the same 5-second video job (merchant quote $1.33), asked twice:
  - With Kite's docs-example caps ($1 / $5), the first payment was refused with `session_rule_exceeded`.
  - With Going Rate's caps ($3.20 / $23.97, IN LINE), the first passkey approval was enough and the video was paid on the first call.
- **Ledger:** real paid calls across 5 task types (data lookup, LLM, image, scraping, video), each with listed vs charged price and a Basescan transaction. Listed prices understated real cost by up to 80%.

It's the going rate of the task, not an agent exam grade (Imprimatur), not one cart's total (PurseStrings).

## How SERV Reasoning is used

Every card makes two calls to the OpenServ inference API (`gpt-6-luna`), and both request IDs are shown on the card:
1. **Classify:** a constant system prompt, which SERV compiles into a cached flowchart, plus strict JSON with an 8-type enum. The task summary and merchant host go in the user message. The stable categories are what make a going rate possible.
2. **Explain:** code computes the rate, the cue and the suggested caps; SERV writes one sentence for the person approving, and code checks that every number in it came from code. Otherwise a template is shown, labelled as such.

`serv_prompt_guard` is on for both calls, because agent-written summaries are untrusted. SERV never does arithmetic.

## Why it's Kite

It's built only on Passport features that are live today:
- `kpass agent:register`
- `kpass session create --separate`, with the going rate in `--task-summary` so it appears on Kite's approval screen
- the passkey approval, then `kpass session status`
- `kpass session execute` for real x402 payments
- `kpass activity` and `kpass user sessions` as the ledger and history
- `ksearch` for listed prices

No DIDs, VCs, escrow, streaming or conditional payments.

## Built during the hackathon

All of it, 12–15 Nov 2026: the rate engine, the SERV classifier and explainer, the Kite CLI integration (`ask`, `run`, `pay`, `quote`, `contrast`, `ledger`, `sync`, `record`), the Cloudflare Worker, the approval card, the contrast and ledger pages, and 26 tests.

## Honest notes

- The starting pool is 93 seeded records, all labelled `seeded: true`. The card says how many of its approvals are seeded, and the Kite-verified decisions are listed on the ledger.
- The passkey on the main demo page is simulated. The contrast and ledger pages are real Kite runs.
- Two Tempo/MPP merchants couldn't be paid by Kite and were replaced. One $0.01 payment is still pending on Kite's side and isn't counted.

## Revenue

- **Going-rate lookups as a paid service** for agent frameworks and wallets, called before each session ask. The natural channel is an x402 listing in Kite's own catalog. This is planned.
- **Data that compounds** with every verified approval and payment.
- **First-ask analytics** for agent marketplaces.
