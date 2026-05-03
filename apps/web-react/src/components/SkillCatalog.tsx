interface CatalogItem {
  ens: string;
  exec: string;
  badge?: string;
}

// Exported so the tools-overlay + filter chips can share the same source of truth.
export const CATALOG_ITEMS: CatalogItem[] = [
  { ens: "agent.skilltest.eth",   exec: "local",      badge: "composite · 3 imports" },
  { ens: "quote.skilltest.eth",   exec: "http" },
  { ens: "swap.skilltest.eth",    exec: "keeperhub",  badge: "x402" },
  { ens: "score.skilltest.eth",   exec: "http" },
  { ens: "weather.skilltest.eth", exec: "http" },
  { ens: "infer.skilltest.eth",   exec: "0g-compute" },
  { ens: "hello.skilltest.eth",   exec: "local" },
];

interface Props {
  onSelect: (ens: string) => void;
  filter?: string | null;
  onClearFilter?: () => void;
}

export function SkillCatalog({ onSelect, filter, onClearFilter }: Props) {
  const items = filter ? CATALOG_ITEMS.filter((it) => it.exec === filter) : CATALOG_ITEMS;
  return (
    <article className="bg-pure-surface text-midnight-navy rounded-2xl p-6 shadow-sm border border-fog-border">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-3xl">Skill catalog</h2>
        <span className="font-mono text-[10px] uppercase tracking-wider text-slate-ink">
          <b className="text-midnight-navy font-semibold">{items.length}</b>
          {filter ? <> · filter <code className="text-bento-accent-red">{filter}</code></> : <> atomic</>}
        </span>
      </div>
      {filter && (
        <button
          onClick={onClearFilter}
          className="mt-2 font-mono text-[10px] uppercase tracking-wider text-slate-ink hover:text-midnight-navy"
        >
          ✕ clear filter
        </button>
      )}
      <div className="mt-4 space-y-1">
        {items.length === 0 && (
          <div className="py-6 text-center font-mono text-xs text-slate-ink">
            no skills match <code className="text-bento-accent-red">{filter}</code>
          </div>
        )}
        {items.map((it) => (
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
