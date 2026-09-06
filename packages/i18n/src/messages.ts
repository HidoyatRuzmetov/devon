// Loads the four message catalogues and exposes them both as the nested tree (for anything that
// wants structure) and pre-flattened dotted-key dictionaries (matching exactly what
// agentic/scripts/check-i18n.mjs computes, so "the gate is green" and "t() finds the key" are
// never two different claims). Import attributes are required here: this package is `type: module`
// + `moduleResolution: NodeNext`, and real Node ESM (not just a bundler) refuses a bare
// `import x from './x.json'` in that mode (verified empirically while building this file).
import uzLatn from '../messages/uz-Latn.json' with { type: 'json' }
import uzCyrl from '../messages/uz-Cyrl.json' with { type: 'json' }
import ru from '../messages/ru.json' with { type: 'json' }
import en from '../messages/en.json' with { type: 'json' }
import { LOCALES, type Locale } from './locale.js'

export type MessageTree = { [key: string]: string | MessageTree }

const TREES: Record<Locale, MessageTree> = {
  'uz-Latn': uzLatn as MessageTree,
  'uz-Cyrl': uzCyrl as MessageTree,
  ru: ru as MessageTree,
  en: en as MessageTree,
}

export function flatten(
  tree: MessageTree,
  prefix = '',
  out: Record<string, string> = {},
): Record<string, string> {
  for (const [key, value] of Object.entries(tree)) {
    const dotted = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object') flatten(value, dotted, out)
    else out[dotted] = value
  }
  return out
}

const FLAT: Record<Locale, Record<string, string>> = Object.fromEntries(
  LOCALES.map((locale) => [locale, flatten(TREES[locale])]),
) as Record<Locale, Record<string, string>>

export function messageTree(locale: Locale): MessageTree {
  return TREES[locale]
}

export function flatMessages(locale: Locale): Record<string, string> {
  return FLAT[locale]
}

/** Every dotted key that exists in the default locale -- the same universe check-i18n.mjs treats
 *  as the source of truth (`cfg.locales[0]`, and `DEFAULT_LOCALE` is `LOCALES[0]`). */
export function knownKeys(): readonly string[] {
  return Object.keys(FLAT[LOCALES[0]])
}
