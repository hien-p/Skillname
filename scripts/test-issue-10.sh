#!/usr/bin/env bash
# Test issue #10 — atomic reference skill manifests must validate against schema v1.
# Run from repo root: ./scripts/test-issue-10.sh

set -euo pipefail

SCHEMA="skillname-pack/packages/schema/skill-v1.schema.json"
EXAMPLES_DIR="skillname-pack/examples"
MANIFESTS=(
  "quote-uniswap"
  "swap-uniswap"
  "score-gitcoin"
  "weather-tomorrow"
  "hello-world"
)

cyan='\033[0;36m'; green='\033[0;32m'; red='\033[0;31m'; reset='\033[0m'

echo -e "${cyan}══ Issue #10 — atomic skill manifest validation ══${reset}"
echo "Schema: $SCHEMA"
echo ""

# Each manifest must:
#   1. parse as JSON
#   2. validate against skill-v1.schema.json
#   3. have exactly ONE tool (the atomic-granularity rule from the pivot)

fail=0
for slug in "${MANIFESTS[@]}"; do
  manifest="$EXAMPLES_DIR/$slug/manifest.json"
  printf "  %-20s " "$slug"

  if [ ! -f "$manifest" ]; then
    echo -e "${red}✗ missing${reset}"
    fail=$((fail+1))
    continue
  fi

  if ! python3 -m json.tool "$manifest" > /dev/null 2>&1; then
    echo -e "${red}✗ invalid JSON${reset}"
    fail=$((fail+1))
    continue
  fi

  # Schema validation via ajv-cli (npx, no install)
  if ! npx --yes ajv-cli@5 validate -s "$SCHEMA" -d "$manifest" --strict=false > /tmp/ajv.out 2>&1; then
    echo -e "${red}✗ schema invalid${reset}"
    cat /tmp/ajv.out | tail -8
    fail=$((fail+1))
    continue
  fi

  # Atomic check: tools[].length must be 1
  tools_count=$(python3 -c "import json,sys; print(len(json.load(open('$manifest'))['tools']))")
  if [ "$tools_count" != "1" ]; then
    echo -e "${red}✗ not atomic ($tools_count tools, expected 1)${reset}"
    fail=$((fail+1))
    continue
  fi

  echo -e "${green}✓${reset} (1 tool)"
done

echo ""
if [ $fail -eq 0 ]; then
  echo -e "${green}All ${#MANIFESTS[@]} reference manifests validate. Issue #10 (code) ready to merge.${reset}"
  exit 0
else
  echo -e "${red}$fail manifest(s) failed. Fix before opening the PR.${reset}"
  exit 1
fi
