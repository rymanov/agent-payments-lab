import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ROOT } from "../config.js";

/**
 * Make two fresh testnet wallets: the payer (key goes to .env, chmod 600) and the
 * test service's payTo (only the address is kept; nobody needs to spend from it).
 * Writes the payTo into mandate.config.json. Refuses to overwrite an existing .env.
 */
const envFile = path.join(ROOT, ".env");
if (existsSync(envFile) && readFileSync(envFile, "utf8").includes("PAYER_PRIVATE_KEY")) {
  console.error(".env already has a payer key. Not overwriting.");
  process.exit(1);
}
const payerKey = generatePrivateKey();
const payer = privateKeyToAccount(payerKey);
const service = privateKeyToAccount(generatePrivateKey());
writeFileSync(
  envFile,
  [
    "# TESTNET ONLY (Base Sepolia). Read only by the mandate checker process.",
    `PAYER_PRIVATE_KEY=${payerKey}`,
    `PAYER_ADDRESS=${payer.address}`,
    "",
  ].join("\n"),
);
chmodSync(envFile, 0o600);
const cfgFile = path.join(ROOT, "mandate.config.json");
const cfg = JSON.parse(readFileSync(cfgFile, "utf8"));
for (const s of cfg.services) if (s.id === "local-price-feed") s.payTo = service.address;
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + "\n");
console.log(`payer address:   ${payer.address}  (fund this with Base Sepolia USDC)`);
console.log(`service payTo:   ${service.address}`);
