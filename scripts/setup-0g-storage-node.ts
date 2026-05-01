#!/usr/bin/env tsx
import "dotenv/config";
/**
 * Bootstrap 0G Storage: clone + build 0g-storage-client, upload a bundle
 * manifest to 0G Galileo testnet, print the root hash for ENS text records.
 *
 * Usage:
 *   pnpm tsx scripts/setup-0g-storage-node.ts [path/to/manifest.json]
 *
 * Env:
 *   SEPOLIA_PRIVATE_KEY  — key to sign 0G transactions (same key works on Galileo)
 *   OG_RPC_URL           — 0G testnet RPC (default: https://evmrpc-testnet.0g.ai)
 *   OG_INDEXER_URL       — 0G indexer (default: https://indexer-storage-testnet-turbo.0g.ai)
 *   OG_VENDOR_DIR        — where to clone 0g-storage-client (default: .vendor/ in repo root)
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const PRIVATE_KEY = process.env.SEPOLIA_PRIVATE_KEY;
const OG_RPC = process.env.OG_RPC_URL ?? "https://evmrpc-testnet.0g.ai";
const INDEXER =
  process.env.OG_INDEXER_URL ?? "https://indexer-storage-testnet-turbo.0g.ai";
const VENDOR = process.env.OG_VENDOR_DIR ?? join(process.cwd(), ".vendor");
const CLIENT_DIR = join(VENDOR, "0g-storage-client");
const CLIENT_BIN = join(CLIENT_DIR, "0g-storage-client");

if (!PRIVATE_KEY) {
  console.error("SEPOLIA_PRIVATE_KEY not set");
  process.exit(1);
}

function run(cmd: string, args: string[], opts?: { cwd?: string }): void {
  console.log(`  $ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: opts?.cwd });
  if (r.status !== 0) {
    console.error(`Command failed with exit code ${r.status}`);
    process.exit(1);
  }
}

function ensureClient(): void {
  if (existsSync(CLIENT_BIN)) {
    console.log(`✓ 0g-storage-client already built at ${CLIENT_BIN}`);
    return;
  }

  console.log("→ Cloning 0g-storage-client…");
  run("git", [
    "clone",
    "--depth",
    "1",
    "https://github.com/0glabs/0g-storage-client.git",
    CLIENT_DIR,
  ]);

  console.log("→ Building 0g-storage-client (requires Go)…");
  run("go", ["build", "-o", "0g-storage-client", "."], { cwd: CLIENT_DIR });

  console.log("✓ 0g-storage-client ready");
}

function uploadBundle(manifestPath: string): string {
  ensureClient();

  console.log(`\n→ Uploading ${manifestPath}…\n`);

  const r = spawnSync(
    CLIENT_BIN,
    [
      "upload",
      "--url",
      OG_RPC,
      "--indexer",
      INDEXER,
      "--key",
      PRIVATE_KEY!,
      "--file",
      manifestPath,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  const stdout = r.stdout?.toString() ?? "";
  const stderr = r.stderr?.toString() ?? "";
  const combined = stdout + stderr;

  // Print output for visibility
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  if (r.status !== 0) {
    console.error(`\n✗ Upload failed (exit code ${r.status})`);
    process.exit(1);
  }

  // Extract root hash (0x + 64 hex chars)
  const match = combined.match(/0x[a-f0-9]{64}/i);
  if (!match) {
    console.error("\n✗ No root hash found in upload output");
    process.exit(1);
  }

  return match[0];
}

// ── Main ──────────────────────────────────────────────────────────────────

const bundle =
  process.argv[2] ?? "skillname-pack/examples/quote-uniswap/manifest.json";

if (!existsSync(bundle)) {
  console.error(`File not found: ${bundle}`);
  process.exit(1);
}

console.log(`0G Storage upload`);
console.log(`  RPC:     ${OG_RPC}`);
console.log(`  Indexer: ${INDEXER}`);
console.log(`  Vendor:  ${VENDOR}`);
console.log();

const root = uploadBundle(bundle);

console.log(`\n✅ Uploaded`);
console.log(`  Root:  ${root}`);
console.log(`  ENS:   xyz.manifest.skill.0g = ${root}`);
console.log();
console.log(`Next: set the ENS text record on your skill's name:`);
console.log(`  xyz.manifest.skill.0g = ${root}`);
