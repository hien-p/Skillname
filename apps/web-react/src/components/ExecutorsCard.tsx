const SEGMENTS = [
  { label: "http",       count: 4, color: "var(--color-bento-text-display)" },
  { label: "keeperhub",  count: 1, color: "var(--color-bento-accent-red)" },
  { label: "0g-compute", count: 1, color: "var(--color-utility-orange, #F26522)" },
  { label: "local",      count: 1, color: "var(--color-bento-text-secondary)" },
];

export function ExecutorsCard() {
  return (
    <article className="bg-bento-surface border border-bento-border rounded-2xl p-6 text-bento-text-primary">
      <span className="font-mono text-[10px] uppercase tracking-wider text-bento-text-secondary opacity-60">
        EXEC · 4 TYPES
      </span>
      <div className="mt-3">
        <span className="font-mono text-[10px] uppercase tracking-wider text-bento-text-secondary">
          executors
        </span>
        <div className="font-doto text-5xl mt-1 text-bento-text-display">
          4<span className="text-base text-bento-text-secondary ml-2">types</span>
        </div>
      </div>
      <div className="mt-4 flex h-2 gap-[2px]">
        {SEGMENTS.map((s) => (
          <span
            key={s.label}
            style={{ flex: s.count, background: s.color }}
            className="block"
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-wider">
        {SEGMENTS.map((s) => (
          <span key={s.label} style={{ color: s.color }}>
            {s.label} · {s.count}
          </span>
        ))}
      </div>
    </article>
  );
}
