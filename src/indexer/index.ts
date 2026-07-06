import { ponder } from 'ponder:registry'
import schema from 'ponder:schema'
import { and, eq, gt, isNull, or } from 'ponder'
import { zeroAddress, type Address } from 'viem'
import { isSameAddress } from '../lib/address'
import { INDEXER_ADDRESS, TOKEN_ADDRESS } from '../lib/zama'
import { sweep } from './sweep'

// MINT = mint from the zero address, BURN = burn to the zero address, else a plain TRANSFER.
function deriveKind(from: string, to: string): 'MINT' | 'BURN' | 'TRANSFER' {
  if (isSameAddress(from, zeroAddress)) return 'MINT'
  if (isSameAddress(to, zeroAddress)) return 'BURN'
  return 'TRANSFER'
}

// Ingest: append one immutable row per ConfidentialTransfer, then try to decrypt if we're
// entitled to. An event we can't read is recorded (amount=null), never dropped.
ponder.on('Token:ConfidentialTransfer', async ({ event, context }) => {
  await context.db
    .insert(schema.transfers)
    .values({
      blockNumber: event.block.number,
      txHash: event.transaction.hash,
      logIndex: event.log.logIndex,
      from: event.args.from,
      to: event.args.to,
      kind: deriveKind(event.args.from, event.args.to),
      amountHandle: event.args.amount,
      amount: null,
      attempts: 0,
      lastError: null,
      decryptedAt: null,
      createdAt: event.block.timestamp,
    })
    .onConflictDoNothing()
  // Instant-decode only this new row if we're already entitled.
  await sweep(context, event.block.number, event.block.timestamp, {
    blockNumber: event.block.number,
    logIndex: event.log.logIndex,
  })
})

// A user granted this indexer decryption rights on the watched token → record it, then backfill their rows.
ponder.on('ACL:DelegatedForUserDecryption', async ({ event, context }) => {
  if (
    !isSameAddress(event.args.delegate, INDEXER_ADDRESS) ||
    !isSameAddress(event.args.contractAddress, TOKEN_ADDRESS)
  ) {
    return
  }
  const delegator = event.args.delegator.toLowerCase() as Address
  await context.db
    .insert(schema.delegations)
    .values({
      delegatorAddress: delegator,
      active: true,
      expiration: event.args.newExpirationDate,
      counter: event.args.delegationCounter,
      updatedAt: event.block.timestamp,
    })
    // Ponder processes events in on-chain order, so the latest write is authoritative.
    .onConflictDoUpdate({
      active: true,
      expiration: event.args.newExpirationDate,
      counter: event.args.delegationCounter,
      updatedAt: event.block.timestamp,
    })
  // A fresh grant earns a fresh set of retries: rows that exhausted their attempts under a
  // previous (broken or expired) delegation must not stay locked out of the sweep forever.
  const retried = await context.db.sql
    .select({
      blockNumber: schema.transfers.blockNumber,
      logIndex: schema.transfers.logIndex,
    })
    .from(schema.transfers)
    .where(
      and(
        isNull(schema.transfers.amount),
        gt(schema.transfers.attempts, 0),
        or(
          eq(schema.transfers.from, delegator),
          eq(schema.transfers.to, delegator),
        ),
      ),
    )
  for (const key of retried) {
    await context.db
      .update(schema.transfers, key)
      .set({ attempts: 0, lastError: null })
  }
  await sweep(context, event.block.number, event.block.timestamp)
})

// Revocation → deactivate. Already-decrypted amounts are kept; only future decryption stops.
ponder.on(
  'ACL:RevokedDelegationForUserDecryption',
  async ({ event, context }) => {
    if (
      !isSameAddress(event.args.delegate, INDEXER_ADDRESS) ||
      !isSameAddress(event.args.contractAddress, TOKEN_ADDRESS)
    ) {
      return
    }
    await context.db
      .insert(schema.delegations)
      .values({
        delegatorAddress: event.args.delegator.toLowerCase() as Address,
        active: false,
        expiration: 0n,
        counter: event.args.delegationCounter,
        updatedAt: event.block.timestamp,
      })
      .onConflictDoUpdate({
        active: false,
        expiration: 0n,
        counter: event.args.delegationCounter,
        updatedAt: event.block.timestamp,
      })
  },
)

ponder.on('Reconcile:block', async ({ event, context }) => {
  await sweep(context, event.block.number, event.block.timestamp)
})
