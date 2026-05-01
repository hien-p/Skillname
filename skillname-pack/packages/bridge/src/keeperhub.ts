/**
 * KeeperHub MCP client — workflow-based execution.
 *
 * KeeperHub uses a workflow model:
 *   1. get_wallet_integration → walletId
 *   2. create_workflow with web3/transfer-funds or web3/write-contract action
 *   3. execute_workflow → executionId
 *   4. poll get_execution_status until completed | failed
 *   5. get_execution_logs → extract txHash
 *
 * Ref: https://docs.keeperhub.com/ai-tools/mcp-server
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import type { Tool } from "@skillname/sdk";

const KEEPERHUB_PAID_URL =
  process.env.KEEPERHUB_PAID_URL ?? "http://localhost:3001";
const KH_MCP_URL = "https://app.keeperhub.com/mcp";
const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 90_000;

const CHAIN_IDS: Record<number, string> = {
  1: "1",
  11155111: "11155111",
  8453: "8453",
  84532: "84532",
};

const EXPLORERS: Record<number, string> = {
  8453: "https://basescan.org/tx/",
  84532: "https://sepolia.basescan.org/tx/",
  11155111: "https://sepolia.etherscan.io/tx/",
  1: "https://etherscan.io/tx/",
};

// ── x402 client (lazy init) ───────────────────────────────────────────────
let _x402Fetch: typeof fetch | null = null;

function getX402Fetch(): typeof fetch {
  if (_x402Fetch) return _x402Fetch;
  const pk = process.env.AGENT_WALLET_PRIVATE_KEY as `0x${string}` | undefined;
  if (!pk)
    throw new Error(
      "AGENT_WALLET_PRIVATE_KEY not set — needed for paid skill calls",
    );
  const account = privateKeyToAccount(pk);
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(),
  });
  const signer = toClientEvmSigner(account, publicClient);
  const scheme = new ExactEvmScheme(signer);
  const client = new x402Client();
  client.register("eip155:84532", scheme);
  _x402Fetch = wrapFetchWithPayment(fetch, client) as typeof fetch;
  return _x402Fetch;
}

// ── Singleton MCP client ──────────────────────────────────────────────────
let _client: Client | null = null;

async function getClient(): Promise<Client> {
  if (_client) return _client;
  const apiKey = process.env.KEEPERHUB_API_KEY;
  if (!apiKey) throw new Error("KEEPERHUB_API_KEY env var not set");
  const client = new Client(
    { name: "skillname-bridge", version: "0.0.1" },
    { capabilities: {} },
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL(KH_MCP_URL), {
      requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
    }),
  );
  _client = client;
  return client;
}

// ── Cached wallet integration ID ──────────────────────────────────────────
let _walletId: string | null = null;

async function getWalletId(client: Client): Promise<string> {
  if (_walletId) return _walletId;
  const res = await callTool(client, "get_wallet_integration", {});
  // Response contains the wallet integration ID
  const match =
    res.match(
      /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i,
    ) ?? res.match(/"id"\s*:\s*"([^"]+)"/);
  if (!match)
    throw new Error(`Could not extract walletId from: ${res.slice(0, 200)}`);
  _walletId = match[0];
  return _walletId;
}

// ── Public entry point ─────────────────────────────────────────────────────
export async function executeViaKeeperHub(
  tool: Tool,
  args: Record<string, unknown>,
): Promise<{ text: string; isError?: boolean }> {
  const exec = tool.execution as Extract<
    Tool["execution"],
    { type: "keeperhub" }
  >;
  const chainId = exec.chainId ?? 84532;
  const network = CHAIN_IDS[chainId] ?? String(chainId);
  const explorer = EXPLORERS[chainId] ?? "https://sepolia.basescan.org/tx/";

  // Paid path: route through keeperhub-paid x402 server
  if (exec.payment) {
    return executeViaPaidServer(args, exec, chainId);
  }

  // Free path: call KeeperHub MCP directly via workflow
  const client = await getClient();
  const walletId = await getWalletId(client);
  const khAction = exec.tool ?? "web3/transfer-funds";

  // Resolve recipient from various arg names Claude might use
  const to =
    (args.to as string) ??
    (args.recipient_address as string) ??
    (args.recipient as string) ??
    (args.toAddress as string) ??
    "";

  // Build workflow action config based on KeeperHub action type
  let actionConfig: Record<string, unknown>;

  if (khAction === "execute_transfer" || khAction === "web3/transfer-funds") {
    actionConfig = {
      actionType: "web3/transfer-funds",
      network,
      toAddress: to,
      amount: (args.amount as string) ?? "0",
      walletId,
    };
  } else if (khAction === "web3/transfer-token") {
    actionConfig = {
      actionType: "web3/transfer-token",
      network,
      toAddress: to,
      tokenAddress:
        (args.tokenAddress as string) ?? (args.token_address as string) ?? "",
      amount: (args.amount as string) ?? "0",
      walletId,
    };
  } else if (
    khAction === "execute_contract_call" ||
    khAction === "web3/write-contract"
  ) {
    actionConfig = {
      actionType: "web3/write-contract",
      network,
      contractAddress:
        (args.contractAddress as string) ??
        (args.contract_address as string) ??
        "",
      functionName:
        (args.functionName as string) ?? (args.function_name as string) ?? "",
      walletId,
    };
  } else {
    // Generic: pass action type through
    actionConfig = { actionType: khAction, network, walletId, ...args };
  }

  // Create a one-shot workflow
  const workflowName = `skillname-${tool.name}-${Date.now()}`;
  const createRes = await callTool(client, "create_workflow", {
    name: workflowName,
    description: `Auto-created by skillname bridge for ${tool.name}`,
    nodes: [
      {
        id: "trigger-1",
        type: "trigger",
        data: {
          label: "Manual Trigger",
          type: "trigger",
          config: { triggerType: "Manual" },
          status: "idle",
        },
      },
      {
        id: "action-1",
        type: "action",
        data: {
          label: tool.name,
          description: tool.description,
          type: "action",
          config: actionConfig,
          status: "idle",
        },
      },
    ],
    edges: [{ id: "edge-1", source: "trigger-1", target: "action-1" }],
  });

  // Extract workflow ID
  const wfIdMatch = createRes.match(
    /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i,
  );
  if (!wfIdMatch) {
    return {
      text: `Failed to create workflow: ${createRes.slice(0, 300)}`,
      isError: true,
    };
  }
  const workflowId = wfIdMatch[0];

  // Execute the workflow
  const execRes = await callTool(client, "execute_workflow", { workflowId });
  const execIdMatch = execRes.match(
    /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i,
  );
  if (!execIdMatch) {
    return {
      text: `Failed to execute workflow: ${execRes.slice(0, 300)}`,
      isError: true,
    };
  }
  const executionId = execIdMatch[0];

  // Poll for completion
  const txHash = await pollExecution(client, executionId);

  // Clean up: delete the one-shot workflow (best effort)
  callTool(client, "delete_workflow", { workflowId, force: true }).catch(
    () => {},
  );

  return {
    text: `✓ Transaction confirmed\nTx:       ${txHash}\nExplorer: ${explorer}${txHash}`,
  };
}

// ── x402 paid path ─────────────────────────────────────────────────────────
async function executeViaPaidServer(
  args: Record<string, unknown>,
  exec: Extract<Tool["execution"], { type: "keeperhub" }>,
  chainId: number,
): Promise<{ text: string; isError?: boolean }> {
  const fetchWithPayment = getX402Fetch();
  const explorer = EXPLORERS[chainId] ?? "https://sepolia.basescan.org/tx/";

  const to =
    (args.to as string) ??
    (args.recipient_address as string) ??
    (args.recipient as string) ??
    (args.toAddress as string) ??
    "";

  const body = {
    network: String(chainId),
    to,
    amount: (args.amount as string) ?? "",
    token: (args.token as string) ?? "USDC",
    action: exec.tool ?? "web3/transfer-funds",
  };

  const res = await fetchWithPayment(`${KEEPERHUB_PAID_URL}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    return {
      text: `keeperhub-paid error ${res.status}: ${err}`,
      isError: true,
    };
  }

  const data = (await res.json()) as {
    txHash?: string;
    explorerUrl?: string;
    result?: string;
    error?: string;
  };
  if (data.error) return { text: data.error, isError: true };
  if (data.txHash) {
    return {
      text: `✓ Transaction confirmed (x402 paid)\nTx:       ${data.txHash}\nExplorer: ${data.explorerUrl ?? explorer + data.txHash}`,
    };
  }
  return { text: data.result ?? JSON.stringify(data) };
}

// ── Poll execution status ──────────────────────────────────────────────────
async function pollExecution(
  client: Client,
  executionId: string,
): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    const status = await callTool(client, "get_execution_status", {
      executionId,
    });

    if (status.toLowerCase().includes("complet")) {
      const txMatch = status.match(/0x[a-fA-F0-9]{64}/);
      if (txMatch) return txMatch[0];

      const logs = await callTool(client, "get_execution_logs", {
        executionId,
      });
      const logMatch = logs.match(/0x[a-fA-F0-9]{64}/);
      if (logMatch) return logMatch[0];

      throw new Error(
        `Execution completed but no tx hash found. Logs: ${logs.slice(0, 300)}`,
      );
    }

    if (status.toLowerCase().includes("fail")) {
      throw new Error(`KeeperHub execution failed: ${status.slice(0, 300)}`);
    }
  }

  throw new Error(
    `KeeperHub execution timed out after ${POLL_TIMEOUT_MS / 1000}s (id: ${executionId})`,
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────
async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const res = await client.callTool({ name, arguments: args });
  return (res.content as Array<{ type: string; text?: string }>)
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
