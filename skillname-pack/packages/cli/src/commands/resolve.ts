/**
 * skill resolve <ensName>
 *
 * Resolves an ENS name to its skill bundle via the SDK, then prints
 * a human-readable summary or raw JSON.
 *
 * Examples:
 *   skill resolve quote.uniswap.eth
 *   skill resolve quote.uniswap.eth --chain mainnet --json
 */

import { resolveSkill, type ResolveResult } from "@skillname/sdk";

export interface ResolveOptions {
  chain: "mainnet" | "sepolia";
  json: boolean;
}

export async function resolve(
  ensName: string,
  opts: ResolveOptions,
): Promise<void> {
  const t0 = Date.now();

  console.error(`→ Resolving ${ensName} on ${opts.chain}…`);

  let result: ResolveResult;
  try {
    result = await resolveSkill(ensName, {
      chain: opts.chain,
    });
  } catch (e: any) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }

  const dt = Date.now() - t0;

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Human-readable output
  const b = result.bundle;
  const verified = result.ensip25?.bound ? "✓ verified" : "· unverified";

  console.log();
  console.log(`  ${b.ensName}  (${verified})`);
  console.log(`  ${"─".repeat(50)}`);
  console.log(`  Name:        ${b.name}`);
  console.log(`  Version:     ${result.version ?? b.version}`);
  if (b.description) {
    console.log(`  Description: ${b.description}`);
  }
  if (b.author) {
    console.log(`  Author:      ${b.author}`);
  }
  if (b.license) {
    console.log(`  License:     ${b.license}`);
  }
  console.log(`  CID:         ${result.cid}`);
  if (result.schema) {
    console.log(`  Schema:      ${result.schema}`);
  }
  console.log();

  // Tools
  console.log(`  Tools (${b.tools.length}):`);
  for (const tool of b.tools) {
    const exec = tool.execution;
    let execLabel = exec.type;
    if (exec.type === "keeperhub" && "payment" in exec && exec.payment) {
      execLabel += ` · ${exec.payment.price} ${exec.payment.token}`;
    }
    if (exec.type === "http" && "endpoint" in exec) {
      execLabel += ` · ${exec.method ?? "POST"}`;
    }
    console.log(`    · ${b.name}__${tool.name}  [${execLabel}]`);
    console.log(`      ${tool.description}`);
  }

  // Trust
  if (result.ensip25) {
    console.log();
    console.log(`  Trust:`);
    console.log(
      `    ENSIP-25:  ${result.ensip25.bound ? "bound ✓" : "not bound"}`,
    );
    if (result.ensip25.registry) {
      console.log(`    Registry:  ${result.ensip25.registry}`);
      console.log(`    Agent ID:  ${result.ensip25.agentId}`);
    }
  }

  // Dependencies
  if (b.dependencies && b.dependencies.length > 0) {
    console.log();
    console.log(`  Dependencies (${b.dependencies.length}):`);
    for (const dep of b.dependencies) {
      console.log(`    · ${dep}`);
    }
  }

  console.log();
  console.log(`  Resolved in ${dt}ms`);
  console.log();
}
