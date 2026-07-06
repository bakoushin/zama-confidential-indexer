import schema from 'ponder:schema'
import type { Address } from 'viem'
import { isSameAddress } from '../lib/address'
import { env } from '../lib/env'
import { INDEXER_ADDRESS } from '../lib/zama'

export type Cursor = { block: bigint; logIndex: number }

// Opaque pagination cursor over the DESC (blockNumber, logIndex) ordering.
// encode/decode are a pair: ensure the `${blockNumber}:${logIndex}` format contract.
export function encodeCursor({
  blockNumber,
  logIndex,
}: {
  blockNumber: bigint
  logIndex: number
}) {
  return Buffer.from(`${blockNumber}:${logIndex}`).toString('base64url')
}

export function decodeCursor(param: string): Cursor {
  const [b, l] = Buffer.from(param, 'base64url').toString().split(':')
  if (!/^\d+$/.test(b ?? '') || !/^\d+$/.test(l ?? '')) {
    throw new Error('Invalid cursor')
  }
  return { block: BigInt(b), logIndex: Number(l) }
}

export function serializeRow(
  r: typeof schema.transfers.$inferSelect,
  active: Set<string>,
) {
  return {
    id: `${r.txHash}-${r.logIndex}`, // synthesized public id (PK is the composite (blockNumber, logIndex))
    blockNumber: r.blockNumber.toString(),
    timestamp: Number(r.createdAt), // unix seconds (block time)
    txHash: r.txHash,
    logIndex: r.logIndex,
    from: r.from,
    to: r.to,
    kind: r.kind,
    amount: r.amount != null ? r.amount.toString() : null,
    status: deriveStatus(r.amount, r.attempts, r.from, r.to, INDEXER_ADDRESS, active),
  }
}

/**
 * Cleartext-availability status, derived from the amount + current delegation state:
 *   DECRYPTED    we have the amount
 *   PENDING      we're entitled now (indexer itself, or an active unexpired delegation), not yet decrypted
 *   FAILED       we're entitled but exhausted every decrypt attempt; won't retry until a new grant
 *   NOT_ENTITLED no current rights
 */
function deriveStatus(
  amount: bigint | null,
  attempts: number,
  from: Address,
  to: Address,
  indexerAddress: Address,
  activeDelegators: Set<string>,
): 'DECRYPTED' | 'PENDING' | 'NOT_ENTITLED' | 'FAILED' {
  if (amount !== null) return 'DECRYPTED'
  const entitled =
    isSameAddress(from, indexerAddress) ||
    isSameAddress(to, indexerAddress) ||
    activeDelegators.has(from.toLowerCase()) ||
    activeDelegators.has(to.toLowerCase())
  if (!entitled) return 'NOT_ENTITLED'
  return attempts >= env.RECONCILE_MAX_ATTEMPTS ? 'FAILED' : 'PENDING'
}
