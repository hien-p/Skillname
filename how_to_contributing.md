# How to contribute

> Git workflow for this repo. We follow a structured branch model so the codebase deploys cleanly across environments (production, staging) and stays maintainable post-launch.

## Long-living branches

| Branch | Environment | Sui Network | Description |
|---|---|---|---|
| `main` | Production | mainnet | Deployed to production automatically on each push. Connected to Sui mainnet and holds stable, release-ready code. |
| `staging` | Staging | testnet | Testing and QA before production. Connected to Sui testnet. All new features are merged and tested here before promotion to `main`. |

## Support branches

| Branch type | Origin | Target | Purpose |
|---|---|---|---|
| `feature/*` or `author-name/*` | `staging` | `staging` | New features or enhancements. Each branch is created from `staging`, tested via staging deployments, and merged back into `staging` once validated. |
| `hotfix/*` or `author-name/*` | `main` | `main` | Urgent production fixes. Created directly from `main`, merged back to `main`, and immediately back-merged into `staging` to keep histories in sync. |

> **Note:** Branch naming convention (`feature/*` vs `author-name/*`) is pending final decision and will be determined separately. Pick one before any teammate opens a PR so the rule is consistent.

## Quick reference for teammates

```bash
# Starting a new feature
git fetch origin
git checkout -b feature/<short-name> origin/staging   # or <author>/<short-name>
# ... commit work ...
git push -u origin feature/<short-name>
# Open PR: feature/<short-name> → staging

# Filing a hotfix
git fetch origin
git checkout -b hotfix/<short-name> origin/main
# ... commit fix ...
git push -u origin hotfix/<short-name>
# Open PR: hotfix/<short-name> → main
# Once merged, back-merge into staging:
git checkout staging && git pull
git merge --no-ff origin/main
git push origin staging
```

## Rules

- **Never push directly to `main` or `staging`.** Open a PR.
- **`main` only receives merges from `staging` (releases) or `hotfix/*` (emergencies).**
- **Every hotfix must be back-merged into `staging`** before the next staging cut, otherwise histories drift.
- **Rebase `feature/*` onto latest `staging` before opening the PR**, so the diff stays focused on the feature.
