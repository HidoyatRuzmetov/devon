// `Tx.raw()` (`@devon/db`'s `context.ts`, a thin wrapper over drizzle's `db.execute()`) hands
// `timestamp` / `timestamptz` columns back as the *text* Postgres sent, never as `Date`s: drizzle's
// node-postgres driver installs its own per-query pg type parsers -- the identity function for
// `timestamptz`, `timestamp`, `date` and `interval` (`drizzle-orm/node-postgres/session.js`) -- so that
// its typed query builder can parse per column, and `execute()` has no column mapping to do it. A row
// typed `{ expires_at: Date }` at a `raw()` call site is therefore a lie the compiler cannot catch, and
// `expires_at.getTime()` throws a TypeError (a 500) the first time a real row comes back. Every raw row
// that needs an instant crosses this one boundary instead.
//
// Accepts a `Date` too, so a future driver that starts returning `Date`s cannot regress the other way,
// and refuses to hand back an `Invalid Date` -- `NaN` compares as neither before nor after "now", which
// would silently turn "expired" and "locked" checks into "never expires" / "never locked".
export function pgTimestampToDate(value: string | Date): Date
export function pgTimestampToDate(value: string | Date | null): Date | null
export function pgTimestampToDate(value: string | Date | null): Date | null {
  if (value === null) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`pgTimestampToDate: unparseable timestamp ${JSON.stringify(value)}`)
  }
  return date
}
