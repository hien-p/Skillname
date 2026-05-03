import { useEffect, useState } from "react";
import { resolveSkill, type ResolvedSkill } from "../lib/skill-resolve";

const TABS = ["Readme", "Tools", "Trust"] as const;
type Tab = typeof TABS[number];

interface Props {
  ensName: string;
  onClose: () => void;
}

export function SkillDetail({ ensName, onClose }: Props) {
  const [r, setR] = useState<ResolvedSkill | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("Readme");

  useEffect(() => {
    setR(null);
    setError(null);
    resolveSkill(ensName, "sepolia").then(setR).catch((e) => setError(String(e?.message ?? e)));
  }, [ensName]);

  return (
    <aside className="fixed inset-0 z-40 bg-ghost-canvas text-midnight-navy overflow-y-auto">
      <header className="sticky top-0 bg-ghost-canvas/90 backdrop-blur border-b border-fog-border px-6 py-4 flex items-center justify-between">
        <button
          onClick={onClose}
          className="px-3 py-1 border border-fog-border rounded-full font-mono text-xs hover:border-midnight-navy"
        >
          ← Back
        </button>
        <div className="text-center">
          <div className="font-mono text-base">{ensName}</div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-slate-ink">
            {r ? `resolved · ${r.ms} ms · ${r.cid.slice(0, 5)}://` : error ? `error · ${error}` : "resolving…"}
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 rounded-full hover:bg-pure-surface flex items-center justify-center"
          aria-label="close"
        >
          ×
        </button>
      </header>

      {r && (
        <main className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-[200px_1fr_320px] gap-8">
          <nav className="space-y-1 font-display text-lg">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`w-full text-left px-3 py-2 rounded ${
                  tab === t
                    ? "bg-pure-surface text-midnight-navy shadow-sm"
                    : "text-slate-ink hover:text-midnight-navy"
                }`}
              >
                {t}
                {t === "Tools" && (
                  <span className="ml-2 text-xs text-slate-ink">{r.manifest.tools.length}</span>
                )}
              </button>
            ))}
          </nav>

          <section>
            <div className="font-mono text-[10px] uppercase tracking-wider text-slate-ink">
              SKILL · ATOMIC FUNCTION
            </div>
            <h1 className="font-display text-6xl mt-2">{r.manifest.name}</h1>
            <div className="mt-2 font-mono text-sm text-slate-ink">
              v{r.manifest.version} · {r.manifest.license ?? "MIT"} · {r.manifest.ensName}
            </div>

            {tab === "Readme" && (
              <div className="mt-8 font-display text-lg max-w-2xl">
                <h2 className="font-display text-3xl mb-4">Readme</h2>
                <p>{r.manifest.description}</p>
                <p className="mt-4 text-sm text-slate-ink font-body">
                  This skill exposes <b>{r.manifest.tools.length}</b> atomic tool(s), routed
                  through the <code className="font-mono">{r.manifest.tools[0]?.execution.type}</code>{" "}
                  executor in the bridge. It complies with the{" "}
                  <code className="font-mono">skill-v1.json</code> schema and is content-addressed
                  on 0G storage; the CID above is the canonical pinned root.
                </p>
              </div>
            )}

            {tab === "Tools" && (
              <div className="mt-8">
                <h2 className="font-display text-3xl mb-4">Tools</h2>
                <div className="space-y-3">
                  {r.manifest.tools.map((t) => (
                    <div
                      key={t.name}
                      className="border border-fog-border rounded p-4 bg-pure-surface"
                    >
                      <div className="font-mono text-sm font-semibold">
                        {r.manifest.name}__{t.name}
                      </div>
                      <div className="font-mono text-[10px] uppercase tracking-wider text-slate-ink mt-1">
                        {t.execution.type}
                      </div>
                      <p className="font-body text-sm mt-2 text-storm-gray">{t.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === "Trust" && (
              <div className="mt-8">
                <h2 className="font-display text-3xl mb-4">Trust</h2>
                <ul className="space-y-2">
                  <li className="flex items-center gap-2">
                    <Pip ok={r.manifest.trust?.ensip25?.enabled ?? false} />
                    ENSIP-25 — {r.manifest.trust?.ensip25?.enabled ? "enabled" : "disabled"}
                  </li>
                  <li className="flex items-start gap-2">
                    <Pip ok={!!r.manifest.trust?.erc8004} />
                    {r.manifest.trust?.erc8004 ? (
                      <span>
                        ERC-8004 binding — registry{" "}
                        <code className="font-mono text-xs break-all">
                          {r.manifest.trust.erc8004.registry}
                        </code>{" "}
                        · agentId {r.manifest.trust.erc8004.agentId}
                      </span>
                    ) : (
                      <span>ERC-8004 binding — none</span>
                    )}
                  </li>
                </ul>
                {r.manifest.trust?.erc8004 && (
                  <div className="mt-4 text-sm text-slate-ink font-body">
                    Verifiable on-chain via{" "}
                    <a
                      href={`https://sepolia.etherscan.io/address/${r.manifest.trust.erc8004.registry.split(":").pop()}`}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      Sepolia Etherscan ↗
                    </a>
                    . The ENS text record key{" "}
                    <code className="font-mono text-xs">
                      agent-registration[&lt;erc7930&gt;][{r.manifest.trust.erc8004.agentId}]
                    </code>{" "}
                    proves the bidirectional binding per ENSIP-25.
                  </div>
                )}
              </div>
            )}
          </section>

          <aside className="font-mono text-xs space-y-4">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-ink">Install</div>
              <div className="mt-2 bg-bento-black text-chartreuse-pulse rounded p-2 break-all">
                Use {r.manifest.ensName}
              </div>
              <p className="text-[11px] text-slate-ink mt-2 font-body">
                Type this in Claude Desktop after wiring the bridge MCP server.
              </p>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-ink">Source</div>
              <dl className="mt-2 grid grid-cols-[60px_1fr] gap-y-1">
                <dt className="text-slate-ink">ENS</dt>
                <dd className="break-all">{r.manifest.ensName}</dd>
                <dt className="text-slate-ink">Key</dt>
                <dd>xyz.manifest.skill</dd>
                <dt className="text-slate-ink">URI</dt>
                <dd className="break-all">{r.cid}</dd>
              </dl>
            </div>
          </aside>
        </main>
      )}
    </aside>
  );
}

function Pip({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full mt-1.5 ${
        ok ? "bg-bento-success" : "bg-fog-border"
      }`}
    />
  );
}
