import { useState } from "react";
import { Header } from "./components/Header";
import { Hero } from "./components/Hero";
import { SkillCatalog } from "./components/SkillCatalog";
import { OnchainCard } from "./components/OnchainCard";
import { SchemaCard } from "./components/SchemaCard";
import { ExecutorsCard } from "./components/ExecutorsCard";
import { TotalToolsCard } from "./components/TotalToolsCard";
import { SkillDetail } from "./components/SkillDetail";
import { SchemaOverlay } from "./components/SchemaOverlay";
import { ToolsOverlay } from "./components/ToolsOverlay";
import { PublishOverlay } from "./components/PublishOverlay";
import { LiveTracePanel } from "./components/LiveTracePanel";
import { PitchPanel } from "./components/PitchPanel";
import { MySkillsCard } from "./components/MySkillsCard";
import { OGStorageCard } from "./components/OGStorageCard";
import { useRoute } from "./lib/router";
import type { ResolvedSkill } from "./lib/skill-resolve";

export function App() {
  const [route, navigate] = useRoute();
  const [, setLastResolved] = useState<{ ens: string; r: ResolvedSkill } | null>(null);
  // Catalog filter driven by ExecutorsCard chips + a transient overlay state
  // for the Schema and Tools cards so every bento card is now click-active.
  const [execFilter, setExecFilter] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<"schema" | "tools" | null>(null);

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
          <MySkillsCard
            onSelect={(ens) => navigate({ kind: "skill", ensName: ens })}
            onPublish={() => navigate({ kind: "publish" })}
          />
        </div>

        <div className="col-span-12">
          <PitchPanel />
        </div>

        <div className="col-span-12">
          <LiveTracePanel />
        </div>

        <div className="col-span-12 lg:col-span-4">
          <SkillCatalog
            onSelect={(ens) => navigate({ kind: "skill", ensName: ens })}
            filter={execFilter}
            onClearFilter={() => setExecFilter(null)}
          />
        </div>

        <div className="col-span-12 sm:col-span-6 lg:col-span-4">
          <OnchainCard />
        </div>
        <div className="col-span-12 sm:col-span-6 lg:col-span-4">
          <OGStorageCard />
        </div>
        <div className="col-span-12 sm:col-span-6 lg:col-span-4">
          <TotalToolsCard onOpen={() => setOverlay("tools")} />
        </div>
        <div className="col-span-12 sm:col-span-6 lg:col-span-4">
          <SchemaCard onOpen={() => setOverlay("schema")} />
        </div>

        <div className="col-span-12 lg:col-span-8">
          <ExecutorsCard
            active={execFilter}
            onFilter={(exec) => setExecFilter((curr) => (curr === exec ? null : exec))}
          />
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
        <PublishOverlay onClose={() => navigate({ kind: "home" })} />
      )}
      {overlay === "schema" && <SchemaOverlay onClose={() => setOverlay(null)} />}
      {overlay === "tools" && (
        <ToolsOverlay
          onClose={() => setOverlay(null)}
          onOpenSkill={(ens) => {
            setOverlay(null);
            navigate({ kind: "skill", ensName: ens });
          }}
        />
      )}
    </div>
  );
}

