/**
 * E2E test for 0G Compute Network integration.
 *
 * Run locally:
 *   SEPOLIA_PRIVATE_KEY=0x... pnpm --filter @skillname/bridge e2e
 *
 * In CI: SEPOLIA_PRIVATE_KEY comes from GitHub secrets automatically.
 * No separate OG_COMPUTE_PRIVATE_KEY secret needed.
 */

import { listProviders, executeVia0GCompute } from './0gcompute.js'
import type { Tool } from '@skillname/sdk'

const PROVIDER = '0xa48f01287233509FD694a22Bf840225062E67836'
const MODEL = 'qwen/qwen-2.5-7b-instruct'
const PROMPT = 'Reply with exactly: 0G Compute OK'

const key = process.env.OG_COMPUTE_PRIVATE_KEY ?? process.env.SEPOLIA_PRIVATE_KEY ?? ''

let passed = 0
let failed = 0

function pass(label: string, detail = '') {
  console.log(`  PASS  ${label}${detail ? ': ' + detail : ''}`)
  passed++
}

function fail(label: string, detail = '') {
  console.error(`  FAIL  ${label}${detail ? ': ' + detail : ''}`)
  failed++
}

// ── 1. List providers (no key required) ──────────────────────────────────────
console.log('\n[1] listProviders (read-only)')
try {
  const providers = await listProviders()
  if (providers.length === 0) {
    fail('providers found', 'empty list — testnet may be down')
  } else {
    const target = providers.find(p => p.address.toLowerCase() === PROVIDER.toLowerCase())
    if (target) {
      pass('providers found', `${providers.length} provider(s), target confirmed`)
    } else {
      pass('providers found', `${providers.length} provider(s) — target not in list (may have rotated)`)
    }
  }
} catch (e: any) {
  fail('listProviders', e.message)
}

// ── 2. Execute inference (key required) ──────────────────────────────────────
console.log('\n[2] executeVia0GCompute (wallet required)')

if (!key) {
  fail('wallet configured', 'SEPOLIA_PRIVATE_KEY / OG_COMPUTE_PRIVATE_KEY not set — skip inference test')
} else {
  console.log(`  Using key: ${key.slice(0, 8)}...${key.slice(-4)}`)

  const fakeTool: Tool = {
    name: 'infer',
    description: 'e2e test tool',
    inputSchema: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] },
    execution: {
      type: '0g-compute',
      providerAddress: PROVIDER,
      model: MODEL,
      systemPrompt: 'You are a helpful assistant. Follow instructions exactly.',
    },
  }

  try {
    const result = await executeVia0GCompute(fakeTool, { prompt: PROMPT })

    if (result.isError) {
      fail('inference call', result.text)
    } else {
      pass('inference call', `provider=${result.provider.slice(0, 10)}..., model=${result.model}`)
      console.log(`  Response: "${result.text.trim().slice(0, 120)}"`)
    }
  } catch (e: any) {
    fail('inference call', e.message)
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
