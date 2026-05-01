# ENSIP Draft — `xyz.manifest.skill.*` text records for AI skill bundles

**Status:** Draft
**Author:** hien-p (skillname / ETHGlobal Open Agents 2026)
**Discussion:** https://discuss.ens.domains/c/ai
**Reference implementation:** https://github.com/hien-p/Skillname

## Abstract

This ENSIP proposes a standard `xyz.manifest.skill.*` text-record namespace that lets any ENS name resolve to an MCP-compatible AI skill bundle. With the standard in place, `import quote from "quote.uniswap.eth"` becomes the wire-level equivalent of `import {} from "..."` for AI agents — the ENS name *is* the import statement. No central registry, no per-protocol SDK adapters, no key juggling.

## Motivation

AI agents today integrate with external services through bespoke per-vendor SDKs or custom adapters in each agent framework. Every new protocol (Uniswap, Lido, Aave, …) ships a different package, with different auth, different schemas, and a different release cadence. Every framework (Claude Desktop, Cursor, OpenClaw, custom) re-implements the same glue. This grows as `O(protocols × frameworks)` and is the dominant source of agent fragility.

ENS already solves the analogous problem for human-readable identifiers and content addresses. Extending it with a normative text-record namespace for AI skills lets:
- **Protocols** publish a versioned skill bundle once, at `protocol.eth`.
- **Agents** import skills by ENS name and have any MCP-compatible client register the bundle's tools dynamically.
- **Wallets and explorers** display a human-meaningful "this name is an AI skill" affordance.

The unit of resolution is **one ENS name = one atomic skill (function)**. Composition happens via an explicit `imports` field — so `my-trader.eth` can declare `imports: [quote.uniswap.eth, swap.uniswap.eth]` and the resolver walks the graph.

## Specification

### Text record keys

| Key | Required | Type | Description |
|---|---|---|---|
| `xyz.manifest.skill` | yes | URI | Pointer to the bundle root. Schemes: `ipfs://<cid>`, `0g://<root>`, or `https://...`. |
| `xyz.manifest.skill.version` | yes | semver | Version of the bundle this record points to. |
| `xyz.manifest.skill.schema` | recommended | URI | URI of the JSON Schema the bundle validates against. v1 default: `https://manifest.eth/schemas/skill-v1.json`. |
| `xyz.manifest.skill.execution` | optional | string | Comma-separated list of execution backends declared by the bundle (`local`, `http`, `keeperhub`, `0g-compute`). Lets clients pre-filter without fetching the manifest. |
| `xyz.manifest.skill.0g` | optional | hex root | 0G Storage root hash for dual-pin redundancy when the primary `xyz.manifest.skill` value is IPFS. |
| `xyz.manifest.skill.imports` | optional | comma list | ENS names this bundle depends on. Resolvers MUST walk this list breadth-first; cycles MUST be rejected. |
| `xyz.manifest.skill.lockfile` | optional | URI | URI of a flat resolved dependency tree (`{name, version, cid}[]`) generated from `imports`. |

### Bundle layout

The URI in `xyz.manifest.skill` MUST resolve to a directory containing `manifest.json` at its root. The schema for `manifest.json` is normative and versioned via the `$schema` field. v1:

```json
{
  "$schema": "https://manifest.eth/schemas/skill-v1.json",
  "name": "quote-uniswap",
  "ensName": "quote.uniswap.eth",
  "version": "1.0.0",
  "description": "Get a Uniswap v3 quote.",
  "license": "MIT",
  "tools": [
    {
      "name": "get_quote",
      "description": "Quote tokenIn → tokenOut on Uniswap v3.",
      "inputSchema": { "type": "object", "required": ["tokenIn", "tokenOut", "amountIn"], "properties": { "...": "..." } },
      "execution": { "type": "http", "endpoint": "https://api.uniswap.org/v1/quote" }
    }
  ]
}
```

