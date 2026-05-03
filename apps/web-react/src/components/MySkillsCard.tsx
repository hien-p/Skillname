import { useEffect, useState } from "react";
import { useAccount, useConnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { listPublished, subscribePublished, type PublishedSkill } from "../lib/published-store";

interface Props {
  onSelect: (ensName: string) => void;
  onPublish: () => void;
}

export function MySkillsCard({ onSelect, onPublish }: Props) {
  const { address, isConnected } = useAccount();
  const { connect, isPending } = useConnect();
  const [items, setItems] = useState<PublishedSkill[]>([]);

  useEffect(() => {
    setItems(listPublished(address));
    if (!address) return;
    return subscribePublished(address, () => setItems(listPublished(address)));
  }, [address]);

  const short = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";
  const count = items.length;

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

        {isConnected && count === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-2">
            <div className="font-doto text-4xl text-bento-text-display/40">00</div>
            <p className="mt-3 font-mono text-[11px] uppercase tracking-wider text-bento-text-secondary max-w-[240px]">
              No publishes from <span className="text-bento-text-display">{short}</span> yet.
              Hit&nbsp;
              <button
                onClick={onPublish}
                className="text-chartreuse-pulse hover:underline"
              >
                + publish
              </button>{" "}
              to register one.
            </p>
          </div>
        )}

        {isConnected && count > 0 && (
          <ul className="flex-1 overflow-y-auto -mr-2 pr-2 space-y-2">
            {items.map((it) => (
              <li key={`${it.ensName}@${it.version}@${it.txHash}`}>
                <button
                  onClick={() => onSelect(it.ensName)}
                  className="w-full text-left rounded-md border border-bento-border hover:border-bento-text-display px-3 py-2 transition group"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-sm text-bento-text-display truncate">
                      {it.ensName}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-bento-text-secondary shrink-0">
                      v{it.version}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-wider text-bento-text-secondary">
                    <span>{relTime(it.ts)}</span>
                    <a
                      href={`https://sepolia.etherscan.io/tx/${it.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="hover:text-bento-text-display"
                    >
                      tx ↗
                    </a>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="mt-4 pt-4 border-t border-bento-border flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-bento-text-secondary">
        <span>local cache · this browser</span>
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
