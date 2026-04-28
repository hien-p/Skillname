/**
 * @manifest-eth/bridge
 *
 * MCP stdio server that resolves ENS names into MCP tools dynamically.
 *
 * Configure in Claude Desktop:
 *   ~/Library/Application Support/Claude/claude_desktop_config.json
 *
 *   {
 *     "mcpServers": {
 *       "manifest-eth": {
 *         "command": "npx",
 *         "args": ["-y", "@manifest-eth/bridge"]
 *       }
 *     }
 *   }
 *
 * Then in Claude:
 *   "Use research.agent.eth"
 *   → Bridge resolves ENS, fetches bundle, registers tools
 *   → Claude can immediately call those tools
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool as MCPTool,
} from '@modelcontextprotocol/sdk/types.js'
import { resolveSkill, type ResolveResult, type Tool } from '@manifest-eth/sdk'

// -------------------------------------------------------------------------
// State
// -------------------------------------------------------------------------

interface LoadedBundle {
  ensName: string
  result: ResolveResult
  loadedAt: number
}

const loaded: Map<string, LoadedBundle> = new Map()

const CACHE_TTL_MS = 5 * 60 * 1000  // 5 min

// -------------------------------------------------------------------------
// MCP server
// -------------------------------------------------------------------------

const server = new Server(
  { name: 'manifest-eth', version: '0.0.1' },
  { capabilities: { tools: {} } }
)

// Built-in tool: load_manifest
const LOAD_MANIFEST_TOOL: MCPTool = {
  name: 'manifest_load',
  description:
    'Load MCP tools from an ENS name. Resolves the name via ENS text records, fetches the skill bundle from IPFS, and registers all its tools dynamically. Use this whenever the user mentions an ENS name like "use research.agent.eth" or "load tools from foo.eth".',
  inputSchema: {
    type: 'object',
    properties: {
      ensName: {
        type: 'string',
        description:
          'ENS name to resolve, e.g. "research.agent.eth" or "deepbook.eth"',
      },
      chain: {
        type: 'string',
        enum: ['mainnet', 'sepolia'],
        default: 'sepolia',
        description: 'Chain to resolve ENS on',
      },
    },
    required: ['ensName'],
  },
}

const MANIFEST_LIST_TOOL: MCPTool = {
  name: 'manifest_list_loaded',
  description:
    'List all currently loaded skill bundles and their tools. Useful for confirming what is available.',
  inputSchema: { type: 'object', properties: {} },
}

// -------------------------------------------------------------------------
// Tool listing — returns built-ins + dynamically loaded tools
// -------------------------------------------------------------------------

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const dynamicTools: MCPTool[] = []

  for (const [, b] of loaded) {
    for (const t of b.result.bundle.tools) {
      dynamicTools.push({
        name: `${b.result.bundle.name}__${t.name}`,
        description: `[${b.ensName}] ${t.description}`,
        inputSchema: t.inputSchema as MCPTool['inputSchema'],
      })
    }
  }

  return {
    tools: [LOAD_MANIFEST_TOOL, MANIFEST_LIST_TOOL, ...dynamicTools],
  }
})

// -------------------------------------------------------------------------
// Tool dispatch
// -------------------------------------------------------------------------

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name
  const args = req.params.arguments ?? {}

  // -- Built-in: load manifest --
  if (name === 'manifest_load') {
    const ensName = args.ensName as string
    const chain = (args.chain as 'mainnet' | 'sepolia') ?? 'sepolia'

    try {
      const result = await resolveSkill(ensName, { chain })
      loaded.set(ensName, { ensName, result, loadedAt: Date.now() })

      const verified = result.ensip25?.bound ? '✓ verified' : 'unverified'
      const toolsList = result.bundle.tools
        .map((t) => `  - ${result.bundle.name}__${t.name}: ${t.description}`)
        .join('\n')

      return {
        content: [
          {
            type: 'text',
            text:
              `Loaded ${result.bundle.tools.length} tools from ${ensName} (${verified})\n` +
              `Version: ${result.version ?? 'unspecified'}\n` +
              `CID: ${result.cid}\n\n` +
              `Available tools:\n${toolsList}`,
          },
        ],
      }
    } catch (e: any) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to load ${ensName}: ${e.message}`,
          },
        ],
        isError: true,
      }
    }
  }

  // -- Built-in: list --
  if (name === 'manifest_list_loaded') {
    const lines: string[] = []
    for (const [ens, b] of loaded) {
      lines.push(`${ens} (v${b.result.version ?? '?'}):`)
      for (const t of b.result.bundle.tools) {
        lines.push(`  - ${b.result.bundle.name}__${t.name}`)
      }
    }
    return {
      content: [
        {
          type: 'text',
          text: lines.length ? lines.join('\n') : 'No bundles loaded.',
        },
      ],
    }
  }

  // -- Dynamic: dispatch by namespace --
  const sep = name.indexOf('__')
  if (sep === -1) {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    }
  }

  const bundleName = name.slice(0, sep)
  const toolName = name.slice(sep + 2)

  // Find loaded bundle by name (not ENS)
  let bundle: LoadedBundle | undefined
  for (const b of loaded.values()) {
    if (b.result.bundle.name === bundleName) {
      bundle = b
      break
    }
  }
  if (!bundle) {
    return {
      content: [
        { type: 'text', text: `Bundle "${bundleName}" not loaded. Run manifest_load first.` },
      ],
      isError: true,
    }
  }

  const tool = bundle.result.bundle.tools.find((t) => t.name === toolName)
  if (!tool) {
    return {
      content: [{ type: 'text', text: `Tool ${toolName} not in bundle ${bundleName}` }],
      isError: true,
    }
  }

  // -- Route based on execution type --
  return await executeRouted(tool, args, bundle)
})

// -------------------------------------------------------------------------
// Execution router
// -------------------------------------------------------------------------

async function executeRouted(
  tool: Tool,
  args: Record<string, unknown>,
  bundle: LoadedBundle
) {
  switch (tool.execution.type) {
    case 'local':
      return executeLocal(tool, args, bundle)
    case 'keeperhub':
      return executeKeeperHub(tool, args, bundle)
    case 'http':
      return executeHttp(tool, args, bundle)
    default:
      return {
        content: [
          { type: 'text', text: `Unsupported execution type: ${(tool.execution as any).type}` },
        ],
        isError: true,
      }
  }
}

async function executeLocal(tool: Tool, args: Record<string, unknown>, _bundle: LoadedBundle) {
  // For hackathon: stub. Real impl loads handler from bundle and executes.
  return {
    content: [
      {
        type: 'text',
        text: `[stub] Local execution for ${tool.name} with args: ${JSON.stringify(args)}`,
      },
    ],
  }
}

async function executeKeeperHub(tool: Tool, args: Record<string, unknown>, _bundle: LoadedBundle) {
  // Day 8: route to KeeperHub MCP via HTTP
  // Day 9: handle x402 payment challenge if execution.payment present
  const exec = tool.execution as Extract<Tool['execution'], { type: 'keeperhub' }>

  if (exec.payment) {
    // TODO: implement x402 flow
    return {
      content: [
        {
          type: 'text',
          text: `[D9] Would call KeeperHub ${exec.tool ?? exec.workflowId} with x402 payment ${exec.payment.price} ${exec.payment.token} on ${exec.payment.network}. Args: ${JSON.stringify(args)}`,
        },
      ],
    }
  }

  // TODO: direct KeeperHub MCP call
  return {
    content: [
      {
        type: 'text',
        text: `[D8 stub] Would call KeeperHub ${exec.tool ?? exec.workflowId}. Args: ${JSON.stringify(args)}`,
      },
    ],
  }
}

async function executeHttp(tool: Tool, args: Record<string, unknown>, _bundle: LoadedBundle) {
  const exec = tool.execution as Extract<Tool['execution'], { type: 'http' }>
  const res = await fetch(exec.endpoint, {
    method: exec.method ?? 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const text = await res.text()
  return {
    content: [{ type: 'text', text: `HTTP ${res.status}: ${text}` }],
    isError: !res.ok,
  }
}

// -------------------------------------------------------------------------
// Boot
// -------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  // stderr only — stdout is reserved for MCP protocol
  console.error('manifest.eth bridge ready')
}

main().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})
