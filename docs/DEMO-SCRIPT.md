# Demo video script (about 80 seconds)

Follows the contrast demo. Record the browser at https://going-rate.ahmardchain.workers.dev. Optionally add a terminal clip of the real `going-rate contrast` run and your phone's passkey prompt.

| Time | On screen | Voiceover |
|---|---|---|
| 0:00–0:08 | Title card: "An agent should know the price of a job before it asks you to pay." | "An agent wants to make a product video, and it needs your passkey to pay." |
| 0:08–0:22 | `/contrast`, left column: **Docs-example caps, $1 per payment, $5 total.** Zoom to the red result: `session_rule_exceeded`. | "It asks with the caps from Kite's docs example: one dollar a payment. The video costs a dollar thirty-three. Kite refuses the first payment, correctly. Now the agent has to stop and ask you again." |
| 0:22–0:40 | Main page. Paste "Generate a 5-second 720p product teaser video", caps $1 / $5. Click **Show approval card**. The card shows **LOW**, the SERV panel and the suggestion. | "Going Rate checks first. SERV Reasoning classifies the job as video generation and explains the card in one sentence. Plain code computes the going rate: video jobs usually get about three dollars a payment. So the ask is low." |
| 0:40–0:52 | Zoom on the **Sent to Kite as --task-summary** box, then the passkey prompt on your phone (or a screenshot of Kite's approval screen). | "The going rate goes into Kite's own approval screen, so you see it right where you tap your passkey." |
| 0:52–1:05 | `/contrast`, right column: **Going Rate's caps**, IN LINE, passkey approved, green "First paid call succeeded", click the transaction link. | "Same job, going-rate caps: one passkey tap, and the first paid call goes through. Here's the transaction." |
| 1:05–1:15 | `/ledger`: the payments table, listed vs charged, task types, dates. | "Every real payment is on the ledger: task type, listed price, what Kite actually charged, and the transaction." |
| 1:15–1:22 | Back to the title card. | "Going Rate: the going rate of the task, so you approve once." |

## Recording notes

- Before recording, check that `/contrast` shows a real run, with both columns filled. It renders `public/contrast.json`, written by `going-rate contrast`.
- If SERV's sentence on the card says "Template sentence", reload. The card shows which source each sentence comes from.
- Keep the passkey prompt on screen for about a second. It's the moment the product is about.
