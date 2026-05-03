import { useEffect, useState } from "react";
import { useAccount, useConnect, usePublicClient } from "wagmi";
import { injected } from "wagmi/connectors";
import { sepolia } from "wagmi/chains";
import { listPublished, subscribePublished } from "../lib/published-store";
import { discoverOwnedSkills } from "../lib/discover-skills";

interface Props {
  onSelect: (ensName: string) => void;
  onPublish: () => void;
}

interface Row {
  ensName: string;
  version?: string;
  txHash?: `0x${string}`;
  ts?: number;
  source: "chain" | "local";
}

export function MySkillsCard({ onSelect, onPublish }: Props) {
  const { address, isConnected } = useAccount();
  const { connect, isPending } = useConnect();
  const publicClient = usePublicClient({ chainId: sepolia.id });
  const [rows, setRows] = useState<Row[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [discoverErr, setDiscoverErr] = useState<string | null>(null);

  // Discover on chain + merge with localStorage cache.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!address || !publicClient) {
        setRows([]);
        return;
      }
      const local = listPublished(address);
      // Show cache first so the panel doesn't blank during the read
      setRows(
        local.map((l) => ({
          ensName: l.ensName,
          version: l.version,
          txHash: l.txHash,
          ts: l.ts,
          source: "local" as const,
        })),
      );
      setDiscovering(true);
      setDiscoverErr(null);
      try {
        const onchain = await discoverOwnedSkills(publicClient, address);
        if (cancelled) return;
        const byEns = new Map<string, Row>();
        // Chain entries first (authoritative for ownership/version)
        for (const s of onchain) {
          byEns.set(s.ensName, {
            ensName: s.ensName,
            version: s.version,
            source: "chain",
          });
        }
        // Layer in local cache info (tx + ts) where present
        for (const l of local) {
          const existing = byEns.get(l.ensName);
          if (existing) {
            byEns.set(l.ensName, {
              ...existing,
              version: existing.version ?? l.version,
              txHash: l.txHash,
              ts: l.ts,
            });
          } else {
            byEns.set(l.ensName, {
              ensName: l.ensName,
              version: l.version,
              txHash: l.txHash,
              ts: l.ts,
              source: "local",
            });
          }
        }
        const merged = Array.from(byEns.values()).sort((a, b) => {
          if ((b.ts ?? 0) !== (a.ts ?? 0)) return (b.ts ?? 0) - (a.ts ?? 0);
          return a.ensName.localeCompare(b.ensName);
        });
        setRows(merged);
      } catch (e) {
        if (!cancelled) setDiscoverErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setDiscovering(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [address, publicClient]);

  // Live update on PublishOverlay writes.
  useEffect(() => {
    if (!address) return;
    return subscribePublished(address, () => {
      const local = listPublished(address);
      setRows((prev) => {
        const byEns = new Map(prev.map((p) => [p.ensName, p]));
        for (const l of local) {
          const existing = byEns.get(l.ensName);
          byEns.set(l.ensName, {
            ensName: l.ensName,
            version: existing?.version ?? l.version,
            txHash: l.txHash,
            ts: l.ts,
            source: existing?.source ?? "local",
          });
        }
        return Array.from(byEns.values()).sort((a, b) => {
          if ((b.ts ?? 0) !== (a.ts ?? 0)) return (b.ts ?? 0) - (a.ts ?? 0);
          return a.ensName.localeCompare(b.ensName);
        });
      });
    });
  }, [address]);

  const short = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";
  const count = rows.length;

  return (
    <article className="bg-bento-surface text-bento-text-primary rounded-2xl p-6 border border-bento-border h-full flex flex-col">
      <header className="flex items-start justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-bento-text-secondary">
            My skills · published from
          </div>
          <div className="mt-1 font-mono text-xs text-bento-text-display">
            {isConnected ? (
              <a
                href={`https://sepolia.etherscan.io/address/${address}`}
                target="_blank"
                rel="noreferrer"
                className="hover:underline"
                title={address}
              >
                {short} ↗
              </a>
            ) : (
              <span className="text-bento-text-secondary">no wallet connected</span>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="font-doto text-5xl text-bento-text-display leading-none">
            {String(count).padStart(2, "0")}
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-bento-text-secondary">
            mine
          </div>
        </div>
      </header>

      <div className="mt-5 flex-1 flex flex-col min-h-0">
        {!isConnected && (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-2">
            <div className="font-doto text-4xl text-bento-text-display/50">––</div>
            <p className="mt-3 font-mono text-[11px] uppercase tracking-wider text-bento-text-secondary max-w-[220px]">
              Connect a wallet to see skills you've published from this address.
            </p>
            <button
              onClick={() => connect({ connector: injected() })}
              disabled={isPending}
              className="mt-4 px-3 py-1 border border-bento-text-display text-bento-text-display font-mono text-[11px] uppercase tracking-wider hover:bg-bento-text-display hover:text-bento-black transition disabled:opacity-50"
            >
              {isPending ? "Connecting…" : "Connect wallet"}
            </button>
          </div>
        )}

        {isConnected && discovering && count === 0 && (
          <div className="flex-1 flex items-center justify-center font-mono text-[11px] uppercase tracking-wider text-bento-text-secondary">
            scanning sepolia…
          </div>
        )}

        {isConnected && !discovering && count === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-2">
            <div className="font-doto text-4xl text-bento-text-display/40">00</div>
            <p className="mt-3 font-mono text-[11px] uppercase tracking-wider text-bento-text-secondary max-w-[240px]">
              No demo skills owned by <span className="text-bento-text-display">{short}</span>{" "}
              on Sepolia. Hit&nbsp;
              <button
                onClick={onPublish}
                className="text-chartreuse-pulse hover:underline"
              >
                + publish
              </button>{" "}
              to register one.
            </p>
            {discoverErr && (
              <div className="mt-3 font-mono text-[10px] text-bento-accent-red break-all max-w-[260px]">
                {discoverErr}
              </div>
            )}
          </div>
        )}

        {isConnected && count > 0 && (
          <ul className="flex-1 overflow-y-auto -mr-2 pr-2 space-y-2">
            {rows.map((it) => (
              <li key={it.ensName}>
                <button
                  onClick={() => onSelect(it.ensName)}
                  className="w-full text-left rounded-md border border-bento-border hover:border-bento-text-display px-3 py-2 transition"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-sm text-bento-text-display truncate">
                      {it.ensName}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-bento-text-secondary shrink-0">
                      {it.version ? `v${it.version}` : "—"}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-wider text-bento-text-secondary">
                    <span className={it.source === "chain" ? "text-chartreuse-pulse" : ""}>
                      {it.source === "chain" ? "● on-chain" : "● local"}{" "}
                      {it.ts && <span className="text-bento-text-secondary">· {relTime(it.ts)}</span>}
                    </span>
                    {it.txHash && (
                      <a
                        href={`https://sepolia.etherscan.io/tx/${it.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="hover:text-bento-text-display"
                      >
                        tx ↗
                      </a>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="mt-4 pt-4 border-t border-bento-border flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-bento-text-secondary">
        <span>
          {discovering ? "syncing…" : "ens registry · sepolia"}
        </span>
        {isConnected && (
          <button
            onClick={onPublish}
            className="text-chartreuse-pulse hover:underline"
          >
            + new skill →
          </button>
        )}
      </footer>
    </article>
  );
}

function relTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
