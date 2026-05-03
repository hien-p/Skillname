import { useEffect, useState } from "react";
import { sepolia } from "viem/chains";
import { useBlockNumber } from "wagmi";
import { WalletButton } from "./WalletButton";

export function Header({ onPublish }: { onPublish: () => void }) {
  const { data: blockNumber } = useBlockNumber({ chainId: sepolia.id, watch: true });
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const formattedBlock = blockNumber
    ? blockNumber.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'")
    : "—";

  return (
    <header className="flex items-center justify-between border-b border-bento-border px-6 py-4">
      <div className="flex items-center gap-3">
        <BrandMark />
        <span className="font-mono text-sm text-bento-text-secondary">
          SKILLNAME · OS{" "}
          <span className="text-bento-text-display font-semibold">v0.0.1</span>
        </span>
      </div>
      <div className="flex items-center gap-6 font-mono text-[11px] uppercase tracking-wider">
        <span className="text-bento-text-secondary">
          {now.toLocaleTimeString("en-US", { hour12: false })}
        </span>
        <span className="text-bento-text-secondary">
          sepolia · block{" "}
          <span className="text-bento-text-display font-semibold">{formattedBlock}</span>
        </span>
        <a href="/logs/index.html" className="text-bento-text-secondary hover:text-bento-text-display">
          / logs
        </a>
        <span className="flex items-center gap-1 text-bento-accent-red">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-bento-accent-red animate-pulse" />
          live
        </span>
        <WalletButton />
        <button
          type="button"
          onClick={onPublish}
          className="bg-chartreuse-pulse text-bento-black px-3 py-1 font-semibold text-xs uppercase tracking-wider hover:-translate-y-px transition"
        >
          + publish
        </button>
      </div>
    </header>
  );
}

function BrandMark() {
  // 5x5 dot grid mark; lit dots vs unlit
  const pattern = [
    1, 0, 1, 0, 1,
    0, 1, 1, 1, 0,
    1, 1, 0, 1, 1,
    0, 1, 1, 1, 0,
    1, 0, 1, 0, 1,
  ];
  return (
    <div className="grid grid-cols-5 gap-[2px] w-5 h-5">
      {pattern.map((on, i) => (
        <span
          key={i}
          className={`block w-[2px] h-[2px] ${
            on ? "bg-bento-text-display" : "bg-bento-text-display/20"
          }`}
        />
      ))}
    </div>
  );
}
