import { createPublicClient, http, namehash, type PublicClient } from "viem";
import { sepolia, mainnet } from "viem/chains";
import { normalize } from "viem/ens";
import { sepoliaTransport } from "./sepolia-transport";

const SKILL_KEY = "xyz.manifest.skill";
const VERSIONS_KEY = "xyz.manifest.skill.versions";

export interface ResolvedSkill {
  ensName: string;
  manifest: SkillManifest;
  cid: string;                    // raw URI value (0g://… or ipfs://…)
  ms: number;                     // total resolve time
  resolvedFromRange?: string;
  storage: {
    kind: "0g" | "ipfs";
    root: string;                 // hex root for 0g, CID for ipfs
    fetchMs: number;              // time for the storage round-trip
    fetchUrl: string;             // exact URL the browser hit
    indexerHost?: string;         // 0G indexer hostname (or ipfs gateway)
  };
  ensMs: number;                  // time spent reading the text record
}

export interface SkillManifest {
  name: string;
  ensName: string;
  version: string;
  description?: string;
  license?: string;
  tools: {
    name: string;
    description: string;
    inputSchema?: {
      type?: string;
      required?: string[];
      properties?: Record<string, { type?: string; default?: unknown; description?: string; examples?: unknown[] }>;
    };
    execution: { type: string; endpoint?: string; method?: string };
  }[];
  // Schema-canonical field for ENS-resolved imports. The ENS text record
  // xyz.manifest.skill.imports mirrors this for SDK dep-graph walking.
  dependencies?: string[];
  trust?: {
    ensip25?: { enabled: boolean };
    erc8004?: { registry: string; agentId: number };
  };
}

const clients: Record<"sepolia" | "mainnet", PublicClient> = {
  sepolia: createPublicClient({ chain: sepolia, transport: sepoliaTransport }) as PublicClient,
  mainnet: createPublicClient({ chain: mainnet, transport: http() }) as PublicClient,
};

// ── semver helpers (mirrored from @skillname/sdk) ─────────────────────────

interface ParsedSemver { major: number; minor: number; patch: number }
function parseSemver(v: string): ParsedSemver {
  const m = v.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`invalid semver: "${v}"`);
  return { major: +m[1], minor: +m[2], patch: +m[3] };
}
function cmpSemver(a: ParsedSemver, b: ParsedSemver) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}
function normalizeShorthand(v: string) {
  const s = v.startsWith("v") ? v.slice(1) : v;
  const parts = s.split(".");
  while (parts.length < 3) parts.push("0");
  return parts.join(".");
}
export function semverSatisfies(v: string, range: string): boolean {
  range = range.trim();
  if (range === "*" || range === "latest" || range === "") return true;
  const sv = parseSemver(v);
  if (range.startsWith("^")) {
    const r = parseSemver(normalizeShorthand(range.slice(1)));
    return sv.major === r.major && cmpSemver(sv, r) >= 0;
  }
  if (range.startsWith("~")) {
    const r = parseSemver(normalizeShorthand(range.slice(1)));
    return sv.major === r.major && sv.minor === r.minor && cmpSemver(sv, r) >= 0;
  }
  return cmpSemver(sv, parseSemver(normalizeShorthand(range))) === 0;
}

interface VersionEntry { label: string; version: string }
function parseVersionsRecord(raw: string): VersionEntry[] {
  if (!raw) return [];
  return raw.split(",").map((p) => p.trim()).filter(Boolean).map((pair) => {
    const i = pair.indexOf(":");
    if (i === -1) throw new Error(`malformed entry: ${pair}`);
    return { label: pair.slice(0, i).trim(), version: pair.slice(i + 1).trim() };
  });
}

async function resolveVersionedName(
  nameAtRange: string,
  chain: "sepolia" | "mainnet",
): Promise<string> {
  const i = nameAtRange.indexOf("@");
  if (i === -1) return nameAtRange;
  const parent = nameAtRange.slice(0, i);
  const range = nameAtRange.slice(i + 1);
  const versionsRaw = await clients[chain].getEnsText({
    name: normalize(parent),
    key: VERSIONS_KEY,
  });
  if (!versionsRaw) {
    throw new Error(`${parent} has no ${VERSIONS_KEY} record — cannot match "${range}"`);
  }
  const idx = parseVersionsRecord(versionsRaw);
  const matches = idx.filter((e) => semverSatisfies(e.version, range));
  if (matches.length === 0) {
    throw new Error(
      `no version in ${parent} satisfies "${range}". Available: ${idx
        .map((e) => `${e.label}:${e.version}`)
        .join(", ")}`,
    );
  }
  matches.sort((a, b) => cmpSemver(parseSemver(b.version), parseSemver(a.version)));
  return `${matches[0].label}.${parent}`;
}

// ── manifest fetch ────────────────────────────────────────────────────────

const OG_INDEXER_URL = "https://indexer-storage-testnet-turbo.0g.ai";

interface FetchedManifest {
  manifest: SkillManifest;
  storage: ResolvedSkill["storage"];
}

async function fetchManifest(uri: string): Promise<FetchedManifest> {
  if (uri.startsWith("0g://")) {
    const root = uri.slice(5);
    const url = `${OG_INDEXER_URL}/file?root=${root}`;
    const t0 = performance.now();
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const fetchMs = Math.round(performance.now() - t0);
    if (!res.ok) throw new Error(`0G fetch failed for ${root}: HTTP ${res.status}`);
    const manifest = (await res.json()) as SkillManifest;
    return {
      manifest,
      storage: {
        kind: "0g",
        root,
        fetchMs,
        fetchUrl: url,
        indexerHost: new URL(OG_INDEXER_URL).host,
      },
    };
  }
  if (uri.startsWith("ipfs://")) {
    const cid = uri.slice(7);
    const url = `https://w3s.link/ipfs/${cid}/manifest.json`;
    const t0 = performance.now();
    const res = await fetch(url);
    const fetchMs = Math.round(performance.now() - t0);
    if (!res.ok) throw new Error(`IPFS fetch failed for ${cid}`);
    const manifest = (await res.json()) as SkillManifest;
    return {
      manifest,
      storage: { kind: "ipfs", root: cid, fetchMs, fetchUrl: url, indexerHost: "w3s.link" },
    };
  }
  throw new Error(`unsupported URI scheme: ${uri.slice(0, 12)}…`);
}

// ── public entry point ────────────────────────────────────────────────────

export async function resolveSkill(
  ensName: string,
  chain: "sepolia" | "mainnet" = "sepolia",
): Promise<ResolvedSkill> {
  const t0 = performance.now();
  let resolvedFromRange: string | undefined;
  if (ensName.includes("@")) {
    resolvedFromRange = ensName;
    ensName = await resolveVersionedName(ensName, chain);
  }
  const normalized = normalize(ensName);
  const ensT0 = performance.now();
  const uri = await clients[chain].getEnsText({ name: normalized, key: SKILL_KEY });
  const ensMs = Math.round(performance.now() - ensT0);
  if (!uri) throw new Error(`no ${SKILL_KEY} text record on ${ensName}`);
  const { manifest, storage } = await fetchManifest(uri);
  return {
    ensName: normalized,
    manifest,
    cid: uri,
    ms: Math.round(performance.now() - t0),
    resolvedFromRange,
    storage,
    ensMs,
  };
}

// Used to generate the namehash for the on-chain demo call.
export { namehash };
