import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const local = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  resolve: {
    // Ponder's virtual modules don't exist outside its runtime; point them at
    // the test shim so the actual indexer/API modules load unmodified under
    // vitest.
    alias: {
      'ponder:registry': local('test/shims/ponder.ts'),
      'ponder:api': local('test/shims/ponder.ts'),
      'ponder:schema': local('test/shims/ponder.ts'),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    // Toy values: src/lib/env.ts validates shape at import; everything that
    // would USE them (SDK, RPC) is mocked in the tests.
    env: {
      TOKEN_ADDRESS: '0x5fbdb2315678afecb367f032d93f642f64180aa3',
      INDEXER_PRIVATE_KEY:
        '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
    },
  },
})
