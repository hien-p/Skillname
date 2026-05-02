/**
 * skill register-onchain — register a deployed impl in the SkillLink registry.
 *
 * Wraps a single `cast send SkillLink.register(node, impl, selectors)` call
 * with ENS namehash computation and selector parsing.
 *
 * Usage:
 *   skill register-onchain <ensName> --impl 0x… --selectors 0xa9059cbb,0x70a08231
 *
 * Required env:
 *   SEPOLIA_PRIVATE_KEY  — must be the current owner of the ENS name
 *
 * Optional env:
 *   SEPOLIA_RPC_URL      — default: https://ethereum-sepolia-rpc.publicnode.com
 *   SKILLLINK_ADDRESS    — default: hardcoded canonical Sepolia deployment
 */

import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  isHex,
  namehash,
  parseAbi,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const SKILLLINK_DEFAULT: `0x${string}` =
  "0xE2532C1dB5FceFA946Ee64D44c22027c070DE8Aa";

const SKILLLINK_ABI = parseAbi([
  "function register(bytes32 node, address impl, bytes4[] selectors) external",
  "function skills(bytes32 node) external view returns (address impl, address owner, uint96 registeredAt, uint256 selectorBitmap)",
]);

export interface RegisterOnchainOpts {
  impl: string;
  selectors: string[];
  registry?: string;
  rpcUrl?: string;
}

export async function registerOnchain(ensName: string, opts: RegisterOnchainOpts): Promise<void> {
  if (!ensName.endsWith(".eth")) {
    throw new Error(`ensName must end with .eth, got "${ensName}"`);
  }
  if (!isAddress(opts.impl)) {
    throw new Error(`--impl must be a 0x-prefixed address, got "${opts.impl}"`);
  }
  if (opts.selectors.length === 0) {
    throw new Error(`--selectors must be a comma-separated list of 4-byte hex strings`);
  }
  for (const sel of opts.selectors) {
    if (!isHex(sel) || sel.length !== 10) {
      throw new Error(
        `selector "${sel}" must be a 4-byte hex string (0x + 8 hex chars), e.g. 0xa9059cbb`,
      );
    }
  }

  const privateKey = process.env.SEPOLIA_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("SEPOLIA_PRIVATE_KEY not set in environment");
  }

  const rpcUrl =
    opts.rpcUrl ??
    process.env.SEPOLIA_RPC_URL ??
    "https://ethereum-sepolia-rpc.publicnode.com";

  const registry =
    (opts.registry as `0x${string}` | undefined) ??
    (process.env.SKILLLINK_ADDRESS as `0x${string}` | undefined) ??
    SKILLLINK_DEFAULT;

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

  const node = namehash(ensName);
  const selectors = opts.selectors as Hex[];

  console.log(`skill register-onchain ${ensName}`);
  console.log(`  registry:  ${registry}`);
  console.log(`  ens:       ${ensName}`);
  console.log(`  node:      ${node}`);
  console.log(`  impl:      ${opts.impl}`);
  console.log(`  selectors: ${selectors.join(", ")}`);
  console.log(`  signer:    ${account.address}`);
  console.log();

  const txHash = await wallet.writeContract({
    address: registry,
    abi: SKILLLINK_ABI,
    functionName: "register",
    args: [node, opts.impl as `0x${string}`, selectors],
  });
  console.log(`  → tx ${txHash}`);
  console.log(`  waiting for confirmation…`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`tx reverted: https://sepolia.etherscan.io/tx/${txHash}`);
  }

  // Verify by reading back
  const skill = await publicClient.readContract({
    address: registry,
    abi: SKILLLINK_ABI,
    functionName: "skills",
    args: [node],
  });

  console.log(`  ✓ registered at block ${receipt.blockNumber}`);
  console.log(`  ✓ skill.impl  = ${skill[0]}`);
  console.log(`  ✓ skill.owner = ${skill[1]}`);
  console.log(`  https://sepolia.etherscan.io/tx/${txHash}`);
}
