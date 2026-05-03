import { useEffect, useState } from "react";
import { useReadContract, usePublicClient } from "wagmi";
import { encodeFunctionData, decodeAbiParameters, namehash, parseAbiItem } from "viem";
import { sepolia } from "viem/chains";
import {
  SKILLLINK_ADDR,
  SKILLLINK_ABI,
  IDENTITY_REGISTRY_ADDR,
  SKILL_NFT_ADDR,
  COUNT_ABI,
} from "../lib/contracts";

const GET_BEST_QUOTE = parseAbiItem("function getBestQuote(string tokenId) returns (uint256)");

export function OnchainCard() {
  const skillCount = useReadContract({
    chainId: sepolia.id,
    address: SKILLLINK_ADDR,
    abi: SKILLLINK_ABI,
    functionName: "skillCount",
  });

  const nftCount = useReadContract({
    chainId: sepolia.id,
    address: SKILL_NFT_ADDR,
    abi: COUNT_ABI,
    functionName: "totalSupply",
  });

  const lastAgent = useReadContract({
    chainId: sepolia.id,
    address: IDENTITY_REGISTRY_ADDR,
    abi: COUNT_ABI,
    functionName: "lastId",
  });

  const publicClient = usePublicClient({ chainId: sepolia.id });

  const [demoBusy, setDemoBusy] = useState(false);
  const [demoResult, setDemoResult] = useState<string | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);
  const [demoMs, setDemoMs] = useState<number | null>(null);

  async function runDemo() {
    if (!publicClient) return;
    setDemoBusy(true);
    setDemoError(null);
    setDemoResult(null);
    const t0 = performance.now();
    try {
      const node = namehash("agg.skilltest.eth");
      const innerCalldata = encodeFunctionData({
        abi: [GET_BEST_QUOTE],
        functionName: "getBestQuote",
        args: ["ethereum"],
      });
      const { result } = await publicClient.simulateContract({
        address: SKILLLINK_ADDR,
        abi: SKILLLINK_ABI,
        functionName: "call",
        args: [node, innerCalldata],
      });
      const [decoded] = decodeAbiParameters([{ type: "uint256" }], result as `0x${string}`);
      const usd = Number(decoded) / 1_000_000;
      setDemoResult(`$${usd.toFixed(2)}`);
      setDemoMs(Math.round(performance.now() - t0));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setDemoError(msg);
    } finally {
      setDemoBusy(false);
    }
  }

  // Pre-fetch on mount
  useEffect(() => {
    skillCount.refetch();
    nftCount.refetch();
    lastAgent.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const skillN = skillCount.data?.toString() ?? "—";
  const nftN = nftCount.data?.toString() ?? "—";
  const agentN = lastAgent.data?.toString() ?? "—";

  return (
    <div className="rounded-lg border border-bento-border bg-bento-surface p-6 text-bento-text-primary font-mono">
      <div className="text-[10px] uppercase tracking-wider text-bento-text-secondary opacity-50">
        ON-CHAIN · LIVE
      </div>

      <div className="mt-3">
        <div className="text-xs uppercase tracking-wider text-bento-text-secondary">
          SkillLink · sepolia
        </div>
        <div className="font-doto text-5xl mt-1 text-bento-text-display">{skillN}</div>
        <div className="text-xs uppercase tracking-wider text-bento-text-secondary mt-1">
          skills registered
        </div>
        <div className="text-[11px] text-bento-text-secondary mt-2">
          {nftN} SkillNFT · {agentN} agents
        </div>
      </div>

      <button
        onClick={runDemo}
        disabled={demoBusy}
        className="mt-4 w-full bg-bento-text-display text-bento-black text-xs font-semibold uppercase tracking-wider py-2 disabled:opacity-50"
      >
        {demoBusy ? "Running…" : "Run demo →"}
      </button>

      <div className="mt-2 text-[11px] text-bento-text-secondary min-h-[20px]">
        {demoResult && (
          <span>
            <span className="text-bento-success">{demoResult}</span> · 3 hops · {demoMs}ms ·{" "}
            <a
              href={`https://sepolia.etherscan.io/address/${SKILLLINK_ADDR}`}
              target="_blank"
              rel="noreferrer"
              className="underline text-bento-text-display"
            >
              verify ↗
            </a>
          </span>
        )}
        {demoError && <span className="text-bento-accent-red">error: {demoError.slice(0, 60)}</span>}
        {!demoResult && !demoError && (
          <span>agg.skilltest.eth → getBestQuote(&quot;ethereum&quot;)</span>
        )}
      </div>
    </div>
  );
}
