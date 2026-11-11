import { createServer, type Server } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import type { PaymentPayload, PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { generatePrivateKey } from "viem/accounts";
import { TESTNET, TESTNET_USDC, validateConfig, type MandateConfig } from "../src/config.js";
import { MandateChecker } from "../src/checker/checker.js";
import { DecisionLog } from "../src/checker/log.js";
import { makeSigner } from "../src/checker/payer.js";
import { Ledger } from "../src/checker/store.js";

export const PAYTO = "0x20A9634a06652a1Fe4b2d41de3Ff0a7308556810";
export const EVIL = "0x000000000000000000000000000000000000dEaD";
export const MAINNET = "eip155:8453";
export const MAINNET_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/** One valid set of terms; routes below change one field each. */
export const good = (over: Partial<PaymentRequirements> = {}): PaymentRequirements => ({
  scheme: "exact",
  network: TESTNET,
  amount: "10000",
  asset: TESTNET_USDC,
  payTo: PAYTO,
  maxTimeoutSeconds: 120,
  extra: { name: "USDC", version: "2" },
  ...over,
});

type Route = { accepts?: PaymentRequirements[]; status?: number; location?: string; resourceUrl?: string; version?: number; afterPay?: "ok" | "garbage" | "fail" };

/**
 * A mock x402 service. It never settles anything on chain: it records every signed
 * authorization it receives. A signed EIP-3009 authorization is money handed over
 * (the holder can settle it until validBefore), so `signed` counts payments.
 */
export class MockService {
  server!: Server;
  origin = "";
  signed: { path: string; payload: PaymentPayload }[] = [];
  routes: Record<string, Route> = {};

  async start() {
    this.server = createServer((req, res) => {
      const u = new URL(req.url!, this.origin);
      const route = this.routes[u.pathname];
      if (!route) return res.writeHead(404).end();
      if (route.location) return res.writeHead(route.status ?? 302, { location: route.location }).end();
      const sig = req.headers["payment-signature"];
      if (!sig) {
        const pr = {
          x402Version: route.version ?? 2,
          error: "Payment required",
          resource: { url: route.resourceUrl ?? this.origin + u.pathname, description: "mock", mimeType: "application/json" },
          accepts: route.accepts ?? [good()],
        } as PaymentRequired;
        return res.writeHead(402, { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(pr), "content-type": "application/json" }).end("{}");
      }
      const payload = decodePaymentSignatureHeader(String(sig));
      this.signed.push({ path: u.pathname + u.search, payload });
      if (route.afterPay === "fail") return res.writeHead(500).end("oops");
      const settle = encodePaymentResponseHeader({ success: true, transaction: "0x" + "ab".repeat(32), network: TESTNET, payer: (payload.payload as any).authorization.from });
      const body = route.afterPay === "garbage" ? "lorem ipsum, not a price" : JSON.stringify({ price: 3000 });
      res.writeHead(200, { "PAYMENT-RESPONSE": settle, "content-type": "application/json" }).end(body);
    });
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", r));
    this.origin = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }
  stop() {
    return new Promise<void>((r) => this.server.close(() => r()));
  }
}

export interface Harness {
  dir: string;
  cfg: MandateConfig;
  ledger: Ledger;
  logFile: string;
  checker: MandateChecker;
  svc: MockService;
  unlisted: MockService;
  close(): Promise<void>;
}

/** Fresh checker with a throwaway, unfunded key and a temp ledger. Real SDK signing. */
export async function harness(limits: Partial<MandateConfig["limits"]> = {}): Promise<Harness> {
  const svc = await new MockService().start();
  const unlisted = await new MockService().start();
  const dir = mkdtempSync(path.join(os.tmpdir(), "mandate-"));
  const cfg = validateConfig({
    network: TESTNET,
    limits: { perPayment: "20000", weeklyBudget: "50000", maxPaymentsPerTask: 1, dedupeWindowSeconds: 600, maxTimeoutSeconds: 300, ...limits },
    agents: ["data-agent"],
    services: [
      { id: "mock", origin: svc.origin, pathPrefix: "/data/", scheme: "exact", network: TESTNET, asset: TESTNET_USDC, payTo: PAYTO, maxAmount: "10000", extra: { name: "USDC", version: "2" } },
      { id: "mock-pricey", origin: svc.origin, pathPrefix: "/pricey/", scheme: "exact", network: TESTNET, asset: TESTNET_USDC, payTo: PAYTO, maxAmount: "100000", extra: { name: "USDC", version: "2" } },
    ],
  });
  const ledger = new Ledger(path.join(dir, "ledger.sqlite"));
  const logFile = path.join(dir, "decisions.jsonl");
  const checker = new MandateChecker({ cfg, ledger, log: new DecisionLog(logFile), signer: makeSigner(generatePrivateKey()) });
  return {
    dir, cfg, ledger, logFile, checker, svc, unlisted,
    async close() {
      ledger.close();
      await svc.stop();
      await unlisted.stop();
    },
  };
}

let n = 0;
export const rid = (p = "req") => `${p}-${process.pid}-${++n}-${Math.random().toString(36).slice(2, 8)}`;
export const ask = (h: Harness, url: string, o: { id?: string; task?: string; agent?: string } = {}) =>
  h.checker.pay({ requestId: o.id ?? rid(), agent: o.agent ?? "data-agent", task: o.task ?? rid("task"), url });

/** Make a fake project root (for sandbox tests) with a .env, ledger and log in place. */
export function fakeRoot(realRoot: string) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "root-"));
  writeFileSync(path.join(dir, ".env"), "PAYER_PRIVATE_KEY=0x" + "11".repeat(32) + "\n");
  mkdirSync(path.join(dir, "data"));
  writeFileSync(path.join(dir, "data", "ledger.sqlite"), "x");
  mkdirSync(path.join(dir, "logs"));
  writeFileSync(path.join(dir, "logs", "decisions.jsonl"), "");
  writeFileSync(path.join(dir, "mandate.config.json"), "{}");
  return { dir, realRoot };
}
