/**
 * E2E test for the keeperhub-paid x402 payment gateway.
 *
 * Flow:
 *   1. Spawn `dist/index.js` as a subprocess on a free port
 *   2. Wait for /health
 *   3. POST /execute with wrapFetchWithPayment(fetch, x402Client)
 *      → server returns 402 with payment-required
 *      → client signs EIP-3009 USDC transferWithAuthorization on Base Sepolia
 *      → client retries with X-PAYMENT header
 *      → facilitator validates, server calls KeeperHub execute_contract_call
 *      → response carries txHash + BaseScan URL
 *   4. Assert the success branch; tear down.
 *
 * Run:
 *   AGENT_WALLET_PRIVATE_KEY=0x...   \
 *   PAY_TO_ADDRESS=0x...             \
 *   KEEPERHUB_API_KEY=kh_...         \
 *   pnpm --filter @skillname/keeperhub-paid e2e
 *
 * The wallet at AGENT_WALLET_PRIVATE_KEY must hold:
 *   - ≥ 5 USDC on Base Sepolia (asset 0x036CbD53842c5426634e7929541eC2318f3dCF7e)
 *   - ≥ 0.1 ETH on Base Sepolia for gas the facilitator submits
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'

import { wrapFetchWithPayment, x402Client } from '@x402/fetch'
import { ExactEvmScheme, toClientEvmSigner } from '@x402/evm'
import { privateKeyToAccount } from 'viem/accounts'
import { createPublicClient, http } from 'viem'
import { baseSepolia } from 'viem/chains'

const AGENT_KEY = process.env.AGENT_WALLET_PRIVATE_KEY as `0x${string}` | undefined
const PAY_TO = process.env.PAY_TO_ADDRESS as `0x${string}` | undefined
const KH_KEY = process.env.KEEPERHUB_API_KEY

// Base Sepolia: a known view-only contract call works without USDC depletion.
// We use a USDC `name()` view as the target — read-only, free at the protocol
// level, but the gateway still 402s us first because /execute is paywalled.
const TARGET_CONTRACT = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' // USDC on Base Sepolia
const TARGET_FN = 'name'
const NETWORK = '84532'

// ── helpers ───────────────────────────────────────────────────────────────

let pass = 0
let fail = 0
const log = {
  pass: (m: string, d = '') => { console.log(`  PASS  ${m}${d ? ': ' + d : ''}`); pass++ },
  fail: (m: string, d = '') => { console.error(`  FAIL  ${m}${d ? ': ' + d : ''}`); fail++ },
  info: (m: string) => console.log(`  ${m}`),
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer().listen(0, () => {
      const port = (s.address() as { port: number }).port
      s.close(() => resolve(port))
    })
    s.on('error', reject)
  })
}

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url)
      if (r.ok) return
    } catch { /* not ready yet */ }
    await sleep(150)
  }
  throw new Error(`server did not become ready at ${url}`)
}

function buildX402Fetch(privateKey: `0x${string}`) {
  const account = privateKeyToAccount(privateKey)
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http() })
  const signer = toClientEvmSigner(account, publicClient)
  const scheme = new ExactEvmScheme(signer)
  const client = new x402Client()
  client.register('eip155:84532', scheme)
  return wrapFetchWithPayment(fetch, client) as typeof fetch
}

// ── main ──────────────────────────────────────────────────────────────────

console.log('\n[keeperhub-paid] x402 e2e\n')

if (!AGENT_KEY) {
  log.fail('AGENT_WALLET_PRIVATE_KEY not set — cannot sign EIP-3009 authorization')
}
if (!PAY_TO) log.fail('PAY_TO_ADDRESS not set — server will refuse to start')
if (!KH_KEY) log.fail('KEEPERHUB_API_KEY not set — server will refuse to start')
if (fail > 0) process.exit(1)

const PORT = await freePort()
const URL_BASE = `http://localhost:${PORT}`
log.info(`Spawning keeperhub-paid on :${PORT}`)

const serverPath = join(import.meta.dirname, '..', 'dist', 'index.js')
const child: ChildProcess = spawn(process.execPath, [serverPath], {
  env: {
    ...process.env,
    PORT: String(PORT),
    PAY_TO_ADDRESS: PAY_TO!,
    KEEPERHUB_API_KEY: KH_KEY!,
  },
  stdio: ['ignore', 'inherit', 'inherit'],
})

const cleanup = () => { if (!child.killed) child.kill('SIGTERM') }
process.on('exit', cleanup)
process.on('SIGINT', () => { cleanup(); process.exit(130) })

try {
  // ── 1. health
  await waitFor(`${URL_BASE}/health`, 10_000)
  log.pass('server health')

  // ── 2. unauthenticated POST → expect 402
  const r402 = await fetch(`${URL_BASE}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contract_address: TARGET_CONTRACT, network: NETWORK, function_name: TARGET_FN }),
  })
  if (r402.status !== 402) {
    log.fail('challenge layer', `expected 402, got ${r402.status}`)
    process.exit(1)
  }
  const challenge = r402.headers.get('payment-required')
  if (!challenge) log.fail('challenge layer', 'no payment-required header')
  else log.pass('challenge layer', '402 with payment-required header')

  // ── 3. retry with wrapFetchWithPayment → x402 should sign + retry
  log.info('Signing EIP-3009 authorization + retrying via wrapFetchWithPayment…')
  const fetchWithPayment = buildX402Fetch(AGENT_KEY!)

  const t0 = Date.now()
  const r = await fetchWithPayment(`${URL_BASE}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contract_address: TARGET_CONTRACT, network: NETWORK, function_name: TARGET_FN }),
  })
  const dt = Date.now() - t0

  if (!r.ok) {
    const body = await r.text()
    log.fail('paid request', `${r.status} — ${body.slice(0, 200)}`)
    process.exit(1)
  }
  log.pass('paid request', `${r.status} in ${dt}ms`)

  // ── 4. assert response shape
  const body = (await r.json()) as { txHash?: string; explorerUrl?: string; result?: string; error?: string }
  if (body.error) {
    log.fail('response shape', body.error)
  } else if (body.txHash) {
    log.pass('response shape', `txHash=${body.txHash.slice(0, 12)}…`)
    if (body.explorerUrl?.includes('basescan.org')) log.pass('explorer URL', body.explorerUrl)
  } else if (body.result) {
    // view/pure call — KeeperHub returns inline, no tx
    log.pass('response shape', `result=${String(body.result).slice(0, 60)}…`)
  } else {
    log.fail('response shape', 'no txHash, no result, no error')
  }
} finally {
  cleanup()
}

console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed\n`)
process.exit(fail > 0 ? 1 : 0)
