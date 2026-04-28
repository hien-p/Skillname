# manifest.eth

> **ENS-native registry for AI agent skills.**
> Resolve any ENS name into a verified MCP skill bundle and load tools dynamically. No custom adapters per protocol. No hard-coded endpoints.

**Status:** ETHGlobal Open Agents · Apr 24 – May 6, 2026 · Targeting ENS (both tracks) + KeeperHub + 0G

## Problem

Today, an AI agent looks like this from the outside:

```
0x91A3...f2c9
https://random-api.com/mcp
unknown owner
unknown tools
unknown reputation
```

You don't know who controls it, what it can do, what it depends on, or whether it's trustworthy.

Worse — every AI agent framework rewrites adapter glue per protocol. One MCP adapter for Uniswap, another for Aave, another for ENS itself. **N protocols × M agent frameworks = adapter explosion.** Every agent team pays the tax.

Anthropic's MCP Registry solves this for the Web2 case via DNS/GitHub. That registry doesn't compose with onchain identity, NFT-based name ownership, or onchain payment rails — exactly the primitives Ethereum already has.

## Solution

Each protocol publishes one content-addressed MCP skill bundle to IPFS, then sets ENS text records pointing at the CID. Any MCP client (Claude Desktop, OpenClaw, Cursor, custom) resolves the ENS name, fetches the bundle, validates it against schema v1, and registers the bundle's tools dynamically. **N + M, not N × M.**

```
research.agent.eth
  → ENS text record: xyz.manifest.skill = ipfs://bafy...
  → bundle: manifest.json + tools/ + prompts/ + examples/
  → MCP client loads tools (with optional ENSIP-25 + ERC-8004 verification)
```

ENS gives this four things a plain JSON registry doesn't:

- **Human-readable names** wallets already render (MetaMask, Rainbow, Etherscan)
- **NFT-native ownership** that transfers cleanly — sell the name, sell the publishing authority
- **ENSIP-25 binding** to ERC-8004 for verifiable agent identity
- **Free `*.eth.limo` public surface** per name

## How it works

```
┌──────────────────────────────────────────────────────────┐
│  MCP CLIENT (Claude Desktop / OpenClaw / Cursor)         │
│  + manifest.eth Bridge                                   │
└──────────────────────────────────────────────────────────┘
                  │
                  │ ① user: "Use research.agent.eth"
                  ▼
┌──────────────────────────────────────────────────────────┐
│  ENS Universal Resolver via viem                         │
│   text(node, "xyz.manifest.skill")     → ipfs://bafy...  │
│   text(node, "xyz.manifest.skill.version") → "1.0.0"     │
│   text(node, "agent-registration[…][…]") → "1" (ENSIP-25)│
└──────────────────────────────────────────────────────────┘
                  │
                  │ ② fetch bundle + verify CID
                  ▼
┌──────────────────────────────────────────────────────────┐
│  IPFS / 0G Storage (Storacha primary, 0G dual-pin)       │
│  manifest.json + tools/ + prompts/ + examples/           │
└──────────────────────────────────────────────────────────┘
                  │
                  │ ③ register MCP tools dynamically
                  ▼
┌──────────────────────────────────────────────────────────┐
│  Tool calls route by execution.type:                     │
│   • local: handler in bundle                             │
│   • http: direct fetch                                   │
│   • keeperhub: KeeperHub MCP + optional x402 payment     │
└──────────────────────────────────────────────────────────┘
```

## ENS text record convention

| Key | Value | Required |
|---|---|---|
| `xyz.manifest.skill` | `ipfs://bafy...` (CID of bundle) | yes |
| `xyz.manifest.skill.version` | `1.0.0` (semver) | yes |
| `xyz.manifest.skill.schema` | URI of the schema being validated against | yes |
| `xyz.manifest.skill.execution` | `keeperhub` \| `local` \| `axl` | optional |
| `xyz.manifest.skill.0g` | 0G blob ID for dual-pin redundancy | optional |
| `agent-registration[<reg>][<id>]` | `1` (ENSIP-25 ↔ ERC-8004 binding) | optional |

