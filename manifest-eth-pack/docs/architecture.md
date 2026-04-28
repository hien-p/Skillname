# Architecture

## End-to-end flow

```
User                Claude Desktop          Bridge (MCP)         viem + ENS         IPFS / 0G          KeeperHub        Base Sepolia
  │                       │                      │                    │                   │                  │                  │
  │  "Use research        │                      │                    │                   │                  │                  │
  │   .agent.eth"         │                      │                    │                   │                  │                  │
  ├──────────────────────►│                      │                    │                   │                  │                  │
  │                       │ tool: manifest_load  │                    │                   │                  │                  │
  │                       ├─────────────────────►│                    │                   │                  │                  │
  │                       │                      │ getEnsText(...)    │                   │                  │                  │
  │                       │                      ├───────────────────►│                   │                  │                  │
  │                       │                      │ ipfs://bafy...     │                   │                  │                  │
  │                       │                      │◄───────────────────┤                   │                  │                  │
  │                       │                      │ fetch + verify CID │                   │                  │                  │
  │                       │                      ├──────────────────────────────────────►│                  │                  │
  │                       │                      │ bundle.json        │                   │                  │                  │
  │                       │                      │◄──────────────────────────────────────┤                  │                  │
  │                       │                      │ verifyEnsip25(...) │                   │                  │                  │
  │                       │                      ├───────────────────►│                   │                  │                  │
  │                       │                      │ "1" (verified)     │                   │                  │                  │
  │                       │                      │◄───────────────────┤                   │                  │                  │
  │                       │ 4 tools registered   │                    │                   │                  │                  │
  │                       │◄─────────────────────┤                    │                   │                  │                  │
  │  Tools visible        │                      │                    │                   │                  │                  │
  │◄──────────────────────┤                      │                    │                   │                  │                  │
  │                       │                      │                    │                   │                  │                  │
  │  "execute_contract_   │                      │                    │                   │                  │                  │
  │   call to swap..."    │                      │                    │                   │                  │                  │
  ├──────────────────────►│                      │                    │                   │                  │                  │
  │                       │ tool: research_      │                    │                   │                  │                  │
  │                       │ agent__execute_..    │                    │                   │                  │                  │
  │                       ├─────────────────────►│                    │                   │                  │                  │
  │                       │                      │ POST /execute_call │                   │                  │                  │
  │                       │                      ├──────────────────────────────────────────────────────────►│                  │
  │                       │                      │ HTTP 402 Payment   │                   │                  │                  │
  │                       │                      │◄──────────────────────────────────────────────────────────┤                  │
  │                       │                      │ sign EIP-3009 USDC │                   │                  │                  │
  │                       │                      │ $0.05 USDC payment │                   │                  │                  │
  │                       │                      ├──────────────────────────────────────────────────────────►│                  │
  │                       │                      │                    │                   │ submit tx        │                  │
  │                       │                      │                    │                   │                  ├─────────────────►│
  │                       │                      │                    │                   │ tx hash          │                  │
  │                       │                      │                    │                   │                  │◄─────────────────┤
  │                       │                      │ tx receipt + cid   │                   │                  │                  │
  │                       │                      │◄──────────────────────────────────────────────────────────┤                  │
  │                       │ result               │                    │                   │                  │                  │
  │                       │◄─────────────────────┤                    │                   │                  │                  │
  │  Result rendered      │                      │                    │                   │                  │                  │
  │◄──────────────────────┤                      │                    │                   │                  │                  │
```

## Component responsibilities

| Component | Responsibility | Owner |
|---|---|---|
| ENS resolver (viem) | Read text records via Universal Resolver; supports CCIP-Read + ENSIP-10 wildcards | Jason |
| IPFS fetcher | Fetch bundle CID, verify content hash with helia | Jason |
| Schema validator (ajv) | Reject malformed bundles before tool registration | Dev C |
| MCP Bridge | Stdio MCP server; dynamically registers bundle tools as namespaced MCP tools (`bundle__tool`); routes calls to execution backends | Jason |
| Execution router | Route tool calls based on `execution.type`: local handler, KeeperHub MCP, HTTP+x402 | Jason + Dev B |
| KeeperHub adapter | Wrap KeeperHub MCP `execute_contract_call`; manage chain selection + workflow IDs | Dev B |
| x402 middleware | `@x402/hono` wrapper around KeeperHub re-export; CDP facilitator for settlement | Dev B |
| Storage adapters | Storacha (primary), 0G (dual-pin), Pinata (fallback) | Dev C |
| ENSIP-25 verifier | Read `agent-registration[<reg>][<id>]`; cross-check ERC-8004 IdentityRegistry | Dev C |
| ERC-8004 minter | Mint Identity NFT on Base; set agentURI to IPFS JSON | Dev C |
| Web explorer | Next.js landing + ENS lookup form + bundle pretty-print + verified badge | Dev C |

## Data flow: where each text record matters

| Text record | Set by | Read by | Purpose |
|---|---|---|---|
| `xyz.manifest.skill` | publisher (CLI) | Bridge (D5+) | Pointer to bundle CID |
| `xyz.manifest.skill.version` | publisher (CLI) | Bridge cache (D7) | Cache invalidation |
| `xyz.manifest.skill.schema` | publisher (CLI) | Validator (D7) | Schema URI for forward-compat |
| `xyz.manifest.skill.execution` | publisher (CLI) | Bridge (D8) | Hint about execution backend |
| `xyz.manifest.skill.0g` | publisher (CLI) | Bridge fallback (D11) | 0G blob ID for redundancy |
| `agent-registration[…][…]` | Dev C script (D10) | Bridge ENSIP-25 (D10) | ENSIP-25 binding |

## Why ENS instead of a JSON registry

| Property | JSON registry | ENS |
|---|---|---|
| Human-readable name | Optional, must be enforced | Native, immutable from publish time |
| Ownership semantics | Custom auth layer needed | NFT — transferable, escrowable |
| Publishing authority | Custom signer / role | Free property of `setText` access control |
| Distribution | Custom UI | MetaMask, Rainbow, Etherscan render natively |
| Ecosystem composability | None | ENSIP-25, ENSIP-19, x402, ERC-8004, etc. |
| Subname economics | Custom | Mature: NameWrapper, CCIP-Read, Durin |
| Multichain resolution | Custom | ENSIP-19 native |

The JSON-registry approach is what the Anthropic MCP Registry chose. We complement it; we don't compete.
