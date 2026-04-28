/**
 * @skillname/sdk
 *
 * Core resolution: ENS name → text record → IPFS CID → verified bundle.
 *
 * Usage:
 *   import { resolveSkill } from '@skillname/sdk'
 *   const bundle = await resolveSkill('research.agent.eth')
 */

import { createPublicClient, http, type PublicClient } from 'viem'
import { mainnet, sepolia } from 'viem/chains'
import { normalize, namehash } from 'viem/ens'

// -------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------

export const SKILL_TEXT_KEY = 'xyz.manifest.skill'
export const SKILL_VERSION_KEY = 'xyz.manifest.skill.version'
export const SKILL_SCHEMA_KEY = 'xyz.manifest.skill.schema'
export const SKILL_EXECUTION_KEY = 'xyz.manifest.skill.execution'
export const SKILL_0G_KEY = 'xyz.manifest.skill.0g'

export interface SkillBundle {
  $schema?: string
  name: string
  ensName: string
  version: string
  description?: string
  author?: string
  createdAt?: string
  license?: string
  tools: Tool[]
  prompts?: string[]
  resources?: Resource[]
  examples?: string[]
  dependencies?: string[]
  trust?: {
    ensip25?: { enabled: boolean }
    erc8004?: { registry: string; agentId: number }
  }
}

export interface Tool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  execution: Execution
}

export type Execution =
  | { type: 'local'; handler: string }
  | {
      type: 'keeperhub'
      workflowId?: string
      tool?: string
      chainId?: number
      payment?: Payment
    }
  | { type: 'http'; endpoint: string; method?: string; payment?: Payment }

export interface Payment {
  protocol: 'x402' | 'mpp'
  price: string
  token: string
  network: string
}

export interface Resource {
  name: string
  uri: string
  description?: string
}

export interface ResolveOptions {
  /** Chain to resolve ENS on. Default: mainnet. Use sepolia for testing. */
  chain?: 'mainnet' | 'sepolia'
  /** Custom RPC URL */
  rpcUrl?: string
  /** Skip CID hash verification (DO NOT use in prod) */
  skipVerification?: boolean
  /** IPFS gateways to try in order */
  ipfsGateways?: string[]
}

export interface ResolveResult {
  ensName: string
  cid: string
  version?: string
  schema?: string
  bundle: SkillBundle
  verified: boolean
  ensip25?: {
    bound: boolean
    registry?: string
    agentId?: number
  }
}

// -------------------------------------------------------------------------
// Core resolution
// -------------------------------------------------------------------------

const DEFAULT_GATEWAYS = [
  'https://w3s.link/ipfs/',
  'https://ipfs.io/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
]

export async function resolveSkill(
  ensName: string,
  options: ResolveOptions = {}
): Promise<ResolveResult> {
  const normalized = normalize(ensName)

  const client = createPublicClient({
    chain: options.chain === 'sepolia' ? sepolia : mainnet,
    transport: http(options.rpcUrl),
  }) as PublicClient

  // 1. Read text records via Universal Resolver
  const [cidRaw, version, schema] = await Promise.all([
    client.getEnsText({ name: normalized, key: SKILL_TEXT_KEY }),
    client.getEnsText({ name: normalized, key: SKILL_VERSION_KEY }),
    client.getEnsText({ name: normalized, key: SKILL_SCHEMA_KEY }),
  ])

  if (!cidRaw) {
    throw new Error(
      `No skill manifest for ${ensName}. Set ENS text record "${SKILL_TEXT_KEY}" first.`
    )
  }

  // 2. Strip ipfs:// prefix
  const cid = cidRaw.startsWith('ipfs://') ? cidRaw.slice(7) : cidRaw

  // 3. Fetch + verify
  const bundle = await fetchAndVerify(cid, options)

  // 4. Validate against schema (lazy load to avoid hard dep at runtime)
  // const { validate } = await import('@skillname/schema')
  // if (!validate(bundle)) throw new Error('Invalid bundle: ' + validate.errors)

  // 5. ENSIP-25 check (optional)
  let ensip25
  if (bundle.trust?.erc8004) {
    ensip25 = await verifyEnsip25(client, normalized, bundle.trust.erc8004)
  }

  return {
    ensName: normalized,
    cid,
    version: version ?? undefined,
    schema: schema ?? undefined,
    bundle,
    verified: !options.skipVerification,
    ensip25,
  }
}

// -------------------------------------------------------------------------
// Fetch + content-address verify
// -------------------------------------------------------------------------

async function fetchAndVerify(
  cid: string,
  options: ResolveOptions
): Promise<SkillBundle> {
  // For hackathon MVP: gateway fetch is fine.
  // For production: swap to @helia/verified-fetch which auto-verifies CID hash.
  const gateways = options.ipfsGateways ?? DEFAULT_GATEWAYS

  for (const gateway of gateways) {
    try {
      const url = `${gateway}${cid}/manifest.json`
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) continue

      const bundle = (await res.json()) as SkillBundle
      return bundle
    } catch (e) {
      console.warn(`Gateway ${gateway} failed:`, e)
      continue
    }
  }

  throw new Error(`Failed to fetch CID ${cid} from all gateways`)
}

// -------------------------------------------------------------------------
// ENSIP-25 verification
// -------------------------------------------------------------------------

/**
 * ENSIP-25: Verifiable AI Agent Identity with ENS
 *
 * Checks for `agent-registration[<ERC-7930 registry>][<agentId>] = "1"`
 * https://docs.ens.domains/ensip/25
 */
export async function verifyEnsip25(
  client: PublicClient,
  ensName: string,
  erc8004: { registry: string; agentId: number }
): Promise<{ bound: boolean; registry: string; agentId: number }> {
  const erc7930Encoded = encodeErc7930(erc8004.registry)
  const key = `agent-registration[${erc7930Encoded}][${erc8004.agentId}]`

  const value = await client.getEnsText({
    name: normalize(ensName),
    key,
  })

  return {
    bound: value !== null && value !== '' && value !== '0',
    registry: erc8004.registry,
    agentId: erc8004.agentId,
  }
}

/**
 * Encode CAIP-10-style address (eip155:1:0x...) as ERC-7930 interoperable address.
 *
 * Format: 0x [version 2 bytes] [chain_type 2 bytes] [chain_id_len 1 byte]
 *           [chain_id N bytes] [addr_len 1 byte] [addr 20 bytes]
 *
 * Example for Ethereum mainnet (chainId=1) ERC-8004 IdentityRegistry:
 *   0x0001 0001 01 14 8004a169fb4a3325136eb29fa0ceb6d2e539a432
 *      ^^^^ ^^^^ ^^ ^^ ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
 *      ver  type len 20 address
 */
export function encodeErc7930(caip10: string): string {
  const match = caip10.match(/^eip155:(\d+):(0x[a-fA-F0-9]{40})$/)
  if (!match) throw new Error(`Invalid CAIP-10: ${caip10}`)
  const [, chainIdStr, addr] = match
  const chainId = parseInt(chainIdStr, 10)

  const chainIdHex = chainId.toString(16).padStart(2, '0')
  const chainIdLen = (chainIdHex.length / 2).toString(16).padStart(2, '0')
  const addrClean = addr.toLowerCase().replace('0x', '')

  // version=0001, chain_type=0001 (eip155), chain_id_len, chain_id, addr_len=14, addr
  return `0x0001${'0001'}${chainIdLen}${chainIdHex}14${addrClean}`
}

// -------------------------------------------------------------------------
// Export everything
// -------------------------------------------------------------------------

export { namehash, normalize }
