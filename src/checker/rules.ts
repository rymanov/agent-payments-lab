import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";
import type { MandateConfig, ServiceRule } from "../config.js";

/** Pure rule checks. No I/O, no key. Every function returns a reason when it blocks. */

export type Verdict =
  | { ok: true; requirement: PaymentRequirements; rejected: RejectedAccept[] }
  | { ok: false; rule: string; reason: string; rejected?: RejectedAccept[] };

export interface RejectedAccept {
  index: number;
  reasons: string[];
}

const eqAddr = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();

/**
 * Find the allowed service for a URL. Strict: the parsed origin must match exactly
 * and the path must sit under the pinned prefix. Userinfo in the URL is refused.
 */
export function matchService(rawUrl: string, cfg: MandateConfig): ServiceRule | { error: string } {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return { error: "url does not parse" };
  }
  if (u.username || u.password) return { error: "url carries user info (lookalike trick)" };
  if (u.protocol !== "https:" && u.protocol !== "http:") return { error: `protocol ${u.protocol} not allowed` };
  const path = decodeURIComponent(u.pathname);
  if (path.includes("..")) return { error: "path traversal in url" };
  const svc = cfg.services.find((s) => s.origin === u.origin && u.pathname.startsWith(s.pathPrefix));
  return svc ?? { error: `origin ${u.origin}${u.pathname} is not on the allowed-service list` };
}

/** Check one accept entry from the 402 against the pinned service terms. */
export function checkAccept(acc: PaymentRequirements, svc: ServiceRule, cfg: MandateConfig): string[] {
  const r: string[] = [];
  if (acc.scheme !== svc.scheme) r.push(`scheme ${acc.scheme} != pinned ${svc.scheme}`);
  if (acc.network !== svc.network) r.push(`network ${acc.network} != pinned ${svc.network}`);
  if (!eqAddr(acc.asset, svc.asset)) r.push(`asset ${acc.asset} != pinned ${svc.asset}`);
  if (!eqAddr(acc.payTo, svc.payTo)) r.push(`payTo ${acc.payTo} != pinned ${svc.payTo}`);
  if (typeof acc.amount !== "string" || !/^[0-9]+$/.test(acc.amount)) {
    r.push(`amount ${String(acc.amount)} is not an atomic integer`);
  } else {
    if (BigInt(acc.amount) === 0n) r.push("amount is zero");
    if (BigInt(acc.amount) > BigInt(svc.maxAmount)) r.push(`amount ${acc.amount} > service max ${svc.maxAmount}`);
  }
  if (!Number.isInteger(acc.maxTimeoutSeconds) || acc.maxTimeoutSeconds <= 0) {
    r.push(`maxTimeoutSeconds ${acc.maxTimeoutSeconds} invalid`);
  } else if (acc.maxTimeoutSeconds > cfg.limits.maxTimeoutSeconds) {
    r.push(`maxTimeoutSeconds ${acc.maxTimeoutSeconds} > cap ${cfg.limits.maxTimeoutSeconds} (long-lived authorization)`);
  }
  const extra = (acc.extra ?? {}) as Record<string, unknown>;
  const method = extra.assetTransferMethod ?? "eip3009";
  if (method !== "eip3009") r.push(`assetTransferMethod ${String(method)} not allowed (only eip3009; permit2 can carry approvals)`);
  if (svc.extra) {
    if (extra.name !== svc.extra.name || extra.version !== svc.extra.version) {
      r.push(`EIP-712 domain ${String(extra.name)}/${String(extra.version)} != pinned ${svc.extra.name}/${svc.extra.version}`);
    }
  }
  return r;
}

/**
 * Validate the whole 402 body. Picks the first accept that passes every pinned check.
 * Accepts that fail are listed with reasons so the log shows what the service tried.
 */
export function validateTerms(pr: PaymentRequired, requestedUrl: string, svc: ServiceRule, cfg: MandateConfig): Verdict {
  if (pr?.x402Version !== 2) return { ok: false, rule: "terms", reason: `x402Version ${pr?.x402Version} not supported (v2 only)` };
  if (!Array.isArray(pr.accepts) || pr.accepts.length === 0) return { ok: false, rule: "terms", reason: "402 has no accepts" };
  if (pr.resource?.url) {
    try {
      if (new URL(pr.resource.url).origin !== new URL(requestedUrl).origin) {
        return { ok: false, rule: "terms", reason: `402 resource ${pr.resource.url} is not the requested origin` };
      }
    } catch {
      return { ok: false, rule: "terms", reason: "402 resource url does not parse" };
    }
  }
  const rejected: RejectedAccept[] = [];
  for (let i = 0; i < pr.accepts.length; i++) {
    const reasons = checkAccept(pr.accepts[i], svc, cfg);
    if (reasons.length === 0) return { ok: true, requirement: pr.accepts[i], rejected };
    rejected.push({ index: i, reasons });
  }
  return {
    ok: false,
    rule: "terms",
    reason: "no accept matches the pinned terms: " + rejected.map((x) => x.reasons.join("; ")).join(" | "),
    rejected,
  };
}

export function checkPerPayment(amount: string, cfg: MandateConfig): string | null {
  return BigInt(amount) > BigInt(cfg.limits.perPayment)
    ? `amount ${amount} > per-payment limit ${cfg.limits.perPayment}`
    : null;
}
