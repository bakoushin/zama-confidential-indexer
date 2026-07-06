import schema from 'ponder:schema'
import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql } from 'ponder'
import { zeroAddress, type Address } from 'viem'
import { isSameAddress } from '../lib/address'
import { decryptBatch } from '../lib/decryptor'
import { env } from '../lib/env'
import { INDEXER_ADDRESS, TOKEN_ADDRESS } from '../lib/zama'

type SweepRow = Pick<
  typeof schema.transfers.$inferSelect,
  'blockNumber' | 'logIndex' | 'from' | 'to' | 'attempts' | 'amountHandle'
> & { fromDelegated: boolean; toDelegated: boolean }

export async function sweep(
  context: any,
  block: bigint,
  now: bigint,
  only?: { blockNumber: bigint; logIndex: number },
): Promise<void> {
  const delegators = context.db.sql
    .select({ address: schema.delegations.delegatorAddress })
    .from(schema.delegations)
    .where(
      and(
        eq(schema.delegations.active, true),
        gte(schema.delegations.expiration, now),
      ),
    )
  const fromDelegated = inArray(schema.transfers.from, delegators)
  const toDelegated = inArray(schema.transfers.to, delegators)

  // Pending rows we're entitled to, fewest attempts first so a backlog of retries can't starve
  // fresh rows, then reverse chain order so each batch drains a tier newest-first: recent
  // transfers decrypt promptly while the backlog is worked backwards behind them.
  // `attempts < MAX` is the safety valve: a row that keeps failing to decrypt drops out after
  // MAX tries so it can't hog the batch forever.
  const rows: SweepRow[] = await context.db.sql
    .select({
      blockNumber: schema.transfers.blockNumber,
      logIndex: schema.transfers.logIndex,
      from: schema.transfers.from,
      to: schema.transfers.to,
      attempts: schema.transfers.attempts,
      amountHandle: schema.transfers.amountHandle,
      // The IN-subquery expressions MUST carry explicit SQL aliases: unaliased they both come
      // back named `?column?`, the row object collapses them into a single key, and ponder's
      // context.db.sql positional decode (Object.values) then shifts/drops the booleans.
      fromDelegated: sql<boolean>`${fromDelegated}`.as('from_delegated'),
      toDelegated: sql<boolean>`${toDelegated}`.as('to_delegated'),
    })
    .from(schema.transfers)
    .where(
      and(
        isNull(schema.transfers.amount),
        lt(schema.transfers.attempts, env.RECONCILE_MAX_ATTEMPTS),
        or(
          eq(schema.transfers.from, INDEXER_ADDRESS),
          eq(schema.transfers.to, INDEXER_ADDRESS),
          fromDelegated,
          toDelegated,
        ),
        ...(only
          ? [
              eq(schema.transfers.blockNumber, only.blockNumber),
              eq(schema.transfers.logIndex, only.logIndex),
            ]
          : []),
      ),
    )
    .orderBy(
      asc(schema.transfers.attempts),
      desc(schema.transfers.blockNumber),
      desc(schema.transfers.logIndex),
    )
    .limit(only ? 1 : env.RECONCILE_BATCH)

  // A row can match the WHERE clause yet have no usable identity this round (e.g. the only
  // delegating party is the zero address, which can never delegate). Such rows are skipped
  // without burning an attempt, so they retry once a real entitlement shows up.
  const entitledAddress = (row: SweepRow): Address | null => {
    if ([row.from, row.to].some((p) => isSameAddress(p, INDEXER_ADDRESS))) {
      return INDEXER_ADDRESS
    }
    const delegating: Address[] = []
    if (row.fromDelegated && !isSameAddress(row.from, zeroAddress)) {
      delegating.push(row.from)
    }
    if (row.toDelegated && !isSameAddress(row.to, zeroAddress)) {
      delegating.push(row.to)
    }
    if (delegating.length === 0) return null
    // `attempts % length` rotates the identity on each retry: when both parties delegate, a
    // failed attempt switches to the other party next sweep, so one broken delegation can't
    // wedge the row.
    return delegating[row.attempts % delegating.length]!
  }

  const eligible = rows.flatMap((row) => {
    const address = entitledAddress(row)
    return address ? [{ row, address }] : []
  })

  const outcomes = new Map(
    (
      await Promise.all(
        Map.groupBy(eligible, (e) => e.address)
          .entries()
          .map(([address, group]) =>
            decryptBatch(
              group.map((e) => e.row.amountHandle),
              TOKEN_ADDRESS,
              address,
            ),
          ),
      )
    ).flatMap((m) => [...m]),
  )

  for (const { row } of eligible) {
    const outcome = outcomes.get(row.amountHandle)!
    await context.db
      .update(schema.transfers, {
        blockNumber: row.blockNumber,
        logIndex: row.logIndex,
      })
      .set(
        outcome.status === 'DECRYPTED'
          ? {
              amount: outcome.value,
              decryptedAt: now,
              attempts: row.attempts + 1,
              lastError: null,
            }
          : { attempts: row.attempts + 1, lastError: outcome.error ?? null },
      )
  }

  // Only the full sweep advances the health heartbeat; the per-row transfer path skips it.
  if (!only) {
    await context.db
      .insert(schema.meta)
      .values({ id: 'heartbeat', lastIndexedBlock: block, updatedAt: now })
      .onConflictDoUpdate({ lastIndexedBlock: block, updatedAt: now })
  }
}
