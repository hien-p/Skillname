import { useAccount, useConnect, useDisconnect, useChainId, useSwitchChain } from "wagmi";
import { sepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";

export function WalletButton() {
  const { address, isConnected } = useAccount();
  const { connect, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  const wrongChain = isConnected && chainId !== sepolia.id;
  const short = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";

  if (!isConnected) {
    return (
      <button
        onClick={() => connect({ connector: injected() })}
        disabled={isPending}
        className="font-mono text-[11px] uppercase tracking-wider px-3 py-1 border border-bento-text-display text-bento-text-display hover:bg-bento-text-display hover:text-bento-black transition disabled:opacity-50"
        title={error?.message ?? "Connect injected wallet (MetaMask, Rabby, etc.)"}
      >
        {isPending ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }

  if (wrongChain) {
    return (
      <button
        onClick={() => switchChain({ chainId: sepolia.id })}
        className="font-mono text-[11px] uppercase tracking-wider px-3 py-1 bg-bento-accent-red text-bento-text-display hover:-translate-y-px transition"
      >
        Switch to Sepolia
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider">
      <span className="text-bento-success">●</span>
      <a
        href={`https://sepolia.etherscan.io/address/${address}`}
        target="_blank"
        rel="noreferrer"
        className="text-bento-text-display hover:underline"
        title={address}
      >
        {short}
      </a>
      <button
        onClick={() => disconnect()}
        className="text-bento-text-secondary hover:text-bento-text-display"
        title="disconnect"
      >
        ×
      </button>
    </div>
  );
}
