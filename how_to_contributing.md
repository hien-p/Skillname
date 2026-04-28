# How to contribute

> Git workflow + deployment pipeline for [`hien-p/Skillname`](https://github.com/hien-p/Skillname). Branch model first; deployment + protection rulesets at the bottom.

## Long-living branches

| Branch | Environment | Network | Cloudflare Pages branch | Description |
|---|---|---|---|---|
| `main` | Production | Ethereum mainnet | production | Deployed automatically on every push. Holds release-ready code. |
| `staging` | Staging | Sepolia / Base Sepolia | staging | Testing and QA before production. Every feature merges here first, then gets promoted to `main`. |

## Support branches

| Branch type | Origin | Target | Purpose |
|---|---|---|---|
| `feature/*` or `<author>/*` | `staging` | `staging` | New features or enhancements. Created from `staging`, tested via the staging deployment, merged back to `staging` once validated. |
| `hotfix/*` or `<author>/*` | `main` | `main` | Urgent production fixes. Created from `main`, merged back to `main`, **then immediately back-merged into `staging`** to keep histories in sync. |

> **Naming:** pick `feature/*` or `<author>/*` and stick with it across the team — switching mid-hackathon creates churn. Default: `feature/*`.

## How teammates push code to staging

This is the main day-to-day flow. Direct pushes to `staging` and `main` are blocked by branch protection — everything goes through a PR.

```bash
# 1. Fetch latest staging
git fetch origin
git checkout staging
git pull origin staging

# 2. Create your branch from staging
git checkout -b feature/<short-name>

# 3. Commit your work
git add <files>
git commit -m "feat: short description"

# 4. Push the branch
git push -u origin feature/<short-name>

# 5. Open a PR targeting staging
gh pr create --base staging --title "..." --body "..."

# 6. Cloudflare Pages will auto-build a preview deployment on the PR
# 7. After review (CI green), merge via GitHub UI or:
gh pr merge --squash --delete-branch
```

## Hotfix flow

```bash
# Branch from main, fix, push, open PR to main
git fetch origin
git checkout -b hotfix/<short-name> origin/main
# ... fix and commit ...
git push -u origin hotfix/<short-name>
gh pr create --base main --title "fix: ..." --body "..."

# After the hotfix merges to main, immediately back-merge into staging
# so the histories don't drift:
git checkout staging
git pull origin staging
git merge --no-ff origin/main
git push origin staging
```

## Branch protection (what's enforced)

Both `main` and `staging`:
- Force-pushes blocked
- Branch deletions blocked
- PRs required (direct pushes rejected)

`main`:
- 1 approving review required before merge

`staging`:
- 0 approvals required — CI + the PR itself is the gate

Rulesets are stored as JSON in [`.github/rulesets/`](./.github/rulesets/) so they're versioned with the code.

### Apply or update branch-protection rulesets

```bash
# First-time apply (creates the ruleset)
gh api -X POST /repos/hien-p/Skillname/rulesets --input .github/rulesets/main.json
gh api -X POST /repos/hien-p/Skillname/rulesets --input .github/rulesets/staging.json

# Inspect what's installed (find the ruleset ID)
gh api /repos/hien-p/Skillname/rulesets

# Update an existing ruleset
gh api -X PUT /repos/hien-p/Skillname/rulesets/<ID> --input .github/rulesets/main.json
```

Requires `gh` authenticated as a user with admin perms on the repo.

## Cloudflare deployment

The workflow at [`.github/workflows/cloudflare-deploy.yml`](./.github/workflows/cloudflare-deploy.yml) deploys to Cloudflare Pages automatically.

| Trigger | Deploys to |
|---|---|
| Push to `main` | Pages **production** environment (the project's primary URL) |
| Push to `staging` | `staging.<project>.pages.dev` (Pages branch deployment) |
| Pull request | Cloudflare Pages' GitHub integration creates a preview URL automatically — no workflow change needed; just connect the repo on the Cloudflare dashboard |

### Required GitHub secrets

Set once at `Settings → Secrets and variables → Actions` on `hien-p/Skillname`:

| Secret | Where to find it |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → Profile → API Tokens → Create token. Scopes: **Account → Cloudflare Pages → Edit**, **Account → Account Settings → Read**, **Zone → Zone Settings → Edit** (only needed for rulesets, see below). |
| `CLOUDFLARE_ACCOUNT_ID` | Right sidebar of any Workers/Pages page on the Cloudflare dashboard. |
| `CLOUDFLARE_PROJECT_NAME` | The Pages project name — create it once via the dashboard (e.g. `skillname`). |

> The workflow has a fallback so it deploys a placeholder `index.html` until `apps/web/` exists. Once the explorer is built, the workflow will pick up the real `apps/web/dist` output.

## Cloudflare Rulesets (response headers, cache, redirects)

Two starter rulesets ship in [`cloudflare-rulesets/`](./cloudflare-rulesets/):

| File | What it does |
|---|---|
| [`main-headers.json`](./cloudflare-rulesets/main-headers.json) | Production: HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy, X-Content-Type-Options, plus 1-year immutable cache for static assets (`/_next/static/`, `/assets/`, common asset extensions). |
| [`staging-headers.json`](./cloudflare-rulesets/staging-headers.json) | Same security headers as production, **plus** `X-Robots-Tag: noindex, nofollow` so search engines don't crawl the staging environment. |

These only matter once the project is on a custom Cloudflare zone (e.g. `skillname.eth`-pointed domain). Pages-only deployments at `*.pages.dev` use Cloudflare's default headers and don't need these rulesets.

### Apply Cloudflare Rulesets

```bash
ZONE_ID="<your-zone-id>"           # Cloudflare dashboard → Overview, right sidebar
API_TOKEN="$CLOUDFLARE_API_TOKEN"  # same token as the GitHub secret

# Apply production ruleset
curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rulesets" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  --data @cloudflare-rulesets/main-headers.json

# Apply staging ruleset (filter to a staging hostname via the rule's `expression` if needed)
curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rulesets" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  --data @cloudflare-rulesets/staging-headers.json
```

To update an existing ruleset, list rulesets first, find the `id`, then `PUT` to `/zones/$ZONE_ID/rulesets/<id>`.

```bash
curl "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rulesets" \
  -H "Authorization: Bearer $API_TOKEN" | jq '.result[] | {id, name, phase}'
```

## Rules

- **Never push directly to `main` or `staging`.** Open a PR.
- **`main` only receives merges from `staging` (releases) or `hotfix/*` (emergencies).**
- **Every hotfix must be back-merged into `staging`** before the next staging cut, otherwise histories drift.
- **Rebase `feature/*` onto latest `staging` before opening the PR**, so the diff stays focused on the feature.
- **Don't bypass branch protection** even if your account has admin rights — the rulesets exist precisely to prevent oops-merges to `main` during demo week.
