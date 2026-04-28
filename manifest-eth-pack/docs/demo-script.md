# Demo Script (D12 recording)

> 4 minutes. 720p+ OBS screen capture. Vietnamese-accented English narration over screen recording. NO AI voiceover (hard rule). Pre-write every line; rehearse 3x before recording.

---

## Scene 1 — Hook (0:00–0:25)

**Visual:** Title card "manifest.eth — ENS-native skill registry for AI agents" → cut to terminal showing 30+ MCP adapter file folders.

**Narration:**
> "Every AI-on-Ethereum project rewrites the same thing. A custom MCP adapter for Uniswap. Another for Aave. Another for ENS itself. N protocols times M agent frameworks equals adapter explosion. We end that tax. Watch."

---

## Scene 2 — Empty Claude (0:25–0:45)

**Visual:** Claude Desktop with config showing only `manifest-eth` MCP server. Type "What tools do you have for Uniswap?" → Claude says it has none.

**Narration:**
> "Claude has zero protocol-specific tools. Just our bridge. Now I'll point Claude at an ENS name."

---

## Scene 3 — Resolution magic (0:45–1:30)

**Visual:** Type in Claude: "Use research.agent.eth"

**Show on screen** (split window: Claude on left, terminal log on right):
- Bridge log: `→ getEnsText(research.agent.eth, "xyz.manifest.skill")`
- Bridge log: `→ ipfs://bafybei...`
- Bridge log: `→ fetch + verify CID hash ✓`
- Bridge log: `→ ENSIP-25 check: agent-registration[...][42] = "1" ✓`
- Bridge log: `→ Registered 3 tools`
- Claude reply: "Loaded 3 tools from research.agent.eth (verified ✓)"

**Narration:**
> "ENS resolution. IPFS fetch. Hash verification. ENSIP-25 binding to ERC-8004. Three tools registered. Three seconds total. No code changed in Claude."

---

## Scene 4 — Show ENS app & ERC-8004 (1:30–2:10)

**Visual:** Browser. Two tabs side by side:
- Tab 1: ENS app showing `research.agent.eth` with text records visible (`xyz.manifest.skill`, `xyz.manifest.skill.version`, `agent-registration[...][...]`)
- Tab 2: Etherscan on Base — ERC-8004 IdentityRegistry NFT for agentId 42, owned by the same address that controls `research.agent.eth`. Bidirectional verified.

**Narration:**
> "Here's the ENS name in the wild. Three text records: skill bundle CID, version, ENSIP-25 binding. The binding cross-references ERC-8004 IdentityRegistry on Base. Both directions verified. This is what the green checkmark in Claude is reading."

---

## Scene 5 — Free tool: contract_scan (2:10–2:35)

**Visual:** Back to Claude. Type: "Scan contract 0x... on Base."
Claude calls `research_agent__contract_scan` → returns metadata + risk notes.

**Narration:**
> "First tool: contract_scan. Free. Local execution. Pure read. Nothing fancy."

---

## Scene 6 — Paid tool: KeeperHub + x402 (2:35–3:30)

**Visual:** Type: "Execute a contract call to swap 10 USDC to ETH on Base Sepolia."

**Show on screen** (split: Claude + bridge log + BaseScan):
- Bridge log: `→ tool: research_agent__execute_contract_call`
- Bridge log: `→ POST keeperhub-paid endpoint`
- Bridge log: `← HTTP 402 Payment Required: $0.05 USDC`
- Bridge log: `→ signing EIP-3009 transferWithAuthorization`
- Bridge log: `→ retrying with X-PAYMENT header`
- Bridge log: `← KeeperHub: tx 0x... submitted`
- BaseScan tab opens, tx confirmed

**Narration:**
> "Second tool routes through KeeperHub. The endpoint demands $0.05 USDC via x402. Our agent wallet auto-pays, gasless, EIP-3009 stablecoin authorization. KeeperHub reliably executes the contract call. Tx lands on Base Sepolia. The agent never asked for permission. The protocol's tools were resolved from ENS, payment was settled via x402, execution went through KeeperHub. All standards composing."

---

## Scene 7 — OpenClaw same skill (3:30–3:55)

**Visual:** Different terminal. `clawhub install manifest-eth/research-agent`. Then `claw run` — same tools available.

**Narration:**
> "Same bundle, different client. OpenClaw installs the manifest.eth skill from clawhub. The bundle is portable across MCP clients. Zero adapter code per protocol per framework."

---

## Scene 8 — Closing (3:55–4:00)

**Visual:** Architecture diagram with sponsor logos lit up in sequence: ENS → IPFS/Storacha → 0G → ERC-8004 → KeeperHub → x402 → Base.

**Narration:**
> "ENS for identity. IPFS and 0G for storage. ERC-8004 and ENSIP-25 for trust. KeeperHub for execution. x402 for payments. We made them sing. manifest dot eth."

**End card:** Repo URL + ENSIP draft URL (if posted) + team handles.

---

## Recording checklist

- [ ] Test demo cold on a fresh laptop the day before
- [ ] All tx will land — pre-fund agent wallet with 5 USDC + 0.1 ETH on Base Sepolia
- [ ] Pre-load Etherscan tab + ENS app tab
- [ ] OBS canvas 1920x1080
- [ ] Background music: NONE (clean voiceover)
- [ ] Caption pass after recording (free SRT via YouTube auto-caption + manual review)
- [ ] Upload unlisted to YouTube; embed in submission
- [ ] Final length must be 2:00–4:00. Tighten if over.