The bundle root requires `name`, `ensName`, `version`, `tools[]`. Each `tools[]` entry requires `name`, `description`, `inputSchema`, `execution`. Tool names match `^[a-z][a-z0-9_]*$`. Bundle names match `^[a-z0-9-]+$`. Together they form the namespaced identifier `<bundle.name>__<tool.name>` that MCP clients expose.

### Execution dispatch

The `execution.type` field selects how a tool is invoked:

- `local` — handler file shipped inside the bundle. The host runtime is responsible for sandboxing.
- `http` — direct `fetch()` to `endpoint`, with optional `payment` (x402) negotiation.
- `keeperhub` — routed through KeeperHub MCP for paid contract calls; payment via EIP-3009 USDC `transferWithAuthorization`.
- `0g-compute` — routed to a 0G Compute Network provider for decentralized AI inference.

Implementations MAY add execution backends. Unknown backends MUST cause a tool to be skipped (not the entire bundle to be rejected) so that older clients remain forward-compatible with new bundles.

### Resolution flow

Pseudocode for a conformant resolver:

```
resolveSkill(name):
  1. Read text record xyz.manifest.skill on `name` → uri
  2. Resolve uri → fetch manifest.json
  3. Validate manifest.json against the schema URI in $schema (or xyz.manifest.skill.schema)
  4. If trust.erc8004 declared: read agent-registration[<erc7930>][<agentId>] text record;
     a value of "1" means the ENS name confirms ownership of the ERC-8004 Identity NFT.
  5. If xyz.manifest.skill.imports present: walk breadth-first, depth ≤ 5, reject cycles.
  6. Return { bundle, cid, ensip25?, dependencies? }
```

### Trust binding (ENSIP-25 + ERC-8004)

Bundles MAY declare bidirectional trust by setting `bundle.trust.erc8004 = { registry: "eip155:<chainId>:<addr>", agentId }`. Resolvers verify by encoding `registry` as ERC-7930 and reading the `agent-registration[<erc7930>][<agentId>]` text record on the same ENS name. This binds the ENS name to the ERC-8004 Identity NFT in both directions.

## Rationale

**Why text records, not a new contract?** ENS's resolver layer is the universally-deployed primitive for "name → metadata". Adding a contract would force every framework to integrate a custom client; text records are read by every existing ENS library.

**Why one ENS name per atomic skill, not per agent?** Aligns with how software is actually composed — `import { useState } from "react"`, not `import "react/everything"`. Agents become small ENS import lists. Reuse and version-pinning fall out for free.

**Why a separate `imports` text record instead of inline dependencies in `manifest.json`?** Caching. The text record can be read without fetching IPFS, so an indexer can build the dependency graph for an entire ecosystem from L1 alone.

## Backwards compatibility

This proposal is purely additive. Existing ENS names without these records are unaffected. Wallets and explorers can detect "skill" names by the presence of `xyz.manifest.skill`.

## Reference implementation

- Schema: [`packages/schema/skill-v1.schema.json`](https://github.com/hien-p/Skillname/blob/main/skillname-pack/packages/schema/skill-v1.schema.json)
- Resolver SDK: [`packages/sdk/src/index.ts`](https://github.com/hien-p/Skillname/blob/main/skillname-pack/packages/sdk/src/index.ts) — `resolveSkill()`, `verifyEnsip25()`, `encodeErc7930()`
- MCP bridge: [`packages/bridge/src/server.ts`](https://github.com/hien-p/Skillname/blob/main/skillname-pack/packages/bridge/src/server.ts) — stdio server that registers resolved tools dynamically
- Live deployments: 5 reference subnames on `*.skilltest.eth` (Sepolia)

## Open questions

1. Should the `xyz.` TLD prefix be retained, or should the namespace be `skill.*` directly? `xyz.` follows the reverse-DNS convention used by most ENS text records today.
2. Should `xyz.manifest.skill.execution` be REQUIRED to let indexers filter without IPFS fetches? Currently optional.
3. Is `0g://` enough as a non-IPFS scheme, or should the spec define a generic content-address scheme that decentralized storage networks register against?

## Copyright

Released under CC0.
