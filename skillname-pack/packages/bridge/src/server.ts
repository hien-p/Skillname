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

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool as MCPTool,
} from "@modelcontextprotocol/sdk/types.js";
import "dotenv/config";
import {
  resolveSkill,
  walkImports,
  type ResolveResult,
  type Tool,
} from "@skillname/sdk";
import {
  createPublicClient,
  createWalletClient,
  decodeFunctionResult,
  encodeFunctionData,
  getAbiItem,
  http,
  isAddress,
  namehash,
  type Abi,
  type AbiFunction,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  arbitrum,
  arbitrumSepolia,
  base,
  baseSepolia,
  holesky,
  mainnet,
  optimism,
  optimismSepolia,
  polygon,
  sepolia,
} from "viem/chains";
import { executeVia0GCompute, listProviders } from "./0gcompute.js";
import { executeViaKeeperHub } from "./keeperhub.js";

// -------------------------------------------------------------------------
// KeeperHub / x402 config — picked up at startup (Issue #13)
// -------------------------------------------------------------------------

const KEEPERHUB_API_KEY = process.env.KEEPERHUB_API_KEY ?? "";
const AGENT_WALLET_PRIVATE_KEY = process.env.AGENT_WALLET_PRIVATE_KEY ?? "";
const PAY_TO_ADDRESS = process.env.PAY_TO_ADDRESS ?? "";

// -------------------------------------------------------------------------
// Structured stderr logging.
// MCP uses stdout for the wire protocol — every diagnostic must go to stderr.
// We prefix lines with arrows so the demo screen recording reads cleanly.
// -------------------------------------------------------------------------

const log = {
  in: (msg: string) => process.stderr.write(`→ ${msg}\n`),
  out: (msg: string) => process.stderr.write(`← ${msg}\n`),
  ok: (msg: string) => process.stderr.write(`✓ ${msg}\n`),
  err: (msg: string) => process.stderr.write(`✗ ${msg}\n`),
  info: (msg: string) => process.stderr.write(`· ${msg}\n`),
};

// -------------------------------------------------------------------------
// State
// -------------------------------------------------------------------------

interface ImportedSkill {
  ensName: string;
  result: ResolveResult;
  importedAt: number;
}

const imported: Map<string, ImportedSkill> = new Map();

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

// -------------------------------------------------------------------------
// MCP server
// -------------------------------------------------------------------------

const server = new Server(
  { name: "skillname", version: "0.0.1" },
  // listChanged: true is critical — without it, MCP clients (Claude Desktop)
  // don't subscribe to tools/list_changed notifications and never see the
  // tools that skill_import dynamically registers. The handler already calls
  // server.sendToolListChanged() after each import; this declaration lets
  // the client know it should re-fetch tools/list when that fires.
  { capabilities: { tools: { listChanged: true } } },
);

// Built-in: skill_import — replaces the old manifest_load
const SKILL_IMPORT_TOOL: MCPTool = {
  name: "skill_import",
  description:
    'Import a skill by ENS name. Resolves the name via ENS text records, fetches the bundle from IPFS, and registers its function(s) as MCP tools. Use this whenever the user mentions an ENS name like "import quote.uniswap.eth", "use swap.uniswap.eth", or "load skills from foo.eth".',
  inputSchema: {
    type: "object",
    properties: {
      ensName: {
        type: "string",
        description:
          'ENS name to import, e.g. "quote.uniswap.eth" or "score.gitcoin.eth"',
      },
      chain: {
        type: "string",
        enum: ["mainnet", "sepolia"],
        default: "sepolia",
        description: "Chain to resolve ENS on (default: sepolia for hackathon)",
      },
    },
    required: ["ensName"],
  },
};

const SKILL_LIST_TOOL: MCPTool = {
  name: "skill_list_imported",
  description:
    "List every skill currently imported and the function(s) it registered. Useful for confirming what is available before calling a tool.",
  inputSchema: { type: "object", properties: {} },
};

