import { cleartext, node } from '@zama-fhe/sdk/node'
import {
  anvil as anvilFhe,
  sepolia as sepoliaFhe,
  type FheChain,
} from '@zama-fhe/sdk/chains'
import { anvil, sepolia } from 'viem/chains'
import { env } from './env'

const isLocal = env.CHAIN_ID === anvil.id

export const fheChain: FheChain = isLocal ? anvilFhe : sepoliaFhe
export const viemChain = isLocal ? anvil : sepolia

// Anvil provides plaintexts directly; every other chain uses the hosted relayer.
export const relayer = isLocal ? cleartext() : node()
