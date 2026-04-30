#!/usr/bin/env tsx
/**
 * Pin every reference skill bundle's manifest.json to Storacha (IPFS).
 *
 * Prereqs:
 *   1. Install w3cli: npm i -g @web3-storage/w3cli
 *   2. Create account + space: w3 login && w3 space create skillname
 *   3. Generate agent key: w3 key create --json  → set W3_PRINCIPAL_KEY
 *   4. Delegate upload rights:
 *        w3 delegation create <agent-did> --can 'store/add' --can 'upload/add' \
 *          | base64 > delegation.base64
 *      → set W3_PROOF to the base64 contents
 *
 * Usage:
 *   pnpm tsx scripts/pin-to-storacha.ts             # pin all bundles
 *   pnpm tsx scripts/pin-to-storacha.ts quote-uniswap  # pin one bundle
 */

import * as Client from '@web3-storage/w3up-client'
import { StoreMemory } from '@web3-storage/w3up-client/stores/memory'
import * as Proof from '@web3-storage/w3up-client/proof'
import { Signer } from '@ucanto/principal/ed25519'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const KEY = process.env.W3_PRINCIPAL_KEY
const PROOF_B64 = process.env.W3_PROOF

if (!KEY || !PROOF_B64) {
  console.error('W3_PRINCIPAL_KEY and W3_PROOF env vars are required.')
  console.error('')
  console.error('Setup:')
  console.error('  npm i -g @web3-storage/w3cli')
  console.error('  w3 login && w3 space create skillname')
  console.error('  w3 key create --json  → set W3_PRINCIPAL_KEY')
  console.error('  w3 delegation create <agent-did> --can store/add --can upload/add \\')
  console.error('    | base64  → set W3_PROOF')
  process.exit(1)
}

const principal = Signer.parse(KEY)
const client = await Client.create({ principal, store: new StoreMemory() })

const proofBytes = Buffer.from(PROOF_B64, 'base64')
const proof = await Proof.parse(new Uint8Array(proofBytes))
const space = await client.addSpace(proof)
await client.setCurrentSpace(space.did())

console.log('Agent:  ', principal.did())
console.log('Space:  ', space.did())
console.log()

const onlySlug = process.argv[2]
const examplesDir = 'skillname-pack/examples'
const bundleDirs = readdirSync(examplesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((slug) => !onlySlug || slug === onlySlug)

if (bundleDirs.length === 0) {
  console.error(onlySlug ? `No bundle "${onlySlug}" in ${examplesDir}` : `No bundles in ${examplesDir}`)
  process.exit(1)
}

console.log(`Pinning ${bundleDirs.length} bundle(s): ${bundleDirs.join(', ')}\n`)

const cids: Record<string, string> = {}

for (const slug of bundleDirs) {
  const manifestPath = join(examplesDir, slug, 'manifest.json')
  process.stdout.write(`[${slug}] `)

  try {
    const content = readFileSync(manifestPath)
    const file = new File([content], 'manifest.json', { type: 'application/json' })
    const cid = await client.uploadFile(file)
    const cidStr = cid.toString()
    console.log(`✓ ${cidStr}`)
    cids[slug] = cidStr
  } catch (e: any) {
    console.error(`✗ ${e.message}`)
  }
}

console.log('\n--- results ---')
console.log(JSON.stringify(cids, null, 2))

const cidsArg = Object.entries(cids)
  .map(([k, v]) => `${k}=${v}`)
  .join(',')
console.log('\nCIDS=' + cidsArg)

if (process.env.GITHUB_OUTPUT) {
  const fs = await import('node:fs')
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `cids=${cidsArg}\n`)
}
