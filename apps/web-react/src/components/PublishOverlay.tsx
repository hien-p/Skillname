import { useMemo, useState } from "react";
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

interface Props {
  onClose: () => void;
}

type Status =
  | { kind: "idle" }
  | { kind: "running"; step: string }
  | { kind: "ok"; lastTx: Hex }
  | { kind: "err"; msg: string };

export function PublishOverlay({ onClose }: Props) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: sepolia.id });
  const { writeContractAsync } = useWriteContract();

  // Form state
  const [parent, setParent] = useState("skilltest.eth");
  const [label, setLabel] = useState("my-new-skill");
  const [name, setName] = useState("my-new-skill");
  const [version, setVersion] = useState("1.0.0");
  const [description, setDescription] = useState("");
  const [exec, setExec] = useState<"http" | "local">("http");
  const [endpoint, setEndpoint] = useState("https://api.example.com/v1/run");
  const [cid, setCid] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const fullName = `${label}.${parent}`;
  const wrongChain = isConnected && chainId !== sepolia.id;

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

  const valid =
    /^[a-z0-9-]+$/.test(label) &&
    /^[a-z0-9-]+\.eth$/.test(parent) &&
    /^[a-z0-9-]+$/.test(name) &&
    /^\d+\.\d+\.\d+$/.test(version) &&
    cid.length > 5;

  async function handlePublish() {
    if (!isConnected || !address) {
      setStatus({ kind: "err", msg: "Connect wallet first" });
      return;
    }
    if (wrongChain) {
      try {
        await switchChainAsync({ chainId: sepolia.id });
      } catch (e) {
        setStatus({ kind: "err", msg: `Switch to Sepolia first: ${(e as Error).message}` });
        return;
      }
    }

    const parentNode = namehash(parent);
    const subNode = namehash(fullName);
    const labelHash = keccak256(toBytes(label));

    try {
      // 0. Sanity: do we own the parent? (read-only — saves a wasted signature)
      if (publicClient) {
        const parentOwner = (await publicClient.readContract({
          address: ENS_REGISTRY,
          abi: ENS_REGISTRY_ABI,
          functionName: "owner",
          args: [parentNode],
        })) as `0x${string}`;
        if (parentOwner.toLowerCase() !== address.toLowerCase()) {
          setStatus({
            kind: "err",
            msg: `You don't own ${parent} (owner is ${parentOwner.slice(0, 10)}…). Try a parent you control.`,
          });
          return;
        }
      }

      // 1. setSubnodeRecord — creates the subname pointing at PublicResolver
      setStatus({ kind: "running", step: `Step 1/4 · setSubnodeRecord(${fullName})` });
      const tx1 = await writeContractAsync({
        address: ENS_REGISTRY,
        abi: ENS_REGISTRY_ABI,
        functionName: "setSubnodeRecord",
        args: [parentNode, labelHash, address, RESOLVER, 0n],
      });
      await publicClient!.waitForTransactionReceipt({ hash: tx1 });

      // 2-4. setText × 3
      const records: [string, string][] = [
        ["xyz.manifest.skill", `0g://${cid.startsWith("0x") ? cid : "0x" + cid}`],
        ["xyz.manifest.skill.version", version],
        ["xyz.manifest.skill.schema", SCHEMA_URL],
      ];
      let lastTx: Hex = tx1;
      for (let i = 0; i < records.length; i++) {
        const [k, v] = records[i];
        setStatus({
          kind: "running",
          step: `Step ${i + 2}/4 · setText(${k})`,
        });
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
        cid,
        txHash: lastTx,
        ts: Date.now(),
      });
      setStatus({ kind: "ok", lastTx });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus({ kind: "err", msg: msg.slice(0, 240) });
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
          <h1 className="font-display text-4xl">Bind a function to an ENS name</h1>
          <p className="font-body text-sm text-slate-ink mt-2 max-w-2xl">
            Four signed transactions on Sepolia: <code className="font-mono">setSubnodeRecord</code> creates
            the subname under your parent, then <code className="font-mono">setText</code> × 3 publishes
            the bundle pointer + version + schema URL. After this lands, anyone can{" "}
            <code className="font-mono">resolveSkill(&quot;{label}.{parent}&quot;)</code> from any RPC.
          </p>

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
            <Row label="0G manifest CID">
              <input
                value={cid}
                onChange={(e) => setCid(e.target.value.trim())}
                className={input}
                placeholder="0x… (run `pnpm cli skill publish` first to pin to 0G)"
              />
            </Row>
          </div>

          <div className="mt-8 flex items-center gap-3">
            <button
              onClick={handlePublish}
              disabled={!valid || !isConnected || status.kind === "running"}
              className="px-5 py-2 bg-chartreuse-pulse text-bento-black font-mono text-xs uppercase tracking-wider disabled:opacity-40 hover:-translate-y-px transition"
            >
              {status.kind === "running" ? "Signing…" : `Publish ${fullName} →`}
            </button>
            {!isConnected && (
              <span className="font-mono text-xs text-slate-ink">Connect wallet first ↑</span>
            )}
            {!valid && isConnected && (
              <span className="font-mono text-xs text-slate-ink">Fill all fields including a 0G CID</span>
            )}
          </div>

          <div className="mt-4 min-h-[80px] font-mono text-xs">
            {status.kind === "running" && (
              <div className="text-midnight-navy">{status.step}…</div>
            )}
            {status.kind === "ok" && (
              <div className="bg-bento-success/10 text-bento-success rounded p-3 break-all">
                ✓ Published {fullName} — last tx{" "}
                <a
                  href={`https://sepolia.etherscan.io/tx/${status.lastTx}`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  {status.lastTx.slice(0, 14)}… ↗
                </a>
              </div>
            )}
            {status.kind === "err" && (
              <div className="bg-bento-accent-red/10 text-bento-accent-red rounded p-3 break-all">
                ✗ {status.msg}
              </div>
            )}
          </div>
        </section>

        <aside className="font-mono text-xs space-y-4">
          <div>
            <h3 className="text-[10px] uppercase tracking-wider text-slate-ink">Manifest preview</h3>
            <pre className="mt-2 bg-bento-black text-bento-text-primary p-3 rounded text-[10px] overflow-auto max-h-72">
{JSON.stringify(manifest, null, 2)}
            </pre>
          </div>
          <div>
            <h3 className="text-[10px] uppercase tracking-wider text-slate-ink">Resulting ENS records</h3>
            <dl className="mt-2 grid grid-cols-[140px_1fr] gap-y-1">
              <dt className="text-slate-ink">Subname</dt>
              <dd className="break-all">{fullName}</dd>
              <dt className="text-slate-ink">Resolver</dt>
              <dd className="break-all">{RESOLVER.slice(0, 10)}…</dd>
              <dt className="text-slate-ink">Records</dt>
              <dd>3 setText calls</dd>
            </dl>
          </div>
        </aside>
      </main>
    </aside>
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
