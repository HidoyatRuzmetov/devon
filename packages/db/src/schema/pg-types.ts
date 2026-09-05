// Small Drizzle `customType` helpers for Postgres column types that `drizzle-orm/pg-core` does not
// ship a first-class builder for. Kept here (rather than duplicated per table file) so every table
// definition agrees on the same runtime representation.
import { customType } from 'drizzle-orm/pg-core'

/** Case-insensitive text (the `citext` extension, created in `migrations/0000_extensions.sql`). */
export const citext = customType<{ data: string }>({
  dataType() {
    return 'citext'
  },
})

/** Postgres `inet`. Represented as plain text on the JS side -- nothing here parses/validates it;
 * validation of the incoming IP belongs to the HTTP layer (a later epic), not the schema. */
export const inet = customType<{ data: string }>({
  dataType() {
    return 'inet'
  },
})

/** Postgres `bytea`. Node's `pg` driver returns/accepts `Buffer` for bytea columns. */
export const bytea = customType<{ data: Buffer }>({
  dataType() {
    return 'bytea'
  },
})
