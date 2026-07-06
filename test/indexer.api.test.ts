import { zeroAddress, type Address, type Hex } from 'viem'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { setupDb } from './shims/db'
import { handlers } from './shims/ponder'
import * as zama from './shims/zama'

vi.mock('../src/lib/zama', () => import('./shims/zama'))

// Importing the real modules under test registers handlers / builds the app.
import '../src/indexer'
import app from '../src/api'

const HOLDER = '0x1111111111111111111111111111111111111111' as Address
const RECIPIENT = '0x2222222222222222222222222222222222222222' as Address
const STRANGER = '0x3333333333333333333333333333333333333333' as Address

const HANDLE_MINT = ('0x' + 'a1'.repeat(32)) as Hex
const HANDLE_TRANSFER = ('0x' + 'b2'.repeat(32)) as Hex
const HANDLE_STRANGER = ('0x' + 'c3'.repeat(32)) as Hex
const HANDLE_BALANCE = ('0x' + 'd4'.repeat(32)) as Hex

// Block timestamps track real time so both entitlement clocks agree: the sweep
// compares expirations against block time, the API against wall-clock time.
const T0 = BigInt(Math.floor(Date.now() / 1000))

const transferEvent = (
  block: bigint,
  from: Address,
  to: Address,
  amount: Hex,
) => ({
  block: { number: block, timestamp: T0 + block },
  transaction: { hash: ('0x' + block.toString().padStart(64, '0')) as Hex },
  log: { logIndex: 0 },
  args: { from, to, amount },
})

let context: any
let close: () => Promise<void>

beforeAll(async () => {
  ;({ context, close } = await setupDb())
})
afterAll(() => close())

async function fire(name: string, event: unknown) {
  const handler = handlers.get(name)
  if (!handler) throw new Error(`no handler registered for ${name}`)
  await handler({ event, context })
}

async function get(path: string): Promise<any> {
  const res = await app.request(path)
  expect(res.status).toBe(200)
  return res.json()
}

describe('confidential indexer pipeline (event in → cleartext out of the API)', () => {
  it('happy path: transfers index encrypted, delegation backfills, API serves cleartext', async () => {
    zama.cleartexts.set(HANDLE_MINT, 1000n)
    zama.cleartexts.set(HANDLE_TRANSFER, 400n)

    // Two on-chain events: mint 1000 to the holder, holder sends 400 on.
    await fire(
      'Token:ConfidentialTransfer',
      transferEvent(1n, zeroAddress, HOLDER, HANDLE_MINT),
    )
    await fire(
      'Token:ConfidentialTransfer',
      transferEvent(2n, HOLDER, RECIPIENT, HANDLE_TRANSFER),
    )

    // Before any grant: rows are recorded and honestly labeled, amounts withheld,
    // and the indexer has not asked the relayer for anything.
    let body = await get(`/v1/transfers/${HOLDER}`)
    expect(body.count).toBe(2)
    for (const t of body.transfers) {
      expect(t).toMatchObject({ amount: null, status: 'NOT_ENTITLED' })
    }
    expect(zama.sdk.decryption.decryptValues).not.toHaveBeenCalled()
    expect(zama.sdk.decryption.delegatedDecryptValues).not.toHaveBeenCalled()

    // The holder grants the indexer decryption rights (ACL delegation event) —
    // the real sweep must backfill both earlier rows through the delegated path.
    await fire('ACL:DelegatedForUserDecryption', {
      block: { number: 5n, timestamp: T0 + 5n },
      args: {
        delegator: HOLDER,
        delegate: zama.INDEXER_ADDRESS,
        contractAddress: zama.TOKEN_ADDRESS,
        delegationCounter: 1n,
        newExpirationDate: T0 + 7n * 86400n,
      },
    })

    // Both rows decrypted (newest first)…
    body = await get(`/v1/transfers/${HOLDER}`)
    expect(body.transfers).toMatchObject([
      { kind: 'TRANSFER', amount: '400', status: 'DECRYPTED' },
      { kind: 'MINT', amount: '1000', status: 'DECRYPTED' },
    ])
    // …as the delegating holder, not as the indexer itself.
    expect(zama.sdk.decryption.delegatedDecryptValues).toHaveBeenCalledWith(
      expect.anything(),
      HOLDER,
    )
    expect(zama.sdk.decryption.decryptValues).not.toHaveBeenCalled()

    // Cleartext balance comes out of the API for the delegating holder.
    zama.cleartexts.set(HANDLE_BALANCE, 600n)
    zama.publicClient.readContract.mockResolvedValue(HANDLE_BALANCE)
    expect(await get(`/v1/balance/${HOLDER}`)).toEqual({
      address: HOLDER,
      balance: '600',
      status: 'DECRYPTED',
    })
  })

  it('negative: a non-entitled transfer is recorded but never decrypted — nor even attempted', async () => {
    // The fake relayer WOULD answer for this handle; the indexer must never ask.
    zama.cleartexts.set(HANDLE_STRANGER, 150n)

    await fire(
      'Token:ConfidentialTransfer',
      transferEvent(6n, RECIPIENT, STRANGER, HANDLE_STRANGER),
    )
    // A reconcile sweep passes over all pending rows — entitlement SQL must skip it.
    await fire('Reconcile:block', { block: { number: 7n, timestamp: T0 + 7n } })

    // The row is recorded (never silently dropped), the amount withheld…
    const body = await get(`/v1/transfers/${STRANGER}`)
    expect(body.transfers).toMatchObject([
      { from: RECIPIENT, to: STRANGER, amount: null, status: 'NOT_ENTITLED' },
    ])

    // …and its handle was never even sent to the relayer.
    const requested = [
      ...zama.sdk.decryption.decryptValues.mock.calls,
      ...zama.sdk.decryption.delegatedDecryptValues.mock.calls,
    ].flatMap(([inputs]) => inputs.map((i) => i.encryptedValue))
    expect(requested).not.toContain(HANDLE_STRANGER)

    // The balance endpoint refuses just the same for the non-entitled stranger.
    expect(await get(`/v1/balance/${STRANGER}`)).toEqual({
      address: STRANGER,
      balance: null,
      status: 'NOT_ENTITLED',
    })
  })
})
