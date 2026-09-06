// Home's time-based greeting (design.md §6.1): "Windows: 05-11 tong, 11-18 kun, 18-23 kech, 23-05
// 'Assalomu alaykum'" -- always read in Asia/Tashkent, never the visitor's local browser timezone
// (a civil servant travelling should still see the department's own morning).
const TASHKENT_TZ = 'Asia/Tashkent'

export function tashkentHour(d: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TASHKENT_TZ,
    hour: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const hour = parts.find((p) => p.type === 'hour')?.value
  if (!hour) return d.getHours()
  return hour === '24' ? 0 : Number(hour)
}

export function greetingKey(
  hour: number,
): 'home.greeting.morning' | 'home.greeting.day' | 'home.greeting.evening' | 'home.greeting.night' {
  if (hour >= 5 && hour < 11) return 'home.greeting.morning'
  if (hour >= 11 && hour < 18) return 'home.greeting.day'
  if (hour >= 18 && hour < 23) return 'home.greeting.evening'
  return 'home.greeting.night'
}

/** design.md §6.1: address by given name + patronymic ("Xayrli kun, Aziz Baxtiyorovich"), never the
 * full "Familiya Ism Otasining ismi" form (reserved for approvals/org charts) and never "Hurmatli …"
 * (correspondence register, not a screen greeting). */
export function greetingName(user: { givenName: string; patronymic: string | null }): string {
  return user.patronymic ? `${user.givenName} ${user.patronymic}` : user.givenName
}

// Long month/weekday names, hand-authored per locale (spec.md §6.1: "6-sentabr, shanba" /
// "6 сентября, суббота" / "Saturday, 6 September"). NOT delegated to
// `Intl.DateTimeFormat(locale, { month: 'long', weekday: 'long' })`: verified empirically that the
// shipped ICU data (both the browser's and, separately, Node's) has no long-form uz/uz-Latn data at
// all -- every uz* tag silently falls back to a broken generic pattern ("M09 6, Sun": a raw ICU
// skeleton token for the month plus an English weekday abbreviation), which is not a locale
// preference gap but a rendering failure on the product's own default locale (I-9's "every string
// through i18n" implies every string is *correct*, not merely routed through the layer). Also, per
// I-9's sibling rule in `format.ts` (day/month/year "read as parts and joined ourselves rather than
// trusting the locale's own separator/order"), the three example strings above do not even share one
// field order (uz/ru put the weekday last, en puts it first) -- so a single `Intl` call could not
// produce all three correctly even where its data is complete. Months are indexed 1-12, weekdays 0-6
// (0 = Sunday), read from a `Date` via `en-US` `Intl.DateTimeFormat` parts -- the one thing `Intl` is
// used for here -- because `en-US` numeric/short-weekday output is reliably complete and gives a
// timezone-correct (Asia/Tashkent), locale-independent index to look up.
const MONTHS_UZ_LATN = [
  'yanvar',
  'fevral',
  'mart',
  'aprel',
  'may',
  'iyun',
  'iyul',
  'avgust',
  'sentabr',
  'oktabr',
  'noyabr',
  'dekabr',
]
const MONTHS_UZ_CYRL = [
  'январ',
  'феврал',
  'март',
  'апрел',
  'май',
  'июн',
  'июл',
  'август',
  'сентябр',
  'октябр',
  'ноябр',
  'декабр',
]
// Genitive case -- required after a day number in Russian ("6 сентября", not "6 сентябрь").
const MONTHS_RU_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
]
const MONTHS_EN = [
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
]
// Index 0 = Sunday, matching `en-US`'s own weekday order (and `Date.getDay()`'s).
const WEEKDAYS_UZ_LATN = [
  'yakshanba',
  'dushanba',
  'seshanba',
  'chorshanba',
  'payshanba',
  'juma',
  'shanba',
]
const WEEKDAYS_UZ_CYRL = ['якшанба', 'душанба', 'сешанба', 'чоршанба', 'пайшанба', 'жума', 'шанба']
const WEEKDAYS_RU = [
  'воскресенье',
  'понедельник',
  'вторник',
  'среда',
  'четверг',
  'пятница',
  'суббота',
]
const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const EN_US_WEEKDAY_ORDER = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function tashkentDateParts(d: Date): { day: number; month: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TASHKENT_TZ,
    day: 'numeric',
    month: 'numeric',
    weekday: 'short',
  }).formatToParts(d)
  const day = Number(parts.find((p) => p.type === 'day')?.value)
  const month = Number(parts.find((p) => p.type === 'month')?.value)
  const weekdayAbbr = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun'
  const weekday = EN_US_WEEKDAY_ORDER.indexOf(weekdayAbbr)
  return { day, month, weekday: weekday === -1 ? 0 : weekday }
}

export function formatHomeDateLine(d: Date, locale: string): string {
  const { day, month, weekday } = tashkentDateParts(d)
  const monthIdx = month - 1

  switch (locale) {
    case 'uz-Cyrl':
      return `${day}-${MONTHS_UZ_CYRL[monthIdx]}, ${WEEKDAYS_UZ_CYRL[weekday]}`
    case 'ru':
      return `${day} ${MONTHS_RU_GENITIVE[monthIdx]}, ${WEEKDAYS_RU[weekday]}`
    case 'en':
      return `${WEEKDAYS_EN[weekday]}, ${day} ${MONTHS_EN[monthIdx]}`
    case 'uz-Latn':
    default:
      return `${day}-${MONTHS_UZ_LATN[monthIdx]}, ${WEEKDAYS_UZ_LATN[weekday]}`
  }
}
