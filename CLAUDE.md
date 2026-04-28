# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

This workspace is **pre-bootstrap scaffolding**, not a built monorepo. Everything lives under `skillname-pack/`, which is the seed payload for the real `skillname/` repo. There is no `package.json`, `pnpm-lock.yaml`, or `node_modules` yet — running `setup-day1.sh` creates a sibling `skillname/` directory with the workspace, CI, and `.env.example`, then optionally pushes to GitHub via `gh`. The script aborts if `skillname/` already exists, so run it once from a clean parent directory.

When working on the source files in `packages/`, treat them as authored-in-place ahead of the bootstrap: edit them here, and they will be carried into `skillname/` once the monorepo is initialized (or copied manually per the script's "next steps" output).

**Project name vs. spec name:** the project / repo / package scope is **skillname**. The ENS text-record namespace it implements stays as `xyz.manifest.skill.*` because that's a stable spec key — skillname is the registry, "skill" is what gets registered. Don't rename the text-record keys or the schema `$id` URL (`https://manifest.eth/schemas/skill-v1.json`); both are part of the on-the-wire spec.

## Commit conventions

When committing or opening PRs against `hien-p/Skillname` (or any artifact that ends up public on this repo), **do not include `Co-Authored-By: Claude …` trailers, do not sign commits as "claude", and do not mention "Claude" or "Anthropic" in commit messages, PR titles, descriptions, or issue comments**. The visible author/contributor list must show only `hien-p`. This applies to every commit regardless of how the change was produced.

References to "Claude Code" *inside* `CLAUDE.md` itself are fine — they describe how to operate the harness, not authorship of the codebase.

## Common commands

These work **after** the monorepo has been bootstrapped (post-`setup-day1.sh` + `pnpm install`):

```bash
pnpm install              # install all workspace deps
pnpm build                # tsc across all packages
pnpm test                 # vitest across all packages
pnpm lint                 # lint all packages
pnpm dev:bridge           # run the MCP bridge locally (stdio)
pnpm cli                  # invoke @skillname/cli (skill publish | resolve | verify)

# Single-package operations
pnpm --filter @skillname/sdk test
pnpm --filter @skillname/bridge build
pnpm --filter @skillname/schema test -- <pattern>   # vitest pattern filter
```

Required Node version: `>=20`. Package manager: `pnpm@9`.

## Architecture

**One sentence:** Protocols publish a content-addressed MCP skill bundle once at `protocol.eth`; any MCP client (Claude Desktop, OpenClaw, Cursor, custom) resolves the ENS name, fetches the bundle from IPFS, and registers the bundle's tools dynamically — replacing per-protocol-per-framework adapter code.

### Resolution pipeline (read this before touching the SDK or bridge)

1. **ENS text records** (read by `@skillname/sdk` `resolveSkill()`): `xyz.manifest.skill` → `ipfs://<cid>` (required), plus optional `.version`, `.schema`, `.execution`, `.0g`. The CID is fetched via public gateways (`w3s.link`, `ipfs.io`, `cloudflare-ipfs.com`); production should swap to `@helia/verified-fetch` for content-hash verification.
2. **Bundle layout** (the IPFS CID resolves to a directory): `manifest.json` (root, schema-validated) + `tools/*.json` + `prompts/*.md` + `examples/*` + optional `errors.md`.
3. **Schema validation** is gated by `packages/schema/skill-v1.schema.json` (JSON Schema draft-07). Bundle root requires `name`, `ensName`, `version`, `tools[]`. Each tool requires `name`, `description`, `inputSchema`, `execution`. The validator import in `sdk/src/index.ts` is currently commented out — wiring it up is part of finishing the SDK.
4. **ENSIP-25 trust** (optional): if the bundle declares `trust.erc8004 = { registry: "eip155:<chainId>:<addr>", agentId }`, the SDK encodes the registry as ERC-7930 and reads the `agent-registration[<erc7930>][<agentId>]` text record. A value of `"1"` means the ENS name confirms ownership of the ERC-8004 Identity NFT (bidirectional binding). The `encodeErc7930()` helper in `packages/sdk/src/index.ts` is the canonical implementation; do not duplicate it.

### MCP bridge dispatch

`packages/bridge/src/server.ts` is a stdio MCP server. It exposes two built-in tools:

- `manifest_load(ensName, chain)` — calls `resolveSkill()`, caches the result in an in-memory `Map<ensName, LoadedBundle>` (`CACHE_TTL_MS = 5 min`), and from then on returns the bundle's tools from `ListTools`.
- `manifest_list_loaded()` — diagnostic; returns currently cached bundles.

Loaded tools are exposed to the client under namespaced names: `<bundle.name>__<tool.name>` (double underscore separator). When a namespaced tool is called, the bridge looks up the bundle by name (not ENS — be aware of this when refactoring), then routes to one of three executors based on `tool.execution.type`:

- `local` — handler path inside the bundle. Currently a stub.
- `keeperhub` — routes to KeeperHub MCP (`execute_contract_call`, `execute_transfer`, etc.). If `execution.payment` is present, the bridge will negotiate x402 (HTTP 402 → EIP-3009 USDC `transferWithAuthorization` → retry with `X-PAYMENT` header). Both stubs today.
- `http` — direct `fetch()` to `endpoint`. Implemented.

When adding a new execution backend, extend the `Execution` union in `packages/sdk/src/index.ts`, the matching `oneOf` in `packages/schema/skill-v1.schema.json`, **and** the `executeRouted` switch in `packages/bridge/src/server.ts`. All three must agree.

### Repository layout

```
skillname-pack/
├── packages/
│   ├── schema/        # JSON Schema v1 (skill-v1.schema.json) + validator (planned)
│   ├── sdk/           # resolveSkill(), verifyEnsip25(), encodeErc7930() — pure TS
│   ├── bridge/        # MCP stdio server (consumes @skillname/sdk)
│   └── cli/           # `skill publish | resolve | verify` — empty src/, planned
├── examples/
│   └── research-agent/
│       ├── manifest.json        # Reference bundle: contract_scan (local), market_research (http), execute_contract_call (keeperhub + x402)
│       ├── tools/ prompts/ examples/   # currently empty
├── docs/
│   ├── architecture.md          # End-to-end sequence diagram + component table
│   ├── demo-script.md           # 4-min recorded demo (D12)
│   └── VISION.md                # Post-hackathon target shape (Agent Name Registry framing)
├── scripts/                      # ensip25-bind.ts, 0g-pin.ts (planned)
├── BUILD_PLAN.md                # 14-day plan; ownership matrix; kill-criteria
├── FEEDBACK.md                  # KeeperHub bounty gate (must exist at repo root)
├── README.md                    # Public-facing, ENS text record convention table
└── setup-day1.sh                # Creates the real ./skillname/ monorepo
```

`packages/cli/src/commands/` exists but is empty — the CLI is on the build plan but unimplemented. `apps/web/` is referenced in the README/build plan but not present in the seed payload yet.

## Hackathon-specific constraints (from BUILD_PLAN.md)

This is an ETHGlobal Open Agents 2026 submission (Apr 24 – May 6). Constraints that affect what code is acceptable:

- **No hard-coded ENS values.** ENS resolution must happen at runtime — the ENS prize page rejects hard-coded shortcuts. If you write a fixture or fallback, gate it behind a clearly-labeled `--mock` flag, never the default path.
- **`FEEDBACK.md` is load-bearing**, not throwaway docs. It's the KeeperHub Builder Feedback Bounty gate; deleting it or moving it out of the repo root forfeits the prize. Append entries during the build, don't rewrite from scratch.
- **3-prize cap on submission.** Locked tracks: ENS (Best AI Integration + Most Creative), KeeperHub (Best Use + Builder Feedback), 0G (Framework/Tooling). Don't pull in a fourth integration unless the build plan's "aggressive stretch" gate (D10 EOD green) has been met.
- **Trunk-based development with daily EOD tags** (`tag-d1-eod`, `tag-d2-eod`, …). Main always demo-able. PR review SLA is 4 hours.
- **Code freeze: May 5 6PM** (D12). After that, only demo recording and submission text changes.

## Authoring a skill bundle

A working bundle must:

1. Validate against `packages/schema/skill-v1.schema.json` (root requires `name`, `ensName`, `version`, `tools[]`; each tool requires `name`, `description`, `inputSchema`, `execution`).
2. Use `name` matching `^[a-z0-9-]+$` and tool names matching `^[a-z][a-z0-9_]*$` — these become the `<bundle.name>__<tool.name>` MCP tool identifiers.
3. Use `ensName` matching `^([a-z0-9-]+\.)+eth$`.
4. Pin to IPFS (Storacha primary; 0G dual-pin via `xyz.manifest.skill.0g` text record; Pinata fallback).
5. Set ENS text records: `xyz.manifest.skill = ipfs://<cid>`, `xyz.manifest.skill.version = <semver>`, `xyz.manifest.skill.schema = https://manifest.eth/schemas/skill-v1.json`. The CLI `skill publish` will automate this once implemented.

The reference bundle at `examples/research-agent/manifest.json` is the canonical example covering all three execution types (`local`, `http`, `keeperhub` with x402 payment).
