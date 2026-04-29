/**
 * skill verify <ensName>
 *
 * Resolves a skill and runs validation checks:
 *   1. ENS text record exists
 *   2. CID fetches successfully
 *   3. Bundle validates against schema v1
 *   4. ENSIP-25 trust binding (if declared)
 *   5. Atomic check: exactly 1 tool
 */

import { resolveSkill } from "@skillname/sdk";

export interface VerifyOptions {
  chain: "mainnet" | "sepolia";
}

export async function verify(
  ensName: string,
  opts: VerifyOptions,
): Promise<void> {
  let failures = 0;

  function check(label: string, ok: boolean, detail?: string) {
    if (ok) {
      console.log(`  ✓ ${label}`);
    } else {
      failures++;
      console.log(`  ✗ ${label}${detail ? `  — ${detail}` : ""}`);
    }
  }

  console.log();
  console.log(`  Verifying ${ensName} on ${opts.chain}`);
  console.log(`  ${"─".repeat(50)}`);

  // Step 1-3: resolve (includes ENS read, IPFS fetch, schema validation)
  let result;
  try {
    result = await resolveSkill(ensName, { chain: opts.chain });
    check("ENS text record found", true);
    check("CID fetched from IPFS", true);
    check("Schema v1 validation passed", true);
  } catch (e: any) {
    const msg = e.message ?? String(e);
    if (msg.includes("No skill manifest")) {
      check("ENS text record found", false, msg);
    } else if (msg.includes("Failed to fetch")) {
      check("ENS text record found", true);
      check("CID fetched from IPFS", false, msg);
    } else if (msg.includes("schema validation")) {
      check("ENS text record found", true);
      check("CID fetched from IPFS", true);
      check("Schema v1 validation passed", false, msg);
    } else {
      check("Resolution", false, msg);
    }
    console.log();
    console.log(`  ${failures} check(s) failed.`);
    console.log();
    process.exit(1);
  }

  // Step 4: ENSIP-25
  const b = result.bundle;
  if (b.trust?.erc8004) {
    check("ENSIP-25 trust declared", true);
    check(
      "ENSIP-25 binding verified",
      result.ensip25?.bound === true,
      result.ensip25?.bound
        ? undefined
        : 'agent-registration text record not set to "1"',
    );
  } else {
    console.log(`  · ENSIP-25 trust not declared (optional)`);
  }

  // Step 5: Atomic check
  check(
    `Atomic skill (${b.tools.length} tool)`,
    b.tools.length === 1,
    b.tools.length !== 1 ? `expected 1 tool, got ${b.tools.length}` : undefined,
  );

  // Step 6: Name conventions
  const nameOk = /^[a-z0-9-]+$/.test(b.name);
  check(`Bundle name "${b.name}" matches pattern`, nameOk);

  const ensOk = /^([a-z0-9-]+\.)+eth$/.test(b.ensName);
  check(`ENS name "${b.ensName}" matches pattern`, ensOk);

  for (const tool of b.tools) {
    const toolOk = /^[a-z][a-z0-9_]*$/.test(tool.name);
    check(`Tool name "${tool.name}" matches pattern`, toolOk);
  }

  // Summary
  console.log();
  if (failures === 0) {
    console.log(`  All checks passed. ✓`);
  } else {
    console.log(`  ${failures} check(s) failed.`);
  }
  console.log();
  process.exit(failures > 0 ? 1 : 0);
}
