# Vision — Agent Name Registry (post-hackathon target)

> **What this is:** the post-hackathon target shape of the project. Some features described here (live Sessions API, dependency-graph walking, subname access tokens, multi-agent reference set) are **not built today** and are explicitly out-of-scope before the May 5 code freeze.
>
> **What is built today:** see [`README.md`](../../README.md) and [`BUILD_PLAN.md`](../BUILD_PLAN.md). Schema, SDK, MCP bridge skeleton, reference manifest, ENSIP-25 + ERC-7930 helper, three execution types (local / http / keeperhub+x402) — these are real. Everything else here is the road past May 6.
>
> **Naming pivot:** this doc uses the `Agent Name Registry` framing with `agenthub.eth` example names and `agent.*` text records. The current codebase uses `skillname` with `xyz.manifest.skill.*` text records. Post-hackathon, the call is option 2 (full pivot to this spec) or option 3 (cherry-pick dependency graph + Sessions API on top of current namespace). Decided after submission.

---

# Agent Name Registry

> **An ENS-native registry for AI agents.**
> Human-readable, verifiable, dependency-aware AI agents powered by ENS.

ETHGlobal Open Agents · Apr 24 – May 6, 2026
Targeting: ENS (both tracks) + KeeperHub + 0G · ~$10K addressable

---

## What we're building

**Agent Name Registry** is an ENS-powered registry where AI agents publish their identity, wallet, capabilities, tool dependencies, MCP endpoints, versions, and trust metadata under human-readable ENS names.

We built an **ENS-native discovery layer for MCP-compatible skills** — every agent or onchain protocol gets an ENS name, ENS text records point to a content-addressed manifest on IPFS / 0G Storage, and any MCP-compatible client resolves the name and dynamically loads the agent's tools and dependencies.

No custom adapters per protocol. No hard-coded API endpoints. No unknown owners. Just resolve `trading.agenthub.eth` and you get the full picture.

---

## The problem

Today, an AI agent looks like this from the outside:

```
0x91A3...f2c9
https://random-api.com/mcp
unknown owner
unknown tools
unknown reputation
unknown dependencies
```

You don't know who controls it, what it can do, what it depends on, whether it's trustworthy, or how to verify any of it.

Worse — every AI agent framework rewrites adapter glue per protocol. One MCP adapter for Uniswap, another for Aave, another for ENS itself. **N protocols × M agent frameworks = adapter explosion.** Every agent team pays this tax.

---

## The solution

Replace opaque addresses with ENS names that resolve to verifiable, dependency-aware agent manifests:

```
trading.agenthub.eth
research.agenthub.eth
audit.agenthub.eth
price.agenthub.eth
risk.agenthub.eth
news.agenthub.eth
```

Every name resolves to:
- **Identity** — wallet address, owner, reputation
- **Capabilities** — declared tools (market-analysis, risk-check, trade-signal, …)
- **MCP endpoint** — where to actually call the agent
- **Version** — semantic versioning for forward compat
- **Dependencies** — other agent names this agent calls
- **Trust** — source repo, audit hash, ENSIP-25/ERC-8004 attestation

The protocol publishes once at `protocol.eth`. Every MCP client — Claude Desktop, OpenClaw, Cursor, custom — resolves the name and gets working tools. Adapter explosion collapses to N + M instead of N × M.

---

## The agent manifest

```json
{
  "name": "trading.agenthub.eth",
  "version": "1.0.0",
  "wallet": "0x91A3...f2c9",
  "mcp": "https://api.agenthub.xyz/mcp/trading",
  "capabilities": ["market-analysis", "risk-check", "trade-signal"],
  "dependencies": [
    "price.agenthub.eth",
    "news.agenthub.eth",
    "risk.agenthub.eth"
  ],
  "tools": [
    {
      "name": "execute_trade",
      "description": "Execute a trade through KeeperHub with x402 payment",
      "inputSchema": { "...": "..." },
      "execution": {
        "type": "keeperhub",
        "payment": {
          "protocol": "x402",
          "price": "$0.05",
          "token": "USDC",
          "network": "base"
        }
      }
    }
  ],
  "trust": {
    "source": "github.com/hien-p/trading-agent",
    "audit": "ipfs://bafyaudit...",
    "attestation": "0xattest...",
    "ensip25": { "enabled": true },
    "erc8004": {
      "registry": "eip155:1:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
      "agentId": 42
    }
  }
}
```

