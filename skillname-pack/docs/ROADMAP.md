# Roadmap

> Detailed build checklist with hierarchical sub-issues. Aligned with [`BUILD_PLAN.md`](../BUILD_PLAN.md). Each top-level issue has a goal statement, acceptance criteria as sub-tasks, and a priority tag.
>
> **Pivot framing:** the unit is **one ENS name = one atomic skill (function)**. An agent is a list of imports. This roadmap reflects that.

## How to read this

- `[x]` = shipped (linked to commit, file, or PR where possible)
- `[ ]` = open work
- **MUST** = ships before demo, or no demo
- **HIGH** = depth layer that wins ENS Most Creative + 0G Framework tracks
- **NICE** = stretch goals after Tier 1+2 are green
- **SKIP** = explicitly out of scope for the May 5 freeze

---

## Tier 1 — Cover

### #1 Atomic ENS skill resolution · MUST

**Goal:** `import quote.uniswap.eth` returns one fully-typed function manifest.

- [x] Schema v1 with bundle root + tool definition — [`packages/schema/skill-v1.schema.json`](../packages/schema/skill-v1.schema.json)
- [x] SDK `resolveSkill()` — [`packages/sdk/src/index.ts`](../packages/sdk/src/index.ts)
- [x] SDK defaults to Sepolia + pinned Universal Resolver `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe`
- [x] `ENS_SEPOLIA` constants for all 9 deployed contracts
- [ ] **Reference skills** — atomic, one tool each
  - [ ] `quote.uniswap.eth` → `get_quote(tokenIn, tokenOut, chain)` (free, http to CoinGecko or read-only)
  - [ ] `swap.uniswap.eth` → `execute_swap(...)` with x402 + KeeperHub
  - [ ] `score.gitcoin.eth` → `trust_score(address)` (free, http)
  - [ ] `weather.tomorrow.eth` (free local example) → `forecast(lat, lng)` — proves "any function" works
