import type { ResolvedSkill } from "../lib/skill-resolve";

interface Props {
  storage: ResolvedSkill["storage"];
  ensMs: number;
  variant?: "dark" | "light";
}

/**
 * Compact badge that surfaces "this manifest came off 0G storage" with the
 * actual root, indexer host, and round-trip time. Sits next to the skill
 * title or in the hero so 0G's role isn't a whisper in a sidebar URI.
 */
export function OGStorageBadge({ storage, ensMs, variant = "light" }: Props) {
  const isDark = variant === "dark";
  const base = isDark
    ? "bg-bento-surface text-bento-text-primary border-bento-border"
    : "bg-bento-black text-bento-text-primary border-bento-border";
  const dot =
    storage.kind === "0g" ? "bg-chartreuse-pulse" : "bg-bento-text-secondary";
  const label = storage.kind === "0g" ? "0G GALILEO" : "IPFS";
  return (
    <a
      href={storage.fetchUrl}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex items-center gap-2 rounded border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider hover:-translate-y-px transition no-underline ${base}`}
      title={`Open the manifest from ${storage.indexerHost ?? "storage"}`}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${dot}`} />
      <span>{label}</span>
      <span className="text-bento-text-secondary">·</span>
      <code className="text-bento-text-display">
        {storage.root.slice(0, 6)}…{storage.root.slice(-4)}
      </code>
      <span className="text-bento-text-secondary">·</span>
      <span>
        {storage.fetchMs}ms{ensMs ? ` (+ens ${ensMs}ms)` : ""}
      </span>
      <span className="text-bento-text-display">↗</span>
    </a>
  );
}
