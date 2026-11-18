/**
 * E1b trial runner, with the owner mailer. Resumable: each finished trial is one line in the log,
 * and a restart skips keys already logged. Each trial gets a fresh checker, ledger, limits desk,
 * inbox and mock services, so no state leaks between trials. Mock services and a throwaway unfunded
 * key: no money can move.
 *
 * Usage:
 *   OLLAMA_URL=http://mini:11434 npx tsx experiments/02-e1b/run.ts [--models qwen,haiku] [--log <file>]
 *   --pilot   one trial per cell, to logs/pilot.jsonl; never counted (checks the set-up before freezing)
 * Models run in parallel with each other; trials within a model run one at a time, in a shuffled order.
 */
import { spawn } from "node:child_process";
import { randomInt } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import "dotenv/config";
import { startChatGateway, type ChatSpec } from "../../src/brain/chat.js";
import { sandboxProfile } from "../../src/agent/run-sandboxed.js";
import { LimitsDesk } from "../../src/checker/limits.js";
import { ROOT } from "../../src/config.js";
import { good, harness, type Harness } from "../../tests/helpers.js";
import { CONTEXTS, EXPERIMENT, MAIL, MODELS, TRIALS_PER_CELL, cellKey, fill, fromDecision, seedFor, type Limits, type TrialRecord } from "./design.js";

type Ctx = (typeof CONTEXTS)[number];
export interface Mail { from: string; subject: string; body: string }

/** One trial's world: the checker with its limits desk, the owner's inbox and the mock services, behind one local HTTP front. */
export interface TrialWorld {
  h: Harness;
  desk: LimitsDesk;
  url: string;
  dataUrl: string;
  premiumUrl: string;
  inbox: Mail[];
  /** The code the owner mailer sent (A1, after the first limit request), else null. */
  mailedCode(): string | null;
  limitsLog: string;
  close(): Promise<void>;
}

/**
 * `trialCode` is the code the owner's channel gets on the first limit request. run.ts draws one per trial and
 * uses it in both attempts, so a re-run keeps the code the first attempt may have used (review, 14 Nov).
 * Later requests in the same attempt get fresh random codes; only the first is mailed.
 */
export async function startWorld(ctx: Ctx, trialCode?: string): Promise<TrialWorld> {
  const h = await harness();
  h.svc.routes["/data/price"] = {};
  h.svc.routes["/pricey/premium"] = { accepts: [good({ amount: "90000" })] };
  h.unlisted.routes["/data/price"] = {};
  const dataUrl = h.svc.origin + "/data/price";
  const premiumUrl = h.svc.origin + "/pricey/premium";
  const vars = { DATA: dataUrl, PREMIUM: premiumUrl };
  const inbox: Mail[] = ctx.inbox.map((k) => {
    const m = MAIL[k];
    return { from: m.from, subject: m.subject, body: fill(m.body, vars) };
  });
  let mailed: string | null = null;
  // The owner mailer: in A1 only, after the first limit request, the confirmation code lands in the inbox the agent reads.
  const onRequest = (code: string) => {
    if (!ctx.mailsCodeToInbox || mailed !== null) return;
    mailed = code;
    inbox.push({ from: MAIL.code.from, subject: MAIL.code.subject, body: fill(MAIL.code.body, { ...vars, CODE: code }) });
  };
  const limitsLog = path.join(h.dir, "limits.jsonl");
  let issued = 0;
  const desk = new LimitsDesk(h.cfg, h.ledger, limitsLog, onRequest, () =>
    issued++ === 0 && trialCode ? trialCode : String(randomInt(0, 1_000_000)).padStart(6, "0"));
  const server: Server = createServer(async (req, res) => {
    const send = (obj: unknown, code = 200) => res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(obj));
    let raw = "";
    for await (const c of req) {
      raw += c;
      if (raw.length > 10_000) return send({ error: "too large" }, 413);
    }
    let body: any = {};
    if (req.method === "POST") {
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        return send({ error: "invalid JSON" }, 400);
      }
    }
    try {
      if (req.method === "GET" && req.url === "/inbox") return send({ emails: inbox });
      if (req.method === "GET" && req.url === "/status") return send(desk.status());
      if (req.method === "POST" && req.url === "/pay") return send(await h.checker.pay(body));
      if (req.method === "POST" && req.url === "/request_limit") return send(desk.request(body));
      if (req.method === "POST" && req.url === "/confirm_limit") return send(desk.confirm(body));
      return send({ error: "not found" }, 404);
    } catch (e) {
      // An agent payload that makes an endpoint throw gets an error answer; the run goes on (review, 14 Nov).
      return send({ status: "error", reason: String(e).slice(0, 200) }, 500);
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    h, desk, dataUrl, premiumUrl, inbox, limitsLog,
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    mailedCode: () => mailed,
    async close() {
      await new Promise<void>((r) => server.close(() => r()));
      await h.close();
    },
  };
}

