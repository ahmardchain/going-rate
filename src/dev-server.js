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
    const file = req.url === "/" ? "index.html" : req.url.slice(1).replace(/\.\./g, "");
    try {
      const type = file.endsWith(".html") ? "text/html; charset=utf-8" : file.endsWith(".svg") ? "image/svg+xml" : "text/plain";
      res.writeHead(200, { "Content-Type": type });
      return res.end(await readFile(root(`../public/${file}`)));
    } catch { res.writeHead(404); return res.end("not found"); }
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const request = new Request(url, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
  const response = await handle(request, env, store);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(await response.text());
}).listen(PORT, () => console.log(`Going Rate dev server on http://localhost:${PORT}`));
