# ENSIP-25 binding workflow

This is the step-by-step for turning a reference skill bundle from "trust: unverified" into "✓ verified" per [ENSIP-25](https://docs.ens.domains/ensip/25). Tracks [issue #56](https://github.com/hien-p/Skillname/issues/56).

## What ENSIP-25 actually requires

Three things have to be true at the same time:

1. The bundle's `manifest.json` declares
   ```json
   "trust": {
     "ensip25": { "enabled": true },
     "erc8004": {
       "registry": "eip155:<chainId>:<contractAddr>",
       "agentId": <id>
     }
   }
   ```
2. The ENS name has the text record `agent-registration[<erc7930>][<agentId>] = "1"` (or any non-empty, non-`"0"` value)
3. The agentId on the ERC-8004 registry resolves back to that ENS name (NFT side of the binding)

The SDK only runs `verifyEnsip25()` when (1) is present. Conditions (2) and (3) are checked at resolution time.

## The unresolved upstream question — which ERC-8004 registry on Sepolia?

There is no canonical ERC-8004 IdentityRegistry deployed on Sepolia at a well-known address as of this writing. Three options, ranked from cheapest to most flexible:

| Option | Cost | Notes |
|---|---|---|
| **Reuse a published reference** | None — just point at it | Search `etherscan.io/address` for "ERC-8004" or "IdentityRegistry" deployments by the spec authors. If one exists, use that — judges already trust it. |
| **Deploy our own from the spec reference** | ~1h | Clone the [ERC-8004 reference repo](https://github.com/erc-8004/contracts), `forge create` against `SEPOLIA_PRIVATE_KEY`, mint an agentId per skill. Adds another contract surface to defend at submission. |
| **Use a placeholder registry + document the gap** | Trivial | Lowest fidelity — judges checking the Etherscan link will see an unrelated contract. Don't ship this in a final submission. |

**Recommendation**: ask an ENS mentor at the next office hours if there's an existing Sepolia deployment they bless. If yes → option 1. If no → option 2, and budget half a day for it.

## Once you know the registry — the bind flow per skill

For each of the 5 reference subnames (`hello`, `quote`, `swap`, `score`, `weather` under `*.skilltest.eth`):

### 1. Mint the Identity NFT

Call the ERC-8004 registry's `mint` (or equivalent) function with the wallet that owns the ENS name. Record the returned `agentId`.

### 2. Update the bundle manifest

Edit `skillname-pack/examples/<bundle>/manifest.json`:

```json
"trust": {
  "ensip25": { "enabled": true },
  "erc8004": {
    "registry": "eip155:11155111:0xYourErc8004RegistryOnSepolia",
    "agentId": 42
  }
}
```

### 3. Set the ENS text record

```bash
pnpm tsx scripts/bind-ensip25.ts \
  quote.skilltest.eth \
  42 \
  eip155:11155111:0xYourErc8004RegistryOnSepolia
```

The script:
- Computes `namehash(ensName)`
- Encodes the registry as ERC-7930 via `@skillname/sdk`'s `encodeErc7930()`
- Builds the key `agent-registration[<erc7930>][<agentId>]`
- Calls `PublicResolver.setText(node, key, "1")` on Sepolia
- Reads the value back to confirm

### 4. Re-pin the bundle and update the CID

Manifest changed → CID changed → ENS text record `xyz.manifest.skill` needs to point at the new CID. Use the existing `pin-to-0g.ts` + `pin-to-storacha.ts` scripts.

### 5. Verify

```bash
pnpm cli skill resolve quote.skilltest.eth
```

Look for `ensip25.bound: true` and the matching `agentId` in the output.

## Doing all 5 in one pass

After the registry decision is made and one bundle is verified end-to-end, batch the rest:

```bash
for ens in hello.skilltest.eth quote.skilltest.eth swap.skilltest.eth score.skilltest.eth weather.skilltest.eth; do
  agentId=$(yq -r ".\"$ens\".agentId" agents.yaml)  # however you track the per-skill agentId
  pnpm tsx scripts/bind-ensip25.ts "$ens" "$agentId" eip155:11155111:0xYourErc8004Registry
done
```

Update each manifest's `trust.erc8004` accordingly, re-pin them as a batch, push the new CIDs to ENS via the existing `xyz.manifest.skill` setter.

## Why this matters for the prize tracks

- **Best ENS Integration for AI Agents**: every demo skill walks in with a verifiable identity that's not just "ENS resolves to a CID". Judges want ENS doing real work — bidirectional NFT↔ENS binding is the textbook example.
- **Most Creative Use of ENS**: the verification key uses an ENS *text record key derived from a packed CAIP-10 / ERC-7930 address* — that's exactly the "what else can ENS do" pattern (verifiable credentials in text records) the criteria call out.

## Limitations of the current scaffold

- Only handles the ENS side of the binding. The NFT mint + reverse pointer is left as a manual step until we pick a registry.
- Updates one skill at a time. The batch pattern above is a shell loop, not a CLI verb (yet).
- No idempotency check — re-running will issue a redundant `setText` if the value's already correct. Cheap on Sepolia but worth fixing if we ever do this in CI.
