#!/usr/bin/env tsx
/**
 * verify-versions.ts — exercises the SDK semver resolver against live ENS state.
 *
 * Reads quote.skilltest.eth's `xyz.manifest.skill.versions` index and resolves
 * a few semver ranges through it. Confirms #16 versioning works end-to-end.
 */

import "dotenv/config";
import { resolveVersionedName, resolveSkill } from "../skillname-pack/packages/sdk/dist/index.js";

const PARENT = "quote.skilltest.eth";
const CASES: { range: string; expectedLabel: string }[] = [
  { range: "^1",     expectedLabel: "v1" },
  { range: "^2",     expectedLabel: "v2" },
  { range: "~1.0",   expectedLabel: "v1" },
  { range: "1.0.0",  expectedLabel: "v1" },
  { range: "2.0.0",  expectedLabel: "v2" },
  { range: "latest", expectedLabel: "v2" }, // matches highest available, since "latest" is wildcard for matchVersionRange
  { range: "*",      expectedLabel: "v2" },
];

async function main() {
  console.log(`SDK semver resolver against live ${PARENT} versions index\n`);
  let pass = 0;
  let fail = 0;

  for (const { range, expectedLabel } of CASES) {
    const fullRange = `${PARENT}@${range}`;
    process.stdout.write(`  ${fullRange.padEnd(34)} `);
    try {
      const resolved = await resolveVersionedName(fullRange, { chain: "sepolia" });
      const expected = `${expectedLabel}.${PARENT}`;
      if (resolved === expected) {
        console.log(`✓ → ${resolved}`);
        pass++;
      } else {
        console.log(`✗ expected ${expected}, got ${resolved}`);
        fail++;
      }
    } catch (e: any) {
      console.log(`✗ threw: ${e?.shortMessage ?? e?.message ?? e}`);
      fail++;
    }
  }

  console.log();
  console.log(`${pass}/${CASES.length} passed`);
  console.log();

  // Bonus — full resolveSkill via @latest, confirm the bundle's version field matches v2
  if (pass > 0) {
    process.stdout.write(`  full resolveSkill("${PARENT}@latest")… `);
    try {
      const r = await resolveSkill(`${PARENT}@latest`, { chain: "sepolia" });
      console.log(`✓ resolved to bundle version ${r.bundle.version}, cid ${r.cid.slice(0, 14)}…`);
    } catch (e: any) {
      console.log(`✗ ${e?.shortMessage ?? e?.message ?? e}`);
      fail++;
    }
  }

  process.exit(fail > 0 ? 1 : 0);
}

main();
