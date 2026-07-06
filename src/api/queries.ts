import { db } from 'ponder:api'
import schema from 'ponder:schema'
import { and, eq, gte } from 'ponder'
import { ConfidentialTokenAbi } from '../../abis/ConfidentialToken'
import { publicClient, TOKEN_ADDRESS } from '../lib/zama'

let tokenMetadata:
  | { address: string; name: string; symbol: string; decimals: number }
  | undefined

export async function getTokenMetadata() {
  if (!tokenMetadata) {
    const base = { address: TOKEN_ADDRESS, abi: ConfidentialTokenAbi } as const
    const [name, symbol, decimals] = await Promise.all([
      publicClient.readContract({ ...base, functionName: 'name' }),
      publicClient.readContract({ ...base, functionName: 'symbol' }),
      publicClient.readContract({ ...base, functionName: 'decimals' }),
    ])
    tokenMetadata = { address: TOKEN_ADDRESS, name, symbol, decimals }
  }
  return tokenMetadata
}

export async function activeDelegators(): Promise<Set<string>> {
  const rows = await db
    .select({ delegatorAddress: schema.delegations.delegatorAddress })
    .from(schema.delegations)
    .where(
      and(
        eq(schema.delegations.active, true),
        gte(
          schema.delegations.expiration,
          BigInt(Math.floor(Date.now() / 1000)),
        ),
      ),
    )
  return new Set(rows.map((row) => row.delegatorAddress))
}
