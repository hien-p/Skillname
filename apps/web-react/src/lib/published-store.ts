// Per-wallet log of skills the user has published from this browser.
// Written by PublishOverlay on successful tx, read by MySkillsCard.
// Not the source of truth — chain is — but reliable for the demo and
// instant for the "my skills" surface without a subgraph dependency.

export interface PublishedSkill {
  ensName: string;
  version: string;
  cid: string;
  txHash: `0x${string}`;
  ts: number;
}

const KEY_PREFIX = "skillname:published:";
const EVENT = "skillname:published-changed";

const key = (addr: string) => `${KEY_PREFIX}${addr.toLowerCase()}`;

export function listPublished(addr?: string | null): PublishedSkill[] {
  if (!addr) return [];
  try {
    const raw = localStorage.getItem(key(addr));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PublishedSkill[];
    return parsed.sort((a, b) => b.ts - a.ts);
  } catch {
    return [];
  }
}

export function addPublished(addr: string, entry: PublishedSkill) {
  const existing = listPublished(addr);
  // Replace any prior entry for the same ENS+version
  const filtered = existing.filter(
    (e) => !(e.ensName === entry.ensName && e.version === entry.version),
  );
  const next = [entry, ...filtered].slice(0, 50);
  localStorage.setItem(key(addr), JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { addr } }));
}

export function subscribePublished(addr: string | undefined, cb: () => void): () => void {
  const handler = (e: Event) => {
    if (!addr) return;
    const detail = (e as CustomEvent).detail as { addr?: string } | undefined;
    if (!detail?.addr || detail.addr.toLowerCase() === addr.toLowerCase()) cb();
  };
  const storageHandler = (e: StorageEvent) => {
    if (!addr) return;
    if (e.key === key(addr)) cb();
  };
  window.addEventListener(EVENT, handler);
  window.addEventListener("storage", storageHandler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener("storage", storageHandler);
  };
}