const ZG_LIST_PROVIDERS_TOOL: MCPTool = {
  name: "zg_list_providers",
  description:
    "List available AI inference providers on 0G Compute Network. Returns provider addresses, models (e.g. qwen3.6-plus, GLM-5-FP8), and endpoints. Use to discover providers before importing a 0g-compute skill.",
  inputSchema: { type: "object", properties: {} },
};

const SKILL_CALL_TOOL: MCPTool = {
  name: "skill_call",
  description:
    'Call an imported skill tool by name. After importing a skill with skill_import, use this tool to execute any of its registered functions. For example, after importing quote.skilltest.eth, call skill_call with toolName "quote-uniswap__get_quote" and the appropriate arguments. ALWAYS use this tool to call imported skill functions — do not use tool_search.',
  inputSchema: {
    type: "object",
    properties: {
      toolName: {
        type: "string",
        description:
          'The full name of the imported tool to call, e.g. "quote-uniswap__get_quote" or "weather-tomorrow__forecast"',
      },
      arguments: {
        type: "object",
        description: "Arguments to pass to the tool, matching its inputSchema",
        additionalProperties: true,
      },
    },
    required: ["toolName", "arguments"],
  },
};

// -------------------------------------------------------------------------
// Tool listing — built-ins + dynamically imported skills
// -------------------------------------------------------------------------

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const dynamicTools: MCPTool[] = [];

  for (const [, s] of imported) {
    for (const t of s.result.bundle.tools) {
      dynamicTools.push({
        name: `${s.result.bundle.name}__${t.name}`,
        description: `[skill: ${s.ensName}] ${t.description} — Call this tool directly by name.`,
        inputSchema: t.inputSchema as MCPTool["inputSchema"],
      });
    }
  }

  return {
    tools: [
      SKILL_IMPORT_TOOL,
      SKILL_LIST_TOOL,
      SKILL_CALL_TOOL,
      ZG_LIST_PROVIDERS_TOOL,
      ...dynamicTools,
    ],
  };
});

