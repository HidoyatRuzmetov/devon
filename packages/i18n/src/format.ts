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

/** `05.09.2026 18:30` -- `formatDate` and `formatTime` joined, so a screen that needs both never
 *  reaches for `Date.prototype.toLocaleString()` (which follows the *browser's* locale and timezone,
 *  not the app's -- the exact bug WALKTHROUGH-FINDINGS §5.1 found on six screens, where an uz-Latn UI
 *  printed `9/6/2026, 11:15:54 PM`). */
export function formatDateTime(d: Date, locale: Locale, tz: string = DEFAULT_TZ): string {
  return `${formatDate(d, locale, tz)} ${formatTime(d, locale, tz)}`
}

/** NumberFlow (the KpiTile/StatNumber ticker) formats internally with its own `Intl.NumberFormat`
 * call and offers no part-level hook to fix up afterwards, so `formatNumber`'s formatToParts trick
 * cannot reach it. `uz-Cyrl`'s CLDR numbering data groups correctly (space, not comma) and is
 * digit-for-digit identical to `uz-Latn`'s -- only the digit *script* would differ, and Arabic
 * numerals are the same glyphs in both -- so substituting it as the locale tag handed to NumberFlow
 * is the cheapest correct fix: same digits, same grouping positions, correct separator. */
export function numberFlowLocale(locale: Locale): Locale | 'uz-Cyrl' {
  return locale === 'uz-Latn' ? 'uz-Cyrl' : locale
}

/** DESIGN.md §5 wants a space thousands separator in every uz/ru locale. `Intl` gets this right for
 *  `uz-Cyrl` and `ru` on every runtime we ship on, but a real embedded-Chromium build resolves
 *  `uz-Latn` to plain `uz` and uses that macrolanguage's CLDR data, which groups with an ASCII comma
 *  -- `new Intl.NumberFormat('uz-Latn').format(500000)` comes back `"500,000"` there (verified live;
 *  Node's bundled ICU does not reproduce it, which is why this needs an explicit part-level fix
 *  rather than trusting a unit test run under Node to catch it). So `uz-Latn` alone is built from
 *  `formatToParts` with the `group` part forced to U+00A0 regardless of what the runtime's ICU
 *  chose; `uz-Cyrl`/`ru`/`en` are left to `Intl`, which already agrees with DESIGN.md for them. */
/** U+00A0 -- DESIGN.md §5's thousands separator, written as an escape so it survives every editor. */
const NBSP = ' '

export function formatNumber(
  n: number,
  locale: Locale,
  options?: Intl.NumberFormatOptions,
): string {
  if (locale === 'uz-Latn') {
    return new Intl.NumberFormat(locale, options)
      .formatToParts(n)
      .map((part) => {
        if (part.type === 'group') return NBSP
        // v1.1: the same borrowed-English fallback gets the DECIMAL separator wrong for the same
        // reason, and nothing in the product had ever formatted a fraction until the people table's
        // Yuklama column started printing "19.5 soat" -- so nobody had seen it. Uzbek writes 19,5,
        // as `uz-Cyrl` itself does on this very runtime, and as this function's own unit test has
        // asserted all along (it passes under Node's full ICU and could never have caught this).
        if (part.type === 'decimal') return ','
        return part.value
      })
      .join('')
  }
  return new Intl.NumberFormat(locale, options).format(n)
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
  const rounded = formatNumber(n, locale, { maximumFractionDigits: 0 })
  return locale === 'en' ? `${UZS_SUFFIX[locale]} ${rounded}` : `${rounded} ${UZS_SUFFIX[locale]}`
}

/** The singular subset of `Intl.RelativeTimeFormatUnit` this module actually produces -- the
 * division ladder below only ever assigns these seven, never the plural forms (`"years"`, …) the
 * full DOM-lib union also allows, so the uz-Latn table can be a plain exhaustive `Record` over just
 * these instead of the whole union. */
type RelativeUnit = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year'

const RELATIVE_DIVISIONS: ReadonlyArray<{ amount: number; unit: RelativeUnit }> = [
  { amount: 60, unit: 'second' },
  { amount: 60, unit: 'minute' },
  { amount: 24, unit: 'hour' },
  { amount: 7, unit: 'day' },
  { amount: 4.34524, unit: 'week' },
  { amount: 12, unit: 'month' },
  { amount: Number.POSITIVE_INFINITY, unit: 'year' },
]

/** Transliterated straight from the (verified-correct) uz-Cyrl `Intl.RelativeTimeFormat` output --
 * `hozir`, `{n} daqiqa oldin`, `{n} soat oldin`, `{n} kun oldin`, `{n} hafta oldin`, `{n} oy oldin`,
 * `{n} yil oldin` -- for the past direction this app actually uses (session activity, "last seen").
 * Not attempted for the future direction: nothing here shows a relative time ahead of now. */
const UZ_LATN_RELATIVE_PAST: Record<RelativeUnit, string> = {
  second: 'hozir',
  minute: '{n} daqiqa oldin',
  hour: '{n} soat oldin',
  day: '{n} kun oldin',
  week: '{n} hafta oldin',
  month: '{n} oy oldin',
  year: '{n} yil oldin',
}

/** "5 daqiqa oldin" / "2 kun oldin" -- a session list or activity feed reads at a glance in relative
 * time. `Intl.RelativeTimeFormat` covers `uz-Cyrl`, `ru` and `en` correctly on every runtime we ship
 * on, but a real embedded-Chromium build resolves `uz-Latn` to the bare `uz` macrolanguage tag, which
 * has no CLDR relative-time data of its own and falls back to *English* text ("now", "-12 min") --
 * verified live, and Node's bundled ICU does not reproduce it, so `uz-Latn` cannot be delegated to
 * `Intl` at all here. It gets its own small hand-built table instead (transliterated from the correct
 * uz-Cyrl forms); the other three locales still go straight through `Intl.RelativeTimeFormat`.
 * Anything under a minute collapses to "hozir"/"just now" via the `second` unit. */
export function formatRelativeTime(d: Date, locale: Locale, now: Date = new Date()): string {
  let deltaSeconds = (d.getTime() - now.getTime()) / 1000
  let unit: RelativeUnit = 'second'
  for (const division of RELATIVE_DIVISIONS) {
    if (Math.abs(deltaSeconds) < division.amount) {
      unit = division.unit
      break
    }
    deltaSeconds /= division.amount
    unit = division.unit
  }
  const rounded = Math.round(deltaSeconds)
  if (locale === 'uz-Latn') {
    if (unit === 'second') return UZ_LATN_RELATIVE_PAST.second
    const n = Math.abs(rounded)
    return UZ_LATN_RELATIVE_PAST[unit].replace('{n}', String(n))
  }
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(rounded, unit)
}
