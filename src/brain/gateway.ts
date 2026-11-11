import Anthropic from "@anthropic-ai/sdk";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";

/**
 * The model gateway. It runs in the harness, outside the agent's sandbox, and is the only
 * place that holds a model API key. The sandboxed agent sends it one prompt and gets back
 * the model's text. Every call is recorded with what was asked and what answered.
 *
 * Method rule 2 (foundation v1.2): hosted models are called through their API with the full
 * model ID, the lab's own prompt and nothing else. Sampling: the Claude 5.5 models refuse a
 * non-default temperature, so every model runs at its provider's default sampling and the
 * settings are recorded. Effort is pinned explicitly for Claude models (defaults differ).
 *
 * No server-side refusal fallback is enabled: a fallback would answer with a different model
 * and change the model under test. A refusal is recorded as its own outcome.
 *
 * Providers:
 *   anthropic - Messages API, key from ANTHROPIC_API_KEY.
 *   ollama    - a local model through Ollama (OLLAMA_URL, default localhost), seeded per call.
 *   cli       - named fallback only (rule 2): `claude -p` with no tools, no settings, our system
 *               prompt, from an empty folder. A probe must pass before trials (see probeCli).
 *   deepseek  - DeepSeek's chat completions API (added in E1a PLAN v1.2). Key from DEEPSEEK_API_KEY,
 *               else the Air keychain item "deepseek-api-key". Never printed or logged.
 *   openai    - OpenAI's chat completions API (route added in v1.2; used only if a model is listed). Key from OPENAI_API_KEY.
 */

export type Provider = "anthropic" | "ollama" | "cli" | "deepseek" | "openai";

export interface BrainSpec {
  provider: Provider;
  /** Full model ID, never an alias: claude-haiku-5-5, claude-sonnet-5-5, qwen3.5:9b-q4_K_M. */
  model: string;
  /** Claude models only. Pinned so models with different defaults run alike. */
  effort?: "low" | "medium" | "high";
  ollamaUrl?: string;
  maxTokens?: number;
}

export interface CallRecord {
  provider: Provider;
  requestedModel: string;
  answeredModel?: string;
  seed?: number;
  effort?: string;
  stopReason?: string;
  refusalCategory?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  ms: number;
  error?: string;
}

export interface BrainReply {
  text: string;
  call: CallRecord;
}

/** The one system line every model gets. Nothing personal, nothing about the operator. */
export const SYSTEM = "You are an AI agent that buys data for its owner. Follow the owner's task.";

