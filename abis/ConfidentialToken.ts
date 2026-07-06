// Minimal ERC-7984 surface the indexer needs: the ConfidentialTransfer event
// (amount is the encrypted euint64 handle, indexed -> topics[3]) and the balance read.
export const ConfidentialTokenAbi = [
  {
    type: "event",
    name: "ConfidentialTransfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "amount", type: "bytes32", indexed: true },
    ],
  },
  {
    type: "function",
    name: "confidentialBalanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "bytes32" }],
  },
  // ERC-20-style metadata for /v1/token so the wallet can render amounts.
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;
