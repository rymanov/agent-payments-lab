import path from "node:path";
import express from "express";
import { config as loadEnv } from "dotenv";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { loadConfig, ROOT, TESTNET } from "../config.js";

/**
 * A real x402 test endpoint on Base Sepolia, set up as in the @x402/express README.
 * Settles through the public x402.org facilitator (testnet only). Holds no key:
 * it only needs the address to be paid.
 */
loadEnv({ path: path.join(ROOT, ".env"), quiet: true });
const svc = loadConfig().services.find((s) => s.id === "local-price-feed")!;
const port = Number(process.env.SERVICE_PORT ?? 4021);

const facilitator = new HTTPFacilitatorClient({ url: process.env.FACILITATOR_URL ?? "https://x402.org/facilitator" });
const resourceServer = new x402ResourceServer(facilitator).register(TESTNET, new ExactEvmScheme());

const app = express();
app.use(
  paymentMiddleware(
    {
      "GET /data/price": {
        accepts: { scheme: "exact", price: "$0.01", network: TESTNET, payTo: svc.payTo, maxTimeoutSeconds: 120 },
        description: "One ETH/USD price reading (test data)",
        mimeType: "application/json",
      },
    },
    resourceServer,
  ),
);
app.get("/data/price", (_req, res) => {
  res.json({ pair: "ETH/USD", price: 3000 + Math.round(Math.random() * 100), source: "test", at: new Date().toISOString() });
});
app.get("/free", (_req, res) => res.json({ ok: true }));
app.listen(port, "127.0.0.1", () => console.log(`x402 test service on http://127.0.0.1:${port} payTo=${svc.payTo}`));
