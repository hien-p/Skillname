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
/** Versions index: CSV of `<label>:<semver>` pairs published as subnames. */
export const SKILL_VERSIONS_KEY = "xyz.manifest.skill.versions";
export const SKILL_LATEST_KEY = "xyz.manifest.skill.latest";

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
      /**
       * If true, dispatch through SkillLink.call(namehash(address), calldata)
       * instead of calling the impl directly. Requires `address` to be an ENS
       * name registered in the registry. Adds the on-chain selector allowlist
       * + SkillCalled analytics event to off-chain MCP calls.
       */
      useRegistry?: boolean;
      /**
       * Optional override for the SkillLink registry address. Falls back to
       * the bridge's canonical deployment per chainId when omitted.
       */
      registry?: string;
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
  // If the name carries a semver range suffix (e.g. "quote.uniswap.eth@^1"),
  // first resolve it to a concrete versioned subname via the parent's
  // `xyz.manifest.skill.versions` index. Falls through to direct resolution
  // when no `@<range>` suffix is present.
  if (ensName.includes("@")) {
    ensName = await resolveVersionedName(ensName, {
      chain: options.chain,
      rpcUrl: options.rpcUrl,
    });
  }

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
 * Encode CAIP-10-style address (eip155:<chainId>:0x...) as ERC-7930
 * interoperable address.
 *
 * Per EIP-7930:
 *   version            : 2 bytes  — 0x0001 for v1
 *   chain_type         : 2 bytes  — 0x0000 for EVM chains (CASA namespace id)
 *   chain_ref_length   : 1 byte
 *   chain_reference    : N bytes  — chainId as canonical big-endian (no leading-zero pad)
 *   address_length     : 1 byte
 *   address            : 20 bytes for EVM
 *
 * Worked example — ENSIP-25 spec reference (Ethereum mainnet, ERC-8004 at
 * 0x8004A169…, agentId 167):
 *   0x0001 0000 01 01 14 8004a169fb4a3325136eb29fa0ceb6d2e539a432
 *      ^^^^ ^^^^ ^^ ^^ ^^ ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
 *      ver  evm  cref-len/ref addr-len address
 *   = 0x000100000101148004a169fb4a3325136eb29fa0ceb6d2e539a432
 *
 * Sepolia (chainId 11155111 = 0xaa36a7, 3 canonical bytes):
 *   0x0001 0000 03 aa36a7 14 <addr>
 */
export function encodeErc7930(caip10: string): string {
  const match = caip10.match(/^eip155:(\d+):(0x[a-fA-F0-9]{40})$/);
  if (!match) throw new Error(`Invalid CAIP-10: ${caip10}`);
  const [, chainIdStr, addr] = match;
  const chainId = parseInt(chainIdStr, 10);
  if (chainId < 1) throw new Error(`Invalid chainId: ${chainId}`);

  // Canonical big-endian minimum bytes — pad to even hex digits, no extra
  // leading zero on the byte boundary.
  let chainIdHex = chainId.toString(16);
  if (chainIdHex.length % 2 === 1) chainIdHex = "0" + chainIdHex;
  const chainIdBytes = chainIdHex.length / 2;
  const chainIdLenHex = chainIdBytes.toString(16).padStart(2, "0");

  const addrClean = addr.toLowerCase().replace("0x", "");

  // 0x0001 (version) | 0x0000 (chain_type=EVM) | <len> | <chainId> | 0x14 | <addr>
  return `0x0001${"0000"}${chainIdLenHex}${chainIdHex}14${addrClean}`;
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
  /**
   * If true, check the root for `xyz.manifest.skill.lockfile` and use the
   * pinned CIDs in the lockfile for transitive resolution instead of
   * walking ENS imports fresh. Falls through to live resolution if no
   * lockfile is present. Default: true (reproducible by default).
   */
  useLockfile?: boolean;
}

export interface LockfileEntry {
  ensName: string;
  version: string;
  cid: string;
}

export interface LockfileDocument {
  $schema?: string;
  root: string;
  generatedAt?: string;
  entries: LockfileEntry[];
}

/**
 * Fetch and parse a lockfile JSON given its URI (`0g://0x…` or `ipfs://…`).
 * Reuses the same fetch path as bundle manifests.
 */
