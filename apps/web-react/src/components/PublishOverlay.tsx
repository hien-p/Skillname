import { useEffect, useMemo, useState } from "react";
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { keccak256, namehash, parseAbi, toBytes, type Hex } from "viem";
import { sepolia } from "wagmi/chains";
import { WalletButton } from "./WalletButton";
import { addPublished } from "../lib/published-store";

const ENS_REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e" as const;
const RESOLVER = "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5" as const;

const ENS_REGISTRY_ABI = parseAbi([
  "function setSubnodeRecord(bytes32 node, bytes32 label, address owner, address resolver, uint64 ttl) external",
  "function owner(bytes32 node) external view returns (address)",
]);
const RESOLVER_ABI = parseAbi([
  "function setText(bytes32 node, string key, string value) external",
]);

const SCHEMA_URL = "https://manifest.eth/schemas/skill-v1.json";
const PIN_SERVICE = (import.meta.env.VITE_PIN_SERVICE as string | undefined) ?? "http://localhost:3030";

interface Props {
  onClose: () => void;
}

type PinStatus =
  | { kind: "idle" }
  | { kind: "pinging" }
  | { kind: "running"; step: string }
  | { kind: "ok"; root: `0x${string}`; ms: number; log?: string }
  | { kind: "err"; msg: string };

type PubStatus =
  | { kind: "idle" }
  | { kind: "running"; step: string }
  | { kind: "ok"; lastTx: Hex }
  | { kind: "err"; msg: string };

interface PinHealth {
  ok: boolean;
  cli?: string;
  indexer?: string;
  rpc?: string;
  keyConfigured?: boolean;
}