## ENS text records — what's actually written onchain

Small fields go directly into ENS text records. The full manifest goes to IPFS, with the CID stored in ENS:

```
agent.manifest     = ipfs://bafy...
agent.mcp          = https://api.agenthub.xyz/mcp/trading
agent.version      = 1.0.0
agent.dependencies = price.agenthub.eth,risk.agenthub.eth,news.agenthub.eth
agent.wallet       = 0x91A3...f2c9
agent.0g           = <0g-blob-id>                 (optional dual-pin)
agent-registration[<reg>][<id>] = 1                (ENSIP-25 binding)
```

This works because [ENSIP-5 text records](https://docs.ens.domains/ensip/5) support arbitrary key-value pairs with reverse-DNS prefixes, and the [Universal Resolver](https://docs.ens.domains/resolvers/universal/) is the canonical entrypoint for modern ENS resolution.

---

## Why ENS?

The ENS Open Agents prize page explicitly asks for projects where ENS does real work — resolving the agent's address, storing metadata, gating access, enabling discovery, or coordinating agent-to-agent interaction. Agent Name Registry uses ENS for **all of these simultaneously**:

| ENS function | What we use it for |
|---|---|
| Human-readable identity | `trading.agenthub.eth` instead of `0x91A3…f2c9` |
| Text records | Manifest CID, version, MCP endpoint, dependencies |
| Runtime resolution | AI client resolves ENS at runtime — no hard-coded values |
| Metadata | Capabilities, owner, trust info |
| Verification | ENSIP-25 binds the ENS name to ERC-8004 agent registry |
| Discovery | Agents find each other and their tools by ENS name |
| Authority | Only ENS owner can publish/update manifest under that name |
| Subnames as access tokens | `premium.market.agenthub.eth` gated by NFT/allowlist |

ENS is not cosmetic in this project. ENS coordinates agent-to-agent interaction.

---

## Creative ENS use — three layers beyond name → address

### 1. Subnames as access tokens

```
premium.market.agenthub.eth
```

Only wallets holding a specific NFT, ERC-20 balance, or allowlist credential can resolve this name. The resolver enforces gating at lookup time using [ENSIP-10 wildcard resolution](https://docs.ens.domains/ensip/10) and onchain checks. Free agents resolve normally; gated agents return empty unless the caller qualifies.

This turns subnames into **stateful access primitives**, not just identifiers.

### 2. Agent dependency graph

```
trading.agenthub.eth depends on:
  ├── price.agenthub.eth
  │     └── feed.chainlink.agenthub.eth
  ├── risk.agenthub.eth
  └── news.agenthub.eth
```

When a user calls `trading.agenthub.eth`, the resolver walks the `agent.dependencies` text record, recursively resolves each dependency, and loads the entire graph. ENS becomes the **dependency manifest layer for AI agents** — package.json for the agent ecosystem, but onchain and wallet-owned.

### 3. ENSIP-25 verified identity

Every agent can opt into a bidirectional binding with [ERC-8004 IdentityRegistry](https://eips.ethereum.org/EIPS/eip-8004) using the [ENSIP-25](https://docs.ens.domains/ensip/25) text-record format:

```
agent-registration[0x000100000101148004a169fb4a3325136eb29fa0ceb6d2e539a432][42] = "1"
```

A verifier reads the agent's registration in ERC-8004, constructs the ENSIP-25 key, and confirms the ENS owner attested to the link. Two-sided proof that this ENS name **really controls** the agent it claims.

---

## How it works — end to end

```
┌─────────────────────────────────────────────────────────────┐
│  AI CLIENT  (Claude Desktop / OpenClaw / Cursor)            │
│  + Agent Name Registry MCP Bridge                           │
└─────────────────────────────────────────────────────────────┘
                       │
                       │ ① user: "Use trading.agenthub.eth"
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  ENS Universal Resolver (mainnet) via viem                  │
│   • text(node, "agent.manifest")     → ipfs://bafy...        │
│   • text(node, "agent.dependencies") → price.eth,risk.eth    │
│   • text(node, "agent-registration[...][42]") → "1"         │
└─────────────────────────────────────────────────────────────┘
                       │
                       │ ② fetch CID + verify hash (helia)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  IPFS / 0G Storage  (Storacha primary, 0G dual-pin)         │
│  Manifest:                                                   │
│    name, version, wallet, mcp, capabilities                  │
│    tools[] (MCP tool defs with execution + payment)         │
│    dependencies[] (other ENS names)                          │
│    trust (source, audit, attestation, ENSIP-25, ERC-8004)   │
└─────────────────────────────────────────────────────────────┘
                       │
                       │ ③ recursively resolve dependencies
                       │    (price.agenthub.eth, risk.agenthub.eth, ...)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Dependency graph hydrated — full agent system loaded        │
└─────────────────────────────────────────────────────────────┘
                       │
                       │ ④ register MCP tools dynamically
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  MCP runtime — tools visible to LLM                          │
│  Onchain calls route to:                                     │
│   • KeeperHub MCP (execute_transfer, execute_contract_call) │
│   • Pay-per-call via x402 (USDC on Base)                    │
└─────────────────────────────────────────────────────────────┘
                       │
                       │ ⑤ emit events to Sessions API
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Live observability: agentname.eth/sessions/<id>             │
│  • Real-time timeline of every resolution + call             │
│  • Shareable URL — judges can replay anytime                 │
└─────────────────────────────────────────────────────────────┘
```

---

## Live observability — Sessions API

Every Bridge interaction streams events to a public **Sessions API** that powers a live timeline UI on our website. When a user types "Use trading.agenthub.eth" in Claude Desktop:

- Bridge resolves ENS, fetches manifest, walks dependencies, registers tools
- Bridge fires events: `ens.lookup`, `ipfs.fetch`, `dependency.resolve`, `ensip25.check`, `tools.registered`, `tool.call.start`, `x402.challenge`, `x402.payment`, `keeperhub.result`
- Each event lands in a Cloudflare Durable Object via `POST /sessions/:id/events`
- The Sessions web page subscribes via WebSocket, renders a live timeline with three swim lanes: **User · Bridge · Onchain**
- Every tx hash links to BaseScan/Etherscan; every IPFS CID links to a gateway; every ENS lookup is replayable

After the demo, the session URL stays live forever. **Judges click → see exactly what happened in our video, on demand.** This converts the project from "demo" to "product" — anyone can install Bridge and share their own sessions.

---

## Architecture

```
agent-name-registry/
├── packages/
│   ├── schema/         # Manifest JSON Schema v1
│   ├── sdk/            # resolveAgent(), verifyEnsip25(), walkDependencies()
│   ├── bridge/         # MCP stdio server — the magic
│   └── cli/            # `agent publish | resolve | verify`
├── apps/
│   ├── web/            # Landing + ENS explorer + sessions UI
│   └── sessions-api/   # Cloudflare Worker + Durable Objects
├── examples/
│   ├── trading-agent/  # Reference manifest with dependencies
│   ├── price-agent/    # Dependency leaf
│   └── risk-agent/     # Dependency leaf
└── scripts/
    ├── ensip25-bind.ts # Mint ERC-8004 + set ENSIP-25 record
    └── 0g-pin.ts       # Dual-pin manifest to 0G Storage
```

**Tech stack:**
- TypeScript end-to-end · pnpm monorepo
- viem 2.x — ENS resolution via Universal Resolver
- helia + @helia/verified-fetch — content-addressed verify
- @web3-storage/w3up-client (Storacha) + 0G Storage SDK
- @modelcontextprotocol/sdk — MCP server
- @x402/hono — x402 payment middleware
- KeeperHub MCP — onchain execution
- Cloudflare Workers + Durable Objects — Sessions API
- Next.js 14 + shadcn/ui — web

---

## Demo flow

A clean 4-minute walkthrough designed to prove **every layer** of the stack is real and verifiable.

### Scene 1 — Hook (0:00–0:25)
Title card → terminal showing 30+ MCP adapter folders.
> *"Every AI-on-Ethereum project rewrites the same thing. We end that tax. Watch."*

### Scene 2 — Empty Claude (0:25–0:45)
Claude Desktop with our Bridge as the only MCP server. "What tools do you have for trading?" → none.
> *"Claude has zero protocol-specific tools. Now I'll point Claude at an ENS name."*

### Scene 3 — Resolution magic (0:45–1:30) · ENS prize moment
Type **"Use trading.agenthub.eth"** in Claude. Split window: Claude on left, live Sessions timeline on right.

Timeline events stream in:
```
● session.start         trading.agenthub.eth
○ ens.lookup            agent.manifest → ipfs://bafy...
○ ens.lookup            agent.dependencies → price.eth, risk.eth, news.eth
○ ipfs.fetch            CID hash verified ✓
○ dependency.resolve    price.agenthub.eth ✓
○ dependency.resolve    risk.agenthub.eth ✓
○ dependency.resolve    news.agenthub.eth ✓
○ ensip25.check         agent-registration[8004][42] = "1" ✓
● tools.registered      trading_execute, price_quote, risk_score, news_summary
```

Claude reply: *"Loaded 4 tools from trading.agenthub.eth (verified ✓), with 3 dependencies."*
> *"ENS resolution. IPFS verify. Three dependencies walked recursively. ENSIP-25 binding to ERC-8004. Four tools registered. No code changed."*

### Scene 4 — Public verification (1:30–2:10) · ENS Most Creative
Two browser tabs:
- **ENS app**: `trading.agenthub.eth` — text records visible (manifest CID, dependencies CSV, ENSIP-25 binding)
- **Etherscan**: ERC-8004 IdentityRegistry NFT for agentId 42, owned by the same address that controls `trading.agenthub.eth`

> *"Bidirectional verified. The green checkmark in Claude reads exactly these two onchain truths."*

### Scene 5 — Free tool (2:10–2:35)
Claude calls `trading_price_quote` → returns ETH price from `price.agenthub.eth`.
> *"First tool resolves through a dependency. Free, local, read-only."*

### Scene 6 — Paid execution (2:35–3:30) · KeeperHub prize moment
Type **"Execute a 10 USDC swap on Base Sepolia"**. Sessions timeline streams:
```
○ tool.call.start       trading_execute_trade
○ x402.challenge        $0.05 USDC required on base-sepolia
○ x402.payment          signing EIP-3009 transferWithAuthorization
○ x402.payment          tx 0xabc... settled ✓
○ keeperhub.call        execute_contract_call → swap
○ keeperhub.result      tx 0xdef... → BaseScan ↗
● tool.call.end         847ms · ok
```

Click the BaseScan link inline → tx confirmed.
> *"x402 challenge. EIP-3009 USDC payment. KeeperHub executes the contract call. Tx lands on Base Sepolia. Agent never asked permission. All standards composing."*

### Scene 7 — Portability (3:30–3:55) · 0G framework angle
Different terminal: `clawhub install agent-name-registry/trading-agent` → same tools available in OpenClaw.
> *"Same manifest, different MCP client. The bundle is portable. Zero adapter code per protocol per framework. This is what 'framework other builders will use' looks like."*

### Scene 8 — Closing (3:55–4:00)
Architecture diagram with sponsor logos lighting up: ENS → IPFS/Storacha → 0G → ERC-8004 → KeeperHub → x402 → Base.

End card:
- Repo: github.com/hien-p/agent-name-registry
- Live demo: agentname.eth
- Live session: agentname.eth/sessions/abc123
- ENSIP draft: discuss.ens.domains/...

> *"ENS for identity. IPFS and 0G for storage. ERC-8004 for trust. KeeperHub for execution. x402 for payments. Agent Name Registry."*

---

## Why this wins each track

### ENS — Best AI Agent Integration ($2,500)

| Hard requirement | How we satisfy it |
|---|---|
| ENS does real work, not cosmetic | Identity + metadata + discovery + verification + dependency resolution |
| No hard-coded values | Bridge does runtime ENS resolution; demo log proves it |
| Functional demo with video | Live Sessions URL + 4-min recorded demo |

### ENS — Most Creative Use ($2,500)

Three creative angles in one project:
1. **Subnames as access tokens** — `premium.market.agenthub.eth` gated by NFT/allowlist
2. **ENS as agent dependency graph** — text records walked recursively, ENS becomes package.json for agents
3. **ENSIP-25 verified identity badge** — bidirectional binding to ERC-8004

Plus an open invitation to formalize: we'll submit a draft ENSIP for the `agent.manifest` text-record convention during the hackathon.

### KeeperHub — Best Use ($4,500 + $250 feedback)

- KeeperHub MCP wired as our execution backend for `execute_contract_call`
- x402 payments on Base Sepolia — agents auto-pay $0.05 USDC per call via EIP-3009
- OpenClaw skill packaging (`clawhub install agent-name-registry`) — explicit framework integration named in the prize copy
- FEEDBACK.md filled with specific, actionable items

### 0G — Best Agent Framework, Tooling & Core Extensions ($7,500 pool)

- Manifest spec is the framework — other agent teams adopt it
- 0G Storage as primary persistence layer (with IPFS dual-pin)
- Reference implementation (trading agent + 3 dependency leaves) shows how a builder actually uses it
- Architecture diagram shows OpenClaw + 0G Storage integration explicitly

**Total addressable: ~$10,250.**

---

## What makes this different from prior art

| Prior art | What it does | How we differ |
|---|---|---|
| **ENSIP-25** | Verifies an agent owns its ENS name (1 bit of attestation) | We use ENSIP-25 as a sub-component; we *also* resolve the name into a working tool set + dependency graph |
| **Anthropic MCP Registry** | DNS/GitHub-anchored MCP server metadata | Complementary — we're ENS-anchored with content-addressed bundles and wallet-native ownership |
| **DNS-AID** (PyPI) | Traditional DNS SVCB records for agent discovery | No wallet ownership, no NFT transferability, no x402 composability |
| **JustaName ENS-MCP** | MCP server that lets agents query ENS | Inverse direction — ENS-as-tool, not ENS-as-registry |
| **Olas / Autonolas** | Agents-as-NFTs with skills (proprietary AEA framework) | Heavyweight, OLAS-token-gated, not MCP-compatible |
| **Namespace.ninja** | ENS subname issuance for agents | Subnames-as-identity only — we add capabilities, dependencies, and execution |

After comprehensive search, **no shipped project today resolves an ENS name into a verified, dependency-aware MCP skill manifest**. The slot is empty. ENS Labs publicly stated (Jan 2026) they will not build a registry themselves — the application layer is for builders. We're claiming it.

---

## ENS authority gate (a free property of the protocol)

`setText(namehash("trading.agenthub.eth"), "agent.manifest", cid)` reverts unless `msg.sender` is the ENS manager (Registry owner, NameWrapper holder, or approved delegate). **Only the ENS name owner can publish under that name** — no extra access control needed. Transfer the ENS name, you transfer the manifest publishing authority. Sell the name on OpenSea, you sell the agent stewardship.

This is identical in spirit to Sui's MVR (Move Registry) — package names gated by SuiNS NFT ownership — except ENS has 3.5M existing names and a vastly larger composability surface (x402 payments, ENSIP-19 multichain, ENSIP-25 trust, eth.limo gateways, MetaMask name rendering).

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| ENS gas costs for fleet subname issuance | Use Durin on Base for L2-native ERC-721 subnames at pennies per mint, with full L1 ENS resolution via CCIP-Read |
| Bundle integrity vs ENS mutability | CID is self-verifying via helia; for hackathon, demo one immutable subname `v1.trading.agenthub.eth` with NameWrapper fuses burned |
| MCP client compatibility | Bridge is transport-agnostic stdio MCP — works for Claude Desktop, OpenClaw, Cursor, MCP Inspector |
| Anti-spam (anyone registers junk names) | Open namespace by design; quality is downstream — ERC-8004 reputation, our own meta-curation at `agenthub.eth` |
| Sessions API uptime | Bridge is fire-and-forget on telemetry; functional even if API is down |
| User privacy on public sessions | Auto-redact `private_key`, `secret`, `password`, `signature` regex; sessions auto-expire 24h; `--no-telemetry` flag in Bridge |

---

## Prize alignment table

| Sponsor | Track | $ | Where in repo |
|---|---|---|---|
| **ENS** | Best AI Agent Integration | $2,500 | `packages/bridge/`, `packages/sdk/`, demo Scene 3 |
| **ENS** | Most Creative Use | $2,500 | Dependency graph, subname access tokens, ENSIP-25 binding, draft ENSIP |
| **KeeperHub** | Best Use (Innovative + Integration) | $4,500 | `apps/keeperhub-paid/`, OpenClaw packaging, x402 middleware, demo Scene 6 |
| **KeeperHub** | Builder Feedback Bounty | $250 | `FEEDBACK.md` |
| **0G** | Agent Framework, Tooling & Core Extensions | $2,500 (rank target) | `scripts/0g-pin.ts`, `apps/sessions-api/`, framework framing in `ARCHITECTURE.md` |

---

## Roadmap (post-hackathon)

- [x] ENS text record convention v1 (`agent.manifest`, `agent.mcp`, `agent.dependencies`, …)
- [x] Manifest JSON Schema v1
- [x] MCP Bridge with dynamic tool registration
- [x] KeeperHub execution backend + x402 payments
- [x] ENSIP-25 + ERC-8004 verification
- [x] Live Sessions API with shareable timeline URLs
- [ ] Submit draft ENSIP for `agent.*` text-record namespace
- [ ] Subname-per-version locking (NameWrapper fuses)
- [ ] Wildcard resolver for agent fleets (ENSIP-10 + Durin on Base)
- [ ] Subname access tokens (NFT/allowlist gating)
- [ ] Public indexer/explorer at agentname.eth.limo
- [ ] Reputation aggregation from ERC-8004 Reputation Registry feedback events

---

## Team

**Team of 3** working in parallel across Bridge / Execution / Identity-Storage tracks. Trunk-based, daily EOD tags, 4-hour PR review SLA. See `BUILD_PLAN.md` for role assignments and the 14-day execution plan.

---

## TL;DR

**Agent Name Registry turns ENS into the discovery, identity, and dependency layer for AI agents.**

Resolve `trading.agenthub.eth` → get a verified manifest from IPFS → walk its dependency graph → load MCP tools dynamically → execute paid onchain actions through KeeperHub + x402 → see the entire timeline live at agentname.eth/sessions/abc123.

ENS does real work in every step. The demo proves it. The prize stack reflects it.
