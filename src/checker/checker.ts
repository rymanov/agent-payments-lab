import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";
import type { MandateConfig } from "../config.js";
import type { DecisionLog } from "./log.js";
import type { Signer } from "./payer.js";
import { checkPerPayment, matchService, validateTerms } from "./rules.js";
import type { Ledger } from "./store.js";

/** What the agent may send. Nothing else: no amount, no payTo, no signature. */
export interface PayRequest {
  requestId: string;
  agent: string;
  task: string;
  url: string;
}

export interface PayResult {
  status: "paid" | "free" | "blocked" | "duplicate" | "error";
  requestId: string;
  rule?: string;
  reason?: string;
  httpStatus?: number;
  body?: string;
  tx?: string | null;
}

export interface CheckerDeps {
  cfg: MandateConfig;
  ledger: Ledger;
  log: DecisionLog;
  signer: Signer;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const ID = /^[A-Za-z0-9_.:-]{1,128}$/; // was {8,128} without "_": E1a pilot, models use short IDs such as "req_001"
const MAX_BODY = 1_000_000;

async function readBody(res: Response): Promise<string> {
  const text = await res.text();
  return text.length > MAX_BODY ? text.slice(0, MAX_BODY) : text;
}

export class MandateChecker {
  private f: typeof fetch;
  constructor(private d: CheckerDeps) {
    this.f = d.fetch ?? fetch;
  }

  async pay(input: unknown): Promise<PayResult> {
    const { cfg, ledger, log } = this.d;
    const req = input as Partial<PayRequest>;
    const base = {
      requestId: String(req?.requestId ?? ""),
      agent: String(req?.agent ?? ""),
      task: String(req?.task ?? ""),
      url: String(req?.url ?? ""),
    };

    // 0. Shape. Refuse anything that is not exactly the four fields we expect.
    const keys = req && typeof req === "object" ? Object.keys(req).sort().join(",") : "";
    if (keys !== "agent,requestId,task,url" || !ID.test(base.requestId) || !base.task || base.task.length > 200) {
      log.write({ ...base, service: null, amount: null, rule: "request_shape", result: "blocked", reason: `bad request fields: ${keys}` });
      return { status: "blocked", requestId: base.requestId, rule: "request_shape", reason: "request must be {requestId, agent, task, url}" };
    }

    // 1. Claim the request ID before anything else. A retry or a concurrent copy stops here.
    const claim = ledger.claim(base.requestId, base.agent, base.task, base.url);
    if (!claim.claimed) {
      const e = claim.existing;
      log.write({ ...base, service: e.service, amount: e.amount, rule: "request_id", result: "duplicate", reason: `request ID already used (status ${e.status})`, tx: e.tx });
      return { status: "duplicate", requestId: base.requestId, rule: "request_id", reason: `already handled: ${e.status}`, tx: e.tx };
    }

    const block = (rule: string, reason: string, extra: { service?: string | null; amount?: string | null; terms?: unknown } = {}): PayResult => {
      ledger.block(base.requestId, rule, reason, extra.service ?? null, extra.amount ?? null);
      log.write({ ...base, service: extra.service ?? null, amount: extra.amount ?? null, rule, result: "blocked", reason, terms: extra.terms });
      return { status: "blocked", requestId: base.requestId, rule, reason };
    };

    // 2. Agent and service.
    if (!cfg.agents.includes(base.agent)) return block("agent", `agent "${base.agent}" is not on the mandate`);
    const svc = matchService(base.url, cfg);
    if ("error" in svc) return block("allowed_service", svc.error);

    // 3. Ask the service for its terms. No redirects: a 302 to elsewhere is a block.
    let first: Response;
    try {
      first = await this.f(base.url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(this.d.timeoutMs ?? 15000) });
    } catch (e) {
      return block("network", `service unreachable: ${(e as Error).message}`, { service: svc.id });
    }
    if (first.status >= 300 && first.status < 400) {
      return block("redirect", `service redirected to ${first.headers.get("location") ?? "?"}`, { service: svc.id });
    }
    if (first.status !== 402) {
      const body = await readBody(first);
      ledger.setStatus(base.requestId, "released", { reason: "no payment needed" });
      log.write({ ...base, service: svc.id, amount: "0", rule: "none", result: "free", reason: `HTTP ${first.status} without payment` });
      return { status: "free", requestId: base.requestId, httpStatus: first.status, body };
    }

