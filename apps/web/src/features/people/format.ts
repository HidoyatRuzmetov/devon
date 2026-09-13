// Rendering one indicator value, according to the registry's own `format` (v1.1 SPEC §4.2).
//
// One function, three call sites (the table, the person page, the head dashboard): a percent is
// always a percent, a duration always reads the same way, and a missing value is always the same
// em dash rather than "0", "-", "null" or an empty cell depending on who wrote the screen.
import type { IndicatorSpec } from '@devon/contracts'
import { formatDate, formatRelativeTime, type Locale } from '@devon/i18n'

type Translate = (key: string, vars?: Record<string, string | number>) => string

/** The one "there is nothing here" glyph in the product. An em dash, never a hyphen and never `--`
 * (DESIGN.md's typography rules; the double hyphen was a real bug the UI blitz logged). */
export const EMPTY_VALUE = '—'

export function formatIndicator(
  /** SEV2 #7: only `format` is ever read, so a custom-field column renders through the same
   * function as a registry indicator. */
  spec: Pick<IndicatorSpec, 'format'>,
  value: unknown,
  t: Translate,
  locale: Locale = 'uz-Latn',
): string {
  if (value === null || value === undefined || value === '') return EMPTY_VALUE

  switch (spec.format) {
    case 'percent':
      return `${Math.round(Number(value))}%`
    case 'minutes': {
      const minutes = Math.round(Number(value))
      if (minutes < 60) return t('people.indicator.value.minutes', { minutes })
      const hours = Math.floor(minutes / 60)
      const rest = minutes % 60
      return rest === 0
        ? t('people.indicator.value.hours', { hours })
        : t('people.indicator.value.hoursMinutes', { hours, minutes: rest })
    }
    case 'hours':
      return t('people.indicator.value.hours', {
        hours: Math.round(Number(value)),
      })
    case 'date':
      return formatDate(new Date(String(value)), locale)
    case 'relativeDate':
      return formatRelativeTime(new Date(String(value)), locale)
    case 'boolean':
      return value === true ? t('people.indicator.value.yes') : t('people.indicator.value.no')
    case 'chips':
      return Array.isArray(value) ? value.join(', ') : String(value)
    case 'number':
      return String(Math.round(Number(value)))
    case 'text':
    default:
      return String(value)
  }
}
