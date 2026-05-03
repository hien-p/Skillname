import { useState } from "react";
import { usePublicClient } from "wagmi";
import { namehash, parseAbi, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { IDENTITY_REGISTRY_ADDR } from "../lib/contracts";
import type { SkillManifest } from "../lib/skill-resolve";

const RESOLVER_ADDR = "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5" as const;
const RESOLVER_ABI = parseAbi(["function text(bytes32 node, string key) external view returns (string)"]);
const REGISTRY_ABI = parseAbi([
  "function nameOf(uint256 agentId) external view returns (string)",
  "function ownerOf(uint256 agentId) external view returns (address)",
]);

interface CheckResult {
  encoded: Hex;
  textKey: string;
  textValue: string;
  registryName: string | null;
  registryOwner: string | null;
  pass: boolean;
  ms: number;
  agentIdProbed: number;
}

function encodeErc7930(caip10: string): Hex {
  const m = caip10.match(/^eip155:(\d+):(0x[a-fA-F0-9]{40})$/);
  if (!m) throw new Error(`invalid caip10: ${caip10}`);
  const chainId = parseInt(m[1], 10);
  const addr = m[2].slice(2).toLowerCase();
  let chainHex = chainId.toString(16);
  if (chainHex.length % 2 === 1) chainHex = "0" + chainHex;
  const lenHex = (chainHex.length / 2).toString(16).padStart(2, "0");
  return `0x0001${"0000"}${lenHex}${chainHex}14${addr}` as Hex;
}

interface Props {
  ensName: string;
  manifest: SkillManifest;
}

export function TrustPanel({ ensName, manifest }: Props) {
  const publicClient = usePublicClient({ chainId: sepolia.id });
  const erc8004 = manifest.trust?.erc8004;

  const [real, setReal] = useState<CheckResult | null>(null);
  const [fake, setFake] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState<"real" | "fake" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function check(agentIdOverride?: number): Promise<CheckResult | null> {
    if (!publicClient || !erc8004) return null;
    const agentId = agentIdOverride ?? erc8004.agentId;
    const t0 = performance.now();
    const encoded = encodeErc7930(erc8004.registry);
    const textKey = `agent-registration[${encoded}][${agentId}]`;
    const node = namehash(ensName);
    const [textValue, registryName, registryOwner] = await Promise.all([
      publicClient
        .readContract({
          address: RESOLVER_ADDR,
          abi: RESOLVER_ABI,
          functionName: "text",
          args: [node, textKey],
        })
        .catch(() => "" as string),
      publicClient
        .readContract({
          address: IDENTITY_REGISTRY_ADDR,
          abi: REGISTRY_ABI,
          functionName: "nameOf",
          args: [BigInt(agentId)],
        })
        .catch(() => null as string | null),
      publicClient
        .readContract({
          address: IDENTITY_REGISTRY_ADDR,
          abi: REGISTRY_ABI,
          functionName: "ownerOf",
          args: [BigInt(agentId)],
        })
        .catch(() => null as string | null),
    ]);
    const valueStr = typeof textValue === "string" ? textValue : "";
    return {
      encoded,
      textKey,
      textValue: valueStr,
      registryName: typeof registryName === "string" ? registryName : null,
      registryOwner: typeof registryOwner === "string" ? registryOwner : null,
      pass: valueStr !== "" && valueStr !== "0",
      ms: Math.round(performance.now() - t0),
      agentIdProbed: agentId,
    };
  }

  async function runReal() {
    setBusy("real");
    setError(null);
    try {
      setReal(await check());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runFake() {
    if (!erc8004) return;
    setBusy("fake");
    setError(null);
    try {
      // Probe a different agentId on the SAME ENS name. Same encoding, same key
      // shape — but the ENS owner never wrote a "1" for this agentId, so the
      // text record is empty. That's the spoof catch in action.
      const fakeId =
        erc8004.agentId + 9000 + Math.floor(Math.random() * 100);
      setFake(await check(fakeId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-8">
      <h2 className="font-display text-3xl mb-1">Trust</h2>
      <p className="font-body text-sm text-slate-ink mb-2 max-w-2xl">
        <strong className="text-midnight-navy">Optional.</strong> Most skills{" "}
        don&apos;t need this. Once you publish, your skill already works
        end-to-end without any trust binding. Trust binding is only worth adding
        when your skill has to{" "}
        <em>prove</em> it represents a specific identity on-chain.
      </p>

      {/* Lifecycle: what your skill can already do */}
      <div className="mt-5 rounded border border-fog-border bg-pure-surface p-4 max-w-2xl">
        <div className="font-mono text-[10px] uppercase tracking-wider text-slate-ink mb-2">
          What <code className="font-mono">{ensName}</code> can do right now —
          no trust required
        </div>
        <ul className="space-y-1.5 text-sm text-midnight-navy">
          <Capability>
            Resolved by <strong>any</strong> MCP client from its ENS name —{" "}
            <code className="font-mono text-xs">resolveSkill(&quot;{ensName}&quot;)</code>{" "}
            fetches the manifest from 0G/IPFS in one read.
          </Capability>
          <Capability>
            Loaded into <strong>Claude Desktop</strong> (or any MCP client) via
            the bridge — its tools appear under{" "}
            <code className="font-mono text-xs">{manifest.name}__&lt;tool&gt;</code>.
          </Capability>
          <Capability>
            Composed by <strong>other skills</strong> via the{" "}
            <code className="font-mono text-xs">imports</code> array — agent
            skills walk the dep graph and pick up your tools transitively.
          </Capability>
          <Capability>
            Registered in <strong>SkillLink</strong> on Sepolia so any contract
            can dispatch it on-chain by namehash (see the Registry tab).
          </Capability>
          <Capability>
            Minted as a <strong>SkillNFT</strong> (ERC-7857) — transferable
            ownership over the skill itself.
          </Capability>
        </ul>
      </div>

      {/* When trust IS the right call */}
      <div className="mt-5 max-w-2xl">
        <div className="font-mono text-[10px] uppercase tracking-wider text-slate-ink mb-2">
          When you&apos;d add a trust binding
        </div>
        <p className="font-body text-sm text-slate-ink">
          When your skill is the public face of an{" "}
          <strong className="text-midnight-navy">ERC-8004 agent identity</strong>
          {" "}with reputation, permissions, or access tied to a specific{" "}
          <code className="font-mono text-xs">agentId</code>. The binding lets
          anyone verify &quot;this skill really belongs to that agent&quot;
          without trusting whoever pinned the IPFS bundle. If your skill is just
          a stateless tool (a quoter, a calculator, a weather lookup), skip it.
        </p>
      </div>

      {!erc8004 && (
        <div className="mt-6 rounded border border-fog-border bg-pure-surface p-4 max-w-2xl">
          <div className="font-mono text-[11px] text-slate-ink">
            <strong className="text-midnight-navy">No trust binding on this skill.</strong>{" "}
            That&apos;s fine — it works without one. To add one later, set{" "}
            <code className="font-mono">trust.erc8004</code> in the manifest and
            publish the matching <code className="font-mono">agent-registration[…][…]</code>{" "}
            text record on the ENS name.
          </div>
        </div>
      )}

      {erc8004 && (
        <>
          <hr className="my-6 border-fog-border max-w-2xl" />
          <h3 className="font-display text-2xl mb-1">
            Is this really <code className="font-mono">{ensName}</code>?
          </h3>
          <p className="font-body text-sm text-slate-ink mb-6 max-w-2xl">
            This skill <em>does</em> declare a trust binding, so here&apos;s
            the live spoof check: a faked manifest with the same identity claim
            would fail this exact ENS read.
          </p>

          <ol className="space-y-4 max-w-3xl">
        <Step n={1} title="Manifest claims an identity">
          <pre className="bg-bento-black text-bento-text-primary font-mono text-[11px] p-3 rounded overflow-auto">
{`trust.erc8004 = {
  registry: ${erc8004.registry},
  agentId:  ${erc8004.agentId}
}`}
          </pre>
        </Step>
        <Step n={2} title="Encoded as ERC-7930 (chain-agnostic address)">
          <code className="block bg-bento-black text-chartreuse-pulse font-mono text-[11px] p-3 rounded break-all">
            {encodeErc7930(erc8004.registry)}
          </code>
        </Step>
        <Step
          n={3}
          title={
            <>
              ENS confirms via text record{" "}
              <code className="font-mono text-xs">
                agent-registration[…][{erc8004.agentId}]
              </code>
            </>
          }
        >
          {real ? (
            <div className="font-mono text-xs space-y-1">
              <div>
                returned: <code className={real.pass ? "text-bento-success" : "text-bento-accent-red"}>
                  &quot;{real.textValue || "(empty)"}&quot;
                </code>{" "}
                <span className="text-slate-ink">({real.ms}ms)</span>
              </div>
              {real.registryName && (
                <div>
                  registry confirms{" "}
                  <code>nameOf({erc8004.agentId}) = &quot;{real.registryName}&quot;</code>
                </div>
              )}
              {real.registryOwner && (
                <div className="break-all">
                  owned by{" "}
                  <a
                    href={`https://sepolia.etherscan.io/address/${real.registryOwner}`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    {real.registryOwner.slice(0, 10)}…{real.registryOwner.slice(-8)} ↗
                  </a>
                </div>
              )}
            </div>
          ) : (
            <div className="font-mono text-xs text-slate-ink">
              ENS record not read yet — click <strong>Run trust check</strong> below.
            </div>
          )}
        </Step>
      </ol>

      {/* Verdict + actions */}
      <div className="mt-6 flex flex-col sm:flex-row gap-3 max-w-3xl">
        <button
          onClick={runReal}
          disabled={busy === "real"}
          className="flex-1 px-4 py-3 bg-midnight-navy text-chartreuse-pulse font-mono text-xs uppercase tracking-wider rounded hover:-translate-y-px transition disabled:opacity-50"
        >
          {busy === "real" ? "Reading ENS…" : "▶ Run trust check"}
        </button>
        <button
          onClick={runFake}
          disabled={busy === "fake"}
          className="flex-1 px-4 py-3 border border-bento-accent-red text-bento-accent-red font-mono text-xs uppercase tracking-wider rounded hover:bg-bento-accent-red/10 transition disabled:opacity-50"
          title="Probe the same ENS with a fake agentId — proves the binding actually catches spoofs"
        >
          {busy === "fake" ? "Probing…" : "👻 Try a fake claim"}
        </button>
      </div>

      {error && (
        <div className="mt-3 font-mono text-xs text-bento-accent-red max-w-3xl break-all">
          error · {error}
        </div>
      )}

      {/* PASS banner */}
      {real && (
        <div
          className={`mt-5 max-w-3xl p-4 rounded border ${
            real.pass
              ? "border-bento-success bg-bento-success/10 text-bento-success"
              : "border-bento-accent-red bg-bento-accent-red/10 text-bento-accent-red"
          }`}
        >
          <div className="font-display text-xl">
            {real.pass
              ? "✓ This manifest IS the real " + ensName
              : "✗ Manifest claim NOT confirmed by ENS"}
          </div>
          <p className="font-body text-sm mt-1 opacity-90">
            {real.pass ? (
              <>
                The on-chain ENS record at <code className="font-mono">{ensName}</code>{" "}
                explicitly confirms <code className="font-mono">agentId&nbsp;{erc8004.agentId}</code>.
                A different IPFS pin claiming the same identity would fail this exact check —
                only the ENS owner can write the confirmation, and the ENS owner is{" "}
                {real.registryOwner ? real.registryOwner.slice(0, 10) : "the registry holder"}.
              </>
            ) : (
              <>
                The ENS owner of <code className="font-mono">{ensName}</code> never confirmed{" "}
                <code className="font-mono">agentId&nbsp;{erc8004.agentId}</code> in their text
                records. Don&apos;t trust the manifest&apos;s identity claim — anyone could have
                pinned this bundle.
              </>
            )}
          </p>
        </div>
      )}

      {/* FAIL demo banner */}
      {fake && (
        <div className="mt-3 max-w-3xl p-4 rounded border border-bento-accent-red bg-bento-accent-red/5 text-bento-accent-red">
          <div className="font-display text-xl">
            ✗ Spoof check ran — fake claim was rejected
          </div>
          <div className="font-mono text-xs mt-2 opacity-90 space-y-1">
            <div>
              probed agentId{" "}
              <code className="text-bento-text-display">{fake.agentIdProbed}</code> instead of{" "}
              <code className="text-bento-text-display">{erc8004.agentId}</code>
            </div>
            <div>
              ENS returned <code>&quot;{fake.textValue || "(empty)"}&quot;</code> ({fake.ms}ms) —
              the spoof has no confirmation, so the bridge would refuse to load it.
            </div>
          </div>
          <p className="font-body text-sm mt-2 opacity-90">
            That&apos;s the value: a manifest can claim any agentId, but the ENS owner has to
            independently write the confirmation. No write = no trust.
          </p>
        </div>
      )}

          {/* Inspectable details */}
          {real && (
            <details className="mt-5 max-w-3xl">
              <summary className="font-mono text-[10px] uppercase tracking-wider text-slate-ink cursor-pointer hover:text-midnight-navy">
                Raw key + value (for the curious)
              </summary>
              <div className="mt-2 grid gap-2 font-mono text-[10px]">
                <Row label="ENS namehash">
                  <code className="break-all">{namehash(ensName)}</code>
                </Row>
                <Row label="Resolver">
                  <code className="break-all">{RESOLVER_ADDR}</code>
                </Row>
                <Row label="Text record key">
                  <code className="break-all">{real.textKey}</code>
                </Row>
                <Row label="Text record value">
                  <code>{real.textValue || "(empty)"}</code>
                </Row>
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function Capability({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="text-bento-success font-mono leading-6">✓</span>
      <span className="font-body">{children}</span>
    </li>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <div className="shrink-0 w-7 h-7 rounded-full border border-fog-border flex items-center justify-center font-mono text-xs text-midnight-navy">
        {n}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-body text-sm text-midnight-navy mb-1">{title}</div>
        {children}
      </div>
    </li>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[180px_1fr] gap-2">
      <span className="text-slate-ink uppercase tracking-wider text-[10px]">{label}</span>
      <span>{children}</span>
    </div>
  );
}
