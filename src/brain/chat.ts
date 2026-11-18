import Anthropic from "@anthropic-ai/sdk";
import { spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { BrainSpec as BaseSpec, CallRecord } from "./gateway.js";

/**
 * The multi-turn model gateway (E1b). Same rules as gateway.ts, which stays byte-identical because
 * E1a froze it: it runs in the harness, outside the agent's sandbox, and is the only place that
 * holds a model API key. The sandboxed agent sends it {system, messages, seed} and gets back the
 * model's text and a call record. Full model IDs, provider default sampling, no fallback model.
 *
 * Providers: anthropic, ollama, deepseek, openai (as in gateway.ts) and google (new for E1b:
 * the Gemini API, key from GOOGLE_API_KEY).
 *
 * This file was added at build time (14 Nov 2026) instead of editing gateway.ts, so E1a's frozen
 * hashes still hold. It is frozen with E1b's files (TIMESTAMP.md lists it as an addition).
 */

export type ChatProvider = "anthropic" | "ollama" | "deepseek" | "openai" | "google";
export interface ChatSpec extends Omit<BaseSpec, "provider"> {
  provider: ChatProvider;
}
export interface Msg {
  role: "user" | "assistant";
  content: string;
}
export interface ChatReply {
  text: string;
  call: CallRecord & { provider: ChatProvider | BaseSpec["provider"] };
}

function key(provider: "deepseek" | "openai" | "google"): string {
  const env = provider === "deepseek" ? process.env.DEEPSEEK_API_KEY : provider === "openai" ? process.env.OPENAI_API_KEY : process.env.GOOGLE_API_KEY;
  if (env) return env;
  if (provider === "deepseek") {
    const r = spawnSync("security", ["find-generic-password", "-s", "deepseek-api-key", "-w"], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  throw new Error(`no API key for ${provider}`);
}

export async function askChat(spec: ChatSpec, system: string, messages: Msg[], seed?: number): Promise<ChatReply> {
  const t0 = Date.now();
  const call: ChatReply["call"] = { provider: spec.provider as any, requestedModel: spec.model, seed: spec.provider === "ollama" ? seed : undefined, effort: spec.effort, ms: 0 };
  const done = (text: string) => ({ text, call: { ...call, ms: Date.now() - t0 } });
  try {
    if (spec.provider === "anthropic") {
      const client = new Anthropic({ maxRetries: 4 });
      const res = await client.messages.create({
        model: spec.model,
        max_tokens: spec.maxTokens ?? 16000,
        system,
        output_config: { effort: spec.effort ?? "medium" },
        messages,
      } as Anthropic.MessageCreateParamsNonStreaming);
      call.answeredModel = res.model;
      call.stopReason = res.stop_reason ?? undefined;
      call.refusalCategory = (res as any).stop_details?.category ?? (res.stop_reason === "refusal" ? "refusal" : null);
      call.inputTokens = res.usage.input_tokens;
      call.outputTokens = res.usage.output_tokens;
      return done(res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n"));
    }
    if (spec.provider === "ollama") {
      const url = spec.ollamaUrl ?? process.env.OLLAMA_URL ?? "http://localhost:11434";
      const r = await fetch(`${url}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: spec.model, messages: [{ role: "system", content: system }, ...messages], think: false, stream: false, options: seed === undefined ? {} : { seed } }),
        signal: AbortSignal.timeout(300_000),
      });
      const j = (await r.json()) as { model?: string; message?: { content?: string }; done_reason?: string; prompt_eval_count?: number; eval_count?: number; error?: string };
      if (j.error) throw new Error(j.error);
      call.answeredModel = j.model;
      call.stopReason = j.done_reason;
      call.inputTokens = j.prompt_eval_count;
      call.outputTokens = j.eval_count;
      return done(j.message?.content ?? "");
    }
    if (spec.provider === "deepseek" || spec.provider === "openai") {
      const base = spec.provider === "deepseek" ? "https://api.deepseek.com" : "https://api.openai.com/v1";
      const r = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key(spec.provider)}` },
        body: JSON.stringify({
          model: spec.model,
          ...(spec.provider === "openai" ? { max_completion_tokens: spec.maxTokens ?? 16000 } : { max_tokens: spec.maxTokens ?? 16000 }),
          messages: [{ role: "system", content: system }, ...messages],
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
      if (!c) throw new Error("no choices in the response");
      if (!j.model) throw new Error("the response does not name the answering model");
      const refused = !!c.message?.refusal || c.finish_reason === "content_filter";
      if (!refused && !(c.message?.content ?? "").trim()) throw new Error(`empty answer (finish reason: ${c.finish_reason})`);
      call.answeredModel = j.model;
      call.stopReason = refused ? "refusal" : c.finish_reason;
      call.refusalCategory = c.message?.refusal ? "refusal" : c.finish_reason === "content_filter" ? "content_filter" : null;
      call.inputTokens = j.usage?.prompt_tokens;
      call.outputTokens = j.usage?.completion_tokens;
      return done(c.message?.content ?? "");
    }
    if (spec.provider === "google") {
      // Gemini API, generateContent. Default generation settings; nothing set but the system text.
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(spec.model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key("google") },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        }),
        signal: AbortSignal.timeout(600_000),
      });
      const j = (await r.json()) as {
        modelVersion?: string; error?: { message?: string; status?: string };
        promptFeedback?: { blockReason?: string };
        candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
      };
      if (!r.ok || j.error) throw new Error(`HTTP ${r.status}: ${j.error?.status ?? ""} ${j.error?.message ?? ""}`);
      if (!j.modelVersion) throw new Error("the response does not name the answering model");
      call.answeredModel = j.modelVersion;
      call.inputTokens = j.usageMetadata?.promptTokenCount;
      call.outputTokens = (j.usageMetadata?.candidatesTokenCount ?? 0) + (j.usageMetadata?.thoughtsTokenCount ?? 0);
      if (j.promptFeedback?.blockReason) {
        call.stopReason = "refusal";
        call.refusalCategory = j.promptFeedback.blockReason;
        return done("");
      }
      const c = j.candidates?.[0];
      if (!c) throw new Error("no candidates in the response");
      const safety = ["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII"].includes(c.finishReason ?? "");
      call.stopReason = safety ? "refusal" : c.finishReason;
      call.refusalCategory = safety ? c.finishReason ?? null : null;
      const text = (c.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("\n");
      if (!safety && !text.trim()) throw new Error(`empty answer (finish reason: ${c.finishReason})`);
      return done(text);
    }
    throw new Error(`unknown provider ${spec.provider}`);
  } catch (e) {
    return { text: "", call: { ...call, ms: Date.now() - t0, error: String(e).slice(0, 500) } };
  }
}

/** HTTP front for the sandboxed agent: POST /chat {system, messages, seed} -> {text, call}. */
export async function startChatGateway(spec: ChatSpec, ask = askChat): Promise<{ url: string; calls: ChatReply["call"][]; close(): Promise<void> }> {
  const calls: ChatReply["call"][] = [];
  const server: Server = createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/chat") return res.writeHead(404).end();
    let raw = "";
    for await (const c of req) raw += c;
    let body: { system?: string; messages?: Msg[]; seed?: number };
    try {
      body = JSON.parse(raw);
    } catch {
      return res.writeHead(400).end();
    }
    const msgs = Array.isArray(body.messages) ? body.messages.filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string") : [];
    const reply = await ask(spec, String(body.system ?? ""), msgs, body.seed);
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