- [ ] **Sepolia ENS names registered + text records set**
  - [ ] Register the four names via [sepolia.app.ens.domains](https://sepolia.app.ens.domains)
  - [ ] Set `xyz.manifest.skill = ipfs://<cid>` on each
  - [ ] Set `xyz.manifest.skill.version = 1.0.0`
  - [ ] Set `xyz.manifest.skill.schema = https://manifest.eth/schemas/skill-v1.json`
- [ ] **Schema validator wired into SDK** (currently commented out at [`sdk/src/index.ts:143`](../packages/sdk/src/index.ts))
  - [ ] `pnpm --filter @skillname/schema build` produces `validate()` export
  - [ ] SDK imports + runs validator before returning
  - [ ] Reject malformed bundles with specific ajv error path
- [ ] **CID hash verification** via `@helia/verified-fetch`
  - [ ] Replace plain gateway fetch in `fetchAndVerify()`
  - [ ] Verify content hash matches CID before returning bundle

### #2 Bridge imports skill into Claude · MUST

**Goal:** Saying "Use `quote.uniswap.eth`" in Claude Desktop registers exactly one tool, named `quote_uniswap__get_quote`.

- [x] Stdio MCP transport — [`bridge/server.ts`](../packages/bridge/src/server.ts)
- [x] `manifest_load` + `manifest_list_loaded` built-in tools
- [x] Dynamic tool registration with `<bundle>__<tool>` namespacing
- [x] Working `http` executor
- [x] In-memory bundle cache, 5-min TTL
- [ ] **Live test in Claude Desktop** ← **D5 kill-criterion per BUILD_PLAN**
  - [ ] Configure `claude_desktop_config.json` with `@skillname/bridge`
  - [ ] Restart Claude Desktop
  - [ ] Type `Use quote.uniswap.eth` → verify tool surfaces in tool picker
  - [ ] Call the tool → verify result renders
  - [ ] Record screen capture for D7 rehearsal
- [ ] Update bridge surface text from "load manifest" → "import skill" wording (cosmetic, matches new pitch)
- [ ] Bridge log format with structured prefixes (`→ ← ✓`) for demo readability

### #3 Dependency graph · MUST

**Goal:** `my-trader.eth` declares `imports: [quote, swap, score]` → bridge auto-resolves transitive deps.

- [ ] **Add `skill.imports` text record key**
  - [ ] SDK constant `SKILL_IMPORTS_KEY = 'xyz.manifest.skill.imports'`
  - [ ] Schema: bundle.imports[] field with semver matchers
  - [ ] Reference manifest example with imports list
- [ ] **SDK `walkImports(ensName, depth=3)`**
  - [ ] Recursive resolver, breadth-first
  - [ ] Cycle detection (max depth 5, refuse cycles)
  - [ ] Returns flat dependency tree with parent-child links
- [ ] **Lockfile generator**
  - [ ] Walk tree → produce `{name, version, cid}[]` flat list
  - [ ] Pin to IPFS, return CID
  - [ ] Optionally write CID to `xyz.manifest.skill.lockfile` text record
- [ ] **Bridge integration**
  - [ ] On `manifest_load`, walk imports
  - [ ] Register transitive tools in MCP
  - [ ] Surface dependency tree in `manifest_list_loaded` output
- [ ] **Reference**: `my-trader.eth` imports `quote+swap+score`, demo Scene 3

### #4 Paid execution: KeeperHub + x402 · MUST

**Goal:** Claude calls `swap.uniswap.eth` → wallet auto-pays $0.05 USDC via EIP-3009 → KeeperHub executes → tx lands on Base Sepolia.

- [x] Schema: payment block (`x402` | `mpp`) with price + token + network
- [x] Bridge: `executeKeeperHub` stub with payment branch
- [ ] **CDP (Coinbase Developer Platform) integration**
  - [ ] CDP API key + private key obtained
  - [ ] x402 facilitator endpoint configured
  - [ ] Test settlement on Base Sepolia
- [ ] **`@x402/hono` middleware** wrapped around KeeperHub re-export
  - [ ] HTTP server: `apps/keeperhub-paid/`
  - [ ] Returns 402 challenge with payment requirements
  - [ ] Validates `X-PAYMENT` header on retry
- [ ] **Bridge x402 client flow**
  - [ ] Detect 402 challenge response
  - [ ] EIP-3009 `transferWithAuthorization` signing with agent wallet
  - [ ] Retry with `X-PAYMENT` header
  - [ ] Surface tx hash in result
- [ ] **Pre-fund agent wallet on Base Sepolia**
  - [ ] 5 USDC + 0.1 ETH from CDP/Alchemy faucets
  - [ ] Verify balance before D11 cold-test
- [ ] **BaseScan tx confirmation in demo flow**
  - [ ] Result format includes BaseScan link
  - [ ] Demo Scene 6 shows the link click → confirmed tx

---

## Tier 2 — Engine

### #5 Skill Explorer (web UI) · HIGH

**Goal:** Web app at `skillname.eth.limo` like crates.io / npmjs.com.

- [x] System dashboard placeholder at [skillname.pages.dev](https://skillname.pages.dev) — [`apps/web/index.html`](../../apps/web/index.html)
- [ ] **Routes**
  - [ ] `/` — landing + search input + 6 example skill cards
  - [ ] `/explorer/[ensName]` — skill detail page
  - [ ] `/spec` — JSON Schema renderer
- [ ] **Resolution**
  - [ ] Use `@skillname/sdk` `resolveSkill()` in client component
  - [ ] eth.limo deploy demands static export — must work fully client-side
  - [ ] Public Alchemy/Infura RPC from browser
- [ ] **Skill detail content**
  - [ ] Manifest summary (name, version, description, license)
  - [ ] Tools list with execution pills (local / http / keeperhub)
  - [ ] Imports tree (transitive view, collapsible)
  - [ ] Dependents (who imports this) — depends on #6 indexer
  - [ ] Analytics charts (calls, revenue, top callers) — depends on #6 indexer
  - [ ] Verified badge (3 states: `verified` / `unverified` / `mismatch`) per [`docs/explorer-spec.md`](./explorer-spec.md)
- [ ] **"Open in Claude" CTA** → copy `claude_desktop_config.json` snippet
- [ ] **Deploy to eth.limo**
  - [ ] Static export → IPFS pin via Storacha
  - [ ] Set ENS `contenthash` on `skillname.eth`
  - [ ] Verify `skillname.eth.limo` resolves

### #6 On-chain analytics indexer · HIGH

**Goal:** Each skill detail page shows real call count + revenue from on-chain x402 tx.

- [ ] **Indexer architecture** — Cloudflare Worker + KV (or D1)
- [ ] **Source**: scan Base mainnet/Sepolia for x402 settlement tx (USDC `transferWithAuthorization`)
- [ ] **Map tx → skill ENS name**
  - [ ] Decode `X-PAYMENT` payload (off-chain) OR
  - [ ] Use settlement event topic + payee mapping
- [ ] **Aggregate per skill**
  - [ ] Total calls (lifetime + last 30d + last 7d)
  - [ ] Total revenue (USDC, last 30d)
  - [ ] Top callers (top 5 wallets, anonymized)
  - [ ] Time-series (daily for 30d)
- [ ] **REST API** at `analytics.skillname.eth.limo/skill/<ens>`
- [ ] **Frontend** consumes API
  - [ ] Time-series sparkline → bar chart
  - [ ] Revenue total + delta vs prior period
  - [ ] Top callers list with ENS reverse-resolution

### #7 Versioning + lockfile · HIGH

**Goal:** `quote.uniswap.eth@^2` resolves to v2 latest. Lockfile pins exact CID.

- [ ] **Subname-as-version registration**
  - [ ] Script: register `v1.quote.uniswap.eth`, `v2.quote.uniswap.eth` etc. on Sepolia
  - [ ] Burn NameWrapper fuses (CANNOT_TRANSFER, CANNOT_SET_RESOLVER) → immutable
  - [ ] Each version subname has its own `xyz.manifest.skill = ipfs://...` text record
- [ ] **Parent-name version index**
  - [ ] `quote.uniswap.eth` text record `skill.versions = v1:0.9.0,v2:2.0.0` (CSV)
  - [ ] Text record `skill.latest = v2`
- [ ] **Semver matcher in SDK**
  - [ ] Parse `^1`, `~2.1`, exact `v1.0.0`
  - [ ] Match against version index → return correct subname
- [ ] **Lockfile**
  - [ ] CLI verb `skill lock` walks imports, writes lockfile
  - [ ] Lockfile pinned to IPFS, CID set as `xyz.manifest.skill.lockfile`
  - [ ] Bridge respects lockfile if present (reproducible builds)

### #8 CLI · HIGH

**Goal:** One command publishes a skill bundle and sets ENS records.

- [ ] **`packages/cli/src/commands/`** — currently empty
  - [ ] `init.ts` — scaffold a new bundle directory with `manifest.json`, tools/, etc.
  - [ ] `publish.ts` — Storacha upload + ENS `setText` orchestration
  - [ ] `resolve.ts` — run `resolveSkill()` from terminal
  - [ ] `verify.ts` — schema + ENSIP-25 check
  - [ ] `lock.ts` — generate + pin lockfile
- [ ] **Bin alias**: `skill` (in `package.json`)
- [ ] **Wallet integration**
  - [ ] Read `WALLET_PRIVATE_KEY` from `.env`
  - [ ] OR walletconnect bridge for browser sign-in
- [ ] **Storacha integration**
  - [ ] `@web3-storage/w3up-client` for IPFS uploads
  - [ ] Bundle directory → CID
- [ ] **ENS publishing**
  - [ ] viem `setText` calls via PublicResolver on Sepolia
  - [ ] Confirm tx, retry on failure

---

## Tier 3 — Stretch

### #9 ERC-7857 iNFT royalty wrapper · NICE

**Goal:** Skill ownership = transferable iNFT. % of x402 revenue auto-routed to NFT holder.

- [ ] Mint skill ENS as iNFT (token-bound account)
- [ ] Splitter contract on Base
- [ ] On x402 settlement, % to NFT holder
- [ ] OpenSea metadata reflects live call count + revenue
- [ ] 0G Storage holds the "intelligence" layer (sealed inference) — fits 0G iNFT track

### #10 Marketplace integration · NICE

**Goal:** A skill ENS listed on OpenSea Sepolia shows real call/revenue stats.

- [ ] OpenSea metadata template that pulls from ENS text records
- [ ] Test listing a skill ENS at low price on Sepolia OpenSea
- [ ] Buyer flow: transfer ENS → inherits manifest publish authority
- [ ] Demo Scene 7: open OpenSea tab showing the listing

### #11 ENSIP draft · NICE

- [ ] Forum post at https://discuss.ens.domains/c/ai
- [ ] Specify `xyz.manifest.skill.*` namespace as candidate ENSIP
- [ ] Reference implementation = this repo
- [ ] Submit before May 6 to claim "draft ENSIP submitted" in pitch

---

## Skipped (explicit non-goals)

- Advanced search/filter in Explorer (hardcoded list works for demo)
- Multi-author governance / DAO ownership
- Dispute resolution / takedown flow
- Mainnet deployment of demo names (Sepolia only)
- Custom resolver contracts (use ENS PublicResolver)
- Subname access tokens (mentioned in pitch as creative angle, but not built)

---

## D-by-D burndown

| Day | Date | What ships | Owner |
|---|---|---|---|
| D6 | Apr 29 | #1 reference skills authored (4 manifests) | Dev C |
| D6 | Apr 29 | #4 KeeperHub Tier 0 stub through `execute_contract_call` | Dev B |
| D7 | Apr 30 | #2 D5 kill-criterion live in Claude Desktop | Jason |
| D8 | May 1 | #3 walkImports + lockfile draft | Jason |
| D9 | May 2 | #4 x402 paid call lands on BaseScan | Dev B |
| D10 | May 3 | #5 Explorer skill detail; #6 indexer v0 | Dev C |
| D11 | May 4 | #7 versioning script; D11 cold-test rehearsal | All |
| D12 | May 5 | **code freeze 6PM**; demo recording (5 takes) | Jason |
| D13 | May 6 | submission on ETHGlobal Hacker Dashboard | Jason |

---

## Appendix — sub-issue conventions

When opening these as GitHub issues:

- **Title** = the sub-task, prefixed with parent number: `#3.2 SDK walkImports recursive resolver`
- **Body** = goal + acceptance criteria as a checkbox list, plus links to relevant files
- **Labels** = `tier-1` / `tier-2` / `tier-3`, plus `must` / `high` / `nice`
- **Milestone** = `D7-mvp` / `D10-prize` / `D12-freeze`
- **Assignee** = single owner per issue
- **Closing** = a PR that links via `Closes #N` lands on `staging`
