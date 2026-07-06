// Test stand-in for src/lib/zama (wired via vi.mock in the test file). A fake
// relayer: `cleartexts` maps handle -> value the relayer would hand out.
// Deliberately permissive — the entitlement gate under test is the indexer's
// own SQL, and the negative test asserts certain handles are never even requested.
import type { Address } from 'viem'
import { vi } from 'vitest'

export const TOKEN_ADDRESS =
  '0x5fbdb2315678afecb367f032d93f642f64180aa3' as Address
export const INDEXER_ADDRESS =
  '0x90f79bf6eb2c4f870365e785982e1f101e93b906' as Address // anvil #3

export const cleartexts = new Map<string, bigint>()

const resolve = (inputs: { encryptedValue: string }[]) =>
  Object.fromEntries(
    inputs.flatMap((i) => {
      const v = cleartexts.get(i.encryptedValue)
      return v === undefined ? [] : [[i.encryptedValue, v]]
    }),
  )

export const publicClient = {
  readContract: vi.fn(),
}

export const sdk = {
  decryption: {
    decryptValues: vi.fn(async (inputs: { encryptedValue: string }[]) =>
      resolve(inputs),
    ),
    delegatedDecryptValues: vi.fn(
      async (inputs: { encryptedValue: string }[], _delegator: string) =>
        resolve(inputs),
    ),
  },
}
