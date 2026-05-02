/**
 * skill publish — pin a bundle to 0G + set the ENS text records.
 *
 * One-command wrapper around the manual flow that's been used until now
 * (`pnpm tsx scripts/pin-to-0g.ts && cast send setText × 3`).
 *
 * Usage:
 *   skill publish <bundleDir> <ensName>
 *
 * Required env:
 *   SEPOLIA_PRIVATE_KEY  — owner of the ENS name (will sign 4 txs:
 *                          1 0G upload + 3 setText)
 *
 * Optional env:
 *   SEPOLIA_RPC_URL      — default https://ethereum-sepolia-rpc.publicnode.com
 *   OG_RPC_URL           — default https://evmrpc-testnet.0g.ai
 *   OG_INDEXER_URL       — default https://indexer-storage-testnet-turbo.0g.ai
 *   OG_CLI_BIN           — path to 0g-storage-client (default: looks on PATH)
 */

import "dotenv/config";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
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

const RESOLVER_DEFAULT = "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5";
const RESOLVER_ABI = parseAbi([
  "function setText(bytes32 node, string key, string value) external",
  "function text(bytes32 node, string key) external view returns (string)",
]);

const SCHEMA_URL = "https://manifest.eth/schemas/skill-v1.json";

export async function publish(bundleDir: string, ensName: string): Promise<void> {
  if (!existsSync(bundleDir)) {
    throw new Error(`bundle dir not found: ${bundleDir}`);
  }
  const manifestPath = join(bundleDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`manifest.json missing in ${bundleDir}`);
  }
  if (!ensName.endsWith(".eth")) {
    throw new Error(`ensName must end with .eth, got "${ensName}"`);
  }

  // 1. Validate the manifest by parsing it (schema validator runs separately)
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!manifest.name || !manifest.version || !manifest.tools?.length) {
    throw new Error(`manifest missing required fields (name, version, tools)`);
  }

  const privateKey = process.env.SEPOLIA_PRIVATE_KEY;
  if (!privateKey) throw new Error("SEPOLIA_PRIVATE_KEY env not set");
  const key = (privateKey.startsWith("0x") ? privateKey : "0x" + privateKey) as Hex;

  console.log(`skill publish ${ensName}`);
  console.log(`  bundle:   ${bundleDir}`);
  console.log(`  manifest: ${manifestPath}`);
  console.log(`  name:     ${manifest.name}`);
  console.log(`  version:  ${manifest.version}`);
  console.log(`  tools:    ${manifest.tools.length}`);
  console.log();

  // 2. Pin to 0G via the local CLI binary
  console.log(`→ pinning to 0G…`);
  const root = pinTo0G(manifestPath, privateKey);
  if (!root) throw new Error("failed to extract 0G root from upload output");
  console.log(`  ✓ root: ${root}`);
  console.log();

  // 3. Set the three ENS text records
  const rpcUrl =
    process.env.SEPOLIA_RPC_URL ??
    "https://ethereum-sepolia-rpc.publicnode.com";
  const account = privateKeyToAccount(key);
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) });

  const node = namehash(ensName);
  const records: [string, string][] = [
    ["xyz.manifest.skill", `0g://${root}`],
    ["xyz.manifest.skill.version", manifest.version],
    ["xyz.manifest.skill.schema", SCHEMA_URL],
  ];

  console.log(`→ setting 3 text records on ${ensName}…`);
  for (const [k, v] of records) {
    process.stdout.write(`  setText("${k}", "${v.length > 60 ? v.slice(0, 30) + "…" + v.slice(-20) : v}") `);
    const txHash = await wallet.writeContract({
      address: RESOLVER_DEFAULT as `0x${string}`,
      abi: RESOLVER_ABI,
      functionName: "setText",
      args: [node, k, v],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      throw new Error(`setText("${k}") reverted: ${txHash}`);
    }
    console.log(`✓ ${txHash}`);
  }
  console.log();
  console.log(`✓ published ${ensName}`);
  console.log(`  → 0G root: ${root}`);
  console.log(`  → resolve via: pnpm cli skill resolve ${ensName}`);
}

function pinTo0G(manifestPath: string, privateKey: string): string | null {
  const cli = process.env.OG_CLI_BIN ?? "0g-storage-client";
  const ogRpc = process.env.OG_RPC_URL ?? "https://evmrpc-testnet.0g.ai";
  const indexer =
    process.env.OG_INDEXER_URL ?? "https://indexer-storage-testnet-turbo.0g.ai";

  const r = spawnSync(
    cli,
    [
      "upload",
      "--url", ogRpc,
      "--indexer", indexer,
      "--key", privateKey,
      "--file", manifestPath,
    ],
    { encoding: "utf8" },
  );
  // logrus writes the success line to stderr by default; merge both streams.
  const combined = (r.stdout ?? "") + "\n" + (r.stderr ?? "");
  if (r.status !== 0) {
    console.error(`  ✗ 0g-storage-client exit ${r.status}`);
    if (combined.trim()) console.error(combined);
    return null;
  }
  // Match "file uploaded, root = 0x..." (single fragment) or "roots = ..."
  const m = combined.match(/root[s]?\s*=\s*(0x[a-fA-F0-9]+)/);
  return m ? m[1] : null;
}
