// Test stand-in for ponder's virtual modules — vitest aliases `ponder:registry`,
// `ponder:api`, and `ponder:schema` all at this file (each import picks the
// exports it needs), so the actual indexer/API modules load unmodified.
import * as schema from '../../ponder.schema'

// ponder:schema — same shape ponder provides: every named export plus the
// namespace as default.
export * from '../../ponder.schema'
export default schema

// ponder:registry — collects the handlers src/indexer registers so tests can
// fire synthetic events.
type Handler = (args: { event: any; context: any }) => Promise<void>

export const handlers = new Map<string, Handler>()

export const ponder = {
  on(name: string, fn: Handler): void {
    handlers.set(name, fn)
  },
}

// ponder:api — `db` is an ESM live binding: the test assigns it (in-memory
// pglite + drizzle) before making requests; API modules read it at request time.
export let db: any

export function __setDb(client: any): void {
  db = client
}