export async function fetchLockfile(
  uri: string,
  options: ResolveOptions = {},
): Promise<LockfileDocument> {
  if (uri.startsWith("0g://")) {
    const root = uri.slice(5);
    const url = `${OG_INDEXER_URL}/file?root=${root}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`0G fetch for lockfile ${root}: HTTP ${res.status}`);
    return (await res.json()) as LockfileDocument;
  }
  if (uri.startsWith("ipfs://")) {
    const cid = uri.slice(7);
    const gateways = options.ipfsGateways ?? DEFAULT_GATEWAYS;
    for (const gw of gateways) {
      try {
        const r = await fetch(`${gw}${cid}`);
        if (r.ok) return (await r.json()) as LockfileDocument;
      } catch {
        /* try next */
      }
    }
    throw new Error(`all IPFS gateways failed for lockfile ${cid}`);
  }
  throw new Error(`unsupported lockfile URI: ${uri.slice(0, 12)}…`);
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
): Promise<{
  root: DependencyNode;
  flat: ResolveResult[];
  /** Set when transitive resolution was driven by a lockfile (reproducible build). */
  lockfile?: LockfileDocument;
}> {
  const maxDepth = options.maxDepth ?? 5;
  const useLockfile = options.useLockfile ?? true;
  const chain = options.chain ?? "sepolia";

  const client = createPublicClient({
    chain: chain === "mainnet" ? mainnet : sepolia,
    transport: http(options.rpcUrl),
  }) as PublicClient;

  const universalResolverAddress: Address | undefined =
    chain === "sepolia" ? ENS_SEPOLIA.universalResolver : undefined;

  // ── Step 1: resolve the root via live ENS so we can read its lockfile record ──
  const rootResult = await resolveSkill(ensName, options);
  const rootNormalized = normalize(ensName);

  // ── Step 2: optionally use a lockfile for transitive resolution ──
  let lockfile: LockfileDocument | undefined;
  if (useLockfile) {
    const lockfileUri = await client.getEnsText({
      name: rootNormalized,
      key: SKILL_LOCKFILE_KEY,
      universalResolverAddress,
    });
    if (lockfileUri) {
      try {
        lockfile = await fetchLockfile(lockfileUri, options);
      } catch (e) {
        // Lockfile present but unfetchable — fall back to live resolution
        // rather than fail loud, so a misconfigured pin doesn't break import.
        console.warn(
          `lockfile at ${lockfileUri} unfetchable, falling back to live resolution: ${(e as Error).message}`,
        );
      }
    }
  }

  // Lockfile-driven path: load each entry's manifest at the pinned CID.
  if (lockfile) {
    const flat: ResolveResult[] = [rootResult];
    const childResults = new Map<string, ResolveResult>();
    for (const entry of lockfile.entries) {
      if (normalize(entry.ensName) === rootNormalized) continue;
      const bundle = await fetchAndVerify(entry.cid, options);
      const r: ResolveResult = {
        ensName: normalize(entry.ensName),
        cid: entry.cid,
        version: entry.version,
        bundle,
        verified: !options.skipVerification,
      };
      flat.push(r);
      childResults.set(r.ensName, r);
    }

    // Reconstruct a tree shape from the manifests' declared imports for the
    // benefit of callers that traverse children.
    function buildNode(name: string, result: ResolveResult, depth: number): DependencyNode {
      if (depth > maxDepth) {
        throw new Error(`Max dependency depth (${maxDepth}) exceeded at ${name}`);
      }
      const importNames = parseImports(undefined, result.bundle.dependencies);
      const children: DependencyNode[] = [];
      for (const childName of importNames) {
        const childN = normalize(childName);
        const childResult = childResults.get(childN);
        if (!childResult) {
          // Lockfile is incomplete for this branch — skip rather than error.
          continue;
        }
        children.push(buildNode(childName, childResult, depth + 1));
      }
      return { ensName: normalize(name), result, children };
    }
    const root = buildNode(ensName, rootResult, 0);
    return { root, flat, lockfile };
  }

  // ── Live ENS-driven path (original behavior) ──
  const visited = new Set<string>();
  visited.add(rootNormalized);
  const flat: ResolveResult[] = [rootResult];

  async function walk(name: string, depth: number, result: ResolveResult): Promise<DependencyNode> {
    const normalized = normalize(name);

    // Read imports text record
    const importsRaw = await client.getEnsText({
      name: normalized,
      key: SKILL_IMPORTS_KEY,
      universalResolverAddress,
    });

    const importNames = parseImports(importsRaw, result.bundle.dependencies);

    const children: DependencyNode[] = [];
    for (const childName of importNames) {
      const childNormalized = normalize(childName);
      if (visited.has(childNormalized)) {
        continue;
      }
      if (depth + 1 > maxDepth) {
        throw new Error(
          `Max dependency depth (${maxDepth}) exceeded at ${childNormalized}`,
        );
      }
      visited.add(childNormalized);
      const childResult = await resolveSkill(childName, options);
      flat.push(childResult);
      children.push(await walk(childName, depth + 1, childResult));
    }

    return { ensName: normalized, result, children };
  }

  const root = await walk(ensName, 0, rootResult);
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
// Versioning — semver matching against the per-name version index
// -------------------------------------------------------------------------
//
// Spec (matches the ENSIP-25 / xyz.manifest.skill.* family):
//   xyz.manifest.skill.versions  = "v1:1.0.0,v2:2.0.0,v3:2.1.0"   (CSV)
//   xyz.manifest.skill.latest    = "v3"                            (subname label)
//
// Each <label> in the versions index is the subname under the parent that
// pins that exact version's bundle CID. e.g. for `quote.uniswap.eth`:
//   v1.quote.uniswap.eth → manifest at version 1.0.0
//   v2.quote.uniswap.eth → manifest at version 2.0.0
//
// `matchVersionRange("^1", index)` returns the highest matching label.

export interface VersionEntry {
  label: string;   // subname label, e.g. "v1"
  version: string; // semver, e.g. "1.0.0"
}

/**
 * Parse the CSV `xyz.manifest.skill.versions` text record.
 *
 * @example
 *   parseVersionsRecord("v1:1.0.0,v2:2.0.0,v3:2.1.0")
 *   // → [{label:"v1",version:"1.0.0"}, {label:"v2",version:"2.0.0"}, ...]
 */
export function parseVersionsRecord(raw: string): VersionEntry[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf(":");
      if (i === -1) throw new Error(`malformed versions entry: "${pair}"`);
      return { label: pair.slice(0, i).trim(), version: pair.slice(i + 1).trim() };
    });
}

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
}

function parseSemver(v: string): ParsedSemver {
  const m = v.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`invalid semver: "${v}"`);
  return { major: +m[1], minor: +m[2], patch: +m[3] };
}

function compareSemver(a: ParsedSemver, b: ParsedSemver): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/**
 * Test whether a concrete semver `v` satisfies an npm-style range `range`.
 * Supports: exact ("1.2.3"), caret ("^1.2.3"), tilde ("~1.2.3"),
 * "latest" / "*" wildcard, and bare-major shorthands like "^1" or "~2".
 */
export function semverSatisfies(v: string, range: string): boolean {
  range = range.trim();
  if (range === "*" || range === "latest" || range === "") return true;

  const sv = parseSemver(v);

  if (range.startsWith("^")) {
    // ^x.y.z accepts >=x.y.z, <(x+1).0.0   (or ^x → ^x.0.0)
    const r = parseSemver(normalizeShorthand(range.slice(1)));
    return (
      sv.major === r.major &&
      compareSemver(sv, r) >= 0
    );
  }
  if (range.startsWith("~")) {
    // ~x.y.z accepts >=x.y.z, <x.(y+1).0   (or ~x → ~x.0.0)
    const r = parseSemver(normalizeShorthand(range.slice(1)));
    return (
      sv.major === r.major &&
      sv.minor === r.minor &&
      compareSemver(sv, r) >= 0
    );
  }
  // Exact match (or "v"-prefixed exact)
  return compareSemver(sv, parseSemver(normalizeShorthand(range))) === 0;
}

function normalizeShorthand(v: string): string {
  // "1" → "1.0.0", "1.2" → "1.2.0", "1.2.3" → "1.2.3", "v1" → "v1.0.0"
  const stripped = v.startsWith("v") ? v.slice(1) : v;
  const parts = stripped.split(".");
  while (parts.length < 3) parts.push("0");
  return parts.join(".");
}

/**
 * Pick the highest version in `index` that satisfies `range`.
 * Returns null if no entry matches.
 */
export function matchVersionRange(
  range: string,
  index: VersionEntry[],
): VersionEntry | null {
  const matches = index.filter((e) => semverSatisfies(e.version, range));
  if (matches.length === 0) return null;
  matches.sort((a, b) => compareSemver(parseSemver(b.version), parseSemver(a.version)));
  return matches[0];
}

/**
 * Resolve a versioned ENS name like `quote.uniswap.eth@^1` into the concrete
 * subname (`v1.quote.uniswap.eth`). Reads the parent's
 * `xyz.manifest.skill.versions` text record + matches the range.
 *
 * If the name has no `@<range>` suffix, returns the name unchanged.
 * If the name's parent has no versions index, throws — callers can catch
 * and fall back to direct resolution.
 */
export async function resolveVersionedName(
  ensNameWithRange: string,
  options: { chain?: "mainnet" | "sepolia"; rpcUrl?: string } = {},
): Promise<string> {
  const i = ensNameWithRange.indexOf("@");
  if (i === -1) return ensNameWithRange;

  const parent = ensNameWithRange.slice(0, i);
  const range = ensNameWithRange.slice(i + 1);

  const chain = options.chain ?? "sepolia";
  const client = createPublicClient({
    chain: chain === "mainnet" ? mainnet : sepolia,
    transport: http(options.rpcUrl),
  }) as PublicClient;
  const universalResolverAddress: Address | undefined =
    chain === "sepolia" ? ENS_SEPOLIA.universalResolver : undefined;

  const versionsRaw = await client.getEnsText({
    name: normalize(parent),
    key: SKILL_VERSIONS_KEY,
    universalResolverAddress,
  });
  if (!versionsRaw) {
    throw new Error(
      `${parent} has no ${SKILL_VERSIONS_KEY} text record — cannot match range "${range}"`,
    );
  }

  const index = parseVersionsRecord(versionsRaw);
  const match = matchVersionRange(range, index);
  if (!match) {
    throw new Error(
      `no version in ${parent} satisfies range "${range}". Available: ${index.map((e) => `${e.label}:${e.version}`).join(", ")}`,
    );
  }
  return `${match.label}.${parent}`;
}

// -------------------------------------------------------------------------
// Export everything
// -------------------------------------------------------------------------

export { namehash, normalize };