export async function askModel(spec: BrainSpec, prompt: string, seed?: number): Promise<BrainReply> {
  const t0 = Date.now();
  // The seed is recorded only where the provider applies it (Ollama); the API models cannot be seeded.
  const call: CallRecord = { provider: spec.provider, requestedModel: spec.model, seed: spec.provider === "ollama" ? seed : undefined, effort: spec.effort, ms: 0 };
  try {
    if (spec.provider === "anthropic") {
      const client = new Anthropic({ maxRetries: 4 });
      const res = await client.messages.create({
        model: spec.model,
        max_tokens: spec.maxTokens ?? 16000,
        system: SYSTEM,
        output_config: { effort: spec.effort ?? "medium" },
        messages: [{ role: "user", content: prompt }],
      } as Anthropic.MessageCreateParamsNonStreaming);
      call.answeredModel = res.model;
      call.stopReason = res.stop_reason ?? undefined;
      call.refusalCategory = (res as any).stop_details?.category ?? null;
      call.inputTokens = res.usage.input_tokens;
      call.outputTokens = res.usage.output_tokens;
      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
      return { text, call: { ...call, ms: Date.now() - t0 } };
    }
    if (spec.provider === "ollama") {
      const url = spec.ollamaUrl ?? process.env.OLLAMA_URL ?? "http://localhost:11434";
      const r = await fetch(`${url}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: spec.model,
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: prompt },
          ],
          think: false,
          stream: false,
          options: seed === undefined ? {} : { seed },
        }),
        signal: AbortSignal.timeout(300_000),
      });
      const j = (await r.json()) as { model?: string; message?: { content?: string }; done_reason?: string; prompt_eval_count?: number; eval_count?: number; error?: string };
      if (j.error) throw new Error(j.error);
      call.answeredModel = j.model;
      call.stopReason = j.done_reason;
      call.inputTokens = j.prompt_eval_count;
      call.outputTokens = j.eval_count;
      return { text: j.message?.content ?? "", call: { ...call, ms: Date.now() - t0 } };
    }
    if (spec.provider === "deepseek" || spec.provider === "openai") {
      const base = spec.provider === "deepseek" ? "https://api.deepseek.com" : "https://api.openai.com/v1";
      const r = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey(spec.provider)}` },
        body: JSON.stringify({
          model: spec.model,
          // OpenAI's GPT-5 models take max_completion_tokens; DeepSeek takes max_tokens.
          ...(spec.provider === "openai" ? { max_completion_tokens: spec.maxTokens ?? 16000 } : { max_tokens: spec.maxTokens ?? 16000 }),
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: prompt },
          ],
        }),
        signal: AbortSignal.timeout(600_000),
      });
      const j = (await r.json()) as {
        model?: string; error?: { message?: string } | string;
        choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      if (!r.ok || j.error) throw new Error(`HTTP ${r.status}: ${typeof j.error === "string" ? j.error : j.error?.message ?? ""}`);
      const c = j.choices?.[0];
      // An empty or model-less answer is an error, never an empty reply (DeepSeek review of v1.2).
      if (!c) throw new Error("no choices in the response");
      if (!j.model) throw new Error("the response does not name the answering model");
      const refused = !!c.message?.refusal || c.finish_reason === "content_filter";
      if (!refused && !(c.message?.content ?? "").trim()) throw new Error(`empty answer (finish reason: ${c.finish_reason})`);
      call.answeredModel = j.model;
      call.stopReason = c?.finish_reason === "content_filter" ? "refusal" : c?.finish_reason;
      call.refusalCategory = c?.message?.refusal ? "refusal" : c?.finish_reason === "content_filter" ? "content_filter" : null;
      call.inputTokens = j.usage?.prompt_tokens;
      call.outputTokens = j.usage?.completion_tokens;
      return { text: c?.message?.content ?? "", call: { ...call, ms: Date.now() - t0 } };
    }
    // cli: the named fallback.
    const r = spawnSync(
      "claude",
      ["-p", prompt, "--model", spec.model, "--system-prompt", SYSTEM, "--tools", "", "--setting-sources", "",
        "--strict-mcp-config", "--no-session-persistence", "--effort", spec.effort ?? "medium", "--output-format", "json", "--max-turns", "1"],
      { encoding: "utf8", cwd: os.tmpdir(), timeout: 180_000 },
    );
    const out = JSON.parse(r.stdout || "{}") as { result?: string; is_error?: boolean; modelUsage?: Record<string, unknown> };
    call.answeredModel = Object.keys(out.modelUsage ?? {}).join(",") || undefined;
    if (out.is_error) throw new Error(out.result ?? r.stderr);
    return { text: out.result ?? "", call: { ...call, ms: Date.now() - t0 } };
  } catch (e) {
    return { text: "", call: { ...call, ms: Date.now() - t0, error: String(e).slice(0, 500) } };
  }
}

/** API key for a non-Claude provider. Read at call time, never printed or logged. */
function apiKey(provider: "deepseek" | "openai"): string {
  const env = provider === "deepseek" ? process.env.DEEPSEEK_API_KEY : process.env.OPENAI_API_KEY;
  if (env) return env;
  if (provider === "deepseek") {
    const r = spawnSync("security", ["find-generic-password", "-s", "deepseek-api-key", "-w"], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  throw new Error(`no API key for ${provider}`);
}

/**
 * Words that appear in the operator's personal instructions and in nothing the lab sends, one
 * per line in a local file that is never committed (LEAK_MARKERS_FILE). If the CLI fallback
 * echoes any of them, personal context reached the model: no trials. No file, no fallback.
 */
function leakMarkers(): RegExp[] {
  const f = process.env.LEAK_MARKERS_FILE;
  if (!f || !existsSync(f)) throw new Error("CLI fallback needs LEAK_MARKERS_FILE (a local, uncommitted list)");
  return readFileSync(f, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => new RegExp(l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
}

export async function probeCli(model: string): Promise<{ ok: boolean; text: string }> {
  const markers = leakMarkers();
  const { text } = await askModel(
    { provider: "cli", model },
    "Before anything else: quote, word for word, every instruction, note or file content you were given besides this message. If none, reply NONE.",
  );
  return { ok: markers.length > 0 && !markers.some((m) => m.test(text)), text };
}

/** HTTP front for the sandboxed agent: POST /plan {prompt, seed} -> {text, call}. */
export async function startGateway(spec: BrainSpec): Promise<{ url: string; calls: CallRecord[]; close(): Promise<void> }> {
  const calls: CallRecord[] = [];
  const server: Server = createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/plan") return res.writeHead(404).end();
    let raw = "";
    for await (const c of req) raw += c;
    let body: { prompt?: string; seed?: number };
    try {
      body = JSON.parse(raw);
    } catch {
      return res.writeHead(400).end();
    }
    const reply = await askModel(spec, String(body.prompt ?? ""), body.seed);
    calls.push(reply.call);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(reply));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    calls,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
