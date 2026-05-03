const SEGMENTS = [
  { label: "http",       count: 3, color: "var(--color-bento-text-display)" },
  { label: "keeperhub",  count: 1, color: "var(--color-bento-accent-red)" },
  { label: "0g-compute", count: 1, color: "var(--color-utility-orange, #F26522)" },
  { label: "local",      count: 2, color: "var(--color-bento-text-secondary)" },
];

interface Props {
  onFilter?: (exec: string) => void;
  active?: string | null;
}

export function ExecutorsCard({ onFilter, active }: Props) {
  return (
    <article className="bg-bento-surface border border-bento-border rounded-2xl p-6 text-bento-text-primary">
      <span className="font-mono text-[10px] uppercase tracking-wider text-bento-text-secondary opacity-60">
        EXEC · {SEGMENTS.length} TYPES · click to filter catalog
      </span>
      <div className="mt-3">
        <span className="font-mono text-[10px] uppercase tracking-wider text-bento-text-secondary">
          executors
        </span>
        <div className="font-doto text-5xl mt-1 text-bento-text-display">
          {SEGMENTS.length}
          <span className="text-base text-bento-text-secondary ml-2">types</span>
        </div>
      </div>
      <div className="mt-4 flex h-2 gap-[2px]">
        {SEGMENTS.map((s) => (
          <button
            key={s.label}
            onClick={() => onFilter?.(s.label)}
            style={{ flex: s.count, background: s.color, opacity: !active || active === s.label ? 1 : 0.3 }}
            className="block transition-opacity"
            title={`Filter catalog to ${s.label} skills`}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-wider">
        {SEGMENTS.map((s) => (
          <button
            key={s.label}
            onClick={() => onFilter?.(s.label)}
            style={{ color: s.color }}
            className={`hover:underline transition-opacity ${active && active !== s.label ? "opacity-40" : "opacity-100"}`}
          >
            {s.label} · {s.count}
            {active === s.label && " ✓"}
          </button>
        ))}
      </div>
    </article>
  );
}
