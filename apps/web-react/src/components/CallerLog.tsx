import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { sepolia } from "viem/chains";
import { mainnet } from "viem/chains";
import { createPublicClient, http } from "viem";
import {
  fetchSkillEvents,
  decodeSelector,
  type SkillEvent,
  type SkillEventStream,
} from "../lib/skill-events";

interface Props {
  ensName: string;
}

// Mainnet client just for ENS reverse-resolution of caller addresses.
// Sepolia ENS reverse-resolves to an empty string for most addresses, but
// mainnet often has primary names set (judges + devs use the same wallet
// across networks). This is read-only and rate-limited by the public RPC.
const ensClient = createPublicClient({
  chain: mainnet,
  transport: http(),
});

const cachedEnsNames = new Map<string, string | null>();

async function reverseEns(addr: `0x${string}`): Promise<string | null> {
  const k = addr.toLowerCase();
  if (cachedEnsNames.has(k)) return cachedEnsNames.get(k)!;
  try {
    const name = await ensClient.getEnsName({ address: addr });
    cachedEnsNames.set(k, name);
    return name;
  } catch {
    cachedEnsNames.set(k, null);
    return null;
  }
}

export function CallerLog({ ensName }: Props) {
  const sepoliaClient = usePublicClient({ chainId: sepolia.id });
  const [stream, setStream] = useState<SkillEventStream | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [labels, setLabels] = useState<{
    ens: Record<string, string>;
    sigs: Record<string, string>;
  }>({ ens: {}, sigs: {} });

  useEffect(() => {
    if (!sepoliaClient) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setStream(null);
    fetchSkillEvents(sepoliaClient, ensName)
      .then(async (s) => {
        if (cancelled) return;
        setStream(s);
        // Kick off ENS reverse + 4byte decodes in parallel; fold into state
        // as they resolve.
        const callers = new Set<string>();
        const selectors = new Set<string>();
        for (const e of s.events) {
          if (e.kind === "called") {
            callers.add(e.caller.toLowerCase());
            selectors.add(e.selector);
          }
          if (e.kind === "registered") {
            callers.add(e.owner.toLowerCase());
            for (const sel of e.selectors) selectors.add(sel);
          }
        }
        const [names, sigs] = await Promise.all([
          Promise.all(
            [...callers].map(async (addr) => [
              addr,
              await reverseEns(addr as `0x${string}`),
            ]),
          ),
          Promise.all(
            [...selectors].map(async (sel) => [
              sel,
              await decodeSelector(sel as `0x${string}`),
            ]),
          ),
        ]);
        if (cancelled) return;
        setLabels({
          ens: Object.fromEntries(names.filter(([, v]) => v) as [string, string][]),
          sigs: Object.fromEntries(sigs.filter(([, v]) => v) as [string, string][]),
        });
      })
      .catch((e) => !cancelled && setError(String(e instanceof Error ? e.message : e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [ensName, sepoliaClient]);

  if (loading) {
    return (
      <div className="mt-6 border-t border-fog-border pt-6">
        <div className="font-mono text-xs text-slate-ink">
          scanning SkillLink event log on Sepolia…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-6 border-t border-fog-border pt-6">
        <div className="font-mono text-xs text-bento-accent-red">
          activity log error · {error}
        </div>
      </div>
    );
  }

  if (!stream) return null;

  const { events, totalsByKind, uniqueCallers, scannedFromBlock, scannedToBlock, ms } = stream;
  const total = events.length;

  return (
    <div className="mt-6 border-t border-fog-border pt-6">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h3 className="font-display text-2xl">Activity</h3>
        <div className="font-mono text-[10px] uppercase tracking-wider text-slate-ink">
          {total} events · {totalsByKind.called} calls · {uniqueCallers} unique callers ·{" "}
          scanned {(scannedToBlock - scannedFromBlock).toString()} blocks · {ms}ms
        </div>
      </div>
      <p className="font-body text-xs text-slate-ink mt-1">
        Every <code className="font-mono">SkillLink.register</code> + dispatch on this ENS name. Read live from the
        contract event log on Sepolia — same provenance an indexer would build on.
      </p>

      {total === 0 && (
        <div className="mt-4 rounded border border-fog-border bg-pure-surface p-4 font-mono text-xs text-slate-ink">
          No on-chain activity for{" "}
          <code className="text-midnight-navy">{ensName}</code> yet. Once someone registers an
          impl or calls a selector, the event lands here.
        </div>
      )}

      {total > 0 && (
        <ol className="mt-4 space-y-2">
          {events.map((e, i) => (
            <EventRow
              key={`${e.txHash}-${i}`}
              event={e}
              ensLabel={resolveLabel(e, labels.ens)}
              sigLabel={resolveSig(e, labels.sigs)}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function resolveLabel(e: SkillEvent, ens: Record<string, string>): string | null {
  const addr =
    e.kind === "called" ? e.caller : e.kind === "registered" ? e.owner : null;
  if (!addr) return null;
  return ens[addr.toLowerCase()] ?? null;
}

function resolveSig(e: SkillEvent, sigs: Record<string, string>): string | null {
  if (e.kind === "called") return sigs[e.selector] ?? null;
  if (e.kind === "registered") {
    const decoded = e.selectors
      .map((sel) => sigs[sel])
      .filter(Boolean) as string[];
    return decoded.length > 0 ? decoded.join(", ") : null;
  }
  return null;
}

function EventRow({
  event,
  ensLabel,
  sigLabel,
}: {
  event: SkillEvent;
  ensLabel: string | null;
  sigLabel: string | null;
}) {
  if (event.kind === "registered") {
    return (
      <li className="rounded border border-fog-border bg-pure-surface p-3">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <span className="font-mono text-[10px] uppercase tracking-wider text-bento-success">
            ● REGISTERED
          </span>
          <BlockLink txHash={event.txHash} blockNumber={event.blockNumber} />
        </div>
        <div className="mt-1 font-mono text-xs text-midnight-navy">
          {ensLabel ? (
            <span className="text-midnight-navy font-semibold">{ensLabel}</span>
          ) : (
            <AddrLink addr={event.owner} />
          )}{" "}
          <span className="text-slate-ink">bound impl</span>{" "}
          <AddrLink addr={event.impl} />
        </div>
        <div className="mt-1 font-mono text-[11px] text-slate-ink">
          selectors: {event.selectors.length}{" "}
          {event.selectors.map((s) => (
            <code key={s} className="ml-1 text-midnight-navy">{s}</code>
          ))}
          {sigLabel && (
            <span className="ml-2 text-bento-success">
              → {sigLabel}
            </span>
          )}
        </div>
      </li>
    );
  }
  if (event.kind === "called") {
    return (
      <li className="rounded border border-fog-border bg-pure-surface p-3">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <span
            className={`font-mono text-[10px] uppercase tracking-wider ${
              event.success ? "text-bento-success" : "text-bento-accent-red"
            }`}
          >
            ● CALLED {event.success ? "" : "· reverted"}
          </span>
          <BlockLink txHash={event.txHash} blockNumber={event.blockNumber} />
        </div>
        <div className="mt-1 font-mono text-xs text-midnight-navy">
          {ensLabel ? (
            <span className="font-semibold">{ensLabel}</span>
          ) : (
            <AddrLink addr={event.caller} />
          )}{" "}
          <span className="text-slate-ink">called</span>{" "}
          <code className="text-midnight-navy">{event.selector}</code>
          {sigLabel && (
            <span className="ml-2 text-bento-success font-mono text-[11px]">
              {sigLabel}
            </span>
          )}
        </div>
      </li>
    );
  }
  // unknown
  return (
    <li className="rounded border border-fog-border bg-pure-surface p-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <span className="font-mono text-[10px] uppercase tracking-wider text-slate-ink">
          ● UNKNOWN EVENT
        </span>
        <BlockLink txHash={event.txHash} blockNumber={event.blockNumber} />
      </div>
      <div className="mt-1 font-mono text-[10px] text-slate-ink break-all">
        topic[0] {event.topic0}
      </div>
    </li>
  );
}

function AddrLink({ addr }: { addr: `0x${string}` }) {
  return (
    <a
      href={`https://sepolia.etherscan.io/address/${addr}`}
      target="_blank"
      rel="noreferrer"
      className="underline hover:text-midnight-navy"
      title={addr}
    >
      {addr.slice(0, 6)}…{addr.slice(-4)}
    </a>
  );
}

function BlockLink({
  txHash,
  blockNumber,
}: {
  txHash: `0x${string}`;
  blockNumber: bigint;
}) {
  return (
    <a
      href={`https://sepolia.etherscan.io/tx/${txHash}`}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-[10px] uppercase tracking-wider text-slate-ink hover:text-midnight-navy"
    >
      block {blockNumber.toString()} · tx {txHash.slice(0, 10)}… ↗
    </a>
  );
}
