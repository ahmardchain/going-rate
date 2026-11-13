# Going Rate

**A rate card for Kite Passport spending sessions.** Before you tap your passkey to approve an agent's spend, Going Rate shows what people usually approve for that kind of task. The agent can ask for the right caps the first time: you approve once, and the run doesn't stop halfway for another approval.

Entry for **SERV Hackathon 02, Kite track**.

- Live demo: https://going-rate.ahmardchain.workers.dev/
- Demo video: _TBA_

## The gap

When an agent needs to spend, it calls `kpass session create` with a task summary, a per-payment cap, a total cap and a duration. You approve it with your passkey. The caps are a guess:

- **Too high:** you approve far more than the task needs, or you reject it and the agent asks again.
- **Too low:** the agent hits `session_total_exceeded` partway through the run, stops, and asks you again.

Kite's `kpass activity` already records your approvals and spending, but nothing feeds that history back into the next ask. Going Rate closes that loop.

## What it does

1. **An agent drafts an ask:** a task summary plus per-payment, total and duration caps.
2. **SERV Reasoning classifies the task** into one of 8 fixed task types (data API lookups, LLM inference, image generation, audio, video, web scraping, cloud compute, other).
3. **Plain code looks up the going rate** for that type: the median and percentiles of caps people approved. It compares the ask and gives a cue of **in line**, **high** or **low**, plus suggested caps (the 75th percentile, so most runs finish in one session).
4. **The approval card** shows the requested caps next to the going rate, before the passkey. It informs the decision; it never blocks a spend.
5. **After you decide**, `kpass session status` reports approved or rejected, and the outcome is recorded so the rate card updates.

## How SERV Reasoning is used

SERV does one job: it turns free-text task summaries into a stable category.

- **One constant system prompt** (`CLASSIFIER_SYSTEM` in [`src/core/serv.js`](src/core/serv.js)). SERV compiles a system prompt into a reasoning flowchart and caches it per organization for 30 days, keyed on the exact prompt string. Nothing is ever inserted into the prompt; the task summary goes in the user message. So every classification reuses the same compiled flowchart, and "Generate 20 product thumbnails" and "Make 15 blog header images" land in the same bucket. In our runs, the first call took about 8s (compile) and later calls about 3s.
- **Strict JSON with an enum** of the 8 task ids, so the output can't invent a category.
- **`serv_prompt_guard` turned on.** Task summaries are written by agents, so they're untrusted input. A summary that tries to steer the classifier is refused (`finish_reason: content_filter`), gets no task type, and can't feed the rate card. SERV's default content filter stays on.
- **Model:** `gpt-6-luna` through `https://inference-api.openserv.ai/v1/chat/completions`.
- **SERV never handles numbers.** Replays aren't fully deterministic, so amounts, percentiles, cap comparisons and dates are all plain code in [`src/core/rates.js`](src/core/rates.js). SERV doesn't even see the amounts.

## Why it's a Kite project

It's built on Kite Passport features that are live today (tested against `kpass` 6.13.2 on the production backend):

- **Agent identity:** the CLI runs as an agent registered with `kpass agent:register --type going-rate`.
- **Sessions:** `kpass session create --separate` (task summary, `--max-amount-per-tx`, `--max-total-amount`, `--ttl`, USDC), the passkey approval link, and `kpass session status --wait` for the decision. The "Too low" cue is about avoiding `session_total_exceeded` mid-run.
- **History:** `going-rate sync` reads `kpass activity --kind session_approval` and `kpass user sessions` and adds your approved asks to the pool.
- Going Rate does not build on DIDs, VCs, escrow, streaming or conditional payments.

### What we learned from the live CLI

- **`--separate` is required.** Without it, `kpass session create` may pay from the account allowance, so no passkey approval happens and the card is never seen.
- **Approval events carry only ids.** A `session_approval` event in `kpass activity` holds `session_id`, `request_id` and the passkey step-up (`uv_attested`), but not the task or caps. Those live in `kpass user sessions` (`delegation.task.summary`, `delegation.payment_policy`, the allowed x402 endpoint, `created_at`/`expires_at`, `usage.spent_total`). `sync` joins the two on `session_id`.
- **Reading the decision.** `kpass session status` prints a top-level `status` of `"success"` for the command itself. An approval is `session.status: "active"`. A rejection makes the command exit with code 3 and the message "Session request was rejected by the user."

## Live run on Kite (12 Nov 2026)

Run on a real Passport account, with real passkey decisions:

