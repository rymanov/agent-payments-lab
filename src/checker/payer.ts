import { x402Client } from "@x402/core/client";
import type { PaymentPayload, PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { TESTNET } from "../config.js";

/**
 * The only code that touches the wallet key. Lives inside the checker process.
 * Registers the exact-EVM scheme for Base Sepolia only, so the SDK can never
 * select another network even if a 402 offers one.
 */
export interface Signer {
  address: string;
  sign(resource: PaymentRequired["resource"], req: PaymentRequirements): Promise<PaymentPayload>;
}

export function makeSigner(privateKey: string): Signer {
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error("PAYER_PRIVATE_KEY missing or malformed in .env");
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const client = new x402Client().register(TESTNET, new ExactEvmScheme(account));
  return {
    address: account.address,
    async sign(resource, req) {
      // Hand the SDK exactly one accept (the one the rules approved) and no extensions.
      const pr: PaymentRequired = { x402Version: 2, resource, accepts: [req] };
      const payload = await client.createPaymentPayload(pr);
      assertPayloadMatches(payload, req, account.address);
      return payload;
    },
  };
}

/** Defence in depth: the signed authorization must say exactly what the rules approved. */
export function assertPayloadMatches(payload: PaymentPayload, req: PaymentRequirements, from: string) {
  const fail = (m: string) => {
    throw new Error("signed payload does not match approved terms: " + m);
  };
  if (payload.extensions && Object.keys(payload.extensions).length) fail("payload carries extensions");
  const a = payload.accepted;
  if (a.network !== req.network || a.asset !== req.asset || a.payTo !== req.payTo || a.amount !== req.amount || a.scheme !== req.scheme) {
    fail("accepted block differs");
  }
  const auth = (payload.payload as { authorization?: Record<string, string> }).authorization;
  if (!auth) fail("no EIP-3009 authorization in payload");
  if (auth!.to.toLowerCase() !== req.payTo.toLowerCase()) fail("authorization.to differs");
  if (auth!.from.toLowerCase() !== from.toLowerCase()) fail("authorization.from differs");
  if (auth!.value !== req.amount) fail("authorization.value differs");
}
