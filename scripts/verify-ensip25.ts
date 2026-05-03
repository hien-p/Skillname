#!/usr/bin/env tsx
/**
 * verify-ensip25.ts — for each *.skilltest.eth subname, run the full SDK
 * resolution path and confirm ENSIP-25 binding shows up as `bound: true`.
 *
 * This is the end-to-end smoke test for the binding work in PR #61:
 *
 *   1. SDK reads `xyz.manifest.skill` text record
 *   2. Fetches manifest from 0G via the URI scheme
 *   3. Reads `bundle.trust.erc8004` from the manifest
 *   4. Computes ENSIP-25 text-record key and reads it on the same name
 *   5. Returns `ensip25.bound: true` iff the value is non-empty
 *
 * Run:
 *   pnpm tsx scripts/verify-ensip25.ts
 */

import "dotenv/config";
// Import from the workspace package by relative path so this script runs
// from the repo root without a workspace dep declaration.
import { resolveSkill } from "../skillname-pack/packages/sdk/dist/index.js";

const NAMES = [
  "hello.skilltest.eth",
  "quote.skilltest.eth",
  "swap.skilltest.eth",
  "score.skilltest.eth",
  "weather.skilltest.eth",
  // Added 2026-05-03 (issue #69): infer + agent skills published after #56
  // closed; bound via mint-agents.ts agentIds 11/12.
  "infer.skilltest.eth",
  "agent.skilltest.eth",
];

async function main() {
  console.log(`verifying ENSIP-25 binding on ${NAMES.length} reference subnames\n`);
  let pass = 0;
  let fail = 0;
  for (const name of NAMES) {
    process.stdout.write(`${name.padEnd(28)} `);
    try {
      const r = await resolveSkill(name, { chain: "sepolia" });
      const bound = r.ensip25?.bound ?? false;
      const agentId = r.ensip25?.agentId ?? "?";
      if (bound) {
        console.log(`✓ bound (agentId ${agentId})`);
        pass++;
      } else {
        console.log(`✗ unbound (agentId ${agentId}, ensip25=${JSON.stringify(r.ensip25)})`);
        fail++;
      }
    } catch (e: any) {
      console.log(`✗ resolve failed: ${e?.shortMessage ?? e?.message ?? e}`);
      fail++;
    }
  }
  console.log(`\n${pass}/${NAMES.length} bound`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
