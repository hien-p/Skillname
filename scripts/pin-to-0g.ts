#!/usr/bin/env tsx
import 'dotenv/config'
/**
 * Pin reference skill bundle manifest(s) to 0G Galileo testnet via the
 * official Go CLI (0g-storage-client). Wrapping the binary instead of
 * calling @0glabs/0g-ts-sdk directly avoids known SDK issues (#26 url.clone,
 * #49 Indexer.download crash) while still hitting the same on-chain flow
 * contract — so prize-track evidence stays intact.
 *
 * Prereqs:
 *   - 0g-storage-client v1.3.0+ on PATH (built from
 *     https://github.com/0glabs/0g-storage-client). The pin-and-register
 *     workflow installs it for you.
 *   - SEPOLIA_PRIVATE_KEY in env (same EVM key works on 0G testnet).
 *   - Operator funded with 0G token (Galileo faucet, daily limit 0.1).
 *     One small manifest costs ≪0.1 0G — claim once, pin once is enough.
 *
 * Usage:
 *   pnpm tsx scripts/pin-to-0g.ts                # pin every bundle
 *   pnpm tsx scripts/pin-to-0g.ts quote-uniswap  # single bundle (default in CI)
 */

import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const OG_RPC = process.env.OG_RPC_URL ?? 'https://evmrpc-testnet.0g.ai'
const INDEXER_URL = process.env.OG_INDEXER_URL ?? 'https://indexer-storage-testnet-turbo.0g.ai'
const PRIVATE_KEY = process.env.SEPOLIA_PRIVATE_KEY
const CLI = process.env.OG_CLI_BIN ?? '0g-storage-client'

if (!PRIVATE_KEY) {
  console.error('SEPOLIA_PRIVATE_KEY env var not set (the same key signs on 0G testnet).')
  process.exit(1)
}

console.log('OG RPC:   ', OG_RPC)
console.log('Indexer:  ', INDEXER_URL)
console.log('CLI:      ', CLI)
console.log()

const onlySlug = process.argv[2]
const examplesDir = 'skillname-pack/examples'
const bundleDirs = readdirSync(examplesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((slug) => !onlySlug || slug === onlySlug)

if (bundleDirs.length === 0) {
  console.error(onlySlug ? `No bundle named "${onlySlug}" in ${examplesDir}` : `No bundles in ${examplesDir}`)
  process.exit(1)
}

console.log(`Pinning ${bundleDirs.length} bundle(s): ${bundleDirs.join(', ')}\n`)

// CLI logs via logrus: "file uploaded, root = 0x..." (single fragment) or
// "file uploaded in N fragments, roots = 0x...,0x..." (large file).
// Manifests are <2KB so single fragment is the only path we hit, but we
// keep the multi-root fallback so future larger bundles don't silently break.
const ROOT_LINE_RX = /file uploaded(?:[^,]*,)?\s*roots?\s*=\s*([^\s]+)/i

const roots: Record<string, string> = {}

for (const slug of bundleDirs) {
  const manifestPath = join(examplesDir, slug, 'manifest.json')
  process.stdout.write(`[${slug}] `)

  // logrus writes to stderr by default. execFileSync only returns stdout, so
  // the root line was getting silently dropped on success — use spawnSync
  // and merge both streams unconditionally.
  const result = spawnSync(
    CLI,
    [
      'upload',
      '--url', OG_RPC,
      '--indexer', INDEXER_URL,
      '--key', PRIVATE_KEY,
      '--file', manifestPath,
    ],
    { encoding: 'utf8' }
  )
  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  if (result.error || result.status !== 0) {
    console.error(`✗ CLI exit ${result.status ?? '?'}${result.error ? ` (${result.error.message})` : ''}`)
    if (stderr) console.error(stderr.split('\n').map((l: string) => '    ' + l).join('\n'))
    if (stdout) console.error(stdout.split('\n').map((l: string) => '    ' + l).join('\n'))
    continue
  }

  const combined = stdout + '\n' + stderr
  const m = combined.match(ROOT_LINE_RX)
  if (!m) {
    console.error(`✗ no root in CLI output:\n${combined}`)
    continue
  }
  const rootField = m[1]
  // Single-fragment uploads return one root; multi-fragment returns
  // comma-separated. We pin the first root since that's the one ENSIP-25
  // text records reference.
  const root = rootField.split(',')[0].trim()
  console.log(`✓ root: ${root}`)
  roots[slug] = root
}

console.log('\n--- results ---')
console.log(JSON.stringify(roots, null, 2))

const rootsArg = Object.entries(roots)
  .map(([k, v]) => `${k}=${v}`)
  .join(',')
console.log('\nROOTS=' + rootsArg)

if (process.env.GITHUB_OUTPUT) {
  const fs = await import('node:fs')
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `roots=${rootsArg}\n`)
}

if (Object.keys(roots).length === 0) {
  process.exit(1)
}
