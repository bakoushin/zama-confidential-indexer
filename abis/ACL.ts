// The two ACL delegation events we index so the indexer learns, event-driven, when a user grants or
// revokes its decryption rights. `delegate` is indexed, so on a busy chain this can be filtered to
// `delegate == indexer` at the log level; here we filter in-handler for simplicity.
export const AclAbi = [
  {
    type: "event",
    name: "DelegatedForUserDecryption",
    inputs: [
      { name: "delegator", type: "address", indexed: true },
      { name: "delegate", type: "address", indexed: true },
      { name: "contractAddress", type: "address" },
      { name: "delegationCounter", type: "uint64" },
      { name: "oldExpirationDate", type: "uint64" },
      { name: "newExpirationDate", type: "uint64" },
    ],
  },
  {
    type: "event",
    name: "RevokedDelegationForUserDecryption",
    inputs: [
      { name: "delegator", type: "address", indexed: true },
      { name: "delegate", type: "address", indexed: true },
      { name: "contractAddress", type: "address" },
      { name: "delegationCounter", type: "uint64" },
      { name: "oldExpirationDate", type: "uint64" },
    ],
  },
] as const;
