import { useState } from "react";
import type { SkillManifest } from "../lib/skill-resolve";

type Tool = SkillManifest["tools"][number];

interface Props {
  tool: Tool;
}

// Live "Try it" affordance for tools whose execution can run in-browser.
// Currently: HTTP-execution tools with a public, CORS-friendly endpoint
// (CoinGecko, Open-Meteo, Passport.xyz). For everything else (keeperhub,
// 0g-compute, local, contract) we render a stub that explains why this is
// off-limits in the browser and points at the bridge.
export function TryItButton({ tool }: Props) {
  const isHttp = tool.execution.type === "http" && !!tool.execution.endpoint;

  if (!isHttp) {
    return (
      <div className="mt-3 text-[11px] text-slate-ink font-body">
        <span className="font-mono text-storm-gray">{tool.execution.type}</span> execution —
        run via the bridge MCP server (browsers can't sign / call provider RPCs directly).
      </div>
    );
  }

  return <HttpPlayground tool={tool} />;
}

function HttpPlayground({ tool }: Props) {
  const props = tool.inputSchema?.properties ?? {};
  const required = new Set(tool.inputSchema?.required ?? []);
  const initial: Record<string, string> = {};
  for (const [k, schema] of Object.entries(props)) {
    const ex = schema.examples?.[0];
    initial[k] = String(schema.default ?? ex ?? "");
  }
  const [args, setArgs] = useState<Record<string, string>>(initial);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ms, setMs] = useState<number | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    setMs(null);
    const t0 = performance.now();
    try {
      const url = new URL(tool.execution.endpoint!);
      for (const [k, v] of Object.entries(args)) {
        if (v) url.searchParams.set(k, v);
      }
      const method = tool.execution.method ?? "GET";
      const res = await fetch(url.toString(), { method, headers: { Accept: "application/json" } });
      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        // not JSON, keep text
      }
      setResult(JSON.stringify(parsed, null, 2));
      setMs(Math.round(performance.now() - t0));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 border-t border-fog-border pt-3">
      <div className="space-y-2">
        {Object.entries(props).map(([k, schema]) => (
          <label key={k} className="flex items-center gap-3 font-mono text-xs">
            <span className="w-32 text-slate-ink shrink-0">
              {k}
              {required.has(k) && <span className="text-bento-accent-red">*</span>}
            </span>
            <input
              value={args[k] ?? ""}
              onChange={(e) => setArgs((a) => ({ ...a, [k]: e.target.value }))}
              placeholder={String(schema.examples?.[0] ?? schema.default ?? "")}
              className="flex-1 bg-pure-surface border border-fog-border rounded px-2 py-1 outline-none focus:border-midnight-navy"
            />
          </label>
        ))}
      </div>
      <button
        onClick={run}
        disabled={busy}
        className="mt-3 px-4 py-1.5 bg-midnight-navy text-chartreuse-pulse font-mono text-xs uppercase tracking-wider rounded disabled:opacity-50 hover:-translate-y-px transition"
      >
        {busy ? "calling…" : `Try it — ${tool.execution.method ?? "GET"} →`}
      </button>
      {ms !== null && !error && (
        <span className="ml-3 font-mono text-[10px] text-slate-ink">{ms}ms</span>
      )}
      {error && (
        <div className="mt-2 font-mono text-xs text-bento-accent-red break-all">
          error · {error.slice(0, 200)}
        </div>
      )}
      {result && (
        <pre className="mt-2 bg-bento-black text-chartreuse-pulse font-mono text-[11px] p-3 rounded max-h-48 overflow-auto">
          {result}
        </pre>
      )}
    </div>
  );
}
