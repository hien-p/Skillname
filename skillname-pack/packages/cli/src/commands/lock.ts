/**
 * skill lock — walk imports + pin lockfile to 0G + set ENS text record.
 *
 * Output:
 *   1. JSON lockfile with [{ ensName, version, cid }] for the root + every
 *      transitive import, frozen at resolve-time
 *   2. Pinned to 0G storage; root hash is the lockfile CID
 *   3. `xyz.manifest.skill.lockfile = 0g://0x<root>` text record set on the
 *      root ENS name (only the root signs — not the children)
 *
 * Usage:
 *   skill lock <ensName>
 *
 * Required env:
 *   SEPOLIA_PRIVATE_KEY  — owner of the root ENS name
 */

import "dotenv/config";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createPublicClient,
  createWalletClient,
  http,
  namehash,
  parseAbi,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import {
  walkImports,
  generateLockfile,
  SKILL_LOCKFILE_KEY,
} from "@skillname/sdk";

const RESOLVER = "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5";
const RESOLVER_ABI = parseAbi([
  "function setText(bytes32 node, string key, string value) external",
]);

export async function lock(ensName: string): Promise<void> {
  if (!ensName.endsWith(".eth")) {
    throw new Error(`ensName must end with .eth, got "${ensName}"`);
  }

  const privateKey = process.env.SEPOLIA_PRIVATE_KEY;
  if (!privateKey) throw new Error("SEPOLIA_PRIVATE_KEY env not set");
  const key = (privateKey.startsWith("0x") ? privateKey : "0x" + privateKey) as Hex;

  console.log(`skill lock ${ensName}`);
  console.log(`  walking imports…`);

  const { flat } = await walkImports(ensName, { chain: "sepolia" });
  const lockfile = generateLockfile(flat);

  console.log(`  resolved ${lockfile.length} entries:`);
  for (const e of lockfile) {
    console.log(`    ${e.ensName.padEnd(28)} ${e.version.padEnd(10)} ${e.cid}`);
  }
  console.log();

  // Write lockfile to a temp file so the 0G CLI can pin it
  const dir = mkdtempSync(join(tmpdir(), "skillname-lock-"));
  const lockfilePath = join(dir, `${ensName}.lockfile.json`);
  const lockfileJson = JSON.stringify(
    {
      $schema: "https://manifest.eth/schemas/skill-lockfile-v1.json",
      root: ensName,
      generatedAt: new Date().toISOString(),
      entries: lockfile,
    },
    null,
    2,
  );
  writeFileSync(lockfilePath, lockfileJson);
  console.log(`  wrote lockfile (${lockfileJson.length} bytes) → ${lockfilePath}`);

  // Pin to 0G via the local CLI
  console.log(`→ pinning lockfile to 0G…`);
  const root = pinTo0G(lockfilePath, privateKey);
  if (!root) throw new Error("failed to extract 0G root from upload output");
  console.log(`  ✓ root: ${root}`);
  console.log();

  // Set the lockfile text record on the root name
  const rpcUrl =
    process.env.SEPOLIA_RPC_URL ??
    "https://ethereum-sepolia-rpc.publicnode.com";
  const account = privateKeyToAccount(key);
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) });

  const node = namehash(ensName);
  const value = `0g://${root}`;

  console.log(`→ setText(${SKILL_LOCKFILE_KEY}, ${value})`);
  const txHash = await wallet.writeContract({
    address: RESOLVER as `0x${string}`,
    abi: RESOLVER_ABI,
    functionName: "setText",
    args: [node, SKILL_LOCKFILE_KEY, value],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`setText reverted: ${txHash}`);
  }
  console.log(`  ✓ ${txHash}`);
  console.log();
  console.log(`✓ locked ${ensName} (${lockfile.length} entries)`);
}

function pinTo0G(filePath: string, privateKey: string): string | null {
  const cli = process.env.OG_CLI_BIN ?? "0g-storage-client";
  const ogRpc = process.env.OG_RPC_URL ?? "https://evmrpc-testnet.0g.ai";
  const indexer =
    process.env.OG_INDEXER_URL ?? "https://indexer-storage-testnet-turbo.0g.ai";

  const r = spawnSync(
    cli,
    ["upload", "--url", ogRpc, "--indexer", indexer, "--key", privateKey, "--file", filePath],
    { encoding: "utf8" },
  );
  const combined = (r.stdout ?? "") + "\n" + (r.stderr ?? "");
  if (r.status !== 0) {
    console.error(`  ✗ 0g-storage-client exit ${r.status}`);
    if (combined.trim()) console.error(combined);
    return null;
  }
  const m = combined.match(/root[s]?\s*=\s*(0x[a-fA-F0-9]+)/);
  return m ? m[1] : null;
}
