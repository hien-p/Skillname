/**
 * @skillname/bridge
 *
 * MCP stdio server. Resolves an ENS name into one or more MCP tools and
 * registers them dynamically — "ENS as the import statement for AI."
 *
 * Configure in Claude Desktop:
 *   ~/Library/Application Support/Claude/claude_desktop_config.json
 *
 *   {
 *     "mcpServers": {
 *       "skillname": {
 *         "command": "npx",
 *         "args": ["-y", "@skillname/bridge"]
 *       }
 *     }
 *   }
 *
 * Then in Claude:
 *   "Use quote.uniswap.eth"
 *   → Bridge resolves the ENS name, fetches the manifest, registers its tool
 *   → Claude can immediately call it
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool as MCPTool,
} from '@modelcontextprotocol/sdk/types.js'
import { resolveSkill, type ResolveResult, type Tool } from '@skillname/sdk'

// -------------------------------------------------------------------------
// Structured stderr logging.
// MCP uses stdout for the wire protocol — every diagnostic must go to stderr.
// We prefix lines with arrows so the demo screen recording reads cleanly.
// -------------------------------------------------------------------------

const log = {
  in:   (msg: string) => process.stderr.write(`→ ${msg}\n`),
  out:  (msg: string) => process.stderr.write(`← ${msg}\n`),
  ok:   (msg: string) => process.stderr.write(`✓ ${msg}\n`),
  err:  (msg: string) => process.stderr.write(`✗ ${msg}\n`),
  info: (msg: string) => process.stderr.write(`· ${msg}\n`),
}

// -------------------------------------------------------------------------
// State
// -------------------------------------------------------------------------

interface ImportedSkill {
  ensName: string
  result: ResolveResult
  importedAt: number
}

const imported: Map<string, ImportedSkill> = new Map()

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 min

// -------------------------------------------------------------------------
// MCP server
// -------------------------------------------------------------------------

const server = new Server(
  { name: 'skillname', version: '0.0.1' },
  { capabilities: { tools: {} } }
)

// Built-in: skill_import — replaces the old manifest_load
const SKILL_IMPORT_TOOL: MCPTool = {
  name: 'skill_import',
  description:
    'Import a skill by ENS name. Resolves the name via ENS text records, fetches the bundle from IPFS, and registers its function(s) as MCP tools. Use this whenever the user mentions an ENS name like "import quote.uniswap.eth", "use swap.uniswap.eth", or "load skills from foo.eth".',
  inputSchema: {
    type: 'object',
    properties: {
      ensName: {
        type: 'string',
        description: 'ENS name to import, e.g. "quote.uniswap.eth" or "score.gitcoin.eth"',
      },
      chain: {
        type: 'string',
        enum: ['mainnet', 'sepolia'],
        default: 'sepolia',
        description: 'Chain to resolve ENS on (default: sepolia for hackathon)',
      },
    },
    required: ['ensName'],
  },
}

const SKILL_LIST_TOOL: MCPTool = {
  name: 'skill_list_imported',
  description:
    'List every skill currently imported and the function(s) it registered. Useful for confirming what is available before calling a tool.',
  inputSchema: { type: 'object', properties: {} },
}

// -------------------------------------------------------------------------
// Tool listing — built-ins + dynamically imported skills
// -------------------------------------------------------------------------

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const dynamicTools: MCPTool[] = []

  for (const [, s] of imported) {
    for (const t of s.result.bundle.tools) {
      dynamicTools.push({
        name: `${s.result.bundle.name}__${t.name}`,
        description: `[${s.ensName}] ${t.description}`,
        inputSchema: t.inputSchema as MCPTool['inputSchema'],
      })
    }
  }

  return {
    tools: [SKILL_IMPORT_TOOL, SKILL_LIST_TOOL, ...dynamicTools],
  }
})

// -------------------------------------------------------------------------
// Tool dispatch
// -------------------------------------------------------------------------

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name
  const args = req.params.arguments ?? {}

  // -- Built-in: import a skill --
  if (name === 'skill_import') {
    const ensName = args.ensName as string
    const chain = (args.chain as 'mainnet' | 'sepolia') ?? 'sepolia'
    const t0 = Date.now()
    log.in(`skill_import ${ensName} (${chain})`)

    try {
      const result = await resolveSkill(ensName, { chain })
      imported.set(ensName, { ensName, result, importedAt: Date.now() })

      const verified = result.ensip25?.bound ? '✓ verified' : 'unverified'
      const toolsList = result.bundle.tools
        .map((t) => `  · ${result.bundle.name}__${t.name}: ${t.description}`)
        .join('\n')

      const dt = Date.now() - t0
      log.ok(`imported ${ensName} (${verified}) in ${dt}ms`)
      log.info(`registered ${result.bundle.tools.length} tool(s) from ${result.cid.slice(0, 16)}…`)

      return {
        content: [
          {
            type: 'text',
            text:
              `Imported ${result.bundle.tools.length} tool(s) from ${ensName} (${verified})\n` +
              `Version: ${result.version ?? 'unspecified'}\n` +
              `CID: ${result.cid}\n\n` +
              `Tools:\n${toolsList}`,
          },
        ],
      }
    } catch (e: any) {
      log.err(`import ${ensName} failed: ${e.message}`)
      return {
        content: [{ type: 'text', text: `Failed to import ${ensName}: ${e.message}` }],
        isError: true,
      }
    }
  }

  // -- Built-in: list imported --
  if (name === 'skill_list_imported') {
    log.in('skill_list_imported')
    const lines: string[] = []
    for (const [ens, s] of imported) {
      const age = Math.floor((Date.now() - s.importedAt) / 1000)
      lines.push(`${ens} (v${s.result.version ?? '?'}, ${age}s ago):`)
      for (const t of s.result.bundle.tools) {
        lines.push(`  · ${s.result.bundle.name}__${t.name}`)
      }
    }
    return {
      content: [
        { type: 'text', text: lines.length ? lines.join('\n') : 'No skills imported yet. Use skill_import to bring one in.' },
      ],
    }
  }

  // -- Dynamic: dispatch by namespace --
  const sep = name.indexOf('__')
  if (sep === -1) {
    log.err(`unknown tool: ${name}`)
    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    }
  }

  const bundleName = name.slice(0, sep)
  const toolName = name.slice(sep + 2)
  log.in(`${name} (looking up ${bundleName}/${toolName})`)

  let skill: ImportedSkill | undefined
  for (const s of imported.values()) {
    if (s.result.bundle.name === bundleName) {
      skill = s
      break
    }
  }
  if (!skill) {
    log.err(`bundle "${bundleName}" not imported`)
    return {
      content: [
        { type: 'text', text: `Skill "${bundleName}" not imported. Use skill_import first.` },
      ],
      isError: true,
    }
  }

  const tool = skill.result.bundle.tools.find((t) => t.name === toolName)
  if (!tool) {
    log.err(`tool ${toolName} not in ${bundleName}`)
    return {
      content: [{ type: 'text', text: `Tool ${toolName} not in skill ${bundleName}` }],
      isError: true,
    }
  }

  return await executeRouted(tool, args, skill)
})

// -------------------------------------------------------------------------
// Execution router
// -------------------------------------------------------------------------

async function executeRouted(
  tool: Tool,
  args: Record<string, unknown>,
  skill: ImportedSkill
) {
  log.info(`exec.type = ${tool.execution.type}`)
  switch (tool.execution.type) {
    case 'local':
      return executeLocal(tool, args, skill)
    case 'keeperhub':
      return executeKeeperHub(tool, args, skill)
    case 'http':
      return executeHttp(tool, args, skill)
    default:
      log.err(`unsupported execution: ${(tool.execution as any).type}`)
      return {
        content: [
          { type: 'text', text: `Unsupported execution type: ${(tool.execution as any).type}` },
        ],
        isError: true,
      }
  }
}

async function executeLocal(tool: Tool, args: Record<string, unknown>, _skill: ImportedSkill) {
  // Hackathon stub: real impl loads handler from bundle and executes.
  return {
    content: [
      {
        type: 'text',
        text: `[stub] Local execution for ${tool.name} with args: ${JSON.stringify(args)}`,
      },
    ],
  }
}

async function executeKeeperHub(tool: Tool, args: Record<string, unknown>, _skill: ImportedSkill) {
  // Issue #13: route to KeeperHub MCP + handle x402 challenge.
  const exec = tool.execution as Extract<Tool['execution'], { type: 'keeperhub' }>

  if (exec.payment) {
    return {
      content: [
        {
          type: 'text',
          text: `[#13] Would call KeeperHub ${exec.tool ?? exec.workflowId} with x402 payment ${exec.payment.price} ${exec.payment.token} on ${exec.payment.network}. Args: ${JSON.stringify(args)}`,
        },
      ],
    }
  }

  return {
    content: [
      {
        type: 'text',
        text: `[#13 stub] Would call KeeperHub ${exec.tool ?? exec.workflowId}. Args: ${JSON.stringify(args)}`,
      },
    ],
  }
}

async function executeHttp(tool: Tool, args: Record<string, unknown>, _skill: ImportedSkill) {
  const exec = tool.execution as Extract<Tool['execution'], { type: 'http' }>
  const t0 = Date.now()
  log.out(`${exec.method ?? 'POST'} ${exec.endpoint}`)

  // For GET, send args as query string; for everything else, JSON body.
  let url = exec.endpoint
  let init: RequestInit = { method: exec.method ?? 'POST' }
  if ((exec.method ?? 'POST') === 'GET') {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(args)) {
      if (v !== undefined && v !== null) qs.set(k, String(v))
    }
    url += (url.includes('?') ? '&' : '?') + qs.toString()
  } else {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(args)
  }

  const res = await fetch(url, init)
  const text = await res.text()
  log.ok(`${res.status} in ${Date.now() - t0}ms`)
  return {
    content: [{ type: 'text', text }],
    isError: !res.ok,
  }
}

// -------------------------------------------------------------------------
// Boot
// -------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  log.ok('skillname bridge ready · stdio · MCP')
}

main().catch((e) => {
  log.err(`fatal: ${e.message ?? e}`)
  process.exit(1)
})
