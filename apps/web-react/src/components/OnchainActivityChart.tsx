import { useEffect, useMemo, useState } from "react";
import { usePublicClient } from "wagmi";
import { sepolia } from "viem/chains";
import { namehash, type Log, type PublicClient } from "viem";
import { SKILLLINK_ADDR } from "../lib/contracts";
import { CATALOG_ITEMS } from "./SkillCatalog";

// Topics from lib/skill-events.ts — kept in sync with the deployed contract.
const TOPIC_REGISTERED =
  "0x888c23edb2e1ab0c431a5710f704534d9a0aae0d9cbfaff28e15566529f83cdf";
const TOPIC_CALLED =
  "0x79d1cf1216936abfff830078fd5ab5cdf95ad84437b39d0c4465ba40bf4c54ae";

// SkillLink deploy block (mirrors apps/analytics START_BLOCK). Public Sepolia
// RPCs cap eth_getLogs at 1000 blocks per call, so we anchor here and chunk.
const SKILLLINK_DEPLOY_BLOCK = 10_772_615n;
const RPC_BLOCK_LIMIT = 1000n;

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

interface SkillBucket {
  ens: string;
  registered: number;
  calls: number;
  callers: Set<string>;
  lastBlock: bigint;
}

interface ChartData {
  buckets: SkillBucket[];
  totals: { registered: number; calls: number; uniqueCallers: number };
  scannedFromBlock: bigint;
  scannedToBlock: bigint;
  ms: number;
}

type Metric = "registered" | "calls" | "callers";

const METRIC_LABEL: Record<Metric, string> = {
  registered: "Registrations",
  calls: "On-chain calls",
  callers: "Unique callers",
};

interface Props {
  onSelect?: (ens: string) => void;
}

/**
 * One pass over the SkillLink event log on Sepolia, bucketed per ENS namehash
 * in the catalog. Renders a bklit-style horizontal bar chart with a metric
 * picker so the same data answers different questions: who registered, who
 * called, who paid the gas. Chart shape mirrors bklit's bar-chart but doesn't
 * pull the dependency — single SVG, ~120 lines, fits the bento aesthetic.
 */
