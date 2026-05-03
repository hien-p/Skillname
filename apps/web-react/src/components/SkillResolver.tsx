import { useState } from "react";
import { resolveSkill, type ResolvedSkill } from "../lib/skill-resolve";

export function SkillResolver() {
  const [input, setInput] = useState("quote.skilltest.eth");
  const [chain, setChain] = useState<"sepolia" | "mainnet">("sepolia");
  const [result, setResult] = useState<ResolvedSkill | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!input) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await resolveSkill(input, chain);
      setResult(r);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-bento-border bg-bento-surface p-6 text-bento-text-primary font-mono">
      <div className="text-xs uppercase tracking-wider text-bento-text-secondary">
        Resolve an ENS skill name
      </div>

      <div className="mt-3 flex items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") run();
          }}
          placeholder="quote.skilltest.eth or quote.skilltest.eth@^1"
          className="flex-1 bg-transparent border-b border-bento-border text-2xl py-2 outline-none focus:border-bento-text-display"
        />
        <button
          onClick={() => setChain(chain === "sepolia" ? "mainnet" : "sepolia")}
          className="text-[10px] uppercase tracking-wider px-2 py-1 border border-bento-border text-bento-text-secondary hover:text-bento-text-display"
        >
          {chain}
        </button>
        <button
          onClick={run}
          disabled={busy}
          className="text-xs font-semibold uppercase tracking-wider px-4 py-2 bg-chartreuse-pulse text-bento-black disabled:opacity-50 hover:-translate-y-px transition"
        >
          {busy ? "…" : "Resolve"}
        </button>
      </div>

      <div className="mt-3 min-h-[20px] text-xs">
        {error && <div className="text-bento-accent-red">error · {error}</div>}
        {result && !error && (
          <div className="space-y-1">
            <div className="text-bento-success break-all">
              {result.cid} · validated · {result.ms}ms
            </div>
            {result.resolvedFromRange && (
              <div className="text-bento-text-secondary">
                {result.resolvedFromRange} → {result.ensName}
              </div>
            )}
            <div className="text-bento-text-display mt-2">
              <span className="font-semibold">{result.manifest.name}</span>{" "}
              <span className="text-bento-text-secondary">
                v{result.manifest.version}
              </span>
            </div>
            {result.manifest.tools.map((t) => (
              <div key={t.name} className="text-bento-text-secondary">
                {result.manifest.name}__{t.name}{" "}
                <span className="text-bento-text-display">{t.execution.type}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
