/**
 * KeeperHub MCP client.
 *
 * Bridge acts as a MCP client to KeeperHub's hosted server at
 * https://app.keeperhub.com/mcp, calling execute_contract_call directly.
 *
 * Flow:
 *   1. Connect with KEEPERHUB_API_KEY Bearer token
 *   2. Call execute_contract_call → returns executionId
 *   3. Poll get_direct_execution_status until completed | failed
 *   4. Extract txHash → return BaseScan link
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

const KH_MCP_URL = "https://app.keeperhub.com/mcp";
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 60_000;

const BASESCAN: Record<number, string> = {
  8453: "https://basescan.org/tx/",
  84532: "https://sepolia.basescan.org/tx/",
};

// ── Singleton client ───────────────────────────────────────────────────────
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

  // Paid path: route through keeperhub-paid x402 server
  if (exec.payment) {
    return executeViaPaidServer(tool, args, exec, chainId);
  }

  // Free path: call KeeperHub MCP directly
  const client = await getClient();

  // Route to the correct KeeperHub tool based on exec.tool
  const khTool = exec.tool ?? "execute_contract_call";

  if (khTool === "execute_transfer") {
    // Simple token transfer — different args shape
    const transferArgs: Record<string, string> = {
      network: String(chainId),
      to:
        (args.to as string) ??
        (args.recipient_address as string) ??
        (args.recipient as string) ??
        "",
      amount: (args.amount as string) ?? "",
      token: (args.token as string) ?? "USDC",
    };
    const res = await callTool(client, "execute_transfer", transferArgs);
    const idMatch =
      res.match(/"?(?:execution_?id|id)"?\s*[:\s]+([a-z0-9_-]{6,})/i) ??
      res.match(
        /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i,
      );
    if (!idMatch) return { text: res };
    const txHash = await pollExecution(client, idMatch[1]);
    const explorer = BASESCAN[chainId] ?? "https://sepolia.basescan.org/tx/";
    return {
      text: `✓ Transfer confirmed\nTx:       ${txHash}\nExplorer: ${explorer}${txHash}`,
    };
  }

  // Default: execute_contract_call
  const contractAddr =
    (args.contract_address as string) ??
    (args.contractAddress as string) ??
    (exec as any).contractAddress ??
    "";
  const callArgs: Record<string, string> = {
    network: String(chainId),
    contract_address: contractAddr,
    function_name: (exec as any).functionName ?? "",
    function_args: JSON.stringify(Object.values(args)),
  };

  if ((exec as any).abi) callArgs.abi = (exec as any).abi;

  // Call KeeperHub — returns execution ID for state-changing calls
  const res = await callTool(client, "execute_contract_call", callArgs);

  // View/pure functions return the result directly (no txHash)
  if (!res.toLowerCase().includes("execution")) {
    return { text: res };
  }

  // Extract execution ID and poll
  const idMatch =
    res.match(/"?(?:execution_?id|id)"?\s*[:\s]+([a-z0-9_-]{6,})/i) ??
    res.match(
      /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i,
    );
  if (!idMatch) {
    // No execution ID — treat raw response as result
    return { text: res };
  }

  const executionId = idMatch[1];
  const txHash = await pollExecution(client, executionId);
  const explorer = BASESCAN[chainId] ?? "https://sepolia.basescan.org/tx/";

  return {
    text:
      `✓ Transaction confirmed\n` +
      `Tx:       ${txHash}\n` +
      `Explorer: ${explorer}${txHash}`,
  };
}

// ── x402 paid path ─────────────────────────────────────────────────────────
async function executeViaPaidServer(
  tool: Tool,
  args: Record<string, unknown>,
  exec: Extract<Tool["execution"], { type: "keeperhub" }>,
  chainId: number,
): Promise<{ text: string; isError?: boolean }> {
  const fetchWithPayment = getX402Fetch();
  const explorer = BASESCAN[chainId] ?? "https://sepolia.basescan.org/tx/";

  const body: Record<string, string> = {
    network: String(chainId),
  };

  const khTool = exec.tool ?? "execute_contract_call";
  if (khTool === "execute_transfer") {
    body.to =
      (args.to as string) ??
      (args.recipient_address as string) ??
      (args.recipient as string) ??
      "";
    body.amount = (args.amount as string) ?? "";
    body.token = (args.token as string) ?? "USDC";
  } else {
    body.contract_address =
      (args.contract_address as string) ??
      (args.contractAddress as string) ??
      (exec as any).contractAddress ??
      "";
    body.function_name = (exec as any).functionName ?? "";
    body.function_args = JSON.stringify(Object.values(args));
  }

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
      text:
        `✓ Transaction confirmed (x402 paid)\n` +
        `Tx:       ${data.txHash}\n` +
        `Explorer: ${data.explorerUrl ?? explorer + data.txHash}`,
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

    const status = await callTool(client, "get_direct_execution_status", {
      execution_id: executionId,
    });

    if (status.toLowerCase().includes("complet")) {
      // Extract 0x... tx hash (64 hex chars)
      const txMatch = status.match(/0x[a-fA-F0-9]{64}/);
      if (txMatch) return txMatch[0];

      // If completed but no hash visible, fetch logs
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
