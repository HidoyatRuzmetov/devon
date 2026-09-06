// "Pointer not payload" (TECH-SPEC §7, CLAUDE.md "Do not send personal contact details to Telegram"):
// a Telegram message may carry a title, a date and a deep link -- never a phone number, an email, a
// login, or any other contact/identity field. This file is the one allow-list every outbound Telegram
// message is built through; `telegram.pointer.test.ts` proves that feeding it a record stuffed with
// every forbidden field this codebase knows about (mirroring `packages/db/src/tiers.ts`'s
// `restricted`/`secret` tiers, plus phone -- a field this app does not even store, kept in the deny
// list anyway as a future-proofing belt) never lets one leak into the built message.
//
// The allow-list is structural, not a denylist scan: `buildTelegramPointer` reads exactly four named
// keys off its input and returns a brand-new object built only from those -- any other key on the
// input (however sensitive) is never read, never copied, never present in the JS reference graph of
// the output. `assertNoForbiddenSubstring` (used only by the test) is a second, independent check on
// top of that structural guarantee, not a substitute for it.
export type TelegramPointer = {
  title: string
  body: string | null
  deepLink: string | null
  eventAt: string | null
}

/** Deliberately reads `unknown` and picks fields by name -- a caller can hand this the *entire*
 * `NotificationRow` (or any other record) without auditing which fields exist on it first; only the
 * four named keys below are ever read. */
export function buildTelegramPointer(input: {
  title?: unknown
  body?: unknown
  deepLink?: unknown
  eventAt?: unknown
}): TelegramPointer {
  return {
    title: typeof input.title === 'string' ? input.title : '',
    body: typeof input.body === 'string' ? input.body : null,
    deepLink: typeof input.deepLink === 'string' ? input.deepLink : null,
    eventAt: typeof input.eventAt === 'string' ? input.eventAt : null,
  }
}

/** Public-URL deep link, e.g. `https://portal.example/cards/<id>` -- never carries a query string or
 * token (a deep link is a pointer to a screen the recipient must already be signed in to see, not a
 * bearer credential). */
export function absoluteDeepLink(publicUrl: string, path: string | null): string | null {
  if (!path) return null
  return `${publicUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}

const FORBIDDEN_FIELD_NAMES = [
  'email',
  'login',
  'phone',
  'phoneNumber',
  'passwordHash',
  'password_hash',
  'patronymic',
  'address',
  'avatarKey',
] as const

/** Test-only helper (exported so `telegram.pointer.test.ts` can build its own adversarial fixtures
 * without duplicating this list): the field names a real user record could carry that must never
 * appear, by name or by value, anywhere in a built Telegram message. */
export const FORBIDDEN_CONTACT_FIELDS: readonly string[] = FORBIDDEN_FIELD_NAMES
