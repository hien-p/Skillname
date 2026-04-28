#!/usr/bin/env tsx
/**
 * Pin every reference skill bundle's manifest.json to 0G storage testnet.
 *
 * Reads each skillname-pack/examples/<bundle>/manifest.json, builds its
 * Merkle tree, submits via the 0G Indexer, and writes the resulting root
 * hashes to stdout in three formats:
 *   1. human-readable per-bundle log
 *   2. JSON object: { slug: rootHash }
 *   3. comma-separated `slug=root,...` (for the register-skills workflow)
 *
 * Prereqs:
 *   - SEPOLIA_PRIVATE_KEY in env (the same EVM key works on 0G testnet)
 *   - Operator funded with OG on 0G testnet (faucet: https://faucet.0g.ai)
 *
 * Usage:
 *   pnpm tsx scripts/pin-to-0g.ts             # pin all bundles
 *   pnpm tsx scripts/pin-to-0g.ts quote-uniswap  # pin one bundle by slug
 */

import { Indexer, ZgFile } from '@0glabs/0g-ts-sdk'
import { ethers } from 'ethers'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const OG_RPC = process.env.OG_RPC_URL ?? 'https://evmrpc-testnet.0g.ai'
const INDEXER_URL = process.env.OG_INDEXER_URL ?? 'https://indexer-storage-testnet-turbo.0g.ai'
const PRIVATE_KEY = process.env.SEPOLIA_PRIVATE_KEY

if (!PRIVATE_KEY) {
  console.error('SEPOLIA_PRIVATE_KEY env var not set (the same key signs on 0G testnet).')
  process.exit(1)
}

const onlySlug = process.argv[2]

const provider = new ethers.JsonRpcProvider(OG_RPC)
const signer = new ethers.Wallet(PRIVATE_KEY, provider)
const indexer = new Indexer(INDEXER_URL)

console.log('Operator: ', signer.address)
console.log('OG RPC:   ', OG_RPC)
console.log('Indexer:  ', INDEXER_URL)
console.log()

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

const roots: Record<string, string> = {}

for (const slug of bundleDirs) {
  const manifestPath = join(examplesDir, slug, 'manifest.json')
  process.stdout.write(`[${slug}] `)

  let file: ZgFile | null = null
  try {
    file = await ZgFile.fromFilePath(manifestPath)
    const [tree, treeErr] = await file.merkleTree()
    if (treeErr || !tree) {
      console.error(`✗ merkleTree: ${treeErr?.message ?? 'no tree'}`)
      continue
    }
    const localRoot = tree.rootHash()
    if (!localRoot) {
      console.error(`✗ rootHash returned null`)
      continue
    }

    const [tx, uploadErr] = await indexer.upload(file, OG_RPC, signer)
    if (uploadErr) {
      // Some uploads return an error even though the file is already pinned —
      // surface but keep going if we have a rootHash from the local tree.
      console.error(`! upload error: ${uploadErr.message}`)
      console.log(`  using local root: ${localRoot}`)
      roots[slug] = localRoot
      continue
    }

    console.log(`✓ root: ${tx.rootHash}`)
    console.log(`  tx:   ${tx.txHash}`)
    roots[slug] = tx.rootHash
  } catch (e: any) {
    console.error(`✗ ${e.message ?? e}`)
  } finally {
    if (file) await file.close().catch(() => {})
  }
}

console.log('\n--- results ---')
console.log(JSON.stringify(roots, null, 2))

const rootsArg = Object.entries(roots)
  .map(([k, v]) => `${k}=${v}`)
  .join(',')
console.log('\nROOTS=' + rootsArg)

// Also write to GITHUB_OUTPUT if running inside Actions, so the next step
// can consume `roots` directly without parsing logs.
if (process.env.GITHUB_OUTPUT) {
  const fs = await import('node:fs')
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `roots=${rootsArg}\n`)
}
