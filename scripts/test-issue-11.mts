#!/usr/bin/env tsx
// Test issue #11 — stdio MCP smoke test for the bridge.
//
// Spawns @skillname/bridge as a child, speaks raw MCP JSON-RPC over stdio,
// asserts the renamed built-in tools are present and the old ones are gone.
// Run from repo root: pnpm tsx scripts/test-issue-11.mts

import { spawn } from 'node:child_process'

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: unknown
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number
  result?: any
  error?: { code: number; message: string }
}

const c = {
  cyan:  (s: string) => `\x1b[36m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red:   (s: string) => `\x1b[31m${s}\x1b[0m`,
  dim:   (s: string) => `\x1b[2m${s}\x1b[0m`,
}

console.log(c.cyan('══ Issue #11 — bridge stdio MCP smoke test ══'))
console.log()

// Spawn the bridge via tsx so we don't require a build step.
const child = spawn('pnpm', ['--silent', 'tsx', 'skillname-pack/packages/bridge/src/server.ts'], {
  stdio: ['pipe', 'pipe', 'pipe'],
})

let stderrBuf = ''
child.stderr.on('data', (d) => {
  stderrBuf += d.toString()
})

// Read JSON-RPC responses from stdout, line-delimited.
const pending = new Map<number, (resp: JsonRpcResponse) => void>()
let stdoutBuf = ''
child.stdout.on('data', (d) => {
  stdoutBuf += d.toString()
  let nl: number
  while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
    const line = stdoutBuf.slice(0, nl).trim()
    stdoutBuf = stdoutBuf.slice(nl + 1)
    if (!line) continue
    try {
      const msg = JSON.parse(line) as JsonRpcResponse
      if (typeof msg.id === 'number' && pending.has(msg.id)) {
        pending.get(msg.id)!(msg)
        pending.delete(msg.id)
      }
    } catch {
      /* not a json-rpc line */
    }
  }
})

let nextId = 1
function rpc<T = any>(method: string, params?: unknown, timeoutMs = 5000): Promise<T> {
  const id = nextId++
  const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, params }
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`rpc ${method} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    pending.set(id, (resp) => {
      clearTimeout(t)
      if (resp.error) reject(new Error(`rpc ${method}: ${resp.error.message}`))
      else resolve(resp.result as T)
    })
    child.stdin.write(JSON.stringify(req) + '\n')
  })
}

let failures = 0
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`  ${c.green('✓')} ${label}`)
  } else {
    failures++
    console.log(`  ${c.red('✗')} ${label}${detail ? c.dim('  ' + detail) : ''}`)
  }
}

try {
  // 1. Initialize
  const init = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-issue-11', version: '0.0.1' },
  })
  check('initialize succeeds', !!init?.serverInfo, init?.serverInfo && `server=${init.serverInfo.name}`)
  check('server identifies as skillname', init?.serverInfo?.name === 'skillname')

  // 2. tools/list
  const list = await rpc<{ tools: Array<{ name: string; description: string }> }>('tools/list')
  const toolNames = list.tools.map((t) => t.name)
  check(`tools/list returns ${toolNames.length} tools`, toolNames.length >= 2, `[${toolNames.join(', ')}]`)
  check('skill_import is registered', toolNames.includes('skill_import'))
  check('skill_list_imported is registered', toolNames.includes('skill_list_imported'))
  check('old manifest_load is gone', !toolNames.includes('manifest_load'))
  check('old manifest_list_loaded is gone', !toolNames.includes('manifest_list_loaded'))

  // 3. skill_import description should mention "import" not "load manifest"
  const skillImport = list.tools.find((t) => t.name === 'skill_import')
  check(
    'skill_import description mentions "import"',
    !!skillImport && /import/i.test(skillImport.description),
  )

  // 4. Calling a non-existent tool returns a clean error, not a crash
  const callBad = await rpc<{ content: any[]; isError?: boolean }>('tools/call', {
    name: 'nonexistent_tool',
    arguments: {},
  })
  check('unknown tool returns isError', callBad.isError === true)

  // 5. Calling skill_import with a bogus name returns isError, not a crash
  const callBadEns = await rpc<{ content: any[]; isError?: boolean }>('tools/call', {
    name: 'skill_import',
    arguments: { ensName: 'this-name-does-not-exist-in-ens-anywhere.eth', chain: 'sepolia' },
  })
  check('skill_import on missing name returns isError', callBadEns.isError === true)
} catch (e: any) {
  failures++
  console.log(`  ${c.red('✗')} unhandled error: ${e.message}`)
} finally {
  child.kill()
}

console.log()
if (stderrBuf.trim()) {
  console.log(c.dim('--- bridge stderr (first 8 lines) ---'))
  for (const line of stderrBuf.trim().split('\n').slice(0, 8)) {
    console.log(c.dim('  ' + line))
  }
  console.log()
}

if (failures === 0) {
  console.log(c.green('All checks passed. Issue #11 (code) ready to merge.'))
  process.exit(0)
} else {
  console.log(c.red(`${failures} check(s) failed. Fix before opening the PR.`))
  process.exit(1)
}
