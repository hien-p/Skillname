# manifest.eth

ENS-native skill registry for AI agents — resolve any ENS name into a verified MCP skill bundle and load tools dynamically.

> **Status:** ETHGlobal Open Agents 2026, Apr 24 – May 6. Source seed and full design docs under [`manifest-eth-pack/`](./manifest-eth-pack/).

## Problem

Every AI-on-Ethereum project rewrites the same adapter glue. One MCP adapter for Uniswap. Another for Aave. Another for ENS itself. **N protocols × M agent frameworks = adapter explosion.** Every team pays the tax.

Anthropic's MCP Registry solves this for the Web2 case via DNS/GitHub. That registry doesn't compose with onchain identity, NFT-based name ownership, or onchain payment rails — exactly the primitives Ethereum already has.

## Solution

Each protocol publishes one content-addressed MCP skill bundle to IPFS, then sets an ENS text record pointing at the CID. Any MCP client (Claude Desktop, OpenClaw, Cursor, custom) resolves the ENS name, fetches the bundle, validates it, and registers the bundle's tools dynamically. **N + M, not N × M.**

```
research.agent.eth
  → ENS text record: xyz.manifest.skill = ipfs://bafy...
  → bundle: manifest.json + tools/ + prompts/ + examples/
  → MCP client loads tools (optional ENSIP-25 + ERC-8004 verification)
```

ENS gives this four things a plain JSON registry doesn't: human-readable names that wallets already render, NFT-native ownership that transfers cleanly, ENSIP-25 binding to ERC-8004 agent identity, and a free `*.eth.limo` public surface per name.

## Deliverables

Hackathon shipping checklist. Status reflects the current commit.

### Shipped

- [x] **JSON Schema v1** — `manifest-eth-pack/packages/schema/skill-v1.schema.json` (bundle root, tools, three execution types, payment + trust blocks)
- [x] **SDK `resolveSkill()`** — `manifest-eth-pack/packages/sdk/src/index.ts` (viem ENS text-record read, IPFS gateway fetch, ENSIP-25 verification + ERC-7930 encoder)
- [x] **MCP bridge skeleton** — `manifest-eth-pack/packages/bridge/src/server.ts` (stdio transport, dynamic tool registration with `<bundle>__<tool>` namespacing, working `http` executor)
- [x] **Reference bundle manifest** — `manifest-eth-pack/examples/research-agent/manifest.json` (three tools spanning `local` / `http` / `keeperhub`+x402)
- [x] **Plan + docs** — BUILD_PLAN, architecture sequence diagram, 4-min demo script, web-explorer spec, KeeperHub feedback skeleton

### P0 — D5–D7 (MVP demo-able)

- [ ] Schema validator wired into SDK (ajv import is currently commented out)
- [ ] CID hash verification via `@helia/verified-fetch` (currently plain gateway fetch)
- [ ] CLI: `manifest publish | resolve | verify` (`packages/cli/src/commands/` is empty)
- [ ] Storacha publish pipeline end-to-end
- [ ] Reference bundle tool / prompt / example files (only `manifest.json` exists today)
- [ ] ENS test name registered on Sepolia + text records set
- [ ] Bridge running live in Claude Desktop (D5 kill-criterion)

### P1 — D8–D10 (prize layer)

- [ ] KeeperHub execution adapter (currently a stub in `executeKeeperHub`)
- [ ] x402 payment flow — `@x402/hono` middleware, EIP-3009 USDC `transferWithAuthorization`
- [ ] ERC-8004 Identity NFT mint script + `agent-registration[…][…]` text record
- [ ] ENSIP-25 verified-badge round-trip end-to-end
- [ ] Read-only web explorer (per `manifest-eth-pack/docs/explorer-spec.md`)

### P2 — D11–D12 (polish + record)

- [ ] OpenClaw skill packaging (`clawhub install`)
- [ ] 0G Storage dual-pin in publish pipeline + `xyz.manifest.skill.0g` text record
- [ ] eth.limo deployment of explorer
- [ ] Demo recording — code freeze May 5 6PM

### Out of scope

Subname-per-version locking (NameWrapper fuses), wildcard resolver for fleets (ENSIP-10), full reputation system on top of ERC-8004, marketplace UI, AXL P2P discovery, ENSIP draft submission — all deferred to post-hackathon.

## License

MIT
