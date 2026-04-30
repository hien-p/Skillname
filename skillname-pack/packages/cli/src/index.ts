#!/usr/bin/env node
/**
 * @skillname/cli
 *
 * CLI for the skillname ENS skill registry.
 *
 * Usage:
 *   skill resolve <ensName> [--chain mainnet|sepolia] [--json]
 *   skill verify  <ensName> [--chain mainnet|sepolia]
 *   skill init    <name>
 *   skill publish <dir> <ensName>
 *   skill lock    <ensName>
 */

import { resolve } from "./commands/resolve.js";
import { verify } from "./commands/verify.js";
import { init } from "./commands/init.js";

const HELP = `
skill — ENS-native skill registry CLI

Commands:
  resolve <ensName>   Resolve an ENS name to its skill bundle
  verify  <ensName>   Validate schema + ENSIP-25 trust for a skill
  init    <name>      Scaffold a new skill bundle directory
  publish <dir> <ens> Publish a bundle to IPFS + set ENS text records
  lock    <ensName>   Generate a lockfile from skill imports

Options:
  --chain <chain>     Chain to resolve on (mainnet | sepolia, default: sepolia)
  --json              Output raw JSON instead of formatted text
  --help, -h          Show this help

Examples:
  skill resolve quote.uniswap.eth
  skill resolve quote.uniswap.eth --chain mainnet --json
  skill verify swap.uniswap.eth
  skill init my-skill
`.trim();

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const command = args[0];
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      flags.help = true;
    } else if (arg === "--json") {
      flags.json = true;
    } else if (arg === "--chain" && i + 1 < args.length) {
      flags.chain = args[++i];
    } else if (arg.startsWith("--")) {
      // Unknown flag — skip
      console.error(`Unknown flag: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  return { command, positional, flags };
}

async function main() {
  const { command, positional, flags } = parseArgs(process.argv);

  if (!command || flags.help) {
    console.log(HELP);
    process.exit(0);
  }

  switch (command) {
    case "resolve":
      if (!positional[0]) {
        console.error(
          "Usage: skill resolve <ensName> [--chain mainnet|sepolia] [--json]",
        );
        process.exit(1);
      }
      await resolve(positional[0], {
        chain: (flags.chain as "mainnet" | "sepolia") ?? "sepolia",
        json: !!flags.json,
      });
      break;

    case "verify":
      if (!positional[0]) {
        console.error(
          "Usage: skill verify <ensName> [--chain mainnet|sepolia]",
        );
        process.exit(1);
      }
      await verify(positional[0], {
        chain: (flags.chain as "mainnet" | "sepolia") ?? "sepolia",
      });
      break;

    case "init":
      if (!positional[0]) {
        console.error("Usage: skill init <name>");
        process.exit(1);
      }
      await init(positional[0]);
      break;

    case "publish":
      console.error("skill publish — not yet implemented. See issue #17.");
      process.exit(1);
      break;

    case "lock":
      console.error(
        "skill lock — not yet implemented. Depends on skill.imports (#3).",
      );
      process.exit(1);
      break;

    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});
