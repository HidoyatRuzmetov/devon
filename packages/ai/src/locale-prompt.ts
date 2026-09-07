// Tiny shared helper every prompt file uses so "answer in the caller's locale" is phrased once, not
// copy-pasted into ten files with ten chances to drift.
import type { Locale } from './types.js'

const LOCALE_NAME: Record<Locale, string> = {
  'uz-Latn': 'Uzbek written in the Latin alphabet (oʻzbek, lotin yozuvi)',
  'uz-Cyrl': 'Uzbek written in the Cyrillic alphabet (ўзбек, кирилл ёзуви)',
  ru: 'Russian',
  en: 'English',
}

export function localeInstruction(locale: Locale): string {
  return `Write every human-readable string in your answer in ${LOCALE_NAME[locale]}. Field names and enum values stay exactly as specified in the schema (never translate a key or an enum literal).`
}

export function localeName(locale: Locale): string {
  return LOCALE_NAME[locale]
}
