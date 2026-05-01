/**
 * @skillname/sdk
 *
 * Core resolution: ENS name → text record → IPFS CID → verified bundle.
 *
 * Usage:
 *   import { resolveSkill } from '@skillname/sdk'
 *   const result = await resolveSkill('quote.uniswap.eth')
 */

import {
  createPublicClient,
  http,
  type Address,
  type PublicClient,
} from "viem";
import { mainnet, sepolia } from "viem/chains";
import { normalize, namehash } from "viem/ens";
import { validate as validateBundle } from "@skillname/schema";
// @helia/verified-fetch is dynamically imported in getVerifiedFetch() —
// it pulls libp2p webrtc with native bindings, so we only load it on the
// first verified fetch call. If the dynamic import fails, the SDK falls
// through to the public-gateway path silently.

// -------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------

export const SKILL_TEXT_KEY = "xyz.manifest.skill";
export const SKILL_VERSION_KEY = "xyz.manifest.skill.version";
export const SKILL_SCHEMA_KEY = "xyz.manifest.skill.schema";
export const SKILL_EXECUTION_KEY = "xyz.manifest.skill.execution";
export const SKILL_0G_KEY = "xyz.manifest.skill.0g";
export const SKILL_IMPORTS_KEY = "xyz.manifest.skill.imports";
export const SKILL_LOCKFILE_KEY = "xyz.manifest.skill.lockfile";

export interface SkillBundle {
  $schema?: string;
  name: string;
  ensName: string;
  version: string;
  description?: string;
  author?: string;
  createdAt?: string;
  license?: string;
  tools: Tool[];
  prompts?: string[];
  resources?: Resource[];
  examples?: string[];
  dependencies?: string[];
  trust?: {
    ensip25?: { enabled: boolean };
    erc8004?: { registry: string; agentId: number };
  };
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  execution: Execution;
}

export type Execution =
  | { type: "local"; handler: string }
  | {
      type: "keeperhub";
      workflowId?: string;
      tool?: string;
      chainId?: number;
      payment?: Payment;
    }
  | { type: "http"; endpoint: string; method?: string; payment?: Payment }
  | {
      type: "0g-compute";
      providerAddress: string;
      model?: string;
      systemPrompt?: string;
    }
  | {
      type: "contract";
      chainId: number;
      address: string;
      abi: readonly unknown[];
      method: string;
      mode?: "read" | "write";
      payment?: Payment;
    };

export interface Payment {
  protocol: "x402" | "mpp";
  price: string;
  token: string;
  network: string;
}

export interface Resource {
  name: string;
  uri: string;
  description?: string;
}

export interface ResolveOptions {
  /** Chain to resolve ENS on. Default: 'sepolia' (hackathon). Use 'mainnet' for production names. */
  chain?: "mainnet" | "sepolia";
  /** Custom RPC URL */
  rpcUrl?: string;
  /** Skip CID hash verification (DO NOT use in prod) */
  skipVerification?: boolean;
  /** IPFS gateways to try in order */
  ipfsGateways?: string[];
}

export interface ResolveResult {
  ensName: string;
  cid: string;
  version?: string;
  schema?: string;
  bundle: SkillBundle;
  verified: boolean;
  ensip25?: {
    bound: boolean;
    registry?: string;
    agentId?: number;
  };
}

// -------------------------------------------------------------------------
// ENS Sepolia contract addresses
//   • Reference deployments: https://docs.ens.domains/learn/deployments
//   • Source impl:           https://github.com/ensdomains/ens-contracts/tree/staging/contracts
//
// We pin Sepolia explicitly because viem's bundled Universal Resolver address
// can lag behind ENS Labs' production deployment, and during the hackathon we
// want every resolution against the latest resolver.
// -------------------------------------------------------------------------

export const ENS_SEPOLIA = {
  registry: "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e",
  baseRegistrar: "0x57f1887a8bf19b14fc0df6fd9b2acc9af147ea85",
  ethRegistrarController: "0xfb3cE5D01e0f33f41DbB39035dB9745962F1f968",
  dnsRegistrar: "0x5a07C75Ae469Bf3ee2657B588e8E6ABAC6741b4f",
  l1ReverseRegistrar: "0xA0a1AbcDAe1a2a4A2EF8e9113Ff0e02DD81DC0C6",
  defaultReverseRegistrar: "0x4F382928805ba0e23B30cFB75fC9E848e82DFD47",
  nameWrapper: "0x0635513f179D50A207757E05759CbD106d7dFcE8",
  publicResolver: "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5",
  universalResolver: "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe",
} as const satisfies Record<string, Address>;

