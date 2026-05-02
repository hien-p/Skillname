# ENSIP-25 binding workflow

Step-by-step for turning a reference skill bundle from "trust: unverified" into "✓ verified" per [ENSIP-25](https://docs.ens.domains/ensip/25). Tracks [issue #56](https://github.com/hien-p/Skillname/issues/56).

---

## What ENSIP-25 actually says

After re-reading [the spec](https://docs.ens.domains/ensip/25), the binding model is **simpler than originally documented in this file**. Two canonical facts that change how we should think about this:

### 1. The text record key

```
agent-registration[<registry>][<agentId>]
```

- `<registry>` is the registry's address encoded as an [**ERC-7930 interoperable address**](https://eips.ethereum.org/EIPS/eip-7930) (hex string with `0x` prefix)
- `<agentId>` is **a string**, not necessarily an integer — the spec only forbids `[` and `]` in the value

The reference implementation in `@skillname/sdk` (`encodeErc7930()` and `verifyEnsip25()`) is now spec-compliant after the fix in this PR (see "Bug fix" below).

### 2. Verification is one-directional

The spec states:
> "If the resolved value is non-empty, the ENS name is considered verified for that specific agent registry entry."

**There is no requirement that the registry side reverse-binds back to the ENS name.** Verification depends on three things only:
1. The bundle declares `trust.erc8004 = { registry, agentId }`
2. The text record `agent-registration[<erc7930>][<agentId>]` exists with a non-empty value
3. (Optional, recommended) The value is `"1"`

**Earlier versions of this doc claimed step 3 required NFT-side reverse binding. That was wrong** — re-read the spec, it's not there. ENS transfers can stale the verification, but enforcement is by convention, not on-chain.

This simplifies #56 dramatically: we don't need an ERC-8004 NFT mint for the spec to call this "bound". We need a registry address (which can be a pointer or even a no-op contract) and the ENS text record set.

---

## Bug fix in this PR — `encodeErc7930` chain_type

The previous SDK implementation used `chain_type = 0x0001` for EVM chains. **The correct value per ERC-7930 is `0x0000`** (CASA namespace id for EIP-155). Cross-checked against the ENSIP-25 spec example for mainnet ERC-8004:

| Source | Hex |
|---|---|
| Spec example (mainnet, registry `0x8004A169…`, agentId 167) | `0x000100000101148004a169fb4a3325136eb29fa0ceb6d2e539a432` |
| Old SDK output | `0x000100010101148004a169fb4a3325136eb29fa0ceb6d2e539a432` |
| Fixed SDK output | `0x000100000101148004a169fb4a3325136eb29fa0ceb6d2e539a432` ✓ |

Worked example for Sepolia (chainId 11155111 = `0xaa36a7`):

```
0x 0001 0000 03 aa36a7 14 <20-byte address>
   ────  ────  ──  ──────  ──  ─────────────
   v=1   EVM   3   chRef   20  addr
```

> **Open spec question** — the EIP-7930 reference page shows Sepolia padded to 4 bytes (`04 00aa36a7`) while the canonical minimum-bytes encoding produces 3 bytes (`03 aa36a7`). My implementation chose canonical-minimum since the ENSIP-25 mainnet example clearly uses the same pattern (1 byte for chainId 1, not 4-byte `00000001`). If a future verifier disagrees, the fix is one line in `encodeErc7930()` — pad up to 4 bytes for chainId > 0xFF.

---

## What we need to do

For each of the 5 reference subnames (`hello`, `quote`, `swap`, `score`, `weather` under `*.skilltest.eth`):

### 1. Use the deployed `IdentityRegistry` on Sepolia

The registry is **live** at:

| Network | Address | Explorer |
|---|---|---|
| Sepolia | `0x48f77FfE1f02FB94bDe9c8ffe84bB4956ace11e4` | [Etherscan](https://sepolia.etherscan.io/address/0x48f77FfE1f02FB94bDe9c8ffe84bB4956ace11e4) |

Source at `contracts/src/IdentityRegistry.sol` — minimal: `register(string name) → uint256 agentId`, ownership transfer, name + owner getters. Spec compliance for ENSIP-25 verification is satisfied just by having the contract address used in the ERC-7930 encoded text-record key — the spec doesn't require any specific registry behavior beyond that.

The CAIP-10 string to use in `manifest.json`:

```
eip155:11155111:0x48f77FfE1f02FB94bDe9c8ffe84bB4956ace11e4
```

Worked example — for `agentId 1`, the ENSIP-25 text-record key is:

```
agent-registration[0x0001000003aa36a71448f77ffe1f02fb94bde9c8ffe84bb4956ace11e4][1]
```

Computed via `@skillname/sdk`'s `encodeErc7930()` + the standard ENSIP-25 template. The 3-byte chain reference `aa36a7` is Sepolia (chainId 11155111) in canonical big-endian.

### 2. Update each bundle's `manifest.json`

```json
"trust": {
  "ensip25": { "enabled": true },
  "erc8004": {
    "registry": "eip155:11155111:0xYourSepoliaRegistry",
    "agentId": 42
  }
}
```

### 3. Set the ENS text record

```bash
pnpm tsx scripts/bind-ensip25.ts \
  quote.skilltest.eth \
  42 \
  eip155:11155111:0xYourSepoliaRegistry
```

The script:
- Computes `namehash(ensName)`
- Encodes the registry as ERC-7930 via `@skillname/sdk`'s `encodeErc7930()` (now spec-compliant)
- Builds the key `agent-registration[<erc7930>][<agentId>]`
- Calls `PublicResolver.setText(node, key, "1")` on Sepolia (resolver `0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5` per the SDK's `ENS_SEPOLIA` map)
- Reads back to confirm

### 4. Re-pin the bundle

Manifest changed → CID changed → ENS text record `xyz.manifest.skill` needs the new CID. Use the existing `pin-to-0g.ts` + `pin-to-storacha.ts` scripts.

### 5. Verify

```bash
pnpm cli skill resolve quote.skilltest.eth
```

Look for `ensip25.bound: true` and the matching `agentId` in the output.

---

## Doing all 5 in one pass

```bash
for ens in hello.skilltest.eth quote.skilltest.eth swap.skilltest.eth score.skilltest.eth weather.skilltest.eth; do
  agentId=$(yq -r ".\"$ens\".agentId" agents.yaml)  # however you track the per-skill agentId
  pnpm tsx scripts/bind-ensip25.ts "$ens" "$agentId" eip155:11155111:0xYourSepoliaRegistry
done
```

Update each manifest's `trust.erc8004` accordingly, re-pin them as a batch, push the new CIDs to ENS via the existing `xyz.manifest.skill` setter.

---

## Why this matters for the prize tracks

- **Best ENS Integration for AI Agents**: every demo skill walks in with a verifiable identity stored as a structured text record — not just "ENS resolves to a CID". The verification key is computed on the fly from the `(registry, agentId)` pair, so it's truly dynamic identity.
- **Most Creative Use of ENS**: ERC-7930-encoded interoperable address packed into an ENS text record key. This is exactly the "what else can ENS do?" the criteria call out. Worth a paragraph in the README pointing the judges at `encodeErc7930()` in `packages/sdk/src/index.ts:380`.

---

## Open items

- **The ChainReference encoding question above** — pick a side after spec authors clarify, fix in 1 line if needed
- **Pick the registry contract** — option 2 (stub on Sepolia) is the recommended path
- **Batch automation** — current `bind-ensip25.ts` does one skill at a time. The shell loop above is the workaround
- **No idempotency check** — re-running issues a redundant `setText` even if the value's already correct. Cheap on Sepolia, worth fixing if we ever do this in CI