    // 4. Decode and validate the 402 terms against the pinned service.
    const header = first.headers.get("PAYMENT-REQUIRED");
    if (!header) return block("terms", "402 without PAYMENT-REQUIRED header", { service: svc.id });
    let terms: PaymentRequired;
    try {
      terms = decodePaymentRequiredHeader(header);
    } catch (e) {
      return block("terms", `PAYMENT-REQUIRED does not decode: ${(e as Error).message}`, { service: svc.id });
    }
    const v = validateTerms(terms, base.url, svc, cfg);
    if (!v.ok) return block(v.rule, v.reason, { service: svc.id, terms });
    const reqm = v.requirement;

    // 5. Per-payment limit, then the atomic budget / per-task / duplicate check and reservation.
    const over = checkPerPayment(reqm.amount, cfg);
    if (over) return block("per_payment_limit", over, { service: svc.id, amount: reqm.amount, terms });
    const r = ledger.reserve(base.requestId, { ...base, service: svc.id, amount: reqm.amount }, cfg.limits);
    if (r) {
      log.write({ ...base, service: svc.id, amount: reqm.amount, rule: r.rule, result: "blocked", reason: r.reason, terms });
      return { status: "blocked", requestId: base.requestId, ...r };
    }

    // 6. Sign. Only now does the key get used.
    let sigHeader: string;
    try {
      const payload = await this.d.signer.sign(terms.resource, reqm);
      sigHeader = encodePaymentSignatureHeader(payload);
    } catch (e) {
      ledger.setStatus(base.requestId, "released", { rule: "sign", reason: (e as Error).message });
      log.write({ ...base, service: svc.id, amount: reqm.amount, rule: "sign", result: "error", reason: (e as Error).message, terms, accepted: reqm });
      return { status: "error", requestId: base.requestId, rule: "sign", reason: (e as Error).message };
    }
    ledger.setStatus(base.requestId, "signed");

    // 7. Send the paid request and read the settlement.
    let paid: Response;
    try {
      paid = await this.f(base.url, {
        method: "GET",
        redirect: "manual",
        headers: { "PAYMENT-SIGNATURE": sigHeader },
        signal: AbortSignal.timeout(this.d.timeoutMs ?? 60000),
      });
    } catch (e) {
      const reason = `paid request failed after signing: ${(e as Error).message}`;
      ledger.setStatus(base.requestId, "failed_after_sign", { reason });
      log.write({ ...base, service: svc.id, amount: reqm.amount, rule: "all_passed", result: "error", reason, terms, accepted: reqm });
      return { status: "error", requestId: base.requestId, reason };
    }
    const body = await readBody(paid);
    let settlement: ReturnType<typeof decodePaymentResponseHeader> | undefined;
    const pr = paid.headers.get("PAYMENT-RESPONSE");
    if (pr) {
      try {
        settlement = decodePaymentResponseHeader(pr);
      } catch {
        /* logged below as missing */
      }
    }
    const tx = settlement?.transaction || null;
    if (paid.status === 200 && settlement?.success) {
      ledger.setStatus(base.requestId, "settled", { tx });
      log.write({ ...base, service: svc.id, amount: reqm.amount, rule: "all_passed", result: "allowed", terms, accepted: reqm, tx, settlement });
      return { status: "paid", requestId: base.requestId, httpStatus: 200, body, tx };
    }
    const reason = `service answered ${paid.status}; settlement ${settlement ? JSON.stringify(settlement) : "missing"}`;
    ledger.setStatus(base.requestId, "failed_after_sign", { tx, reason });
    log.write({ ...base, service: svc.id, amount: reqm.amount, rule: "all_passed", result: "error", reason, terms, accepted: reqm, tx, settlement });
    return { status: "error", requestId: base.requestId, httpStatus: paid.status, reason, body, tx };
  }
}