| Step | Ask | Card | Passkey | Recorded |
|---|---|---|---|---|
| `sync` | an earlier image-edit session (from `kpass user sessions`) | | approved earlier | 1 verified approval, classified `image-generation` |
| Ask 1 | "Generate 20 product thumbnails via image API": $25 per payment, $100 total, 24h | **HIGH**, 17.7x the usual total | rejected | verified rejection |
| Ask 2 | "Make 15 blog header images" at the going rate: $0.56 per payment, $6.53 total, 2h | **IN LINE** | approved | verified approval; the image-generation rate now rests on 11 approvals, 2 of them real |

A first attempt at ask 1 was approved by mistake. That session was never recorded in the pool, and it could not spend: the wallet balance was $0.

## What's real and what's seeded

| | Status |
|---|---|
| SERV classification | Real, live API calls |
| Rate math, cues, suggested caps | Real code ([`src/core/rates.js`](src/core/rates.js)), unit tested |
| `going-rate ask` → `kpass session create` → passkey → `kpass session status` → recorded outcome | Real Kite CLI calls |
| Passkey on the hosted demo page | **Simulated**: clicks are stored as demo outcomes, scoped to your browser, and never mixed into other visitors' rates |
| Starting pool | **Seeded**: 93 records in [`data/seed-pool.json`](data/seed-pool.json), every one `seeded: true`, generated by [`scripts/make-seed.js`](scripts/make-seed.js). The card always says how many of its approvals are seeded. |
| Kite history reader | Built and tested on the real `kpass` 6.13.2 output shapes (fixtures in [`test/kpass.test.js`](test/kpass.test.js), ids replaced) |
| Rejections in history | Kite's history shows approved sessions. Rejections are only captured when they go through `going-rate ask` or `going-rate record` |

`kpass activity` only covers your own account, so no shared pool of real approvals exists yet. Going Rate starts one: outcomes recorded by the CLI after `kpass session status` are marked `kite_verified` and can be sent to the hosted pool with an ingest token.

## Revenue

- **Rate card API for agent builders and wallets:** a paid going-rate lookup per session ask, sold as an x402 service.
- **Pooled benchmarks:** the more verified approvals the pool holds, the better the rates. Contributors get free lookups.
- **Approval-rate analytics** for agent marketplaces: which agents ask for sensible caps, and how often their asks get approved.

## Run it

```bash
npm test
```

```bash
SERV_API_KEY=... npm run dev     # http://localhost:8787
```

Agent CLI (needs [`kpass`](https://docs.gokite.ai/passport/install) for `ask` and `sync`):

```bash
# Show the card for an ask
SERV_API_KEY=... node src/cli.js check --summary "Generate 20 product thumbnails" --per-tx 25 --total 100 --ttl 24h

# Ask at the going rate: card, then kpass session create, then passkey, then record the outcome
SERV_API_KEY=... node src/cli.js ask --summary "Make 15 blog header images"

# Add your approved sessions from kpass activity + kpass user sessions to the pool
SERV_API_KEY=... node src/cli.js sync

# Record the decision for an existing request (e.g. if ask was interrupted)
SERV_API_KEY=... node src/cli.js record --request-id agent_session_req_... --summary "..." --per-tx 25 --total 100 --ttl 24h
```

Before `ask`: install `kpass`, log in (`kpass login init --email ...`, then `kpass login verify`), and register an agent (`kpass agent:register --type going-rate`).

Behind an HTTPS proxy, add `NODE_USE_ENV_PROXY=1`.

## Deploy (Cloudflare Workers)

```bash
npx wrangler deploy                           # creates the GOING_RATE KV namespace on first deploy
npx wrangler secret put SERV_API_KEY
npx wrangler secret put INGEST_TOKEN          # optional: lets the CLI send verified outcomes
```

With Cloudflare's Git integration (Workers Builds), the deploy runs on every push. Set `SERV_API_KEY` once under Worker > Settings > Variables and Secrets, as a secret.

## Layout

```
src/core/taxonomy.js  the 8 task types
src/core/serv.js      SERV classifier: constant prompt, strict JSON enum, prompt guard
src/core/rates.js     going rate, cues and suggested caps (plain code, no SERV)
src/app.js            HTTP API shared by the Worker and the dev server
src/worker.js         Cloudflare Worker (KV store, static assets)
src/dev-server.js     local Node server
src/kpass.js          kpass session create / status, activity, user sessions
src/cli.js            going-rate check | ask | record | sync
data/seed-pool.json   seeded demo pool (labelled)
public/index.html     demo page
```

## License

MIT
