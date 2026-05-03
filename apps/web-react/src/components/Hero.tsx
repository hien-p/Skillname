import { useEffect, useState } from "react";
import { resolveSkill, type ResolvedSkill } from "../lib/skill-resolve";
import { OGStorageBadge } from "./OGStorageBadge";
import { CATALOG_ITEMS } from "./SkillCatalog";
import { FLAT_TOOLS } from "./ToolsOverlay";

interface HeroProps {
  onResolved: (ens: string, r: ResolvedSkill) => void;
}

export function Hero({ onResolved }: HeroProps) {
  const [input, setInput] = useState("quote.skilltest.eth");
  const [chain, setChain] = useState<"sepolia" | "mainnet">("sepolia");
  const [result, setResult] = useState<ResolvedSkill | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  async function run() {
    if (!input) return;
    setBusy(true);
    setError(null);
    try {
      const r = await resolveSkill(input, chain);
      setResult(r);
      onResolved(input, r);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const tools = result?.manifest.tools ?? [];
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ms = result?.ms ?? null;

  return (
    <article className="bg-bento-surface text-bento-text-primary rounded-2xl p-8 border border-bento-border relative overflow-hidden col-span-12 lg:col-span-8">
      {/* Doto clock + resolve time */}
      <div className="flex justify-between items-start">
        <div className="font-doto text-7xl md:text-8xl text-bento-text-display leading-none">
          {hh}:{mm}
        </div>
        <div className="text-right font-mono text-[10px] uppercase tracking-wider text-bento-text-secondary">
          <div>resolver · 0.18s</div>
          <div className="mt-1">resolve time</div>
          <div className="text-bento-text-display text-base mt-1">
            {ms ? `${ms} ms` : "—"}
          </div>
          <div className="mt-3">signal</div>
          <div className="text-bento-text-display text-sm mt-1">UNIVERSAL · ENS</div>
        </div>
      </div>

      {/* Resolver */}
      <div className="mt-8">
        <div className="font-mono text-[10px] uppercase tracking-wider text-bento-text-secondary">
          RESOLVE AN ENS SKILL NAME
        </div>
        <div className="mt-3 flex items-center gap-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder="quote.skilltest.eth or quote.skilltest.eth@^1"
            className="flex-1 bg-transparent border-b border-bento-border text-2xl font-mono py-2 outline-none focus:border-bento-text-display text-bento-text-display"
          />
          <button
            onClick={() => setChain(chain === "sepolia" ? "mainnet" : "sepolia")}
            className="font-mono text-[10px] uppercase tracking-wider px-3 py-2 border border-bento-border text-bento-text-secondary hover:text-bento-text-display"
          >
            {chain}
          </button>
          <button
            onClick={run}
            disabled={busy}
            className="font-mono text-xs font-semibold uppercase tracking-wider px-5 py-2 bg-chartreuse-pulse text-bento-black disabled:opacity-50 hover:-translate-y-px transition"
          >
            {busy ? "…" : "RESOLVE"}
          </button>
        </div>
      </div>

      {/* Storage badge + CID line */}
      <div className="mt-3 min-h-[28px] font-mono text-xs space-y-2">
        {error && <div className="text-bento-accent-red">error · {error}</div>}
        {result && !error && (
          <>
            <OGStorageBadge storage={result.storage} ensMs={result.ensMs} variant="dark" />
            {result.resolvedFromRange && (
              <div className="text-bento-text-secondary text-[10px] uppercase tracking-wider">
                resolved from {result.resolvedFromRange}
              </div>
            )}
          </>
        )}
      </div>

      {/* Tools list */}
      {result && (
        <div className="mt-2 space-y-1">
          {tools.map((t) => (
            <div key={t.name} className="font-mono text-xs text-bento-text-secondary">
              <span className="text-bento-text-display">{result.manifest.name}__{t.name}</span>{" "}
              <span>{t.execution.type}</span>
            </div>
          ))}
        </div>
      )}

      {/* Registry chart + tools count footer — the wedge in one picture:
          bar height = how many MCP tools the agent actually gets when this
          ENS is loaded. Leaves = 1 tool. Composite (agent.skilltest.eth) =
          1 root + N transitive imports, towers over the leaves. */}
      <div className="mt-8 pt-6 border-t border-bento-border grid grid-cols-[1fr_auto] gap-8 items-end">
        <div>
          <div className="flex items-baseline justify-between font-mono text-[10px] uppercase tracking-wider text-bento-text-secondary">
            <span>
              REACH PER SKILL · tools available after one ENS load
            </span>
            <span className="text-bento-success">
              {CATALOG_ITEMS.length}/{CATALOG_ITEMS.length} ENSIP-25 BOUND
            </span>
          </div>
          {(() => {
            const data = CATALOG_ITEMS.map((it) => {
              const ownTools = FLAT_TOOLS.filter((t) => t.ens === it.ens).length;
              const isComposite = it.badge?.includes("composite");
              const reach = isComposite ? ownTools + 3 : ownTools;
              return {
                ens: it.ens,
                label: it.ens.replace(".skilltest.eth", ""),
                reach,
                isComposite: !!isComposite,
              };
            });
            const max = Math.max(...data.map((d) => d.reach));
            const MAX_PX = 64;
            const MIN_PX = 14;
            return (
              <>
                {/* y-axis hint */}
                <div className="mt-3 flex items-end gap-2">
                  <div className="flex flex-col justify-between h-[88px] py-1 font-mono text-[9px] text-bento-text-secondary/60 text-right pr-1">
                    <span>{max}</span>
                    <span>{Math.ceil(max / 2)}</span>
                    <span>0</span>
                  </div>
                  <div className="flex-1 flex items-end justify-between gap-2 h-[88px] border-l border-b border-bento-border/40 px-2 pb-1 relative">
                    {/* gridlines */}
                    <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-bento-border/30 pointer-events-none" />
                    {data.map((d) => {
                      const px = Math.round(MIN_PX + ((MAX_PX - MIN_PX) * d.reach) / max);
                      return (
                        <div
                          key={d.ens}
                          className="relative flex-1 flex flex-col items-center justify-end group cursor-default"
                          title={`${d.ens} · ${d.reach} reachable tool(s)${d.isComposite ? ` (1 own + ${d.reach - 1} via imports)` : ""}`}
                        >
                          <span className="absolute -top-1 font-mono text-[10px] text-bento-text-display opacity-0 group-hover:opacity-100 transition-opacity">
                            {d.reach}
                          </span>
                          <span
                            className={`block w-full max-w-[28px] rounded-t-sm transition-colors ${
                              d.isComposite
                                ? "bg-chartreuse-pulse shadow-[0_0_12px_rgba(208,241,0,0.4)]"
                                : "bg-chartreuse-pulse/30 group-hover:bg-chartreuse-pulse/60"
                            }`}
                            style={{ height: `${px}px` }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
                {/* x-axis labels */}
                <div className="mt-1 ml-[28px] flex justify-between gap-2 px-2">
                  {data.map((d) => (
                    <span
                      key={d.ens}
                      className={`flex-1 text-center font-mono text-[10px] uppercase tracking-wider truncate ${
                        d.isComposite ? "text-bento-text-display font-semibold" : "text-bento-text-secondary"
                      }`}
                    >
                      {d.label}
                    </span>
                  ))}
                </div>
                <div className="mt-3 font-mono text-[10px] text-bento-text-secondary flex items-center gap-4">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5 bg-chartreuse-pulse rounded-sm"></span>
                    composite — auto-loads imports
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5 bg-chartreuse-pulse/30 rounded-sm"></span>
                    atomic leaf
                  </span>
                </div>
              </>
            );
          })()}
        </div>
        <div className="text-right shrink-0">
          <div className="font-doto text-5xl text-bento-text-display leading-none">
            {String(FLAT_TOOLS.length).padStart(3, "0")}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-bento-text-secondary mt-2">
            TOOLS REGISTERED
            <br />
            across {CATALOG_ITEMS.length} skills
          </div>
        </div>
      </div>
    </article>
  );
}
