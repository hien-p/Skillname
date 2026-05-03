#!/usr/bin/env bash
# publish-skill.sh — one-shot publish for a new bundle.
#
# Runs the full pipeline:
#   1. mint    — register agentId on the ERC-8004 IdentityRegistry (Sepolia)
#   2. patch   — write trust.erc8004 into the bundle's manifest.json
#   3. pin     — upload manifest to 0G Galileo
#   4. register — set ENS subname + xyz.manifest.skill text records
#   5. bind    — set ENSIP-25 agent-registration text record
#   6. verify  — run the smoke test (expects bound:true)
#
# Usage:
#   scripts/publish-skill.sh <slug> [parent=skilltest.eth]
#
# Env (loaded from .env via the underlying tsx scripts):
#   SEPOLIA_PRIVATE_KEY     required, owns parent + signs all txs
#   SEPOLIA_RPC_URL         optional, defaults to publicnode
#   ERC8004_REGISTRY_CAIP10 optional, defaults to the canonical Sepolia deployment
#   OG_CLI_BIN              optional, path to 0g-storage-client (defaults to PATH)

set -euo pipefail

SLUG="${1:-}"
PARENT="${2:-skilltest.eth}"
REGISTRY_CAIP10="${ERC8004_REGISTRY_CAIP10:-eip155:11155111:0x48f77FfE1f02FB94bDe9c8ffe84bB4956ace11e4}"

if [[ -z "$SLUG" ]]; then
  echo "usage: $0 <slug> [parent=skilltest.eth]" >&2
  echo "example: $0 price-coingecko" >&2
  exit 1
fi

MANIFEST="skillname-pack/examples/${SLUG}/manifest.json"
if [[ ! -f "$MANIFEST" ]]; then
  echo "✗ no manifest at $MANIFEST" >&2
  exit 1
fi

# Make sure 0g-storage-client is on PATH (built once via the workflow conv).
if ! command -v 0g-storage-client >/dev/null 2>&1; then
  if [[ -x "$HOME/go/bin/0g-storage-client" ]]; then
    export PATH="$HOME/go/bin:$PATH"
  else
    echo "✗ 0g-storage-client not found. Build it once:" >&2
    echo "    git clone --depth 1 --branch v1.3.0 https://github.com/0glabs/0g-storage-client /tmp/0g && (cd /tmp/0g && go build -o ~/go/bin/0g-storage-client)" >&2
    exit 1
  fi
fi

# Derive the ENS name we'll publish under: take the first label of manifest.ensName
# and graft it onto $PARENT. Same logic as register-skills.ts.
ENS_LABEL=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$MANIFEST','utf8')).ensName.split('.')[0])")
ENS="${ENS_LABEL}.${PARENT}"

hr() { printf '\n──── %s ────\n' "$1"; }

hr "1/6 mint agentId for $ENS"
MINT_OUT=$(pnpm -s tsx scripts/mint-agents.ts "$ENS" 2>&1)
echo "$MINT_OUT" | tail -20
AGENT_ID=$(echo "$MINT_OUT" | grep -oE 'agentId=[0-9]+' | head -1 | cut -d= -f2)
if [[ -z "$AGENT_ID" ]]; then
  echo "✗ could not parse agentId from mint output" >&2
  exit 1
fi
echo "✓ agentId=$AGENT_ID"

hr "2/6 patch manifest with trust.erc8004"
node --input-type=module -e "
import { readFileSync, writeFileSync } from 'node:fs';
const path = '$MANIFEST';
const m = JSON.parse(readFileSync(path, 'utf8'));
m.trust = m.trust ?? {};
m.trust.ensip25 = { enabled: true };
m.trust.erc8004 = { registry: '$REGISTRY_CAIP10', agentId: $AGENT_ID };
writeFileSync(path, JSON.stringify(m, null, 2) + '\n');
console.log('  patched: trust.erc8004 = { agentId: $AGENT_ID }');
"

hr "3/6 pin to 0G"
PIN_OUT=$(pnpm -s tsx scripts/pin-to-0g.ts "$SLUG" 2>&1)
echo "$PIN_OUT" | tail -10
ROOT=$(echo "$PIN_OUT" | grep -oE '"'"$SLUG"'": "0x[a-f0-9]{64}"' | head -1 | grep -oE '0x[a-f0-9]{64}')
if [[ -z "$ROOT" ]]; then
  ROOT=$(echo "$PIN_OUT" | grep -oE '0x[a-f0-9]{64}' | head -1)
fi
if [[ -z "$ROOT" ]]; then
  echo "✗ could not parse 0G root from pin output" >&2
  exit 1
fi
echo "✓ root=$ROOT"

hr "4/6 register subname + text records"
pnpm -s tsx scripts/register-skills.ts --parent "$PARENT" --roots "${SLUG}=${ROOT}" 2>&1 | tail -15

hr "5/6 bind ENSIP-25 agent-registration text record"
pnpm -s tsx scripts/bind-ensip25.ts "$ENS" "$AGENT_ID" "$REGISTRY_CAIP10" 1 2>&1 | tail -15

hr "6/6 verify ENSIP-25 binding"
pnpm -s tsx scripts/verify-ensip25.ts 2>&1 | tail -20

cat <<EOF

─────────────────────────────────────────────
  ✓ PUBLISHED  $ENS
─────────────────────────────────────────────
  agentId      $AGENT_ID
  0G root      $ROOT
  registry     $REGISTRY_CAIP10
  manifest     $MANIFEST
  etherscan    https://sepolia.etherscan.io/name-lookup-search?id=$ENS
─────────────────────────────────────────────
EOF
