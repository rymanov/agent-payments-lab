import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseEnv } from "dotenv";
import { loadConfig, ROOT } from "../config.js";
import { MandateChecker } from "./checker.js";
import { DecisionLog } from "./log.js";
import { makeSigner } from "./payer.js";
import { Ledger } from "./store.js";

/**
 * The mandate checker process. The only process that reads .env and holds the key.
 * The agent talks to it over HTTP on 127.0.0.1 and can only ask "fetch this URL, pay if allowed".
 */
// Parse .env into a local object, not process.env, so the key never sits in the
// environment that child processes or tools would inherit.
const secrets = parseEnv(readFileSync(path.join(ROOT, ".env")));
const cfg = loadConfig();
const signer = makeSigner(secrets.PAYER_PRIVATE_KEY ?? "");
mkdirSync(path.join(ROOT, "data"), { recursive: true });
const ledger = new Ledger(path.join(ROOT, "data", "ledger.sqlite"));
const log = new DecisionLog(path.join(ROOT, "logs", "decisions.jsonl"));
const checker = new MandateChecker({ cfg, ledger, log, signer });
const port = Number(process.env.CHECKER_PORT ?? 4020);

const server = createServer(async (req, res) => {
  const send = (code: number, obj: unknown) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(obj));
  };
  if (req.method === "GET" && req.url === "/status") {
    return send(200, { payer: signer.address, weeklySpent: ledger.weeklySpent().toString(), weeklyBudget: cfg.limits.weeklyBudget });
  }
  if (req.method !== "POST" || req.url !== "/pay") return send(404, { error: "POST /pay only" });
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) return send(413, { error: "too large" });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return send(400, { error: "invalid JSON" });
  }
  send(200, await checker.pay(body));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`mandate checker on http://127.0.0.1:${port} payer=${signer.address} network=${cfg.network}`);
});
