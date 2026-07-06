import { createMiddleware } from 'hono/factory'
import { type Address, getAddress } from 'viem'

// Validates the `:address` route param and exposes it as a typed `address` context variable.
export const withAddress = createMiddleware<{
  Variables: { address: Address }
}>(async (c, next) => {
  let address: Address
  try {
    address = getAddress(c.req.param('address') ?? '').toLowerCase() as Address
  } catch {
    return c.json({ error: 'Invalid address' }, 400)
  }
  c.set('address', address)
  await next()
})
