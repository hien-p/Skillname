#!/usr/bin/env bash
# skillname — Day 1 setup script
# Run from a fresh directory: ./setup-day1.sh
# Prereqs: node 20+, pnpm 9+, gh CLI, foundry (cast)

set -euo pipefail

REPO_NAME="skillname"
GITHUB_ORG="${GITHUB_ORG:-hien-p}"  # change to Jason's org or personal handle
TEAM_NAME="${TEAM_NAME:-team-manifest}"

echo "==> skillname Day 1 setup"
echo "    Repo: ${GITHUB_ORG}/${REPO_NAME}"
echo ""

# ---------------------------------------------------------------------------
# 1. Repo init
# ---------------------------------------------------------------------------
if [ -d "$REPO_NAME" ]; then
  echo "!! $REPO_NAME already exists. Aborting."
  exit 1
fi

mkdir "$REPO_NAME"
cd "$REPO_NAME"
git init -b main

# ---------------------------------------------------------------------------
# 2. Monorepo scaffold
# ---------------------------------------------------------------------------
cat > package.json <<'EOF'
{
  "name": "skillname",
  "private": true,
  "version": "0.0.1",
  "description": "ENS-native skill registry for AI agents",
  "license": "MIT",
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint",
    "dev:bridge": "pnpm --filter @skillname/bridge dev",
    "cli": "pnpm --filter @skillname/cli exec skill"
  },
  "engines": { "node": ">=20" },
  "packageManager": "pnpm@9.12.0",
  "devDependencies": {
    "typescript": "^5.6.0",
    "tsx": "^4.19.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.7.0"
  }
}
EOF

cat > pnpm-workspace.yaml <<'EOF'
packages:
  - "packages/*"
  - "apps/*"
EOF

cat > tsconfig.base.json <<'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
EOF

cat > .gitignore <<'EOF'
node_modules
dist
.env
.env.local
*.log
.DS_Store
.turbo
coverage
EOF

cat > .env.example <<'EOF'
# RPC (use Alchemy/Infura)
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
BASE_SEPOLIA_RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_KEY
MAINNET_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY

# Wallet (test only — never commit real keys)
WALLET_PRIVATE_KEY=0x0000000000000000000000000000000000000000000000000000000000000000

# ENS (your test name on Sepolia)
TEST_ENS_NAME=manifest-test.eth

# Storacha (run `npx @web3-storage/w3up-client signup` to get DID)
STORACHA_PRINCIPAL=
STORACHA_PROOF=
STORACHA_SPACE=

# 0G Storage
ZG_INDEXER_RPC=https://indexer-storage-testnet-turbo.0g.ai
ZG_PRIVATE_KEY=

# KeeperHub
KEEPERHUB_API_KEY=

# Coinbase Developer Platform (x402 facilitator)
CDP_API_KEY_NAME=
CDP_API_KEY_PRIVATE_KEY=

# Agent wallet (separate from deploy wallet, for x402 payments)
AGENT_WALLET_PRIVATE_KEY=
EOF

# ---------------------------------------------------------------------------
# 3. Package directories
# ---------------------------------------------------------------------------
mkdir -p packages/{schema,sdk,bridge,cli}/src
mkdir -p apps/web/src
mkdir -p examples/research-agent/{tools,prompts,examples}
mkdir -p scripts
mkdir -p .github/workflows
mkdir -p docs

# ---------------------------------------------------------------------------
# 4. Schema package
# ---------------------------------------------------------------------------
cat > packages/schema/package.json <<'EOF'
{
  "name": "@skillname/schema",
  "version": "0.0.1",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "ajv": "^8.17.0",
    "ajv-formats": "^3.0.0"
  }
}
EOF

# ---------------------------------------------------------------------------
# 5. CI
# ---------------------------------------------------------------------------
cat > .github/workflows/ci.yml <<'EOF'
name: CI
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm test
EOF

# ---------------------------------------------------------------------------
# 6. Initial commit
# ---------------------------------------------------------------------------
git add .
git commit -m "chore: initial scaffold

- monorepo: pnpm workspace
- packages: schema, sdk, bridge, cli
- apps: web
- examples: research-agent
- CI: lint + test on PR
"

# ---------------------------------------------------------------------------
# 7. Push to GitHub (requires gh CLI logged in)
# ---------------------------------------------------------------------------
if command -v gh >/dev/null 2>&1; then
  echo "==> Creating GitHub repo..."
  gh repo create "${GITHUB_ORG}/${REPO_NAME}" --public --source=. --remote=origin --push
else
  echo "!! gh CLI not found. Push manually:"
  echo "   git remote add origin git@github.com:${GITHUB_ORG}/${REPO_NAME}.git"
  echo "   git push -u origin main"
fi

# ---------------------------------------------------------------------------
# 8. Print next steps
# ---------------------------------------------------------------------------
cat <<EOF

==> Day 1 scaffold done.

Next (today):
  1. Copy README.md, FEEDBACK.md, BUILD_PLAN.md, skill-v1.schema.json into the repo.
  2. Each team member: \`cp .env.example .env\` and fill in their credentials.
  3. Run \`pnpm install\`.
  4. Register Sepolia ENS test name at https://app.ens.domains (switch to Sepolia).
  5. Confirm KeeperHub MCP works locally (Dev B): https://docs.keeperhub.com/
  6. Confirm Storacha upload works (Dev C): npx @web3-storage/w3up-client signup
  7. Tag the repo: \`git tag tag-d1-eod && git push --tags\`

Day 2 starts the real code. Schema first (Dev C), then publish pipeline (Dev C),
then ENS resolver (Jason). Bridge skeleton waits until D5 morning.

Good luck. Ship it.
EOF
