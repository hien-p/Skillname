import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { sepolia } from "viem/chains";
import { namehash, parseAbi } from "viem";
import { CATALOG_ITEMS } from "./SkillCatalog";

const RESOLVER = "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5" as const;
const RESOLVER_ABI = parseAbi([
  "function text(bytes32 node, string key) view returns (string)",
]);

interface BindingStatus {
  ens: string;
  agentId: number;
  bound: boolean | null; // null = still verifying
  textValue?: string;
}

interface Props {
  onSelect: (ens: string) => void;
}

/**
 * Mirrors @skillname/sdk's encodeErc7930 — bytes layout for an ERC-7930
 * interoperable address. Used to construct the ENS text-record key the
 * bridge reads to confirm an ERC-8004 agent binding.
 */
function encodeErc7930(caip10: string): `0x${string}` {
  const m = caip10.match(/^eip155:(\d+):(0x[a-fA-F0-9]{40})$/);
  if (!m) throw new Error(`invalid caip10: ${caip10}`);
  const chainId = parseInt(m[1], 10);
  const addr = m[2].slice(2).toLowerCase();
  let chainHex = chainId.toString(16);
  if (chainHex.length % 2 === 1) chainHex = "0" + chainHex;
  const lenHex = (chainHex.length / 2).toString(16).padStart(2, "0");
  return `0x0001${"0000"}${lenHex}${chainHex}14${addr}` as `0x${string}`;
}

/**
 * Surfaces ENSIP-25 + ERC-8004 status across the whole catalog so ENS
 * judges don't have to drill into each skill's Trust tab to see the binding
 * exists. Reads the agent-registration text record from each bound skill's
 * ENS name in parallel and shows pass/fail per row.
 */
export function TrustBindingsCard({ onSelect }: Props) {
  const client = usePublicClient({ chainId: sepolia.id });
  const bound = CATALOG_ITEMS.filter((c) => c.trust);
  const [rows, setRows] = useState<BindingStatus[]>(
    bound.map((c) => ({ ens: c.ens, agentId: c.trust!.agentId, bound: null })),
  );
  const [verifying, setVerifying] = useState(true);
  const [verifyMs, setVerifyMs] = useState<number | null>(null);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    setVerifying(true);
    const t0 = performance.now();
    Promise.all(
      bound.map(async (item): Promise<BindingStatus> => {
        const enc = encodeErc7930(item.trust!.registry);
        const key = `agent-registration[${enc}][${item.trust!.agentId}]`;
        try {
          const v = (await client.readContract({
            address: RESOLVER,
            abi: RESOLVER_ABI,
            functionName: "text",
            args: [namehash(item.ens), key],
          })) as string;
          return {
            ens: item.ens,
            agentId: item.trust!.agentId,
            bound: v === "1",
            textValue: v,
          };
        } catch {
          return {
            ens: item.ens,
            agentId: item.trust!.agentId,
            bound: false,
          };
        }
      }),
    ).then((res) => {
      if (cancelled) return;
      setRows(res);
      setVerifyMs(Math.round(performance.now() - t0));
      setVerifying(false);
    });
    return () => {
      cancelled = true;
    };
    // bound is derived from CATALOG_ITEMS at module load — stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const okCount = rows.filter((r) => r.bound === true).length;
  const total = bound.length;

  return (
    <article className="bg-bento-surface text-bento-text-primary rounded-2xl p-6 border border-bento-border h-full flex flex-col">
      <header className="flex items-start justify-between gap-3">
        <div>
          <span className="font-mono text-[10px] uppercase tracking-wider text-bento-text-secondary">
            Trust · ENSIP-25 + ERC-8004
          </span>
          <div className="mt-1 font-mono text-xs text-bento-text-display">
            bidirectional identity binding
          </div>
        </div>
        <span
          className={`font-mono text-[10px] uppercase tracking-wider ${
            verifying ? "text-bento-text-secondary" : okCount === total ? "text-bento-success" : "text-bento-accent-red"
          }`}
        >
          {verifying ? "verifying…" : okCount === total ? "● all bound" : `${okCount}/${total} bound`}
        </span>
      </header>

      <div className="mt-3 flex items-baseline gap-2">
        <span className="font-doto text-5xl text-bento-text-display leading-none">
          {String(okCount).padStart(2, "0")}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-bento-text-secondary">
          / {String(total).padStart(2, "0")} skills · spoof-proof
        </span>
      </div>

      <ul className="mt-4 flex-1 space-y-1.5 font-mono text-[11px]">
        {rows.map((r) => {
          const dot =
            r.bound === null
              ? "text-bento-text-secondary"
              : r.bound
                ? "text-bento-success"
                : "text-bento-accent-red";
          return (
            <li key={r.ens}>
              <button
                onClick={() => onSelect(r.ens)}
                className="w-full flex items-baseline justify-between text-left rounded px-1.5 py-1 hover:bg-bento-text-display/5 transition group"
                title={
                  r.bound
                    ? `ENS owner of ${r.ens} confirmed agentId ${r.agentId} on-chain`
                    : `agent-registration text record empty — claim unconfirmed`
                }
              >
                <span className="flex items-center gap-2 truncate">
                  <span className={dot}>●</span>
                  <span className="text-bento-text-display truncate group-hover:underline">
                    {r.ens}
                  </span>
                </span>
                <span className="text-bento-text-secondary tabular-nums">
                  agent #{r.agentId}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <footer className="mt-4 pt-4 border-t border-bento-border flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-bento-text-secondary">
        <span>
          {verifyMs !== null
            ? `verified in ${verifyMs}ms · sepolia`
            : "scanning text records…"}
        </span>
        <a
          href="https://docs.ens.domains/ensip/25/"
          target="_blank"
          rel="noreferrer"
          className="hover:text-bento-text-display"
        >
          ENSIP-25 spec ↗
        </a>
      </footer>
    </article>
  );
}
