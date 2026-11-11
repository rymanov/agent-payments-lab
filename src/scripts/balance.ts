import path from "node:path";
import { config as loadEnv } from "dotenv";
import { createPublicClient, erc20Abi, formatUnits, http } from "viem";
import { baseSepolia } from "viem/chains";
import { loadConfig, ROOT, TESTNET_USDC } from "../config.js";

/** Show testnet USDC balances of the payer and the service. Read-only, public RPC. */
loadEnv({ path: path.join(ROOT, ".env"), quiet: true });
const client = createPublicClient({ chain: baseSepolia, transport: http(process.env.RPC_URL ?? "https://sepolia.base.org") });
const svc = loadConfig().services[0];
for (const [name, addr] of [["payer", process.env.PAYER_ADDRESS], ["service", svc.payTo]] as const) {
  if (!addr) continue;
  const bal = await client.readContract({ address: TESTNET_USDC, abi: erc20Abi, functionName: "balanceOf", args: [addr as `0x${string}`] });
  console.log(`${name.padEnd(8)} ${addr}  ${formatUnits(bal, 6)} USDC (Base Sepolia)`);
}
