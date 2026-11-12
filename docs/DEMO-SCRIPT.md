# Demo video script (about 2 minutes)

Record a terminal next to a browser. Use your phone for the passkey.

## 0:00 The problem (15s)

On screen: the README "The gap" section.

> When an agent wants to spend through Kite, it asks for a session with caps. The caps are a guess. Ask too much and you approve far more than the task needs, or reject it and get asked again. Ask too little and the run stops halfway with `session_total_exceeded`. Going Rate fixes the first ask.

## 0:15 Ask 1: the wild cap (35s)

```bash
node src/cli.js ask --summary "Generate 20 product thumbnails via image API" --per-tx 25 --total 100 --ttl 24h
```

Show the card: Image generation, classified by SERV. **HIGH**, 17.7x the usual total, with suggested caps.

> SERV puts the task into a fixed category. Plain code compares the caps with what people usually approve for it.

Open the approval link on your phone and **reject** it. The terminal shows "Kite says: rejected. Recorded."

## 0:50 Ask 2: a similar task at the going rate (35s)

```bash
node src/cli.js ask --summary "Make 15 blog header images"
```

Show "Asking at the going rate for Image generation", then the **IN LINE** card at $0.56 per payment, $6.53 total, 2h.

> Different wording, same category. SERV's cached flowchart keeps the buckets stable. This time the agent asked for what people actually approve.

**Approve** it with the passkey. The terminal shows "Kite says: approved. Recorded."

## 1:25 The card updates (15s)

```bash
node src/cli.js check --summary "Render 12 social media illustrations" --per-tx 0.5 --total 6 --ttl 2h
```

Point at "9 of the 11 approvals behind this rate are seeded demo data". The rate now includes your real Kite approvals.

## 1:40 The web card and wrap-up (20s)

On screen: the live demo page. Click ask 1, then ask 2, then ask 3 (LOW: "likely to hit session_total_exceeded").

> One tap, the right caps, no stall mid-run. SERV classifies, code does the math, Kite does the approval. The seeded data is labelled everywhere.
