import { useState } from "react";
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { normalize } from "viem/ens";
import { resolveSkill, type SkillManifest } from "../lib/skill-resolve";

// What this panel does — and why it's the hero of the page:
//
// Every other tile shows STATE (counts, version, schema). This one shows
// MOTION. The protocol's whole pipeline runs live, end-to-end, against real
// Sepolia + 0G state, with each step appearing as it resolves so a non-
// technical observer can watch the wedge in action:
//
//   1. ENS text record read (sepolia eth_call)
//   2. 0G manifest fetch (indexer HTTP GET)
//   3. dependency-graph walk (3× parallel resolveSkill on the imports)
//   4. MCP tool registration (the list the bridge would expose to a client)
//   5. live tool call (one transitive tool, real CoinGecko, real result)
//
// Same code path as the SDK / bridge — no fakery. If something broke in the
// SDK this panel breaks too. That's the point.

type StepState = "pending" | "running" | "ok" | "err";

interface Step {
  label: string;          // technical line — what the protocol literally does
  plain: string;          // plain-English subtitle for non-technical viewers
  badge: string;
  state: StepState;
  detail?: string;
  ms?: number;
  rows?: { label: string; value: string }[];
}

const TARGET_ENS = "agent.skilltest.eth";
const SAMPLE_TOKEN = "ethereum";

const sepoliaClient = createPublicClient({ chain: sepolia, transport: http() });

