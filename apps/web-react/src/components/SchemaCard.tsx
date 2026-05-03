interface Props {
  onOpen?: () => void;
}

export function SchemaCard({ onOpen }: Props) {
  return (
    <button
      onClick={onOpen}
      className="bg-pure-surface text-midnight-navy rounded-2xl p-6 shadow-sm border border-fog-border flex flex-col h-full text-left hover:border-midnight-navy transition-colors w-full"
    >
      <span className="font-mono text-[10px] uppercase tracking-wider text-slate-ink">
        SCHEMA · click to view
      </span>
      <div className="mt-2 flex-1 flex flex-col">
        <span className="font-mono text-[10px] uppercase tracking-wider text-slate-ink">
          version
        </span>
        <span className="font-doto text-5xl mt-1 text-midnight-navy">v1</span>
      </div>
      <div className="mt-4 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-slate-ink">
        <span>skill-v1.json</span>
        <span className="text-midnight-navy">view JSON →</span>
      </div>
    </button>
  );
}
