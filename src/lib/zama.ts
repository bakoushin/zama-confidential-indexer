import { ZamaSDK, memoryStorage } from '@zama-fhe/sdk'
import { createConfig } from '@zama-fhe/sdk/viem'
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { env } from './env'
import { fheChain, viemChain, relayer } from './chain'

export const TOKEN_ADDRESS = getAddress(env.TOKEN_ADDRESS)
export const ACL_ADDRESS = getAddress(fheChain.aclContractAddress)

const account = privateKeyToAccount(env.INDEXER_PRIVATE_KEY as Hex)
export const INDEXER_ADDRESS = account.address

export const publicClient = createPublicClient({
  chain: viemChain,
  transport: http(env.RPC_URL),
})
const walletClient = createWalletClient({
  account,
  chain: viemChain,
  transport: http(env.RPC_URL),
})

export const sdk = new ZamaSDK(
  createConfig({
    chains: [fheChain],
    publicClient,
    walletClient,
    storage: memoryStorage,
    relayers: { [fheChain.id]: relayer },
  }),
)
