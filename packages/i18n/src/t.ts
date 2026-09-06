// The `t()` wrapper. The dotted-key form is mandatory (`t('a.b.c')`) because
// `agentic/scripts/check-i18n.mjs` finds usage only via that exact call-site pattern -- never call
// a compiled message function directly from apps/web (design.md §1.3, §7.3).
import { flatMessages } from './messages.js'
import { getLocale } from './store.js'
import { isDev } from './env.js'
import type { Locale } from './locale.js'

export type TParams = Record<string, string | number>

const PLACEHOLDER = /\{(\w+)\}/g

function interpolate(template: string, params: TParams | undefined): string {
  if (!params) return template
  return template.replace(PLACEHOLDER, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  )
}

/** Looks a key up in one specific locale -- the primitive `t()` and `useT()` are both built from. */
export function translate(locale: Locale, key: string, params?: TParams): string {
  const dict = flatMessages(locale)
  const template = dict[key]
  if (template === undefined) {
    if (isDev()) console.error(`[i18n] missing key "${key}" in "${locale}" -- run the i18n gate`)
    return `⟨${key}⟩`
  }
  return interpolate(template, params)
}

/** Reads the currently active locale (set via `setLocale()`, normally once on boot from
 *  `resolveLocale()` and again on every LocaleMenu switch). Usable outside React -- toasts, the
 *  audit-friendly copy in non-component code, the CLI break scripts. */
export function t(key: string, params?: TParams): string {
  return translate(getLocale(), key, params)
}
