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

/** Postgres `bytea`, JS-side as the hex string every hash actually is everywhere else in this
 * codebase (`sha256Hex()`, `hashesEqual()` -- `apps/api/src/lib/tokens.ts`). Transparently encodes
 * hex -> `Buffer` on write and decodes back on read, so a token/hash column can be declared `bytea`
 * (the real column type `migrations/0003_identity.sql` gives `sessions.token_hash`/`csrf_hash` and
 * `setup_tokens.token_hash`) without every call site doing its own `Buffer.from(x, 'hex')`/
 * `.toString('hex')`. Plain `text()` on one of these columns is a latent bug, not a style choice: a
 * hex string written into a `bytea` column round-trips as the ASCII bytes *of* the hex string, not
 * the digest itself, so every later read produces a value that no comparison against a freshly
 * computed `sha256Hex()` result can ever match (found end-to-end: `PATCH /api/v1/me` 403s on every
 * request post-login, because `checkCsrf` -- `apps/api/src/lib/csrf.ts` -- hashes the request's CSRF
 * header and compares it against exactly this kind of double-encoded value, 2026-09). */
export const hexBytea = customType<{ data: string; driverData: Buffer }>({
  dataType() {
    return 'bytea'
  },
  toDriver(value: string): Buffer {
    return Buffer.from(value, 'hex')
  },
  fromDriver(value: Buffer): string {
    return value.toString('hex')
  },
})
