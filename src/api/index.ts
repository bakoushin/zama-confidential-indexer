import { db } from 'ponder:api'
import schema from 'ponder:schema'
import { Hono } from 'hono'
import { and, desc, eq, lt, or } from 'ponder'
import { isEncryptedValueZero } from '@zama-fhe/sdk'
import { ConfidentialTokenAbi } from '../../abis/ConfidentialToken'
import { isSameAddress } from '../lib/address'
import { decrypt } from '../lib/decryptor'
import { env } from '../lib/env'
import { INDEXER_ADDRESS, publicClient, TOKEN_ADDRESS } from '../lib/zama'
import { withAddress } from './middleware'
import { activeDelegators, getTokenMetadata } from './queries'
import {
  decodeCursor,
  encodeCursor,
  serializeRow,
  type Cursor,
} from './serialize'

const DEFAULT_TXS_LIMIT = 50
const MIN_TXS_LIMIT = 1
const MAX_TXS_LIMIT = 200

const app = new Hono()

app.get('/v1/balance/:address', withAddress, async (c) => {
  const address = c.get('address')

  const handle = await publicClient.readContract({
    address: TOKEN_ADDRESS,
    abi: ConfidentialTokenAbi,
    functionName: 'confidentialBalanceOf',
    args: [address],
  })

  // A zero handle means "never received": the balance is a public 0, no entitlement needed.
  if (isEncryptedValueZero(handle)) {
    return c.json({ address, balance: '0', status: 'DECRYPTED' })
  }

  const active = await activeDelegators()
  if (!isSameAddress(address, INDEXER_ADDRESS) && !active.has(address)) {
    return c.json({ address, balance: null, status: 'NOT_ENTITLED' })
  }

  const outcome = await decrypt(handle, TOKEN_ADDRESS, address)
  if (outcome.status === 'RETRY') {
    // We're entitled, so a failed on-demand decrypt is an unexpected failure.
    // Surfacing it as a retryable 503.
    console.warn('Balance decrypt failed', { address, error: outcome.error })
    return c.json({ address, error: 'Balance temporarily unavailable' }, 503)
  }

  return c.json({
    address,
    balance: outcome.value.toString(),
    status: 'DECRYPTED',
  })
})

app.get('/v1/transfers/:address', withAddress, async (c) => {
  const address = c.get('address')

  const limitParam = Number(c.req.query('limit')) || DEFAULT_TXS_LIMIT
  const limit = Math.min(Math.max(limitParam, MIN_TXS_LIMIT), MAX_TXS_LIMIT)

  let cursor: Cursor | undefined
  const cursorParam = c.req.query('cursor')
  if (cursorParam) {
    try {
      cursor = decodeCursor(cursorParam)
    } catch (e) {
      console.error(e)
      return c.json({ error: 'Invalid cursor' }, 400)
    }
  }

  const addressFilter = or(
    eq(schema.transfers.from, address),
    eq(schema.transfers.to, address),
  )
  const cursorFilter = cursor
    ? // strictly "older" than the cursor in DESC (blockNumber, logIndex) order
      or(
        lt(schema.transfers.blockNumber, cursor.block),
        and(
          eq(schema.transfers.blockNumber, cursor.block),
          lt(schema.transfers.logIndex, cursor.logIndex),
        ),
      )
    : undefined

  const rows = await db
    .select()
    .from(schema.transfers)
    .where(and(addressFilter, cursorFilter))
    .orderBy(
      desc(schema.transfers.blockNumber),
      desc(schema.transfers.logIndex),
    )
    .limit(limit + 1) // one extra row tells us whether a next page exists

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const active = await activeDelegators()
  return c.json({
    address,
    limit,
    count: page.length,
    nextCursor: hasMore ? encodeCursor(page[page.length - 1]) : null,
    transfers: page.map((row) => serializeRow(row, active)),
  })
})

app.get('/v1/token', async (c) => {
  const metadata = await getTokenMetadata()
  return c.json(metadata)
})

app.get('/v1/health', async (c) => {
  let head: bigint
  try {
    head = await publicClient.getBlockNumber()
  } catch {
    return c.json({ status: 'unhealthy', error: 'chain unreachable' }, 503)
  }
  const m = await db.select().from(schema.meta).limit(1)
  const lastIndexed = m[0]?.lastIndexedBlock ?? 0n
  const lag = head > lastIndexed ? head - lastIndexed : 0n
  const healthy = lag <= env.HEALTH_LAG_THRESHOLD
  return c.json(
    {
      status: healthy ? 'healthy' : 'behind',
      chainId: env.CHAIN_ID,
      headBlock: head.toString(),
      lastIndexedBlock: lastIndexed.toString(),
      lag: lag.toString(),
    },
    healthy ? 200 : 503,
  )
})

export default app
