# skillname analytics indexer

Cloudflare Worker that tails `SkillCalled` events from the SkillLink registry on Sepolia, aggregates per-skill stats into KV, and serves them via a small HTTP API. Scaffolds [issue #15](https://github.com/hien-p/Skillname/issues/15).

## Architecture

```
cron (1m)              Sepolia RPC               KV
   │                       │                      │
   └─→ scan(fromBlock)──→  eth_getLogs ──→ ingest each log:
                           topics=[SkillCalled]    update skill:<node>
                                                    {calls, gas, top_callers}
   │
   └─→ persist `_cursor:last_scanned_block`

HTTP                                              KV
GET /skill/:node      ─────────────────────→  read skill:<node> → JSON
GET /skills?limit=N   ─→ list skill:* → sort by calls_24h desc
GET /health           ─→ {ok: true}
```

`SkillCalled` is the registry's per-call event:

```solidity
event SkillCalled(
    bytes32 indexed node,
    address indexed sender,
    bytes4  indexed selector,
    bool    success,
    uint256 gasUsed
);
```

## Setup

```bash
cd apps/analytics
pnpm install

# 1. Create the KV namespace
wrangler kv:namespace create SKILL_STATS
# Copy the printed `id =` value into wrangler.toml under [[kv_namespaces]].

# 2. Deploy
wrangler deploy
```

Once deployed, the cron handler runs every minute, scanning up to 1000 new blocks per run, capped at the chain head. The cursor is persisted in KV so restarts and Worker invocations don't double-count.

## HTTP API

- `GET /skill/:node` — JSON stats for one skill, where `:node` is the bytes32 ENS namehash (e.g. `0xa1b2c3…`)

  ```json
  {
    "node": "0xa1b2c3…",
    "calls_total": 42,
    "calls_24h": 7,
    "calls_7d": 31,
    "gas_total": "1234567",
    "top_callers": [
      { "addr": "0xdead…", "count": 14 },
      { "addr": "0xbeef…", "count": 9 }
    ],
    "last_block": 10769453,
    "last_seen_at": 1746162831
  }
  ```

  If the skill has never been called, returns zero-valued struct (not 404).

- `GET /skills?limit=10` — top N skills by `calls_24h`

- `GET /health` — `{ ok: true, version: "0.0.1" }`

## Updating after the SkillLink redeploy

When the NameWrapper-aware version of SkillLink ships from #52, update three values in `wrangler.toml`:

```toml
[vars]
SKILLLINK_ADDRESS = "0xNEW…"
START_BLOCK = "<block_of_new_deploy>"
```

Then `wrangler kv:key delete --binding=SKILL_STATS _cursor:last_scanned_block` to reset the indexer cursor, and `wrangler deploy`. The Worker re-scans from the new deploy block.

## Limitations (intentional, hackathon scope)

- **Sliding windows are crude** — `calls_24h` and `calls_7d` increment on every event but never decay. A future pass could implement proper window decay via a separate cron sweep.
- **No native ENS reverse-resolution** for `top_callers` — addresses are stored as hex. Frontend can resolve them via the SDK if needed.
- **Single-chain (Sepolia)** — same constraint as the SkillLink contract itself. Cross-chain events would need separate Workers per chain.
- **No retention policy** — KV records grow unbounded. Fine for demo (small N), needs eviction for production.