// -------------------------------------------------------------------------
// Tool dispatch
// -------------------------------------------------------------------------

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const args = req.params.arguments ?? {};

  // -- Built-in: import a skill --
  if (name === "skill_import") {
    const ensName = args.ensName as string;
    const chain = (args.chain as "mainnet" | "sepolia") ?? "sepolia";
    const t0 = Date.now();
    log.in(`skill_import ${ensName} (${chain})`);

    try {
      // Walk the full dependency graph (breadth-first, max depth 5).
      // useLockfile defaults to true — if the root has a
      // xyz.manifest.skill.lockfile text record, transitive resolution is
      // pinned to the lockfile's CIDs (reproducible builds).
      const { root, flat, lockfile } = await walkImports(ensName, { chain });

      if (lockfile) {
        log.info(
          `lockfile in use: ${lockfile.entries.length} entries pinned (root ${ensName})`,
        );
      }

      // Register all resolved skills (root + transitive deps)
      for (const result of flat) {
        imported.set(result.ensName, {
          ensName: result.ensName,
          result,
          importedAt: Date.now(),
        });
      }

      // Notify client that tool list has changed so it re-fetches tools/list
      await server.sendToolListChanged();

      const rootResult = root.result;
      // Three trust states (don't conflate the second two):
      //   1. claim made + confirmed by ENS owner   → "✓ verified"
      //   2. claim made + ENS doesn't confirm it    → "✗ unverified — manifest claimed an identity the ENS owner didn't sign off on"
      //   3. no claim at all                        → "no identity binding (stateless skill)"
      // Previous wording lumped 2 + 3 as just "unverified", which alarmed
      // users on legitimate stateless skills like chainstats / basescan.
      const claimed = rootResult.bundle.trust?.erc8004 != null;
      const verified = claimed
        ? rootResult.ensip25?.bound
          ? "✓ verified"
          : "✗ unverified — manifest's identity claim NOT confirmed by ENS owner"
        : "no identity binding (stateless skill — fine for read-only tools)";
      const depCount = flat.length - 1;

      // Build tools list across all resolved skills
      const toolLines: string[] = [];
      for (const result of flat) {
        for (const t of result.bundle.tools) {
          toolLines.push(
            `  · ${result.bundle.name}__${t.name}: ${t.description}`,
          );
        }
      }

      const dt = Date.now() - t0;
      const totalTools = flat.reduce(
        (sum, r) => sum + r.bundle.tools.length,
        0,
      );
      log.ok(`imported ${ensName} (${verified}) in ${dt}ms`);
      log.info(`registered ${totalTools} tool(s) from ${flat.length} skill(s)`);
      if (depCount > 0) {
        log.info(
          `dependencies: ${flat
            .slice(1)
            .map((r) => r.ensName)
            .join(", ")}`,
        );
      }

      const depLine =
        depCount > 0
          ? `\nDependencies (${depCount}): ${flat
              .slice(1)
              .map((r) => r.ensName)
              .join(", ")}\n`
          : "";

      return {
        content: [
          {
            type: "text",
            text:
              `Imported ${totalTools} tool(s) from ${ensName} (${verified})\n` +
              `Version: ${rootResult.version ?? "unspecified"}\n` +
              `CID: ${rootResult.cid}\n` +
              depLine +
              `\nTools now available (call these directly by name):\n${toolLines.join("\n")}\n\n` +
              `IMPORTANT: These tools are now registered and ready to call. ` +
              `Use them directly by their full name (e.g. ${flat[0].bundle.name}__${flat[0].bundle.tools[0].name}). ` +
              `Do NOT use tool_search — call the tool directly.`,
          },
        ],
      };
    } catch (e: any) {
      log.err(`import ${ensName} failed: ${e.message}`);
      return {
        content: [
          { type: "text", text: `Failed to import ${ensName}: ${e.message}` },
        ],
        isError: true,
      };
    }
  }

  // -- Built-in: list imported --
  if (name === "skill_list_imported") {
    log.in("skill_list_imported");
    const lines: string[] = [];
    for (const [ens, s] of imported) {
      const age = Math.floor((Date.now() - s.importedAt) / 1000);
      lines.push(`${ens} (v${s.result.version ?? "?"}, ${age}s ago):`);
      for (const t of s.result.bundle.tools) {
        lines.push(`  · ${s.result.bundle.name}__${t.name}`);
      }
    }
    return {
      content: [
        {
          type: "text",
          text: lines.length
            ? lines.join("\n")
            : "No skills imported yet. Use skill_import to bring one in.",
        },
      ],
    };
  }

  // -- Built-in: call an imported skill tool --
  if (name === "skill_call") {
    const toolName = args.toolName as string;
    const toolArgs = (args.arguments as Record<string, unknown>) ?? {};
    log.in(`skill_call ${toolName}`);

    // Find the tool across all imported skills
    const sep = toolName.indexOf("__");
    if (sep === -1) {
      return {
        content: [
          {
            type: "text",
            text: `Invalid tool name "${toolName}". Expected format: <bundle>__<tool> (e.g. quote-uniswap__get_quote)`,
          },
        ],
        isError: true,
      };
    }

    const bundleName = toolName.slice(0, sep);
    const fnName = toolName.slice(sep + 2);

    let skill: ImportedSkill | undefined;
    for (const s of imported.values()) {
      if (s.result.bundle.name === bundleName) {
        skill = s;
        break;
      }
    }
    if (!skill) {
      return {
        content: [
          {
            type: "text",
            text: `Skill "${bundleName}" not imported. Use skill_import first.`,
          },
        ],
        isError: true,
      };
    }

    const tool = skill.result.bundle.tools.find((t) => t.name === fnName);
    if (!tool) {
      return {
        content: [
          {
            type: "text",
            text: `Tool "${fnName}" not found in skill "${bundleName}". Available: ${skill.result.bundle.tools.map((t) => t.name).join(", ")}`,
          },
        ],
        isError: true,
      };
    }

    return await executeRouted(tool, toolArgs, skill);
  }

  // -- Built-in: list 0G Compute providers --
  if (name === "zg_list_providers") {
    log.in("zg_list_providers");
    try {
      const providers = await listProviders();
      if (providers.length === 0) {
        return {
          content: [
            { type: "text", text: "No 0G Compute providers found on testnet." },
          ],
        };
      }
      const lines = providers.map(
        (p) =>
          `${p.address}  model: ${p.model || "(unknown)"}  url: ${p.url || "(unknown)"}`,
      );
      log.ok(`found ${providers.length} 0G Compute provider(s)`);
      return {
        content: [
          {
            type: "text",
            text: `0G Compute providers (${providers.length}):\n${lines.join("\n")}`,
          },
        ],
      };
    } catch (e: any) {
      log.err(`zg_list_providers failed: ${e.message}`);
      return {
        content: [
          { type: "text", text: `Failed to list providers: ${e.message}` },
        ],
        isError: true,
      };
    }
  }

  // -- Dynamic: dispatch by namespace --
  const sep = name.indexOf("__");
  if (sep === -1) {
    log.err(`unknown tool: ${name}`);
    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  const bundleName = name.slice(0, sep);
  const toolName = name.slice(sep + 2);
  log.in(`${name} (looking up ${bundleName}/${toolName})`);

  let skill: ImportedSkill | undefined;
  for (const s of imported.values()) {
    if (s.result.bundle.name === bundleName) {
      skill = s;
      break;
    }
  }
  if (!skill) {
    log.err(`bundle "${bundleName}" not imported`);
    return {
      content: [
        {
          type: "text",
          text: `Skill "${bundleName}" not imported. Use skill_import first.`,
        },
      ],
      isError: true,
    };
  }

  const tool = skill.result.bundle.tools.find((t) => t.name === toolName);
  if (!tool) {
    log.err(`tool ${toolName} not in ${bundleName}`);
    return {
      content: [
        { type: "text", text: `Tool ${toolName} not in skill ${bundleName}` },
      ],
      isError: true,
    };
  }

  return await executeRouted(tool, args, skill);
});

