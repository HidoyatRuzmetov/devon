// The translate target picker (AI-AUDIT §5 fix 1 — the single defect behind "AI mostly translates
// to Uzbek and nothing happens").
//
// v1.0's card description and page editor both called `translate` with `{ text, locale }` where
// `locale` was `useLocale()` — the *reader's own UI language*. The feature treats that field as the
// target, and its prompt says that text already in the target should be returned lightly polished.
// So a uz-Latn user pressing sparkle beside an Uzbek description asked GLM to translate Uzbek into
// Uzbek and got their own sentence back. Nothing in the product ever asked which language they
// wanted.
//
// This component is that question, asked once, in the one place it belongs: next to the sparkle
// button. It also encodes the decision the audit's D-2 makes — uz-Latn ↔ uz-Cyrl never goes to a
// model. `packages/i18n`'s `latinToCyrillic` does it deterministically, instantly, free, and with no
// orthography risk, so the picker marks that pair as local and the caller converts in the browser.
import * as React from 'react'
import { Select, type SelectOption } from '@devon/ui'
import { useT, type Locale } from '@devon/i18n'

export const TRANSLATE_LOCALES: readonly Locale[] = ['uz-Latn', 'uz-Cyrl', 'ru', 'en']

/**
 * True when this pair is the Latin→Cyrillic transliteration of the same language, which
 * `@devon/i18n`'s `latinToCyrillic` does locally: deterministic, instant, free, and with no
 * orthography risk (AI-AUDIT §4, D-2 — this pair was a meaningful share of translate spend, for an
 * answer a lookup table already knows).
 *
 * Only that direction. `packages/i18n` exports `latinToCyrillic` and no inverse, and Cyrillic→Latin
 * is genuinely the harder direction (Cyrillic `е`/`ё` and `ю`/`я` each map to a digraph whose correct
 * Latin form depends on what precedes them), so uz-Cyrl → uz-Latn goes to the model like any other
 * pair rather than to a half-right table. Nothing in this feature may add the inverse: `packages/i18n`
 * is the owner of Uzbek orthography in this codebase, and a second implementation in a web feature is
 * how two spellings of the same word start shipping.
 */
export function isLocalTransliterationPair(source: Locale, target: Locale): boolean {
  return source === 'uz-Latn' && target === 'uz-Cyrl'
}

/**
 * A sensible first target, so the picker is never a blank question: from Uzbek, Russian is what a
 * ministry correspondence actually needs; from Russian or English, Uzbek Latin, the department's
 * own working language and this product's default locale.
 */
export function defaultTranslateTarget(viewerLocale: Locale): Locale {
  return viewerLocale === 'uz-Latn' || viewerLocale === 'uz-Cyrl' ? 'ru' : 'uz-Latn'
}

export function TranslateTargetPicker({
  value,
  onChange,
  id,
  disabled,
}: {
  value: Locale
  onChange: (locale: Locale) => void
  id: string
  disabled?: boolean
}): React.JSX.Element {
  const t = useT()
  const options: SelectOption[] = TRANSLATE_LOCALES.map((locale) => ({
    value: locale,
    label: t(`ai.translateTarget.${locale}`),
  }))
  return (
    <label className="flex items-center gap-2 text-caption text-muted-foreground" htmlFor={id}>
      {t('ai.translateTarget.label')}
      <Select
        id={id}
        value={value}
        options={options}
        disabled={disabled ?? false}
        onChange={(event) => onChange(event.target.value as Locale)}
        aria-label={t('ai.translateTarget.label')}
        className="h-9 w-40 text-small"
      />
    </label>
  )
}
