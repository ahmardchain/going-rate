// Records the Going Rate demo from the live site, with captions burned in.
// Each scene: get the visual ready (untimed), mark start, hold for the voice line's
// duration while captions advance, mark end. edit.sh cuts the marked spans and adds audio.
const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const DIR = process.argv[2];               // video work dir (has vo/*.mp3)
const SITE = "https://going-rate.ahmardchain.workers.dev";
const PAD = 0.7;                           // seconds of breathing room after each line
const dur = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(DIR, "vo", f)]).toString());

const SCENES = [
  { vo: "01-title.mp3", captions: ["An agent should know the price of a job before it asks you to pay.", "This is Going Rate, for Kite Passport."] },
  { vo: "02-refused.mp3", captions: ["A real job: a 5-second product video.", "The agent asks with the docs-example caps: $1 per payment.", "The video costs $1.33.", "Kite refuses the first payment: session_rule_exceeded.", "The agent has to stop and ask you again."] },
  { vo: "03-serv.mp3", captions: ["Going Rate checks before the agent asks.", "SERV Reasoning classifies the job: video generation.", "SERV explains the card in one sentence.", "Plain code computes the going rate: about $3 per payment.", "So this ask is LOW."] },
  { vo: "04-kite.mp3", captions: ["The going rate goes into Kite's --task-summary,", "so it's on Kite's own approval screen, where you tap your passkey."] },
  { vo: "05-paid.mp3", captions: ["Same job, Going Rate's caps.", "One passkey approval. The first paid call goes through.", "Here's the transaction, on Base."] },
  { vo: "06-ledger.mp3", captions: ["Every real payment is on the ledger: 5 task types.", "Listed price vs what Kite actually charged.", "Listed prices were off by up to 80%."] },
  { vo: "07-close.mp3", captions: ["Going Rate: the going rate of the task,", "so you approve once."] },
];

const OVERLAY_CSS = `
#gr-cap{position:fixed;left:50%;bottom:34px;transform:translateX(-50%);z-index:99999;max-width:1040px;width:max-content;
  background:rgba(12,18,15,.86);color:#fff;font:600 26px/1.35 Inter,system-ui,sans-serif;padding:14px 26px;border-radius:14px;
  box-shadow:0 10px 40px rgba(0,0,0,.35);text-align:center;letter-spacing:-.01em;transition:opacity .25s}
.gr-focus{outline:3px solid #34d399!important;outline-offset:6px;border-radius:18px;transition:outline-color .3s}
html{scroll-behavior:smooth}`;

