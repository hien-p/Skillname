#!/usr/bin/env tsx
/**
 * setup-versions.ts — register v1 + v2 subnames under quote.skilltest.eth and
 * publish the versions index so semver resolution can demo end-to-end.
 *
 * After this runs:
 *   v1.quote.skilltest.eth → manifest pinned at version 1.0.0 (current)
 *   v2.quote.skilltest.eth → manifest pinned at version 2.0.0 (synthetic copy)
 *   quote.skilltest.eth    → xyz.manifest.skill.versions = "v1:1.0.0,v2:2.0.0"
 *                            xyz.manifest.skill.latest   = "v2"
 *
 * Then `skill resolve quote.skilltest.eth@^1` → v1, `@^2` → v2, `@latest` → v2.
 *
 * Run:
 *   pnpm tsx scripts/setup-versions.ts
 */

import "dotenv/config";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  namehash,
  parseAbi,
  toBytes,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const ENS_REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
const RESOLVER = "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5";
const PARENT = "quote.skilltest.eth";
const SCHEMA_URL = "https://manifest.eth/schemas/skill-v1.json";

const ENS_REGISTRY_ABI = parseAbi([
  "function setSubnodeRecord(bytes32 node, bytes32 label, address owner, address resolver, uint64 ttl) external",
  "function owner(bytes32 node) external view returns (address)",
]);
const RESOLVER_ABI = parseAbi([
  "function setText(bytes32 node, string key, string value) external",
  "function text(bytes32 node, string key) external view returns (string)",
]);

async function main() {
  const pk = process.env.SEPOLIA_PRIVATE_KEY;
  if (!pk) throw new Error("SEPOLIA_PRIVATE_KEY not set");
  const key = (pk.startsWith("0x") ? pk : "0x" + pk) as Hex;

  const rpc =
    process.env.SEPOLIA_RPC_URL ??
    "https://ethereum-sepolia-rpc.publicnode.com";

  const account = privateKeyToAccount(key);
  const pub = createPublicClient({ chain: sepolia, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpc) });

  console.log(`signer:  ${account.address}`);
  console.log(`parent:  ${PARENT}`);
  console.log();

  const parentNode = namehash(PARENT);

  // 1. Read the current manifest source (v1 = "as-is")
  const manifestPath = "skillname-pack/examples/quote-uniswap/manifest.json";
  const v1Manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (v1Manifest.version !== "1.0.0") {
    console.warn(
      `⚠ manifest version is ${v1Manifest.version}, expected 1.0.0 — proceeding anyway`,
    );
  }

  // 2. Build a synthetic v2: same shape, version bumped to 2.0.0, description tweaked
  const v2Manifest = JSON.parse(JSON.stringify(v1Manifest));
  v2Manifest.version = "2.0.0";
  v2Manifest.description =
    "(v2) " + (v1Manifest.description ?? "Versioned bundle for demo.");

  // 3. Pin both to 0G
  const tmp = mkdtempSync(join(tmpdir(), "skillname-versions-"));
  const v1Path = join(tmp, "v1.json");
  const v2Path = join(tmp, "v2.json");
  writeFileSync(v1Path, JSON.stringify(v1Manifest, null, 2));
  writeFileSync(v2Path, JSON.stringify(v2Manifest, null, 2));

  console.log(`→ pinning v1 manifest to 0G…`);
  const v1Root = pinTo0G(v1Path, key);
  if (!v1Root) throw new Error("v1 pin failed");
  console.log(`  ✓ v1 root: ${v1Root}`);

  console.log(`→ pinning v2 manifest to 0G…`);
  const v2Root = pinTo0G(v2Path, key);
  if (!v2Root) throw new Error("v2 pin failed");
  console.log(`  ✓ v2 root: ${v2Root}`);
  console.log();

  // 4. Create v1 + v2 subnames if they don't exist
  for (const label of ["v1", "v2"]) {
    const fullName = `${label}.${PARENT}`;
    const node = namehash(fullName);
    const existingOwner = await pub.readContract({
      address: ENS_REGISTRY as `0x${string}`,
      abi: ENS_REGISTRY_ABI,
      functionName: "owner",
      args: [node],
    });
    if (existingOwner !== "0x0000000000000000000000000000000000000000") {
      console.log(`  ${fullName} already exists (owner ${existingOwner}) — skipping creation`);
      continue;
    }
    console.log(`→ creating ${fullName}`);
    const txHash = await wallet.writeContract({
      address: ENS_REGISTRY as `0x${string}`,
      abi: ENS_REGISTRY_ABI,
      functionName: "setSubnodeRecord",
      args: [parentNode, keccak256(toBytes(label)), account.address, RESOLVER as `0x${string}`, 0n],
    });
    await pub.waitForTransactionReceipt({ hash: txHash });
    console.log(`  ✓ ${txHash}`);
  }
  console.log();

  // 5. Set the manifest text records on each version subname
  for (const [label, version, root] of [
    ["v1", "1.0.0", v1Root],
    ["v2", "2.0.0", v2Root],
  ] as const) {
    const fullName = `${label}.${PARENT}`;
    const node = namehash(fullName);
    const records: [string, string][] = [
      ["xyz.manifest.skill", `0g://${root}`],
      ["xyz.manifest.skill.version", version],
      ["xyz.manifest.skill.schema", SCHEMA_URL],
    ];
    console.log(`→ ${fullName} (3 setText)`);
    for (const [k, v] of records) {
      const txHash = await wallet.writeContract({
        address: RESOLVER as `0x${string}`,
        abi: RESOLVER_ABI,
        functionName: "setText",
        args: [node, k, v],
      });
      await pub.waitForTransactionReceipt({ hash: txHash });
      console.log(`  ✓ ${k} = ${v.slice(0, 40)}${v.length > 40 ? "…" : ""}`);
    }
  }
  console.log();

  // 6. Set the versions index on the parent
  const versionsValue = "v1:1.0.0,v2:2.0.0";
  const latestValue = "v2";
  console.log(`→ ${PARENT} (versions index)`);
  for (const [k, v] of [
    ["xyz.manifest.skill.versions", versionsValue],
    ["xyz.manifest.skill.latest", latestValue],
  ] as const) {
    const txHash = await wallet.writeContract({
      address: RESOLVER as `0x${string}`,
      abi: RESOLVER_ABI,
      functionName: "setText",
      args: [parentNode, k, v],
    });
    await pub.waitForTransactionReceipt({ hash: txHash });
    console.log(`  ✓ ${k} = ${v}`);
  }

  console.log();
  console.log("✓ Versions wired up. Try:");
  console.log(`  pnpm cli skill resolve ${PARENT}@^1   # → v1.${PARENT}`);
  console.log(`  pnpm cli skill resolve ${PARENT}@^2   # → v2.${PARENT}`);
  console.log(`  pnpm cli skill resolve ${PARENT}@latest`);
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
    if (combined.trim()) console.error(combined.split("\n").slice(-5).join("\n"));
    return null;
  }
  const m = combined.match(/root[s]?\s*=\s*(0x[a-fA-F0-9]+)/);
  return m ? m[1] : null;
}

main().catch((e) => {
  console.error(`setup-versions failed: ${e?.shortMessage ?? e?.message ?? e}`);
  process.exit(1);
});
