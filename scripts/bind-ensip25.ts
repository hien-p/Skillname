#!/usr/bin/env tsx
/**
 * bind-ensip25.ts — set the ENSIP-25 text record on an ENS name to bind it
 * to an ERC-8004 Identity NFT.
 *
 * The text record key is `agent-registration[<erc7930>][<agentId>]` per
 * ENSIP-25. Setting it to "1" asserts that the ENS name's owner has
 * acknowledged the binding to the NFT side. The NFT contract should already
 * point back to this ENS name on the registry side — without that, the
 * binding is one-directional and `verifyEnsip25()` returns `bound: false`.
 *
 * This script handles only the ENS side of the loop. The NFT mint + reverse
 * binding is left to the ERC-8004 registry's own flow (varies by deployment).
 *
 * Usage:
 *   pnpm tsx scripts/bind-ensip25.ts <ensName> <agentId> <caip10Registry> [value]
 *
 * Example:
 *   pnpm tsx scripts/bind-ensip25.ts \
 *     quote.skilltest.eth 42 eip155:11155111:0xYourErc8004Registry 1
 *
 * Required env:
 *   SEPOLIA_PRIVATE_KEY  — must own the ENS name
 *
 * Optional env:
 *   SEPOLIA_RPC_URL      — default: https://ethereum-sepolia-rpc.publicnode.com
 *   ENS_PUBLIC_RESOLVER  — default: 0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5 (Sepolia)
 */

import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  namehash,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { encodeErc7930 } from "@skillname/sdk";

const RESOLVER_DEFAULT = "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5";

const RESOLVER_ABI = parseAbi([
  "function setText(bytes32 node, string key, string value) external",
  "function text(bytes32 node, string key) external view returns (string)",
]);

async function main() {
  const [ensName, agentIdRaw, caip10, valueRaw] = process.argv.slice(2);
  if (!ensName || !agentIdRaw || !caip10) {
    console.error(
      "Usage: pnpm tsx scripts/bind-ensip25.ts <ensName> <agentId> <caip10Registry> [value]",
    );
    console.error(
      "Example: pnpm tsx scripts/bind-ensip25.ts quote.skilltest.eth 42 eip155:11155111:0xYourErc8004Registry",
    );
    process.exit(1);
  }
  if (!ensName.endsWith(".eth")) {
    throw new Error(`ensName must end with .eth: ${ensName}`);
  }
  const agentId = Number(agentIdRaw);
  if (!Number.isInteger(agentId) || agentId < 0) {
    throw new Error(`agentId must be a non-negative integer: ${agentIdRaw}`);
  }
  // encodeErc7930 throws on invalid format — let it surface a clear error.
  const erc7930 = encodeErc7930(caip10);
  const value = valueRaw ?? "1";
  const key = `agent-registration[${erc7930}][${agentId}]`;
  const node = namehash(ensName);

  const privateKey = process.env.SEPOLIA_PRIVATE_KEY;
  if (!privateKey) throw new Error("SEPOLIA_PRIVATE_KEY not set");

  const rpcUrl =
    process.env.SEPOLIA_RPC_URL ??
    "https://ethereum-sepolia-rpc.publicnode.com";

  const resolver = (process.env.ENS_PUBLIC_RESOLVER ??
    RESOLVER_DEFAULT) as `0x${string}`;
  if (!isAddress(resolver)) throw new Error(`Invalid resolver: ${resolver}`);

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  });
  const wallet = createWalletClient({
    account,
    chain: sepolia,
    transport: http(rpcUrl),
  });

  console.log(`bind-ensip25 ${ensName}`);
  console.log(`  ens:      ${ensName}`);
  console.log(`  node:     ${node}`);
  console.log(`  agentId:  ${agentId}`);
  console.log(`  registry: ${caip10}`);
  console.log(`  erc7930:  ${erc7930}`);
  console.log(`  key:      ${key}`);
  console.log(`  value:    ${value}`);
  console.log(`  resolver: ${resolver}`);
  console.log(`  signer:   ${account.address}`);
  console.log();

  const txHash = await wallet.writeContract({
    address: resolver,
    abi: RESOLVER_ABI,
    functionName: "setText",
    args: [node, key, value],
  });
  console.log(`  → tx ${txHash}`);
  console.log(`  waiting for confirmation…`);

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });
  if (receipt.status !== "success") {
    throw new Error(`tx reverted: https://sepolia.etherscan.io/tx/${txHash}`);
  }

  // Verify by reading the text record back
  const readBack = await publicClient.readContract({
    address: resolver,
    abi: RESOLVER_ABI,
    functionName: "text",
    args: [node, key],
  });

  console.log(`  ✓ text record set at block ${receipt.blockNumber}`);
  console.log(`  ✓ readBack: "${readBack}"`);
  console.log(`  https://sepolia.etherscan.io/tx/${txHash}`);
  console.log();
  console.log(
    `Next: confirm the NFT side at ${caip10} reverse-binds to ${ensName}.`,
  );
  console.log(
    `      Once both sides agree, \`skill verify ${ensName}\` should report ensip25.bound: true.`,
  );
}

main().catch((e) => {
  console.error(`Error: ${e?.message ?? e}`);
  process.exit(1);
});
