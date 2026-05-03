import { decodeAbiParameters, namehash, parseAbiItem, type Log, type PublicClient } from "viem";
import { SKILLLINK_ADDR } from "./contracts";

// Block at which SkillLink was deployed. Mirrors apps/analytics START_BLOCK
// so we never scan further back than necessary — public Sepolia RPCs cap
// eth_getLogs at 1000 blocks per call, so unbounded sweeps fail outright.
const SKILLLINK_DEPLOY_BLOCK = 10_772_615n;
const RPC_BLOCK_LIMIT = 1000n;

// Confirmed signature on the deployed SkillLink (probed via eth_getLogs):
//   SkillRegistered(bytes32 node, address impl, address owner, bytes4[] selectors)
// First three fields are indexed; selectors lives in `data`.
const TOPIC_REGISTERED =
  "0x888c23edb2e1ab0c431a5710f704534d9a0aae0d9cbfaff28e15566529f83cdf" as const;

// Most-likely signature for the call event. Falling back gracefully if unmatched.
//   SkillCalled(bytes32 indexed node, address indexed caller, bytes4 selector, bool success)
const TOPIC_CALLED =
  "0x79d1cf1216936abfff830078fd5ab5cdf95ad84437b39d0c4465ba40bf4c54ae" as const;

const REGISTERED_EVENT = parseAbiItem(
  "event SkillRegistered(bytes32 indexed node, address indexed impl, address indexed owner, bytes4[] selectors)",
);

export type SkillEvent =
  | {
      kind: "registered";
      txHash: `0x${string}`;
      blockNumber: bigint;
      timestamp?: number; // unix seconds, populated lazily
      node: `0x${string}`;
      impl: `0x${string}`;
      owner: `0x${string}`;
      selectors: `0x${string}`[];
    }
  | {
      kind: "called";
      txHash: `0x${string}`;
      blockNumber: bigint;
      timestamp?: number;
      node: `0x${string}`;
      caller: `0x${string}`;
      selector: `0x${string}`;
      success: boolean;
    }
  | {
      kind: "unknown";
      txHash: `0x${string}`;
      blockNumber: bigint;
      timestamp?: number;
      topic0: `0x${string}`;
      topics: readonly `0x${string}`[];
      data: `0x${string}`;
    };

export interface SkillEventStream {
  events: SkillEvent[];
  totalsByKind: { registered: number; called: number; unknown: number };
  uniqueCallers: number;
  scannedFromBlock: bigint;
  scannedToBlock: bigint;
  ms: number;
}

/**
 * Public Sepolia RPCs (thirdweb, publicnode, etc.) cap eth_getLogs at 1000
 * blocks per request. Chunk the [from, to] range into 1000-block windows
 * and fan them out in parallel. Caps total chunks to avoid hammering an RPC
 * when fromBlock is wildly behind head.
 */
async function chunkedGetLogs(
  client: PublicClient,
  fromBlock: bigint,
  toBlock: bigint,
  maxChunks = 50,
): Promise<Log[]> {
  const ranges: { from: bigint; to: bigint }[] = [];
  for (let cur = fromBlock; cur <= toBlock; cur += RPC_BLOCK_LIMIT) {
    const end = cur + RPC_BLOCK_LIMIT - 1n;
    ranges.push({ from: cur, to: end > toBlock ? toBlock : end });
    if (ranges.length >= maxChunks) break;
  }
  const results = await Promise.all(
    ranges.map((r) =>
      client
        .getLogs({
          address: SKILLLINK_ADDR,
          fromBlock: r.from,
          toBlock: r.to,
        })
        .catch(() => [] as Log[]),
    ),
  );
  return results.flat();
}

/**
 * Fetch all SkillLink events for one ENS name. Reads raw logs filtered by
 * `topic[1] === namehash(ensName)` (both SkillRegistered and SkillCalled
 * have the namehash as their first indexed arg) so we don't need to know
 * the exact SkillCalled signature ahead of time.
 *
 * Scan starts at the SkillLink deploy block — public Sepolia RPCs cap
 * eth_getLogs at 1000 blocks per call, so we chunk and parallelize.
 */
