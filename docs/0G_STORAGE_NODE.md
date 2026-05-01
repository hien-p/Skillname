# Running a 0G Storage Node

This guide covers running your own 0G Storage Node to qualify for the **0G Storage prize track**. By default, bundles are resolved via the public indexer. Running a self-hosted node means the resolution endpoint is yours — not a shared gateway.

---

## Architecture

```
pnpm tsx scripts/pin-to-0g.ts
  → 0g-storage-client upload
    → 0G Flow contract (on-chain root hash)
    → 0G Storage Nodes (distributed)
    ← indexer reports where root lives

skill_import "foo.eth"
  → ENS xyz.manifest.skill.0g = 0x<root>
  → SDK fetchVia0G(root)
    → GET /file?root=0x<root>
    → manifest.json
```

---

## Step 1: Build the Storage Node (Rust)

```bash
# Clone
git clone -b v1.0.0 https://github.com/0gfoundation/0g-storage-node.git
cd 0g-storage-node

# Build (requires Rust toolchain: rustup + cargo)
export CMAKE_POLICY_VERSION_MINIMUM=3.5
cargo build --release

# Binary: target/release/zgs_node
```

### Build Errors on macOS

If you hit CMake errors on Apple Silicon Mac:
```bash
export CMAKE_POLICY_VERSION_MINIMUM=3.5
cargo build --release
```

---

## Step 2: Build the Upload CLI (Go)

```bash
# Clone
git clone https://github.com/0glabs/0g-storage-client.git
cd 0g-storage-client

# Build
go build -o 0g-storage-client .
chmod +x ./0g-storage-client
```

---

## Step 3: Get 0G Testnet Tokens

```bash
# https://0g-faucet-hackathon.vercel.app/
# Promo code: OPEN-AGENT

# Or mine via your storage node (requires miner registration)
```

---

## Step 4: Configure & Run the Node

```bash
cd 0g-storage-node/run

# Copy testnet config
cp config-testnet-turbo.toml config.toml
```

Edit `config.toml`:
```toml
blockchain_rpc_endpoint = "https://evmrpc-testnet.0g.ai"
log_contract_address = "0xbD2C3F0E65eDF5582141C35969d66e34629cC768"
mine_contract_address = "0x6815F41019255e00D6F34aAB8397a6Af5b6D806f"
reward_contract_address = "0x51998C4d486F406a788B766d93510980ae1f9360"
log_sync_start_block_number = 1
miner_key = "<your_key_without_0x_prefix>"
```

Run:
```bash
cd 0g-storage-node/run
touch log_config  # required by the node
../target/release/zgs_node -c config.toml --blockchain-rpc-endpoint https://evmrpc-testnet.0g.ai
```

The node will sync logs from `log_sync_start_block_number` to the current block height. This can take a while on first start.

---

## Step 5: Upload a Bundle

```bash
cd 0g-storage-client

./0g-storage-client upload \
  --url https://evmrpc-testnet.0g.ai \
  --indexer https://indexer-storage-testnet-turbo.0g.ai \
  --key "$SEPOLIA_PRIVATE_KEY" \
  --file path/to/manifest.json

# Output: root = 0x...  ← use this as xyz.manifest.skill.0g
```

---

## Step 6: Set ENS Text Record

```bash
# Set on your ENS name (e.g. quote.uniswap.eth)
# xyz.manifest.skill.0g = 0x<root_from_step5>
```

Use the ENS app at [app.ens.domains](https://app.ens.domains) or script via viem/ENS contracts.

---

## Step 7: Update SDK (Optional)

The SDK's `fetchVia0G()` reads `OG_STORAGE_NODE_URL` env var. Set it to point to your indexer for faster resolution:

```bash
export OG_STORAGE_NODE_URL=https://indexer-storage-testnet-turbo.0g.ai
```

---

## Pinning & Registration Workflow

```bash
# 1. Pin to 0G Storage (Galileo testnet)
pnpm tsx scripts/pin-to-0g.ts

# 2. Pin to Storacha/IPFS (dual backup)
pnpm tsx scripts/pin-to-storacha.ts

# 3. Set ENS text records:
#    xyz.manifest.skill       = ipfs://<cid>
#    xyz.manifest.skill.0g    = 0x<root>
#    xyz.manifest.skill.version = 1.0.0
```

---

## Contract Addresses (Galileo Testnet)

| Contract | Address |
|---|---|
| Flow | `0xbD2C3F0E65eDF5582141C35969d66e34629cC768` |
| Mine | `0x6815F41019255e00D6F34aAB8397a6Af5b6D806f` |
| Reward | `0x51998C4d486F406a788B766d93510980ae1f9360` |

RPC: `https://evmrpc-testnet.0g.ai`
Faucet: `https://0g-faucet-hackathon.vercel.app/` (promo: `OPEN-AGENT`)
