import { useEffect, useMemo, useState } from "react";
import { usePublicClient } from "wagmi";
import { sepolia } from "viem/chains";
import { namehash, type Log, type PublicClient } from "viem";
import { SKILLLINK_ADDR } from "../lib/contracts";

// Bklit-style area chart for ONE skill.
// Reads SkillLink event logs filtered by namehash(ensName), buckets them
// across the scan window, and renders a gradient-filled area chart in
// hand-rolled SVG (matches the bento aesthetic, no @visx/* deps).
//
// Topics mirror lib/skill-events.ts — kept in sync with the deployed contract.
const TOPIC_REGISTERED =
  "0x888c23edb2e1ab0c431a5710f704534d9a0aae0d9cbfaff28e15566529f83cdf";
const TOPIC_CALLED =
  "0x79d1cf1216936abfff830078fd5ab5cdf95ad84437b39d0c4465ba40bf4c54ae";
const SKILLLINK_DEPLOY_BLOCK = 10_772_615n;
const RPC_BLOCK_LIMIT = 1000n;
const BUCKETS = 16;

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
      client.getLogs({ address: SKILLLINK_ADDR, fromBlock: r.from, toBlock: r.to }).catch(() => [] as Log[]),
    ),
  );
  return results.flat();
}

interface Bucket {
  blockRange: { from: bigint; to: bigint };
  registrations: number;
  calls: number;
}

interface ScanResult {
  buckets: Bucket[];
  totals: { registrations: number; calls: number };
  scannedFromBlock: bigint;
  scannedToBlock: bigint;
  ms: number;
}

interface Props {
  ensName: string;
}

