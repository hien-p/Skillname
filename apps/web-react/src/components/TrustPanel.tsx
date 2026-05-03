import { useState } from "react";
import { usePublicClient } from "wagmi";
import { encodePacked, namehash, parseAbi, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { IDENTITY_REGISTRY_ADDR, SKILL_NFT_ADDR } from "../lib/contracts";
import type { SkillManifest } from "../lib/skill-resolve";

const RESOLVER_ADDR = "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5" as const;
const RESOLVER_ABI = parseAbi(["function text(bytes32 node, string key) external view returns (string)"]);
const REGISTRY_ABI = parseAbi([
  "function nameOf(uint256 agentId) external view returns (string)",
  "function ownerOf(uint256 agentId) external view returns (address)",
]);
const NFT_ABI = parseAbi([
  "function totalSupply() external view returns (uint256)",
  "function agents(uint256 tokenId) external view returns (bytes32 ensNode, uint256 agentId, string metadataUri, address minter, uint64 mintedAt)",
]);

interface VerifyResult {
  manifestSays: { registry: string; agentId: number };
  registryName: string | null;        // IdentityRegistry.nameOf(agentId)
  registryOwner: string | null;       // IdentityRegistry.ownerOf(agentId)
  textRecordKey: string;              // agent-registration[<erc7930>][<agentId>]
  textRecordValue: string;            // "1" if bound
  bound: boolean;
  matchingNftTokenId: number | null;
  ms: number;
}

/** ERC-7930 encode for eip155:<chainId>:<addr>. Mirrors @skillname/sdk's encodeErc7930. */
function encodeErc7930(caip10: string): Hex {
  const m = caip10.match(/^eip155:(\d+):(0x[a-fA-F0-9]{40})$/);
  if (!m) throw new Error(`invalid caip10: ${caip10}`);
  const chainId = parseInt(m[1], 10);
  const addr = m[2].slice(2).toLowerCase();
  let chainHex = chainId.toString(16);
  if (chainHex.length % 2 === 1) chainHex = "0" + chainHex;
  const lenHex = (chainHex.length / 2).toString(16).padStart(2, "0");
  return `0x0001${"0000"}${lenHex}${chainHex}14${addr}` as Hex;
}

interface Props {
  ensName: string;
  manifest: SkillManifest;
}

export function TrustPanel({ ensName, manifest }: Props) {
  const publicClient = usePublicClient({ chainId: sepolia.id });
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trust = manifest.trust;
  const ensip25Enabled = trust?.ensip25?.enabled ?? false;
  const erc8004 = trust?.erc8004;
  const registryAddress = erc8004?.registry?.split(":").pop();

  async function verify() {
    if (!publicClient || !erc8004) return;
    setVerifying(true);
    setError(null);
    setResult(null);
    const t0 = performance.now();
    try {
      const erc7930 = encodeErc7930(erc8004.registry);
      const textRecordKey = `agent-registration[${erc7930}][${erc8004.agentId}]`;
      const node = namehash(ensName);

      const [registryName, registryOwner, textRecordValue] = await Promise.all([
        publicClient
          .readContract({
            address: IDENTITY_REGISTRY_ADDR,
            abi: REGISTRY_ABI,
            functionName: "nameOf",
            args: [BigInt(erc8004.agentId)],
          })
          .catch(() => null as string | null),
        publicClient
          .readContract({
            address: IDENTITY_REGISTRY_ADDR,
            abi: REGISTRY_ABI,
            functionName: "ownerOf",
            args: [BigInt(erc8004.agentId)],
          })
          .catch(() => null as string | null),
        publicClient
          .readContract({
            address: RESOLVER_ADDR,
            abi: RESOLVER_ABI,
            functionName: "text",
            args: [node, textRecordKey],
          })
          .catch(() => "" as string),
      ]);

      // Look for a matching SkillNFT (best-effort scan)
      let matchingNftTokenId: number | null = null;
      try {
        const total = (await publicClient.readContract({
          address: SKILL_NFT_ADDR,
          abi: NFT_ABI,
          functionName: "totalSupply",
        })) as bigint;
        for (let i = 1n; i <= total && i <= 25n; i++) {
          const agent = (await publicClient.readContract({
            address: SKILL_NFT_ADDR,
            abi: NFT_ABI,
            functionName: "agents",
            args: [i],
          })) as readonly [Hex, bigint, string, Hex, bigint];
          if (agent[0] === node) {
            matchingNftTokenId = Number(i);
            break;
          }
        }
      } catch {
        /* ignore — NFT lookup is bonus */
      }

      const bound = textRecordValue !== "" && textRecordValue !== "0";
      setResult({
        manifestSays: { registry: erc8004.registry, agentId: erc8004.agentId },
        registryName: typeof registryName === "string" ? registryName : null,
        registryOwner: typeof registryOwner === "string" ? registryOwner : null,
        textRecordKey,
        textRecordValue: typeof textRecordValue === "string" ? textRecordValue : "",
        bound,
        matchingNftTokenId,
        ms: Math.round(performance.now() - t0),
      });
      void encodePacked; // silence import linter for unused helper
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="mt-8">
      <h2 className="font-display text-3xl mb-2">Trust</h2>
      <p className="font-body text-sm text-slate-ink mb-6 max-w-2xl">
        ENSIP-25 binds this ENS name to an external agent identity (an ERC-8004
        registry entry). Both sides must agree: the manifest declares
        <code className="font-mono mx-1">trust.erc8004</code>
        and the ENS name carries a matching
        <code className="font-mono mx-1">agent-registration[…][…]</code>
        text record. This proves the skill is who it says it is — independent of
        whoever pinned the manifest.
      </p>

      <ul className="space-y-2">
        <li className="flex items-center gap-2">
          <Pip ok={ensip25Enabled} />
          ENSIP-25 — {ensip25Enabled ? "enabled" : "disabled"}
        </li>
        <li className="flex items-start gap-2">
          <Pip ok={!!erc8004} />
          {erc8004 ? (
            <span>
              ERC-8004 binding — registry{" "}
              <a
                href={`https://sepolia.etherscan.io/address/${registryAddress}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-xs underline break-all"
              >
                {registryAddress}
              </a>{" "}
              · agentId{" "}
              <a
                href={`https://sepolia.etherscan.io/address/${registryAddress}#readContract`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-xs underline"
              >
                {erc8004.agentId} ↗
              </a>
            </span>
          ) : (
            <span>ERC-8004 binding — none</span>
          )}
        </li>
      </ul>

      {erc8004 && (
        <div className="mt-6">
          <button
            onClick={verify}
            disabled={verifying}
            className="bg-midnight-navy text-pure-surface px-4 py-2 font-mono text-xs uppercase tracking-wider hover:-translate-y-px transition disabled:opacity-50"
          >
            {verifying ? "Verifying…" : "✓ Verify on-chain"}
          </button>
          {error && <div className="mt-3 font-mono text-xs text-bento-accent-red">error · {error}</div>}
          {result && (
            <div className="mt-4 border border-fog-border bg-pure-surface rounded p-4 font-mono text-xs space-y-2">
              <div className="font-semibold text-midnight-navy">
                {result.bound ? "✓ bound — both sides agree" : "✗ not bound — text record missing or 0"}
                <span className="ml-2 text-slate-ink">({result.ms}ms)</span>
              </div>
              <Row label="Registry name(agentId)">
                <code>{result.registryName || "—"}</code>
              </Row>
              <Row label="Registry owner(agentId)">
                <code className="break-all">{result.registryOwner || "—"}</code>
              </Row>
              <Row label="Text record key">
                <code className="break-all">{result.textRecordKey}</code>
              </Row>
              <Row label="Text record value">
                <code>{result.textRecordValue || "(empty)"}</code>
              </Row>
              {result.matchingNftTokenId !== null && (
                <Row label="SkillNFT token">
                  <a
                    href={`https://sepolia.etherscan.io/token/${SKILL_NFT_ADDR}?a=${result.matchingNftTokenId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    🪙 #{result.matchingNftTokenId} on SkillNFT ↗
                  </a>
                </Row>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[180px_1fr] gap-2">
      <span className="text-slate-ink uppercase tracking-wider text-[10px]">{label}</span>
      <span>{children}</span>
    </div>
  );
}

function Pip({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full mt-1.5 ${
        ok ? "bg-bento-success" : "bg-fog-border"
      }`}
    />
  );
}
