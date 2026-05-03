import { useEffect, useState } from "react";

const SCHEMA_URL =
  "https://raw.githubusercontent.com/hien-p/Skillname/staging/skillname-pack/packages/schema/skill-v1.schema.json";

interface Props {
  onClose: () => void;
}

export function SchemaOverlay({ onClose }: Props) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(SCHEMA_URL)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setText)
      .catch((e) => setError(String(e?.message ?? e)));
  }, []);

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
          <div className="font-mono text-base">skill-v1.schema.json</div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-slate-ink">
            JSON Schema draft-07 · the on-the-wire spec for every published bundle
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
        <div className="flex items-center justify-between mb-4">
          <h1 className="font-display text-4xl">Bundle schema · v1</h1>
          <a
            href={SCHEMA_URL}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-slate-ink hover:text-midnight-navy underline"
          >
            view raw on GitHub ↗
          </a>
        </div>
        <p className="font-body text-sm text-storm-gray max-w-2xl mb-6">
          Every <code className="font-mono">manifest.json</code> in the registry validates against
          this schema. The <code className="font-mono">$id</code> is part of the on-the-wire spec —
          don't rename it.
        </p>
        {error && (
          <div className="font-mono text-xs text-bento-accent-red">error · {error}</div>
        )}
        {!error && !text && (
          <div className="font-mono text-xs text-slate-ink">loading…</div>
        )}
        {text && (
          <pre className="bg-bento-black text-chartreuse-pulse font-mono text-[12px] p-6 rounded overflow-auto max-h-[70vh]">
            {text}
          </pre>
        )}
      </main>
    </aside>
  );
}
