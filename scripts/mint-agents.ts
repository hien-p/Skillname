#!/usr/bin/env tsx
/**
 * mint-agents.ts — register one IdentityRegistry agentId per reference skill.
 *
 * Uses viem instead of `cast send` because cast has been observed to
 * ENS-resolve string args that look like .eth names, replacing them with
 * 0x0000…0000 when the name has no `addr()` record. viem passes the string
 * verbatim.
 *
 * Run:
 *   pnpm tsx scripts/mint-agents.ts
 */

import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const REGISTRY = "0x48f77FfE1f02FB94bDe9c8ffe84bB4956ace11e4" as const;
const NAMES = [
  "hello.skilltest.eth",
  "quote.skilltest.eth",
  "swap.skilltest.eth",
  "score.skilltest.eth",
  "weather.skilltest.eth",
];

const ABI = parseAbi([
  "function register(string name) external returns (uint256 agentId)",
  "function lastId() external view returns (uint256)",
  "function nameOf(uint256 agentId) external view returns (string)",
  "event AgentRegistered(uint256 indexed agentId, address indexed owner, string name)",
]);

async function main() {
  const pk = process.env.SEPOLIA_PRIVATE_KEY;
  if (!pk) throw new Error("SEPOLIA_PRIVATE_KEY not set");
  const key = (pk.startsWith("0x") ? pk : "0x" + pk) as Hex;
  const account = privateKeyToAccount(key);
  const rpc =
    process.env.SEPOLIA_RPC_URL ??
    "https://ethereum-sepolia-rpc.publicnode.com";

  const pub = createPublicClient({ chain: sepolia, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpc) });

  const startId = await pub.readContract({
    address: REGISTRY,
    abi: ABI,
    functionName: "lastId",
  });
  console.log(`registry: ${REGISTRY}`);
  console.log(`signer:   ${account.address}`);
  console.log(`lastId before: ${startId}`);
  console.log();

  const ids: { name: string; agentId: bigint; tx: string }[] = [];

  for (const name of NAMES) {
    process.stdout.write(`→ register("${name}") `);
    const txHash = await wallet.writeContract({
      address: REGISTRY,
      abi: ABI,
      functionName: "register",
      args: [name],
    });
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      throw new Error(`reverted: ${txHash}`);
    }
    // Read the AgentRegistered event from logs to extract the agentId.
    const log = receipt.logs.find((l) => l.address.toLowerCase() === REGISTRY.toLowerCase());
    const agentId = BigInt(log?.topics[1] ?? "0x0");
    ids.push({ name, agentId, tx: txHash });
    console.log(`✓ agentId=${agentId} tx=${txHash}`);
  }

  console.log();
  console.log("--- verify ---");
  for (const { name, agentId } of ids) {
    const stored = await pub.readContract({
      address: REGISTRY,
      abi: ABI,
      functionName: "nameOf",
      args: [agentId],
    });
    const ok = stored === name ? "✓" : "✗";
    console.log(`  ${ok} agentId ${agentId}: stored="${stored}" expected="${name}"`);
  }

  console.log();
  console.log("BINDING_MAP:");
  console.log(JSON.stringify(
    Object.fromEntries(ids.map(({ name, agentId }) => [name, Number(agentId)])),
    null,
    2,
  ));
}

main().catch((e) => {
  console.error(`mint-agents failed: ${e?.shortMessage ?? e?.message ?? e}`);
  process.exit(1);
});
