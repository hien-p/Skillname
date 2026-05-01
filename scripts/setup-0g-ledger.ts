#!/usr/bin/env tsx
import 'dotenv/config'
/**
 * One-time bootstrap: create a 0G Compute ledger account and fund the
 * provider sub-account so executeVia0GCompute can settle inference calls.
 *
 * Without this, the broker errors with:
 *   "Sub-account not found. Initialize it by transferring funds via transfer-fund"
 *
 * Prereqs:
 *   - SEPOLIA_PRIVATE_KEY (or OG_COMPUTE_PRIVATE_KEY) in env. Same EVM key
 *     works on 0G Galileo (chain 16602).
 *   - Wallet funded with OG (faucet: https://faucet.0g.ai). 0.05 OG is plenty.
 *
 * Usage:
 *   pnpm tsx scripts/setup-0g-ledger.ts
 *   pnpm tsx scripts/setup-0g-ledger.ts 0xa48f01287233509FD694a22Bf840225062E67836
 *
 * If a provider address is passed, only that sub-account is funded. Default
 * funds the qwen-2.5-7b-instruct provider used by examples/infer-0g.
 */

import { createRequire } from 'module'
import { ethers } from 'ethers'

const _require = createRequire(import.meta.url)
const {
  createZGComputeNetworkBroker,
} = _require('@0glabs/0g-serving-broker') as typeof import('@0glabs/0g-serving-broker')

const OG_RPC = process.env.OG_RPC_URL ?? 'https://evmrpc-testnet.0g.ai'
const KEY = process.env.OG_COMPUTE_PRIVATE_KEY ?? process.env.SEPOLIA_PRIVATE_KEY ?? ''

const DEFAULT_PROVIDER = '0xa48f01287233509FD694a22Bf840225062E67836'
// Total deposit into the master ledger (OG, as a number per SDK signature).
// 0G Compute enforces a 3 OG minimum — smaller values are rejected.
const LEDGER_DEPOSIT = 3
// Per-provider sub-account allocation (wei-style bigint, 18 decimals).
const PROVIDER_FUND = ethers.parseEther('0.02')

if (!KEY) {
  console.error('Set SEPOLIA_PRIVATE_KEY or OG_COMPUTE_PRIVATE_KEY in .env')
  process.exit(1)
}

const targetProvider = process.argv[2] ?? DEFAULT_PROVIDER

;(async () => {
  const provider = new ethers.JsonRpcProvider(OG_RPC)
  const wallet = new ethers.Wallet(KEY, provider)

  console.log(`Wallet:    ${wallet.address}`)
  console.log(`Provider:  ${targetProvider}`)
  console.log(`RPC:       ${OG_RPC}`)
  console.log()

  const balance = await provider.getBalance(wallet.address)
  console.log(`OG balance: ${ethers.formatEther(balance)} OG`)
  // 3 OG ledger min + 0.02 OG sub-account + ~0.05 gas headroom
  if (balance < ethers.parseEther('3.1')) {
    console.error('Need at least ~3.1 OG. Hackathon faucet: https://0g-faucet-hackathon.vercel.app/ (promo: OPEN-AGENT)')
    process.exit(1)
  }

  const broker = await createZGComputeNetworkBroker(wallet)

  // Step 1: create the master ledger if it doesn't exist
  let hasLedger = false
  try {
    const ledger = await broker.ledger.getLedger()
    hasLedger = !!ledger
    console.log(`✓ Ledger already exists. Balance: ${ethers.formatEther(ledger.totalBalance ?? 0n)} OG`)
  } catch {
    hasLedger = false
  }

  if (!hasLedger) {
    console.log(`→ Creating ledger with ${LEDGER_DEPOSIT} OG deposit…`)
    await broker.ledger.addLedger(LEDGER_DEPOSIT)
    console.log('✓ Ledger created')
  }

  // Step 2: fund the provider sub-account
  console.log(`→ Funding sub-account for ${targetProvider} with ${ethers.formatEther(PROVIDER_FUND)} OG…`)
  await broker.ledger.transferFund(targetProvider, 'inference', PROVIDER_FUND)
  console.log('✓ Sub-account funded')

  console.log('\nDone. executeVia0GCompute should now succeed for this provider.')
})().catch((e) => {
  console.error('setup failed:', e.message ?? e)
  process.exit(1)
})