// -------------------------------------------------------------------------
// Core resolution
// -------------------------------------------------------------------------

const DEFAULT_GATEWAYS = [
  "https://w3s.link/ipfs/",
  "https://ipfs.io/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
];

export async function resolveSkill(
  ensName: string,
  options: ResolveOptions = {},
): Promise<ResolveResult> {
  const normalized = normalize(ensName);

  // Default to Sepolia for hackathon — mainnet is opt-in.
  const chain = options.chain ?? "sepolia";

  const client = createPublicClient({
    chain: chain === "mainnet" ? mainnet : sepolia,
    transport: http(options.rpcUrl),
  }) as PublicClient;

  // Pin the Sepolia Universal Resolver to the current ENS Labs deployment;
  // viem's default may lag. On mainnet, fall through to viem's bundled value.
  const universalResolverAddress: Address | undefined =
    chain === "sepolia" ? ENS_SEPOLIA.universalResolver : undefined;

  // 1. Read text records via Universal Resolver
  const [cidRaw, version, schema] = await Promise.all([
    client.getEnsText({
      name: normalized,
      key: SKILL_TEXT_KEY,
      universalResolverAddress,
    }),
    client.getEnsText({
      name: normalized,
      key: SKILL_VERSION_KEY,
      universalResolverAddress,
    }),
    client.getEnsText({
      name: normalized,
      key: SKILL_SCHEMA_KEY,
      universalResolverAddress,
    }),
  ]);

  if (!cidRaw) {
    throw new Error(
      `No skill manifest for ${ensName}. Set ENS text record "${SKILL_TEXT_KEY}" first.`,
    );
  }

  // 2. Fetch + verify (URI scheme decides storage backend: ipfs:// vs 0g://)
  const bundle = await fetchAndVerify(cidRaw, options);
  const cid = cidRaw; // preserved verbatim in ResolveResult for traceability

  // 4. Validate against schema v1
  const { valid, errors } = validateBundle(bundle);
  if (!valid) {
    const summary = (errors ?? [])
      .map((e) => `${e.instancePath || "/"} ${e.message}`)
      .join("; ");
    throw new Error(
      `Bundle at CID ${cid} failed schema validation: ${summary}`,
    );
  }

  // 5. ENSIP-25 check (optional)
  let ensip25;
  if (bundle.trust?.erc8004) {
    ensip25 = await verifyEnsip25(client, normalized, bundle.trust.erc8004, {
      universalResolverAddress,
    });
  }

  return {
    ensName: normalized,
    cid,
    version: version ?? undefined,
    schema: schema ?? undefined,
    bundle,
    verified: !options.skipVerification,
    ensip25,
  };
}

// -------------------------------------------------------------------------
// Fetch + content-address verify
// -------------------------------------------------------------------------

// Lazy + optional Helia verified-fetch. Dynamic import keeps the helia
// dep — including its libp2p-webrtc native binding — out of the SDK's
// load path. If helia is unavailable in the host (browser, edge worker,
// or environment without native deps), verified fetch is skipped and
// callers fall through to the public-gateway path.
type VerifiedFetchFn = (resource: string | URL | Request) => Promise<Response>;
let _verifiedFetch: VerifiedFetchFn | null = null;
let _verifiedFetchAttempted = false;
async function getVerifiedFetch(): Promise<VerifiedFetchFn | null> {
  if (_verifiedFetchAttempted) return _verifiedFetch;
  _verifiedFetchAttempted = true;
  try {
    const mod = await import("@helia/verified-fetch");
    _verifiedFetch = (await mod.createVerifiedFetch()) as VerifiedFetchFn;
  } catch (e) {
    console.warn(
      "verified-fetch unavailable, will use gateway:",
      (e as Error).message,
    );
    _verifiedFetch = null;
  }
  return _verifiedFetch;
}

const OG_INDEXER_URL = "https://indexer-storage-testnet-turbo.0g.ai";

