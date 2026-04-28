#!/usr/bin/env tsx
/**
 * Create subnames on Sepolia for each reference skill bundle in
 * skillname-pack/examples, set their ENS text records to the bundle CID,
 * version, and schema URI.
 *
 * Prereqs:
 *   - Parent ENS name registered on Sepolia and owned by SEPOLIA_PRIVATE_KEY
 *     (e.g. register `skilltest.eth` once via https://sepolia.app.ens.domains)
 *   - Sepolia ETH for gas (~0.02 ETH covers all five subnames + records)
 *   - SEPOLIA_PRIVATE_KEY and (optionally) SEPOLIA_RPC_URL in env
 *
 * Usage:
 *   pnpm tsx scripts/register-skills.ts --parent skilltest.eth
 *   pnpm tsx scripts/register-skills.ts --parent skilltest.eth \
 *     --cids quote-uniswap=bafy...,swap-uniswap=bafy...,score-gitcoin=bafy...
 *
 * Without --cids, only the subnames are created (skips text records).
 * Re-run with --cids once you've pinned the bundles to IPFS.
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  parseAbi,
  namehash,
  keccak256,
  toBytes,
  type Address,
  type Hex,
} from 'viem'
import { sepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ENS_SEPOLIA = {
  registry: '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' as Address,
  publicResolver: '0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5' as Address,
} as const

const REGISTRY_ABI = parseAbi([
  'function setSubnodeRecord(bytes32 node, bytes32 label, address owner, address resolver, uint64 ttl)',
  'function owner(bytes32 node) view returns (address)',
])

const RESOLVER_ABI = parseAbi([
  'function setText(bytes32 node, string calldata key, string calldata value)',
])

interface Args {
  parent: string
  cids: Record<string, string>
}

function parseArgs(): Args {
  const args = process.argv.slice(2)
  let parent = ''
  let cidsArg = ''
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--parent') parent = args[++i]
    else if (args[i] === '--cids') cidsArg = args[++i]
  }
  if (!parent) {
    console.error('Missing --parent <ensName>')
    console.error('Usage: pnpm tsx scripts/register-skills.ts --parent <name> [--cids <slug=cid,...>]')
    process.exit(1)
  }
  const cids: Record<string, string> = {}
  if (cidsArg) {
    for (const pair of cidsArg.split(',')) {
      const [k, v] = pair.split('=')
      if (k && v) cids[k.trim()] = v.trim()
    }
  }
  return { parent, cids }
}

async function main(): Promise<void> {
  const { parent, cids } = parseArgs()

  const PRIVATE_KEY = process.env.SEPOLIA_PRIVATE_KEY as Hex | undefined
  const RPC_URL = process.env.SEPOLIA_RPC_URL ?? 'https://rpc.sepolia.org'
  if (!PRIVATE_KEY) {
    console.error('SEPOLIA_PRIVATE_KEY env var not set.')
    process.exit(1)
  }

  const account = privateKeyToAccount(PRIVATE_KEY)
  console.log(`Operator: ${account.address}`)
  console.log(`Parent:   ${parent}`)
  console.log(`RPC:      ${RPC_URL}`)
  console.log()

  const wallet = createWalletClient({ account, chain: sepolia, transport: http(RPC_URL) })
  const reader = createPublicClient({ chain: sepolia, transport: http(RPC_URL) })

  // Verify parent ownership
  const parentNode = namehash(parent)
  const parentOwner = (await reader.readContract({
    address: ENS_SEPOLIA.registry,
    abi: REGISTRY_ABI,
    functionName: 'owner',
    args: [parentNode],
  })) as Address

  if (parentOwner.toLowerCase() !== account.address.toLowerCase()) {
    console.error(`Parent "${parent}" is owned by ${parentOwner}, not by operator ${account.address}.`)
    console.error(`Register the parent first at https://sepolia.app.ens.domains.`)
    process.exit(1)
  }
  console.log(`✓ Parent ownership verified\n`)

  // Discover bundles
  const examplesDir = 'skillname-pack/examples'
  const bundleDirs = readdirSync(examplesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)

  console.log(`Found ${bundleDirs.length} bundles: ${bundleDirs.join(', ')}\n`)

  let subnamesCreated = 0
  let recordsSet = 0

  for (const slug of bundleDirs) {
    const manifestPath = join(examplesDir, slug, 'manifest.json')
    let manifest: { ensName: string; version: string }
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } catch (e) {
      console.warn(`[${slug}] could not read manifest.json, skipping`)
      continue
    }

    // Take the first label of the manifest's ensName (e.g. quote.uniswap.eth → quote)
    const label = manifest.ensName.split('.')[0]
    const fullName = `${label}.${parent}`
    const labelHash = keccak256(toBytes(label))

    console.log(`[${slug}] ${manifest.ensName} → ${fullName}`)

    // 1. Create subname (or update if exists; setSubnodeRecord overwrites)
    try {
      const tx = await wallet.writeContract({
        address: ENS_SEPOLIA.registry,
        abi: REGISTRY_ABI,
        functionName: 'setSubnodeRecord',
        args: [parentNode, labelHash, account.address, ENS_SEPOLIA.publicResolver, 0n],
      })
      await reader.waitForTransactionReceipt({ hash: tx })
      console.log(`  ✓ subname created  (tx ${tx.slice(0, 10)}…)`)
      subnamesCreated++
    } catch (e: any) {
      console.error(`  ✗ subname creation failed: ${e.shortMessage ?? e.message}`)
      continue
    }

    // 2. Set text records (only if CID provided)
    const cid = cids[slug]
    if (!cid) {
      console.log(`  · no CID provided, skipping text records`)
      continue
    }

    const subNode = namehash(fullName)
    const records: Array<[string, string]> = [
      ['xyz.manifest.skill', `ipfs://${cid}`],
      ['xyz.manifest.skill.version', manifest.version],
      ['xyz.manifest.skill.schema', 'https://manifest.eth/schemas/skill-v1.json'],
    ]

    for (const [key, value] of records) {
      try {
        const tx = await wallet.writeContract({
          address: ENS_SEPOLIA.publicResolver,
          abi: RESOLVER_ABI,
          functionName: 'setText',
          args: [subNode, key, value],
        })
        await reader.waitForTransactionReceipt({ hash: tx })
        const trimmed = value.length > 50 ? value.slice(0, 47) + '...' : value
        console.log(`  ✓ ${key} = ${trimmed}`)
        recordsSet++
      } catch (e: any) {
        console.error(`  ✗ setText(${key}) failed: ${e.shortMessage ?? e.message}`)
      }
    }
  }

  console.log()
  console.log(`Done. ${subnamesCreated} subname(s) created, ${recordsSet} text record(s) set.`)
}

main().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})
