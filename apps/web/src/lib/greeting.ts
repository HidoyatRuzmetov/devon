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

const LOCALE_TAG: Record<string, string> = {
  'uz-Latn': 'uz-Latn-u-ca-gregory',
  'uz-Cyrl': 'uz-Cyrl-u-ca-gregory',
  ru: 'ru',
  en: 'en',
}

/** design.md §6.1's date line ("6-sentabr, shanba" / "6 сентября, суббота" / "Saturday, 6
 * September"). Delegated to `Intl.DateTimeFormat` per locale rather than a hand-built lookup table
 * of month/weekday names (I-9: formatting goes through the i18n layer, never string concatenation of
 * literals) -- the exact Uzbek "year-first when the year is shown" long form design.md documents as
 * an alternate rendering is not reproduced verbatim here; noted in this item's NOTES. */
export function formatHomeDateLine(d: Date, locale: string): string {
  const tag = LOCALE_TAG[locale] ?? 'en'
  return new Intl.DateTimeFormat(tag, {
    timeZone: TASHKENT_TZ,
    day: 'numeric',
    month: 'long',
    weekday: 'long',
  }).format(d)
}
