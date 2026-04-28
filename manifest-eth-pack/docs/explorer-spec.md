# Explorer spec — D10 deliverable (Dev C)

> Read-only web view that resolves an ENS name and renders the skill bundle. This is the **public credibility surface** for the demo: judges paste a name, see the bundle, click through to verify on-chain. No write actions, no auth, no session tracking.

## Goal in one sentence

Paste `research.agent.eth` → see all the same things the bridge sees (CID, version, tools, ENSIP-25 binding) → click through to ENS app, Etherscan, and the IPFS gateway to verify each piece independently.

## Non-goals (don't build these)

- Publishing UI (the CLI handles publish; UI duplication would mean another wallet flow to maintain)
- User accounts, comments, social
- Analytics or usage dashboard
- Live log streaming from a running bridge — legitimate v2 product feature, but it pulls bridge from stdio-only into stdio + outbound websocket, which is not in scope
- Marketplace / search-across-bundles (one bundle at a time is enough for v0)

## Routes

| Path | Purpose |
|---|---|
| `/` | Home: hero copy + search box |
| `/explorer/[ensName]` | Direct-link result page (e.g. `/explorer/research.agent.eth`) |
| `/spec` | Renders the JSON Schema (read-only) for protocol authors who want to validate offline |

The deep link at `/explorer/[ensName]` is the load-bearing one — it's what makes the URL bar itself a proof artifact (`manifest.eth.limo/explorer/research.agent.eth`) and makes results shareable in submission text.

## Layout

Single column, `max-width: 800px`, top-to-bottom. ASCII for orientation only — designer decides the typography.

```
┌─────────────────────────────────────────┐
│ manifest.eth                            │  ← header: logo + 1-line tagline
│ ENS-native skill registry for AI agents │
├─────────────────────────────────────────┤
│ [ research.agent.eth ]   [ Resolve ]    │  ← search input + button
│ Try: research.agent.eth · deepbook.eth  │  ← clickable example chips
├─────────────────────────────────────────┤
│  RESULT CARD                            │  ← appears after resolve
└─────────────────────────────────────────┘
```

### Result card

```
┌─────────────────────────────────────────┐
│ research.agent.eth     [ ✓ verified ]   │  ← hero strip: name + badge
│ v1.0.0 · MIT · 2026-04-28               │
│ [ Open in Claude ]  [ Copy MCP config ] │
├─────────────────────────────────────────┤
│ DESCRIPTION                             │
│ MCP-compatible research and contract... │
├─────────────────────────────────────────┤
│ TOOLS (3)                               │
│ ┌─────────────────────────────────────┐ │
│ │ contract_scan          [ local ]    │ │
│ │ Analyze a smart contract...         │ │
│ ├─────────────────────────────────────┤ │
│ │ market_research        [ http ]     │ │
│ │ Pull token-level market summaries   │ │
│ ├─────────────────────────────────────┤ │
│ │ execute_contract_call               │ │
│ │ [ keeperhub ] [ $0.05 USDC · x402 ] │ │
│ │ Execute a safe smart contract...    │ │
│ └─────────────────────────────────────┘ │
├─────────────────────────────────────────┤
│ TRUST                                   │
│ ENSIP-25: agent-registration[…][42]     │
│ ERC-8004: registry 0x8004…A432, id 42   │
│ [↗ Verify on Etherscan]                 │
├─────────────────────────────────────────┤
│ RAW                                     │
│ CID  bafybei…       [copy] [↗ gateway]  │
│ ENS text records (3)         [expand ▾] │
└─────────────────────────────────────────┘
```

## Verified badge spec

Three states. Same component, three variants — pick visual treatment for each:

| State | Trigger | Treatment |
|---|---|---|
| `verified` | `bundle.trust.erc8004` is set **and** `agent-registration[<erc7930>][<agentId>]` text record returns `"1"` | Green pill, ✓ icon, label "verified" |
| `unverified` | Bundle resolved successfully but no `trust` block, or binding text record absent (returns `null`/`""`) | Gray pill, • icon, label "unverified" |
| `mismatch` | `trust.erc8004` declares an ID but the binding text record is present **and** returns `"0"` | Red pill, ⚠ icon, label "binding mismatch" — this is a *warning* state, not silent absence |

