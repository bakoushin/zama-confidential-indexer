// In-memory database harness: pglite + the app tables (created with ponder's
// own DDL), exposed both as the API's `db` binding and as a minimal stand-in
// for ponder's store API (context.db), so the real handler + sweep code runs
// unmodified.
import { PGlite } from '@electric-sql/pglite'
import { and, eq } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/pglite'
import * as schema from '../../ponder.schema'
import { __setDb } from './ponder'

const primaryKey = (table: any) => {
  const cfg = getTableConfig(table)
  return cfg.primaryKeys[0]?.columns ?? cfg.columns.filter((c) => c.primary)
}

// `sql` is the escape hatch sweep already uses for raw drizzle queries.
function storeDb(sql: any) {
  return {
    sql,
    insert: (table: any) => ({
      values: (vals: any) => {
        const q = sql.insert(table).values(vals)
        return {
          onConflictDoNothing: () => q.onConflictDoNothing(),
          onConflictDoUpdate: (set: any) =>
            q.onConflictDoUpdate({ target: primaryKey(table), set }),
        }
      },
    }),
    update: (table: any, key: Record<string, unknown>) => ({
      set: (vals: any) =>
        sql
          .update(table)
          .set(vals)
          .where(
            and(...Object.entries(key).map(([col, v]) => eq(table[col], v))),
          ),
    }),
  }
}

export async function setupDb() {
  const client = new PGlite() // in-memory
  const db = drizzle(client, { casing: 'snake_case' })

  // Create the app tables with the exact DDL ponder itself would use.
  const kitPath = new URL(
    '../../node_modules/ponder/dist/esm/drizzle/kit/index.js',
    import.meta.url,
  ).href
  const kit = await import(kitPath)
  const stmts = kit.getSql(schema)
  for (const stmt of [...stmts.tables.sql, ...(stmts.indexes?.sql ?? [])]) {
    if (stmt.includes('_reorg__')) continue // reorg shadow tables: runtime-only
    await client.exec(stmt)
  }

  __setDb(db) // the API modules read this live binding per request
  return { context: { db: storeDb(db) }, close: () => client.close() }
}
