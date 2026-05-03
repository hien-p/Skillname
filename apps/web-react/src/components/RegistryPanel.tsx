import { useCallback, useEffect, useState } from "react";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { sepolia } from "viem/chains";
import { isAddress, namehash, parseAbi, type Hex } from "viem";
import { SKILLLINK_ADDR } from "../lib/contracts";
import { CallerLog } from "./CallerLog";

const SKILLS_ABI = parseAbi([
  "function skills(bytes32 node) external view returns (address impl, address owner, uint96 registeredAt, uint256 selectorBitmap)",
  "function getSelectors(bytes32 node) external view returns (bytes4[] memory)",
  "function call(bytes32 node, bytes data) external payable returns (bytes)",
  "function register(bytes32 node, address impl, bytes4[] selectors) external",
]);

const ENS_REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e" as const;
const ENS_REGISTRY_ABI = parseAbi([
  "function owner(bytes32 node) view returns (address)",
]);

interface SkillEntry {
  impl: `0x${string}`;
  owner: `0x${string}`;
  registeredAt: bigint;
  selectors: `0x${string}`[];
}

const ZERO = "0x0000000000000000000000000000000000000000" as const;

// Known demo impls deployed on Sepolia. Used to pre-fill the register form so
// the user isn't staring at a blank input wondering "what address goes here?".
// New skills get an empty form + the explanatory copy below.
const SUGGESTED_IMPLS: Record<
  string,
  { impl: `0x${string}`; selectors: `0x${string}`[]; label: string; note: string }
> = {
  "agent.skilltest.eth": {
    impl: "0x9Eb870696bcd321A88Dba40eAaC92Ac00fA472f2",
    selectors: ["0x0777905b"],
    label: "BestQuoteAggregator",
    note: "The composite aggregator that itself dispatches into quote.skilltest.eth + a sibling. Selector 0x0777905b is getBestQuote(string).",
  },
  "quote.skilltest.eth": {
    impl: "0x9Eb870696bcd321A88Dba40eAaC92Ac00fA472f2",
    selectors: ["0x0777905b"],
    label: "BestQuoteAggregator",
    note: "Demo only — share the BestQuoteAggregator impl. In production this would be a dedicated QuoteUniswap contract.",
  },
};

interface Props {
  ensName: string;
}

type RegStatus =
  | { kind: "idle" }
  | { kind: "running"; step: string }
  | { kind: "ok"; tx: Hex }
  | { kind: "err"; msg: string };

