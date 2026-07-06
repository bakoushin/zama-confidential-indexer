import type { Address, Hex } from 'viem'
import { isSameAddress } from './address'
import { INDEXER_ADDRESS, sdk } from './zama'

export type DecryptOutcome =
  | { status: 'DECRYPTED'; value: bigint }
  | { status: 'RETRY'; error?: string }

export async function decryptBatch(
  handles: Hex[],
  token: Address,
  entitledAddress: Address,
): Promise<Map<Hex, DecryptOutcome>> {
  const inputs = handles.map((handle) => ({
    encryptedValue: handle,
    contractAddress: token,
  }))
  const outcomes = new Map<Hex, DecryptOutcome>()
  // Resolved outside the try: a bad entitled address is a caller bug and should throw, not be
  // recorded as a transient decrypt failure that burns a retry attempt.
  const useIndexerIdentity = isSameAddress(entitledAddress, INDEXER_ADDRESS)
  try {
    const res = useIndexerIdentity
      ? await sdk.decryption.decryptValues(inputs)
      : await sdk.decryption.delegatedDecryptValues(inputs, entitledAddress)
    for (const handle of handles) {
      const value = res[handle]
      outcomes.set(
        handle,
        value != null
          ? { status: 'DECRYPTED', value: value as bigint }
          : { status: 'RETRY' },
      )
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    for (const handle of handles) {
      outcomes.set(handle, { status: 'RETRY', error })
    }
  }
  return outcomes
}

export async function decrypt(
  handle: Hex,
  token: Address,
  entitledAddress: Address,
): Promise<DecryptOutcome> {
  const outcomes = await decryptBatch([handle], token, entitledAddress)
  return outcomes.get(handle)!
}
