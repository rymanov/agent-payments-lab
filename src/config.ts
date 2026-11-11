import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/** The only network this prototype may ever pay on. Base Sepolia testnet. */
export const TESTNET = "eip155:84532";
/** Circle's USDC on Base Sepolia (from the x402 docs, network-and-token-support). */
export const TESTNET_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** One service the agent may pay. Every field of the 402 terms is pinned. */
export interface ServiceRule {
  id: string;
  /** Exact origin: scheme + host + port. No wildcards, no subdomains. */
  origin: string;
  pathPrefix: string;
  scheme: "exact";
  network: string;
  asset: string;
  payTo: string;
  /** Highest price this service may quote, atomic units. */
  maxAmount: string;
  /** EIP-712 domain the asset must declare. */
  extra?: { name: string; version: string };
}

export interface MandateConfig {
  network: string;
  limits: {
    perPayment: string;
    weeklyBudget: string;
    maxPaymentsPerTask: number;
    dedupeWindowSeconds: number;
    maxTimeoutSeconds: number;
  };
  agents: string[];
  services: ServiceRule[];
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ATOMIC = /^[0-9]+$/;

/** Load and validate the mandate. Refuses anything that is not testnet. */
export function loadConfig(file = path.join(ROOT, "mandate.config.json")): MandateConfig {
  const cfg = JSON.parse(readFileSync(file, "utf8")) as MandateConfig;
  return validateConfig(cfg);
}

export function validateConfig(cfg: MandateConfig): MandateConfig {
  const problems: string[] = [];
  if (cfg.network !== TESTNET) problems.push(`network must be ${TESTNET} (testnet only), got ${cfg.network}`);
  for (const k of ["perPayment", "weeklyBudget"] as const) {
    if (!ATOMIC.test(cfg.limits[k])) problems.push(`limits.${k} must be an atomic integer string`);
  }
  for (const s of cfg.services) {
    if (s.network !== TESTNET) problems.push(`service ${s.id}: network must be ${TESTNET}`);
    if (s.scheme !== "exact") problems.push(`service ${s.id}: only the exact scheme is allowed`);
    if (!ADDRESS.test(s.asset)) problems.push(`service ${s.id}: asset is not an address`);
    if (!ADDRESS.test(s.payTo)) problems.push(`service ${s.id}: payTo is not an address (run npm run wallet:new)`);
    if (!ATOMIC.test(s.maxAmount)) problems.push(`service ${s.id}: maxAmount must be atomic`);
    try {
      const u = new URL(s.origin);
      if (u.origin !== s.origin) problems.push(`service ${s.id}: origin must be a bare origin like https://host:port`);
    } catch {
      problems.push(`service ${s.id}: origin is not a URL`);
    }
    if (!s.pathPrefix.startsWith("/")) problems.push(`service ${s.id}: pathPrefix must start with /`);
  }
  if (problems.length) throw new Error("Invalid mandate config:\n- " + problems.join("\n- "));
  return cfg;
}
