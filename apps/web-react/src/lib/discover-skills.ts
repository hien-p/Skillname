import { namehash, parseAbi, type PublicClient } from "viem";
import { CATALOG_ITEMS } from "../components/SkillCatalog";

const ENS_REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e" as const;
const ENS_REGISTRY_ABI = parseAbi([
  "function owner(bytes32 node) view returns (address)",
  "function resolver(bytes32 node) view returns (address)",
]);
const RESOLVER_ABI = parseAbi([
  "function text(bytes32 node, string key) view returns (string)",
]);

export interface DiscoveredSkill {
  ensName: string;
  version?: string;
  cid?: string;
}

/**
 * For each catalog ENS name, ask the ENS Registry who owns it on Sepolia.
 * Returns the names owned by `address` along with their version + manifest CID
 * so MySkillsCard can render them as "skills you actually own on-chain."
 */
export async function discoverOwnedSkills(
  client: PublicClient,
  address: `0x${string}`,
): Promise<DiscoveredSkill[]> {
  const lower = address.toLowerCase();

  // Stage 1: who owns each catalog name?
  const ownerCalls = await Promise.all(
    CATALOG_ITEMS.map(async (item) => {
      try {
        const owner = (await client.readContract({
          address: ENS_REGISTRY,
          abi: ENS_REGISTRY_ABI,
          functionName: "owner",
          args: [namehash(item.ens)],
        })) as `0x${string}`;
        return { ens: item.ens, owner };
      } catch {
        return { ens: item.ens, owner: "0x0000000000000000000000000000000000000000" as `0x${string}` };
      }
    }),
  );

  const mine = ownerCalls.filter((o) => o.owner.toLowerCase() === lower);
  if (mine.length === 0) return [];

  // Stage 2: for owned names, fetch resolver + text records (best-effort).
  const enriched = await Promise.all(
    mine.map(async ({ ens }) => {
      const node = namehash(ens);
      try {
        const resolverAddr = (await client.readContract({
          address: ENS_REGISTRY,
          abi: ENS_REGISTRY_ABI,
          functionName: "resolver",
          args: [node],
        })) as `0x${string}`;
        if (resolverAddr === "0x0000000000000000000000000000000000000000") {
          return { ensName: ens };
        }
        const [version, manifest] = await Promise.all([
          client
            .readContract({
              address: resolverAddr,
              abi: RESOLVER_ABI,
              functionName: "text",
              args: [node, "xyz.manifest.skill.version"],
            })
            .catch(() => ""),
          client
            .readContract({
              address: resolverAddr,
              abi: RESOLVER_ABI,
              functionName: "text",
              args: [node, "xyz.manifest.skill"],
            })
            .catch(() => ""),
        ]);
        return {
          ensName: ens,
          version: (version as string) || undefined,
          cid: ((manifest as string) || "").replace(/^(ipfs|0g):\/\//, "") || undefined,
        };
      } catch {
        return { ensName: ens };
      }
    }),
  );

  return enriched;
}
