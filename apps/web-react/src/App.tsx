import { useState } from "react";
import { Header } from "./components/Header";
import { Hero } from "./components/Hero";
import { SkillCatalog } from "./components/SkillCatalog";
import { OnchainCard } from "./components/OnchainCard";
import { SchemaCard } from "./components/SchemaCard";
import { ExecutorsCard } from "./components/ExecutorsCard";
import { TotalToolsCard } from "./components/TotalToolsCard";
import { SkillDetail } from "./components/SkillDetail";
import { useRoute } from "./lib/router";
import type { ResolvedSkill } from "./lib/skill-resolve";

export function App() {
  const [route, navigate] = useRoute();
  const [, setLastResolved] = useState<{ ens: string; r: ResolvedSkill } | null>(null);

  return (
    <div className="min-h-screen bg-bento-black text-bento-text-primary flex flex-col">
      <Header onPublish={() => navigate({ kind: "publish" })} />

      <main className="flex-1 p-6 grid grid-cols-12 gap-4 auto-rows-min">
        <Hero
          onResolved={(ens, r) => {
            setLastResolved({ ens, r });
            navigate({ kind: "skill", ensName: ens });
          }}
        />

        <div className="col-span-12 lg:col-span-4">
          <SkillCatalog onSelect={(ens) => navigate({ kind: "skill", ensName: ens })} />
        </div>

        <div className="col-span-12 sm:col-span-6 lg:col-span-4">
          <OnchainCard />
        </div>
        <div className="col-span-12 sm:col-span-6 lg:col-span-4">
          <SchemaCard />
        </div>
        <div className="col-span-12 sm:col-span-6 lg:col-span-4">
          <TotalToolsCard />
        </div>

        <div className="col-span-12 lg:col-span-8">
          <ExecutorsCard />
        </div>
      </main>

      <footer className="px-6 py-4 border-t border-bento-border font-mono text-[10px] uppercase tracking-wider text-bento-text-secondary flex items-center justify-between">
        <a
          href="https://github.com/hien-p/Skillname"
          target="_blank"
          rel="noreferrer"
          className="hover:text-bento-text-display"
        >
          ↗ github.com/hien-p/skillname
        </a>
        <span>built on sepolia · live</span>
      </footer>

      {route.kind === "skill" && (
        <SkillDetail
          ensName={route.ensName}
          onClose={() => navigate({ kind: "home" })}
        />
      )}
      {route.kind === "publish" && (
        <PublishStub onClose={() => navigate({ kind: "home" })} />
      )}
    </div>
  );
}

function PublishStub({ onClose }: { onClose: () => void }) {
  return (
    <aside className="fixed inset-0 z-40 bg-ghost-canvas text-midnight-navy overflow-y-auto">
      <header className="sticky top-0 bg-ghost-canvas/90 backdrop-blur border-b border-fog-border px-6 py-4 flex items-center justify-between">
        <button
          onClick={onClose}
          className="px-3 py-1 border border-fog-border rounded-full font-mono text-xs hover:border-midnight-navy"
        >
          ← Back
        </button>
        <span className="font-display text-lg">Publish a new skill</span>
        <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-pure-surface" aria-label="close">×</button>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-12 text-center font-body">
        <h1 className="font-display text-4xl">Publish flow — coming soon</h1>
        <p className="mt-4 text-slate-ink">
          For now use the CLI: <code className="font-mono">skill publish &lt;dir&gt; &lt;ens&gt;</code>
        </p>
        <pre className="mt-6 inline-block text-left bg-bento-black text-bento-text-primary p-4 rounded font-mono text-sm">
{`pnpm cli skill publish \\
  skillname-pack/examples/quote-uniswap \\
  quote.skilltest.eth`}
        </pre>
      </main>
    </aside>
  );
}
