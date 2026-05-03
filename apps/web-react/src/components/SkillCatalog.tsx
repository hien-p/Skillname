interface CatalogItem {
  ens: string;
  exec: string;
  badge?: string;
}

const ITEMS: CatalogItem[] = [
  { ens: "agent.skilltest.eth",   exec: "local",      badge: "composite · 3 imports" },
  { ens: "quote.skilltest.eth",   exec: "http" },
  { ens: "swap.skilltest.eth",    exec: "keeperhub",  badge: "x402" },
  { ens: "score.skilltest.eth",   exec: "http" },
  { ens: "weather.skilltest.eth", exec: "http" },
  { ens: "infer.skilltest.eth",   exec: "0g-compute" },
  { ens: "hello.skilltest.eth",   exec: "local" },
];

export function SkillCatalog({ onSelect }: { onSelect: (ens: string) => void }) {
  return (
    <article className="bg-pure-surface text-midnight-navy rounded-2xl p-6 shadow-sm border border-fog-border">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-3xl">Skill catalog</h2>
        <span className="font-mono text-[10px] uppercase tracking-wider text-slate-ink">
          <b className="text-midnight-navy font-semibold">{ITEMS.length}</b> atomic
        </span>
      </div>
      <div className="mt-4 space-y-1">
        {ITEMS.map((it) => (
          <button
            key={it.ens}
            onClick={() => onSelect(it.ens)}
            className="w-full flex items-center justify-between py-3 px-2 rounded hover:bg-ghost-canvas text-left"
          >
            <span className="font-mono text-base text-midnight-navy">{it.ens}</span>
            <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-slate-ink">
              <span>{it.exec}</span>
              {it.badge && <span className="text-bento-accent-red">· {it.badge}</span>}
              <span className="text-storm-gray">→</span>
            </span>
          </button>
        ))}
      </div>
    </article>
  );
}
