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
 *   OG_RPC_URL              — 0G chain RPC (default: https://evmrpc-testnet.0g.ai)
 */

import {
  createZGComputeNetworkBroker,
  createReadOnlyInferenceBroker,
} from '@0glabs/0g-serving-broker'
import { ethers } from 'ethers'
import type { Tool } from '@skillname/sdk'

const OG_RPC = process.env.OG_RPC_URL ?? 'https://evmrpc-testnet.0g.ai'
const OG_COMPUTE_PRIVATE_KEY = process.env.OG_COMPUTE_PRIVATE_KEY ?? ''

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
 * If OG_COMPUTE_PRIVATE_KEY is set, uses the full broker with payment.
 * Otherwise falls back to direct HTTP if a public endpoint is discoverable.
 */
export async function executeVia0GCompute(
  tool: Tool,
  args: Record<string, unknown>
): Promise<ComputeResult> {
  const exec = tool.execution as Extract<Tool['execution'], { type: '0g-compute' }>
  const providerAddress = exec.providerAddress
  const model = exec.model ?? 'qwen3.6-plus'
  const systemPrompt = exec.systemPrompt

  const userMessage = buildUserMessage(args)

  if (!OG_COMPUTE_PRIVATE_KEY) {
    return {
      text: `0G Compute not configured: set OG_COMPUTE_PRIVATE_KEY to execute skills on 0G Compute Network (provider: ${providerAddress}, model: ${model})`,
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
    const headers = await broker.inference.getRequestHeaders(providerAddress)

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
    return { text: `0G Compute execution failed: ${e.message}`, provider: providerAddress, model, isError: true }
  }
}

function buildUserMessage(args: Record<string, unknown>): string {
  if (typeof args.prompt === 'string') return args.prompt
  if (typeof args.query === 'string') return args.query
  if (typeof args.message === 'string') return args.message
  return JSON.stringify(args)
}
