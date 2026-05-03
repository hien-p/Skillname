export function TotalToolsCard() {
  return (
    <article className="bg-pure-surface text-midnight-navy rounded-2xl p-6 shadow-sm border border-fog-border flex flex-col h-full">
      <span className="font-mono text-[10px] uppercase tracking-wider text-slate-ink">
        TOTAL TOOLS
      </span>
      <div className="mt-2 flex-1 flex items-end">
        <span className="font-doto text-6xl text-midnight-navy">6</span>
        <span className="ml-2 mb-2 font-mono text-[10px] uppercase tracking-wider text-slate-ink">
          fns
        </span>
      </div>
      <div className="mt-4 font-mono text-[10px] uppercase tracking-wider text-slate-ink">
        across {6} atomic skills
      </div>
    </article>
  );
}
