// Public API of @devon/i18n. This is the only module other packages may import from (mirrors the
// @devon/db convention, agentic/ledger/cycles/EPIC-000/items/EPIC-000.2.md) -- apps/web (EPIC-000.7)
// imports only from here, never from `./locale.js` or any other `src/*` path directly.
export {
  LOCALES,
  DEFAULT_LOCALE,
  LOCALE_LABEL,
  LOCALE_CHIP,
  localeSchema,
  isLocale,
  resolveLocale,
  type Locale,
  type LocaleResolutionInput,
} from './locale.js'

export { t, translate, type TParams } from './t.js'
export { useT, useLocale } from './react.js'
export { getLocale, setLocale, subscribeLocale } from './store.js'

export { formatDate, formatTime, formatNumber, formatUzs } from './format.js'
export { normalizeUz } from './normalize-uz.js'
export { latinToCyrillic } from './transliterate.js'

export { flatten, flatMessages, messageTree, knownKeys, type MessageTree } from './messages.js'

export {
  loadTerms,
  loadBannedWords,
  verifyTerms,
  scanBannedWords,
  termSchema,
  termSourceSchema,
  TERMS_JSON_PATH,
  TERMS_MD_PATH,
  BANNED_JSON_PATH,
  type Term,
  type TermSource,
  type TermIssue,
  type BannedHit,
} from './terms.js'