export function PublishOverlay({ onClose }: Props) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: sepolia.id });
  const { writeContractAsync } = useWriteContract();

  const [parent, setParent] = useState("skilltest.eth");
  const [label, setLabel] = useState("my-new-skill");
  const [name, setName] = useState("my-new-skill");
  const [version, setVersion] = useState("1.0.0");
  const [description, setDescription] = useState("");
  const [exec, setExec] = useState<"http" | "local">("http");
  const [endpoint, setEndpoint] = useState("https://api.example.com/v1/run");

  const [pinStatus, setPinStatus] = useState<PinStatus>({ kind: "idle" });
  const [pubStatus, setPubStatus] = useState<PubStatus>({ kind: "idle" });
  const [pinHealth, setPinHealth] = useState<PinHealth | null>(null);

  const fullName = `${label}.${parent}`;
  const wrongChain = isConnected && chainId !== sepolia.id;

  // Probe the pin server on mount + every time the overlay reopens
  useEffect(() => {
    let cancelled = false;
    fetch(`${PIN_SERVICE}/health`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: PinHealth) => !cancelled && setPinHealth({ ...j, ok: true }))
      .catch(() => !cancelled && setPinHealth({ ok: false }));
    return () => {
      cancelled = true;
    };
  }, []);

  const manifest = useMemo(
    () => ({
      $schema: SCHEMA_URL,
      name,
      ensName: fullName,
      version,
      description: description || `One function on ${fullName}.`,
      license: "MIT",
      tools: [
        {
          name: name.replace(/[^a-z0-9_]/g, "_") || "tool",
          description: "auto-generated tool stub — edit before publishing",
          inputSchema: { type: "object", properties: {}, required: [] },
          execution:
            exec === "http"
              ? { type: "http", endpoint, method: "POST" }
              : { type: "local", handler: "tools/handler.ts" },
        },
      ],
    }),
    [name, fullName, version, description, exec, endpoint],
  );

  const formValid =
    /^[a-z0-9-]+$/.test(label) &&
    /^[a-z0-9-]+\.eth$/.test(parent) &&
    /^[a-z0-9-]+$/.test(name) &&
    /^\d+\.\d+\.\d+$/.test(version);

  const pinnedRoot = pinStatus.kind === "ok" ? pinStatus.root : null;

  async function handlePin() {
    if (!formValid) {
      setPinStatus({ kind: "err", msg: "Fill in name / version / endpoint first." });
      return;
    }
    setPinStatus({ kind: "pinging" });
    try {
      const t0 = performance.now();
      const res = await fetch(`${PIN_SERVICE}/pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: name, manifest }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        root?: string;
        ms?: number;
        log?: string;
        error?: string;
      };
      if (!res.ok || !body.root) {
        setPinStatus({
          kind: "err",
          msg: body.error ?? `Pin server returned HTTP ${res.status}`,
        });
        return;
      }
      const total = Math.round(performance.now() - t0);
      setPinStatus({
        kind: "ok",
        root: body.root as `0x${string}`,
        ms: body.ms ?? total,
        log: body.log,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPinStatus({
        kind: "err",
        msg: `Couldn't reach pin server at ${PIN_SERVICE} — start it with "pnpm pin:server" in the repo root. (${msg})`,
      });
    }
  }

  async function handlePublish() {
    if (!isConnected || !address) {
      setPubStatus({ kind: "err", msg: "Connect wallet first" });
      return;
    }
    if (!pinnedRoot) {
      setPubStatus({ kind: "err", msg: "Pin to 0G first." });
      return;
    }
    if (wrongChain) {
      try {
        await switchChainAsync({ chainId: sepolia.id });
      } catch (e) {
        setPubStatus({ kind: "err", msg: `Switch to Sepolia first: ${(e as Error).message}` });
        return;
      }
    }

    const parentNode = namehash(parent);
    const subNode = namehash(fullName);
    const labelHash = keccak256(toBytes(label));

    try {
      if (publicClient) {
        const parentOwner = (await publicClient.readContract({
          address: ENS_REGISTRY,
          abi: ENS_REGISTRY_ABI,
          functionName: "owner",
          args: [parentNode],
        })) as `0x${string}`;
        if (parentOwner.toLowerCase() !== address.toLowerCase()) {
          setPubStatus({
            kind: "err",
            msg: `You don't own ${parent} (owner is ${parentOwner.slice(0, 10)}…). Try a parent you control.`,
          });
          return;
        }
      }

      setPubStatus({ kind: "running", step: `Step 1/4 · setSubnodeRecord(${fullName})` });
      const tx1 = await writeContractAsync({
        address: ENS_REGISTRY,
        abi: ENS_REGISTRY_ABI,
        functionName: "setSubnodeRecord",
        args: [parentNode, labelHash, address, RESOLVER, 0n],
      });
      await publicClient!.waitForTransactionReceipt({ hash: tx1 });

      const records: [string, string][] = [
        ["xyz.manifest.skill", `0g://${pinnedRoot}`],
        ["xyz.manifest.skill.version", version],
        ["xyz.manifest.skill.schema", SCHEMA_URL],
      ];
      let lastTx: Hex = tx1;
      for (let i = 0; i < records.length; i++) {
        const [k, v] = records[i];
        setPubStatus({ kind: "running", step: `Step ${i + 2}/4 · setText(${k})` });
        const tx = await writeContractAsync({
          address: RESOLVER,
          abi: RESOLVER_ABI,
          functionName: "setText",
          args: [subNode, k, v],
        });
        await publicClient!.waitForTransactionReceipt({ hash: tx });
        lastTx = tx;
      }
      addPublished(address, {
        ensName: fullName,
        version,
        cid: pinnedRoot,
        txHash: lastTx,
        ts: Date.now(),
      });
      setPubStatus({ kind: "ok", lastTx });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setPubStatus({ kind: "err", msg: msg.slice(0, 240) });
    }
  }

  return (
    <aside className="fixed inset-0 z-40 bg-ghost-canvas text-midnight-navy overflow-y-auto">
      <header className="sticky top-0 bg-ghost-canvas/90 backdrop-blur border-b border-fog-border px-6 py-4 flex items-center justify-between">
        <button
          onClick={onClose}
          className="px-3 py-1 border border-fog-border rounded-full font-mono text-xs hover:border-midnight-navy"
        >
          ← Back
        </button>
        <span className="font-display text-lg">Publish a new skill</span>
        <div className="flex items-center gap-3">
          <div className="text-bento-text-display"><WalletButton /></div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-pure-surface flex items-center justify-center"
            aria-label="close"
          >
            ×
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8">
        <section>
          <h1 className="font-display text-4xl">Publish a skill end-to-end</h1>
          <p className="font-body text-sm text-slate-ink mt-2 max-w-2xl">
            Two beats:{" "}
            <strong className="text-midnight-navy">pin the manifest to 0G Galileo</strong> (one
            real on-chain submitLogEntry to the 0G storage contract), then{" "}
            <strong className="text-midnight-navy">sign 4 Sepolia transactions</strong> binding
            the bundle root to your ENS name. After both land, anyone can{" "}
            <code className="font-mono">resolveSkill(&quot;{label}.{parent}&quot;)</code>{" "}
            from any RPC, and the bridge fetches the manifest off 0G in one read.
          </p>

          {/* Form */}
          <div className="mt-6 space-y-4 font-mono text-sm">
            <Row label="Parent ENS">
              <input value={parent} onChange={(e) => setParent(e.target.value.trim())} className={input} />
            </Row>
            <Row label="Label">
              <input value={label} onChange={(e) => setLabel(e.target.value.trim())} className={input} />
            </Row>
            <Row label="Name (slug)">
              <input value={name} onChange={(e) => setName(e.target.value.trim())} className={input} />
            </Row>
            <Row label="Version">
              <input value={version} onChange={(e) => setVersion(e.target.value.trim())} className={input} />
            </Row>
            <Row label="Description">
              <input value={description} onChange={(e) => setDescription(e.target.value)} className={input} placeholder="One sentence describing the function" />
            </Row>
            <Row label="Execution">
              <div className="flex gap-2">
                {(["http", "local"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setExec(t)}
                    className={`px-3 py-1 border rounded font-mono text-xs ${
                      exec === t
                        ? "border-midnight-navy bg-midnight-navy text-pure-surface"
                        : "border-fog-border text-slate-ink hover:border-midnight-navy"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </Row>
            {exec === "http" && (
              <Row label="HTTP endpoint">
                <input value={endpoint} onChange={(e) => setEndpoint(e.target.value.trim())} className={input} />
              </Row>
            )}
          </div>

          {/* Stage 1 — Pin to 0G */}
          <div className="mt-8 rounded border border-fog-border p-4 bg-pure-surface">
            <div className="flex items-baseline justify-between">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-slate-ink">
                  Stage 1 · 0G Galileo storage
                </div>
                <h2 className="font-display text-xl mt-1">Pin the manifest</h2>
              </div>
              <PinHealthBadge health={pinHealth} />
            </div>
            <p className="font-body text-xs text-slate-ink mt-2 max-w-md">
              POST the JSON to the local pin-service, which spawns the official 0G
              Go CLI to compute the merkle root, submit it to the 0G log contract,
              and propagate to storage nodes. Same flow as <code className="font-mono">pnpm cli skill publish</code>.
            </p>

            <div className="mt-4 flex flex-col sm:flex-row gap-3 items-start">
              <button
                onClick={handlePin}
                disabled={!formValid || pinStatus.kind === "pinging" || pinHealth?.ok === false}
                className="px-4 py-2 bg-midnight-navy text-chartreuse-pulse font-mono text-xs uppercase tracking-wider rounded hover:-translate-y-px transition disabled:opacity-40"
              >
                {pinStatus.kind === "pinging" ? "Pinning to 0G…" : pinnedRoot ? "✓ Re-pin" : "▶ Pin to 0G"}
              </button>
              {pinStatus.kind === "ok" && (
                <div className="flex-1 min-w-0 font-mono text-[11px] text-bento-success">
                  <div>
                    ✓ root <code className="break-all">{pinnedRoot}</code>
                  </div>
                  <div className="text-slate-ink mt-0.5">
                    pinned in {pinStatus.ms.toLocaleString()}ms · indexer {pinHealth?.indexer?.replace(/^https?:\/\//, "") ?? "0g indexer"}
                  </div>
                </div>
              )}
              {pinStatus.kind === "err" && (
                <div className="flex-1 min-w-0 font-mono text-[11px] text-bento-accent-red break-all">
                  ✗ {pinStatus.msg}
                </div>
              )}
              {pinStatus.kind === "pinging" && (
                <div className="font-mono text-[11px] text-slate-ink">
                  submitLogEntry → uploading by root → waiting for finality (typ. 15-25s)…
                </div>
              )}
            </div>

            {pinStatus.kind === "ok" && pinStatus.log && (
              <details className="mt-3">
                <summary className="font-mono text-[10px] uppercase tracking-wider text-slate-ink cursor-pointer hover:text-midnight-navy">
                  0G CLI log (last lines)
                </summary>
                <pre className="mt-2 bg-bento-black text-bento-text-primary p-3 rounded text-[10px] overflow-auto max-h-56 whitespace-pre-wrap break-all">
                  {/* eslint-disable-next-line no-control-regex */}
                  {pinStatus.log.replace(/\[[0-9;]*m/g, "")}
                </pre>
              </details>
            )}
          </div>

          {/* Stage 2 — Bind on Sepolia */}
          <div className="mt-6 rounded border border-fog-border p-4 bg-pure-surface">
            <div className="font-mono text-[10px] uppercase tracking-wider text-slate-ink">
              Stage 2 · Sepolia ENS
            </div>
            <h2 className="font-display text-xl mt-1">Bind to {fullName}</h2>
            <p className="font-body text-xs text-slate-ink mt-2 max-w-md">
              4 wallet signatures: <code className="font-mono">setSubnodeRecord</code> creates the
              subname under your parent, then <code className="font-mono">setText</code> × 3
              writes the 0G root + version + schema URL into the resolver.
            </p>

            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={handlePublish}
                disabled={
                  !pinnedRoot ||
                  !isConnected ||
                  pubStatus.kind === "running"
                }
                className="px-5 py-2 bg-chartreuse-pulse text-bento-black font-mono text-xs uppercase tracking-wider disabled:opacity-40 hover:-translate-y-px transition rounded"
              >
                {pubStatus.kind === "running" ? "Signing…" : `Publish ${fullName} →`}
              </button>
              {!pinnedRoot && (
                <span className="font-mono text-[11px] text-slate-ink">Pin to 0G first ↑</span>
              )}
              {pinnedRoot && !isConnected && (
                <span className="font-mono text-[11px] text-slate-ink">Connect wallet (top-right) to sign.</span>
              )}
            </div>

            <div className="mt-3 min-h-[44px] font-mono text-[11px]">
              {pubStatus.kind === "running" && (
                <div className="text-midnight-navy">{pubStatus.step}…</div>
              )}
              {pubStatus.kind === "ok" && (
                <div className="bg-bento-success/10 text-bento-success rounded p-2 break-all">
                  ✓ Published {fullName} — last tx{" "}
                  <a
                    href={`https://sepolia.etherscan.io/tx/${pubStatus.lastTx}`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    {pubStatus.lastTx.slice(0, 14)}… ↗
                  </a>
                </div>
              )}
              {pubStatus.kind === "err" && (
                <div className="bg-bento-accent-red/10 text-bento-accent-red rounded p-2 break-all">
                  ✗ {pubStatus.msg}
                </div>
              )}
            </div>
          </div>
        </section>

        <aside className="font-mono text-xs space-y-4">
          <div>
            <h3 className="text-[10px] uppercase tracking-wider text-slate-ink">
              Manifest preview · {JSON.stringify(manifest).length}b
            </h3>
            <pre className="mt-2 bg-bento-black text-bento-text-primary p-3 rounded text-[10px] overflow-auto max-h-72">
{JSON.stringify(manifest, null, 2)}
            </pre>
          </div>
          <div>
            <h3 className="text-[10px] uppercase tracking-wider text-slate-ink">Pipeline</h3>
            <ol className="mt-2 space-y-1 text-storm-gray">
              <PipelineRow done={pinStatus.kind === "ok"}>0G manifest pin</PipelineRow>
              <PipelineRow done={pubStatus.kind === "running" && pubStatus.step.includes("Step 1") || pubStatus.kind === "ok"}>
                ENS subname created
              </PipelineRow>
              <PipelineRow done={pubStatus.kind === "ok"}>
                3× setText (root + version + schema)
              </PipelineRow>
            </ol>
          </div>
          {pinnedRoot && (
            <div>
              <h3 className="text-[10px] uppercase tracking-wider text-slate-ink">
                Resulting ENS records
              </h3>
              <dl className="mt-2 grid grid-cols-[80px_1fr] gap-y-1">
                <dt className="text-slate-ink">.skill</dt>
                <dd className="break-all">0g://{pinnedRoot.slice(0, 16)}…</dd>
                <dt className="text-slate-ink">.version</dt>
                <dd>{version}</dd>
                <dt className="text-slate-ink">.schema</dt>
                <dd className="break-all">manifest.eth/…/v1.json</dd>
              </dl>
            </div>
          )}
        </aside>
      </main>
    </aside>
  );
}

