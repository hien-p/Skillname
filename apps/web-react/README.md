# `@skillname/web-react`

React + Vite + Tailwind v4 + wagmi port of the demo surfaces from `apps/web/`. The original 3158-line static SPA stays at `apps/web/index.html` for legacy / comparison; this directory is the path forward post-hackathon.

## What's ported

| Surface | Status |
|---|---|
| Skill resolver hero (with `@<range>` semver support) | ✅ |
| On-chain bento card (SkillLink count + NFT count + agents count + RUN DEMO) | ✅ |
| Skill detail view (Readme / Tools / Trust / Dependencies panes) | ⏳ not yet |
| Publish flow (wallet connect + setSubnodeRecord + setText) | ⏳ wagmi `useWriteContract` plumbing in place, panel not yet |
| Skill catalog / heatmap / bento side widgets | ⏳ not yet |

## Running locally

```bash
cd apps/web-react
pnpm install
pnpm dev
```

Vite serves on `http://localhost:5173`. Hot reload + TypeScript on save.

## Stack

- **Vite 5** + `@vitejs/plugin-react` for the dev server / build
- **React 18** with strict mode
- **TypeScript** strict, no unused locals/parameters
- **Tailwind v4** via `@tailwindcss/vite` — config lives in `src/index.css` `@theme` block (no `tailwind.config.*` file)
- **wagmi 2 + viem 2** for wallet + RPC; default to Sepolia, fallback to mainnet
- **@tanstack/react-query 5** for the wagmi hook cache (peer dep of wagmi)

## What still uses static-page constants

The contract addresses (SkillLink, IdentityRegistry, SkillNFT) are hardcoded in `src/lib/contracts.ts` — same values as `apps/web/index.html`. Both files should be updated together if any deployment changes.

## Why React instead of static HTML

The static page works for the hackathon demo, but at 3158 lines in a single file it's hard to maintain. This port:

- Splits each demo surface into its own component
- Replaces inline `viem` ENS reads with wagmi hooks (`useReadContract`, etc.) for proper caching + revalidation
- Uses Tailwind utilities instead of inline `<style>` blocks
- Keeps the same demo behaviour byte-for-byte where possible (RUN DEMO returns `$2300.00`, semver resolution accepts `@^1` / `@latest`)

## Not in scope for this PR

- Hash routing for skill detail pages (`#/skill/<name>`) — port from the static page when the detail surface lands
- Logs page (`/logs`)
- Light/dark layered split with the divider
- All the heatmap / bridge feed / publish flow widgets

These can be added incrementally without breaking the demo.
