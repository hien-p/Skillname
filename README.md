# skillname

> **ENS is the import statement for AI.**
> One ENS name = one AI skill. Compose agents by importing names.

**Status:** ETHGlobal Open Agents · Apr 24 – May 6, 2026 · ENS (both tracks) + KeeperHub + 0G

---

## In one line

```
import quote from "quote.uniswap.eth"
```

That ENS name resolves to a manifest on IPFS describing **one function** — input schema, output schema, optional payment via x402, trust signals. Any MCP client (Claude Desktop, OpenClaw, Cursor) imports it dynamically. No custom adapter per protocol. No registry to register with. No API key.

## In one paragraph

The unit is atomic: **one ENS name → one callable function**. Owner of the ENS = author of the function. An agent is a list of imports. The same primitive scales from one tool to a recursive dependency graph, with version pinning, lockfiles, on-chain analytics from x402 payments, and tradable ownership via OpenSea — all without leaving ENS + IPFS.

## Why this is unique

The wedge is **granularity**. Other ENS-AI projects map *agents* to ENS names; we map *functions* to names. An agent is just a manifest of imports.

| Project | Their unit | skillname |
|---|---|---|
| MVR (Sui) | `@org/package` SuiNS | `skill.org.eth` ENS |
| DoloX | agent has ENS | **skill** has ENS |
| LPlens | one agent → many tools | **one ENS → one tool** |
| AgentPassports | ENS verifies policy | ENS **is** callable |
| npm | centralized registry | each function lives at its own ENS |

No project in the 58-entry hackathon roster works at this granularity. This is the slot.

## Two-tier read

**Cover** — for judges, Twitter, anyone meeting it the first time:
> ENS is the import statement for AI.

**Engine** — for engineers, builders, anyone digging deeper:
> A package manager + analytics + marketplace + trust layer for AI skills, anchored on ENS. Like npm + crates.io + OpenSea, where every call is an on-chain x402 USDC payment. Granularity at the function level, not the agent level.

Both are true. Cover is the headline; engine is what's underneath. Same product.

## How it works

```
┌─────────────────────────────────────────────┐
│  MCP CLIENT (Claude / OpenClaw / Cursor)    │
│  + skillname Bridge                         │
└─────────────────────────────────────────────┘
                  │
                  │ import quote.uniswap.eth
                  ▼
┌─────────────────────────────────────────────┐
│  ENS Universal Resolver via viem             │
│   text(node, "xyz.manifest.skill")          │
│   text(node, "xyz.manifest.skill.imports")  │
└─────────────────────────────────────────────┘
                  │
                  │ fetch + verify CID; walk imports
                  ▼
┌─────────────────────────────────────────────┐
│  IPFS / 0G   manifest.json                   │
│  one function: name, input, output, exec    │
└─────────────────────────────────────────────┘
                  │
                  │ register single tool in MCP
                  ▼
┌─────────────────────────────────────────────┐
│  Tool calls route by execution.type:        │
│   • local   • http                          │
│   • keeperhub + x402 (paid → on-chain)      │
└─────────────────────────────────────────────┘
```

## Demo flow (4 min, 7 scenes)

1. **Hook (0:00–0:25).** Open `skillname.eth/explorer` → grid of skills with live call counts. *"Each card is one ENS name, one function."*
2. **Simple import (0:25–1:00).** In Claude Desktop: `Use quote.uniswap.eth` → one tool appears. Get a quote. *"One ENS name, one skill."*
3. **Compose (1:00–1:45).** Manifest with `imports: [quote, swap, score]` → bridge walks the graph → 3 tools loaded. *"Imports compose. Lockfile pinned on-chain."*
4. **Analytics (1:45–2:15).** Click `quote.uniswap.eth` in explorer → 12K calls / 30d, $621 revenue, top callers. *"Every call is an on-chain x402 tx — analytics can't be faked."*
5. **Versioning (2:15–2:40).** Show `v1.quote.uniswap.eth` (NameWrapper-locked) vs `v2`. Lockfile pins exact resolution. *"npm semver, on-chain."*
6. **Paid execution (2:40–3:20).** `swap.uniswap.eth` triggers x402 challenge → EIP-3009 USDC pay → KeeperHub swap → BaseScan tx confirmed.
7. **Closing (3:20–4:00).** *"ENS is the import statement for AI."*

Full script: [`docs/demo-script.md`](./skillname-pack/docs/demo-script.md).

## Deliverables

Full hierarchical checklist with sub-issues at [`docs/ROADMAP.md`](./skillname-pack/docs/ROADMAP.md). Summary:

### Tier 1 — Cover (MUST for demo)
- [x] **Schema v1** — atomic skill manifest, three execution types, payment, trust ([skill-v1.schema.json](./skillname-pack/packages/schema/skill-v1.schema.json))
- [x] **SDK `resolveSkill()`** — viem ENS read, IPFS gateway fetch, ENSIP-25 verify, ERC-7930 encoder ([sdk/src/index.ts](./skillname-pack/packages/sdk/src/index.ts))
- [x] **MCP bridge skeleton** — stdio, dynamic registration, `http` executor working, `keeperhub` stubbed ([bridge/server.ts](./skillname-pack/packages/bridge/src/server.ts))
- [x] **System dashboard** at [skillname.pages.dev](https://skillname.pages.dev) — Nothing-style bento UI
- [ ] **Three reference skills** published on Sepolia: `quote.uniswap.eth`, `swap.uniswap.eth`, `score.gitcoin.eth`
- [ ] **Bridge live in Claude Desktop** — D5 kill-criterion
- [ ] **`skill.imports`** dependency walker + lockfile generator
- [ ] **KeeperHub adapter** + **x402 payment** end-to-end on Base Sepolia

### Tier 2 — Engine (HIGH for ENS Most Creative + 0G Framework)
- [ ] **Skill Explorer** — search + skill detail + dep tree + analytics charts
- [ ] **On-chain analytics indexer** — scan x402 USDC tx on Base, aggregate per skill
- [ ] **Versioning + lockfile** — subname-as-version with NameWrapper fuses
- [ ] **CLI** — `skill init | publish | resolve | verify | lock`

### Tier 3 — Stretch
- [ ] **ERC-7857 iNFT** royalty wrapper for skill ownership
- [ ] **OpenSea metadata** showing live call/revenue stats
- [ ] **ENSIP draft** for `xyz.manifest.skill.*` namespace

## Why this wins each track

| Sponsor | Track | Where it lands |
|---|---|---|
| ENS | Best AI Integration | Bridge resolves ENS at runtime, no hard-coded values, demo proves it |
| ENS | Most Creative Use | Granularity (function = ENS), subname access tokens, ENSIP-25 binding to ERC-8004, ENSIP draft |
| KeeperHub | Best Use | x402 + KeeperHub adapter, OpenClaw packaging |
| 0G | Framework | "Other builders publish skills here" — primitives others adopt; iNFT optional stretch |

## Live

- Production: [skillname.pages.dev](https://skillname.pages.dev)
- Staging: [staging.skillname.pages.dev](https://staging.skillname.pages.dev)
- Repo: this one ([github.com/hien-p/Skillname](https://github.com/hien-p/Skillname))

## License

MIT
