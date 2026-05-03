/**
 * 0G Compute Network executor for @skillname/bridge
 *
 * Routes skill calls to 0G's decentralized AI inference network.
 * Uses @0glabs/0g-serving-broker to discover providers, authenticate
 * requests, and call OpenAI-compatible endpoints on 0G Compute.
 *
 * Env vars:
 *   OG_COMPUTE_PRIVATE_KEY  — EVM private key for the agent wallet on 0G chain
 *                             (needs a small amount of OG for ledger deposits)
 *                             Falls back to SEPOLIA_PRIVATE_KEY — same account,
 *                             same key works on both chains.
 *   OG_RPC_URL              — 0G chain RPC (default: https://evmrpc-testnet.0g.ai)
 *   OG_AUTO_INIT_LEDGER     — when "1", auto-create the ledger + fund the
 *                             provider sub-account on first call if missing.
 *                             Costs ~0.03 OG one-time. For controlled setup
 *                             use scripts/setup-0g-ledger.ts instead.
 *
 * NOTE: The @0glabs/0g-serving-broker ESM bundle (lib.esm) has a broken rollup
 * chunk on Node ≥24. We load via createRequire to force the CJS build instead.
 */

import { createRequire } from 'module'
import { ethers } from 'ethers'
import type { Tool } from '@skillname/sdk'

const _require = createRequire(import.meta.url)
const {
  createZGComputeNetworkBroker,
  createReadOnlyInferenceBroker,
} = _require('@0glabs/0g-serving-broker') as typeof import('@0glabs/0g-serving-broker')

const OG_RPC = process.env.OG_RPC_URL ?? 'https://evmrpc-testnet.0g.ai'
// SEPOLIA_PRIVATE_KEY is the same EVM account — works on 0G Galileo too.
// Use || not ?? so empty-string env values (e.g. .env line `OG_COMPUTE_PRIVATE_KEY=`)
// fall through to SEPOLIA_PRIVATE_KEY. ?? only falls through nullish; "" passes through.
const OG_COMPUTE_PRIVATE_KEY =
  process.env.OG_COMPUTE_PRIVATE_KEY || process.env.SEPOLIA_PRIVATE_KEY || ''
const OG_AUTO_INIT_LEDGER = process.env.OG_AUTO_INIT_LEDGER === '1'

// Match the broker's "Sub-account not found" / "Account does not exist" error.
const SUB_ACCOUNT_MISSING = /sub-account not found|account does not exist|transfer-fund/i

// Per-call init defaults (only used when OG_AUTO_INIT_LEDGER=1).
// 0G Compute requires a minimum 3 OG to create a ledger.
// Smaller deposits get rejected with: "Minimum balance to create a ledger is 3 0G"
const AUTO_LEDGER_DEPOSIT = 3 // OG, master ledger
const AUTO_PROVIDER_FUND_WEI = 20000000000000000n // 0.02 OG, sub-account

// Avoid hammering the broker if init already ran in this process.
const _initialized = new Set<string>()

async function ensureLedgerInitialized(
  broker: any,
  providerAddress: string,
): Promise<void> {
  const key = providerAddress.toLowerCase()
  if (_initialized.has(key)) return

  // 1) master ledger
  let hasLedger = false
  try {
    const ledger = await broker.ledger.getLedger()
    hasLedger = !!ledger
  } catch {
    hasLedger = false
  }
  if (!hasLedger) {
    await broker.ledger.addLedger(AUTO_LEDGER_DEPOSIT)
  }

  // 2) per-provider sub-account
  await broker.ledger.transferFund(providerAddress, 'inference', AUTO_PROVIDER_FUND_WEI)
  _initialized.add(key)
}

// Shared read-only broker — lists providers without wallet. Initialized once.
let _readonlyBroker: Awaited<ReturnType<typeof createReadOnlyInferenceBroker>> | null = null

