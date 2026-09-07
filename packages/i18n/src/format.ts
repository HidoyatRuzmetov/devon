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

/** Full month names, January-first, capitalised for standalone display ("Sentabr 2026", a section
 * header or a calendar title). Not delegated to `Intl.DateTimeFormat(locale, { month: 'long' })`:
 * verified against a real embedded-Chromium build that ships reduced CLDR data for `uz-Latn` --
 * `Intl` silently falls back to the bare numeric-month skeleton pattern there ("2026 M09" instead of
 * "sentabr 2026") with no error to catch, exactly the defect this replaces. Small enough (48 words)
 * that hand-rolling it outweighs a bundled date-fns locale pack (design.md §1.1's bundle-budget
 * argument against that) while guaranteeing every shipped browser renders the same word regardless
 * of its own ICU completeness. */
const MONTH_NAMES: Record<Locale, readonly string[]> = {
  'uz-Latn': [
    'Yanvar',
    'Fevral',
    'Mart',
    'Aprel',
    'May',
    'Iyun',
    'Iyul',
    'Avgust',
    'Sentabr',
    'Oktabr',
    'Noyabr',
    'Dekabr',
  ],
  'uz-Cyrl': [
    'Январ',
    'Феврал',
    'Март',
    'Апрел',
    'Май',
    'Июн',
    'Июл',
    'Август',
    'Сентябр',
    'Октябр',
    'Ноябр',
    'Декабр',
  ],
  ru: [
    'Январь',
    'Февраль',
    'Март',
    'Апрель',
    'Май',
    'Июнь',
    'Июль',
    'Август',
    'Сентябрь',
    'Октябрь',
    'Ноябрь',
    'Декабрь',
  ],
  en: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
}

/** "Sentabr 2026" / "Сентябр 2026" / "Сентябрь 2026" / "September 2026" -- the events list's month
 * grouping and the work calendar's own title, both previously built from raw `Intl` output (see the
 * `MONTH_NAMES` doc comment above for why that broke). `tz` matters only at midnight-boundary UTC
 * offsets; defaults to the same Tashkent zone every other formatter here uses. */
export function formatMonthYear(d: Date, locale: Locale, tz: string = DEFAULT_TZ): string {
  const monthIndex = Number(datePart(d, tz, { month: 'numeric' }, 'month')) - 1
  const year = datePart(d, tz, { year: 'numeric' }, 'year')
  return `${MONTH_NAMES[locale][monthIndex] ?? ''} ${year}`
}

/** Hand-picked (not sliced from `MONTH_NAMES`) so Uzbek's July/June don't both collapse to "Iyu" --
 * the same reduced-ICU risk `formatMonthYear` guards against, for the invitation-style date badge
 * (`EventCard`'s "SEN / 20" block) that needs a 3-letter abbreviation instead of the full word. */
const MONTH_NAMES_SHORT: Record<Locale, readonly string[]> = {
  'uz-Latn': ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyl', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek'],
  'uz-Cyrl': ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'],
  ru: ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
}

export function formatMonthShort(d: Date, locale: Locale, tz: string = DEFAULT_TZ): string {
  const monthIndex = Number(datePart(d, tz, { month: 'numeric' }, 'month')) - 1
  return MONTH_NAMES_SHORT[locale][monthIndex] ?? ''
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

const RELATIVE_DIVISIONS: ReadonlyArray<{ amount: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { amount: 60, unit: 'second' },
  { amount: 60, unit: 'minute' },
  { amount: 24, unit: 'hour' },
  { amount: 7, unit: 'day' },
  { amount: 4.34524, unit: 'week' },
  { amount: 12, unit: 'month' },
  { amount: Number.POSITIVE_INFINITY, unit: 'year' },
]

/** "5 daqiqa oldin" / "2 kun oldin" -- a session list or activity feed reads at a glance in relative
 * time; `Intl.RelativeTimeFormat` covers all four shipped locale tags natively (verified against the
 * bundled Node ICU: `uz-Latn`/`uz-Cyrl` need no extra data, same as `formatNumber` above). Anything
 * under a minute collapses to "just now" via the `second` unit's own `-0` -> `numeric: 'auto'` text
 * rather than a separate branch. */
export function formatRelativeTime(d: Date, locale: Locale, now: Date = new Date()): string {
  let deltaSeconds = (d.getTime() - now.getTime()) / 1000
  let unit: Intl.RelativeTimeFormatUnit = 'second'
  for (const division of RELATIVE_DIVISIONS) {
    if (Math.abs(deltaSeconds) < division.amount) {
      unit = division.unit
      break
    }
    deltaSeconds /= division.amount
    unit = division.unit
  }
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
    Math.round(deltaSeconds),
    unit,
  )
}
