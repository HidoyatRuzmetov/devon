// Rendering one custom field's label and one answer, in the reader's locale.
//
// Two different kinds of string meet here and they are handled differently on purpose:
//   * the *chrome* ("Toʻldirilmagan", "Ha", "Yoʻq") is product copy and goes through `t()` in four
//     locales like everything else;
//   * the *label and the option names* are what a boshqarma boshligʻi typed, which may exist in one
//     locale only. Those fall back through the other locales rather than showing an empty cell --
//     a half-translated column still has to be readable to the person being asked to fill it.
import type { Locale } from '@devon/i18n'
import type { FieldDefDto, FieldOptionDto, WireFieldValue } from './api.js'

const FALLBACK_ORDER: readonly string[] = ['uz-Latn', 'uz-Cyrl', 'ru', 'en']

export function localized(
  map: Readonly<Record<string, string>> | null | undefined,
  locale: Locale | string,
  fallback = '',
): string {
  if (!map) return fallback
  const own = map[locale]
  if (own && own.trim()) return own
  for (const candidate of FALLBACK_ORDER) {
    const value = map[candidate]
    if (value && value.trim()) return value
  }
  return fallback
}

export function fieldLabel(def: FieldDefDto, locale: Locale | string): string {
  return localized(def.label, locale, def.key)
}

export function fieldDescription(def: FieldDefDto, locale: Locale | string): string {
  return localized(def.description, locale, '')
}

export function optionLabel(option: FieldOptionDto, locale: Locale | string): string {
  return localized(option.label, locale, option.id)
}

/** The option objects a value names, in the definition's own order -- what a chip row renders. */
export function selectedOptions(
  def: FieldDefDto,
  value: WireFieldValue,
): readonly FieldOptionDto[] {
  if (value === null || value === undefined) return []
  const ids = Array.isArray(value) ? value : [String(value)]
  return def.options.filter((o) => ids.includes(o.id))
}

/** DESIGN.md's label palette, by token name. A colour never arrives as a hex value from the server;
 * it arrives as one of these names and is resolved here, so a definition cannot smuggle a raw colour
 * into the UI. */
export const OPTION_TONE_CLASS: Readonly<Record<string, string>> = Object.freeze({
  slate: 'bg-muted text-foreground border-border',
  blue: 'bg-info/10 text-info border-info/30',
  green: 'bg-success/10 text-success border-success/30',
  amber: 'bg-warning/10 text-warning border-warning/30',
  red: 'bg-destructive/10 text-destructive border-destructive/30',
  violet: 'bg-accent/10 text-accent-foreground border-accent/40',
  teal: 'bg-success/10 text-success border-success/30',
  pink: 'bg-destructive/10 text-destructive border-destructive/30',
})

export function optionTone(colorToken: string): string {
  return OPTION_TONE_CLASS[colorToken] ?? OPTION_TONE_CLASS['slate']!
}

export const OPTION_TONE_NAMES: readonly string[] = Object.keys(OPTION_TONE_CLASS)

/** A one-line rendering of an answer, for a table cell or a summary chip. `null` means "nobody has
 * answered", which the caller shows as the shared em dash rather than as an empty string. */
export function formatFieldValue(
  def: FieldDefDto,
  value: WireFieldValue,
  t: (key: string, params?: Record<string, string | number>) => string,
  locale: Locale | string,
): string | null {
  if (def.type === 'checkbox') {
    if (value === null || value === undefined) return null
    return value === true ? t('fields.value.yes') : t('fields.value.no')
  }
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) {
    if (value.length === 0) return null
    return selectedOptions(def, value)
      .map((o) => optionLabel(o, locale))
      .join(', ')
  }
  if (typeof value === 'string' && value.trim() === '') return null
  if (def.type === 'select') {
    const option = def.options.find((o) => o.id === value)
    return option ? optionLabel(option, locale) : String(value)
  }
  if (def.type === 'number') return new Intl.NumberFormat(String(locale)).format(Number(value))
  return String(value)
}

/** True when this answer is still missing. `false` is a real answer for a checkbox. */
export function isMissing(def: FieldDefDto, value: WireFieldValue): boolean {
  if (def.type === 'checkbox') return value === null || value === undefined
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  return false
}