// -------------------------------------------------------------------------
// Execution router
// -------------------------------------------------------------------------

async function executeRouted(
  tool: Tool,
  args: Record<string, unknown>,
  skill: ImportedSkill,
) {
  log.info(`exec.type = ${tool.execution.type}`);
  switch (tool.execution.type) {
    case "local":
      return executeLocal(tool, args, skill);
    case "keeperhub":
      return executeKeeperHub(tool, args, skill);
    case "http":
      return executeHttp(tool, args, skill);
    case "0g-compute":
      return execute0GCompute(tool, args);
    case "contract":
      return executeContract(tool, args, skill);
    default:
      log.err(`unsupported execution: ${(tool.execution as any).type}`);
      return {
        content: [
          {
            type: "text",
            text: `Unsupported execution type: ${(tool.execution as any).type}`,
          },
        ],
        isError: true,
      };
  }
}

async function executeLocal(
  tool: Tool,
  args: Record<string, unknown>,
  _skill: ImportedSkill,
) {
  // Hackathon stub: real impl loads handler from bundle and executes.
  return {
    content: [
      {
        type: "text",
        text: `[stub] Local execution for ${tool.name} with args: ${JSON.stringify(args)}`,
      },
    ],
  };
}

async function executeKeeperHub(
  tool: Tool,
  args: Record<string, unknown>,
  _skill: ImportedSkill,
) {
  if (!KEEPERHUB_API_KEY) {
    log.err(`KEEPERHUB_API_KEY not set`);
    return {
      content: [
        {
          type: "text",
          text: `KeeperHub not configured. Set KEEPERHUB_API_KEY and restart the bridge.`,
        },
      ],
      isError: true,
    };
  }

  log.info(`keeperhub → ${tool.name}`);
  try {
    const result = await executeViaKeeperHub(tool, args);
    log.ok(`keeperhub done: ${result.text.split("\n")[1] ?? ""}`);
    return {
      content: [{ type: "text", text: result.text }],
      isError: result.isError,
    };
  } catch (e: any) {
    log.err(`keeperhub error: ${e.message}`);
    return {
      content: [
        { type: "text", text: `KeeperHub execution failed: ${e.message}` },
      ],
      isError: true,
    };
  }
}

