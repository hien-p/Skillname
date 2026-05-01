/**
 * apps/keeperhub-paid — x402 payment gateway in front of KeeperHub
 *
 * Architecture:
 *   Bridge → POST /execute (no payment)
 *         ← 402 + payment requirements
 *   Bridge → sign EIP-3009 USDC → POST /execute with PAYMENT-SIGNATURE
 *         → validate via x402.org/facilitator
 *         → call KeeperHub execute_contract_call
 *         ← { txHash, explorerUrl }
 *
 * Env:
 *   PAY_TO_ADDRESS      wallet that receives USDC (required)
 *   KEEPERHUB_API_KEY   kh_... (required)
 *   PORT                default 3001
 */

import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { paymentMiddleware } from "@x402/hono";
import { x402ResourceServer } from "@x402/core/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = parseInt(process.env.PORT ?? "3001", 10);
const PAY_TO = process.env.PAY_TO_ADDRESS;
const KH_API_KEY = process.env.KEEPERHUB_API_KEY;

if (!PAY_TO) throw new Error("PAY_TO_ADDRESS env var not set");
if (!KH_API_KEY) throw new Error("KEEPERHUB_API_KEY env var not set");

// ── KeeperHub MCP client ──────────────────────────────────────────────────
let _kh: Client | null = null;

async function getKeeperHub(): Promise<Client> {
  if (_kh) return _kh;
  const client = new Client(
    { name: "keeperhub-paid", version: "0.0.1" },
    { capabilities: {} },
  );
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL("https://app.keeperhub.com/mcp"),
      {
        requestInit: { headers: { Authorization: `Bearer ${KH_API_KEY}` } },
      },
    ),
  );
  _kh = client;
  return client;
}

function khText(res: Awaited<ReturnType<Client["callTool"]>>): string {
  return (res.content as Array<{ type: string; text?: string }>)
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
}

// ── x402 resource server ──────────────────────────────────────────────────
// Testnet facilitator — no CDP key required
const facilitator = new HTTPFacilitatorClient({
  url: "https://x402.org/facilitator",
});
const resourceServer = new x402ResourceServer(facilitator).register(
  "eip155:84532",
  new ExactEvmScheme(),
);

// ── Hono app ──────────────────────────────────────────────────────────────
const app = new Hono();

const routes = {
  "/execute": {
    accepts: [
      {
        scheme: "exact" as const,
        price: "$0.05",
        network: "eip155:84532" as const,
        payTo: PAY_TO as `0x${string}`,
      },
    ],
    description: "Execute a smart contract call via KeeperHub",
    mimeType: "application/json",
  },
};

app.use("/execute", paymentMiddleware(routes, resourceServer));

app.post("/execute", async (c) => {
  const body = await c.req.json<{
    network: string;
    to?: string;
    amount?: string;
    token?: string;
    action?: string;
    // Legacy fields
    contract_address?: string;
    function_name?: string;
    function_args?: string;
  }>();

  try {
    const kh = await getKeeperHub();

    // Step 1: Get wallet integration ID
    const walletRes = khText(
      await kh.callTool({ name: "get_wallet_integration", arguments: {} }),
    );
    const walletMatch = walletRes.match(
      /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i,
    );
    if (!walletMatch)
      return c.json(
        { error: `No wallet integration found: ${walletRes.slice(0, 200)}` },
        500,
      );
    const walletId = walletMatch[0];

    // Step 2: Build action config
    const actionType = body.to ? "web3/transfer-funds" : "web3/write-contract";
    let actionConfig: Record<string, unknown>;

    if (body.to) {
      actionConfig = {
        actionType: "web3/transfer-funds",
        network: body.network,
        toAddress: body.to,
        amount: body.amount ?? "0",
        walletId,
      };
    } else {
      actionConfig = {
        actionType: "web3/write-contract",
        network: body.network,
        contractAddress: body.contract_address ?? "",
        functionName: body.function_name ?? "",
        walletId,
      };
    }

    // Step 3: Create one-shot workflow
    const createRes = khText(
      await kh.callTool({
        name: "create_workflow",
        arguments: {
          name: `skillname-paid-${Date.now()}`,
          description: "Auto-created by keeperhub-paid x402 server",
          nodes: [
            {
              id: "trigger-1",
              type: "trigger",
              data: {
                label: "Manual",
                type: "trigger",
                config: { triggerType: "Manual" },
                status: "idle",
              },
            },
            {
              id: "action-1",
              type: "action",
              data: {
                label: actionType,
                type: "action",
                config: actionConfig,
                status: "idle",
              },
            },
          ],
          edges: [{ id: "edge-1", source: "trigger-1", target: "action-1" }],
        },
      }),
    );

    const wfMatch = createRes.match(
      /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i,
    );
    if (!wfMatch)
      return c.json(
        { error: `Failed to create workflow: ${createRes.slice(0, 200)}` },
        500,
      );
    const workflowId = wfMatch[0];

    // Step 4: Execute workflow
    const execRes = khText(
      await kh.callTool({
        name: "execute_workflow",
        arguments: { workflowId },
      }),
    );
    const execMatch = execRes.match(
      /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i,
    );
    if (!execMatch)
      return c.json(
        { error: `Failed to execute workflow: ${execRes.slice(0, 200)}` },
        500,
      );
    const executionId = execMatch[0];

    // Step 5: Poll for completion
    const txHash = await pollExecution(kh, executionId);

    // Cleanup (best effort)
    kh.callTool({
      name: "delete_workflow",
      arguments: { workflowId, force: true },
    }).catch(() => {});

    return c.json({
      txHash,
      explorerUrl: `https://sepolia.basescan.org/tx/${txHash}`,
    });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

app.get("/health", (c) => c.json({ status: "ok", payTo: PAY_TO }));

// ── Poll execution status ─────────────────────────────────────────────────
async function pollExecution(kh: Client, executionId: string): Promise<string> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await sleep(3_000);
    const status = khText(
      await kh.callTool({
        name: "get_execution_status",
        arguments: { executionId },
      }),
    );
    if (status.toLowerCase().includes("complet")) {
      const match = status.match(/0x[a-fA-F0-9]{64}/);
      if (match) return match[0];
      const logs = khText(
        await kh.callTool({
          name: "get_execution_logs",
          arguments: { executionId },
        }),
      );
      const logMatch = logs.match(/0x[a-fA-F0-9]{64}/);
      if (logMatch) return logMatch[0];
      throw new Error("Completed but no tx hash found");
    }
    if (status.toLowerCase().includes("fail"))
      throw new Error(`Execution failed: ${status}`);
  }
  throw new Error("Execution timed out");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Start ─────────────────────────────────────────────────────────────────
serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`keeperhub-paid ready on :${PORT}`);
});
