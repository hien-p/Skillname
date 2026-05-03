import { http, createConfig } from "wagmi";
import { sepolia, mainnet } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { sepoliaTransport } from "./sepolia-transport";

export const wagmiConfig = createConfig({
  chains: [sepolia, mainnet],
  connectors: [injected()],
  transports: {
    // Shared resilient transport — publicnode primary, falls back to 1rpc /
    // ethpandaops / thirdweb. Stops single-RPC blips from breaking ENS reads
    // and OnchainCard contract calls.
    [sepolia.id]: sepoliaTransport,
    [mainnet.id]: http(),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