export function RegistryPanel({ ensName }: Props) {
  const publicClient = usePublicClient({ chainId: sepolia.id });
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [entry, setEntry] = useState<SkillEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // call demo
  const [callBusy, setCallBusy] = useState(false);
  const [callRaw, setCallRaw] = useState<string | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const [callMs, setCallMs] = useState<number | null>(null);

  // register form
  const [implInput, setImplInput] = useState("");
  const [selectorsInput, setSelectorsInput] = useState("");
  const [regStatus, setRegStatus] = useState<RegStatus>({ kind: "idle" });
  const [ensOwner, setEnsOwner] = useState<`0x${string}` | null>(null);

  const wrongChain = isConnected && chainId !== sepolia.id;

  const refetch = useCallback(async () => {
    if (!publicClient) return;
    setLoading(true);
    setError(null);
    const node = namehash(ensName);
    try {
      const [raw, selectors] = await Promise.all([
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
      ]);
      const [impl, owner, registeredAt] = raw as readonly [
        `0x${string}`,
        `0x${string}`,
        bigint,
        bigint,
      ];
      if (impl === ZERO) setEntry(null);
      else
        setEntry({
          impl,
          owner,
          registeredAt,
          selectors: selectors as `0x${string}`[],
        });
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, [ensName, publicClient]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  // Read ENS owner once we know we'll need it (panel shows the register form).
  useEffect(() => {
    if (!publicClient) return;
    if (entry) {
      setEnsOwner(null);
      return;
    }
    let cancelled = false;
    publicClient
      .readContract({
        address: ENS_REGISTRY,
        abi: ENS_REGISTRY_ABI,
        functionName: "owner",
        args: [namehash(ensName)],
      })
      .then((o) => !cancelled && setEnsOwner(o as `0x${string}`))
      .catch(() => !cancelled && setEnsOwner(null));
    return () => {
      cancelled = true;
    };
  }, [ensName, publicClient, entry]);

  async function callOnChain(selector: `0x${string}`) {
    if (!publicClient) return;
    setCallBusy(true);
    setCallError(null);
    setCallRaw(null);
    setCallMs(null);
    const t0 = performance.now();
    try {
      const node = namehash(ensName);
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

  function parseSelectors(raw: string): `0x${string}`[] | string {
    const parts = raw
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return "Add at least one 4-byte selector (e.g. 0x12345678).";
    for (const p of parts) {
      if (!/^0x[0-9a-fA-F]{8}$/.test(p))
        return `"${p}" is not a 4-byte selector — must be 0x + 8 hex chars.`;
    }
    return parts as `0x${string}`[];
  }

  async function handleRegister() {
    if (!isConnected || !address) {
      setRegStatus({ kind: "err", msg: "Connect wallet first." });
      return;
    }
    if (wrongChain) {
      try {
        await switchChainAsync({ chainId: sepolia.id });
      } catch (e) {
        setRegStatus({
          kind: "err",
          msg: `Switch to Sepolia first: ${(e as Error).message}`,
        });
        return;
      }
    }
    if (!isAddress(implInput)) {
      setRegStatus({ kind: "err", msg: "Impl must be a valid 0x… address." });
      return;
    }
    const sels = parseSelectors(selectorsInput);
    if (typeof sels === "string") {
      setRegStatus({ kind: "err", msg: sels });
      return;
    }
    if (
      ensOwner &&
      ensOwner.toLowerCase() !== address.toLowerCase()
    ) {
      setRegStatus({
        kind: "err",
        msg: `Wallet doesn't own ${ensName} (owner is ${ensOwner.slice(
          0,
          10,
        )}…). SkillLink.register requires the ENS owner.`,
      });
      return;
    }
    try {
      setRegStatus({ kind: "running", step: "Sign register(node, impl, selectors)…" });
      const tx = await writeContractAsync({
        address: SKILLLINK_ADDR,
        abi: SKILLS_ABI,
        functionName: "register",
        args: [namehash(ensName), implInput as `0x${string}`, sels],
      });
      setRegStatus({ kind: "running", step: "Waiting for confirmation…" });
      await publicClient!.waitForTransactionReceipt({ hash: tx });
      setRegStatus({ kind: "ok", tx });
      await refetch();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setRegStatus({ kind: "err", msg: msg.slice(0, 280) });
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
          <strong className="font-semibold text-midnight-navy block mb-1">
            Not registered in SkillLink — register now
          </strong>
          <p className="text-storm-gray">
            Bind <code className="font-mono">{ensName}</code> to an implementation contract
            so anyone can dispatch this skill via the registry. The transaction must come
            from the ENS owner.
          </p>

          {(() => {
            const preset = SUGGESTED_IMPLS[ensName];
            if (!preset) return null;
            return (
              <div className="mt-4 rounded border border-chartreuse-pulse/40 bg-chartreuse-pulse/10 p-3">
                <div className="font-mono text-[10px] uppercase tracking-wider text-midnight-navy mb-1">
                  Suggested impl for this skill
                </div>
                <div className="font-mono text-xs text-midnight-navy">
                  <span className="font-semibold">{preset.label}</span> · {preset.impl.slice(0, 10)}…
                </div>
                <div className="mt-1 font-body text-xs text-storm-gray">
                  {preset.note}
                </div>
                <button
                  onClick={() => {
                    setImplInput(preset.impl);
                    setSelectorsInput(preset.selectors.join(","));
                  }}
                  className="mt-2 px-3 py-1 bg-midnight-navy text-chartreuse-pulse font-mono text-[10px] uppercase tracking-wider rounded hover:-translate-y-px transition"
                >
                  Use this preset →
                </button>
              </div>
            );
          })()}

          <div className="mt-4 grid gap-3">
            <Field label="Impl contract">
              <input
                value={implInput}
                onChange={(e) => setImplInput(e.target.value.trim())}
                placeholder="0x… (deployed contract address that runs the function)"
                className={inputCls}
              />
              <p className="mt-1 font-mono text-[10px] text-slate-ink">
                The Solidity contract you wrote + deployed on Sepolia. Yes, anyone can
                pass any address here — but the next line gates it: only the ENS owner
                can register, and the registry stores both the impl and which selectors
                it&apos;s allowed to dispatch.
              </p>
            </Field>
            <Field label="Selectors">
              <input
                value={selectorsInput}
                onChange={(e) => setSelectorsInput(e.target.value)}
                placeholder="0x12345678  (comma-separated for multiple)"
                className={inputCls}
              />
              <p className="mt-1 font-mono text-[10px] text-slate-ink">
                4-byte function selectors from your impl. Get them with{" "}
                <code>cast sig &quot;myFunction(uint256)&quot;</code> or any ABI tool.
              </p>
            </Field>
          </div>

          <div className="mt-4 grid gap-2 font-mono text-[11px]">
            <Hint
              label="Wallet"
              value={
                isConnected
                  ? `${address!.slice(0, 6)}…${address!.slice(-4)}`
                  : "not connected"
              }
              tone={isConnected ? "ok" : "warn"}
            />
            <Hint
              label="ENS owner"
              value={
                ensOwner
                  ? `${ensOwner.slice(0, 6)}…${ensOwner.slice(-4)}`
                  : "checking…"
              }
              tone={
                ensOwner && address && ensOwner.toLowerCase() === address.toLowerCase()
                  ? "ok"
                  : ensOwner
                    ? "warn"
                    : "muted"
              }
            />
            {wrongChain && (
              <Hint label="Network" value="wrong chain — needs Sepolia" tone="warn" />
            )}
          </div>

          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={handleRegister}
              disabled={
                !isConnected ||
                regStatus.kind === "running" ||
                !implInput ||
                !selectorsInput
              }
              className="px-4 py-2 bg-midnight-navy text-chartreuse-pulse font-mono text-[11px] uppercase tracking-wider disabled:opacity-40 hover:-translate-y-px transition rounded"
            >
              {regStatus.kind === "running" ? "Signing…" : "Register on-chain →"}
            </button>
            {!isConnected && (
              <span className="font-mono text-[11px] text-slate-ink">
                Connect wallet (top-right) to sign.
              </span>
            )}
          </div>

          <div className="mt-3 min-h-[44px] font-mono text-[11px]">
            {regStatus.kind === "running" && (
              <span className="text-midnight-navy">{regStatus.step}</span>
            )}
            {regStatus.kind === "ok" && (
              <div className="bg-bento-success/10 text-bento-success rounded p-2 break-all">
                ✓ Registered — tx{" "}
                <a
                  href={`https://sepolia.etherscan.io/tx/${regStatus.tx}`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  {regStatus.tx.slice(0, 14)}… ↗
                </a>
              </div>
            )}
            {regStatus.kind === "err" && (
              <div className="bg-bento-accent-red/10 text-bento-accent-red rounded p-2 break-all">
                ✗ {regStatus.msg}
              </div>
            )}
          </div>

          <details className="mt-4 group">
            <summary className="font-mono text-[10px] uppercase tracking-wider text-slate-ink cursor-pointer hover:text-midnight-navy">
              Or use the CLI
            </summary>
            <pre className="mt-2 bg-bento-black text-bento-text-primary font-mono text-[10px] p-3 rounded overflow-auto">
{`skill register-onchain ${ensName} \\
  --impl ${implInput || "0x…"} \\
  --selectors ${selectorsInput || "0x…"}`}
            </pre>
          </details>
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

      {/* Activity log shows in both states — registered (with calls) or pre-registration */}
      <CallerLog ensName={ensName} />
    </div>
  );
}

const inputCls =
  "w-full bg-pure-surface border border-fog-border rounded px-3 py-2 outline-none focus:border-midnight-navy font-mono text-sm";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block font-mono text-[10px] uppercase tracking-wider text-slate-ink mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

function Hint({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "ok" | "warn" | "muted";
}) {
  const dot =
    tone === "ok"
      ? "text-bento-success"
      : tone === "warn"
        ? "text-bento-accent-red"
        : "text-slate-ink";
  return (
    <div className="flex items-center gap-2">
      <span className={dot}>●</span>
      <span className="text-slate-ink uppercase tracking-wider text-[10px]">{label}</span>
      <span className="text-midnight-navy">{value}</span>
    </div>
  );
}