async function getReadOnlyBroker() {
  if (!_readonlyBroker) {
    _readonlyBroker = await createReadOnlyInferenceBroker(OG_RPC)
  }
  return _readonlyBroker
}

export interface ComputeResult {
  text: string
  provider: string
  model: string
  isError?: boolean
}

/**
 * List available 0G Compute inference providers.
 * Read-only, no wallet required.
 */
export async function listProviders(): Promise<Array<{ address: string; model: string; url: string }>> {
  const broker = await getReadOnlyBroker()
  const services = await broker.listService()
  return services.map((s: any) => ({
    address: s.provider ?? s.providerAddress ?? '',
    model: s.model ?? s.modelName ?? '',
    url: s.url ?? s.endpoint ?? '',
  }))
}

/**
 * Execute a skill tool on 0G Compute Network.
 *
 * If OG_COMPUTE_PRIVATE_KEY (or SEPOLIA_PRIVATE_KEY) is set, uses the full
 * broker with payment. Otherwise returns a config-missing error.
 */
export async function executeVia0GCompute(
  tool: Tool,
  args: Record<string, unknown>
): Promise<ComputeResult> {
  const exec = tool.execution as Extract<Tool['execution'], { type: '0g-compute' }>
  const providerAddress = exec.providerAddress
  const model = exec.model ?? 'qwen/qwen-2.5-7b-instruct'
  const systemPrompt = exec.systemPrompt

  const userMessage = buildUserMessage(args)

  if (!OG_COMPUTE_PRIVATE_KEY) {
    return {
      text: `0G Compute not configured: set SEPOLIA_PRIVATE_KEY or OG_COMPUTE_PRIVATE_KEY to execute skills on 0G Compute Network (provider: ${providerAddress}, model: ${model})`,
      provider: providerAddress,
      model,
      isError: true,
    }
  }

  try {
    const provider = new ethers.JsonRpcProvider(OG_RPC)
    const wallet = new ethers.Wallet(OG_COMPUTE_PRIVATE_KEY, provider)
    const broker = await createZGComputeNetworkBroker(wallet)

    const { endpoint, model: resolvedModel } = await broker.inference.getServiceMetadata(providerAddress)

    // Try once; if the sub-account is missing and auto-init is enabled, init then retry.
    let headers: Awaited<ReturnType<typeof broker.inference.getRequestHeaders>>
    try {
      headers = await broker.inference.getRequestHeaders(providerAddress)
    } catch (e: any) {
      if (OG_AUTO_INIT_LEDGER && SUB_ACCOUNT_MISSING.test(e?.message ?? '')) {
        await ensureLedgerInitialized(broker, providerAddress)
        headers = await broker.inference.getRequestHeaders(providerAddress)
      } else {
        throw e
      }
    }

    const messages: Array<{ role: string; content: string }> = []
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
    messages.push({ role: 'user', content: userMessage })

    const res = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ model: resolvedModel ?? model, messages }),
    })

    if (!res.ok) {
      const err = await res.text()
      return { text: `0G Compute error ${res.status}: ${err}`, provider: providerAddress, model, isError: true }
    }

    const json = await res.json() as any
    const content = json.choices?.[0]?.message?.content ?? JSON.stringify(json)
    return { text: content, provider: providerAddress, model: resolvedModel ?? model }
  } catch (e: any) {
    const msg = e?.message ?? String(e)
    const hint = SUB_ACCOUNT_MISSING.test(msg) && !OG_AUTO_INIT_LEDGER
      ? ' (run scripts/setup-0g-ledger.ts once, or set OG_AUTO_INIT_LEDGER=1)'
      : ''
    return { text: `0G Compute execution failed: ${msg}${hint}`, provider: providerAddress, model, isError: true }
  }
}

function buildUserMessage(args: Record<string, unknown>): string {
  if (typeof args.prompt === 'string') return args.prompt
  if (typeof args.query === 'string') return args.query
  if (typeof args.message === 'string') return args.message
  return JSON.stringify(args)
}