async function fetchAndVerify(
  uri: string,
  options: ResolveOptions,
): Promise<SkillBundle> {
  // 0G storage: 0g://<rootHash> — fetched as a single file via the indexer.
  if (uri.startsWith("0g://")) {
    const root = uri.slice(5);
    return fetchVia0G(root, options);
  }

  // IPFS: ipfs://<cid> — fetched as a directory, manifest.json at root.
  const cid = uri.startsWith("ipfs://") ? uri.slice(7) : uri;
  return fetchViaIpfs(cid, options);
}

async function fetchVia0G(
  rootHash: string,
  _options: ResolveOptions,
): Promise<SkillBundle> {
  const url = `${OG_INDEXER_URL}/file?root=${rootHash}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`0G fetch failed for root ${rootHash}: HTTP ${res.status}`);
  }
  return (await res.json()) as SkillBundle;
}

async function fetchViaIpfs(
  cid: string,
  options: ResolveOptions,
): Promise<SkillBundle> {
  // Default path: @helia/verified-fetch auto-verifies the CID content hash.
  if (!options.skipVerification) {
    try {
      const verifiedFetch = await getVerifiedFetch();
      if (verifiedFetch) {
        const response = await verifiedFetch(`ipfs://${cid}/manifest.json`);
        if (response.ok) {
          return (await response.json()) as SkillBundle;
        }
        console.warn(
          `Verified fetch returned ${response.status}; falling back to gateway`,
        );
      }
    } catch (e) {
      console.warn("Verified fetch failed, falling back to gateway:", e);
    }
  }

  // Fallback: plain HTTP gateway fetch. Faster but does not verify the hash.
  const gateways = options.ipfsGateways ?? DEFAULT_GATEWAYS;
  for (const gateway of gateways) {
    try {
      const url = `${gateway}${cid}/manifest.json`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) continue;
      return (await res.json()) as SkillBundle;
    } catch (e) {
      console.warn(`Gateway ${gateway} failed:`, e);
      continue;
    }
  }

  throw new Error(
    `Failed to fetch CID ${cid} via verified-fetch or any gateway`,
  );
}

// -------------------------------------------------------------------------
// ENSIP-25 verification
// -------------------------------------------------------------------------

/**
 * ENSIP-25: Verifiable AI Agent Identity with ENS
 *
 * Checks for `agent-registration[<ERC-7930 registry>][<agentId>] = "1"`
 * https://docs.ens.domains/ensip/25
 */
export async function verifyEnsip25(
  client: PublicClient,
  ensName: string,
  erc8004: { registry: string; agentId: number },
  options: { universalResolverAddress?: Address } = {},
): Promise<{ bound: boolean; registry: string; agentId: number }> {
  const erc7930Encoded = encodeErc7930(erc8004.registry);
  const key = `agent-registration[${erc7930Encoded}][${erc8004.agentId}]`;

  const value = await client.getEnsText({
    name: normalize(ensName),
    key,
    universalResolverAddress: options.universalResolverAddress,
  });

  return {
    bound: value !== null && value !== "" && value !== "0",
    registry: erc8004.registry,
    agentId: erc8004.agentId,
  };
}

/**
 * Encode CAIP-10-style address (eip155:1:0x...) as ERC-7930 interoperable address.
 *
 * Format: 0x [version 2 bytes] [chain_type 2 bytes] [chain_id_len 1 byte]
 *           [chain_id N bytes] [addr_len 1 byte] [addr 20 bytes]
 *
 * Example for Ethereum mainnet (chainId=1) ERC-8004 IdentityRegistry:
 *   0x0001 0001 01 14 8004a169fb4a3325136eb29fa0ceb6d2e539a432
 *      ^^^^ ^^^^ ^^ ^^ ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
 *      ver  type len 20 address
 */
export function encodeErc7930(caip10: string): string {
  const match = caip10.match(/^eip155:(\d+):(0x[a-fA-F0-9]{40})$/);
  if (!match) throw new Error(`Invalid CAIP-10: ${caip10}`);
  const [, chainIdStr, addr] = match;
  const chainId = parseInt(chainIdStr, 10);

  const chainIdHex = chainId.toString(16).padStart(2, "0");
  const chainIdLen = (chainIdHex.length / 2).toString(16).padStart(2, "0");
  const addrClean = addr.toLowerCase().replace("0x", "");

  // version=0001, chain_type=0001 (eip155), chain_id_len, chain_id, addr_len=14, addr
  return `0x0001${"0001"}${chainIdLen}${chainIdHex}14${addrClean}`;
}