`setText(...)` is gated by ENS Registry / NameWrapper ownership — only the ENS name owner can publish under that name. **No new auth contract needed.** Sell the ENS name on OpenSea, you sell the publishing authority. This is the same access pattern Sui's MVR uses, applied to 3.5M existing ENS names.

## Deliverables

### Shipped

- [x] **JSON Schema v1** — [`packages/schema/skill-v1.schema.json`](./manifest-eth-pack/packages/schema/skill-v1.schema.json)
  Full draft-07 schema. Bundle root requires `name` / `ensName` / `version` / `tools[]`. Three execution variants (`local` / `http` / `keeperhub`) discriminated via `oneOf`. Payment block (`x402` / `mpp`). Trust block (`ensip25` + `erc8004`).

- [x] **SDK `resolveSkill()`** — [`packages/sdk/src/index.ts`](./manifest-eth-pack/packages/sdk/src/index.ts)
  Pure-TS resolver. Wraps viem's `getEnsText` against the Universal Resolver on mainnet/sepolia, fetches the bundle from public IPFS gateways (`w3s.link`, `ipfs.io`, `cloudflare-ipfs.com`), and runs ENSIP-25 verification including the **ERC-7930 interoperable-address encoder** (`encodeErc7930`). Exports typed surface: `SkillBundle`, `Tool`, `Execution`, `ResolveResult`.

- [x] **MCP bridge skeleton** — [`packages/bridge/src/server.ts`](./manifest-eth-pack/packages/bridge/src/server.ts)
  stdio MCP server. Two built-in tools — [`manifest_load`](./manifest-eth-pack/packages/bridge/src/server.ts) and `manifest_list_loaded`. In-memory bundle cache with 5-min TTL. Dynamic tool registration with `<bundle>__<tool>` namespacing on `ListTools`. Working `http` executor; `local` and `keeperhub` paths are stubbed with explicit TODOs marked by phase.

- [x] **Reference bundle manifest** — [`examples/research-agent/manifest.json`](./manifest-eth-pack/examples/research-agent/manifest.json)
  Hand-authored bundle covering all three execution types in one file: `contract_scan` (local), `market_research` (http via CoinGecko), `execute_contract_call` (keeperhub + $0.05 USDC x402 on Base Sepolia). Includes a populated `trust.erc8004` block to drive the ENSIP-25 verification path end-to-end.

- [x] **Plan + design docs**
  - [`BUILD_PLAN.md`](./manifest-eth-pack/BUILD_PLAN.md) — 14-day plan, role split (Bridge / Execution / Identity-Storage), kill-criteria per checkpoint, prize alignment matrix
  - [`docs/architecture.md`](./manifest-eth-pack/docs/architecture.md) — end-to-end sequence diagram with one column per component (User → Claude → Bridge → viem → IPFS → KeeperHub → Base) + component responsibility table
  - [`docs/demo-script.md`](./manifest-eth-pack/docs/demo-script.md) — 4-minute, 8-scene recording script with per-beat narration and timing
  - [`docs/explorer-spec.md`](./manifest-eth-pack/docs/explorer-spec.md) — D10 read-only web explorer spec: routes, layout, three-state verified badge, error states, tech-stack rationale
  - [`FEEDBACK.md`](./manifest-eth-pack/FEEDBACK.md) — KeeperHub Builder Feedback Bounty skeleton (UX / bugs / docs / requests / what-worked sections)

- [x] **Project setup**
  - [`setup-day1.sh`](./manifest-eth-pack/setup-day1.sh) — bootstrap script that expands the seed payload into a working pnpm monorepo with CI workflow scaffolded
  - [`how_to_contributing.md`](./how_to_contributing.md) — branch workflow (`main` ↔ production, `staging` ↔ testnet, `feature/*`, `hotfix/*` with back-merge rule)
  - [`CLAUDE.md`](./CLAUDE.md) — orientation for contributors using Claude Code in this repo

