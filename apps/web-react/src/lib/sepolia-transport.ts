import { fallback, http } from "viem";

// Sepolia is flaky — thirdweb (the viem default) rate-limits + occasionally
// 5xx's, especially on Universal-Resolver CCIP-Read calls (resolveWithGateways
// over the canonical 0xeeee…eeee resolver). Use a fallback chain so a single
// RPC blip doesn't break ENS resolution in the hero, the activity chart, or
// the caller log.
//
// Order matters: publicnode + 1rpc are stable + free; thirdweb stays last as
// a backstop because it occasionally serves stale state.
export const sepoliaTransport = fallback(
  [
    http("https://ethereum-sepolia-rpc.publicnode.com"),
    http("https://1rpc.io/sepolia"),
    http("https://rpc.sepolia.ethpandaops.io"),
    http(), // viem default (thirdweb) — last-resort backstop
  ],
  { rank: false, retryCount: 1 },
);