const card = (title, sub, foot) => `<!doctype html><html><head><style>
body{margin:0;height:100vh;display:grid;place-items:center;background:radial-gradient(1200px 600px at 30% 20%,#1d3b2e,#0b1210);font-family:Inter,system-ui,sans-serif;color:#e8ece9}
.w{max-width:980px;padding:0 60px}.k{font-size:20px;letter-spacing:.14em;text-transform:uppercase;color:#63c99d;font-weight:700;margin-bottom:22px}
h1{font-size:60px;line-height:1.08;letter-spacing:-.025em;margin:0 0 26px}.s{font-size:26px;color:#a9b5ae}.f{margin-top:40px;font-size:20px;color:#7f8c85}
</style></head><body><div class="w"><div class="k">Going Rate · SERV Hackathon 02 · Kite track</div><h1>${title}</h1><div class="s">${sub}</div><div class="f">${foot}</div></div></body></html>`;

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, colorScheme: "light",
    recordVideo: { dir: path.join(DIR, "raw"), size: { width: 1280, height: 720 } } });
  const t0 = Date.now();
  const page = await context.newPage();
  const now = () => (Date.now() - t0) / 1000;
  const marks = [];

  const overlay = async () => page.evaluate((css) => {
    if (!document.getElementById("gr-style")) { const s = document.createElement("style"); s.id = "gr-style"; s.textContent = css; document.head.appendChild(s); }
    if (!document.getElementById("gr-cap")) { const d = document.createElement("div"); d.id = "gr-cap"; d.style.opacity = "0"; document.body.appendChild(d); }
  }, OVERLAY_CSS);
  const caption = (text) => page.evaluate((t) => { const d = document.getElementById("gr-cap"); d.textContent = t; d.style.opacity = t ? "1" : "0"; }, text);
  const focus = (sel) => page.evaluate((s) => { document.querySelectorAll(".gr-focus").forEach((e) => e.classList.remove("gr-focus")); const e = document.querySelector(s); if (e) { e.classList.add("gr-focus"); e.scrollIntoView({ block: "center" }); } }, sel);

  // Plays one scene: captions spread over the line by length; `beats` run at fractions of the scene.
  async function play(i, beats = []) {
    const s = SCENES[i], d = dur(s.vo) + PAD;
    await overlay(); await caption("");
    await page.waitForTimeout(150);
    const start = now();
    const total = s.captions.reduce((a, c) => a + c.length, 0);
    let at = 0; const plan = s.captions.map((c) => { const p = { t: at, c }; at += (c.length / total) * (d - PAD); return p; });
    const events = [...plan.map((p) => ({ t: p.t, fn: () => caption(p.c) })), ...beats.map((b) => ({ t: b.at * d, fn: b.fn }))].sort((a, b) => a.t - b.t);
    for (const e of events) { const wait = start + e.t - now(); if (wait > 0) await page.waitForTimeout(wait * 1000); await e.fn(); }
    const rest = start + d - now(); if (rest > 0) await page.waitForTimeout(rest * 1000);
    marks.push({ scene: i + 1, vo: s.vo, start, end: start + d });
  }

  // 1. Title
  await page.setContent(card("An agent should know the price of a job before it asks you to pay.", "Going Rate shows the going rate of a task before you tap your passkey on Kite.", "SERV Reasoning · Kite Passport"));
  await play(0);

  // 2. Contrast, left column: refused
  await page.goto(`${SITE}/contrast`, { waitUntil: "networkidle" });
  await page.waitForSelector("#vs .sheet");
  await page.evaluate(() => window.scrollTo(0, 0));
  await play(1, [
    { at: 0.25, fn: () => focus("#vs .sheet:nth-child(1)") },
    { at: 0.62, fn: () => focus("#vs .sheet:nth-child(1) .result") },
  ]);

  // 3. Main card: the docs-example ask, classified and explained by SERV (wait for SERV untimed)
  await page.goto(`${SITE}/`, { waitUntil: "networkidle" });
  await page.fill("#s1 [data-f=task_summary]", "Generate a 5-second 720p product teaser video");
  await page.fill("#s1 [data-f=per_tx_usd]", "1"); await page.fill("#s1 [data-f=total_usd]", "5"); await page.fill("#s1 [data-f=ttl_hours]", "1");
  // The narration says SERV explains the card, so re-run until SERV's own sentence is shown (not the template).
  for (let tryNo = 1; tryNo <= 3; tryNo++) {
    await page.click("#s1 [data-act=check]");
    await page.waitForSelector("#sheet .serv", { timeout: 120000 });
    const fromServ = await page.$eval("#sheet .serv .ids", (e) => e.textContent.includes("Classified and explained"));
    console.error(`scene 3 try ${tryNo}: ${fromServ ? "SERV sentence" : "template"}`);
    if (fromServ) break;
  }
  await page.evaluate(() => document.querySelector("#sheet").scrollIntoView({ block: "start" }));
  await page.waitForTimeout(600);
  await play(2, [
    { at: 0.05, fn: () => focus("#sheet .type") },
    { at: 0.28, fn: () => focus("#sheet .serv") },
    { at: 0.58, fn: () => focus("#sheet table") },
    { at: 0.86, fn: () => focus("#sheet .cue") },
  ]);

  // 4. The going rate in Kite's --task-summary
  await play(3, [{ at: 0.0, fn: () => focus("#sheet .kite-summary") }]);

  // 5. Contrast, right column: paid on the first approval
  await page.goto(`${SITE}/contrast`, { waitUntil: "networkidle" });
  await page.waitForSelector("#vs .sheet");
  await play(4, [
    { at: 0.05, fn: () => focus("#vs .sheet:nth-child(2)") },
    { at: 0.45, fn: () => focus("#vs .sheet:nth-child(2) .result") },
    { at: 0.75, fn: () => page.hover("#vs .sheet:nth-child(2) .result a").catch(() => {}) },
  ]);

  // 6. Ledger
  await page.goto(`${SITE}/ledger`, { waitUntil: "networkidle" });
  await page.waitForSelector("#payments th");
  await page.evaluate(() => window.scrollTo(0, 0));
  await play(5, [
    { at: 0.05, fn: () => focus("#stats") },
    { at: 0.35, fn: () => focus("#payments") },
  ]);

  // 7. Close
  await page.setContent(card("The going rate of the task, so you approve once.", "going-rate.ahmardchain.workers.dev", "github.com/ahmardchain/going-rate"));
  await play(6);

  await page.waitForTimeout(500);
  const video = page.video();
  await context.close(); await browser.close();
  const raw = await video.path();
  fs.writeFileSync(path.join(DIR, "marks.json"), JSON.stringify({ raw, marks }, null, 1));
  console.log(JSON.stringify({ raw, marks }));
})();