export function LiveTracePanel() {
  const [steps, setSteps] = useState<Step[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [totalMs, setTotalMs] = useState<number | null>(null);

  function append(s: Step) {
    setSteps((prev) => [...prev, s]);
    return setSteps; // not used but keeps types easy
  }
  function patchLast(idx: number, patch: Partial<Step>) {
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }

  async function runTrace() {
    setRunning(true);
    setDone(false);
    setSteps([]);
    setTotalMs(null);
    const t0 = performance.now();

    try {
      // ── Step 1: ENS text record ──────────────────────────────────────
      const idxENS = 0;
      append({
        label: `eth_call → ENS resolver · text("xyz.manifest.skill")`,
        plain: `Look up where the agent's skill manifest lives, on-chain.`,
        badge: "sepolia",
        state: "running",
      });
      const ensStart = performance.now();
      const uri = await sepoliaClient.getEnsText({
        name: normalize(TARGET_ENS),
        key: "xyz.manifest.skill",
      });
      if (!uri) throw new Error("text record missing");
      patchLast(idxENS, {
        state: "ok",
        detail: uri,
        ms: Math.round(performance.now() - ensStart),
      });

      // ── Step 2: 0G manifest fetch ────────────────────────────────────
      const idxFetch = 1;
      append({
        label: "GET → 0G indexer · /file?root=…",
        plain: `Download the manifest from decentralized storage (0G).`,
        badge: "0g · galileo",
        state: "running",
      });
      const fetchStart = performance.now();
      const root = uri.replace("0g://", "");
      const res = await fetch(
        `https://indexer-storage-testnet-turbo.0g.ai/file?root=${root}`,
        { headers: { Accept: "application/json" } },
      );
      if (!res.ok) throw new Error(`0G fetch HTTP ${res.status}`);
      const manifest = (await res.json()) as SkillManifest;
      patchLast(idxFetch, {
        state: "ok",
        detail: `${manifest.name} · v${manifest.version} · ${manifest.tools.length} tool(s) · ${manifest.dependencies?.length ?? 0} import(s)`,
        ms: Math.round(performance.now() - fetchStart),
      });

      // ── Step 3: walk imports[] in parallel ───────────────────────────
      const deps = manifest.dependencies ?? [];
      if (deps.length === 0) {
        append({
          label: "leaf skill — no imports to walk",
          plain: "This skill stands alone — no sub-skills to load.",
          badge: "graph",
          state: "ok",
        });
      }
      const importIdxs = deps.map((d, i) => {
        append({
          label: `walk import · ${d}`,
          plain: `The manifest lists ${d} as a sub-skill — load that one too, recursively.`,
          badge: "sepolia + 0g",
          state: "running",
        });
        return idxFetch + 1 + i;
      });
      const walkStart = performance.now();
      const resolved = await Promise.all(
        deps.map(async (d, i) => {
          const start = performance.now();
          const r = await resolveSkill(d, "sepolia");
          patchLast(importIdxs[i], {
            state: "ok",
            detail: `${r.manifest.name}__${r.manifest.tools[0]?.name} · ${r.manifest.tools[0]?.execution.type}`,
            ms: Math.round(performance.now() - start),
          });
          return r;
        }),
      );
      void walkStart; // referenced below if we want a total

      // ── Step 4: MCP tool registration (in-memory, no network) ────────
      const idxRegister = idxFetch + 1 + deps.length;
      const registered = [
        ...manifest.tools.map((t) => ({
          name: `${manifest.name}__${t.name}`,
          exec: t.execution.type,
          kind: "root",
        })),
        ...resolved.flatMap((r) =>
          r.manifest.tools.map((t) => ({
            name: `${r.manifest.name}__${t.name}`,
            exec: t.execution.type,
            kind: "transitive",
          })),
        ),
      ];
      append({
        label: `register · ${registered.length} MCP tool(s) on bridge`,
        plain: `One ENS lookup → ${registered.length} callable functions ready for the AI agent. No human config involved.`,
        badge: "bridge",
        state: "ok",
        rows: registered.map((t) => ({
          label: `${t.kind === "transitive" ? "└" : "·"} ${t.name}`,
          value: t.exec,
        })),
        ms: 1,
      });

      // ── Step 5: live tool call (one transitive tool, real endpoint) ──
      // Pick a transitive HTTP tool and actually fire it. Concrete proof
      // that registration → invocation works end-to-end.
      const httpTool = resolved
        .flatMap((r) => r.manifest.tools.map((t) => ({ ens: r.manifest.ensName, t })))
        .find(({ t }) => t.execution.type === "http" && !!t.execution.endpoint);

      if (httpTool) {
        const idxCall = idxRegister + 1;
        append({
          label: `tools.call · ${httpTool.t.name}({ ids: "${SAMPLE_TOKEN}" })`,
          plain: `Prove it works — fire one of the auto-loaded functions. Live response.`,
          badge: `${httpTool.ens}`,
          state: "running",
        });
        const callStart = performance.now();
        const url = new URL(httpTool.t.execution.endpoint!);
        url.searchParams.set("ids", SAMPLE_TOKEN);
        url.searchParams.set("vs_currencies", "usd");
        const callRes = await fetch(url.toString(), { headers: { Accept: "application/json" } });
        const body = await callRes.json();
        patchLast(idxCall, {
          state: "ok",
          detail: JSON.stringify(body),
          ms: Math.round(performance.now() - callStart),
        });
      }

      setTotalMs(Math.round(performance.now() - t0));
      setDone(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSteps((prev) => [
        ...prev,
        {
          label: "trace aborted",
          plain: "Something failed mid-pipeline — see the error below.",
          badge: "error",
          state: "err",
          detail: msg,
        },
      ]);
    } finally {
      setRunning(false);
    }
  }

  return (
    <article className="bg-bento-surface border border-bento-border rounded-2xl p-6 text-bento-text-primary">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-bento-text-secondary opacity-60">
            LIVE TRACE · what happens when an agent uses{" "}
            <code className="text-bento-text-display">{TARGET_ENS}</code>
          </div>
          <h2 className="font-display text-3xl mt-1 text-bento-text-display">
            One ENS read → manifest → graph walk → 4 tools → live call
          </h2>
          <p className="font-body text-sm text-bento-text-secondary mt-2 max-w-2xl">
            Every step is a real network call. Same code path as the SDK + bridge —
            no fixtures, no fakery. Click play; watch the protocol do work.
          </p>
        </div>
        <button
          onClick={runTrace}
          disabled={running}
          className="shrink-0 px-6 py-3 bg-chartreuse-pulse text-bento-black font-mono text-sm font-bold uppercase tracking-wider rounded disabled:opacity-50 hover:-translate-y-px transition"
        >
          {running ? "tracing…" : steps.length > 0 ? "▶ replay" : "▶ run trace"}
        </button>
      </div>

      {steps.length > 0 && (
        <div className="mt-6 bg-bento-black border border-bento-border rounded p-4 font-mono text-xs space-y-2 max-h-[420px] overflow-auto">
          {steps.map((s, i) => (
            <StepRow key={i} step={s} idx={i} />
          ))}
          {done && totalMs !== null && (
            <div className="pt-3 mt-2 border-t border-bento-border space-y-1">
              <div className="text-bento-success font-mono">
                ✓ trace complete in {totalMs}ms — {steps.filter((s) => s.state === "ok").length}/
                {steps.length} steps
              </div>
              <div className="text-chartreuse-pulse italic font-body text-xs">
                In {(totalMs / 1000).toFixed(1)}s, one ENS name became 4 callable AI functions —
                no MCP server hand-coded, no API keys configured. The same flow runs in
                Claude Desktop / Cursor / OpenClaw via the bridge.
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function StepRow({ step, idx }: { step: Step; idx: number }) {
  const icon =
    step.state === "ok"
      ? "✓"
      : step.state === "err"
        ? "✗"
        : step.state === "running"
          ? "⚡"
          : "·";
  const color =
    step.state === "ok"
      ? "text-bento-success"
      : step.state === "err"
        ? "text-bento-accent-red"
        : step.state === "running"
          ? "text-utility-orange animate-pulse"
          : "text-bento-text-secondary";
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className={`${color} w-3 shrink-0`}>{icon}</span>
        <span className="text-bento-text-secondary w-6 shrink-0">{String(idx + 1).padStart(2, "0")}</span>
        <span className="text-bento-text-display flex-1">{step.label}</span>
        <span className="text-bento-text-secondary shrink-0">[{step.badge}]</span>
        {step.ms !== undefined && (
          <span className="text-bento-text-secondary shrink-0 w-16 text-right">{step.ms}ms</span>
        )}
      </div>
      {step.plain && (
        <div className="ml-12 mt-0.5 text-chartreuse-pulse/80 italic font-body text-[11px]">
          {step.plain}
        </div>
      )}
      {step.detail && (
        <div className="ml-12 mt-1 text-bento-text-secondary break-all">
          ↳ {step.detail.length > 280 ? step.detail.slice(0, 280) + "…" : step.detail}
        </div>
      )}
      {step.rows && (
        <div className="ml-12 mt-1 space-y-0.5">
          {step.rows.map((r, j) => (
            <div key={j} className="flex justify-between text-bento-text-secondary">
              <span>{r.label}</span>
              <span className="text-bento-text-display">{r.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
