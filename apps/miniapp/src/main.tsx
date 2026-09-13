import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { getLocale, loadCatalogue, resolveLocale, setLocale, subscribeLocale } from '@devon/i18n'
import { App } from './app.js'
import { forcedLocale } from './lib/session.js'
import { tg } from './lib/telegram.js'
import './styles.css'

// Boot the locale before the first paint, so there is no flash of the wrong language (design.md
// §4.3). Three sources, in order: the account's own saved locale (applied by `SessionProvider` the
// moment sign-in answers), the Telegram client's language for the very first frame, and uz-Latn.
// `?locale=` is honoured too -- the screenshot harness and the four-locale review pass need a way to
// force one without touching an account.
function resolveBootLocale() {
  // `forcedLocale()` (the same function `SessionProvider` consults before it applies the account's
  // own saved locale, so the two cannot disagree) or, failing that, the Telegram client's language
  // for the very first frame. `resolveLocale` is the only sanctioned way to turn an untrusted tag
  // into a Locale: it knows `uz-UZ-Cyrl` is uz-Cyrl and that anything unrecognised is uz-Latn.
  return forcedLocale() ?? resolveLocale({ header: navigator.language })
}

function applyDocumentLocale(): void {
  document.documentElement.lang = getLocale()
  // All four locales are left-to-right; set explicitly so a future RTL locale is a one-line change.
  document.documentElement.dir = 'ltr'
}

// The theme is applied again (and kept in sync) inside `App`; this first write is what keeps the
// very first paint from flashing the light theme inside a dark Telegram.
document.documentElement.dataset['theme'] = tg.colorScheme

const container = document.getElementById('root')
if (!container) throw new Error('#root element not found')

// Only the default locale's strings ride in the shell chunk (packages/i18n/src/messages.ts); a
// session opening in ru, uz-Cyrl or en fetches that one catalogue -- a same-origin static chunk --
// before the first paint, which is what keeps "no flash of the wrong language" true here too. This
// matters more inside Telegram than in the web app: the client's own language decides the first
// frame, so a Russian-language Telegram hits the non-default path every time.
const boot = resolveBootLocale()
void loadCatalogue(boot).then(() => {
  setLocale(boot)
  applyDocumentLocale()
  subscribeLocale(applyDocumentLocale)

  createRoot(container).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
})
