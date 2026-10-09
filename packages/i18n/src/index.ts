// Public API of @devon/i18n. This is the only module other packages may import from (mirrors the
// @devon/db convention, agentic/ledger/cycles/EPIC-000/items/EPIC-000.2.md) -- apps/web (EPIC-000.7)
// imports only from here, never from `./locale.js` or any other `src/*` path directly.
//
// `./terms.js` (loadTerms/verifyTerms/scanBannedWords/...) is deliberately NOT re-exported here: it
// is a Node-only, fs-reading build/verify tool (packages/i18n/src/cli/terms-build.ts,
// terms-verify.ts, and their unit tests import it directly via a relative path). Barrelling it
// through here pulls `node:fs` into every consumer's module graph -- including apps/web's browser
// bundle, where Vite externalizes `node:fs` and the app crashes on load the moment anything touches
// the binding (found running `pnpm start` end-to-end and opening the app, 2026-09; blank screen,
// console: `Module "node:fs" has been externalized for browser compatibility`).
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
export {
  getLocale,
  setLocale,
  subscribeLocale,
  getLocaleLoadFailure,
  subscribeLocaleLoadFailure,
} from './store.js'

export {
  formatDate,
  formatDateTime,
  formatTime,
  formatNumber,
  formatUzs,
  formatRelativeTime,
  formatMonthYear,
  formatMonthShort,
  numberFlowLocale,
} from './format.js'
export { normalizeUz } from './normalize-uz.js'
export { latinToCyrillic } from './transliterate.js'

export {
  flatten,
  flatMessages,
  hasCatalogue,
  knownKeys,
  loadCatalogue,
  messageTree,
  registerCatalogue,
  type MessageTree,
} from './messages.js'
