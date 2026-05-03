#!/usr/bin/env tsx
/**
 * Pin server — wraps the 0G storage Go CLI behind a tiny HTTP endpoint so the
 * publish overlay in apps/web-react can pin a manifest from the browser
 * without users having to drop into a terminal.
 *
 * The actual pin logic mirrors scripts/pin-to-0g.ts (which is what CI uses):
 * spawn `0g-storage-client upload`, parse the root from the merged stdout/
 * stderr, return it. Same code path the demo skills were pinned with —
 * judges are seeing the same Galileo testnet, same indexer, same root format.
 *
 * Usage:
 *   pnpm pin:server                # listen on :3030
 *   PIN_PORT=4000 pnpm pin:server  # custom port
 *
 * Endpoints:
 *   GET  /health        → { ok: true, cli, indexer }
 *   POST /pin           → { manifest, tools?, prompts? } → { root, ms, log }
 *
 * The browser POSTs the manifest JSON; the server materialises it under
 * a tmp dir, runs the CLI, returns the root. CORS is open for localhost:5173.
 */

import 'dotenv/config'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { serve } from '@hono/node-server'

const PORT = Number(process.env.PIN_PORT ?? 3030)
const OG_RPC = process.env.OG_RPC_URL ?? 'https://evmrpc-testnet.0g.ai'
const INDEXER_URL =
  process.env.OG_INDEXER_URL ?? 'https://indexer-storage-testnet-turbo.0g.ai'
const PRIVATE_KEY = process.env.SEPOLIA_PRIVATE_KEY
const CLI_DEFAULT = resolve('.vendor/0g-storage-client/0g-storage-client')
const CLI = process.env.OG_CLI_BIN ?? (existsSync(CLI_DEFAULT) ? CLI_DEFAULT : '0g-storage-client')

const ROOT_LINE_RX = /file uploaded(?:[^,]*,)?\s*roots?\s*=\s*([^\s]+)/i

if (!PRIVATE_KEY) {
  console.error(
    'SEPOLIA_PRIVATE_KEY env var not set — the pin server can boot but every /pin call will fail.',
  )
}

interface PinRequest {
  manifest: unknown
  tools?: Record<string, unknown>
  prompts?: Record<string, string>
  slug?: string
}

const app = new Hono()
app.use('*', logger())
app.use(
  '*',
  cors({
    origin: (origin) =>
      origin?.startsWith('http://localhost') || origin?.endsWith('.pages.dev')
        ? origin
        : 'http://localhost:5173',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    maxAge: 600,
  }),
)

app.get('/health', (c) =>
  c.json({
    ok: true,
    cli: CLI,
    indexer: INDEXER_URL,
    rpc: OG_RPC,
    keyConfigured: Boolean(PRIVATE_KEY),
  }),
)

app.post('/pin', async (c) => {
  if (!PRIVATE_KEY) {
    return c.json({ error: 'server missing SEPOLIA_PRIVATE_KEY' }, 500)
  }
  let body: PinRequest
  try {
    body = (await c.req.json()) as PinRequest
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400)
  }

  const { manifest, tools = {}, prompts = {}, slug = 'pin' } = body
  if (!manifest || typeof manifest !== 'object') {
    return c.json({ error: 'manifest must be an object' }, 400)
  }
  // Cheap sanity guard — full schema validation lives in the SDK / publish
  // overlay; here we only refuse obvious junk so the CLI doesn't waste a tx.
  const m = manifest as Record<string, unknown>
  if (typeof m.name !== 'string' || typeof m.ensName !== 'string') {
    return c.json({ error: 'manifest.name and manifest.ensName are required' }, 400)
  }

  const dir = mkdtempSync(join(tmpdir(), `skill-pin-${slug}-`))
  const manifestPath = join(dir, 'manifest.json')
  try {
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
    if (Object.keys(tools).length) {
      mkdirSync(join(dir, 'tools'), { recursive: true })
      for (const [name, content] of Object.entries(tools)) {
        writeFileSync(
          join(dir, 'tools', name.endsWith('.json') ? name : `${name}.json`),
          JSON.stringify(content, null, 2),
        )
      }
    }
    if (Object.keys(prompts).length) {
      mkdirSync(join(dir, 'prompts'), { recursive: true })
      for (const [name, body] of Object.entries(prompts)) {
        writeFileSync(
          join(dir, 'prompts', name.endsWith('.md') ? name : `${name}.md`),
          String(body),
        )
      }
    }

    const t0 = Date.now()
    const result = spawnSync(
      CLI,
      [
        'upload',
        '--url', OG_RPC,
        '--indexer', INDEXER_URL,
        '--key', PRIVATE_KEY,
        '--file', manifestPath,
      ],
      { encoding: 'utf8', timeout: 120_000 },
    )
    const ms = Date.now() - t0
    const stdout = result.stdout ?? ''
    const stderr = result.stderr ?? ''
    const log = (stdout + '\n' + stderr).trim()
    if (result.error || result.status !== 0) {
      return c.json(
        {
          error: `CLI exit ${result.status ?? '?'}${result.error ? ` (${result.error.message})` : ''}`,
          log,
          ms,
        },
        500,
      )
    }
    const match = log.match(ROOT_LINE_RX)
    if (!match) {
      return c.json({ error: 'no root in CLI output', log, ms }, 500)
    }
    const root = match[1].split(',')[0].trim()
    return c.json({
      root,
      ms,
      indexer: INDEXER_URL,
      rpc: OG_RPC,
      // last 30 lines of the CLI log so the UI can stream a "what just happened"
      // detail panel without dumping 500 lines of logrus into the page
      log: log.split('\n').slice(-30).join('\n'),
    })
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* tmpdir cleanup is best effort */
    }
  }
})

console.log(`pin-server  → http://localhost:${PORT}`)
console.log(`  CLI:      ${CLI}`)
console.log(`  Indexer:  ${INDEXER_URL}`)
console.log(`  RPC:      ${OG_RPC}`)
console.log(`  Key:      ${PRIVATE_KEY ? '✓ loaded' : '✗ missing'}`)
console.log()

serve({ fetch: app.fetch, port: PORT })
