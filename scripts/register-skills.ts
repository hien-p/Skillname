#!/usr/bin/env tsx
import 'dotenv/config'
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
  roots: Record<string, string>
}

function parsePairs(arg: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!arg) return out
  for (const pair of arg.split(',')) {
    const [k, v] = pair.split('=')
    if (k && v) out[k.trim()] = v.trim()
  }
  return out
}

function parseArgs(): Args {
  const args = process.argv.slice(2)
  let parent = ''
  let cidsArg = ''
  let rootsArg = ''
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--parent') parent = args[++i]
    else if (args[i] === '--cids') cidsArg = args[++i]
    else if (args[i] === '--roots') rootsArg = args[++i]
  }
  if (!parent) {
    console.error('Missing --parent <ensName>')
    console.error('Usage:')
    console.error('  pnpm tsx scripts/register-skills.ts --parent <name>')
    console.error('  pnpm tsx scripts/register-skills.ts --parent <name> --roots <slug=0xroot,...>      # 0G primary')
    console.error('  pnpm tsx scripts/register-skills.ts --parent <name> --cids <slug=bafy...,...>     # IPFS')
    console.error('  pnpm tsx scripts/register-skills.ts --parent <name> --roots ... --cids ...        # both')
    process.exit(1)
  }
  return { parent, cids: parsePairs(cidsArg), roots: parsePairs(rootsArg) }
}

async function main(): Promise<void> {
  const { parent, cids, roots } = parseArgs()

  const RAW_KEY = process.env.SEPOLIA_PRIVATE_KEY
  const RPC_URL = process.env.SEPOLIA_RPC_URL ?? 'https://rpc.sepolia.org'
  if (!RAW_KEY) {
    console.error('SEPOLIA_PRIVATE_KEY env var not set.')
    process.exit(1)
  }
  const PRIVATE_KEY = (RAW_KEY.toLowerCase().startsWith('0x') ? RAW_KEY : `0x${RAW_KEY}`) as Hex

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

  // When --roots or --cids targets specific slugs, only operate on those.
  // Otherwise we'd re-issue setSubnodeRecord for every existing leaf and
  // burn gas overwriting them — a real cost that hit a register run on
  // 2026-05-02 (#agent-research publish).
  const targeted = new Set([...Object.keys(roots), ...Object.keys(cids)])
  const onlyTargeted = targeted.size > 0

  let subnamesCreated = 0
  let recordsSet = 0

  for (const slug of bundleDirs) {
    if (onlyTargeted && !targeted.has(slug)) {
      console.log(`[${slug}] not in --roots / --cids, skipping`)
      continue
    }
    const manifestPath = join(examplesDir, slug, 'manifest.json')
    let manifest: { ensName: string; version: string; dependencies?: string[] }
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

    // 2. Set text records.
    // Precedence for the canonical xyz.manifest.skill record:
    //   --roots (0G) takes priority over --cids (IPFS) — 0G is the project's
    //   primary storage layer per the prize alignment. If --cids is also
    //   provided, it lands on xyz.manifest.skill.ipfs as a dual-pin record.
    const root = roots[slug]
    const cid = cids[slug]
    if (!root && !cid) {
      console.log(`  · no --roots or --cids for ${slug}, skipping text records`)
      continue
    }

    const subNode = namehash(fullName)
    const records: Array<[string, string]> = []
    if (root) {
      records.push(['xyz.manifest.skill', `0g://${root}`])
      if (cid) records.push(['xyz.manifest.skill.ipfs', `ipfs://${cid}`])
    } else {
      records.push(['xyz.manifest.skill', `ipfs://${cid}`])
    }
    records.push(['xyz.manifest.skill.version', manifest.version])
    records.push(['xyz.manifest.skill.schema', 'https://manifest.eth/schemas/skill-v1.json'])
    if (manifest.dependencies && manifest.dependencies.length > 0) {
      records.push(['xyz.manifest.skill.imports', manifest.dependencies.join(',')])
    }

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
