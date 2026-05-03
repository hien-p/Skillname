import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { sepolia } from "viem/chains";
import { namehash } from "viem";
import { CATALOG_ITEMS } from "./SkillCatalog";

const RESOLVER_ADDR = "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5" as const;
const RESOLVER_ABI = [
  {
    name: "text",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
    ],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

const OG_INDEXER_URL = "https://indexer-storage-testnet-turbo.0g.ai";

interface PinnedSkill {
  ens: string;
  root: string | null;
  bytes: number | null;
  fetchMs: number | null;
}

export function OGStorageCard() {
  const publicClient = usePublicClient({ chainId: sepolia.id });
  const [items, setItems] = useState<PinnedSkill[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!publicClient) return;
    let cancelled = false;
    setLoading(true);
    Promise.all(
      CATALOG_ITEMS.map(async (it): Promise<PinnedSkill> => {
        const node = namehash(it.ens);
        try {
          const uri = (await publicClient.readContract({
            address: RESOLVER_ADDR,
            abi: RESOLVER_ABI,
            functionName: "text",
            args: [node, "xyz.manifest.skill"],
          })) as string;
          if (!uri || !uri.startsWith("0g://")) {
            return { ens: it.ens, root: null, bytes: null, fetchMs: null };
          }
          const root = uri.slice(5);
          // Probe the indexer for the manifest size — single round-trip per
          // skill, parallel across the catalog. We don't parse the body.
          const t0 = performance.now();
          const r = await fetch(`${OG_INDEXER_URL}/file?root=${root}`).catch(
            () => null,
          );
          const fetchMs = Math.round(performance.now() - t0);
          let bytes: number | null = null;
          if (r?.ok) {
            const text = await r.text().catch(() => "");
            bytes = text.length;
          }
          return { ens: it.ens, root, bytes, fetchMs };
        } catch {
          return { ens: it.ens, root: null, bytes: null, fetchMs: null };
        }
      }),
    )
      .then((res) => !cancelled && setItems(res))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [publicClient]);

  const pinned = items.filter((i) => i.root);
  const totalBytes = pinned.reduce((s, i) => s + (i.bytes ?? 0), 0);
  const avgMs = pinned.filter((i) => i.fetchMs).length
    ? Math.round(
        pinned.reduce((s, i) => s + (i.fetchMs ?? 0), 0) /
          pinned.filter((i) => i.fetchMs).length,
      )
    : null;

  return (
    <article className="bg-bento-surface text-bento-text-primary rounded-2xl p-6 border border-bento-border h-full flex flex-col">
      <div className="flex items-start justify-between">
        <div>
          <span className="font-mono text-[10px] uppercase tracking-wider text-bento-text-secondary">
            0G Galileo storage
          </span>
          <div className="mt-1 font-mono text-xs text-bento-text-display">
            indexer-storage-testnet-turbo.0g.ai ↗
          </div>
        </div>
        <span
          className="font-mono text-[10px] uppercase tracking-wider text-chartreuse-pulse"
          title="Storage layer for every manifest in the catalog"
        >
          ● live
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-4 flex-1">
        <Stat
          label="manifests pinned"
          value={loading ? "—" : String(pinned.length).padStart(2, "0")}
          sub={loading ? "scanning…" : `of ${items.length} catalog`}
        />
        <Stat
          label="total bytes"
          value={loading ? "—" : formatBytes(totalBytes)}
          sub="across catalog"
        />
        <Stat
          label="avg fetch"
          value={loading ? "—" : avgMs !== null ? `${avgMs}ms` : "—"}
          sub="from indexer"
        />
      </div>

      <div className="mt-4 pt-4 border-t border-bento-border font-mono text-[10px] uppercase tracking-wider text-bento-text-secondary">
        every <code className="text-bento-text-display normal-case">resolveSkill()</code>{" "}
        fetches the manifest off 0G — no IPFS gateway in the hot path.
      </div>
    </article>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-col">
      <span className="font-mono text-[10px] uppercase tracking-wider text-bento-text-secondary">
        {label}
      </span>
      <span className="font-doto text-3xl text-bento-text-display mt-1">
        {value}
      </span>
      {sub && (
        <span className="font-mono text-[10px] uppercase tracking-wider text-bento-text-secondary mt-auto pt-1">
          {sub}
        </span>
      )}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}b`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}kb`;
  return `${(n / 1024 / 1024).toFixed(1)}mb`;
}
