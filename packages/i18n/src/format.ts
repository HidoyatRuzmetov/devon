// Date, time, number and currency formatting (DESIGN.md §5, spec.md §9.0.6): dates DD.MM.YYYY and
// times 24-hour in every locale -- not just the locales whose ICU default happens to agree (`en`
// and `uz-Latn`/`uz-Cyrl` default to MM/DD/YYYY and DD/MM/YYYY respectively) -- so day/month/year
// are read as parts and joined ourselves rather than trusting the locale's own separator/order.
// Numbers ("space thousands, comma decimal in uz/ru") are delegated straight to `Intl.NumberFormat`,
// which already produces exactly that for `uz-Latn`, `uz-Cyrl` and `ru`, and the standard
// comma-thousands/dot-decimal for `en` -- verified against the shipped Node ICU build.
import type { Locale } from './locale.js'

const DEFAULT_TZ = 'Asia/Tashkent'

function datePart(
  d: Date,
  tz: string,
  opt: Intl.DateTimeFormatOptions,
  part: Intl.DateTimeFormatPartTypes,
): string {
  const parts = new Intl.DateTimeFormat('en-US', { ...opt, timeZone: tz }).formatToParts(d)
  const found = parts.find((p) => p.type === part)
  if (!found) throw new Error(`[i18n] Intl.DateTimeFormat did not produce a "${part}" part`)
  return found.value
}

/** `05.09.2026`, always day.month.year, always the given (default Tashkent) timezone, regardless
 *  of locale -- the locale parameter is accepted for API symmetry with the other formatters and so
 *  a future calendar-system need (e.g. a Hijri toggle) has somewhere to plug in without a signature
 *  change. */
export function formatDate(d: Date, _locale: Locale, tz: string = DEFAULT_TZ): string {
  const day = datePart(d, tz, { day: '2-digit' }, 'day')
  const month = datePart(d, tz, { month: '2-digit' }, 'month')
  const year = datePart(d, tz, { year: 'numeric' }, 'year')
  return `${day}.${month}.${year}`
}

/** `18:30`, 24-hour, always -- `hour12: false` alone is not sufficient on every ICU build (some
 *  emit `24:00` instead of `00:00`), so midnight is normalised explicitly. `hour` and `minute` are
 *  read from one `formatToParts()` call, not two: requesting `minute: '2-digit'` on its own is not
 *  reliably zero-padded by ICU (verified empirically -- `00` minutes came back as `0`), because the
 *  padding follows the skeleton ICU selects for the *combination* of fields requested. */
export function formatTime(d: Date, _locale: Locale, tz: string = DEFAULT_TZ): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const hour = parts.find((p) => p.type === 'hour')?.value
  const minute = parts.find((p) => p.type === 'minute')?.value
  if (!hour || !minute)
    throw new Error('[i18n] Intl.DateTimeFormat did not produce hour/minute parts')
  const normalisedHour = hour === '24' ? '00' : hour
  return `${normalisedHour}:${minute}`
}

export function formatNumber(n: number, locale: Locale): string {
  return new Intl.NumberFormat(locale).format(n)
}

/** UZS suffix per locale (DESIGN §9.0.6, `maximumFractionDigits: 0` -- the som has no subunit in
 *  everyday use). `Intl.NumberFormat`'s built-in `currency: 'UZS'` style renders as "UZS 1 234",
 *  which reads as a foreign ISO code to a civil servant; the shell instead uses the everyday word. */
const UZS_SUFFIX: Record<Locale, string> = {
  'uz-Latn': 'soʻm',
  'uz-Cyrl': 'сўм',
  ru: 'сум',
  en: 'UZS',
}

export function formatUzs(n: number, locale: Locale): string {
  const rounded = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(n)
  return locale === 'en' ? `${UZS_SUFFIX[locale]} ${rounded}` : `${rounded} ${UZS_SUFFIX[locale]}`
}
