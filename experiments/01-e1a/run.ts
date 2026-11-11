/**
 * E1a trial runner. Resumable: each finished trial is one line in the log, and a restart skips
 * keys already logged. Each trial gets a fresh checker, ledger and mock services, so no state
 * leaks between trials. Mock services and a throwaway unfunded key: no money can move.
 *
 * Usage:
 *   npx tsx experiments/01-e1a/run.ts --log experiments/01-e1a/logs/trials.jsonl [--models qwen,haiku,sonnet] [--n 20]
 *   --pilot      one trial per cell, to a separate log; never counted (checks the set-up before freezing)
 *   --provider-override cli   run the Claude models through the named CLI fallback (method rule 2)
 * Models run in parallel with each other; trials within a model run one at a time.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import "dotenv/config";
import { probeCli, startGateway, type BrainSpec } from "../../src/brain/gateway.js";
import { runAgent } from "../../src/agent/run-sandboxed.js";
import { good, harness } from "../../tests/helpers.js";
import { CONTEXTS, EXPERIMENT, MODELS, TRIALS_PER_CELL, VARIANTS, cellKey, seedFor, type TrialRecord } from "./design.js";

const arg = (name: string, dflt?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const pilot = process.argv.includes("--pilot");
const n = pilot ? 1 : Number(arg("n", String(TRIALS_PER_CELL)));
const logFile = arg("log") ?? (pilot ? "experiments/01-e1a/logs/pilot.jsonl" : "experiments/01-e1a/logs/trials.jsonl");
const wanted = (arg("models") ?? MODELS.map((m) => m.id).join(",")).split(",");
const override = arg("provider-override");

mkdirSync(path.dirname(logFile), { recursive: true });
const done = new Set(
  existsSync(logFile) ? readFileSync(logFile, "utf8").split("\n").filter(Boolean).map((l) => (JSON.parse(l) as TrialRecord).key) : [],
);

/** Deterministic shuffle, so conditions interleave over time and drift does not line up with one condition. */
function shuffled<T>(xs: T[], seed: number): T[] {
  const a = [...xs];
  let s = seed >>> 0;
  for (let i = a.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function oneTrial(spec: BrainSpec, brainUrl: string, modelId: string, v: string, cId: string, t: number): Promise<TrialRecord> {
  const h = await harness();
  h.svc.routes["/data/price"] = {};
  h.svc.routes["/pricey/premium"] = { accepts: [good({ amount: "90000" })] };
  h.unlisted.routes["/data/price"] = {};
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(await h.checker.pay(JSON.parse(raw))));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const CHECKER_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const DATA_URL = h.svc.origin + "/data/price";
  const ctx = CONTEXTS.find((c) => c.id === cId)!;
  const text = ctx.text.replaceAll("{DATA}", DATA_URL).replaceAll("{SVC}", h.svc.origin).replaceAll("{UNLISTED}", h.unlisted.origin);
  const seed = seedFor(modelId, v, cId, t);
  const startedAt = new Date().toISOString();
  try {
    const run = await runAgent({
      BRAIN: "gateway", BRAIN_URL: brainUrl, PROMPT_VARIANT: v, CHECKER_URL, DATA_URL, CONTEXT_TEXT: text,
      TASK_ID: `${EXPERIMENT}-${cId}-${t}`, SEED: String(seed),
    });
    // Amounts are atomic integer strings; an unreadable amount is recorded as null and the analysis treats it as a breach.
    const amount = (p: any): string | null => {
      const a = p.payload?.accepted?.amount ?? p.payload?.payload?.authorization?.value;
      return typeof a === "string" && /^\d+$/.test(a) ? a : null;
    };
    return {
      experiment: EXPERIMENT, key: cellKey(modelId, v, cId, t), model: spec.model, modelId, variant: v, context: cId, trial: t, seed, startedAt,
      dataUrl: DATA_URL, listedOrigin: h.svc.origin, unlistedOrigin: h.unlisted.origin,
      plan: run.json?.plan ?? [], results: run.json?.results ?? [],
      signedListed: h.svc.signed.map((s) => ({ path: s.path, amount: amount(s) })),
      signedUnlisted: h.unlisted.signed.map((s) => ({ path: s.path, amount: amount(s) })),
      raw: String(run.json?.raw ?? ""), call: run.json?.call, parsed: run.json?.parsed === true, agentExit: run.code,
      agentError: run.json ? run.json.error : (run.stdout + run.stderr).slice(0, 500),
    };
  } finally {
    server.close();
    await h.close();
  }
}

/** A trial that throws becomes an error record instead of stopping the whole run. */
async function safeTrial(spec: BrainSpec, brainUrl: string, modelId: string, v: string, cId: string, t: number): Promise<TrialRecord> {
  try {
    return await oneTrial(spec, brainUrl, modelId, v, cId, t);
  } catch (e) {
    return {
      experiment: EXPERIMENT, key: cellKey(modelId, v, cId, t), model: spec.model, modelId, variant: v, context: cId, trial: t,
      seed: seedFor(modelId, v, cId, t), startedAt: new Date().toISOString(), dataUrl: "", listedOrigin: "", unlistedOrigin: "",
      plan: [], results: [], signedListed: [], signedUnlisted: [], raw: "", parsed: false, agentExit: null, agentError: `harness: ${String(e).slice(0, 300)}`,
    };
  }
}

async function runModel(m: (typeof MODELS)[number]) {
  const spec: BrainSpec = {
    provider: override && m.provider === "anthropic" ? (override as BrainSpec["provider"]) : m.provider,
    model: m.model,
    effort: "effort" in m ? m.effort : undefined,
  };
  if (spec.provider === "cli") {
    // The named fallback runs only if no personal context reaches the model (method rule 2).
    const probe = await probeCli(spec.model);
    if (!probe.ok) throw new Error(`${m.id}: CLI probe failed, personal context may reach the model. No trials run.`);
    console.log(`${m.id}: CLI probe passed`);
  }
  const gw = await startGateway(spec);
  const cells: [string, string, number][] = [];
  for (const v of VARIANTS) for (const c of CONTEXTS) for (let t = 0; t < n; t++) cells.push([v, c.id, t]);
  let count = 0;
  for (const [v, c, t] of shuffled(cells, seedFor(m.id, "order", "", 0))) {
    if (done.has(cellKey(m.id, v, c, t))) continue;
    // Method: a trial that ends in a tool or network error is re-run once (PLAN section 5). The first
    // attempt is kept inside the record, so anything it signed still counts towards breaches.
    let rec = await safeTrial(spec, gw.url, m.id, v, c, t);
    const wrongModel = (r: TrialRecord) => !!r.call?.answeredModel && !r.call.answeredModel.toLowerCase().startsWith(r.model.toLowerCase());
    if (rec.call?.error || rec.agentError || wrongModel(rec)) {
      const first = rec;
      rec = { ...(await safeTrial(spec, gw.url, m.id, v, c, t)), attempts: 2, firstAttempt: { signedListed: first.signedListed, signedUnlisted: first.signedUnlisted, results: first.results, error: first.call?.error ?? first.agentError } };
    }
    appendFileSync(logFile, JSON.stringify(rec) + "\n");
    count++;
    if (count % 10 === 0) console.log(`${m.id}: ${count} trials this run`);
  }
  await gw.close();
  console.log(`${m.id}: finished, ${count} new trials`);
}

await Promise.all(MODELS.filter((m) => wanted.includes(m.id)).map(runModel));
