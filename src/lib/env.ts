import { z } from 'zod'
import { anvil, sepolia } from 'viem/chains'

const schema = z.object({
  RPC_URL: z.url().default('http://127.0.0.1:8545'),
  CHAIN_ID: z.coerce
    .number()
    .int()
    .refine((id) => id === anvil.id || id === sepolia.id, {
      message: `CHAIN_ID must be ${anvil.id} (anvil) or ${sepolia.id} (sepolia)`,
    })
    .default(anvil.id),
  TOKEN_ADDRESS: z
    .string()
    .regex(
      /^0x[0-9a-fA-F]{40}$/,
      'TOKEN_ADDRESS must be a 20-byte hex address',
    ),
  INDEXER_PRIVATE_KEY: z
    .string()
    .regex(
      /^0x[0-9a-fA-F]{64}$/,
      'INDEXER_PRIVATE_KEY must be a 32-byte hex key',
    ),
  START_BLOCK: z.coerce.number().int().nonnegative().default(0),
  RECONCILE_BLOCK_INTERVAL: z.coerce.number().int().positive().default(1),
  RECONCILE_BATCH: z.coerce.number().int().positive().default(25),
  RECONCILE_MAX_ATTEMPTS: z.coerce.number().int().positive().default(25),
  HEALTH_LAG_THRESHOLD: z.coerce.bigint().default(25n),
})

export const env = schema.parse(process.env)