async function executeHttp(
  tool: Tool,
  args: Record<string, unknown>,
  _skill: ImportedSkill,
) {
  const exec = tool.execution as Extract<Tool["execution"], { type: "http" }>;
  const t0 = Date.now();

  // Apply inputSchema defaults for any field the caller omitted. Without this,
  // Claude (or any MCP client) has to guess which optional fields the upstream
  // API actually requires — quote-uniswap__get_quote was failing 4xx because
  // CoinGecko needs vs_currencies even though the manifest schema marks it as
  // having default "usd". MCP doesn't auto-apply schema defaults; we do.
  const props = (tool.inputSchema as { properties?: Record<string, { default?: unknown }> } | undefined)?.properties ?? {};
  const merged: Record<string, unknown> = { ...args };
  for (const [k, v] of Object.entries(props)) {
    if (merged[k] === undefined && v && "default" in v) merged[k] = v.default;
  }

  log.out(`${exec.method ?? "POST"} ${exec.endpoint}`);

  // For GET, send args as query string; for everything else, JSON body.
  let url = exec.endpoint;
  let init: RequestInit = { method: exec.method ?? "POST" };
  if ((exec.method ?? "POST") === "GET") {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) {
      if (v !== undefined && v !== null) qs.set(k, String(v));
    }
    url += (url.includes("?") ? "&" : "?") + qs.toString();
  } else {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(merged);
  }

  const res = await fetch(url, init);
  const text = await res.text();
  log.ok(`${res.status} in ${Date.now() - t0}ms`);
  return {
    content: [{ type: "text", text }],
    isError: !res.ok,
  };
}

const CHAIN_BY_ID: Record<number, Chain> = {
  1: mainnet,
  10: optimism,
  137: polygon,
  8453: base,
  17000: holesky,
  42161: arbitrum,
  84532: baseSepolia,
  421614: arbitrumSepolia,
  11155111: sepolia,
  11155420: optimismSepolia,
};

const _publicClients = new Map<
  number,
  ReturnType<typeof createPublicClient>
>();
function getPublicClient(chainId: number) {
  let c = _publicClients.get(chainId);
  if (!c) {
    const chain = CHAIN_BY_ID[chainId];
    if (!chain) throw new Error(`unsupported chainId: ${chainId}`);
    c = createPublicClient({ chain, transport: http() });
    _publicClients.set(chainId, c);
  }
  return c;
}

function bigintSafeReplacer(_k: string, v: unknown) {
  return typeof v === "bigint" ? v.toString() : v;
}

// SkillLink registry — canonical deployments per chainId. Override per-tool
// via exec.registry on the manifest if you need a different one.
const SKILLLINK_BY_CHAIN: Record<number, `0x${string}`> = {
  // Sepolia: see contracts/script/Deploy.s.sol output. Update after redeploy
  // with the NameWrapper-aware version.
  11155111: "0x428865D8Dec9Bcc882c9e034DB4c81CBd93293A5",
};

const SKILLLINK_CALL_ABI = [
  {
    type: "function",
    name: "call",
    stateMutability: "payable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "result", type: "bytes" }],
  },
] as const;

async function resolveContractAddress(
  client: ReturnType<typeof getPublicClient>,
  addrOrEns: string,
): Promise<`0x${string}`> {
  if (isAddress(addrOrEns)) return addrOrEns as `0x${string}`;
  // ENS resolution always goes through mainnet, even when the call lands on L2.
  const mainnetClient = getPublicClient(1);
  const resolved = await mainnetClient.getEnsAddress({ name: addrOrEns });
  if (!resolved) throw new Error(`could not resolve ENS name: ${addrOrEns}`);
  return resolved;
}