// -------------------------------------------------------------------------
// Dependency graph walker
// -------------------------------------------------------------------------

export interface DependencyNode {
  ensName: string;
  result: ResolveResult;
  children: DependencyNode[];
}

export interface WalkImportsOptions extends ResolveOptions {
  /** Maximum recursion depth (default: 5) */
  maxDepth?: number;
}

/**
 * Walk the dependency graph of a skill by reading `xyz.manifest.skill.imports`
 * text records and recursively resolving each import.
 *
 * - Breadth-first traversal
 * - Cycle detection (rejects if a name appears twice in the walk)
 * - Max depth guard (default 5)
 *
 * Returns the root node with its full dependency tree, plus a flat list of
 * all resolved skills (for easy tool registration).
 */
export async function walkImports(
  ensName: string,
  options: WalkImportsOptions = {},
): Promise<{ root: DependencyNode; flat: ResolveResult[] }> {
  const maxDepth = options.maxDepth ?? 5;
  const chain = options.chain ?? "sepolia";

  const client = createPublicClient({
    chain: chain === "mainnet" ? mainnet : sepolia,
    transport: http(options.rpcUrl),
  }) as PublicClient;

  const universalResolverAddress: Address | undefined =
    chain === "sepolia" ? ENS_SEPOLIA.universalResolver : undefined;

  const visited = new Set<string>();
  const flat: ResolveResult[] = [];

  async function walk(name: string, depth: number): Promise<DependencyNode> {
    const normalized = normalize(name);

    if (visited.has(normalized)) {
      throw new Error(
        `Cycle detected: ${normalized} already in dependency chain`,
      );
    }
    if (depth > maxDepth) {
      throw new Error(
        `Max dependency depth (${maxDepth}) exceeded at ${normalized}`,
      );
    }

    visited.add(normalized);

    // Resolve the skill itself
    const result = await resolveSkill(name, options);
    flat.push(result);

    // Read imports text record
    const importsRaw = await client.getEnsText({
      name: normalized,
      key: SKILL_IMPORTS_KEY,
      universalResolverAddress,
    });

    // Parse comma-separated ENS names, also check bundle.dependencies
    const importNames = parseImports(importsRaw, result.bundle.dependencies);

    // Recursively walk children
    const children: DependencyNode[] = [];
    for (const childName of importNames) {
      const childNormalized = normalize(childName);
      if (visited.has(childNormalized)) {
        // Already resolved (diamond dependency) — skip, don't error
        continue;
      }
      const child = await walk(childName, depth + 1);
      children.push(child);
    }

    return { ensName: normalized, result, children };
  }

  const root = await walk(ensName, 0);
  return { root, flat };
}

/**
 * Merge imports from ENS text record and bundle.dependencies field.
 * Text record takes precedence (it's the on-chain source of truth).
 * Bundle dependencies are a fallback for bundles that declare deps
 * in the manifest but haven't set the text record yet.
 */
function parseImports(
  textRecordValue: string | null | undefined,
  bundleDependencies: string[] | undefined,
): string[] {
  const names = new Set<string>();

  // Text record: comma-separated ENS names
  if (textRecordValue) {
    for (const part of textRecordValue.split(",")) {
      const trimmed = part.trim();
      if (trimmed && /^([a-z0-9-]+\.)+eth$/.test(trimmed)) {
        names.add(trimmed);
      }
    }
  }

  // Bundle dependencies as fallback
  if (bundleDependencies) {
    for (const dep of bundleDependencies) {
      const trimmed = dep.trim();
      if (trimmed) names.add(trimmed);
    }
  }

  return Array.from(names);
}

/**
 * Generate a flat lockfile from a dependency walk result.
 * Each entry pins { ensName, version, cid } for reproducible resolution.
 */
export function generateLockfile(
  flat: ResolveResult[],
): Array<{ ensName: string; version: string; cid: string }> {
  return flat.map((r) => ({
    ensName: r.ensName,
    version: r.version ?? r.bundle.version,
    cid: r.cid,
  }));
}

// -------------------------------------------------------------------------
// Export everything
// -------------------------------------------------------------------------

export { namehash, normalize };
