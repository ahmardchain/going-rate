// Local dev server: same handler as the Worker, outcomes in a local file.
// Run: SERV_API_KEY=... npm run dev
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { handle } from "./app.js";
import { fileStore } from "./store-file.js";

const PORT = Number(process.env.PORT || 8787);
const root = (p) => fileURLToPath(new URL(p, import.meta.url));
const store = fileStore(root("../data/outcomes.local.jsonl"));
const env = { SERV_API_KEY: process.env.SERV_API_KEY, INGEST_TOKEN: process.env.INGEST_TOKEN };

http.createServer(async (req, res) => {
  const url = `http://localhost:${PORT}${req.url}`;
  if (!req.url.startsWith("/api/")) {
    // Same paths as Workers static assets: "/" -> index.html, "/ledger" -> ledger.html.
    const path = req.url.split("?")[0].replace(/\.\./g, "");
    const file = path === "/" ? "index.html" : /\.[a-z]+$/.test(path) ? path.slice(1) : `${path.slice(1)}.html`;
    try {
      const TYPES = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", json: "application/json", svg: "image/svg+xml", png: "image/png" };
      const type = TYPES[file.split(".").pop()] ?? "text/plain";
      const content = await readFile(root(`../public/${file}`)); // read first, so a missing file can still 404
      res.writeHead(200, { "Content-Type": type });
      return res.end(content);
    } catch { res.writeHead(404); return res.end("not found"); }
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const request = new Request(url, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
  const response = await handle(request, env, store);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(await response.text());
}).listen(PORT, () => console.log(`Going Rate dev server on http://localhost:${PORT}`));