function mapArgsViaAbi(
  abi: Abi,
  method: string,
  args: Record<string, unknown>,
  tool: Tool,
): unknown[] {
  let abiItem: ReturnType<typeof getAbiItem> | undefined;
  try {
    abiItem = getAbiItem({ abi, name: method });
  } catch {
    abiItem = undefined;
  }

  if (abiItem && abiItem.type === "function") {
    const fn = abiItem as AbiFunction;
    return fn.inputs.map((input, i) => {
      const key = input.name && input.name.length > 0 ? input.name : String(i);
      if (!(key in args)) {
        throw new Error(
          `missing argument "${key}" for ${method} (declared in ABI as inputs[${i}])`,
        );
      }
      return args[key];
    });
  }

  // Fallback for ABIs that don't surface the method as a function entry.
  const schemaProps =
    tool.inputSchema && typeof tool.inputSchema === "object"
      ? ((tool.inputSchema as { properties?: Record<string, unknown> })
          .properties ?? null)
      : null;
  const order = schemaProps ? Object.keys(schemaProps) : Object.keys(args);
  return order.map((k) => args[k]);
}

async function executeViaRegistry(
  client: ReturnType<typeof getPublicClient>,
  exec: Extract<Tool["execution"], { type: "contract" }>,
  callArgs: unknown[],
  mode: "read" | "write",
) {
  if (!exec.address.endsWith(".eth")) {
    log.err(`useRegistry: true requires .eth address, got ${exec.address}`);
    return {
      content: [
        {
          type: "text",
          text: `useRegistry: true requires exec.address to be an ENS name (.eth). Got "${exec.address}".`,
        },
      ],
      isError: true,
    };
  }

  const registryAddr =
    (exec.registry as `0x${string}` | undefined) ??
    SKILLLINK_BY_CHAIN[exec.chainId];
  if (!registryAddr) {
    log.err(`no SkillLink address known for chainId ${exec.chainId}`);
    return {
      content: [
        {
          type: "text",
          text: `No canonical SkillLink address for chainId ${exec.chainId}. Set exec.registry explicitly on the manifest.`,
        },
      ],
      isError: true,
    };
  }

  const node = namehash(exec.address);
  const innerCalldata = encodeFunctionData({
    abi: exec.abi as Abi,
    functionName: exec.method,
    args: callArgs,
  });

  log.info(
    `via SkillLink ${registryAddr} → node ${node.slice(0, 10)}… inner ${innerCalldata.slice(0, 10)}…`,
  );

  if (mode === "read") {
    const t0 = Date.now();
    const { result } = await client.simulateContract({
      address: registryAddr,
      abi: SKILLLINK_CALL_ABI,
      functionName: "call",
      args: [node, innerCalldata],
    });
    // SkillLink.call returns the raw bytes from the impl — decode against the
    // bundle's ABI so the user sees a typed result, not 0x-encoded bytes.
    const decoded = decodeFunctionResult({
      abi: exec.abi as Abi,
      functionName: exec.method,
      data: result as `0x${string}`,
    });
    log.ok(`registry.read ${exec.method} done in ${Date.now() - t0}ms`);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(decoded, bigintSafeReplacer, 2),
        },
      ],
    };
  }

  // write — signed via AGENT_WALLET_PRIVATE_KEY, fires SkillCalled event
  if (!AGENT_WALLET_PRIVATE_KEY) {
    log.err(`AGENT_WALLET_PRIVATE_KEY not set — cannot sign registry.write`);
    return {
      content: [
        {
          type: "text",
          text: `Cannot execute registry.write: AGENT_WALLET_PRIVATE_KEY not set in bridge env.`,
        },
      ],
      isError: true,
    };
  }
  const account = privateKeyToAccount(
    AGENT_WALLET_PRIVATE_KEY as `0x${string}`,
  );
  const chain = CHAIN_BY_ID[exec.chainId];
  const wallet = createWalletClient({ account, chain, transport: http() });
  const t0 = Date.now();
  const txHash = await wallet.writeContract({
    address: registryAddr,
    abi: SKILLLINK_CALL_ABI,
    functionName: "call",
    args: [node, innerCalldata],
    chain,
  });
  log.ok(
    `registry.write ${exec.method} → ${txHash} in ${Date.now() - t0}ms (SkillCalled event fires)`,
  );
  return {
    content: [
      {
        type: "text",
        text: `Transaction sent via SkillLink registry: ${txHash}`,
      },
    ],
  };
}

