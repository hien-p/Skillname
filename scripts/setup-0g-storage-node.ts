#!/usr/bin/env tsx
import 'dotenv/config'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Bootstrap 0G Storage: upload a bundle manifest to 0G Galileo testnet.
 *
 * Usage:
 *   pnpm tsx scripts/setup-0g-storage-node.ts [path/to/manifest.json]
 *
 * Env:
 *   SEPOLIA_PRIVATE_KEY  — key to sign 0G transactions
 *   OG_RPC_URL          — 0G testnet RPC (default: https://evmrpc-testnet.0g.ai)
 */

const OG_RPC = process.env.OG_RPC_URL ?? 'https://evmrpc-testnet.0g.ai'
const PRIVATE_KEY = process.env.SEPOLIA_PRIVATE_KEY
const INDEXER = 'https://indexer-storage-testnet-turbo.0g.ai'
const ROOT = '/Users/huc/Documents/CodewithHUC'

if (!PRIVATE_KEY) { console.error('SEPOLIA_PRIVATE_KEY not set'); process.exit(1) }

function ensureClient() {
  const bin = join(ROOT, '0g-storage-client/0g-storage-client')
  if (existsSync(bin)) return
  console.log('[setup] Cloning 0g-storage-client...')
  spawn('git', ['clone', 'https://github.com/0glabs/0g-storage-client.git', join(ROOT, '0g-storage-client')], { stdio: 'inherit' }).wait()
  spawn('go', ['build', '-o', '0g-storage-client', '.'], { cwd: join(ROOT, '0g-storage-client'), stdio: 'inherit' }).wait()
  console.log('[setup] 0g-storage-client ready')
}

async function uploadBundle(manifestPath: string): Promise<string> {
  ensureClient()
  console.log(`[upload] ${manifestPath}\n`)

  let resolved = false
  return new Promise((resolve, reject) => {
    const p = spawn(join(ROOT, '0g-storage-client/0g-storage-client'), [
      'upload', '--url', OG_RPC, '--indexer', INDEXER,
      '--key', PRIVATE_KEY ?? '', '--file', manifestPath,
    ])

    let out = ''
    p.stdout.on('data', (d: Buffer) => { out += d; process.stdout.write(d) })
    p.stderr.on('data', (d: Buffer) => { out += d; process.stderr.write(d) })

    p.on('close', () => {
      const m = out.match(/0x[a-f0-9]{64}/i)
      if (m) { resolved = true; resolve(m[0]) }
    })

    process.stdin.on('data', (d) => {
      if (resolved) return
      const input = d.toString().trim()
      if (/^0x[a-f0-9]{64}$/i.test(input)) {
        resolved = true
        resolve(input)
      }
    })
  })
}

async function main() {
  const bundle = process.argv[2] ?? 'skillname-pack/examples/quote-uniswap/manifest.json'
  const root = await uploadBundle(bundle)
  console.log(`\n✅ Uploaded\nRoot: ${root}\nENS: xyz.manifest.skill.0g = ${root}`)
}
main().catch(e => { console.error(e); process.exit(1) })
