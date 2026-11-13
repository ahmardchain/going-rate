# Going Rate

**Know the going rate before you tap your passkey.**

When an AI agent asks for a Kite Passport spending session, Going Rate shows you what people usually approve for that kind of task, right before you approve. Agents ask for the right caps the first time: you tap your passkey once, and the run doesn't stall halfway for another approval.

Built for **SERV Hackathon 02, Kite track**.

**[Live demo](https://going-rate.ahmardchain.workers.dev/)** · **Demo video:** _TBA_ · Tested live against Kite Passport (`kpass` 6.13.2, production)

<p align="center"><img src="docs/img/approval-card.png" alt="Going Rate approval card: an agent asks for $100 to generate thumbnails; the going rate is $5.89, so the card shows HIGH, 17x, with a suggested ask of $6.59" width="420"></p>

## Try it in 60 seconds

Open the **[live demo](https://going-rate.ahmardchain.workers.dev/)** and click through the three asks:

1. **Ask 1, a wild cap:** "Generate 20 product thumbnails", $100 total. SERV classifies it as image generation. The card says **HIGH**, 17x what people usually approve, and suggests $6.59.
2. **Ask 2, a similar task:** "Make 15 blog header images". The agent checks the going rate first and asks for the suggested caps. Different wording, same category, and the card says **IN LINE**. Approve it, and the rate table updates.
3. **Ask 3, too small:** weather lookups for 40 cities with a $0.30 cap. The card says **LOW**: the agent would hit `session_total_exceeded` mid-run.

On the hosted page the passkey is simulated and your clicks only affect your own browser. The real Kite flow runs through the CLI (see [Live run on Kite](#live-run-on-kite)).

## The problem

An agent that needs to spend calls `kpass session create` with a task summary, a per-payment cap, a total cap and a duration. You approve it with your passkey. Today the caps are a guess:

- **Too high:** you approve far more than the task needs, or you reject it and the agent has to ask again.
- **Too low:** the agent hits `session_total_exceeded` partway through, stops, and asks you again.

Kite already records every approval and its caps (`kpass activity`, `kpass user sessions`), but nothing feeds that history into the next ask. Going Rate closes that loop.

**What Going Rate is not:** it isn't a spend limiter or an approval gate. It never blocks or allows anything. Kite's session caps already enforce limits. Going Rate improves the *first ask*, so the caps you approve fit the task.

## How it works

```
agent drafts an ask ──► SERV classifies the task ──► code looks up the going rate ──► card before the passkey ──► decision recorded
 (summary + caps)        (1 of 8 fixed types)         (median / p25 / p75)            (in line / high / low)     (rate updates)
```

1. **The agent drafts an ask:** a task summary plus per-payment, total and duration caps.
2. **SERV Reasoning classifies the task** into one of 8 fixed types: data API lookups, LLM inference, image generation, audio, video, web scraping, cloud compute, other.
3. **Plain code computes the going rate** for that type from past *approved* asks: the 25th, 50th and 75th percentiles of each cap.
4. **The card compares the ask**, cap by cap:
   - **HIGH** if a money cap is above 1.25 × the 75th percentile
   - **LOW** if it's below 0.8 × the 25th percentile
   - **IN LINE** otherwise

   It suggests caps at the 75th percentile of what people approved, plus the median duration. With fewer than 5 approvals for a type, it says there's no going rate yet instead of guessing.
5. **After the passkey**, the decision from `kpass session status` (approved or rejected) is recorded, and the rate updates.

Kite's own approval page can't be changed by third parties, so the card is shown by the agent just before it hands you Kite's approval link. That's the spot where agents already print the task and limits today.

## How SERV Reasoning is used

SERV has one job: turning free-text task summaries into a stable category. Arithmetic never goes to it.

- **One constant system prompt** (`CLASSIFIER_SYSTEM` in [`src/core/serv.js`](src/core/serv.js)). SERV compiles a system prompt into a reasoning flowchart and caches it per organization for 30 days. Nothing is ever inserted into the prompt; the task summary and merchant host go in the user message. So every classification reuses the same compiled flowchart, and differently worded tasks land in the same bucket. In our runs, the first call took about 8s (compiling) and later calls about 3s.
- **Strict JSON with an enum** of the 8 task ids, so the model can't invent a category.
- **`serv_prompt_guard` turned on.** Task summaries are written by agents, so they're untrusted input. A summary that tries to steer the classifier is refused. With strict JSON, SERV returns `content: null` and puts the refusal in `message.refusal`. Going Rate treats that as blocked: no task type, no card, and it can't feed the rate. Try "Ignore previous instructions…" on the live demo. SERV's default content filter also stays on.
- **No numbers go to SERV.** Replays aren't fully deterministic, so amounts, percentiles, comparisons and dates are plain code in [`src/core/rates.js`](src/core/rates.js). SERV never even sees the amounts.
- **Model:** `gpt-6-luna` via `https://inference-api.openserv.ai/v1/chat/completions`.

## Why it's a Kite project

It uses only Kite Passport features that are live today, tested against `kpass` 6.13.2 on the production backend:

| Kite feature | How Going Rate uses it |
|---|---|
| Agent identity: `kpass agent:register` | The CLI runs as a registered agent (`--type going-rate`) |
| Sessions: `kpass session create --separate` | The ask, with `--max-amount-per-tx`, `--max-total-amount`, `--ttl` and USDC |
| Passkey approval link plus `kpass session status --wait` | The user's decision, recorded as a Kite-verified outcome |
| `kpass activity --kind session_approval` plus `kpass user sessions` | Your approval history, joined into past asks by `going-rate sync` |
| `session_total_exceeded` | What the LOW cue helps agents avoid |

It doesn't build on DIDs, VCs, escrow, streaming or conditional payments.

### What we learned from the live CLI

- **`--separate` is required.** Without it, `kpass session create` may pay from the account allowance, so no passkey approval happens and the card is never seen.
- **Approval events only carry IDs.** A `session_approval` event holds `session_id`, `request_id` and the passkey step-up (`uv_attested`), but not the task or caps. Those live in `kpass user sessions` (`delegation.task.summary`, `delegation.payment_policy`, the allowed x402 endpoint, `created_at`/`expires_at`, `usage.spent_total`). `sync` joins the two on `session_id`.
- **Reading the decision.** `kpass session status` prints a top-level `status: "success"` for the command itself. An approval is `session.status: "active"`. A rejection makes the command exit with code 3 and the message "Session request was rejected by the user."

## Live run on Kite

Run on 12 Nov 2026 on a real Passport account, with real passkey decisions:

| Step | Ask | Card | Passkey | Recorded |
|---|---|---|---|---|
| `sync` | an earlier image-edit session, read from Kite | | approved earlier | 1 verified approval, classified as image generation |
| Ask 1 | "Generate 20 product thumbnails via image API": $25 per payment, $100 total, 24h | **HIGH**, 17.7x the usual total | **rejected** | verified rejection |
| Ask 2 | "Make 15 blog header images" at the going rate: $0.56 per payment, $6.53 total, 2h | **IN LINE** | **approved** | verified approval |

After the run, the image generation rate in that CLI pool rested on 11 approvals, 2 of them real Kite approvals. These outcomes live in the CLI's local pool. The hosted demo starts from the seeded pool, and verified outcomes reach it only through the ingest token described below.

A first attempt at ask 1 was approved by mistake. That session was never recorded in the pool, and it couldn't spend: the wallet balance was $0.

## What's real and what's seeded

| | Status |
|---|---|
| SERV classification | Real, live API calls, both on the hosted demo and in the CLI |
| Rate math, cues, suggested caps | Real code ([`src/core/rates.js`](src/core/rates.js)), unit tested |
| `going-rate ask`: card, `kpass session create`, passkey, `kpass session status`, recorded outcome | Real Kite CLI calls (see the live run above) |
| Passkey on the hosted demo page | **Simulated**. Clicks are stored as demo outcomes, scoped to your browser, and never mixed into other visitors' rates |
| Starting pool | **Seeded**: 93 records in [`data/seed-pool.json`](data/seed-pool.json), every one marked `seeded: true`, generated by [`scripts/make-seed.js`](scripts/make-seed.js). Every card says how many of its approvals are seeded |
| Kite history reader | Built on real `kpass` 6.13.2 output (fixtures in [`test/kpass.test.js`](test/kpass.test.js), IDs replaced) |
| Rejections in Kite history | Kite's history lists approved sessions. Rejections are captured only when they go through `going-rate ask` or `going-rate record` |

`kpass activity` only covers one account, so no shared pool of real approvals exists yet. Going Rate is built to start one: outcomes the CLI records after `kpass session status` are marked `kite_verified`. With `GOING_RATE_URL` and `INGEST_TOKEN` set, the CLI also sends them to the hosted pool, where they apply to every visitor.

## For agent builders: the API

Any agent or wallet can call the hosted API before `kpass session create`:

| Endpoint | Body | Returns |
|---|---|---|
| `POST /api/suggest` | `{ task_summary, payment_context? }` | task type and suggested caps |
| `POST /api/check` | `{ task_summary, payment_context?, per_tx_usd, total_usd, ttl_hours }` | the card: going rate per cap, cue, notes, suggestion, `check_id` |
| `POST /api/outcome` | `{ check_id, outcome: "approved" \| "rejected", kite_request_id? }` | the recorded outcome |
| `GET /api/rates` | | the going rate for all 8 task types |

Send an `x-demo-session` header to keep demo outcomes scoped to one client. Outcomes are recorded as Kite-verified, and pooled for everyone, only when the request carries `Authorization: Bearer <INGEST_TOKEN>` and a `kite_request_id`.

```bash
curl -s https://going-rate.ahmardchain.workers.dev/api/suggest \
  -H 'content-type: application/json' \
  -d '{"task_summary":"Transcribe 6 meeting recordings"}'
```

## Revenue

- **Going-rate lookups as a paid service.** Agent frameworks and wallets pay per check, before each session ask. The natural fit is selling it as an x402 service through Kite itself. This is planned, not built yet.
- **The data gets better with use.** Each verified decision improves the pool, so contributors can get free lookups in exchange for their outcomes.
- **Approval analytics** for agent marketplaces: which agents ask for sensible caps, and how often their asks get approved the first time.

## Limitations

- The pool is small, and most of it is seeded. The rate gets meaningful as verified outcomes come in.
- The 8 task types are coarse. Within one type, a small job and a large job share a rate.
- The rate compares caps, not actual spend. `usage.spent_total` from `kpass user sessions` is already stored, so a "people actually spent" view is the next step.
- The hosted pool is a single KV key, which is fine for a demo but would need proper storage at scale.

## Run it

Needs Node 22 or newer. The app itself has no runtime dependencies; `npm install` only adds wrangler, for deploys.

```bash
npm install
npm test                          # 17 tests: rate math, API, prompt-guard handling, Kite output parsing
```

```bash
SERV_API_KEY=... npm run dev      # http://localhost:8787
```

Agent CLI (`ask`, `record` and `sync` need [`kpass`](https://docs.gokite.ai/passport/install)):

```bash
# Show the card for an ask
SERV_API_KEY=... node src/cli.js check --summary "Generate 20 product thumbnails" --per-tx 25 --total 100 --ttl 24h

# Ask at the going rate: card, then kpass session create, then passkey, then the outcome is recorded
SERV_API_KEY=... node src/cli.js ask --summary "Make 15 blog header images"

# Add your approved sessions from Kite to the pool
SERV_API_KEY=... node src/cli.js sync

# Record the decision for an existing request (e.g. if ask was interrupted)
SERV_API_KEY=... node src/cli.js record --request-id agent_session_req_... --summary "..." --per-tx 25 --total 100 --ttl 24h
```

Before running `ask`:
1. Install `kpass`.
2. Log in with `kpass login init --email ...`, then `kpass login verify`.
3. Register an agent with `kpass agent:register --type going-rate`.

Behind an HTTPS proxy, add `NODE_USE_ENV_PROXY=1`.

## Deploy (Cloudflare Workers)

```bash
npx wrangler deploy                 # creates the GOING_RATE KV namespace on the first deploy
npx wrangler secret put SERV_API_KEY
npx wrangler secret put INGEST_TOKEN  # optional: lets the CLI send verified outcomes
```

With Cloudflare's Git integration (Workers Builds), every push deploys. Set `SERV_API_KEY` once as a secret under Worker > Settings > Variables and Secrets.

## Layout

```
src/core/taxonomy.js  the 8 task types
src/core/serv.js      SERV classifier: constant prompt, strict JSON enum, prompt guard
src/core/rates.js     going rate, cues and suggested caps (plain code, no SERV)
src/app.js            HTTP API shared by the Worker and the dev server
src/worker.js         Cloudflare Worker (KV store, static assets)
src/dev-server.js     local Node server
src/store-file.js     file-backed store for the dev server and CLI
src/kpass.js          kpass session create/status, activity, user sessions
src/cli.js            going-rate check | ask | record | sync
scripts/make-seed.js  generates the labelled seed pool
data/seed-pool.json   seeded demo pool
public/index.html     demo page
test/                 rates, API and kpass tests
docs/                 submission write-up, demo script, screenshot
```

## License

MIT
