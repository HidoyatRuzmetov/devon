// Locale model (design.md §1.3, TECH-SPEC §1). Four locales, uz-Latn first and default; the other
// three are peers, not fallbacks -- there is no silent English leakage path in this package (a
// missing key is a thrown error in dev and a visible bracketed key in production, never a fallback
// string, so the i18n gate is the only place "missing translation" can hide -- see t.ts).
import { z } from 'zod'

export const LOCALES = ['uz-Latn', 'uz-Cyrl', 'ru', 'en'] as const

export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'uz-Latn'

export const localeSchema = z.enum(LOCALES)

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

/** Native endonym, rendered in its own script -- this is what the locale switcher shows
 *  (DESIGN spec §4.3: "autonyms, always in their own language, never translated"). */
export const LOCALE_LABEL: Record<Locale, string> = {
  'uz-Latn': 'Oʻzbekcha (lotin)',
  'uz-Cyrl': 'Ўзбекча (кирилл)',
  ru: 'Русский',
  en: 'English',
}

/** Two-letter-ish chip shown in the top bar next to the globe (AC-8 discoverability). The `Oʻ` in
 *  `OʻZ` is a deliberate canary: if the shipped font falls back, it shows up in the chrome of every
 *  screenshot (spec.md §4.3, AC-6). */
export const LOCALE_CHIP: Record<Locale, string> = {
  'uz-Latn': 'OʻZ',
  'uz-Cyrl': 'ЎЗ',
  ru: 'RU',
  en: 'EN',
}

export type LocaleResolutionInput = {
  /** The signed-in user's stored preference (`app.users.locale`), if any. */
  user?: string | null
  /** Signed-out persistence: the `wp_locale` cookie / localStorage mirror (spec.md §4.3). */
  stored?: string | null
  /** The first tag of `Accept-Language`, already split by the caller. */
  header?: string | null
}

/** Resolution order (spec.md §4.3, §8 "Frontend shell decisions"): signed-in user record wins,
 *  then the signed-out persistence mirror, then the browser/request header, then the default. Each
 *  candidate is validated against `LOCALES` before it is trusted -- an unrecognised value (a stale
 *  cookie, a header the user never chose) never reaches the render path. */
export function resolveLocale(input: LocaleResolutionInput): Locale {
  const candidates = [input.user, input.stored, normalizeHeaderTag(input.header)]
  for (const candidate of candidates) {
    if (isLocale(candidate)) return candidate
  }
  return DEFAULT_LOCALE
}

function normalizeHeaderTag(header: string | null | undefined): string | null {
  if (!header) return null
  const primary = header.split(',')[0]?.trim().toLowerCase()
  if (!primary) return null
  if (primary.startsWith('uz-cyrl') || primary === 'uz-uz-cyrl') return 'uz-Cyrl'
  if (primary.startsWith('uz')) return 'uz-Latn'
  if (primary.startsWith('ru')) return 'ru'
  if (primary.startsWith('en')) return 'en'
  return null
}
