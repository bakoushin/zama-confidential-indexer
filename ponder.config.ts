import { createConfig } from 'ponder'
import { AclAbi } from './abis/ACL'
import { ConfidentialTokenAbi } from './abis/ConfidentialToken'
import { env } from './src/lib/env'
import { fheChain } from './src/lib/chain'
import { Hex } from 'viem'

const CHAIN = 'default'

export default createConfig({
  chains: {
    [CHAIN]: { id: fheChain.id, rpc: env.RPC_URL },
  },
  contracts: {
    // The token we're indexing.
    Token: {
      chain: CHAIN,
      abi: ConfidentialTokenAbi,
      address: env.TOKEN_ADDRESS as Hex,
      startBlock: env.START_BLOCK,
    },
    // The shared ACL — we index its delegation events so grants/revokes become known event-driven.
    ACL: {
      chain: CHAIN,
      abi: AclAbi,
      address: fheChain.aclContractAddress,
      startBlock: env.START_BLOCK,
    },
  },
  // Safety-net reconcile + health heartbeat (run the node with `anvil --block-time 1`).
  blocks: {
    Reconcile: {
      chain: CHAIN,
      startBlock: env.START_BLOCK,
      interval: env.RECONCILE_BLOCK_INTERVAL,
    },
  },
})
