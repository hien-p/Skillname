interface FlatTool {
  ens: string;
  tool: string;
  exec: string;
  description: string;
  badge?: string;
}

// Static flat list — keeps the overlay snappy without N manifest fetches.
// Update this whenever a published bundle adds/removes a tool.
// Exported so the Hero footer can show a real "tools registered" total
// instead of a placeholder.
export const FLAT_TOOLS: FlatTool[] = [
  {
    ens: "agent.skilltest.eth",
    tool: "research_token",
    exec: "local",
    description: "Composite skill — fans out to quote, score, infer for a token + holder report.",
    badge: "composite",
  },
  {
    ens: "quote.skilltest.eth",
    tool: "get_quote",
    exec: "http",
    description: "USD price for a CoinGecko coin id. Free, public API.",
  },
  {
    ens: "swap.skilltest.eth",
    tool: "execute_swap",
    exec: "keeperhub",
    description: "Uniswap V3 swap on Base Sepolia via KeeperHub. $0.05 USDC per call.",
    badge: "x402",
  },
  {
    ens: "basescan.skilltest.eth",
    tool: "scan_contract",
    exec: "http",
    description: "Verified Solidity source + ABI for any contract on Base mainnet. Blockscout v1, no auth.",
    badge: "live · base",
  },
  {
    ens: "basescan.skilltest.eth",
    tool: "get_token",
    exec: "http",
    description: "ERC-20/721 token metadata (name, symbol, decimals, totalSupply) on Base mainnet.",
    badge: "live · base",
  },
  {
    ens: "score.skilltest.eth",
    tool: "trust_score",
    exec: "http",
    description: "Gitcoin Passport score for an Ethereum address. Sybil resistance signal.",
  },
  {
    ens: "weather.skilltest.eth",
    tool: "forecast",
    exec: "http",
    description: "Hourly + daily weather forecast for lat/lng via Open-Meteo. Free, no auth.",
  },
  {
    ens: "infer.skilltest.eth",
    tool: "infer",
    exec: "0g-compute",
    description: "AI inference on 0G Compute (qwen-2.5-7b-instruct). Decentralized GPU.",
  },
  {
    ens: "hello.skilltest.eth",
    tool: "greet",
    exec: "local",
    description: "Greet a name. Smallest possible local-execution skill — bridge smoke test.",
  },
];

const EXEC_COLOR: Record<string, string> = {
  http: "text-bento-text-display",
  keeperhub: "text-bento-accent-red",
  "0g-compute": "text-utility-orange",
  local: "text-slate-ink",
};

interface Props {
  onClose: () => void;
  onOpenSkill: (ens: string) => void;
}

export function ToolsOverlay({ onClose, onOpenSkill }: Props) {
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
          <div className="font-mono text-base">{FLAT_TOOLS.length} atomic tools</div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-slate-ink">
            every tool the bridge can register today
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

      <main className="max-w-5xl mx-auto px-6 py-8">
        <h1 className="font-display text-4xl mb-6">All tools</h1>
        <div className="space-y-2">
          {FLAT_TOOLS.map((t) => (
            <button
              key={`${t.ens}__${t.tool}`}
              onClick={() => onOpenSkill(t.ens)}
              className="w-full flex items-start justify-between gap-4 border border-fog-border rounded p-4 bg-pure-surface text-left hover:border-midnight-navy transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="font-mono text-sm font-semibold break-all">
                  {t.ens.replace(".skilltest.eth", "")}__<span className="text-midnight-navy">{t.tool}</span>
                </div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-slate-ink mt-1">
                  imports from <code>{t.ens}</code>
                </div>
                <p className="font-body text-sm mt-2 text-storm-gray">{t.description}</p>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className={`font-mono text-[10px] uppercase tracking-wider ${EXEC_COLOR[t.exec] ?? "text-slate-ink"}`}>
                  {t.exec}
                </span>
                {t.badge && (
                  <span className="font-mono text-[10px] uppercase tracking-wider text-bento-accent-red">
                    · {t.badge}
                  </span>
                )}
                <span className="text-storm-gray text-xs mt-2">→</span>
              </div>
            </button>
          ))}
        </div>
      </main>
    </aside>
  );
}