### Pending

#### MVP demo-able

- [ ] Schema validator wired into SDK — the ajv import in [`packages/sdk/src/index.ts`](./manifest-eth-pack/packages/sdk/src/index.ts) lines 143–144 is currently commented out
- [ ] CID hash verification via `@helia/verified-fetch` — current implementation uses plain gateway fetch
- [ ] CLI: `manifest publish | resolve | verify` — [`packages/cli/src/commands/`](./manifest-eth-pack/packages/cli/) exists but is empty
- [ ] Storacha publish pipeline end-to-end — `w3up-client` upload + ENS `setText` orchestration
- [ ] Reference bundle tool / prompt / example files — only [`manifest.json`](./manifest-eth-pack/examples/research-agent/manifest.json) exists; no executable handlers under `tools/`, no markdown under `prompts/`
- [ ] ENS test name registered on Sepolia + text records set
- [ ] Bridge running live in Claude Desktop — **D5 kill-criterion** per BUILD_PLAN

#### Onchain execution + identity

- [ ] KeeperHub execution adapter — `executeKeeperHub` in [`packages/bridge/src/server.ts`](./manifest-eth-pack/packages/bridge/src/server.ts) is currently a stub
- [ ] x402 payment flow — `@x402/hono` middleware + CDP facilitator + EIP-3009 USDC `transferWithAuthorization` + retry-with-`X-PAYMENT` flow
- [ ] ERC-8004 Identity NFT mint script + `agent-registration[<erc7930>][<agentId>]` text record set on the test ENS name
- [ ] ENSIP-25 verified-badge end-to-end — bundle declares trust → SDK reads binding → bridge surfaces ✓ in `manifest_load` response
- [ ] Read-only web explorer — per [`docs/explorer-spec.md`](./manifest-eth-pack/docs/explorer-spec.md)

#### Polish + record

- [ ] OpenClaw skill packaging — `clawhub install manifest-eth/research-agent` working; same bundle visible in two MCP clients
- [ ] 0G Storage dual-pin in publish pipeline + `xyz.manifest.skill.0g` text record
- [ ] eth.limo deployment of explorer — static export → IPFS pin → ENS `contenthash` set on `manifest.eth`
- [ ] Demo recording — code freeze May 5 6PM, 5 takes, upload unlisted to YouTube and embed in submission

### Out of scope

Subname-per-version locking (NameWrapper fuses), wildcard resolver for fleets (ENSIP-10), full ERC-8004 reputation aggregation, marketplace / discovery UI, AXL P2P discovery, dependency-graph walking, live observability Sessions API, ENSIP draft submission — all deferred to post-hackathon.

## Prize alignment

| Sponsor | Track | $ | Where in repo |
|---|---|---|---|
| ENS | Best AI Agent Integration | $2,500 | [`packages/bridge`](./manifest-eth-pack/packages/bridge/) + [`packages/sdk`](./manifest-eth-pack/packages/sdk/), demo scene 3 |
| ENS | Most Creative Use | $2,500 | ENSIP-25 binding (`encodeErc7930` in [`sdk/index.ts`](./manifest-eth-pack/packages/sdk/src/index.ts)), text records as registry, draft ENSIP post-hackathon |
| KeeperHub | Best Use | $2,500 | `executeKeeperHub` adapter in [`bridge/server.ts`](./manifest-eth-pack/packages/bridge/src/server.ts), OpenClaw packaging, x402 middleware, demo scene 6 |
| KeeperHub | Builder Feedback Bounty | $250 | [`FEEDBACK.md`](./manifest-eth-pack/FEEDBACK.md) |
| 0G | Agent Framework, Tooling & Core Extensions | $2,500 | manifest spec as framework, 0G dual-pin in publish pipeline + `xyz.manifest.skill.0g` text record |

Total addressable: ~$10,250. Realistic top-3 in 1–2 tracks: $3K–$6K expected.

## License

MIT