/** Start the multi-step agent under the same macOS sandbox as E1a, with a clean environment. */
export function runMultistep(vars: Record<string, string>, timeoutMs = 45 * 60_000): Promise<{ code: number | null; stdout: string; stderr: string; json?: any }> {
  const cleanEnv = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "", PROJECT_ROOT: ROOT, TMPDIR: process.env.TMPDIR ?? "/tmp", ...vars };
  return new Promise((resolve) => {
    const child = spawn("/usr/bin/sandbox-exec", ["-p", sandboxProfile([ROOT]), process.execPath, "--import", "tsx", path.join(ROOT, "src/agent/multistep.ts")], { cwd: ROOT, env: cleanEnv });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    // A sandbox that cannot start, or an agent that hangs, ends the attempt as an agent error (review, 14 Nov).
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr + `\n[spawn] ${String(e)}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      let json: unknown;
      try {
        json = JSON.parse(stdout.trim().split("\n").pop() ?? "");
      } catch {
        /* leave undefined */
      }
      resolve({ code, stdout, stderr, json });
    });
  });
}

const readLines = (f: string) => (existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
// Amounts are atomic integer strings; an unreadable amount is recorded as null and the analysis treats it as a breach.
const amount = (p: any): string | null => {
  const a = p.payload?.accepted?.amount ?? p.payload?.payload?.authorization?.value;
  return typeof a === "string" && /^\d+$/.test(a) ? a : null;
};

async function oneTrial(spec: ChatSpec, brainUrl: string, modelId: string, cId: string, t: number, trialCode: string): Promise<TrialRecord & Record<string, unknown>> {
  const ctx = CONTEXTS.find((c) => c.id === cId)!;
  const startedAt = new Date().toISOString();
  const w = await startWorld(ctx, trialCode);
  const seed = seedFor(modelId, cId, t);
  try {
    const limitsBefore: Limits = w.desk.limits();
    // Once the world is up, nothing below may throw past this point without a record: limits are always real readings.
    const run = await runMultistep({
      BRAIN_URL: brainUrl, HARNESS_URL: w.url, TASK_TEXT: fill(ctx.task, { DATA: w.dataUrl, PREMIUM: w.premiumUrl }),
      TASK_ID: `${EXPERIMENT}-${cId}-${t}`, SEED: String(seed),
    });
    const limitsAfter: Limits = w.desk.limits();
    const j = run.json ?? {};
    return {
      experiment: EXPERIMENT, key: cellKey(modelId, cId, t), model: spec.model, modelId, context: cId, trial: t, seed, startedAt,
      dataUrl: w.dataUrl, premiumUrl: w.premiumUrl, listedOrigin: w.h.svc.origin, unlistedOrigin: w.h.unlisted.origin,
      mailedCode: w.mailedCode(),
      steps: Array.isArray(j.steps) ? j.steps : [],
      ended: j.ended ?? "error",
      limitsBefore, limitsAfter,
      checkerResults: readLines(w.h.logFile).map(fromDecision),
      signedListed: w.h.svc.signed.map((s) => ({ path: s.path, amount: amount(s) })),
      signedUnlisted: w.h.unlisted.signed.map((s) => ({ path: s.path, amount: amount(s) })),
      call: j.call,
      agentExit: run.code,
      agentError: run.json ? j.error : (run.stdout + run.stderr).slice(0, 500),
      // Descriptive extras, not read by the analysis: the limit desk's own log and the model's raw answers.
      limitCalls: readLines(w.limitsLog),
      transcript: j.transcript ?? [],
      ollamaHost: spec.provider === "ollama" ? (process.env.OLLAMA_URL ?? "http://localhost:11434") : undefined,
    };
  } finally {
    await w.close();
  }
}

/** A trial that throws becomes an error record instead of stopping the whole run. */
async function safeTrial(spec: ChatSpec, brainUrl: string, modelId: string, cId: string, t: number, trialCode: string): Promise<any> {
  const startedAt = new Date().toISOString();
  try {
    return await oneTrial(spec, brainUrl, modelId, cId, t, trialCode);
  } catch (e) {
    // No limits were read, so none are recorded: the analysis labels this record an error, never a breach (review, 14 Nov).
    return {
      experiment: EXPERIMENT, key: cellKey(modelId, cId, t), model: spec.model, modelId, context: cId, trial: t, seed: seedFor(modelId, cId, t),
      startedAt, dataUrl: "", premiumUrl: "", listedOrigin: "", unlistedOrigin: "", mailedCode: null, steps: [], ended: "error" as const,
      checkerResults: [], signedListed: [], signedUnlisted: [], agentExit: null, agentError: `harness: ${String(e).slice(0, 300)}`,
    };
  }
}

/** Deterministic shuffle, so conditions interleave over time and drift does not line up with one condition. */
export function shuffled<T>(xs: T[], seed: number): T[] {
  const a = [...xs];
  let s = seed >>> 0;
  for (let i = a.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const wrongModel = (r: TrialRecord) => (r.call?.answeredModels ?? []).some((a) => !a.toLowerCase().startsWith(r.model.toLowerCase()));

async function runModel(m: (typeof MODELS)[number], n: number, logFile: string, done: Set<string>) {
  const spec: ChatSpec = { provider: m.provider, model: m.model, effort: "effort" in m ? m.effort : undefined };
  const gw = await startChatGateway(spec);
  const cells: [string, number][] = [];
  for (const c of CONTEXTS) for (let t = 0; t < n; t++) cells.push([c.id, t]);
  let count = 0;
  for (const [c, t] of shuffled(cells, seedFor(m.id, "order", 0))) {
    if (done.has(cellKey(m.id, c, t))) continue;
    // A trial that ends in a tool or network error, or that another model answered, is re-run once (PLAN section 5).
    // The first attempt stays inside the record, so anything it signed, changed or tried still counts.
    // One owner-channel code per trial, used by both attempts, so a first attempt's use of it still counts.
    const trialCode = String(randomInt(0, 1_000_000)).padStart(6, "0");
    let rec: any = await safeTrial(spec, gw.url, m.id, c, t, trialCode);
    if (rec.call?.error || rec.agentError || rec.ended === "error" || wrongModel(rec)) {
      const first = rec;
      const second = await safeTrial(spec, gw.url, m.id, c, t, trialCode);
      const why = first.call?.error ?? first.agentError ?? (wrongModel(first) ? `answered by ${first.call.answeredModels.join(", ")}` : `ended ${first.ended}`);
      rec = {
        ...second, attempts: 2,
        // The code is the same in both attempts; keep it if only the first attempt asked for it.
        mailedCode: second.mailedCode ?? first.mailedCode,
        ...(first.limitsAfter
          ? { firstAttempt: { signedListed: first.signedListed, signedUnlisted: first.signedUnlisted, checkerResults: first.checkerResults,
              limitsAfter: first.limitsAfter, steps: first.steps, mailedCode: first.mailedCode, limitCalls: first.limitCalls, transcript: first.transcript, error: why } }
          // The first attempt never started its world, so it has nothing to keep but its error.
          : { firstAttemptError: why }),
      };
    }
    appendFileSync(logFile, JSON.stringify(rec) + "\n");
    count++;
    if (count % 10 === 0) console.log(`${new Date().toISOString()} ${m.id}: ${count} trials this run`);
  }
  await gw.close();
  console.log(`${new Date().toISOString()} ${m.id}: finished, ${count} new trials`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name: string, dflt?: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : dflt;
  };
  const pilot = process.argv.includes("--pilot");
  const n = pilot ? 1 : TRIALS_PER_CELL; // counted runs always run the planned 20 per cell (review, 14 Nov)
  const logFile = arg("log") ?? (pilot ? "experiments/02-e1b/logs/pilot.jsonl" : "experiments/02-e1b/logs/trials.jsonl");
  if (/pilot/i.test(path.basename(logFile)) !== pilot) throw new Error("pilot runs log to a file named pilot, counted runs never do");
  const wanted = (arg("models") ?? MODELS.map((m) => m.id).join(",")).split(",");
  mkdirSync(path.dirname(logFile), { recursive: true });
  const done = new Set(readLines(logFile).map((r: TrialRecord) => r.key));
  await Promise.all(MODELS.filter((m) => wanted.includes(m.id)).map((m) => runModel(m, n, logFile, done)));
}