export async function fetchSkillEvents(
  client: PublicClient,
  ensName: string,
): Promise<SkillEventStream> {
  const t0 = performance.now();
  const node = namehash(ensName) as `0x${string}`;
  const head = await client.getBlockNumber();
  const fromBlock = SKILLLINK_DEPLOY_BLOCK;

  const allLogs = await chunkedGetLogs(client, fromBlock, head);
  const logs = allLogs.filter(
    (l) => l.topics.length > 1 && (l.topics[1] as string).toLowerCase() === node.toLowerCase(),
  );

  const events: SkillEvent[] = [];
  const totalsByKind = { registered: 0, called: 0, unknown: 0 };
  const callers = new Set<string>();

  for (const log of logs) {
    const topic0 = log.topics[0] as `0x${string}` | undefined;
    const topics = log.topics.filter(Boolean) as `0x${string}`[];
    if (!topic0) continue;

    if (topic0 === TOPIC_REGISTERED) {
      try {
        const [selectors] = decodeAbiParameters(
          [{ type: "bytes4[]" }],
          log.data,
        ) as [`0x${string}`[]];
        events.push({
          kind: "registered",
          txHash: log.transactionHash!,
          blockNumber: log.blockNumber!,
          node: log.topics[1] as `0x${string}`,
          impl: ("0x" + (log.topics[2] as string).slice(26)) as `0x${string}`,
          owner: ("0x" + (log.topics[3] as string).slice(26)) as `0x${string}`,
          selectors,
        });
        totalsByKind.registered++;
      } catch {
        events.push({
          kind: "unknown",
          txHash: log.transactionHash!,
          blockNumber: log.blockNumber!,
          topic0,
          topics,
          data: log.data,
        });
        totalsByKind.unknown++;
      }
    } else if (topic0 === TOPIC_CALLED) {
      try {
        // SkillCalled(bytes32 indexed node, address indexed caller, bytes4 selector, bool success)
        const [selector, success] = decodeAbiParameters(
          [{ type: "bytes4" }, { type: "bool" }],
          log.data,
        ) as [`0x${string}`, boolean];
        const caller = ("0x" + (log.topics[2] as string).slice(26)) as `0x${string}`;
        events.push({
          kind: "called",
          txHash: log.transactionHash!,
          blockNumber: log.blockNumber!,
          node: log.topics[1] as `0x${string}`,
          caller,
          selector,
          success,
        });
        totalsByKind.called++;
        callers.add(caller.toLowerCase());
      } catch {
        events.push({
          kind: "unknown",
          txHash: log.transactionHash!,
          blockNumber: log.blockNumber!,
          topic0,
          topics,
          data: log.data,
        });
        totalsByKind.unknown++;
      }
    } else {
      events.push({
        kind: "unknown",
        txHash: log.transactionHash!,
        blockNumber: log.blockNumber!,
        topic0,
        topics,
        data: log.data,
      });
      totalsByKind.unknown++;
    }
  }

  // Sort newest first.
  events.sort((a, b) => Number(b.blockNumber - a.blockNumber));

  return {
    events,
    totalsByKind,
    uniqueCallers: callers.size,
    scannedFromBlock: fromBlock,
    scannedToBlock: head,
    ms: Math.round(performance.now() - t0),
  };
}

/**
 * Decode a 4-byte selector to a human-readable signature using the public
 * 4byte directory. Returns null if no match or network error. Cached in
 * memory for the page session.
 */
const fourByteCache = new Map<string, string | null>();

export async function decodeSelector(selector: `0x${string}`): Promise<string | null> {
  if (fourByteCache.has(selector)) return fourByteCache.get(selector)!;
  try {
    const r = await fetch(
      `https://www.4byte.directory/api/v1/signatures/?hex_signature=${selector}`,
      { cache: "force-cache" },
    );
    if (!r.ok) {
      fourByteCache.set(selector, null);
      return null;
    }
    const j = (await r.json()) as { results?: { text_signature: string }[] };
    const sig = j.results?.[0]?.text_signature ?? null;
    fourByteCache.set(selector, sig);
    return sig;
  } catch {
    fourByteCache.set(selector, null);
    return null;
  }
}

/** Markers used by REGISTERED_EVENT consumer in tests; exported to keep import live. */
export const _eventFragment = REGISTERED_EVENT;