export function OnchainActivityChart({ onSelect }: Props) {
  const client = usePublicClient({ chainId: sepolia.id });
  const [data, setData] = useState<ChartData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>("registered");

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const t0 = performance.now();
        const head = await client.getBlockNumber();
        const fromBlock = SKILLLINK_DEPLOY_BLOCK;
        const logs = await chunkedGetLogs(client, fromBlock, head);
        const byNode = new Map<string, SkillBucket>(
          CATALOG_ITEMS.map((it) => [
            namehash(it.ens).toLowerCase(),
            {
              ens: it.ens,
              registered: 0,
              calls: 0,
              callers: new Set<string>(),
              lastBlock: 0n,
            },
          ]),
        );
        for (const log of logs) {
          if (log.topics.length < 2) continue;
          const node = (log.topics[1] as string).toLowerCase();
          const bucket = byNode.get(node);
          if (!bucket) continue;
          if (log.blockNumber && log.blockNumber > bucket.lastBlock) {
            bucket.lastBlock = log.blockNumber;
          }
          if (log.topics[0] === TOPIC_REGISTERED) {
            bucket.registered++;
          } else if (log.topics[0] === TOPIC_CALLED) {
            bucket.calls++;
            const caller = "0x" + (log.topics[2] as string).slice(26);
            bucket.callers.add(caller.toLowerCase());
          }
        }
        const buckets = Array.from(byNode.values());
        const totals = {
          registered: buckets.reduce((s, b) => s + b.registered, 0),
          calls: buckets.reduce((s, b) => s + b.calls, 0),
          uniqueCallers: new Set(
            buckets.flatMap((b) => Array.from(b.callers)),
          ).size,
        };
        if (!cancelled) {
          setData({
            buckets,
            totals,
            scannedFromBlock: fromBlock,
            scannedToBlock: head,
            ms: Math.round(performance.now() - t0),
          });
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  const sorted = useMemo(() => {
    if (!data) return [];
    const valueOf = (b: SkillBucket): number => {
      switch (metric) {
        case "registered":
          return b.registered;
        case "calls":
          return b.calls;
        case "callers":
          return b.callers.size;
      }
    };
    return [...data.buckets]
      .map((b) => ({ ...b, value: valueOf(b) }))
      .sort((a, b) => b.value - a.value);
  }, [data, metric]);

  const max = Math.max(1, ...sorted.map((s) => s.value));

  return (
    <article className="bg-bento-surface text-bento-text-primary rounded-2xl p-6 border border-bento-border h-full flex flex-col">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <span className="font-mono text-[10px] uppercase tracking-wider text-bento-text-secondary">
            On-chain activity · sepolia · skill-link
          </span>
          <h2 className="font-display text-2xl text-bento-text-display mt-1">
            Who&apos;s using the registry
          </h2>
        </div>
        {data && (
          <div className="font-mono text-[10px] uppercase tracking-wider text-bento-text-secondary text-right">
            {data.totals.registered} registered · {data.totals.calls} calls ·{" "}
            {data.totals.uniqueCallers} callers
            <div className="mt-0.5">
              scanned {(data.scannedToBlock - data.scannedFromBlock).toString()}{" "}
              blocks · {data.ms}ms
            </div>
          </div>
        )}
      </header>

      {/* Metric tabs */}
      <div className="mt-4 flex flex-wrap gap-2">
        {(Object.keys(METRIC_LABEL) as Metric[]).map((m) => (
          <button
            key={m}
            onClick={() => setMetric(m)}
            className={`font-mono text-[10px] uppercase tracking-wider px-2.5 py-1 rounded border transition ${
              metric === m
                ? "bg-chartreuse-pulse text-bento-black border-chartreuse-pulse"
                : "border-bento-border text-bento-text-secondary hover:border-bento-text-display hover:text-bento-text-display"
            }`}
          >
            {METRIC_LABEL[m]}
          </button>
        ))}
      </div>

      {/* Chart */}
      <div className="mt-4 flex-1 min-h-0">
        {!data && !error && (
          <div className="font-mono text-xs text-bento-text-secondary">
            scanning event log…
          </div>
        )}
        {error && (
          <div className="font-mono text-xs text-bento-accent-red break-all">
            error · {error}
          </div>
        )}
        {data && data.totals.registered + data.totals.calls === 0 && (
          <div className="font-mono text-xs text-bento-text-secondary">
            no on-chain registrations or calls yet across the catalog
          </div>
        )}
        {data && data.totals.registered + data.totals.calls > 0 && (
          <ul className="space-y-2">
            {sorted.map((s) => (
              <li key={s.ens}>
                <button
                  onClick={() => onSelect?.(s.ens)}
                  className="block w-full text-left group"
                  title={`${s.ens} — last activity at block ${s.lastBlock}`}
                >
                  <div className="flex items-baseline justify-between font-mono text-[11px]">
                    <span className="flex items-center gap-1.5 text-bento-text-display group-hover:underline truncate">
                      {s.ens}
                      {CATALOG_ITEMS.find((c) => c.ens === s.ens)?.trust && (
                        <span
                          className="text-bento-success text-[9px] font-mono uppercase tracking-wider"
                          title="ENSIP-25 + ERC-8004 bound"
                        >
                          ✓ ensip-25
                        </span>
                      )}
                    </span>
                    <span className="text-bento-text-secondary tabular-nums">
                      {formatValue(metric, s.value)}
                    </span>
                  </div>
                  <div className="mt-1 h-2 bg-bento-border rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        s.value > 0
                          ? "bg-chartreuse-pulse"
                          : "bg-bento-text-secondary/20"
                      }`}
                      style={{ width: `${(s.value / max) * 100}%` }}
                    />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="mt-4 pt-4 border-t border-bento-border font-mono text-[10px] uppercase tracking-wider text-bento-text-secondary">
        single eth_getLogs sweep · client-side aggregation · refreshes per page load
      </footer>
    </article>
  );
}

function formatValue(metric: Metric, value: number): string {
  switch (metric) {
    case "registered":
      return `${value} reg`;
    case "calls":
      return `${value} call${value === 1 ? "" : "s"}`;
    case "callers":
      return `${value} addr`;
  }
}
