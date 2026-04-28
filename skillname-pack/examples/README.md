# Reference skills

> Five atomic skill bundles — one ENS name, one function each. They are the canonical examples the SDK, bridge, and explorer test against, and the four published-on-Sepolia examples are what the demo recording calls into Claude Desktop.

## Layout

```
examples/
├── quote-uniswap/      → quote.uniswap.eth     · http  · free
├── swap-uniswap/       → swap.uniswap.eth      · keeperhub + x402 ($0.05 USDC)
├── score-gitcoin/      → score.gitcoin.eth     · http  · free
├── weather-tomorrow/   → weather.tomorrow.eth  · http  · free
└── hello-world/        → hello.world.eth       · local · free
    └── tools/
        └── greet.json  → handler invoked by the bridge's local executor
```

Each directory contains a single `manifest.json` validating against [`packages/schema/skill-v1.schema.json`](../packages/schema/skill-v1.schema.json). One bundle = one tool = one ENS name. That's the pivot: granularity at the function level.

## What each one demonstrates

| Bundle | Execution type | What it proves |
|---|---|---|
| `quote-uniswap` | `http` | The simplest read-only skill. Free public API. Zero on-chain footprint. |
| `swap-uniswap` | `keeperhub` + `x402` | Paid execution end-to-end: HTTP 402 → EIP-3009 USDC → KeeperHub `execute_contract_call` on Base Sepolia. Includes a populated `trust.erc8004` block to drive the ENSIP-25 verification path. |
| `score-gitcoin` | `http` | Reads identity reputation. Demonstrates that "trust skills" compose like everything else. |
| `weather-tomorrow` | `http` | Proves *any* function can become a skill — the AI use-case isn't required. The protocol is general. |
| `hello-world` | `local` | The smoke test. If the bridge can register and call this one, the local-handler path is wired. Useful as a first-run check for new contributors. |

## Publishing flow (for each bundle)

```bash
# 1. Pin the bundle directory to IPFS (Storacha)
w3 up ./skillname-pack/examples/<bundle>

# 2. Set the ENS text records (via app.ens.domains on Sepolia)
xyz.manifest.skill         = ipfs://<cid-from-step-1>
xyz.manifest.skill.version = 1.0.0
xyz.manifest.skill.schema  = https://manifest.eth/schemas/skill-v1.json

# 3. Verify the bridge can resolve it
pnpm cli resolve <ensName>
```

The CLI for steps 1 and 2 is [issue #17](https://github.com/hien-p/Skillname/issues/17) — until it lands, the steps are manual.

## Adding a new reference skill

1. Create a new directory: `examples/<slug>/`
2. Write `manifest.json` against the schema. **One tool only** — that's the rule.
3. If the tool needs a local handler, drop it under `tools/<handler>.json`.
4. Add a row to the table above describing what it demonstrates.
5. Open a PR against `staging`.

The point is to keep these *small*. A reference skill exists to demonstrate one execution pattern, not to be a fully-functional product.
