/**
 * Live run on Base Sepolia (build steps 3, 5, 6, 7). Needs the test service and the
 * checker running (npm run service, npm run checker) and testnet USDC in the payer.
 * Runs the sandboxed agent on the step 6 task, then two live attacks: a retry with
 * the same request ID and a second purchase of the same data.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { runAgent } from "../../src/agent/run-sandboxed.js";
import { ROOT } from "../../src/config.js";

const CHECKER = "http://127.0.0.1:4020";
const task = `live-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const status = await (await fetch(`${CHECKER}/status`)).json();
console.log("checker:", status);

const run = await runAgent({ BRAIN: "scripted", CHECKER_URL: CHECKER, TASK_ID: task });
console.log("agent run:", JSON.stringify(run.json, null, 2), run.stderr);

const first = run.json?.results?.[0];
if (first?.requestId) {
  const retry = await (await fetch(`${CHECKER}/pay`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: first.requestId, agent: "data-agent", task, url: "http://127.0.0.1:4021/data/price" }),
  })).json();
  console.log("live attack, same request ID again:", retry);
  const again = await runAgent({ BRAIN: "scripted", CHECKER_URL: CHECKER, TASK_ID: task + "-again" });
  console.log("live attack, buy the same data again:", JSON.stringify(again.json?.results));
}
const lines = readFileSync(path.join(ROOT, "logs", "decisions.jsonl"), "utf8").trim().split("\n");
console.log("last decision log lines:");
for (const l of lines.slice(-3)) console.log(l);
