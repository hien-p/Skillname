// What this panel does:
// Read top-to-bottom in 10 seconds, no protocol knowledge required, and
// you understand the wedge. The technical proof is the LiveTracePanel
// underneath — this one is the *why* before that *how*.
//
// Three columns chosen deliberately:
//   1. THE PAIN — the status quo a builder lives with today
//   2. THE WEDGE — the one line of code that replaces it
//   3. THE PROOF — what to scroll to next
// Numbers in column 1 are real (counted from a typical multi-protocol
// agent setup); column 2's "1 line" is the install snippet on every skill
// page; column 3 nudges the eye down to the live trace.

export function PitchPanel() {
  return (
    <article className="bg-bento-surface border border-bento-border rounded-2xl p-6 text-bento-text-primary">
      <div className="font-mono text-[10px] uppercase tracking-wider text-bento-text-secondary opacity-60">
        WHY THIS EXISTS
      </div>

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr_auto_auto] gap-6 items-stretch">
        {/* THE PAIN */}
        <div className="border border-bento-border rounded p-5 bg-bento-black/40">
          <div className="font-mono text-[10px] uppercase tracking-wider text-bento-accent-red">
            BEFORE — every protocol, by hand
          </div>
          <p className="font-display text-xl mt-2 text-bento-text-display leading-snug">
            To give an AI agent 4 capabilities, a builder writes 4 MCP servers.
          </p>
          <ul className="mt-3 space-y-1 font-mono text-xs text-bento-text-secondary">
            <li>· 4 server configs to maintain</li>
            <li>· 4 API keys / RPC endpoints</li>
            <li>· 4 version bumps per upgrade</li>
            <li>· hand-code per agent framework (Claude / Cursor / OpenClaw)</li>
          </ul>
          <div className="mt-4 font-doto text-5xl text-bento-accent-red">~200</div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-bento-text-secondary mt-1">
            lines of glue per protocol
          </div>
        </div>

        {/* arrow on lg+ */}
        <div className="hidden lg:flex items-center justify-center text-bento-text-secondary text-3xl font-mono">
          →
        </div>

        {/* THE WEDGE */}
        <div className="border border-chartreuse-pulse/40 rounded p-5 bg-bento-black/40">
          <div className="font-mono text-[10px] uppercase tracking-wider text-chartreuse-pulse">
            AFTER — one ENS name
          </div>
          <p className="font-display text-xl mt-2 text-bento-text-display leading-snug">
            Type one line. Get 4 functions, with provenance, automatically.
          </p>
          <div className="mt-3 bg-bento-black border border-bento-border rounded p-3 font-mono text-sm text-chartreuse-pulse">
            Use agent.skilltest.eth
          </div>
          <ul className="mt-3 space-y-1 font-mono text-xs text-bento-text-secondary">
            <li>· bridge resolves the ENS name itself</li>
            <li>· loads the manifest from 0G</li>
            <li>· follows imports → 4 tools registered</li>
            <li>· works in any MCP client, no config</li>
          </ul>
          <div className="mt-4 font-doto text-5xl text-chartreuse-pulse">1</div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-bento-text-secondary mt-1">
            line of glue per protocol
          </div>
        </div>

        {/* arrow + nudge to trace */}
        <div className="hidden lg:flex items-center justify-center text-bento-text-secondary text-3xl font-mono">
          ↓
        </div>

        <div className="flex items-center">
          <p className="font-body text-sm text-bento-text-secondary leading-relaxed">
            <span className="text-bento-text-display font-semibold">Doubt it?</span>
            <br />
            Hit <span className="text-chartreuse-pulse font-mono">▶ Run trace</span> below.
            <br />
            <span className="text-bento-text-secondary text-xs">
              Watches the protocol do all 7 steps live, on real testnet, in ~3s.
              Same code path as the bridge — no fixtures.
            </span>
          </p>
        </div>
      </div>
    </article>
  );
}
