# SkillLink — ENS-keyed on-chain skill registry

`SkillLink` makes ENS names directly callable from Solidity. Smart contracts (and EOAs) can invoke a registered skill by its ENS namehash, with a per-name selector allowlist enforced on-chain.

This is the on-chain mirror of the off-chain MCP composition path: the bridge already routes `type:"contract"` execution via viem to a specific impl. The registry lets a contract do the same lookup natively, by ENS name, in a single `call()`.

## Deployment

| Network | Address | Explorer |
|---|---|---|
| Sepolia (testnet) | `0xE2532C1dB5FceFA946Ee64D44c22027c070DE8Aa` | [Etherscan](https://sepolia.etherscan.io/address/0xE2532C1dB5FceFA946Ee64D44c22027c070DE8Aa) |

The contract uses two ENS-side constants:

| Role | Address (Sepolia) |
|---|---|
| ENS Registry | `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e` |
| ENS NameWrapper | `0x0635513f179D50A207757E05759CbD106d7dFcE8` |

## ABI essentials

```solidity
// Register or update — only callable by the current ENS owner of `node`.
function register(bytes32 node, address impl, bytes4[] calldata selectors) external;

// Invoke a registered skill by ENS namehash. Forwards msg.value, returns result.
function call(bytes32 node, bytes calldata data) external payable returns (bytes memory);

// Discovery
function skills(bytes32 node) external view returns (
    address impl, address owner, uint96 registeredAt, uint256 selectorBitmap
);
function getSelectors(bytes32 node) external view returns (bytes4[] memory);
function isSelectorAllowed(bytes32 node, bytes4 selector) external view returns (bool);
function skillCount() external view returns (uint256);

event SkillRegistered(bytes32 indexed node, address indexed impl, address indexed owner, bytes4[] selectors);
event SkillCalled(bytes32 indexed node, address indexed sender, bytes4 indexed selector, bool success, uint256 gasUsed);
```

## Capability model

The selector allowlist is the registry's only access-control mechanism. When you `register()`, you commit to exactly which 4-byte function selectors callers can invoke through the registry. `call()` reverts with `SelectorNotAllowed` if asked to forward anything outside the list.

This means the impl contract can have many functions, but only the ones you whitelist at register time are reachable through `SkillLink.call()`. Direct calls to the impl bypass the allowlist — the contract is not a proxy, it's a router with policy.

## Ownership model

Ownership is the ENS name itself. There is no admin role on the registry, no upgradability, no pause switch. The only person who can re-`register()` a skill is whoever currently owns the ENS name in the ENS Registry (or the NameWrapper, for wrapped names).

Rotation is therefore a feature: transferring the ENS name to a new owner gives them sole authority to update the skill's impl and selector list. The registry itself stores nothing about who *should* own the name.

### NameWrapper compatibility

Most modern `.eth` names are wrapped via the ENS NameWrapper. For wrapped names, `ENS_REGISTRY.owner(node)` returns the NameWrapper contract address rather than the actual user. SkillLink handles this:

```solidity
address ensOwner = ENS_REGISTRY.owner(node);
if (ensOwner == address(NAME_WRAPPER)) {
    ensOwner = NAME_WRAPPER.ownerOf(uint256(node));
}
require(msg.sender == ensOwner, "not the ENS owner");
```

If you're porting to mainnet, swap the NameWrapper constant — it's `0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401` on mainnet vs `0x0635513f179D50A207757E05759CbD106d7dFcE8` on Sepolia.

## Composition demo

The `contracts/src/examples/` directory ships three reference contracts that exercise the registry end-to-end:

| Contract | ENS name | Role |
|---|---|---|
| `QuoteUniswap` | `quote.uniswap.skilltest.eth` | Mock price oracle, returns `2300e6` for `"ethereum"` |
| `QuoteSushi` | `quote.sushi.skilltest.eth` | Same shape, returns `2295e6` for `"ethereum"` |
| `BestQuoteAggregator` | `quote.aggregate.skilltest.eth` | Calls both via `registry.call()`, returns the higher quote |

`BestQuoteAggregator` is itself a registered skill. A third party can call:

```bash
cast call $SKILLLINK_ADDRESS "call(bytes32,bytes)(bytes)" \
  $(node="quote.aggregate.skilltest.eth" cast namehash $node) \
  $(cast calldata "getBestQuote(string)" "ethereum") \
  --rpc-url $SEPOLIA_RPC_URL
```

…and the registry dispatches to `BestQuoteAggregator`, which itself dispatches to `QuoteUniswap` and `QuoteSushi` through the registry, which records `SkillCalled` events for each hop. **One external call, three on-chain skill invocations, zero hardcoded addresses below the entry point.**

## Deploying the demo

```bash
export SEPOLIA_PRIVATE_KEY=0x...                                   # owner of *.skilltest.eth subnames
export SKILLLINK_ADDRESS=0xE2532C1dB5FceFA946Ee64D44c22027c070DE8Aa # already deployed
export SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
export ETHERSCAN_API_KEY=...                                       # for source verification

forge script contracts/script/DeployComposition.s.sol \
  --rpc-url $SEPOLIA_RPC_URL \
  --broadcast \
  --verify
```

The script:
1. Deploys `QuoteUniswap` and `QuoteSushi`
2. Registers both in `SkillLink` via `register()`
3. Deploys `BestQuoteAggregator(registry, uniswapNode, sushiNode)`
4. Registers the aggregator as `quote.aggregate.skilltest.eth`
5. Calls `agg.getBestQuote("ethereum")` once and logs the result

If steps 2 or 4 revert with `NotENSOwner`, the wallet doesn't currently own the corresponding `*.skilltest.eth` subname on Sepolia — fix the ENS ownership first, then re-run.

## Bridge integration (planned)

Once a manifest's `execution.address` resolves to a name registered in `SkillLink`, the bridge can opt into routing through the registry by setting `useRegistry: true` on the execution config. This makes off-chain MCP callers benefit from the same selector allowlist + analytics events as on-chain composition, without changing the bundle author's code.

Tracked as the `useRegistry` flag work in [issue #52](https://github.com/hien-p/Skillname/issues/52).

## Analytics integration

The `SkillCalled` event is shaped for the analytics indexer ([issue #15](https://github.com/hien-p/Skillname/issues/15)):

- `node` (indexed): identifies the skill by ENS namehash
- `sender` (indexed): the calling agent's address
- `selector` (indexed): which function was invoked
- `success`: outcome
- `gasUsed`: cost signal

A Cloudflare Worker tailing this event on Base Sepolia (or wherever paid execution lands) can populate per-skill call count, top callers, and latency distribution without any off-chain coordination.

## Limitations

- **Single-chain (Sepolia).** The contract reads ENS state at the canonical Ethereum Registry address, so it cannot live on a chain without ENS. Cross-chain ENS lookup (CCIP-Read / EIP-3668) is out of scope for now.
- **Selector bitmap is a Bloom filter, not an index.** The `selectorBitmap` field gives a fast-path negative test using the low 8 bits of the selector. Positive cases still fall through to a linear scan over the full `selectors[]` array. Acceptable while skills declare ≤ a few selectors each; revisit if a skill ever needs > 32 selectors.
- **No payment-per-call gating.** The registry is free to call. Paid skill invocation continues to route through `keeperhub-paid` / x402 off-chain. A future version could embed payment metering on-chain if the demand justifies the gas overhead.
