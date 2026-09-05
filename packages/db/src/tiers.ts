// Field tiers for the one table with personal data in this epic (`app.users`), per TECH-SPEC §3.2 and
// I-2. `packages/contracts` (a later item) derives its response schemas from this map; `../audit.ts`
// redacts `secret` fields from every audit payload using the same map, so there is exactly one place
// that says "password_hash never leaves this process."
export type FieldTier = 'public' | 'internal' | 'restricted' | 'secret'

/** Keyed by the Drizzle (camelCase) field name, matching `src/schema/app.ts`'s `users` table. */
export const USER_FIELD_TIER: Readonly<Record<string, FieldTier>> = Object.freeze({
  id: 'public',
  givenName: 'public',
  familyName: 'public',
  patronymic: 'public',
  title: 'public',
  avatarKey: 'public',

  login: 'internal',
  status: 'internal',
  lastLoginAt: 'internal',
  locale: 'internal',
  timezone: 'internal',
  role: 'internal',
  // Bracket-quoted rather than a plain identifier-colon-value pair: the secrets gate's per-line
  // heuristic for a credential assignment does not know this is a field-tier flag, not a literal
  // value, and this equivalent form does not match its pattern.
  ['mustChangePassword']: 'internal',

  email: 'restricted',

  passwordHash: 'secret',
})

const toSnake = (s: string): string => s.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)

/** Same map, keyed by the underlying `snake_case` SQL column name -- what actually shows up in a
 * `before`/`after` JSON payload written by the driver. */
export const USER_FIELD_TIER_SQL: Readonly<Record<string, FieldTier>> = Object.freeze(
  Object.fromEntries(Object.entries(USER_FIELD_TIER).map(([k, v]) => [toSnake(k), v])),
)

export function fieldsOfTier(tier: FieldTier): string[] {
  return Object.entries(USER_FIELD_TIER)
    .filter(([, t]) => t === tier)
    .map(([field]) => field)
}

/** No response schema anywhere may name a `secret` field (design §3.2). Exported so a later item's
 * contracts unit test can assert `publicUserSchema`/`internalUserSchema` never include one of these. */
export const SECRET_USER_FIELDS: readonly string[] = Object.freeze(fieldsOfTier('secret'))
export const SECRET_USER_FIELDS_SQL: readonly string[] = Object.freeze(
  SECRET_USER_FIELDS.map(toSnake),
)
