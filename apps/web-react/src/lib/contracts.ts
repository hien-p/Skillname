/** Live deployments on Sepolia. Mirror of constants in apps/web/index.html. */
export const SKILLLINK_ADDR = "0x428865D8Dec9Bcc882c9e034DB4c81CBd93293A5" as const;
export const IDENTITY_REGISTRY_ADDR = "0x48f77FfE1f02FB94bDe9c8ffe84bB4956ace11e4" as const;
export const SKILL_NFT_ADDR = "0xa16e83529d9bed52e74673a08f4c8255b1102827" as const;

export const SKILLLINK_ABI = [
  {
    type: "function",
    name: "skillCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "call",
    stateMutability: "payable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "", type: "bytes" }],
  },
] as const;

export const COUNT_ABI = [
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "lastId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
