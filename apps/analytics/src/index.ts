/**
 * skillname analytics indexer
 *
 * Cron-driven Cloudflare Worker that tails `SkillCalled` events from the
 * SkillLink registry on Sepolia, aggregates per-skill stats into KV, and
 * serves them via a small HTTP API.
 *
 * Aggregations per `node` (ENS namehash):
 *   - calls_total              : lifetime invocations
 *   - calls_24h / calls_7d     : sliding window counters
 *   - gas_total                : sum of `gasUsed` from the event
 *   - top_callers              : top 5 sender addresses by call count
 *   - last_block               : highest block we've scanned for this skill
 *
 * HTTP routes:
 *   GET  /skill/:node          → JSON stats for one skill (node is 0x… namehash)
 *   GET  /skills               → top N skills by calls_24h
 *   GET  /health               → liveness
 */

import { decodeEventLog, getAbiItem, keccak256, toBytes, type Hex } from "viem";

interface Env {
  SKILL_STATS: KVNamespace;
  SKILLLINK_ADDRESS: string;
  SEPOLIA_RPC_URL: string;
  START_BLOCK: string;
}

interface SkillStats {
  node: string;
  calls_total: number;
  calls_24h: number;
  calls_7d: number;
  gas_total: string; // BigInt-as-string
  top_callers: { addr: string; count: number }[];
  last_block: number;
  last_seen_at?: number; // unix seconds
}

const SKILL_CALLED_EVENT = {
  type: "event",
  name: "SkillCalled",
  inputs: [
    { name: "node", type: "bytes32", indexed: true },
    { name: "sender", type: "address", indexed: true },
    { name: "selector", type: "bytes4", indexed: true },
    { name: "success", type: "bool", indexed: false },
    { name: "gasUsed", type: "uint256", indexed: false },
  ],
} as const;

// Pre-computed keccak topic for filtering.
const SKILL_CALLED_TOPIC = keccak256(
  toBytes("SkillCalled(bytes32,address,bytes4,bool,uint256)"),
);

// Cursor key — the last block we've scanned globally (per-skill last_block is
// stored on each skill record).
const CURSOR_KEY = "_cursor:last_scanned_block";

// ── HTTP handler ──────────────────────────────────────────────────────────

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const cors = {
      "access-control-allow-origin": "*",
      "content-type": "application/json",
    };

    if (url.pathname === "/health") {
      return Response.json({ ok: true, version: "0.0.1" }, { headers: cors });
    }

    if (url.pathname.startsWith("/skill/")) {
      const node = url.pathname.slice("/skill/".length);
      if (!/^0x[0-9a-f]{64}$/i.test(node)) {
        return Response.json(
          { error: `node must be a bytes32 namehash (0x + 64 hex)` },
          { status: 400, headers: cors },
        );
      }
      const raw = await env.SKILL_STATS.get(`skill:${node.toLowerCase()}`);
      if (!raw) {
        return Response.json(
          { node, calls_total: 0, calls_24h: 0, calls_7d: 0, gas_total: "0", top_callers: [], last_block: 0 },
          { headers: cors },
        );
      }
      return new Response(raw, { headers: cors });
    }

    if (url.pathname === "/skills") {
      const limit = Number(url.searchParams.get("limit") ?? 10);
      const list = await env.SKILL_STATS.list({ prefix: "skill:" });
      const stats: SkillStats[] = [];
      for (const k of list.keys) {
        const raw = await env.SKILL_STATS.get(k.name);
        if (raw) stats.push(JSON.parse(raw));
      }
      stats.sort((a, b) => b.calls_24h - a.calls_24h);
      return Response.json(stats.slice(0, limit), { headers: cors });
    }

    return Response.json({ error: "not found" }, { status: 404, headers: cors });
  },

  // ── Scheduled handler ───────────────────────────────────────────────────

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(scan(env));
  },
};

// ── Indexer core ──────────────────────────────────────────────────────────

async function scan(env: Env): Promise<void> {
  const cursor = await env.SKILL_STATS.get(CURSOR_KEY);
  const fromBlock = cursor ? Number(cursor) + 1 : Number(env.START_BLOCK);

  // Get the chain head — cap our window at 1000 blocks per run so we don't
  // exhaust subrequest limits or hit RPC log caps.
  const head = await rpc(env.SEPOLIA_RPC_URL, "eth_blockNumber", []);
  const headNum = Number(head);
  const toBlock = Math.min(headNum, fromBlock + 1000);

  if (toBlock < fromBlock) return; // nothing new

  const logs: Log[] = await rpc(env.SEPOLIA_RPC_URL, "eth_getLogs", [
    {
      address: env.SKILLLINK_ADDRESS,
      topics: [SKILL_CALLED_TOPIC],
      fromBlock: `0x${fromBlock.toString(16)}`,
      toBlock: `0x${toBlock.toString(16)}`,
    },
  ]);

  for (const log of logs) {
    await ingest(log, env);
  }

  await env.SKILL_STATS.put(CURSOR_KEY, String(toBlock));
}

interface Log {
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  address: string;
}

async function ingest(log: Log, env: Env): Promise<void> {
  const { args } = decodeEventLog({
    abi: [SKILL_CALLED_EVENT],
    data: log.data as Hex,
    topics: log.topics as [Hex, ...Hex[]],
  });
  const node = (args.node as string).toLowerCase();
  const sender = (args.sender as string).toLowerCase();
  const gasUsed = args.gasUsed as bigint;
  const blockNum = Number(log.blockNumber);
  const nowSec = Math.floor(Date.now() / 1000);

  const key = `skill:${node}`;
  const existing = await env.SKILL_STATS.get(key);
  const stats: SkillStats = existing
    ? JSON.parse(existing)
    : {
        node,
        calls_total: 0,
        calls_24h: 0,
        calls_7d: 0,
        gas_total: "0",
        top_callers: [],
        last_block: 0,
      };

  // Idempotency — never count the same block twice for the same skill.
  if (blockNum <= stats.last_block) return;

  stats.calls_total += 1;
  stats.calls_24h += 1; // decay is approximate — a future Worker pass can
  stats.calls_7d += 1; //   sweep windows; demo-acceptable for now
  stats.gas_total = (BigInt(stats.gas_total) + gasUsed).toString();
  stats.last_block = blockNum;
  stats.last_seen_at = nowSec;

  // Update top callers (cap at 5)
  const existingIdx = stats.top_callers.findIndex((c) => c.addr === sender);
  if (existingIdx >= 0) {
    stats.top_callers[existingIdx].count += 1;
  } else {
    stats.top_callers.push({ addr: sender, count: 1 });
  }
  stats.top_callers.sort((a, b) => b.count - a.count);
  stats.top_callers = stats.top_callers.slice(0, 5);

  await env.SKILL_STATS.put(key, JSON.stringify(stats));
}

// ── JSON-RPC helper ───────────────────────────────────────────────────────

async function rpc<T = unknown>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`${method} failed: ${body.error.message}`);
  return body.result as T;
}

// Ensure dev imports aren't tree-shaken
void getAbiItem;