async function executeContract(
  tool: Tool,
  args: Record<string, unknown>,
  _skill: ImportedSkill,
) {
  const exec = tool.execution as Extract<
    Tool["execution"],
    { type: "contract" }
  >;
  const mode = exec.mode ?? "read";
  log.info(
    `contract.${mode} → eip155:${exec.chainId}:${exec.address}.${exec.method}`,
  );

  try {
    const client = getPublicClient(exec.chainId);

    // Map the named-args object onto positional args using the ABI as the
    // canonical source of order: read the matching AbiFunction's `inputs[].name`,
    // and look up each name in `args`. Falls back to inputSchema property order
    // for ABIs that lack the function entry (rare; e.g. proxy patterns where the
    // method dispatches through a fallback). Fails loud on missing args.
    const callArgs = mapArgsViaAbi(exec.abi as Abi, exec.method, args, tool);

    // ── Registry-routed dispatch (opt-in via useRegistry: true) ────────────
    // Goes through SkillLink.call(namehash(address), encodedCalldata) instead
    // of the direct impl. Adds the on-chain selector allowlist + SkillCalled
    // analytics event for paths that traverse a real tx (write mode).
    if (exec.useRegistry) {
      return await executeViaRegistry(client, exec, callArgs, mode);
    }

    const address = await resolveContractAddress(client, exec.address);

    if (mode === "read") {
      const t0 = Date.now();
      const result = await client.readContract({
        address,
        abi: exec.abi as Abi,
        functionName: exec.method,
        args: callArgs,
      });
      log.ok(`contract.read ${exec.method} done in ${Date.now() - t0}ms`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, bigintSafeReplacer, 2),
          },
        ],
      };
    }

    // mode === "write"
    if (exec.payment) {
      log.err(`contract.write with payment requires KeeperHub routing`);
      return {
        content: [
          {
            type: "text",
            text:
              `Paid contract.write is not yet wired for type:"contract". ` +
              `Use type:"keeperhub" with the same payment block until x402 routing lands here.`,
          },
        ],
        isError: true,
      };
    }
    if (!AGENT_WALLET_PRIVATE_KEY) {
      log.err(`AGENT_WALLET_PRIVATE_KEY not set — cannot sign contract.write`);
      return {
        content: [
          {
            type: "text",
            text: `Cannot execute contract.write: AGENT_WALLET_PRIVATE_KEY not set in bridge env.`,
          },
        ],
        isError: true,
      };
    }

    const account = privateKeyToAccount(
      AGENT_WALLET_PRIVATE_KEY as `0x${string}`,
    );
    const chain = CHAIN_BY_ID[exec.chainId];
    const wallet = createWalletClient({ account, chain, transport: http() });
    const t0 = Date.now();
    const txHash = await wallet.writeContract({
      address,
      abi: exec.abi as Abi,
      functionName: exec.method,
      args: callArgs,
      chain,
    });
    log.ok(`contract.write ${exec.method} → ${txHash} in ${Date.now() - t0}ms`);
    return {
      content: [{ type: "text", text: `Transaction sent: ${txHash}` }],
    };
  } catch (e: any) {
    const msg = e?.shortMessage ?? e?.message ?? String(e);
    log.err(`contract.${mode} failed: ${msg}`);
    return {
      content: [{ type: "text", text: `contract.${mode} failed: ${msg}` }],
      isError: true,
    };
  }
}

async function execute0GCompute(tool: Tool, args: Record<string, unknown>) {
  const exec = tool.execution as Extract<
    Tool["execution"],
    { type: "0g-compute" }
  >;
  log.info(
    `0G Compute → provider ${exec.providerAddress} model ${exec.model ?? "qwen3.6-plus"}`,
  );
  const result = await executeVia0GCompute(tool, args);
  log.ok(`0G Compute done (provider ${result.provider})`);
  return {
    content: [{ type: "text", text: result.text }],
    isError: result.isError,
  };
}

// -------------------------------------------------------------------------
// Boot
// -------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.ok("skillname bridge ready · stdio · MCP");
}

main().catch((e) => {
  log.err(`fatal: ${e.message ?? e}`);
  process.exit(1);
});