Hover tooltip lists exactly what was checked (the ERC-7930-encoded key, the agent ID, the value returned). Click scrolls to the TRUST section and highlights it for 2s.

The mismatch state is important — it's the case where someone published a bundle claiming an identity they don't own. Showing a red badge instead of falling silent is the demo's strongest "this is real verification" signal.

## States

| State | UI |
|---|---|
| Initial | Search input focused, examples visible below |
| Resolving | Input disabled; status line steps through: "Reading ENS text records on Mainnet…" → "Fetching CID from IPFS…" → "Verifying ENSIP-25…" |
| Success | Result card |
| Error: ENS name doesn't resolve | "`research.agent.eth` doesn't resolve to an address. Is it a valid ENS name?" + link to ENS app for that name |
| Error: text record missing | "`research.agent.eth` exists but has no `xyz.manifest.skill` text record. The owner hasn't published yet." + link to publishing docs |
| Error: IPFS gateway failure | "Found CID `bafy…` but couldn't fetch from any gateway. Try again — gateways can be cold." + retry button |
| Error: schema validation | "Bundle exists but failed schema validation: `<ajv error path>`. The publisher's bundle is malformed." + show partial JSON |

**Critical:** every error must include the *partial* data that resolved successfully. If we got the CID but failed to fetch, show the CID. Judges should always be able to see "we got this far" — masking partial success is what makes a UI feel staged.

## Copy-paste affordances

Every onchain or IPFS identifier is one-click copyable:

- CID (full string)
- ENS name
- Each text record value (raw)
- Tool MCP names: the exact `<bundle.name>__<tool.name>` string Claude Desktop will use
- A pre-filled `claude_desktop_config.json` snippet (just the `mcpServers.manifest-eth` block from the README — paste-ready)

## "Open in Claude" CTA

Single button. On click: copy the Claude Desktop config snippet to clipboard, show toast:

> Config copied. Paste into `~/Library/Application Support/Claude/claude_desktop_config.json`, restart Claude, then say `Use research.agent.eth` to load tools.

This is the conversion event — from "I see the bundle in a webpage" to "I can use the bundle in my own Claude." Don't add anything fancier (e.g. custom URL schemes); the friction-free copy-paste is the point.

## Tech stack

| | Choice | Reason |
|---|---|---|
| Framework | Next.js 15 App Router | Already on BUILD_PLAN; matches monorepo TS |
| Resolution | `@manifest-eth/sdk` `resolveSkill()` in a **client component** | eth.limo deployment requires static export — server-side RPC won't survive. Use a public Alchemy/Infura RPC from the browser. |
| Styling | Tailwind | No shadcn for v0 — too much setup; reach for it only if a date picker / combobox is actually needed (it isn't here) |
| Deploy | Vercel as primary; static export → IPFS pin → ENS `contenthash` for `manifest.eth.limo` mirror | eth.limo gives a free public surface at `manifest.eth.limo` — that's the demo URL |

The fact that the same SDK runs in the browser is itself a small proof point: it shows the resolution pipeline isn't backend-locked.

## Phasing — what ships when

| Day | Deliverable |
|---|---|
| D5 | "Hello manifest.eth" — header + search input deployed on Vercel; button does nothing yet. Establishes the route shape and that deploys work. |
| D7 | Resolution wired: paste a name → display result card with raw JSON dump (ugly is fine; correctness over polish) |
| D10 | Final polish: tools list with execution pills, trust section with verified badge, deep links to ENS app + Etherscan + gateway, Open-in-Claude CTA |
| D11 | eth.limo deployment: static export → IPFS pin → set ENS `contenthash` on `manifest.eth` |

Don't try to ship D10 polish before resolution works end-to-end. Ugly-but-correct beats pretty-but-broken.

## Demo integration (optional scene 4 swap)

Currently `demo-script.md` scene 4 shows ENS app + Etherscan tabs. If the explorer is solid by D10 EOD, swap one tab for `manifest.eth.limo/explorer/research.agent.eth` — same content, branded, makes the URL bar itself part of the proof.

If the explorer has any rendering bug at the D11 cold-test rehearsal, **fall back to ENS app + Etherscan only and don't show the explorer in the recorded demo**. It can still be in submission screenshots. A buggy explorer in the live demo is worse than no explorer.
