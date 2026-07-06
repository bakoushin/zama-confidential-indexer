import { index, onchainTable, primaryKey } from "ponder";

/**
 * One immutable row per ConfidentialTransfer log. `amount` is the whole lifecycle: null until we
 * decrypt it, then set permanently (a value, once known, is kept even if the grant is later revoked).
 */
export const transfers = onchainTable(
  "transfers",
  (t) => ({
    blockNumber: t.bigint().notNull(),
    txHash: t.hex().notNull(),
    logIndex: t.integer().notNull(),
    from: t.hex().notNull(),
    to: t.hex().notNull(),
    kind: t.text().notNull(), // TRANSFER | MINT | BURN
    amountHandle: t.hex().notNull(),
    amount: t.bigint(), // cleartext, null until decrypted
    attempts: t.integer().notNull().default(0), // observability only (transient decrypt failures)
    lastError: t.text(),
    decryptedAt: t.bigint(),
    createdAt: t.bigint().notNull(),
  }),
  (t) => ({
    pk: primaryKey({ columns: [t.blockNumber, t.logIndex] }),
    // Per-address history query: filter by from/to, then sort/cursor by (blockNumber, logIndex).
    fromIdx: index().on(t.from, t.blockNumber, t.logIndex),
    toIdx: index().on(t.to, t.blockNumber, t.logIndex),
  }),
);

/**
 * Delegations granted to this indexer, event-sourced from the ACL. Keyed by delegator (the delegate
 * is always us, the contract is always our token — both filtered in the handlers). `expiration` lets
 * the reconciler/API honor silent expiry (which emits no event) with a plain `expiration >= now`.
 */
export const delegations = onchainTable("delegations", (t) => ({
  delegatorAddress: t.hex().primaryKey(),
  active: t.boolean().notNull(),
  expiration: t.bigint().notNull(),
  counter: t.bigint().notNull(),
  updatedAt: t.bigint().notNull(),
}));

/** Singleton progress marker for /v1/health lag. */
export const meta = onchainTable("meta", (t) => ({
  id: t.text().primaryKey(),
  lastIndexedBlock: t.bigint().notNull(),
  updatedAt: t.bigint().notNull(),
}));