export function SkillActivityChart({ ensName }: Props) {
  const client = usePublicClient({ chainId: sepolia.id });
  const [data, setData] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    setData(null);
    setError(null);
    (async () => {
      try {
        const t0 = performance.now();
        const head = await client.getBlockNumber();
        const fromBlock = SKILLLINK_DEPLOY_BLOCK;
        const target = namehash(ensName).toLowerCase();
        const logs = await chunkedGetLogs(client, fromBlock, head);

        const span = head - fromBlock + 1n;
        const bucketSize = span / BigInt(BUCKETS) || 1n;
        const buckets: Bucket[] = Array.from({ length: BUCKETS }, (_, i) => ({
          blockRange: {
            from: fromBlock + bucketSize * BigInt(i),
            to: i === BUCKETS - 1 ? head : fromBlock + bucketSize * BigInt(i + 1) - 1n,
          },
          registrations: 0,
          calls: 0,
        }));

        let registrations = 0;
        let calls = 0;
        for (const log of logs) {
          if (log.topics.length < 2) continue;
          if ((log.topics[1] as string).toLowerCase() !== target) continue;
          const block = log.blockNumber ?? 0n;
          const idx = Number((block - fromBlock) / bucketSize);
          const bucket = buckets[Math.min(BUCKETS - 1, Math.max(0, idx))];
          if (log.topics[0] === TOPIC_REGISTERED) {
            bucket.registrations++;
            registrations++;
          } else if (log.topics[0] === TOPIC_CALLED) {
            bucket.calls++;
            calls++;
          }
        }

        if (!cancelled) {
          setData({
            buckets,
            totals: { registrations, calls },
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
  }, [client, ensName]);

  return (
    <div className="border border-fog-border rounded p-5 bg-pure-surface">
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <span className="font-mono text-[10px] uppercase tracking-wider text-slate-ink">
            REGISTRY DISPATCH EVENTS · sepolia · SkillLink only
          </span>
          <h3 className="font-display text-xl text-midnight-navy mt-0.5">
            On-chain calls + registrations for <code className="font-mono text-base">{ensName}</code>
          </h3>
          <p className="text-[11px] text-slate-ink font-body mt-1 max-w-2xl">
            Counts <code className="font-mono">SkillCalled</code> events emitted by{" "}
            <code className="font-mono">SkillLink.call(node, calldata)</code> on Sepolia. Off-chain
            MCP calls (Claude Desktop → bridge → HTTP/0G/Keeperhub) don't appear here — only skills
            with <code className="font-mono">useRegistry: true</code> in their{" "}
            <code className="font-mono">contract</code> execution leave a trace. Today that's{" "}
            <code className="font-mono">agg.skilltest.eth</code> (try the homepage Run demo button).
          </p>
        </div>
        {data && (
          <div className="font-mono text-[10px] uppercase tracking-wider text-slate-ink text-right">
            <div>
              <span className="text-midnight-navy font-semibold">{data.totals.calls}</span> calls ·{" "}
              <span className="text-midnight-navy font-semibold">{data.totals.registrations}</span> registrations
            </div>
            <div className="mt-0.5 opacity-70">
              {(data.scannedToBlock - data.scannedFromBlock).toString()} blocks scanned · {data.ms}ms
            </div>
          </div>
        )}
      </header>

      <div className="mt-4">
        {!data && !error && (
          <div className="font-mono text-xs text-slate-ink py-12 text-center">scanning event log…</div>
        )}
        {error && (
          <div className="font-mono text-xs text-bento-accent-red break-all py-4">error · {error}</div>
        )}
        {data && (
          <AreaChart
            buckets={data.buckets}
            scannedFromBlock={data.scannedFromBlock}
            scannedToBlock={data.scannedToBlock}
          />
        )}
      </div>
    </div>
  );
}

interface AreaProps {
  buckets: Bucket[];
  scannedFromBlock: bigint;
  scannedToBlock: bigint;
}

function AreaChart({ buckets, scannedFromBlock, scannedToBlock }: AreaProps) {
  const W = 720;
  const H = 180;
  const PAD_L = 36;
  const PAD_R = 12;
  const PAD_T = 12;
  const PAD_B = 28;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const series = useMemo(() => buckets.map((b) => b.calls + b.registrations), [buckets]);
  const max = Math.max(1, ...series);
  const isEmpty = series.every((v) => v === 0);

  const points = series.map((v, i) => {
    const x = PAD_L + (innerW * i) / (series.length - 1 || 1);
    const y = PAD_T + innerH - (innerH * v) / max;
    return { x, y, v };
  });

  // Smooth Catmull-Rom → cubic Bézier conversion for a soft Bklit feel.
  function smoothPath(pts: { x: number; y: number }[]): string {
    if (pts.length === 0) return "";
    if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] ?? pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] ?? p2;
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
    }
    return d;
  }
  const linePath = smoothPath(points);
  const areaPath = `${linePath} L ${points[points.length - 1]?.x ?? PAD_L + innerW} ${PAD_T + innerH} L ${PAD_L} ${PAD_T + innerH} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="skill-area-grad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#1b2540" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#1b2540" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* gridlines */}
      {[0, 0.25, 0.5, 0.75, 1].map((p) => {
        const y = PAD_T + innerH * p;
        return (
          <line
            key={p}
            x1={PAD_L}
            y1={y}
            x2={W - PAD_R}
            y2={y}
            stroke="#b1b5c0"
            strokeOpacity={p === 1 ? 0.6 : 0.18}
            strokeDasharray={p === 0 || p === 1 ? "0" : "3 3"}
          />
        );
      })}

      {/* y axis labels */}
      {[0, 0.5, 1].map((p) => {
        const y = PAD_T + innerH - innerH * p;
        const v = Math.round(max * p);
        return (
          <text key={p} x={PAD_L - 6} y={y + 3} textAnchor="end" className="font-mono text-[9px] fill-slate-ink">
            {v}
          </text>
        );
      })}

      {/* area + line */}
      {!isEmpty && (
        <>
          <path d={areaPath} fill="url(#skill-area-grad)" />
          <path d={linePath} fill="none" stroke="#1b2540" strokeWidth="1.75" strokeLinejoin="round" />
          {points.map((p, i) =>
            p.v > 0 ? (
              <circle key={i} cx={p.x} cy={p.y} r="3" fill="#d0f100" stroke="#1b2540" strokeWidth="1" />
            ) : null,
          )}
        </>
      )}

      {/* x axis labels: from/to block */}
      <text x={PAD_L} y={H - 8} className="font-mono text-[9px] fill-slate-ink">
        block {scannedFromBlock.toString()}
      </text>
      <text x={W - PAD_R} y={H - 8} textAnchor="end" className="font-mono text-[9px] fill-slate-ink">
        {scannedToBlock.toString()}
      </text>

      {/* empty-state message */}
      {isEmpty && (
        <text
          x={W / 2}
          y={H / 2}
          textAnchor="middle"
          className="font-mono text-[12px] fill-slate-ink"
        >
          no on-chain interactions yet — try the catalog Run demo button
        </text>
      )}
    </svg>
  );
}
