import { useEffect, useState } from "react";
import { resolveSkill, type ResolvedSkill } from "../lib/skill-resolve";

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

      {/* CID line */}
      <div className="mt-3 min-h-[20px] font-mono text-xs">
        {error && <div className="text-bento-accent-red">error · {error}</div>}
        {result && !error && (
          <div className="text-bento-success break-all">
            {result.cid} · validated{result.resolvedFromRange && ` · resolved from ${result.resolvedFromRange}`}
          </div>
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

      {/* Bundle integrity + tools count footer */}
      <div className="mt-8 pt-6 border-t border-bento-border flex items-end justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-bento-text-secondary">
            BUNDLE INTEGRITY
          </div>
          <div className="mt-2 flex items-end gap-1 h-6">
            {[3, 4, 6, 5, 7, 8, 6, 9].map((h, i) => (
              <span
                key={i}
                className="block w-1.5 bg-bento-text-display/40"
                style={{ height: `${h * 3}px` }}
              />
            ))}
          </div>
        </div>
        <div className="text-right">
          <div className="font-doto text-5xl text-bento-text-display">
            {String(tools.length).padStart(3, "0")}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-bento-text-secondary">
            TOOLS REGISTERED
          </div>
        </div>
      </div>
    </article>
  );
}
