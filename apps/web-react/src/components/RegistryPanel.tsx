import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { namehash, parseAbi, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { SKILLLINK_ADDR } from "../lib/contracts";

const SKILLS_ABI = parseAbi([
  "function skills(bytes32 node) external view returns (address impl, address owner, uint96 registeredAt, uint256 selectorBitmap)",
  "function getSelectors(bytes32 node) external view returns (bytes4[] memory)",
  "function call(bytes32 node, bytes data) external payable returns (bytes)",
]);

interface SkillEntry {
  impl: `0x${string}`;
  owner: `0x${string}`;
  registeredAt: bigint;
  selectors: `0x${string}`[];
}

const ZERO = "0x0000000000000000000000000000000000000000" as const;

interface Props {
  ensName: string;
}

export function RegistryPanel({ ensName }: Props) {
  const publicClient = usePublicClient({ chainId: sepolia.id });
  const [entry, setEntry] = useState<SkillEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // call demo
  const [callBusy, setCallBusy] = useState(false);
  const [callRaw, setCallRaw] = useState<string | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const [callMs, setCallMs] = useState<number | null>(null);

  useEffect(() => {
    if (!publicClient) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEntry(null);
    const node = namehash(ensName);
    Promise.all([
      publicClient.readContract({
        address: SKILLLINK_ADDR,
        abi: SKILLS_ABI,
        functionName: "skills",
        args: [node],
      }),
      publicClient
        .readContract({
          address: SKILLLINK_ADDR,
          abi: SKILLS_ABI,
          functionName: "getSelectors",
          args: [node],
        })
        .catch(() => [] as readonly `0x${string}`[]),
    ])
      .then(([raw, selectors]) => {
        if (cancelled) return;
        const [impl, owner, registeredAt] = raw as readonly [
          `0x${string}`,
          `0x${string}`,
          bigint,
          bigint,
        ];
        if (impl === ZERO) {
          setEntry(null);
        } else {
          setEntry({
            impl,
            owner,
            registeredAt,
            selectors: selectors as `0x${string}`[],
          });
        }
      })
      .catch((e) => !cancelled && setError(String(e?.message ?? e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [ensName, publicClient]);

  async function callOnChain(selector: `0x${string}`) {
    if (!publicClient) return;
    setCallBusy(true);
    setCallError(null);
    setCallRaw(null);
    setCallMs(null);
    const t0 = performance.now();
    try {
      const node = namehash(ensName);
      // Pass an empty calldata body since the user might not know which args fit;
      // most leaf demo selectors take no args. If args are required, we surface
      // the revert message which is more honest than guessing.
      const innerCalldata = (selector + "00".repeat(32)) as Hex;
      const { result } = await publicClient.simulateContract({
        address: SKILLLINK_ADDR,
        abi: SKILLS_ABI,
        functionName: "call",
        args: [node, innerCalldata],
      });
      setCallRaw(String(result));
      setCallMs(Math.round(performance.now() - t0));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setCallError(msg);
    } finally {
      setCallBusy(false);
    }
  }

  function buildCastCommand(): string {
    if (!entry) return "";
    const sel = entry.selectors[0] ?? "0x00000000";
    const calldata = sel + "00".repeat(32);
    return [
      `cast call ${SKILLLINK_ADDR} \\`,
      `  "call(bytes32,bytes)(bytes)" \\`,
      `  $(cast namehash ${ensName}) \\`,
      `  ${calldata} \\`,
      `  --rpc-url https://ethereum-sepolia-rpc.publicnode.com`,
    ].join("\n");
  }

  return (
    <div className="mt-8">
      <h2 className="font-display text-3xl mb-2">Registry</h2>
      <p className="font-body text-sm text-slate-ink mb-6 max-w-2xl">
        On-chain mapping <code className="font-mono">ENS namehash → impl contract + allowed selectors</code>{" "}
        in the <code className="font-mono">SkillLink</code> registry on Sepolia. This is the
        same shape as Sui&apos;s MVR — &quot;look up a name, get the executable on-chain
        address.&quot; Any contract or EOA can dispatch this skill by name without
        knowing the impl address.
      </p>

      {loading && <div className="font-mono text-xs text-slate-ink">querying SkillLink…</div>}

      {error && (
        <div className="font-mono text-xs text-bento-accent-red">error · {error}</div>
      )}

      {!loading && !error && !entry && (
        <div className="border border-fog-border rounded p-6 bg-pure-surface text-sm text-storm-gray font-body">
          <strong className="font-semibold text-midnight-navy block mb-2">
            Not registered in SkillLink
          </strong>
          This ENS name has a manifest pinned (see Readme / Tools above) but no on-chain
          registry entry yet. Off-chain dispatch via the bridge still works.
          <div className="mt-3 font-mono text-xs">
            Register it via:{" "}
            <code>
              skill register-onchain {ensName} --impl 0x… --selectors 0x…
            </code>
          </div>
        </div>
      )}

      {entry && (
        <>
          <dl className="grid grid-cols-[180px_1fr] gap-x-4 gap-y-2 font-mono text-xs">
            <dt className="text-slate-ink uppercase tracking-wider text-[10px]">Registry</dt>
            <dd>
              <a
                href={`https://sepolia.etherscan.io/address/${SKILLLINK_ADDR}`}
                target="_blank"
                rel="noreferrer"
                className="underline break-all"
              >
                {SKILLLINK_ADDR}
              </a>
            </dd>

            <dt className="text-slate-ink uppercase tracking-wider text-[10px]">Impl</dt>
            <dd>
              <a
                href={`https://sepolia.etherscan.io/address/${entry.impl}`}
                target="_blank"
                rel="noreferrer"
                className="underline break-all"
              >
                {entry.impl}
              </a>
            </dd>

            <dt className="text-slate-ink uppercase tracking-wider text-[10px]">Owner</dt>
            <dd>
              <a
                href={`https://sepolia.etherscan.io/address/${entry.owner}`}
                target="_blank"
                rel="noreferrer"
                className="underline break-all"
              >
                {entry.owner}
              </a>
            </dd>

            <dt className="text-slate-ink uppercase tracking-wider text-[10px]">
              Registered at
            </dt>
            <dd>
              {new Date(Number(entry.registeredAt) * 1000).toLocaleString()}
            </dd>

            <dt className="text-slate-ink uppercase tracking-wider text-[10px]">
              Selectors ({entry.selectors.length})
            </dt>
            <dd className="space-y-1">
              {entry.selectors.length === 0 ? (
                <span className="text-slate-ink">(none registered)</span>
              ) : (
                entry.selectors.map((sel) => (
                  <div key={sel} className="flex items-center gap-3">
                    <code>{sel}</code>
                    <button
                      onClick={() => callOnChain(sel)}
                      disabled={callBusy}
                      className="text-[10px] uppercase tracking-wider px-2 py-0.5 bg-midnight-navy text-chartreuse-pulse rounded disabled:opacity-50"
                    >
                      Call ↗
                    </button>
                  </div>
                ))
              )}
            </dd>
          </dl>

          {callRaw && (
            <div className="mt-4 border border-fog-border rounded bg-pure-surface p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-slate-ink">
                last call · {callMs}ms · simulated via wagmi
              </div>
              <pre className="mt-2 bg-bento-black text-chartreuse-pulse font-mono text-[11px] p-3 rounded max-h-48 overflow-auto break-all whitespace-pre-wrap">
                {callRaw}
              </pre>
            </div>
          )}
          {callError && (
            <div className="mt-4 font-mono text-xs text-bento-accent-red">
              call reverted · {callError.slice(0, 200)}
              <div className="mt-1 text-slate-ink text-[11px] font-body">
                Most reverts here mean the selector requires real arguments — try the
                tool from the <strong>Tools</strong> tab instead, or use the cast command
                below with the right calldata.
              </div>
            </div>
          )}

          <div className="mt-6">
            <div className="font-mono text-[10px] uppercase tracking-wider text-slate-ink">
              Same call from any terminal
            </div>
            <pre className="mt-2 bg-bento-black text-bento-text-primary font-mono text-[11px] p-3 rounded overflow-auto">
              {buildCastCommand()}
            </pre>
          </div>
        </>
      )}
    </div>
  );
}