function PinHealthBadge({ health }: { health: PinHealth | null }) {
  if (health === null) {
    return <span className="font-mono text-[10px] text-slate-ink">probing pin-service…</span>;
  }
  if (!health.ok) {
    return (
      <span
        className="font-mono text-[10px] text-bento-accent-red"
        title={`pin-service unreachable at ${PIN_SERVICE}`}
      >
        ● pin-service offline
      </span>
    );
  }
  if (!health.keyConfigured) {
    return (
      <span className="font-mono text-[10px] text-bento-accent-red" title="server has no SEPOLIA_PRIVATE_KEY">
        ● key missing
      </span>
    );
  }
  return (
    <span className="font-mono text-[10px] text-bento-success" title={PIN_SERVICE}>
      ● pin-service ready
    </span>
  );
}

function PipelineRow({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-baseline gap-2">
      <span className={done ? "text-bento-success" : "text-fog-border"}>{done ? "✓" : "○"}</span>
      <span className={done ? "text-midnight-navy" : "text-storm-gray"}>{children}</span>
    </li>
  );
}

const input =
  "w-full bg-pure-surface border border-fog-border rounded px-3 py-2 outline-none focus:border-midnight-navy font-mono text-sm";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-3 items-center">
      <span className="font-mono text-[10px] uppercase tracking-wider text-slate-ink">
        {label}
      </span>
      {children}
    </label>
  );
}
