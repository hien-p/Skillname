import { CATALOG_ITEMS } from "./SkillCatalog";

// Static composite map — derived from the published manifests.
// Update when a new composite ships. Mirrors what the bridge sees from
// xyz.manifest.skill.imports for each ENS name in the registry.
const COMPOSITES: Record<string, string[]> = {
  "agent.skilltest.eth": [
    "quote.skilltest.eth",
    "score.skilltest.eth",
    "infer.skilltest.eth",
  ],
};

// Reverse-dep index: who imports me?
function importedBy(target: string): string[] {
  const parents: string[] = [];
  for (const [parent, children] of Object.entries(COMPOSITES)) {
    if (children.includes(target)) parents.push(parent);
  }
  return parents;
}

interface Props {
  ensName: string;
  dependencies?: string[];
  onSelect?: (ens: string) => void;
}

export function DependencyGraph({ ensName, dependencies, onSelect }: Props) {
  const deps = dependencies ?? [];
  const parents = importedBy(ensName);
  const isComposite = deps.length > 0;
  const isLeaf = deps.length === 0;

  // Compose the layout: parents on top row, current node in middle, children below.
  // For agent.skilltest.eth: 0 parents + center + 3 children.
  // For infer.skilltest.eth: 1 parent + center + 0 children.
  return (
    <div className="border border-fog-border rounded p-6 bg-pure-surface">
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="font-display text-2xl">Import graph</h3>
        <span className="font-mono text-[10px] uppercase tracking-wider text-slate-ink">
          {isComposite ? `composite · ${deps.length} import(s)` : isLeaf && parents.length > 0 ? `leaf · imported by ${parents.length}` : "leaf · standalone"}
        </span>
      </div>

      <Graph
        ensName={ensName}
        parents={parents}
        children={deps}
        onSelect={onSelect}
      />

      <Legend />
    </div>
  );
}

function Graph({
  ensName,
  parents,
  children,
  onSelect,
}: {
  ensName: string;
  parents: string[];
  children: string[];
  onSelect?: (ens: string) => void;
}) {
  // SVG layout
  const width = 720;
  const rowH = 90;
  const rows = (parents.length > 0 ? 1 : 0) + 1 + (children.length > 0 ? 1 : 0);
  const height = rows * rowH + 40;

  const centerY = parents.length > 0 ? rowH + 20 : 30;
  const centerX = width / 2;

  function xFor(i: number, n: number) {
    if (n === 1) return centerX;
    const margin = 80;
    const usable = width - margin * 2;
    return margin + (usable * i) / (n - 1);
  }

  const parentY = 30;
  const childY = centerY + rowH;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* edges: parents → center */}
      {parents.map((p, i) => {
        const x1 = xFor(i, parents.length);
        return (
          <line
            key={`pe-${p}`}
            x1={x1}
            y1={parentY + 22}
            x2={centerX}
            y2={centerY - 22}
            stroke="var(--color-fog-border, #b1b5c0)"
            strokeWidth="1.5"
            strokeDasharray="4 3"
          />
        );
      })}

      {/* edges: center → children */}
      {children.map((c, i) => {
        const x2 = xFor(i, children.length);
        return (
          <line
            key={`ce-${c}`}
            x1={centerX}
            y1={centerY + 22}
            x2={x2}
            y2={childY - 22}
            stroke="var(--color-midnight-navy, #1b2540)"
            strokeWidth="1.5"
          />
        );
      })}

      {/* parent nodes */}
      {parents.map((p, i) => (
        <Node
          key={`p-${p}`}
          x={xFor(i, parents.length)}
          y={parentY}
          label={p}
          variant="parent"
          onClick={() => onSelect?.(p)}
        />
      ))}

      {/* center (this skill) */}
      <Node x={centerX} y={centerY} label={ensName} variant="self" />

      {/* child nodes */}
      {children.map((c, i) => (
        <Node
          key={`c-${c}`}
          x={xFor(i, children.length)}
          y={childY}
          label={c}
          variant="child"
          onClick={() => onSelect?.(c)}
        />
      ))}

      {/* "no graph" hint when truly standalone */}
      {parents.length === 0 && children.length === 0 && (
        <text
          x={centerX}
          y={centerY + 50}
          textAnchor="middle"
          className="font-mono text-[11px] fill-slate-ink"
        >
          standalone — no imports, no dependents (yet)
        </text>
      )}
    </svg>
  );
}

function Node({
  x,
  y,
  label,
  variant,
  onClick,
}: {
  x: number;
  y: number;
  label: string;
  variant: "self" | "parent" | "child";
  onClick?: () => void;
}) {
  const W = 180;
  const H = 44;
  const fill =
    variant === "self"
      ? "var(--color-midnight-navy, #1b2540)"
      : "var(--color-pure-surface, #ffffff)";
  const stroke =
    variant === "self"
      ? "var(--color-midnight-navy, #1b2540)"
      : "var(--color-fog-border, #b1b5c0)";
  const textFill =
    variant === "self"
      ? "var(--color-chartreuse-pulse, #d0f100)"
      : "var(--color-midnight-navy, #1b2540)";
  const tag =
    variant === "self" ? "this skill" : variant === "parent" ? "imports me" : "i import";
  const cursor = onClick ? "pointer" : "default";

  return (
    <g style={{ cursor }} onClick={onClick}>
      <rect
        x={x - W / 2}
        y={y - H / 2}
        width={W}
        height={H}
        rx="6"
        fill={fill}
        stroke={stroke}
        strokeWidth="1.5"
      />
      <text
        x={x}
        y={y - 2}
        textAnchor="middle"
        className="font-mono text-[12px] font-semibold"
        style={{ fill: textFill }}
      >
        {label}
      </text>
      <text
        x={x}
        y={y + 13}
        textAnchor="middle"
        className="font-mono text-[9px] uppercase tracking-wider"
        style={{ fill: variant === "self" ? "rgba(255,255,255,0.6)" : "var(--color-slate-ink, #6b7184)" }}
      >
        {tag}
      </text>
    </g>
  );
}

function Legend() {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-slate-ink">
      <span className="flex items-center gap-1.5">
        <svg width="20" height="10">
          <line x1="0" y1="5" x2="20" y2="5" stroke="var(--color-midnight-navy)" strokeWidth="1.5" />
        </svg>
        I import (solid)
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="20" height="10">
          <line x1="0" y1="5" x2="20" y2="5" stroke="var(--color-fog-border)" strokeWidth="1.5" strokeDasharray="4 3" />
        </svg>
        imported by (dashed)
      </span>
    </div>
  );
}
