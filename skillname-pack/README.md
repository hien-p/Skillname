# skillname

> ENS-native skill registry for AI agents. Resolve any ENS name into a verified, content-addressed MCP skill bundle and dynamically load tools — no custom adapters per protocol.

[![CI](https://github.com/hien-p/Skillname/actions/workflows/ci.yml/badge.svg)](https://github.com/hien-p/Skillname/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## What is this

Today, every AI agent framework rewrites adapter glue per protocol. One MCP adapter for Uniswap, another for Aave, another for ENS itself. **N protocols × M agent frameworks = adapter explosion.** Every agent team pays this tax.

skillname flips it. The protocol publishes a skill bundle once at `protocol.eth`. Every MCP client — Claude Desktop, OpenClaw, Cursor, custom — resolves the name and gets working tools. Adapter explosion collapses to N + M instead of N × M.

```
research.agent.eth
  → ENS text record: xyz.manifest.skill = ipfs://bafy...
  → skill bundle: tools, prompts, examples, execution config
  → MCP client loads tools dynamically
```

## How it works

```
┌─────────────────────────────────────────────────────────────┐
│  AI CLIENT  (Claude Desktop / OpenClaw / Cursor)            │
│  + skillname MCP Bridge                                  │
└─────────────────────────────────────────────────────────────┘
                       │
                       │ ① resolve("research.agent.eth")
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  ENS Universal Resolver (mainnet) via viem                   │
│   • text(node, "xyz.manifest.skill") → ipfs://bafy...        │
│   • text(node, "xyz.manifest.skill.version") → "1.0.0"      │
│   • text(node, "agent-registration[…][…]") → "1" (ENSIP-25)  │
└─────────────────────────────────────────────────────────────┘
                       │
                       │ ② fetch CID + verify (helia)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  IPFS / 0G Storage  (Storacha primary, 0G dual-pin)          │
│  Bundle:                                                     │
│    manifest.json   — name, version, description, tools[]    │
│    tools/*.json    — MCP tool defs: name, desc, schema       │
│    prompts/*.md    — few-shot prompts                        │
│    examples/*.ts   — worked examples                         │
│    errors.md       — known errors + fixes                    │
└─────────────────────────────────────────────────────────────┘
                       │
                       │ ③ register MCP tools dynamically
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  MCP runtime — tools now visible to LLM                      │
│  Tool calls that need onchain action route to:               │
│   • KeeperHub MCP (execute_transfer, execute_contract_call)  │
│   • Pay per call via x402 (USDC on Base)                     │
└─────────────────────────────────────────────────────────────┘
```

## Quickstart (for protocols / agent authors)

```bash
# 1. Install
pnpm add -g @skillname/cli

# 2. Init a bundle
manifest init my-skill
cd my-skill

# 3. Edit manifest.json + tools/

# 4. Publish under your ENS name
manifest publish ./ research.agent.eth

# Output:
#   Uploaded bundle to IPFS
#   CID: ipfs://bafy...
#   Set ENS text record: xyz.manifest.skill = ipfs://bafy...
#   Set ENS text record: xyz.manifest.skill.version = 1.0.0
```

## Quickstart (for AI client users)

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "skillname": {
      "command": "npx",
      "args": ["-y", "@skillname/bridge"]
    }
  }
}
```

Restart Claude. Then in chat:

```
You: Use research.agent.eth
Claude: Loaded 4 tools from research.agent.eth (verified ✓)
        - contract_scan
        - market_research
        - execute_contract_call (paid: $0.05 USDC)
        - portfolio_summary
```

## Why ENS

1. **Brand and mindshare** — `protocol.eth` is already where users go. Adding skill resolution is zero cognitive overhead.
2. **Ownership semantics** — ENS names are NFTs. Transfer the name, you transfer skill-publish authority. **No new contract solves this; ENS already did.**
3. **Resolver flexibility** — ENSIP-10 wildcards, EIP-3668 CCIP-Read, ENSIP-19 multichain. Whatever resolution pattern you need, ENS has a primitive.
4. **Composability** — ENSIP-25 binds names to ERC-8004 trust. x402 routes payments to ENS-resolved endpoints. Eth.limo gives you a free public profile page.
5. **Distribution** — MetaMask, Rainbow, Coinbase Wallet, Etherscan already render ENS names. AI clients are the next adopter.

## ENS text record convention

| Key | Value | Required |
|---|---|---|
| `xyz.manifest.skill` | `ipfs://bafy...` (CID of bundle) | ✅ |
| `xyz.manifest.skill.version` | `"1.0.0"` (semver) | ✅ |
| `xyz.manifest.skill.schema` | `https://manifest.eth/schemas/skill-v1.json` | ✅ |
| `xyz.manifest.skill.execution` | `"keeperhub"` \| `"local"` \| `"axl"` | optional |
| `xyz.manifest.skill.0g` | 0G blob ID (dual-pin) | optional |
| `agent-registration[<reg>][<id>]` | `"1"` (ENSIP-25 binding) | optional |

## Verified agent identity

When `xyz.manifest.skill` resolves, the bridge can also verify the agent identity via [ENSIP-25](https://docs.ens.domains/ensip/25):

1. Read `agent-registration[<ERC-7930 reg>][<agentId>]` text record
2. If `"1"`, look up the agent in the [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) Identity Registry
3. Confirm bidirectional link (agent claims this ENS name + ENS name confirms this agent)
4. Mark as ✓ verified

This composes for free with ENS's existing primitives — no new contracts.

## Sponsor integrations

| Sponsor | What we use |
|---|---|
| **ENS** | Identity layer, text records as capability registry, ENSIP-25 verification |
| **KeeperHub** | `execute_contract_call`, OpenClaw skill packaging, x402 payments |
| **0G** | Skill bundle storage (dual-pinned with IPFS), framework-tier integration |
| ERC-8004 | Agent identity NFT mint, registration file with MCP/ENS endpoints |
| x402 | Pay-per-tool-call USDC settlement via CDP facilitator |
| Filecoin Pin | Same architectural pattern; honored as inspiration |

## Repository layout

```
skillname/
├── packages/
│   ├── schema/           # JSON Schema v1 + validator
│   ├── sdk/              # TS SDK: resolveSkill(), verifyEnsip25()
│   ├── bridge/           # MCP stdio server (the magic)
│   └── cli/              # `manifest publish | resolve | verify`
├── apps/
│   └── web/              # skillname landing + explorer
├── examples/
│   └── research-agent/   # Reference skill bundle
├── scripts/
│   ├── ensip25-bind.ts   # Mint ERC-8004 + set text record
│   └── 0g-pin.ts         # Dual-pin to 0G Storage
└── docs/                 # Architecture, demo script, judging notes
```

## Development

```bash
pnpm install
cp .env.example .env  # fill in credentials
pnpm build
pnpm test
pnpm dev:bridge       # run MCP bridge locally
```

## Roadmap

- [x] ENS text record convention v1
- [x] Skill bundle JSON Schema v1
- [x] MCP Bridge (Claude Desktop + OpenClaw)
- [x] KeeperHub execution adapter
- [x] x402 payments
- [x] ENSIP-25 + ERC-8004 verification
- [ ] Submit ENSIP draft for `xyz.manifest.skill.*` keys
- [ ] Subname-per-version locking (NameWrapper fuses)
- [ ] Wildcard resolver for fleets (ENSIP-10)
- [ ] Indexer/explorer at https://skillname.eth.limo

## License

MIT

## Credits

Architecture inspired by [Move Registry (MVR)](https://blog.sui.io/announcing-move-registry-interoperability/) on Sui.
