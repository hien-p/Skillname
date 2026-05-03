interface Props {
  onOpen?: () => void;
}

const TOOL_COUNT = 7; // matches FLAT_TOOLS in ToolsOverlay
const SKILL_COUNT = 7;

export function TotalToolsCard({ onOpen }: Props) {
  return (
    <button
      onClick={onOpen}
      className="bg-pure-surface text-midnight-navy rounded-2xl p-6 shadow-sm border border-fog-border flex flex-col h-full text-left hover:border-midnight-navy transition-colors w-full"
    >
      <span className="font-mono text-[10px] uppercase tracking-wider text-slate-ink">
        TOTAL TOOLS · click to list
      </span>
      <div className="mt-2 flex-1 flex items-end">
        <span className="font-doto text-6xl text-midnight-navy">{TOOL_COUNT}</span>
        <span className="ml-2 mb-2 font-mono text-[10px] uppercase tracking-wider text-slate-ink">
          fns
        </span>
      </div>
      <div className="mt-4 font-mono text-[10px] uppercase tracking-wider text-slate-ink">
        across {SKILL_COUNT} atomic skills →
      </div>
    </button>
  );
}
