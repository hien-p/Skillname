# Re-record: the "agent imports a skill by ENS name" beat

> Hand-off for the video editor. Replaces the BaseScanner clip (around 02:10–02:45 in `03.05. KIÊN.mp4`) with a real, verifiable demo using a skill that's actually pinned on 0G + has working ENS text records on Sepolia.
>
> **Why it's being re-recorded.** BaseScanner isn't a real skill in our catalog. A judge who clicks the contract address or searches the ENS name will find nothing. This swap uses `quote.skilltest.eth` — already deployed, already pinned, already callable.

---

## What the editor records

A 30–45 second screen capture of Claude Desktop showing:

1. The user prompt
2. The bridge resolving an ENS name and loading a tool
3. The actual tool firing against CoinGecko
4. The response

Three on-screen elements, captured simultaneously:

```
┌──────────────────────────────┬───────────────────────────────┐
│  Claude Desktop              │  Terminal: bridge stdio log   │
│  (~60% width)                │  (~40% width)                 │
├──────────────────────────────┼───────────────────────────────┤
│                              │                               │
│  user / model / tool calls   │  Real-time bridge logs        │
│                              │                               │
└──────────────────────────────┴───────────────────────────────┘
```

Optional cutaway (3 sec): `app.ens.domains/quote.skilltest.eth` showing the `xyz.manifest.skill` text record, to anchor "this ENS name is the source of truth."

---

## Setup (one time, before recording)

### 1. Claude Desktop config

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "skillname": {
      "command": "node",
      "args": [
        "/absolute/path/to/skillname/skillname-pack/packages/bridge/dist/server.js"
      ],
      "env": {
        "SEPOLIA_RPC_URL": "https://ethereum-sepolia-rpc.publicnode.com",
        "OG_INDEXER_URL": "https://indexer-storage-testnet-turbo.0g.ai"
      }
    }
  }
}
```

Then build the bridge once: `pnpm --filter @skillname/bridge build` and restart Claude Desktop.

### 2. Confirm the skill is reachable before recording

In a terminal:

```bash
$ pnpm tsx -e '
import { resolveSkill } from "@skillname/sdk";
const r = await resolveSkill("quote.skilltest.eth", "sepolia");
console.log(JSON.stringify({ name: r.manifest.name, tools: r.manifest.tools.map(t => t.name) }, null, 2));
'
```

Expected output:

```json
{
  "name": "quote-uniswap",
  "tools": ["get_quote"]
}
```

If this fails, the recording will fail too — fix before turning on OBS.

---

## Beat-by-beat script (~35 sec)

### Beat 1 — User prompt (0:00–0:03)

User types in Claude Desktop:

> **Use quote.skilltest.eth to get me the current price of ETH and USDC.**

Annotation overlay: highlight the words `quote.skilltest.eth` in chartreuse — this is the import statement. The whole beat is "ENS name is the import."

### Beat 2 — Bridge resolves the ENS (0:03–0:15)

Claude responds with a tool call. In the terminal pane, the bridge logs appear in order:

```
→ tool: skillname__manifest_load
→ args: { ensName: "quote.skilltest.eth", chain: "sepolia" }
→ getEnsText(quote.skilltest.eth, "xyz.manifest.skill")
   ← 0g://0x5d27a5c2b10d86f258195078562cae80ae83c39f9d27d82bd3a5f047e1e997a2
→ fetch indexer-storage-testnet-turbo.0g.ai/file?root=0x5d27a5c2…  (38 ms)
   ← manifest.json (812 bytes)
→ schema validate (skill-v1)  ✓
→ ENSIP-25 trust check
   → IdentityRegistry.nameOf(7) on Sepolia
   ← "quote.skilltest.eth"  ✓ matches
→ register tool: quote-uniswap__get_quote
   ← exposed to Claude
```

Claude says:

> Loaded `quote.skilltest.eth`. The bundle is `quote-uniswap` v1.0.0 with one tool: `get_quote`. Trust binding (ERC-8004 agentId 7) verified against the ENS owner. Calling it now…

Annotation overlay: a green arrow from the user's `quote.skilltest.eth` text down to the registered `quote-uniswap__get_quote` tool name. **This is the import beat made visible.**

### Beat 3 — Tool fires (0:15–0:25)

In the Claude pane, a tool call card appears:

```
quote-uniswap__get_quote
{
  "ids": "ethereum,usd-coin",
  "vs_currencies": "usd"
}
```

Bridge log:

```
→ HTTP GET https://api.coingecko.com/api/v3/simple/price?ids=ethereum,usd-coin&vs_currencies=usd
   ← 200 OK (412 ms)
   ← { "ethereum": { "usd": 3427.18 }, "usd-coin": { "usd": 1.0 } }
```

(Use the real prices CoinGecko returns at recording time — no fakes. The numbers above are illustrative.)

### Beat 4 — Claude's natural-language reply (0:25–0:35)

Claude responds:

> ETH is **$3,427.18**, USDC is **$1.00** (CoinGecko, just now).
>
> The tool came from `quote.skilltest.eth`. No SDK install, no adapter code — one ENS name and Claude could call it.

End on this frame. Hold for 2 seconds.

---

## Optional B-roll (3 sec, can splice in mid-beat)

Quick browser cutaway:

- Open `https://app.ens.domains/quote.skilltest.eth`
- Scroll to the **Records** tab
- Highlight three rows:
  - `xyz.manifest.skill` → `0g://0x5d27a5…7a2`
  - `xyz.manifest.skill.version` → `1.0.0`
  - `xyz.manifest.skill.schema` → `https://manifest.eth/schemas/skill-v1.json`

Same idea: anchor the demo on a real ENS name a judge can verify themselves.

---

## What NOT to use

- **Do not** show "BaseScanner" or any tool name that isn't in our catalog.
- **Do not** show a fake bridge log with invented commands like `Decompiling to intermediate representation`. The real bridge does ENS resolve → 0G fetch → schema validate → register. Stick to that.
- **Do not** narrate "Claude has access to BaseScan" — that implies a Cloudflare Pages app or a hosted scanner that isn't ours. The narration must always anchor on the ENS name as the source of capability.

---

## Cross-reference with the rest of the demo

This re-recorded beat slots into Scene 5 of `docs/demo-script.md` (replaces the old `contract_scan` placeholder). Scenes 3 and 4 already use a real ENS name (`agent.skilltest.eth`, the composite); this scene uses `quote.skilltest.eth`, the leaf — together they prove the dep-graph walk works in production: `agent → quote (+ score, infer) → live data`.
