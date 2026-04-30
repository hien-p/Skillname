# ETHGlobal Open Agents — showcase entry

Copy-paste source for the ETHGlobal showcase form. Keep this file in sync with the latest demo so we don't have to re-write it the night before submission.

---

**Name:** skillname

**Description:** ENS-native registry where one ENS name = one atomic AI skill. Protocols publish a content-addressed MCP skill bundle once at `protocol.eth`; any MCP client (Claude Desktop, Cursor, OpenClaw, custom) resolves the ENS name, fetches the bundle from 0G + IPFS, and registers the bundle's tools dynamically — replacing per-protocol-per-framework adapter code.

**Github:** https://github.com/hien-p/Skillname

**Idea:** We're flipping the framing. Most ENS-AI projects map *agents* to ENS names; we map *skills* (atomic functions). An agent becomes a list of imports — `import quote from "quote.uniswap.eth"` — instead of a hand-coded adapter. This collapses protocol integration from O(protocols × agent frameworks) to O(protocols), and gives agent builders a content-addressed, ENS-native, schema-validated skill graph they can compose like packages. Storage is dual-pinned (0G primary + Storacha IPFS fallback) so resolution survives gateway outages. Trust binding follows ENSIP-25 with ERC-7930 chain encoding for bidirectional ENS ↔ ERC-8004 Identity NFT linking. Paid execution routes through KeeperHub MCP with x402 (HTTP 402 → EIP-3009 USDC `transferWithAuthorization` → retry with `X-PAYMENT`) so a skill can charge for contract calls without leaking keys to the agent.

**Blockers:** None right now. Code freeze is May 5 6PM. Remaining work: demo recording, ENS publish on Sepolia, polish on the `/logs` devlog page.

**Public URL:** https://ethglobal.com/showcase/skillname *(placeholder — replace with the real slug ETHGlobal assigns once submitted)*

**Live demo:**
- Production: https://skillname.pages.dev
- Staging: https://staging.skillname.pages.dev
- Devlog: https://staging.skillname.pages.dev/logs/

**Prize tracks (3 of 3 cap, locked):**

| Track | Bounty | What we ship |
|---|---|---|
| ENS | Best AI Integration + Most Creative | One ENS name = one atomic skill. ENSIP-25 trust binding via ERC-7930. |
| KeeperHub | Best Use + Builder Feedback | Bridge routes paid contract calls through KeeperHub MCP with x402. `FEEDBACK.md` at repo root. |
| 0G | Framework / Tooling | 0G as primary content-addressed storage for bundles via `@0glabs/0g-ts-sdk`; Storacha fallback. |
